# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# BARSOUL: 派生卡片当前态 (Derived Issue State, DIS) 读取端点。
# 看板卡顶状态行用。一次批量拉可见卡的 ai_state,避免 N+1,且不污染 Plane
# 热路径 issue-list serializer。详 docs/architecture/derived-issue-state-mvp.md。

# Python imports
import os
import json
import logging
import requests

# Django imports
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.db.models import Q
from django.core.serializers.json import DjangoJSONEncoder

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import IssueAIState, IssueAIStateCorrection, InboxState, Issue, IssueComment, User, ProjectMember
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.host import base_host

logger = logging.getLogger(__name__)
# 复用既有 ai-bot 入口(host.docker.internal:8098);去掉 /translate 取根
_AIBOT = os.environ.get("AIBOT_TRANSLATE_URL", "http://host.docker.internal:8098/translate").rsplit("/translate", 1)[0]


def _has_kana(t):
    return any("぀" <= c <= "ヿ" for c in (t or ""))


def _aibot_translate(text, target):
    try:
        # timeout=45: 与评论区按需翻译一致(comment.py)。ai-bot 内 cloud Claude 上限 ~30s,
        # HTTP 必须给足余量,否则 plane-api 先于 ai-bot 超时 → 误判 translation failed。
        r = requests.post(f"{_AIBOT}/translate", json={"text": text, "target": target}, timeout=45)
        if r.ok:
            return (r.json() or {}).get("text") or ""
    except Exception:
        logger.warning("ai-state correct: translate failed (非致命)", exc_info=True)
    return ""


def _trigger_rederive(project_id, issue_id):
    try:  # fire-and-forget; worker 异步用 human_note 重判
        requests.post(f"{_AIBOT}/derive-issue-state",
                      json={"project_id": str(project_id), "issue_id": str(issue_id), "force": True}, timeout=2)
    except Exception:
        pass


def _post_audit_comment(request, issue, project_id, note, by):
    """把人手的「向 AI 补充/纠正」原样发成 issue 评论 → **在任务时间线可见、可追溯**。
    这是「留痕」真正给人看的落点(派生表 + 审计表是给程序/AI 的,人看不到)。
    以补充者本人身份发(本人会话);对方语言由评论区自动翻译。失败非致命。"""
    try:
        safe = (note or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
        html = (f"<p>📝 <b>AIへの補足・履歴 / AI 补充说明(留痕)</b>"
                f"{(' — ' + by) if by else ''}</p><p>{safe}</p>")
        uid = request.user.id if request.user.is_authenticated else None
        IssueComment.objects.create(
            workspace_id=issue.workspace_id, project_id=project_id, issue=issue,
            actor=(request.user if request.user.is_authenticated else None),
            comment_html=html, comment_stripped=(note or ""), access="INTERNAL",
            created_by_id=uid, updated_by_id=uid)
        issue_activity.delay(
            type="comment.activity.created",
            requested_data=json.dumps({"comment_html": html, "comment_stripped": note}, cls=DjangoJSONEncoder),
            actor_id=str(uid) if uid else None,
            issue_id=str(issue.id), project_id=str(project_id),
            current_instance=None, epoch=int(timezone.now().timestamp()),
            notification=True, origin=base_host(request=request, is_app=True))
    except Exception:
        logger.warning("ai-state correct: 留痕评论发布失败 (非致命)", exc_info=True)


def _inbox_state_dict(s):
    """个人分流态投影(s 可为 None → 全默认)。digest 前端据此过滤/置顶/计数。"""
    return {
        "read_at": s.read_at.isoformat() if s and s.read_at else None,
        "done_at": s.done_at.isoformat() if s and s.done_at else None,
        "archived_at": s.archived_at.isoformat() if s and s.archived_at else None,
        "snoozed_till": s.snoozed_till.isoformat() if s and s.snoozed_till else None,
        "pinned": bool(s and s.pinned),
        "muted": bool(s and s.muted),
    }


def _approval_frozen(user_id, issue_id):
    """审批/托管中冻结: 隐藏类分流(done/archive/snooze)对其 no-op(feedback_approval_state_lock)。
    审批 SoR 在 ai-bot(/api/approval/my-pending);命中 = 该用户是待裁决审批人 → 冻结。
    fail-open: ai-bot 不可达时放行——渲染层审批组永远从 ai-bot 权威渲染, inbox_state 无法
    隐藏它, 已兜底; 不让 ai-bot 抖动堵住整个分流。"""
    try:
        r = requests.get(f"{_AIBOT}/api/approval/my-pending", params={"user": str(user_id)}, timeout=2)
        if r.ok:
            items = (r.json() or {}).get("items") or []
            return any(str(it.get("issue_id")) == str(issue_id) for it in items)
    except Exception:
        logger.warning("inbox triage: approval-frozen check failed (fail-open)", exc_info=True)
    return False


def _serialize(row):
    issue = row.issue
    st = getattr(issue, "state", None)
    return {
        "issue_id": str(row.issue_id),
        # issue meta(待我处理 digest 用; 卡面行忽略)
        "name": issue.name if issue else "",
        "sequence_id": issue.sequence_id if issue else None,
        # project_id(UUID): 工作区级作业台で各カードが異なる project に属する →
        # フロントが「そのカード自身の project」へ action(催促/改担当/peek/再判)を
        # ルーティングするのに必須。project_identifier は表示用(BS-123 の接頭辞)。
        "project_id": str(row.project_id) if row.project_id else "",
        "project_identifier": row.project.identifier if row.project_id else "",
        "state_group": st.group if st else None,
        "state": row.state,
        "ball": row.ball or None,                       # SELF | OTHER | None
        # 当前行动人
        "actor_kind": row.actor_kind or None,           # person | external | None
        "actor_name": row.current_actor or None,
        "actor_user_id": str(row.actor_user_id) if row.actor_user_id else None,
        "owner": row.owner or None,
        "unassigned": bool(row.unassigned),
        # 等待对象(ball=OTHER), 双语(ja 缺则回退 zh, 保证日文阅览者不见空/中文)
        "waiting_on": {"zh": row.waiting_on_zh or "", "ja": row.waiting_on_ja or row.waiting_on_zh or ""},
        # 下一步, 双语(zh 兜底 ja)
        "next_action": {"zh": row.next_action or "", "ja": row.next_action_ja or row.next_action or ""},
        # 推断依据
        "reasoning": {"zh": row.reasoning or "", "ja": row.reasoning_ja or row.reasoning or ""},
        "source": {"author": row.source_author or "", "quote": row.source_quote or ""},
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "stale_days": row.stale_days,
        "confidence": row.confidence,
        "model_used": row.model_used or None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        # 人手补充/纠正(留痕): 双语补充说明 + 纠正者/时间
        "human_note": {"zh": row.human_note_zh or "", "ja": row.human_note_ja or row.human_note_zh or ""},
        "corrected_by": row.corrected_by or None,
        "corrected_at": row.corrected_at.isoformat() if row.corrected_at else None,
        # 信息完整性/留痕缺口: 状态与材料矛盾/不足 → 要求人补充
        "needs_info": bool(row.needs_info),
        "info_gap": {"zh": row.info_gap_zh or "", "ja": row.info_gap_ja or row.info_gap_zh or ""},
        # 补充框架(AI 理解 + 待澄清点;告诉补充人该写什么,按阅览者语言展示)
        "info_framework": {"zh": row.info_framework_zh or "", "ja": row.info_framework_ja or row.info_framework_zh or ""},
        # DIS 子树 rollup(父任务汇总): 仅有子任务时下发; 决策(ball/actor/next 在上面字段, code 定)+ 子树计数/代表子/矛盾
        "family": ({
            "total": row.subtree_total, "active": row.subtree_active,
            "done": row.subtree_done, "blocked": row.subtree_blocked,
            "tension": {"zh": row.subtree_tension_zh or "", "ja": row.subtree_tension_ja or row.subtree_tension_zh or ""},
            "rep_child": ({"id": str(row.rep_child_id), "sequence_id": row.rep_child.sequence_id,
                           "name": row.rep_child.name} if row.rep_child_id and row.rep_child else None),
        } if row.is_parent else None),
    }


class IssueAIStateBatchEndpoint(BaseAPIView):
    """GET /api/workspaces/{slug}/projects/{pid}/issues/ai-states/?issues=<id,id,...>
    项目成员读。返 {issue_id: DerivedIssueState}。最多 300 卡/次。
    无 issues 参数 → 返该 project 全部已派生卡 (上限 500)。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        raw = (request.query_params.get("issues") or "").strip()
        # 活跃卡(Todo/Doing)正常返派生态;**外加** needs_info=True 的卡(含已完成/取消):
        #   状态变更缺留痕,需要人补说明 → 必须能被看到/被追,直到补全。
        # 其余 Done/Cancelled(留痕完整)不返 → 不显示陈旧 AI 行。
        qs = IssueAIState.objects.filter(
            Q(issue__state__group__in=["unstarted", "started"]) | Q(needs_info=True),
            workspace__slug=slug, project_id=project_id,
            # BARSOUL 2026-06-15 (hechun bug): 已删除卡的派生态 row 仍残留(issue 软删
            # 不级联到 issue_ai_states)→ 「待我处理」digest 显示幽灵卡(两边不同步)。
            # select_related 是裸 JOIN, 软删 issue 仍命中 → 必须显式排除。これで
            # 現在/将来の削除卡 全部不再出现(读时过滤=数据不写=守 ADR-003)。
            issue__deleted_at__isnull=True,
        ).select_related("issue", "issue__state", "project", "rep_child")  # rep_child: 子树 rollup 防 N+1
        if raw:
            ids = [x for x in (s.strip() for s in raw.split(",")) if x][:300]
            qs = qs.filter(issue_id__in=ids)
        else:
            qs = qs.order_by("-updated_at")[:500]

        out = {}
        for row in qs:
            out[str(row.issue_id)] = _serialize(row)
        return Response(out, status=status.HTTP_200_OK)


class IssueAIStateWorkspaceEndpoint(BaseAPIView):
    """GET /api/workspaces/{slug}/my-work/ai-states/
    工作区级「我的工作」作业台 の DIS データ源。**当前ユーザーが在籍(active member)する
    全プロジェクト** を横断し、派生済みの活跃卡(Todo/Doing、または needs_info)を返す。
    返 {issue_id: DerivedIssueState}(項目級 batch と同一 shape → フロント再利用)。上限 1000。

    セキュリティ: project_id__in=在籍プロジェクト で絞る = **未在籍プロジェクトのカードは
    一切返さない**(横断集約でも越权漏れゼロ)。派生表 issue_ai_states の読取専用、SoR 不触。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        member_project_ids = ProjectMember.objects.filter(
            workspace__slug=slug, member=request.user, is_active=True
        ).values_list("project_id", flat=True)
        qs = (
            IssueAIState.objects.filter(
                # 活跃卡(Todo/Doing) + needs_info(状态変更の留痕缺口 → 完了/取消でも見せる)。
                # 項目級 batch と同一口径 → 看板と作业台で表示ロジックが乖離しない。
                Q(issue__state__group__in=["unstarted", "started"]) | Q(needs_info=True),
                workspace__slug=slug,
                project_id__in=member_project_ids,
                # 软删カードの残留派生 row を除外(項目級と同じ既知バグ対策)。
                issue__deleted_at__isnull=True,
            )
            .select_related("issue", "issue__state", "project", "rep_child")
            .order_by("-updated_at")[:1000]
        )
        rows = list(qs)
        # 个人分流态: 一次批量取当前用户在这些卡上的 inbox_states → 附到每卡(digest 读时过滤/置顶/计数用)。
        inbox_map = {
            s.issue_id: s
            for s in InboxState.objects.filter(user=request.user, issue_id__in=[r.issue_id for r in rows])
        }
        out = {}
        for row in rows:
            d = _serialize(row)
            d["inbox"] = _inbox_state_dict(inbox_map.get(row.issue_id))
            out[str(row.issue_id)] = d
        return Response(out, status=status.HTTP_200_OK)


class IssueAIStateCorrectEndpoint(BaseAPIView):
    """POST /api/workspaces/{slug}/projects/{pid}/issues/{iid}/ai-state/correct/
    Body: {note}. 人进详情向 AI 补足背景说明 → 自动双语存储 + 审计留痕 + 触发 AI 重判。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id):
        note = ((request.data or {}).get("note") or "").strip()[:1000]
        if not note:
            return Response({"error": "note required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            issue = Issue.objects.get(pk=issue_id, workspace__slug=slug, project_id=project_id)
        except Issue.DoesNotExist:
            return Response({"error": "issue not found"}, status=status.HTTP_404_NOT_FOUND)

        # 多语言自动化: 录入原文 + 另一语言机翻
        lang = "ja" if _has_kana(note) else "zh"
        note_ja = note if lang == "ja" else (_aibot_translate(note, "ja") or note)
        note_zh = note if lang == "zh" else (_aibot_translate(note, "zh") or note)
        by = (getattr(request.user, "display_name", "") or getattr(request.user, "email", "") or "")[:120]

        row = IssueAIState.all_objects.filter(issue=issue).first()
        prev_ball = (row.ball if row else "") or ""
        prev_actor = (row.current_actor if row else "") or ""
        uid = request.user.id if request.user.is_authenticated else None
        if row:
            row.deleted_at = None
            row.human_note_zh = note_zh
            row.human_note_ja = note_ja
            row.corrected_by = by
            row.corrected_at = timezone.now()
            row.updated_by_id = uid
            row.save()
        else:
            row = IssueAIState.objects.create(
                issue=issue, project_id=project_id, workspace_id=issue.workspace_id,
                human_note_zh=note_zh, human_note_ja=note_ja, corrected_by=by,
                corrected_at=timezone.now(), created_by_id=uid, updated_by_id=uid)

        # 留痕①(程序/AI 可追溯): append-only 审计行(含当时旧 ball/actor)
        IssueAIStateCorrection.objects.create(
            issue=issue, project_id=project_id, workspace_id=issue.workspace_id,
            note_zh=note_zh, note_ja=note_ja, note_lang=lang,
            prev_ball=prev_ball, prev_actor=prev_actor,
            created_by_id=uid, updated_by_id=uid)

        # 留痕②(人看得到): 发成 issue 评论 → 出现在任务时间线,可被任何人审阅追溯
        _post_audit_comment(request, issue, project_id, note, by)

        # 触发 AI 用补充信息重判(worker 读 human_note → prompt 最优先考虑)
        _trigger_rederive(project_id, issue_id)

        fresh = IssueAIState.objects.select_related("issue", "issue__state", "project").get(pk=row.pk)
        return Response(_serialize(fresh), status=status.HTTP_200_OK)


class IssueAIStateUrgeEndpoint(BaseAPIView):
    """POST /api/workspaces/{slug}/projects/{pid}/issues/{iid}/ai-state/urge/
    Body: {message}. **以 愛ちゃん(AI 用户)名义**在工单发催促评论,@ 当前行动人(球在谁手)并通知。
    人手点击=授权(本人有项目权限),但发布者是 AI → 「由爱酱催」。仅发评论,不碰 SoR 真值。
    评论区自动多语言化:以一种语言发出,各读者按自己语言看。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id):
        body = request.data or {}
        # draft 模式:让 愛ちゃん(本地 gemma)结合卡情生成『友好·有理有据』的催促草稿,不发布。
        if body.get("draft"):
            try:
                rr = requests.post(f"{_AIBOT}/dis/compose-urge",
                                   json={"project_id": str(project_id), "issue_id": str(issue_id)}, timeout=40)
                txt = (rr.json() or {}).get("text", "") if rr.ok else ""
            except Exception:
                logger.warning("urge draft compose failed (非致命)", exc_info=True)
                txt = ""
            return Response({"text": txt}, status=status.HTTP_200_OK)
        msg = (body.get("message") or "").strip()[:2000]
        if not msg:
            return Response({"error": "message required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            issue = Issue.objects.get(pk=issue_id, workspace__slug=slug, project_id=project_id)
        except Issue.DoesNotExist:
            return Response({"error": "issue not found"}, status=status.HTTP_404_NOT_FOUND)
        # 发布者 = 愛ちゃん(AI 用户);找不到则拒绝(绝不退回以本人名义发,那正是要修掉的)
        ai_user = User.objects.filter(email=os.environ.get("AI_BOT_EMAIL", "ai@barsoul.jp")).first()
        if not ai_user:
            return Response({"error": "AI user (愛ちゃん) not found"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        # @ 当前行动人(球在谁手),使其收到提及通知
        row = IssueAIState.objects.filter(issue=issue, project_id=project_id).first()
        mention = ""
        if row and row.actor_user_id:
            mention = (f'<mention-component entity_identifier="{row.actor_user_id}" '
                       f'entity_name="user_mention"></mention-component> ')
        safe = msg.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
        html = f"<p>{mention}{safe}</p>"
        IssueComment.objects.create(
            workspace_id=issue.workspace_id, project_id=project_id, issue=issue,
            actor=ai_user, comment_html=html, comment_stripped=msg, access="INTERNAL",
            created_by=ai_user, updated_by=ai_user)
        issue_activity.delay(
            type="comment.activity.created",
            requested_data=json.dumps({"comment_html": html, "comment_stripped": msg}, cls=DjangoJSONEncoder),
            actor_id=str(ai_user.id), issue_id=str(issue_id), project_id=str(project_id),
            current_instance=None, epoch=int(timezone.now().timestamp()),
            notification=True, origin=base_host(request=request, is_app=True))
        # 催促后这条新评论可能改变「球」→ 触发重判(仅派生表)
        _trigger_rederive(project_id, issue_id)
        return Response({"ok": True}, status=status.HTTP_200_OK)


class IssueAIStateTranslateEndpoint(BaseAPIView):
    """POST /api/workspaces/{slug}/projects/{pid}/issues/{iid}/ai-state/translate/
    Body: {text, target?}. 翻译引用依据片段(走 ai-bot,与评论区同款翻译引擎)。
    target 省略时自动翻到另一语言(zh↔ja)。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id):
        text = ((request.data or {}).get("text") or "").strip()[:1000]
        if not text:
            return Response({"text": ""}, status=status.HTTP_200_OK)
        target = ((request.data or {}).get("target") or "").strip().lower()[:2]
        if target not in ("zh", "ja"):
            target = "zh" if _has_kana(text) else "ja"
        out = _aibot_translate(text, target)
        return Response({"text": out or "", "target": target}, status=status.HTTP_200_OK)


class IssueAIStateRederiveEndpoint(BaseAPIView):
    """POST /api/workspaces/{slug}/projects/{pid}/issues/{iid}/ai-state/rederive/
    手动触发 AI 重新分析该卡。**仅重算派生表(issue_ai_states),绝不写 SoR**。
    fire-and-forget(worker 异步重判);幂等。用户怀疑 AI 判断过时/有误时主动刷新。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id):
        try:
            Issue.objects.get(pk=issue_id, workspace__slug=slug, project_id=project_id)
        except Issue.DoesNotExist:
            return Response({"error": "issue not found"}, status=status.HTTP_404_NOT_FOUND)
        _trigger_rederive(project_id, issue_id)
        return Response({"ok": True}, status=status.HTTP_202_ACCEPTED)


class InboxTriageEndpoint(BaseAPIView):
    """POST /api/workspaces/{slug}/projects/{pid}/issues/{iid}/inbox/triage/
    Body: {action, snoozed_till?, value?}
      action = read | done | archive | snooze | pin | mute | reset
    个人收件箱分流。只写 per-user inbox_states 派生投影,**绝不碰 SoR**(不改 issue 状态,
    不写全局 Issue.snoozed_until)。隐藏类(done/archive/snooze)对审批/托管中卡拒绝(409, 服务层冻结)。
    返回该卡最新个人分流态(前端乐观更新的权威回执)。"""

    HIDE_ACTIONS = {"done", "archive", "snooze"}
    VALID_ACTIONS = {"read", "done", "archive", "snooze", "pin", "mute", "reset"}

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id):
        body = request.data or {}
        action = (body.get("action") or "").strip().lower()
        if action not in self.VALID_ACTIONS:
            return Response({"error": "invalid action"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            issue = Issue.objects.get(pk=issue_id, workspace__slug=slug, project_id=project_id)
        except Issue.DoesNotExist:
            return Response({"error": "issue not found"}, status=status.HTTP_404_NOT_FOUND)

        # 托管=审批闸门: 审批未完成须冻结,不可静默清出收件箱(feedback_approval_state_lock)
        if action in self.HIDE_ACTIONS and _approval_frozen(request.user.id, issue_id):
            return Response(
                {"error": "frozen", "reason": "審批/托管中,不可清出收件箱(需先完成审批)"},
                status=status.HTTP_409_CONFLICT)

        uid = request.user.id
        row, _created = InboxState.objects.get_or_create(
            user_id=uid, issue=issue,
            defaults={"workspace_id": issue.workspace_id, "project_id": project_id,
                      "created_by_id": uid, "updated_by_id": uid})
        now = timezone.now()
        if action == "read":
            row.read_at = row.read_at or now
        elif action == "done":
            row.done_at = now
            row.read_at = row.read_at or now
        elif action == "archive":
            row.archived_at = now
            row.read_at = row.read_at or now
        elif action == "snooze":
            raw = (body.get("snoozed_till") or "").strip()
            dt = parse_datetime(raw) if raw else None
            if not dt:
                return Response({"error": "snoozed_till required (iso)"}, status=status.HTTP_400_BAD_REQUEST)
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt, timezone.get_current_timezone())
            row.snoozed_till = dt
            row.read_at = row.read_at or now
        elif action == "pin":
            row.pinned = bool(body.get("value")) if "value" in body else (not row.pinned)
        elif action == "mute":
            row.muted = bool(body.get("value")) if "value" in body else (not row.muted)
        elif action == "reset":
            # 回队: 清 done/archive/snooze(read/pin/mute 保留)
            row.done_at = None
            row.archived_at = None
            row.snoozed_till = None
        row.updated_by_id = uid
        row.save()
        return Response(_inbox_state_dict(row), status=status.HTTP_200_OK)
