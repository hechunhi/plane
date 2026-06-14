# BARSOUL: 定期タスク 引擎 — Celery Beat 每日扫描(非 Temporal: CONSTITUTION §IV.1 幂等 CRUD 不配 workflow)。
# 见 docs/architecture/recurring-tasks-mvp.md。红线:
#   - 幂等(last_period_key 去重, Beat 重跑/重启不重复生成)。
#   - 卡走 Plane 原生指派 + 直建 1 条 in-app Notification(纯铃铛, 零邮件 / 零评论 / 不走 Lark)。
#   - 顺延 = 同卡改名(繰越), 不推 target_date(保持逾期累积, 升级交 ai-bot/DIS); 绝不建新卡状态。
#   - 失败 → fail_count++ → 阈值反向通知规则创建者(静默失败=漏房租=业务事故)。
import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueLabel,
    Notification,
    ProjectMember,
    RecurringRule,
)
from plane.utils.recurring import (
    JST,
    gen_datetime_utc,
    next_due_after,
    now_jst_date,
    period_key,
    period_label,
)

logger = logging.getLogger(__name__)

_DONE_GROUPS = ("completed", "cancelled")
_FAIL_NOTIFY_AT = 3  # 连续失败到此次数时反向通知创建者(只在等于时发一次, 不刷屏)
_OVERDUE_PUSH_DAYS = 3  # 逾期满 N 天 → 1 次「要対応」铃铛(每实例最多一次)


def seed_next_run(rule: RecurringRule) -> None:
    """规则创建/编辑后, 计算下一次生成时刻。从今天(JST)起的下一个期日 − lead。"""
    today = now_jst_date(timezone.now())
    due = next_due_after(rule.cadence, rule.anchor or {}, today - timedelta(days=1))
    rule.next_run_at = gen_datetime_utc(due, rule.lead_days) if due else None
    rule.save(update_fields=["next_run_at", "updated_at"])


def _card_name(rule: RecurringRule, due) -> str:
    base = ((rule.template or {}).get("title") or rule.name or "").strip()
    return f"{base}({period_label(rule.cadence, rule.anchor or {}, due)})"[:255]


def _notify_bell(issue: Issue, receiver_ids, title: str, sender: str = "recurring") -> None:
    """直建 in-app Notification(铃铛)。不经 issue_activity → 不发邮件、不留评论。"""
    project = issue.project
    data = {"issue": {"id": str(issue.id), "name": str(issue.name),
                      "identifier": str(project.identifier), "sequence_id": issue.sequence_id,
                      "state_name": issue.state.name if issue.state_id else None,
                      "state_group": issue.state.group if issue.state_id else None}}
    rows = [Notification(workspace=project.workspace, project=project, sender=sender,
                         receiver_id=rid, entity_identifier=issue.id, entity_name="issue",
                         title=title, data=data) for rid in receiver_ids if rid]
    if rows:
        Notification.objects.bulk_create(rows, batch_size=50)


def _generate_card(rule: RecurringRule, due):
    """建一张普通卡(state 走 Issue.save 默认; 序号自动)。返回 issue。"""
    tmpl = rule.template or {}
    uid = rule.created_by_id
    issue = Issue.objects.create(
        project_id=rule.project_id, workspace_id=rule.workspace_id,
        name=_card_name(rule, due),
        description_html=tmpl.get("description_html") or "<p></p>",
        priority=tmpl.get("priority") or "none",
        target_date=due,
        created_by_id=uid, updated_by_id=uid,
    )
    for lid in (rule.labels or []):
        try:
            IssueLabel.objects.create(issue=issue, label_id=lid, project_id=rule.project_id,
                                      workspace_id=rule.workspace_id, created_by_id=uid, updated_by_id=uid)
        except Exception:
            logger.warning("recurring: label %s skip on rule %s", lid, rule.id)
    title = f"定期タスク: {issue.name}"
    if rule.assignee_id:
        IssueAssignee.objects.create(issue=issue, assignee_id=rule.assignee_id, project_id=rule.project_id,
                                     workspace_id=rule.workspace_id, created_by_id=uid, updated_by_id=uid)
        _notify_bell(issue, [rule.assignee_id], title)  # 指定担当: 1 次铃铛
    else:
        # 未認領(团队任务): @全员一次, 谁做谁「分配给我」认领
        member_ids = list(ProjectMember.objects.filter(project_id=rule.project_id, is_active=True)
                          .values_list("member_id", flat=True))
        _notify_bell(issue, member_ids, title)
    return issue


def _carryover(rule: RecurringRule):
    """上期未完到了下一生成点: 同卡改名(繰越), 不推 target_date(逾期继续累积)。不出新卡。"""
    i = rule.last_generated_issue
    if not i:
        return
    if "繰越" not in (i.name or ""):
        i.name = f"{i.name}・繰越"[:255]
        i.save(update_fields=["name", "updated_at"])


def _reverse_notify_failure(rule: RecurringRule):
    """连续生成失败达阈值 → 通知规则创建者(只在等于阈值时发一次)。"""
    if rule.created_by_id:
        try:
            project = rule.project
            Notification.objects.create(
                workspace=project.workspace, project=project, sender="recurring",
                receiver_id=rule.created_by_id, entity_name="recurring_rule", entity_identifier=rule.id,
                title=f"定期タスク「{rule.name}」のカード自動生成に失敗しました（{rule.fail_count}回）。手動でご確認ください。",
                data={"rule": {"id": str(rule.id), "name": rule.name}})
        except Exception:
            logger.exception("recurring: reverse-notify failed for rule %s", rule.id)


def _advance(rule: RecurringRule, after_due):
    nxt = next_due_after(rule.cadence, rule.anchor or {}, after_due)
    rule.next_run_at = gen_datetime_utc(nxt, rule.lead_days) if nxt else None


def _process_rule(rule: RecurringRule, now):
    """单条规则在其 next_run_at 到点时的处理。幂等(last_period_key 守门)。"""
    # 本期期日 = 生成日 + lead(因 next_run 存的就是 due−lead 的 JST 00:00 → 精确还原, 无边角)
    if rule.next_run_at:
        gen_date = rule.next_run_at.astimezone(JST).date()
        due = gen_date + timedelta(days=max(0, rule.lead_days))
    else:
        due = next_due_after(rule.cadence, rule.anchor or {}, now_jst_date(now) - timedelta(days=1))
    if not due:
        logger.error("recurring: rule %s anchor 无效, 无法求期日", rule.id)
        return
    key = period_key(rule.cadence, rule.anchor or {}, due)
    if key == rule.last_period_key:  # 本期已处理(幂等)→ 只推进
        _advance(rule, due)
        rule.save(update_fields=["next_run_at", "updated_at"])
        return
    if rule.skip_next:  # 跳过本期一次
        rule.skip_next = False
        rule.last_period_key = key
        _advance(rule, due)
        rule.save(update_fields=["skip_next", "last_period_key", "next_run_at", "updated_at"])
        return
    prev = rule.last_generated_issue
    in_flight = bool(prev and prev.state_id and prev.state.group not in _DONE_GROUPS)
    if in_flight:
        _carryover(rule)  # 顺延旧卡, 不出新卡
        rule.last_period_key = key
        rule.fail_count = 0
        _advance(rule, due)
        rule.save(update_fields=["last_period_key", "fail_count", "next_run_at", "updated_at"])
        return
    issue = _generate_card(rule, due)  # 上期已完/无 → 生成本期卡
    rule.last_generated_issue = issue
    rule.last_period_key = key
    rule.last_run_at = now
    rule.fail_count = 0
    _advance(rule, due)
    rule.save(update_fields=["last_generated_issue", "last_period_key", "last_run_at",
                             "fail_count", "next_run_at", "updated_at"])


def _escalate_overdue(rule: RecurringRule, now):
    """逾期 D+3 的在途实例 → 1 次「要対応」铃铛(每实例最多一次, 幂等)。
    逾期判断用 target_date 硬日期(与 _dis_stale_days 解耦, 不被催促清零); 顺延纯视觉零额外推送。"""
    i = rule.last_generated_issue
    if not i or not i.target_date:
        return
    if i.state_id and i.state.group in _DONE_GROUPS:
        return  # 已完成不催
    if str(rule.overdue_pushed_issue) == str(i.id):
        return  # 本实例已推过(幂等 — 防通知疲劳)
    overdue_days = (now_jst_date(now) - i.target_date).days
    if overdue_days < _OVERDUE_PUSH_DAYS:
        return
    title = f"要対応: 「{i.name}」が期日({i.target_date})を過ぎています"
    if rule.assignee_id:
        _notify_bell(i, [rule.assignee_id], title)
    else:
        member_ids = list(ProjectMember.objects.filter(project_id=rule.project_id, is_active=True).values_list("member_id", flat=True))
        _notify_bell(i, member_ids, title)
    rule.overdue_pushed_issue = str(i.id)
    rule.save(update_fields=["overdue_pushed_issue", "updated_at"])


def run_rule_now(rule: RecurringRule):
    """手动「今すぐ生成」: 复用 _process_rule(幂等 — 同期不重复, 失败后补救会生成)。"""
    now = timezone.now()
    if rule.next_run_at is None or rule.next_run_at > now:
        rule.next_run_at = now
    _process_rule(rule, now)


@shared_task
def recurring_sweep():
    """每日扫描: 到点的 active 规则 → 生成/顺延。逐条隔离失败(一条挂不连累其余)。"""
    now = timezone.now()
    rules = RecurringRule.objects.filter(
        status="active", deleted_at__isnull=True, next_run_at__isnull=False, next_run_at__lte=now
    ).select_related("project", "project__workspace", "last_generated_issue", "last_generated_issue__state")
    done = 0
    for rule in rules:
        try:
            _process_rule(rule, now)
            done += 1
        except Exception:
            logger.exception("recurring: rule %s 处理失败", rule.id)
            try:
                rule.fail_count = (rule.fail_count or 0) + 1
                rule.save(update_fields=["fail_count", "updated_at"])
                if rule.fail_count == _FAIL_NOTIFY_AT:
                    _reverse_notify_failure(rule)
            except Exception:
                logger.exception("recurring: rule %s fail bookkeeping 也失败", rule.id)
    # 逾期升级 pass(独立于生成: 在途实例可能逾期但 next_run 在未来)
    esc = RecurringRule.objects.filter(
        status="active", deleted_at__isnull=True, last_generated_issue__isnull=False
    ).select_related("last_generated_issue", "last_generated_issue__state",
                     "last_generated_issue__project", "last_generated_issue__project__workspace")
    for rule in esc:
        try:
            _escalate_overdue(rule, now)
        except Exception:
            logger.exception("recurring: rule %s 逾期升级失败", rule.id)
    # フォローアップ・スヌーズ満了 pass: 期日を過ぎた snooze → 1 回ベル(snoozed_by へ, 零评论)+ クリア(消費, 幂等)。
    # カードは snoozed_until<=now で既に自动复活(管理器过滤翻转); ここはベルとクリアのみ。
    expired = Issue.objects.filter(snoozed_until__isnull=False, snoozed_until__lte=now).select_related(
        "project", "project__workspace", "state"
    )
    for i in expired:
        try:
            if i.snoozed_by_id:
                _notify_bell(i, [i.snoozed_by_id], f"フォローアップ: 「{i.name}」", sender="snooze")
            i.snoozed_until = None
            i.snoozed_by = None
            i.save(update_fields=["snoozed_until", "snoozed_by", "updated_at"])
        except Exception:
            logger.exception("recurring: issue %s スヌーズ満了処理失败", i.id)
    logger.info("recurring_sweep: %s rules processed", done)
    return done
