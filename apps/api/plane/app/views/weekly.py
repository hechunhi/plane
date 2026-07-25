# BARSOUL 週次ミーティング支援 REST (hechun 2026-07-21)
# docs/architecture/weekly-report-mvp.md v2。
#
# 三層の境界をここで守る:
#   ① issue_activities / issue_comments は **純読のみ**(utils/weekly_report.collect)
#   ② draft_html / ContentTranslation は再生成可能な派生 → いつ消してもよい
#   ③ content_html / WeeklyMeeting / MeetingChatMessage は人が書いた SoR → 保全
import hashlib
import logging
import os
from datetime import timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    ContentTranslation,
    FileAsset,
    MeetingChatMessage,
    MeetingChatReaction,
    ProjectMember,
    ProjectPage,
    WeeklyMeeting,
    WeeklyReportEntry,
    Workspace,
)
from plane.bgtasks.weekly_task import generate_weekly_drafts
from plane.utils.weekly_report import collect, workspace_member_ids
from plane.utils.weekly_rt import push as _rt_push

logger = logging.getLogger("plane.weekly")

# 既定の会期長。初回(過去に確定会議が無い)だけ使う。以降は前回 held_at が起点。
DEFAULT_PERIOD_DAYS = int(os.environ.get("WEEKLY_DEFAULT_PERIOD_DAYS", "7"))


def _ws(slug):
    return Workspace.objects.get(slug=slug)


def _user_json(u):
    if not u:
        return None
    return {
        "id": str(u.id),
        "display_name": u.display_name or u.email,
        "avatar_url": getattr(u, "avatar_url", None) or "",
    }


def _entry_json(e):
    return {
        "id": str(e.id),
        "member": _user_json(e.member),
        "stats": e.stats or {},
        "sources": e.sources or [],
        "draft_html": e.draft_html or "",
        "content_html": e.content_html or "",
        "model_used": e.model_used or "",
        "draft_status": e.draft_status or "",
        "generated_at": e.generated_at.isoformat() if e.generated_at else None,
        "edited_at": e.edited_at.isoformat() if e.edited_at else None,
        "edited_by": _user_json(e.edited_by),
    }


def _page_projects(page_ids):
    """page_id → project_id。CE の Page は project 配下にしか存在できないので、
    画面がノートへのリンクを組むには project_id が要る(1 クエリで引く)。"""
    ids = [p for p in page_ids if p]
    if not ids:
        return {}
    rows = ProjectPage.objects.filter(page_id__in=ids, deleted_at__isnull=True).values_list(
        "page_id", "project_id"
    )
    return {str(p): str(pr) for p, pr in rows}


def _meeting_json(m, entries=None, page_projects=None):
    pp = _page_projects([m.page_id]) if page_projects is None else page_projects
    d = {
        "id": str(m.id),
        "title": m.title or "",
        "period_start": m.period_start.isoformat(),
        "period_end": m.period_end.isoformat(),
        "status": m.status,
        "held_at": m.held_at.isoformat() if m.held_at else None,
        "page_id": str(m.page_id) if m.page_id else None,
        "page_project_id": pp.get(str(m.page_id)) if m.page_id else None,
    }
    if entries is not None:
        d["entries"] = [_entry_json(e) for e in entries]
    return d


def _notes_skeleton(meeting):
    """ノートの初期骨組み = **人の名前の見出しだけ**。

    白紙より書き出しやすく、しかも AI の文章は一行も入れない(産品決定 条件③)。
    会議は「人 → 人」で進むので、この順番がそのまま議事の順番になる。
    """
    from django.utils.html import escape

    names = (
        WeeklyReportEntry.objects.filter(meeting=meeting, deleted_at__isnull=True)
        .select_related("member")
        .order_by("member__display_name")
        .values_list("member__display_name", flat=True)
    )
    body = "".join(f"<h2>{escape(n or '—')}</h2><p></p>" for n in names)
    return body or "<p></p>"


def _default_period(workspace_id):
    """会期の既定窓 = 「前回確定会議の held_at → 今」。

    カレンダー週を使わないのは、金曜開催が翌週月曜へずれる運用例外があるため
    (産品決定 2026-07-21 論点 2)。初回のみ直近 7 日で始める。
    """
    end = timezone.now()
    last = (
        WeeklyMeeting.objects.filter(
            workspace_id=workspace_id, status=WeeklyMeeting.STATUS_CONFIRMED,
            held_at__isnull=False, deleted_at__isnull=True,
        )
        .order_by("-held_at")
        .first()
    )
    if last:
        return last.held_at, end
    return end - timedelta(days=DEFAULT_PERIOD_DAYS), end


class WeeklyMeetingListEndpoint(BaseAPIView):
    """GET  /workspaces/{slug}/weekly-meetings/  — 会期一覧
    POST /workspaces/{slug}/weekly-meetings/  — 新しい会期を開く(集計 + 下書き生成)
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        ws = _ws(slug)
        qs = list(
            WeeklyMeeting.objects.filter(workspace_id=ws.id, deleted_at__isnull=True).order_by("-period_end")[:52]
        )
        # ノートの project は 1 クエリでまとめて引く(52 会期 × 1 クエリを避ける)。
        pp = _page_projects([m.page_id for m in qs])
        return Response([_meeting_json(m, page_projects=pp) for m in qs], status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        ws = _ws(slug)
        # 既に開いている会期があればそれを返す(重複作成の防止)
        open_m = (
            WeeklyMeeting.objects.filter(
                workspace_id=ws.id, status=WeeklyMeeting.STATUS_OPEN,
                deleted_at__isnull=True,
            )
            .order_by("-period_end")
            .first()
        )
        if open_m:
            entries = list(
                WeeklyReportEntry.objects.filter(meeting=open_m, deleted_at__isnull=True)
                .select_related("member", "edited_by")
            )
            return Response(_meeting_json(open_m, entries), status=status.HTTP_200_OK)

        start, end = _default_period(ws.id)
        m = WeeklyMeeting.objects.create(
            workspace_id=ws.id, period_start=start, period_end=end,
            title=(request.data.get("title") or "").strip(),
        )
        entries = _rebuild(m, generate_draft=True)
        return Response(_meeting_json(m, entries), status=status.HTTP_201_CREATED)


def _rebuild(meeting, generate_draft=True, member_id=None):
    """会期の投影を作り直す。**content_html(人の確定版)は絶対に上書きしない。**

    投影(集計)は同期 — DB 読みだけで速い。下書き生成だけを worker に出す
    (ローカル推論は 1 人 ~70s の直列処理。要求の中では終わらない)。
    """
    ws_id = meeting.workspace_id
    members = workspace_member_ids(ws_id)
    if member_id:
        members = [m for m in members if str(m) == str(member_id)]
    data = collect(ws_id, meeting.period_start, meeting.period_end, member_ids=members)

    out, queued = [], []
    for uid in members:
        rec = data.get(str(uid)) or {
            "stats": {"done": 0, "progress": 0, "discussion": 0, "created": 0},
            "sources": [],
        }
        entry, _ = WeeklyReportEntry.objects.get_or_create(
            meeting=meeting, member_id=uid,
            defaults={"stats": rec["stats"], "sources": rec["sources"]},
        )
        entry.stats = rec["stats"]
        entry.sources = rec["sources"]
        if generate_draft and rec["sources"]:
            entry.draft_status = WeeklyReportEntry.DRAFT_QUEUED
            queued.append(entry.id)
        entry.save()
        out.append(entry)

    if queued:
        generate_weekly_drafts.delay(str(meeting.id), [str(i) for i in queued])

    return (
        WeeklyReportEntry.objects.filter(id__in=[e.id for e in out])
        .select_related("member", "edited_by")
        .order_by("member__display_name")
    )


class WeeklyMeetingDetailEndpoint(BaseAPIView):
    """GET    /workspaces/{slug}/weekly-meetings/{id}/         — 会期 + 全メンバー週報
    PATCH  /workspaces/{slug}/weekly-meetings/{id}/         — タイトル / ノート Page の紐付け
    DELETE /workspaces/{slug}/weekly-meetings/{id}/         — 開き間違えた会期を捨てる
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, meeting_id):
        ws = _ws(slug)
        m = WeeklyMeeting.objects.get(id=meeting_id, workspace_id=ws.id, deleted_at__isnull=True)
        entries = list(
            WeeklyReportEntry.objects.filter(meeting=m, deleted_at__isnull=True)
            .select_related("member", "edited_by")
            .order_by("member__display_name")
        )
        return Response(_meeting_json(m, entries), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, meeting_id):
        ws = _ws(slug)
        m = WeeklyMeeting.objects.get(id=meeting_id, workspace_id=ws.id, deleted_at__isnull=True)
        if "title" in request.data:
            m.title = (request.data.get("title") or "").strip()[:255]
        if "page_id" in request.data:
            m.page_id = request.data.get("page_id") or None
        m.save()
        return Response(_meeting_json(m), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug, meeting_id):
        """開き間違えた会期の捨て方。これが無いと「確定を押し間違えた → 新会期を開いた
        → 元に戻せない(後続会期があるので reopen も 409)」で詰む。

        捨ててよいのは **人が何も書いていない** 会期だけ。draft_html は再生成可能な
        派生なので障害にならないが、content_html と発言ログは人の SoR なので守る。
        """
        ws = _ws(slug)
        m = WeeklyMeeting.objects.get(id=meeting_id, workspace_id=ws.id, deleted_at__isnull=True)

        entries = WeeklyReportEntry.objects.filter(meeting=m, deleted_at__isnull=True)
        has_content = entries.exclude(content_html="").exclude(content_html__isnull=True).exists()
        has_chat = MeetingChatMessage.objects.filter(meeting=m, deleted_at__isnull=True).exists()
        if has_content or has_chat:
            return Response(
                {"error": "meeting has human-authored content"},
                status=status.HTTP_409_CONFLICT,
            )

        now = timezone.now()
        entries.update(deleted_at=now)
        m.deleted_at = now
        m.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WeeklyMeetingActionEndpoint(BaseAPIView):
    """POST /workspaces/{slug}/weekly-meetings/{id}/action/
    action = refresh(再集計 + 下書き再生成) | confirm(会議を確定 → 次会期の起点)
           | reopen(確定の取り消し。後続会期が既に開いていれば 409)
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, meeting_id):
        ws = _ws(slug)
        m = WeeklyMeeting.objects.get(id=meeting_id, workspace_id=ws.id, deleted_at__isnull=True)
        action = (request.data.get("action") or "").strip()

        if action == "refresh":
            m.period_end = timezone.now()
            m.save()
            entries = _rebuild(
                m,
                generate_draft=bool(request.data.get("generate", True)),
                member_id=request.data.get("member_id"),
            )
            return Response(_meeting_json(m, entries), status=status.HTTP_200_OK)

        if action == "confirm":
            m.status = WeeklyMeeting.STATUS_CONFIRMED
            m.held_at = timezone.now()
            m.period_end = m.held_at
            m.save()
            return Response(_meeting_json(m), status=status.HTTP_200_OK)

        if action == "create_page":
            # ノートは自前 SoR を増やさず **Plane ネイティブ Page** に寄せる(設計 論点 3)。
            # CE の Page は project 配下にしか置けないので project_id が必須。
            # 生成は PageSerializer 経由 — ProjectPage の作成も版管理も本家と同じ道を通す。
            from plane.app.serializers import PageSerializer
            from plane.bgtasks.page_transaction_task import page_transaction

            if m.page_id:
                return Response(_meeting_json(m), status=status.HTTP_200_OK)  # 冪等

            project_id = request.data.get("project_id")
            if not project_id:
                return Response({"error": "project_id is required"}, status=status.HTTP_400_BAD_REQUEST)
            # 自分が入っていない project にノートを作らせない(作った本人が開けない)。
            if not ProjectMember.objects.filter(
                project_id=project_id, workspace_id=ws.id, member=request.user,
                is_active=True, deleted_at__isnull=True,
            ).exists():
                return Response({"error": "not a member of that project"}, status=status.HTTP_403_FORBIDDEN)

            name = m.title or f"{m.period_start:%Y-%m-%d} – {m.period_end:%Y-%m-%d}"
            html = _notes_skeleton(m)
            ser = PageSerializer(
                data={"name": name[:255], "access": 0},
                context={
                    "project_id": project_id,
                    "owned_by_id": request.user.id,
                    "description_json": {},
                    "description_binary": None,
                    "description_html": html,
                },
            )
            if not ser.is_valid():
                return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
            page = ser.save()
            page_transaction.delay(new_description_html=html, old_description_html=None, page_id=str(page.id))

            m.page = page
            m.save()
            return Response(_meeting_json(m), status=status.HTTP_201_CREATED)

        if action == "reopen":
            # 確定は「会期を閉じる」だけの操作。押し間違いが復旧不能だと、
            # 会議中に誰も確定ボタンを押せなくなる — だから戻せるようにする。
            # ただし後続の会期が既に開いていると起点が二重になるので、そこは拒む。
            if WeeklyMeeting.objects.filter(
                workspace_id=ws.id,
                deleted_at__isnull=True,
                status=WeeklyMeeting.STATUS_OPEN,
                period_end__gte=m.period_end,
            ).exists():
                return Response(
                    {"error": "a newer meeting is already open"},
                    status=status.HTTP_409_CONFLICT,
                )
            m.status = WeeklyMeeting.STATUS_OPEN
            m.held_at = None
            m.save()
            entries = (
                WeeklyReportEntry.objects.filter(meeting=m, deleted_at__isnull=True)
                .select_related("member", "edited_by")
                .order_by("member__display_name")
            )
            return Response(_meeting_json(m, entries), status=status.HTTP_200_OK)

        return Response({"error": "unknown action"}, status=status.HTTP_400_BAD_REQUEST)


class WeeklyReportEntryEndpoint(BaseAPIView):
    """PATCH /workspaces/{slug}/weekly-meetings/{id}/entries/{entry_id}/

    確定版(content_html)の保存。**これは人が書いた SoR** — 再集計でも消さない。
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, meeting_id, entry_id):
        ws = _ws(slug)
        e = WeeklyReportEntry.objects.select_related("member", "edited_by").get(
            id=entry_id, meeting_id=meeting_id, meeting__workspace_id=ws.id,
            deleted_at__isnull=True,
        )
        if "content_html" in request.data:
            e.content_html = request.data.get("content_html") or ""
            e.edited_at = timezone.now()
            e.edited_by = request.user
            # 本文が変われば訳文キャッシュは無効 — 消せば次の表示で作り直される
            _ct_purge(entity="weekly_entry", object_id=e.id)
        e.save()
        return Response(_entry_json(e), status=status.HTTP_200_OK)


class MeetingChatEndpoint(BaseAPIView):
    """GET  /workspaces/{slug}/weekly-meetings/{id}/chat/ — 発言一覧(訳文付き)
    POST /workspaces/{slug}/weekly-meetings/{id}/chat/ — 発言 + 自動翻訳 + 実時配信

    スコープは会議画面に閉じる(産品決定 論点 4)。常時チャットにはしない。
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, meeting_id):
        ws = _ws(slug)
        qs = (
            MeetingChatMessage.objects.filter(
                meeting_id=meeting_id, meeting__workspace_id=ws.id, deleted_at__isnull=True
            )
            .select_related("created_by", "attachment", "attachment__workspace")
            .order_by("created_at")[:500]
        )
        msgs = list(qs)
        ids = [m.id for m in msgs]
        tr = _translations_for("chat_message", ids)
        rx = _reactions_for(ids)
        by_id = {str(m.id): m for m in msgs}  # 引用元の解決に使う(全件読むので親も必ず居る)
        return Response([_chat_json(m, tr, rx, by_id) for m in msgs], status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug, meeting_id):
        ws = _ws(slug)
        m = WeeklyMeeting.objects.get(id=meeting_id, workspace_id=ws.id, deleted_at__isnull=True)
        text = (request.data.get("text") or "").strip()
        asset = _chat_asset(request, ws, meeting_id, request.data.get("asset_id"))
        # 画像だけの発言を許す(会議では「これ見て」の一枚が本文になる)。
        if not text and asset is None:
            return Response({"error": "empty"}, status=status.HTTP_400_BAD_REQUEST)

        from plane.app.views.issue.comment import _detect_src

        # 引用返信。親は同じ会期の生きた発言だけ許す(他会期・取消済みは黙って無視)。
        parent = None
        reply_to_id = request.data.get("reply_to")
        if reply_to_id:
            parent = MeetingChatMessage.objects.select_related("created_by").filter(
                id=reply_to_id, meeting_id=meeting_id, deleted_at__isnull=True
            ).first()

        src = _detect_src(text) or "" if text else ""
        msg = MeetingChatMessage.objects.create(
            meeting=m, text=text[:4000], source_lang=src, reply_to=parent, attachment=asset
        )
        _translate_chat_message(ws, msg)

        pids = [msg.id] + ([parent.id] if parent else [])
        tr = _translations_for("chat_message", pids)
        by_id = {str(parent.id): parent} if parent else {}
        payload = _chat_json(msg, tr, {}, by_id)
        _rt_push(str(m.id), "chat", payload)
        return Response(payload, status=status.HTTP_201_CREATED)


class MeetingChatMessageEndpoint(BaseAPIView):
    """PATCH  /workspaces/{slug}/weekly-meetings/{id}/chat/{msg}/ — 自分の発言を直す
    DELETE /workspaces/{slug}/weekly-meetings/{id}/chat/{msg}/ — 自分の発言を取り消す

    直せるのは **自分の発言だけ**、かつ **会期が OPEN の間だけ**(確定後は記録として固定)。
    編集は原文(SoR)を書き換え、訳文(派生)は作り直す — 古い訳を残さない。
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def patch(self, request, slug, meeting_id, message_id):
        ws = _ws(slug)
        msg = MeetingChatMessage.objects.select_related(
            "meeting", "created_by", "reply_to", "reply_to__created_by", "attachment", "attachment__workspace"
        ).get(
            id=message_id, meeting_id=meeting_id, meeting__workspace_id=ws.id, deleted_at__isnull=True
        )
        if msg.created_by_id != request.user.id:
            return Response({"error": "not your message"}, status=status.HTTP_403_FORBIDDEN)
        if msg.meeting.status != "OPEN":
            return Response({"error": "meeting is closed"}, status=status.HTTP_409_CONFLICT)

        text = (request.data.get("text") or "").strip()
        # 画像付きなら本文を空にできる(添え書きを取り消すのも編集)。文字だけの発言は空にできない
        # — それは編集ではなく取消なので、取消の導線(DELETE)を通させる。
        if not text and not msg.attachment_id:
            return Response({"error": "empty"}, status=status.HTTP_400_BAD_REQUEST)

        from plane.app.views.issue.comment import _detect_src

        msg.text = text[:4000]
        msg.source_lang = _detect_src(msg.text) or "" if text else ""
        msg.edited_at = timezone.now()
        msg.save(update_fields=["text", "source_lang", "edited_at", "updated_at"])
        # 古い訳は捨ててから引き直す(原文が変わったのに古い訳が残るのが最悪)。
        _ct_purge(entity="chat_message", object_id=msg.id)
        _translate_chat_message(ws, msg)

        parent = msg.reply_to if msg.reply_to_id and msg.reply_to.deleted_at is None else None
        pids = [msg.id] + ([parent.id] if parent else [])
        tr = _translations_for("chat_message", pids)
        rx = _reactions_for([msg.id])
        by_id = {str(parent.id): parent} if parent else {}
        payload = _chat_json(msg, tr, rx, by_id)
        _rt_push(str(meeting_id), "chat_edit", payload)
        return Response(payload, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def delete(self, request, slug, meeting_id, message_id):
        ws = _ws(slug)
        msg = MeetingChatMessage.objects.select_related("meeting").get(
            id=message_id, meeting_id=meeting_id, meeting__workspace_id=ws.id, deleted_at__isnull=True
        )
        if msg.created_by_id != request.user.id:
            return Response({"error": "not your message"}, status=status.HTTP_403_FORBIDDEN)
        if msg.meeting.status != "OPEN":
            return Response({"error": "meeting is closed"}, status=status.HTTP_409_CONFLICT)

        msg.deleted_at = timezone.now()
        msg.save(update_fields=["deleted_at", "updated_at"])
        # 訳(派生)も一緒に消す。原文が消える以上、残す意味がない。
        _ct_purge(entity="chat_message", object_id=msg.id)
        # 画像も配信を止める。発言を取り消したのに URL を知る人には見え続ける、を作らない。
        if msg.attachment_id:
            FileAsset.objects.filter(id=msg.attachment_id).update(
                is_deleted=True, deleted_at=timezone.now()
            )
        _rt_push(str(meeting_id), "chat_delete", {"id": str(msg.id)})
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeetingChatReactionEndpoint(BaseAPIView):
    """POST /workspaces/{slug}/weekly-meetings/{id}/chat/{msg}/reactions/ — リアクション切替

    同じ絵文字を二度押したら外れる(トグル)。双語チームでは相槌が一番速い相手 —
    誰でも(GUEST 含む)押せる。会期が OPEN の間だけ(確定後は記録として固定)。
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug, meeting_id, message_id):
        ws = _ws(slug)
        msg = MeetingChatMessage.objects.select_related("meeting").get(
            id=message_id, meeting_id=meeting_id, meeting__workspace_id=ws.id, deleted_at__isnull=True
        )
        if msg.meeting.status != "OPEN":
            return Response({"error": "meeting is closed"}, status=status.HTTP_409_CONFLICT)

        reaction = (request.data.get("reaction") or "").strip()[:32]
        if not reaction:
            return Response({"error": "empty"}, status=status.HTTP_400_BAD_REQUEST)

        existing = MeetingChatReaction.objects.filter(
            message=msg, actor=request.user, reaction=reaction, deleted_at__isnull=True
        ).first()
        if existing:
            existing.delete()
        else:
            MeetingChatReaction.objects.create(message=msg, actor=request.user, reaction=reaction)

        rx = _reactions_for([msg.id])
        # 実時配信の me は「押した本人」基準。各クライアントは自分の視点で me を引き直す
        # ため、配信は誰の視点でもない集計(actors)だけ送り、me は受け手が計算する。
        _rt_push(str(meeting_id), "chat_reaction", {"id": str(msg.id), "reactions": rx.get(str(msg.id), [])})
        return Response(rx.get(str(msg.id), []), status=status.HTTP_200_OK)


def _translate_chat_message(ws, msg):
    """発言を反対言語へ即翻訳(hy-mt2 実測 ~505ms — 会議のテンポで足りる)。
    ja↔zh のみ。判定不能(英数字のみ等)は黙って原文だけ残す。"""
    src = msg.source_lang or ""
    if src not in ("ja", "zh"):
        return
    from plane.app.views.issue.comment import _call_llm
    from plane.app.views.issue import comment as _c

    tgt = "ja" if src == "zh" else "zh"
    out = _call_llm(msg.text, src, tgt)
    if not out:
        return
    _ct_upsert(
        entity="chat_message", object_id=msg.id, field="text", target_lang=tgt,
        defaults={
            "workspace_id": ws.id, "source_lang": src, "text": out,
            "translated_by": getattr(_c, "_last_model_used", "") or "aichan",
            "source_hash": hashlib.sha256(msg.text.encode()).hexdigest(),
        },
    )


def _translations_for(entity, object_ids):
    out = {}
    for t in ContentTranslation.objects.filter(entity=entity, object_id__in=object_ids):
        out.setdefault(str(t.object_id), {})[t.target_lang] = t.text
    return out


def _ct_upsert(**kwargs):
    """訳文キャッシュの upsert。**必ず all_objects 経由**。

    BARSOUL 2026-07-25(hechun): ContentTranslation は AuditModel=SoftDeleteModel。
    既定 manager(objects)は deleted_at IS NULL で絞るのに、uniq_content_translation
    (entity,object_id,field,target_lang) は deleted_at を見ない。よって一度 soft
    delete された行が残っていると objects.update_or_create は
      get() → DoesNotExist → force_insert → 一意制約違反(IntegrityError)
    となり、base.py が 400 {"error":"The payload is not valid"} に丸めるため
    **その組合せは以後永久に翻訳不能**になる(実測: weekly_entry/draft/zh)。
    all_objects なら墓標行も掴めるので、deleted_at=None で復活させて更新する。
    """
    defaults = dict(kwargs.pop("defaults", {}))
    defaults["deleted_at"] = None  # 墓標行を掴んだ場合は復活させる
    return ContentTranslation.all_objects.update_or_create(defaults=defaults, **kwargs)


def _ct_purge(**kwargs):
    """訳文キャッシュの無効化は **物理削除**。

    header ② の通り ContentTranslation は再生成可能な派生。soft delete で墓標を
    残すと一意制約と噛み合って上記の永久 400 を招くだけで、得るものが何も無い。
    all_objects(素の Manager)の delete() は真の DELETE。既に soft delete され
    ていた行もここで一緒に掃除される。
    """
    return ContentTranslation.all_objects.filter(**kwargs).delete()


def _reactions_for(message_ids, me_id=None):
    """message_id → [{reaction, count, actors:[表示名], actor_ids:[id]}](初出順で安定)。

    「自分が押したか(me)」は敢えて返さない — 実時配信は誰の視点でもないので、
    各クライアントが actor_ids と自分の id を突き合わせて me を計算する(重複表示名でも壊れない)。
    """
    out = {}
    if not message_ids:
        return out
    rows = (
        MeetingChatReaction.objects.filter(message_id__in=message_ids, deleted_at__isnull=True)
        .select_related("actor")
        .order_by("created_at")
    )
    acc = {}
    for r in rows:
        key = (str(r.message_id), r.reaction)
        e = acc.get(key)
        if e is None:
            e = {"reaction": r.reaction, "count": 0, "actors": [], "actor_ids": []}
            acc[key] = e
            out.setdefault(str(r.message_id), []).append(e)
        e["count"] += 1
        e["actors"].append(getattr(r.actor, "display_name", "") or "")
        e["actor_ids"].append(str(r.actor_id))
    return out


def _reply_preview(m, tr, by_id):
    """引用元の軽量プレビュー。親が取り消し/範囲外なら deleted だけ返す。
    双語で読めるよう source_lang+translations も載せる(front の lines() が主従を選ぶ)。"""
    pid = getattr(m, "reply_to_id", None)
    if not pid:
        return None
    p = (by_id or {}).get(str(pid))
    if p is None:
        return {"id": str(pid), "deleted": True}
    return {
        "id": str(p.id),
        "author": (getattr(p.created_by, "display_name", "") or "") if p.created_by_id else "",
        "text": (p.text or "")[:140],
        "source_lang": p.source_lang or "",
        "translations": tr.get(str(p.id), {}),
    }


def _chat_asset(request, ws, meeting_id, asset_id):
    """貼られた画像を発言に結びつける前の検問。

    通すのは「自分が」「この会期に」「実際に上げ終えた」MEETING_CHAT 資産だけ。
    id は当てられるので、他人の資産や別会期の資産を横取りして自分の発言に貼れないようにする。
    条件から外れたものは 400 にせず黙って無視する — 会議の最中に画像 1 枚で発言そのものを
    落とすより、文字だけでも通す方が実害が小さい。
    """
    if not asset_id:
        return None
    asset = FileAsset.objects.filter(
        id=asset_id,
        workspace_id=ws.id,
        entity_type=FileAsset.EntityTypeContext.MEETING_CHAT,
        entity_identifier=str(meeting_id),
        created_by=request.user,
        is_uploaded=True,
        is_deleted=False,
    ).first()
    if asset is None:
        return None
    # 寸法は貼った側が測って一緒に送る(別リクエストにしない)。先に場所を確保できるので、
    # 上へ遡って読んでいる人の視界が画像の読み込みで飛び跳ねない。
    try:
        w, h = int(request.data.get("width") or 0), int(request.data.get("height") or 0)
    except (TypeError, ValueError):
        w = h = 0
    if w > 0 and h > 0 and not (asset.attributes or {}).get("width"):
        asset.attributes = {**(asset.attributes or {}), "width": w, "height": h}
        asset.save(update_fields=["attributes"])
    return asset


def _attachment_json(m):
    """画像の見せ方に必要な最小限。寸法は貼った時に測って attributes に入れてある
    (無ければ front 側が読み込んでから決める = レイアウトが一瞬跳ねるだけ)。"""
    a = getattr(m, "attachment", None)
    if a is None or a.is_deleted:
        return None
    attrs = a.attributes or {}
    return {
        "id": str(a.id),
        "url": a.asset_url,
        "name": attrs.get("name") or "",
        "width": attrs.get("width") or None,
        "height": attrs.get("height") or None,
    }


def _chat_json(m, tr, rx, by_id=None):
    return {
        "id": str(m.id),
        "text": m.text,
        "attachment": _attachment_json(m),
        "source_lang": m.source_lang or "",
        "author": _user_json(m.created_by),
        "at": m.created_at.isoformat(),
        "edited_at": m.edited_at.isoformat() if m.edited_at else None,
        "translations": tr.get(str(m.id), {}),
        "reactions": rx.get(str(m.id), []),
        "reply_to": _reply_preview(m, tr, by_id),
    }


class ContentTranslateEndpoint(BaseAPIView):
    """POST /workspaces/{slug}/content-translate/

    週報エントリ / チャット発言 / ノートの **表示翻訳**。既存の翻訳ロジック
    (views/issue/comment.py)をそのまま呼ぶ — チームで訳語と挙動を揃えるため。
    body: {entity, object_id, field, target_lang, text}
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug):
        from plane.app.views.issue import comment as _c

        ws = _ws(slug)
        entity = (request.data.get("entity") or "").strip()
        object_id = request.data.get("object_id")
        field = (request.data.get("field") or "content").strip()
        tgt = (request.data.get("target_lang") or "").strip()
        text = request.data.get("text") or ""
        if entity not in ("weekly_entry", "chat_message", "page") or not object_id or tgt not in ("ja", "zh"):
            return Response({"error": "bad request"}, status=status.HTTP_400_BAD_REQUEST)

        plain = _c._strip(text) if "<" in text else text
        if not plain.strip():
            return Response({"text": "", "cached": False}, status=status.HTTP_200_OK)

        h = hashlib.sha256(plain.encode()).hexdigest()
        hit = ContentTranslation.objects.filter(
            entity=entity, object_id=object_id, field=field, target_lang=tgt
        ).first()
        if hit and hit.source_hash == h and hit.text:
            return Response({"text": hit.text, "cached": True}, status=status.HTTP_200_OK)

        src = _c._detect_src(plain) or ("ja" if tgt == "zh" else "zh")
        out = _c._call_llm(plain, src, tgt)
        if not out:
            return Response({"error": "translate_failed"}, status=status.HTTP_502_BAD_GATEWAY)

        _ct_upsert(
            entity=entity, object_id=object_id, field=field, target_lang=tgt,
            defaults={
                "workspace_id": ws.id, "source_lang": src, "text": out,
                "translated_by": getattr(_c, "_last_model_used", "") or "aichan",
                "source_hash": h,
            },
        )
        return Response({"text": out, "cached": False}, status=status.HTTP_200_OK)
