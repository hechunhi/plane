# BARSOUL 2026-08 — アプリ内通知(ベル)を、そのままスマホのプッシュにも流す。
#
# 設計の芯:
#   - **プッシュ専用の通知経路を作らない**。Notification が 1 行できた時に
#     初めてプッシュが出る。だから「ベルには出たがプッシュは来ない」「プッシュは
#     来たがベルに無い」というズレが構造的に起きない。
#   - **全部は送らない**。ベルは全活動を拾うが、プッシュで叩き起こしてよいのは
#     自分に関係のあるものだけ(メンション / 返信 / 担当タスクへのコメント /
#     割り当て / 期日 / 担当タスクの重要な変化 / リマインダー / 定期タスク)。
#     それ以外は無音でベルに溜める。
#   - 1 タスク = 全受信者分を 1 回の send_many で並列送信。DB は受信者数に依らず
#     一定回数(購読・設定・未読数・コメント/担当)だけ引く。
#   - 失敗しても呼び元(通知作成)を絶対に巻き込まない。
#
# 文面は utils/push_copy.py、送信は utils/web_push.py。ここは「誰に何を」だけ。

import base64
import hashlib
import logging
import re

from celery import shared_task
from django.db.models import Count, Q

from plane.db.models import (
    IssueAssignee,
    IssueComment,
    Notification,
    WebPushPreference,
    WebPushSubscription,
)
from plane.utils import push_copy
from plane.utils.web_push import PushJob, is_configured, send_many

logger = logging.getLogger(__name__)

# 種類 → 設定画面のどのスイッチで止まるか。
_PREFERENCE_FIELD = {
    "mention": "mention",
    "comment_reply": "comment_reply",
    "comment": "important_update",
    "assigned": "assigned",
    "state_change": "important_update",
    "priority_change": "important_update",
    "due_date_change": "important_update",
    "deadline_tomorrow": "deadline",
    "deadline_today": "deadline",
    # 定期タスク: 新しい回 = 自分(or チーム)に来た仕事 → 割り当てと同じスイッチ。
    # 期日超過 = 期限系のスイッチ。
    "recurring_new": "assigned",
    "recurring_overdue": "deadline",
    # "reminder" は意図的に載せない = 常に送る。人が「この時刻に知らせて」と明示的に
    # 頼んだもので、止めたいならリマインダー自体を消す(端末ごと止めるのは設定画面)。
}

# 同じ課題について「最新 1 通だけ届けば足りる」種類。圏外の端末に積まれた古い方は
# プッシュサービス側で捨ててもらう(Topic ヘッダ)。メンションや返信は 1 通ずつ意味が
# あるので載せない。
_COLLAPSIBLE = {
    "state_change": "upd",
    "priority_change": "upd",
    "due_date_change": "upd",
    "deadline_tomorrow": "ddl",
    "deadline_today": "ddl",
    "recurring_overdue": "ddl",
    "reminder": "rem",
}

# 省電力中でもすぐ鳴らすべき種類(人から直接呼ばれた / 時刻指定 / 今日が期限)。
_HIGH_URGENCY = {"mention", "comment_reply", "assigned", "reminder", "deadline_today"}

# 「担当タスクの重要な変化」として扱うフィールド。
# name / labels / attachment / relates_to などは意図的に外している(叩き起こす
# ほどの用事ではない。ベルには残る)。
_IMPORTANT_FIELDS = {
    "state": "state_change",
    "priority": "priority_change",
    "target_date": "due_date_change",
}


def _actor_name(notification) -> str:
    user = notification.triggered_by
    if not user:
        return ""
    return user.display_name or user.first_name or (user.email or "").split("@")[0]


def classify(notification, receiver_has_commented: bool, is_assignee: bool) -> str | None:
    """この通知をプッシュすべきか、するならどの種類か。None なら送らない。"""
    sender = notification.sender or ""

    # 自前で立てた期日リマインド。deadline_reminder_task が作る形
    # ({"kind": "deadline", "deadline": {"phase": "deadline_today"|...}}) が正。
    # ここは通知カード(content.tsx)と同じ形を読むこと。
    data = notification.data or {}
    kind = data.get("kind")
    if kind == "deadline":
        phase = (data.get("deadline") or {}).get("phase")
        if phase in ("deadline_tomorrow", "deadline_today"):
            return phase
        return None
    if kind in ("deadline_tomorrow", "deadline_today"):
        return kind
    # recurring_task._notify_bell が作る表示型通知(issue_activity を持たない)。
    if kind == "reminder":
        return "reminder"
    if kind == "recurring":
        phase = (data.get("recurring") or {}).get("phase")
        return "recurring_overdue" if phase == "overdue" else "recurring_new"

    activity = (notification.data or {}).get("issue_activity") or {}
    field = activity.get("field")

    if sender.endswith(":mentioned"):
        return "mention"

    if field == "comment":
        if receiver_has_commented:
            return "comment_reply"
        if is_assignee:
            return "comment"
        # 単に購読しているだけの人へのコメント通知は鳴らさない。
        return None

    if field == "assignees":
        # 「自分が担当に足された」時だけ鳴らす。他人の担当変更や、自分が外された
        # 時(= old_identifier 側に入る)では鳴らさない。
        if str(activity.get("new_identifier")) == str(notification.receiver_id):
            return "assigned"
        return None

    if field in _IMPORTANT_FIELDS and is_assignee:
        return _IMPORTANT_FIELDS[field]

    return None


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _scroll_anchor(activity: dict) -> str | None:
    """フロントの DOM アンカー `ac-<id>` に一致する id を返す。

    コメントカードのアンカーは「コメント id」= issue_activity.new_identifier。
    それ以外の活動は「活動 id」= issue_activity.id。
    ※ issue_activity.issue_comment は **コメント本文のテキスト**であって
      id ではない。ここで使うと URL にコメント全文が載って遷移も外れる。
    """
    if not activity:
        return None
    candidates = []
    if activity.get("field") == "comment":
        candidates.append(activity.get("new_identifier"))
    candidates.append(activity.get("id"))
    for value in candidates:
        if isinstance(value, str) and _UUID_RE.match(value):
            return value
    return None


def _work_item_url(notification) -> str:
    """クリックで開く URL。ホームではなく必ずその作業項目まで連れて行く。"""
    issue = (notification.data or {}).get("issue") or {}
    slug = notification.workspace.slug if notification.workspace_id else ""
    identifier = issue.get("identifier")
    sequence_id = issue.get("sequence_id")
    if not (slug and identifier and sequence_id):
        return "/"
    url = f"/{slug}/browse/{identifier}-{sequence_id}/"

    # 該当のコメント / 活動まで送る。frontend 側はこの id を
    # scrollToActivityCommentId に流し込むだけで、既存のスクロール機構に乗る。
    activity = (notification.data or {}).get("issue_activity") or {}
    target = _scroll_anchor(activity)
    if target:
        url = f"{url}?comment={target}"
    return url


def _build_payload(notification, kind: str, language: str, badge_count: int) -> dict | None:
    issue = (notification.data or {}).get("issue") or {}
    activity = (notification.data or {}).get("issue_activity") or {}

    data = notification.data or {}
    value = activity.get("new_value") or ""
    note = activity.get("new_value")
    if kind == "priority_change":
        value = push_copy.translate_priority(value, language)
    elif kind == "recurring_overdue":
        value = str((data.get("recurring") or {}).get("days") or "")
    elif kind == "reminder":
        note = (data.get("reminder") or {}).get("note") or ""

    body = push_copy.body_for(
        kind,
        language,
        actor=_actor_name(notification),
        issue=issue.get("name"),
        excerpt=push_copy.excerpt(note),
        value=value,
    )
    if not body:
        return None

    return {
        "type": kind,
        "title": push_copy.APP_TITLE,
        "body": body,
        "url": _work_item_url(notification),
        "taskId": issue.get("id"),
        "commentId": _scroll_anchor(activity),
        "notificationId": str(notification.id),
        "badgeCount": badge_count,
        "actor": _actor_name(notification),
    }


def _topic(kind: str, issue_id: str | None) -> str | None:
    """RFC 8030 Topic(URL-safe base64 で 32 文字以内)。種類グループ + 課題で 1 本。"""
    group = _COLLAPSIBLE.get(kind)
    if not group or not issue_id:
        return None
    digest = hashlib.sha256(f"{group}:{issue_id}".encode()).digest()
    return base64.urlsafe_b64encode(digest[:18]).decode().rstrip("=")  # 24 文字


@shared_task
def push_notifications(notification_ids):
    """作られたばかりの Notification をプッシュに流す。

    通知作成側からは `.delay()` で投げっぱなしにする。ここが落ちてもベルは残る。
    """
    if not notification_ids or not is_configured():
        return

    try:
        notifications = list(
            Notification.objects.filter(id__in=notification_ids)
            .select_related("workspace", "triggered_by", "receiver__profile")
            .order_by("created_at")
        )
        receiver_ids = {str(n.receiver_id) for n in notifications}

        # 購読を持つ人だけ残す。持っていない受信者には以降 1 クエリも使わない。
        subscriptions: dict[str, list] = {}
        for sub in WebPushSubscription.objects.filter(user_id__in=receiver_ids, is_active=True):
            subscriptions.setdefault(str(sub.user_id), []).append(sub)
        notifications = [n for n in notifications if str(n.receiver_id) in subscriptions]
        if not notifications:
            return
        receiver_ids = set(subscriptions)

        preferences = {str(p.user_id): p for p in WebPushPreference.objects.filter(user_id__in=receiver_ids)}
        for rid in receiver_ids - set(preferences):
            preferences[rid], _ = WebPushPreference.objects.get_or_create(user_id=rid)

        # 未読件数 = ホーム画面アイコンに出す数字。受信者全員分を 1 クエリで。
        badges = {
            str(row["receiver_id"]): row["n"]
            for row in Notification.objects.filter(receiver_id__in=receiver_ids)
            .values("receiver_id")
            .annotate(n=Count("id", filter=Q(read_at__isnull=True, archived_at__isnull=True)))
        }

        issue_ids = {(n.data or {}).get("issue", {}).get("id") for n in notifications}
        issue_ids.discard(None)
        # 「自分が前にコメントした課題か」= 返信されたと見なす条件。
        # Plane のコメントはフラットで返信関係を持たないので、これで代用する。
        commented = {
            (str(u), str(i))
            for u, i in IssueComment.objects.filter(issue_id__in=issue_ids, actor_id__in=receiver_ids)
            .values_list("actor_id", "issue_id")
            .distinct()
        }
        assigned = {
            (str(u), str(i))
            for u, i in IssueAssignee.objects.filter(issue_id__in=issue_ids, assignee_id__in=receiver_ids)
            .values_list("assignee_id", "issue_id")
            .distinct()
        }

        jobs: list[PushJob] = []
        for notification in notifications:
            rid = str(notification.receiver_id)
            job_payload = _plan(notification, rid, preferences[rid], badges.get(rid, 0), commented, assigned)
            if not job_payload:
                continue
            payload, kind = job_payload
            topic = _topic(kind, payload.get("taskId"))
            urgency = "high" if kind in _HIGH_URGENCY else "normal"
            jobs.extend(PushJob(sub, payload, topic, urgency) for sub in subscriptions[rid])

        sent = send_many(jobs)
        if jobs:
            logger.info("web push: %s/%s delivered (%s notifications)", sent, len(jobs), len(notifications))
    except Exception:
        # プッシュはおまけの経路。ここでの失敗を上に伝播させない。
        logger.exception("web push dispatch failed")


def _plan(notification, receiver_id, preference, badge_count, commented, assigned):
    """1 通知 → (payload, kind)。送らないなら None。"""
    issue_id = str((notification.data or {}).get("issue", {}).get("id"))
    kind = classify(
        notification,
        receiver_has_commented=(receiver_id, issue_id) in commented,
        is_assignee=(receiver_id, issue_id) in assigned,
    )
    if not kind:
        return None

    field = _PREFERENCE_FIELD.get(kind)
    if field and not getattr(preference, field, True):
        return None

    language = push_copy.normalize_language(
        getattr(getattr(notification.receiver, "profile", None), "language", None)
    )
    payload = _build_payload(notification, kind, language, badge_count)
    return (payload, kind) if payload else None
