# BARSOUL 2026-08 — アプリ内通知(ベル)を、そのままスマホのプッシュにも流す。
#
# 設計の芯:
#   - **プッシュ専用の通知経路を作らない**。Notification が 1 行できた時に
#     初めてプッシュが出る。だから「ベルには出たがプッシュは来ない」「プッシュは
#     来たがベルに無い」というズレが構造的に起きない。
#   - **全部は送らない**。ベルは全活動を拾うが、プッシュで叩き起こしてよいのは
#     自分に関係のある 6 種だけ(メンション / 返信 / 担当タスクへのコメント /
#     割り当て / 期日 / 担当タスクの重要な変化)。それ以外は無音でベルに溜める。
#   - 失敗しても呼び元(通知作成)を絶対に巻き込まない。
#
# 文面は utils/push_copy.py、送信は utils/web_push.py。ここは「誰に何を」だけ。

import logging
import re

from celery import shared_task

from plane.db.models import (
    IssueAssignee,
    IssueComment,
    Notification,
    WebPushPreference,
    WebPushSubscription,
)
from plane.utils import push_copy
from plane.utils.web_push import is_configured, send_to_subscription

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
}

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

    value = activity.get("new_value") or ""
    if kind == "priority_change":
        value = push_copy.translate_priority(value, language)

    body = push_copy.body_for(
        kind,
        language,
        actor=_actor_name(notification),
        issue=issue.get("name"),
        excerpt=push_copy.excerpt(activity.get("new_value")),
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


@shared_task
def push_notifications(notification_ids):
    """作られたばかりの Notification をプッシュに流す。

    通知作成側からは `.delay()` で投げっぱなしにする。ここが落ちてもベルは残る。
    """
    if not notification_ids or not is_configured():
        return

    try:
        notifications = (
            Notification.objects.filter(id__in=notification_ids)
            .select_related("workspace", "triggered_by", "receiver")
            .order_by("created_at")
        )

        # 受信者ごとにまとめる。設定・購読先・バッジ数は受信者単位で 1 回だけ引く。
        by_receiver: dict[str, list] = {}
        for notification in notifications:
            by_receiver.setdefault(str(notification.receiver_id), []).append(notification)

        for receiver_id, items in by_receiver.items():
            _push_for_receiver(receiver_id, items)
    except Exception:
        # プッシュはおまけの経路。ここでの失敗を上に伝播させない。
        logger.exception("web push dispatch failed")


def _push_for_receiver(receiver_id: str, notifications: list) -> None:
    subscriptions = list(WebPushSubscription.objects.filter(user_id=receiver_id, is_active=True))
    if not subscriptions:
        return

    preference, _ = WebPushPreference.objects.get_or_create(user_id=receiver_id)
    receiver = notifications[0].receiver
    language = push_copy.normalize_language(getattr(getattr(receiver, "profile", None), "language", None))

    # 未読件数 = ホーム画面アイコンに出す数字。まとめて 1 回だけ数える。
    badge_count = Notification.objects.filter(
        receiver_id=receiver_id, read_at__isnull=True, archived_at__isnull=True
    ).count()

    issue_ids = {(n.data or {}).get("issue", {}).get("id") for n in notifications}
    issue_ids.discard(None)

    # 「自分が前にコメントした課題か」= 返信されたと見なす条件。
    # Plane のコメントはフラットで返信関係を持たないので、これで代用する。
    commented_issue_ids = set(
        str(x)
        for x in IssueComment.objects.filter(issue_id__in=issue_ids, actor_id=receiver_id).values_list(
            "issue_id", flat=True
        )
    )
    assigned_issue_ids = set(
        str(x)
        for x in IssueAssignee.objects.filter(issue_id__in=issue_ids, assignee_id=receiver_id).values_list(
            "issue_id", flat=True
        )
    )

    for notification in notifications:
        issue_id = str((notification.data or {}).get("issue", {}).get("id"))
        kind = classify(
            notification,
            receiver_has_commented=issue_id in commented_issue_ids,
            is_assignee=issue_id in assigned_issue_ids,
        )
        if not kind:
            continue

        field = _PREFERENCE_FIELD.get(kind)
        if field and not getattr(preference, field, True):
            continue

        payload = _build_payload(notification, kind, language, badge_count)
        if not payload:
            continue

        for subscription in subscriptions:
            send_to_subscription(subscription, payload)
