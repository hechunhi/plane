# BARSOUL: 定期タスク / 周期任务(IUTEYA-15)— 声明式规则, 引用既有引擎(Plane Issue + Celery Beat)。
# 见 docs/architecture/recurring-tasks-mvp.md。不是新引擎/不建独立状态机表(护栏):
#   - 引擎 = Celery Beat 每日扫描(非 Temporal, CONSTITUTION §IV.1: 幂等 CRUD 不配 workflow)。
#   - pending/carryover 不落字段, 读时从 last_generated_issue.state.group 派生(同 DIS 投影思路)。
#   - anchor 存语义(EOM/day=N/quarter_start), 求值在 JST; 绝不存死日期 → 月末/小月/2月不漏触发。
from django.db import models

from .project import ProjectBaseModel


class RecurringRule(ProjectBaseModel):
    """一条周期规则。到期前 lead_days 天由 Beat 生成一张普通卡; 上期未完则顺延同卡(不出新卡)。"""

    CADENCE_CHOICES = [
        ("weekly", "weekly"),
        ("monthly", "monthly"),
        ("quarterly", "quarterly"),
        ("yearly", "yearly"),
    ]
    STATUS_CHOICES = [
        ("active", "active"),
        ("paused", "paused"),
        ("archived", "archived"),
    ]

    name = models.CharField(max_length=255)  # 规则名(=生成卡基名), 命名人读 `{name}(6月分)`
    cadence = models.CharField(max_length=12, choices=CADENCE_CHOICES, default="monthly")
    # anchor: 语义锚点, 在 JST 求值。形如:
    #   weekly    -> {"weekdays": [1..7]}            (1=月曜)
    #   monthly   -> {"mode": "day"|"eom"|"bom", "day": N}   (eom=月末, bom=月初/1日)
    #   quarterly -> {"start_month": 1..12, "mode": "eom"|"day", "day": N}
    #   yearly    -> {"month": 1..12, "day": N}
    anchor = models.JSONField(default=dict, blank=True)
    lead_days = models.PositiveSmallIntegerField(default=0)  # 期日前几天生成卡(0=当天); 短周期默认 0

    assignee = models.ForeignKey(
        "db.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="recurring_assigned"
    )  # null = 未認領(团队任务): 生成卡进未指派 + @全员一次, 谁做谁认领
    labels = models.JSONField(default=list, blank=True)  # 生成卡套用的 label id 快照
    template = models.JSONField(default=dict, blank=True)  # {title?, description_html, priority, checklist?}
    blueprint = models.ForeignKey(
        "db.Blueprint", on_delete=models.SET_NULL, null=True, blank=True, related_name="recurring_rules"
    )  # 可选: 要台账的罕见场景, 生成时实例化该蓝图而非建普通卡

    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="active")
    skip_next = models.BooleanField(default=False)  # 「次回をスキップ」: 跳过下一个生成点一次

    next_run_at = models.DateTimeField(null=True, blank=True)  # 下次生成时刻(UTC, 由 anchor−lead 在 JST 求值再转)
    last_period_key = models.CharField(max_length=24, blank=True, default="")  # 幂等去重键, 如 "2026-06" / "2026-Q2"
    last_generated_issue = models.ForeignKey(
        "db.Issue", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )  # 最近生成的实例(在途判定 + 顺延对象); +=不建反向关系
    last_run_at = models.DateTimeField(null=True, blank=True)
    fail_count = models.PositiveSmallIntegerField(default=0)  # 连续生成失败数 → 达阈值反向通知创建者
    # 逾期升级幂等: 已推过 D+3「要対応」铃铛的实例 id(每实例最多 1 次, 防通知疲劳)。新卡=新 id 自然重置。
    overdue_pushed_issue = models.CharField(max_length=36, blank=True, default="")

    class Meta:
        verbose_name = "Recurring Rule"
        verbose_name_plural = "Recurring Rules"
        db_table = "recurring_rules"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["project"]),
            models.Index(fields=["status", "next_run_at"]),  # Beat 扫描: status=active AND next_run_at<=now
        ]

    def __str__(self):
        return f"{self.name}({self.cadence})"
