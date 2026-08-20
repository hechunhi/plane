# BARSOUL 2026-08 — 期日リマインド。前日に 1 回、当日に 1 回だけ。
#
# 方針:
#   - ベルの通知を 1 行作り、それをプッシュにも流す(= 他の通知と同じ道を通る)。
#     プッシュ専用の裏道は作らない。取りこぼしも二重通知も、道が 1 本なら起きない。
#   - 終わった作業には絶対に鳴らさない(completed / cancelled、アーカイブ済みを除外)。
#   - 冪等。Beat が二重に走っても、同じ日・同じ作業・同じ相手には 1 通しか出ない。
#     判定は「その日(JST)の同じ kind の通知が既にあるか」だけで行う。専用の
#     台帳テーブルは作らない(通知そのものが台帳になる)。
#   - 日付は JST 基準。UTC で数えると「今日」が夜に一日ズレる。

import logging

from celery import shared_task
from django.utils import timezone

from plane.bgtasks.web_push_task import push_notifications
from plane.db.models import Issue, IssueAssignee, Notification
from plane.utils.recurring import JST, now_jst_date

logger = logging.getLogger(__name__)

# 期日を過ぎた分はここでは扱わない(逾期の督促は定期タスク側の担当)。
_PHASES = {
    0: "deadline_today",
    1: "deadline_tomorrow",
}

_DONE_GROUPS = ("completed", "cancelled")


@shared_task
def deadline_sweep():
    """毎日 1 回、当日・翌日が期日の作業を担当者に知らせる。"""
    try:
        today = now_jst_date(timezone.now())
        created_ids: list[str] = []

        for offset, kind in _PHASES.items():
            due = today + timezone.timedelta(days=offset) if hasattr(timezone, "timedelta") else None
            if due is None:
                from datetime import timedelta

                due = today + timedelta(days=offset)
            created_ids.extend(_sweep_one_day(due, kind, today))

        if created_ids:
            push_notifications.delay(created_ids)
        logger.info("deadline sweep: %s notifications", len(created_ids))
    except Exception:
        logger.exception("deadline sweep failed")


def _sweep_one_day(due, kind: str, today) -> list[str]:
    issues = (
        Issue.objects.filter(target_date=due, archived_at__isnull=True)
        .exclude(state__group__in=_DONE_GROUPS)
        .select_related("project", "project__workspace", "state")
    )

    rows = []
    for issue in issues:
        assignee_ids = list(
            IssueAssignee.objects.filter(issue_id=issue.id).values_list("assignee_id", flat=True)
        )
        if not assignee_ids:
            continue

        # 今日すでに同じ知らせを出した相手は飛ばす(= 冪等)。
        already = set(
            str(x)
            for x in Notification.objects.filter(
                entity_identifier=issue.id,
                entity_name="issue",
                sender="deadline",
                created_at__gte=_start_of_today_utc(today),
            )
            .filter(data__deadline__phase=kind)
            .values_list("receiver_id", flat=True)
        )

        project = issue.project
        data = {
            "kind": "deadline",
            "deadline": {"phase": kind, "date": str(due)},
            "issue": {
                "id": str(issue.id),
                "name": str(issue.name),
                "identifier": str(project.identifier),
                "sequence_id": issue.sequence_id,
                "state_name": issue.state.name if issue.state_id else None,
                "state_group": issue.state.group if issue.state_id else None,
            },
        }
        for assignee_id in assignee_ids:
            if not assignee_id or str(assignee_id) in already:
                continue
            rows.append(
                Notification(
                    workspace=project.workspace,
                    project=project,
                    sender="deadline",
                    receiver_id=assignee_id,
                    entity_identifier=issue.id,
                    entity_name="issue",
                    title=str(issue.name),
                    data=data,
                )
            )

    if not rows:
        return []
    Notification.objects.bulk_create(rows, batch_size=100)
    return [str(row.id) for row in rows]


def _start_of_today_utc(today):
    """JST の今日 0 時を UTC の datetime で返す(冪等判定の窓)。"""
    from datetime import datetime, time

    return datetime.combine(today, time.min, tzinfo=JST)
