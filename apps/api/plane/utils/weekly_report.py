# BARSOUL 週次ミーティング支援 — 集計層 (hechun 2026-07-21)
# docs/architecture/weekly-report-mvp.md v2 §3。
#
# **紅線**: issue_activities / issue_comments は 100% 純読。**絶対に書き戻さない**。
# ここは投影(projection)のみを作る。生成も編集もしない。
import logging
import re
from collections import defaultdict

from django.db.models import Q

from plane.db.models import IssueActivity, State

logger = logging.getLogger("plane.weekly")

# ── バケット ────────────────────────────────────────────────────────────────
BUCKET_DONE = "done"            # 完了した事
BUCKET_PROGRESS = "progress"    # 進行中の事
BUCKET_DISCUSSION = "discussion"  # 議論への貢献
BUCKETS = (BUCKET_DONE, BUCKET_PROGRESS, BUCKET_DISCUSSION)

# 進行中に数える field(state は完了判定を経てから振り分ける)
_PROGRESS_FIELDS = {
    "assignees", "priority", "target_date", "start_date", "parent",
    "blocks", "blocked_by", "relates_to", "duplicate", "module", "cycle",
    "labels", "estimate_point", "name", "description",
}

# 機械 actor: is_bot=True に加え、愛ちゃん(is_bot=False で運用されている)を
# メールで明示除外する。人間の週報に機械の動作を混ぜない。
MACHINE_ACTOR_EMAILS = {"ai@barsoul.jp"}

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _plain(html, limit=180):
    """評論 HTML → 抜粋用プレーン文。**原文のまま**切り出すだけ(要約しない)。"""
    t = _WS.sub(" ", _TAG.sub(" ", html or "")).strip()
    return t[:limit] + ("…" if len(t) > limit else "")


def _completed_state_ids(workspace_id):
    """完了扱いの state id 集合。group='completed' のみ(cancelled は完了ではない)。"""
    return set(
        State.objects.filter(workspace_id=workspace_id, group="completed")
        .values_list("id", flat=True)
    )


def _bucket_of(act, completed_ids):
    """1 件の活動 → バケット。判定は決定論的(AI を通さない)。"""
    verb, field = act.verb, (act.field or "")

    # 議論: 評論 / リアクション
    if field == "comment":
        return BUCKET_DISCUSSION
    if field == "reaction":
        return BUCKET_DISCUSSION

    # 完了: state が completed グループへ遷移
    if field == "state":
        if act.new_identifier and act.new_identifier in completed_ids:
            return BUCKET_DONE
        return BUCKET_PROGRESS

    # 新規作成(field が空の created)
    if verb == "created" and not field:
        return BUCKET_PROGRESS

    if field in _PROGRESS_FIELDS:
        return BUCKET_PROGRESS

    # archived_at 等の機械寄り field は数えない
    return None


def _kind_label(act):
    """UI 表示用の素の種別キー(i18n はフロントで解決する)。"""
    f = act.field or ""
    if f == "comment":
        return "comment"
    if f == "reaction":
        return "reaction"
    if f == "state":
        return "state"
    if not f and act.verb == "created":
        return "created"
    return f or act.verb


def collect(workspace_id, period_start, period_end, member_ids=None):
    """会期内の活動を **純読** で集計し、メンバー別の投影を返す。

    戻り値: {user_id: {"stats": {...}, "sources": [...]}}
    sources の 1 件は出処(カード)へ辿れる最小情報を必ず持つ —
    生成文に出処リンクを必ず付ける、という産品紅線を支えるため。
    """
    completed_ids = _completed_state_ids(workspace_id)

    qs = (
        IssueActivity.objects.filter(
            workspace_id=workspace_id,
            created_at__gte=period_start,
            created_at__lt=period_end,
            issue__isnull=False,
            actor__isnull=False,
        )
        .exclude(actor__is_bot=True)
        .exclude(actor__email__in=MACHINE_ACTOR_EMAILS)
        .select_related("issue", "issue__project", "actor", "issue_comment")
        .order_by("created_at")
    )
    if member_ids:
        qs = qs.filter(actor_id__in=member_ids)

    out = defaultdict(lambda: {
        "stats": {"done": 0, "progress": 0, "discussion": 0, "created": 0},
        "sources": [],
    })
    # 同一(メンバー, カード, バケット)の重複出処を畳む — 1 枚のカードで
    # 何度も担当を変えても出処は 1 行でよい。件数は stats 側で数える。
    seen = set()

    for act in qs.iterator(chunk_size=500):
        bucket = _bucket_of(act, completed_ids)
        if not bucket:
            continue
        rec = out[str(act.actor_id)]
        rec["stats"][bucket] += 1
        if act.verb == "created" and not (act.field or ""):
            rec["stats"]["created"] += 1

        issue = act.issue
        project = issue.project if issue else None
        if not issue or not project:
            continue

        key = (str(act.actor_id), str(issue.id), bucket)
        excerpt = ""
        if (act.field or "") == "comment":
            src = act.issue_comment.comment_html if act.issue_comment else act.new_value
            excerpt = _plain(src)
            # 評論は 1 件ごとに価値がある(原文抜粋を出す)ので畳まない
            key = (str(act.actor_id), str(act.id), bucket)
        if key in seen:
            continue
        seen.add(key)

        rec["sources"].append({
            "bucket": bucket,
            "kind": _kind_label(act),
            "issue_id": str(issue.id),
            "project_id": str(project.id),
            "identifier": project.identifier,
            "sequence_id": issue.sequence_id,
            "title": issue.name,
            "at": act.created_at.isoformat(),
            "excerpt": excerpt,
        })

    return dict(out)


def workspace_member_ids(workspace_id):
    """週報の対象になる人間メンバー(機械 actor を除く)。"""
    from plane.db.models import WorkspaceMember

    return list(
        WorkspaceMember.objects.filter(workspace_id=workspace_id, is_active=True)
        .exclude(member__is_bot=True)
        .exclude(member__email__in=MACHINE_ACTOR_EMAILS)
        .values_list("member_id", flat=True)
    )
