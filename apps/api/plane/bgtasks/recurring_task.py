# BARSOUL: 定期タスク 引擎 — Celery Beat 每日扫描(非 Temporal: CONSTITUTION §IV.1 幂等 CRUD 不配 workflow)。
# 见 docs/architecture/recurring-tasks-mvp.md。红线:
#   - 幂等(last_period_key 去重, Beat 重跑/重启不重复生成)。
#   - 卡走 Plane 原生指派 + 直建 1 条 in-app Notification(纯铃铛, 零邮件 / 零评论 / 不走 Lark)。
#   - 顺延 = 同卡改名(繰越), 不推 target_date(保持逾期累积, 升级交 ai-bot/DIS); 绝不建新卡状态。
#   - 失败 → fail_count++ → 阈值反向通知规则创建者(静默失败=漏房租=业务事故)。
import logging
import os
from datetime import timedelta

import requests
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


def _notify_bell(issue: Issue, receiver_ids, title: str, sender: str = "recurring", extra: dict | None = None) -> None:
    """直建 in-app Notification(铃铛)。不经 issue_activity → 不发邮件、不留评论。
    extra: 收件箱专属渲染用(kind=reminder/recurring + 备忘等)。无 issue_activity 的通知
    本会被收件箱守卫(item.tsx)吞成空白, 故必带 kind 让 fork 前端放行 + 走专属样式(⏰/🔁 水印)。"""
    project = issue.project
    data = {"issue": {"id": str(issue.id), "name": str(issue.name),
                      "identifier": str(project.identifier), "sequence_id": issue.sequence_id,
                      "state_name": issue.state.name if issue.state_id else None,
                      "state_group": issue.state.group if issue.state_id else None}}
    if extra:
        data.update(extra)
    rows = [Notification(workspace=project.workspace, project=project, sender=sender,
                         receiver_id=rid, entity_identifier=issue.id, entity_name="issue",
                         title=title, data=data) for rid in receiver_ids if rid]
    if rows:
        # 提醒通知は1枚だけ保持: 古い未読提醒を消してから新規作成。
        if extra and extra.get("kind") == "reminder":
            Notification.objects.filter(
                entity_identifier=issue.id,
                entity_name="issue",
                sender="reminder",
                read_at__isnull=True,
                archived_at__isnull=True,
            ).delete()
        Notification.objects.bulk_create(rows, batch_size=50)


def _llm_transform(html: str, prompt: str) -> str:
    """ai-bot /transform: HTML + 指示 → 结构保持改写后 HTML(仿评论翻译组件: HTML进/HTML出)。
    失败=""(caller 回退原文, 生成绝不因 LLM 抖动失败)。(_AIBOT_URL/_CARDS_TOKEN 见文件尾, 调用时已定义)"""
    if not _CARDS_TOKEN or not html or not prompt:
        return ""
    try:
        r = requests.post(f"{_AIBOT_URL}/transform", headers={"X-Cards-Token": _CARDS_TOKEN},
                          json={"html": html, "prompt": prompt}, timeout=50)
        if r.status_code == 200:
            j = r.json() or {}
            if j.get("ok"):
                return j.get("html") or ""
        else:
            logger.warning("recurring transform → ai-bot http %s", r.status_code)
    except Exception:
        logger.warning("recurring: LLM transform 失败, 回退原文(非致命)", exc_info=True)
    return ""


def _generate_card(rule: RecurringRule, due):
    """建一张普通卡(state 走 Issue.save 默认; 序号自动)。返回 issue。
    BARSOUL: 有 generation_prompt → 以「上一张生成的卡(无则模板快照)」正文为基, 走 ai-bot
    /transform 按提示词改写(结构保持; 链式演进如"日期换本期"逐期推进; 失败回退原文)。"""
    tmpl = rule.template or {}
    uid = rule.created_by_id
    li = rule.last_generated_issue
    base_desc = (li.description_html if (li and li.description_html) else None) or tmpl.get("description_html") or "<p></p>"
    desc = base_desc
    prompt = (rule.generation_prompt or "").strip()
    if prompt and base_desc.strip() and base_desc.strip() != "<p></p>":
        new = _llm_transform(base_desc, prompt)
        if new:
            desc = new
    issue = Issue.objects.create(
        project_id=rule.project_id, workspace_id=rule.workspace_id,
        name=_card_name(rule, due),
        description_html=desc,
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
        _notify_bell(issue, [rule.assignee_id], title, extra={"kind": "recurring"})  # 指定担当: 1 次铃铛
    else:
        # 未認領(团队任务): @全员一次, 谁做谁「分配给我」认领
        member_ids = list(ProjectMember.objects.filter(project_id=rule.project_id, is_active=True)
                          .values_list("member_id", flat=True))
        _notify_bell(issue, member_ids, title, extra={"kind": "recurring"})
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
    # リマインダー満了は reminder_sweep(高频 every 15min)へ移管(2026-06-15): 時刻精度のため日次 sweep から分離。
    logger.info("recurring_sweep: %s rules processed", done)
    return done


# ── BARSOUL リマインダー強化(2026-06-15): 高频提醒扫描 ───────────────────────
def _reminder_receivers(i: Issue):
    """受众 → receiver ids。self=设置人 / assignees=担当 / members=项目活跃成员。"""
    aud = i.remind_audience or "self"
    if aud == "self":
        return [i.snoozed_by_id] if i.snoozed_by_id else []
    if aud == "assignees":
        return list(i.assignees.values_list("id", flat=True))
    if aud == "members":
        return list(ProjectMember.objects.filter(project_id=i.project_id, is_active=True)
                    .values_list("member_id", flat=True))
    return []


def _ring_reminder(i: Issue):
    rids = _reminder_receivers(i)
    if rids:
        title = f"リマインダー: 「{i.name}」" + (f" — {i.remind_note}" if i.remind_note else "")
        by = i.snoozed_by if i.snoozed_by_id else None
        _notify_bell(i, rids, title, sender="reminder", extra={"kind": "reminder", "reminder": {
            "note": i.remind_note or "",
            "by_id": str(i.snoozed_by_id) if i.snoozed_by_id else "",
            "by_name": (by.display_name if by else ""),
        }})


def _clear_reminder(i: Issue):
    i.snoozed_until = None; i.snoozed_by = None; i.remind_at = None
    i.remind_hide = False; i.remind_intensity = "once"; i.remind_audience = "self"; i.remind_fired_on = None
    i.save(update_fields=["snoozed_until", "snoozed_by", "remind_at", "remind_hide",
                          "remind_intensity", "remind_audience", "remind_fired_on", "updated_at"])


@shared_task
def reminder_sweep():
    """高频(every 15min): remind_at<=now の卡 → 受众へ响铃(零评论)。
    once=1回で消費クリア; daily=毎日1回(remind_fired_on 去重), 卡完成 or 解除まで继续。
    隐藏(hide)の卡は初回発火で snoozed_until=None → active 视图へ浮回。"""
    now = timezone.now()
    today = now_jst_date(now)
    due = Issue.objects.filter(remind_at__isnull=False, remind_at__lte=now).select_related(
        "project", "project__workspace", "state", "snoozed_by")
    fired = 0
    for i in due:
        try:
            done_card = bool(i.state_id and i.state.group in _DONE_GROUPS)
            if i.remind_intensity == "daily" and not done_card:
                if i.remind_fired_on == today:
                    continue  # 今天已响, 等明天
                _ring_reminder(i)
                _push_rt_invalidate(i)
                i.remind_fired_on = today
                if i.snoozed_until:
                    i.snoozed_until = None  # 隐藏卡浮回视图
                i.save(update_fields=["remind_fired_on", "snoozed_until", "updated_at"])
            else:
                if i.remind_intensity != "daily":  # once → 响一次; daily 但卡完成 → 静默
                    _ring_reminder(i)
                    _push_rt_invalidate(i)
                _clear_reminder(i)  # 消費清除
            fired += 1
        except Exception:
            logger.exception("reminder: issue %s 处理失败", i.id)
    logger.info("reminder_sweep: %s fired", fired)
    return fired


# ── P3-EVENT-RELIABILITY: 延时→Temporal 持久定时器(退役上面 reminder_sweep 15min 扫世界哨兵)──
# 设/改/清 → ai-bot /reminder/{set,clear} → hermes-wf ReminderWorkflow(NewTimer)。
# 到点 = Temporal timer → ai-bot ring_reminder op → v1 ring 端点 → ring_issue_reminder。
# 不丢→Temporal durable; 兜底 = 日次 reminder_reconcile(selfheal, 非 fire-poll)。
_AIBOT_URL = os.environ.get("AIBOT_URL", "http://host.docker.internal:8098").rstrip("/")
_CARDS_TOKEN = os.environ.get("CARDS_INTERNAL_TOKEN", "").strip()
_RT_INGEST_URL = os.environ.get("RT_INGEST_URL", "http://realtime-sse:7070/__rt/ingest")
_RT_INGEST_TOKEN = os.environ.get("RT_INGEST_TOKEN", "").strip()


def _push_rt_invalidate(i: Issue) -> None:
    """提醒響铃後に SSE 失效シグナルを push → 浏览器即 refreshNotifications → 看板卡自动变紫。
    失败=非致命(通知已落 DB, 次回 polling/刷新可拾)。"""
    if not _RT_INGEST_TOKEN or not i.project_id:
        return
    try:
        requests.post(
            _RT_INGEST_URL,
            headers={"X-RT-Token": _RT_INGEST_TOKEN},
            json={"project": str(i.project_id), "issues": [str(i.id)], "kind": "reminder"},
            timeout=3,
        )
    except Exception:
        logger.warning("reminder: SSE ingest push 失败(非致命)", exc_info=True)


def _schedule_reminder_workflow(i: Issue, slug: str) -> None:
    """設定/改期 → ai-bot /reminder/set(SignalWithStart 幂等: 不存在则起、存在则改期)。
    失敗=非致命(remind_at 仍在 SoR, 日次 reminder_reconcile 补投); ただし loud log。"""
    if not _CARDS_TOKEN or not i.remind_at:
        return
    try:
        r = requests.post(
            f"{_AIBOT_URL}/reminder/set",
            headers={"X-Cards-Token": _CARDS_TOKEN},
            json={"issue": str(i.id), "workspace_slug": slug, "project": str(i.project_id),
                  "remind_at_ms": int(i.remind_at.timestamp() * 1000),
                  "intensity": i.remind_intensity or "once"},
            timeout=8)
        if r.status_code != 200:
            logger.warning("reminder schedule %s → ai-bot http %s: %s", i.id, r.status_code, r.text[:160])
    except Exception:
        logger.warning("reminder schedule %s → ai-bot 失败(非致命, 日次对账兜底)", i.id, exc_info=True)


def _cancel_reminder_workflow(issue_id) -> None:
    """解除 → ai-bot /reminder/clear(cancel signal; workflow 不存在=非致命)。"""
    if not _CARDS_TOKEN:
        return
    try:
        requests.post(f"{_AIBOT_URL}/reminder/clear", headers={"X-Cards-Token": _CARDS_TOKEN},
                      json={"issue": str(issue_id)}, timeout=8)
    except Exception:
        logger.warning("reminder cancel %s → ai-bot 失败(非致命)", issue_id, exc_info=True)


def ring_issue_reminder(i: Issue) -> dict:
    """Temporal timer 到点回调(ai-bot v1 ring 端点 → ここ)。受众響铃(零评论)。
    once: 响铃→消費清除, repeat=False。
    daily(卡未完): 响铃(同日防重)+remind_at 推进次日, repeat=True+next_at_ms。卡完成→静默消費。
    改期到更晚(stale fire, remind_at>now+90s)→ 不响(新 timer 处理)。返 {rang, repeat, next_at_ms}。"""
    now = timezone.now()
    if not i.remind_at:
        return {"rang": False, "repeat": False, "next_at_ms": 0}
    if i.remind_at > now + timedelta(seconds=90):
        return {"rang": False, "repeat": False, "next_at_ms": 0}
    done_card = bool(i.state_id and i.state and i.state.group in _DONE_GROUPS)
    today = now_jst_date(now)
    if i.remind_intensity == "daily" and not done_card:
        rang = i.remind_fired_on != today
        if rang:
            _ring_reminder(i)
            _push_rt_invalidate(i)
        nxt = i.remind_at + timedelta(days=1)
        i.remind_fired_on = today
        i.remind_at = nxt
        i.snoozed_until = nxt if i.remind_hide else None
        i.save(update_fields=["remind_fired_on", "remind_at", "snoozed_until", "updated_at"])
        return {"rang": rang, "repeat": True, "next_at_ms": int(nxt.timestamp() * 1000)}
    rang = i.remind_intensity != "daily"
    if rang:
        _ring_reminder(i)
        _push_rt_invalidate(i)
    _clear_reminder(i)
    return {"rang": rang, "repeat": False, "next_at_ms": 0}


@shared_task
def reminder_reconcile():
    """日次 selfheal(P3 允许 selfheal, 禁 fire-sentinel; 绝不直接响铃): 确保每个未来 remind_at
    都有 Temporal ReminderWorkflow。SignalWithStart 幂等→重复无害。补 start 失败/存量/重启遗漏。
    到点响铃全靠 Temporal timer(durable)。这里只'确保 workflow 存在', 不复活扫世界响铃哨兵。"""
    now = timezone.now()
    future = Issue.objects.filter(remind_at__isnull=False, remind_at__gt=now).select_related(
        "project", "project__workspace")
    n = 0
    for i in future:
        try:
            slug = i.project.workspace.slug if i.project_id and i.project.workspace_id else ""
            _schedule_reminder_workflow(i, slug)
            n += 1
        except Exception:
            logger.exception("reminder_reconcile: %s 排程失败", i.id)
    logger.info("reminder_reconcile: %s ensured", n)
    return n
