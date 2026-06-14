# BARSOUL: 定期タスク / 周期任务 REST. 见 docs/architecture/recurring-tasks-mvp.md.
# 规则 CRUD + 今すぐ生成 / 次回スキップ / 一時停止。绝不写他域 SoR; 只动自有 recurring_rules + 经 Beat 引擎建卡。
import logging

from rest_framework.response import Response
from rest_framework import status

from datetime import datetime, timedelta

from plane.app.views.base import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import Issue, Project, RecurringRule
from plane.bgtasks.recurring_task import run_rule_now, seed_next_run
from plane.utils.recurring import add_working_days, now_jst_date, period_label, snooze_datetime_utc
from django.utils import timezone

logger = logging.getLogger(__name__)

_CADENCES = {"weekly", "monthly", "quarterly", "yearly"}
_DONE_GROUPS = ("completed", "cancelled")
_EDITABLE = ("name", "cadence", "anchor", "lead_days", "labels", "template", "blueprint_id", "assignee_id")
_SCHED_FIELDS = ("cadence", "anchor", "lead_days")  # 改这些 → 重算 next_run


def _ws_id(slug, project_id):
    return Project.objects.values_list("workspace_id", flat=True).get(pk=project_id, workspace__slug=slug)


def _next_due(rule):
    """从 next_run_at(生成日)还原本/下期的「期日」。两列分明: 作成日 ≠ 期日(信任命门)。"""
    if not rule.next_run_at:
        return None
    from datetime import timedelta
    from plane.utils.recurring import JST
    gen_date = rule.next_run_at.astimezone(JST).date()
    return gen_date + timedelta(days=max(0, rule.lead_days))  # due = 生成日 + lead(精确)


def _derived_state(rule, today):
    if rule.status == "paused":
        return "paused"
    if rule.status == "archived":
        return "archived"
    li = rule.last_generated_issue
    if li and li.state_id and li.state.group not in _DONE_GROUPS:
        if li.target_date and li.target_date < today:
            return "attention"  # 要対応(逾期未完)
        return "inflight"  # 進行中
    return "active"  # 有効, 待下次生成


def _rule_json(rule, today):
    due = _next_due(rule)
    a = rule.assignee
    li = rule.last_generated_issue
    return {
        "id": str(rule.id),
        "name": rule.name,
        "cadence": rule.cadence,
        "anchor": rule.anchor or {},
        "lead_days": rule.lead_days,
        "status": rule.status,
        "skip_next": bool(rule.skip_next),
        "assignee": {"id": str(a.id), "display_name": a.display_name} if a else None,
        "labels": list(rule.labels or []),
        "template": rule.template or {},
        "blueprint": str(rule.blueprint_id) if rule.blueprint_id else None,
        "next_run_at": rule.next_run_at.isoformat() if rule.next_run_at else None,
        "next_due": due.isoformat() if due else None,
        "period_label": period_label(rule.cadence, rule.anchor or {}, due) if due else None,
        "derived_state": _derived_state(rule, today),
        "fail_count": rule.fail_count,
        "last_issue": ({
            "id": str(li.id), "name": li.name, "sequence_id": li.sequence_id,
            "identifier": li.project.identifier, "state_group": li.state.group if li.state_id else None,
            "target_date": li.target_date.isoformat() if li.target_date else None,
        } if li else None),
    }


def _validate(data):
    cad = (data or {}).get("cadence")
    if cad and cad not in _CADENCES:
        return f"cadence 非法: {cad}"
    if "lead_days" in (data or {}):
        try:
            n = int(data["lead_days"])
            if n < 0 or n > 60:
                return "lead_days 须 0..60"
        except (TypeError, ValueError):
            return "lead_days 非数字"
    return None


class RecurringRuleListEndpoint(BaseAPIView):
    """GET/POST /workspaces/{slug}/projects/{pid}/recurring/"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        today = now_jst_date(timezone.now())
        qs = (RecurringRule.objects.filter(project_id=project_id, workspace__slug=slug)
              .exclude(status="archived")
              .select_related("assignee", "project", "last_generated_issue", "last_generated_issue__state",
                              "last_generated_issue__project")
              .order_by("name"))
        return Response([_rule_json(r, today) for r in qs], status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        data = request.data or {}
        name = (data.get("name") or "").strip()[:255]
        if not name:
            return Response({"error": "name required"}, status=status.HTTP_400_BAD_REQUEST)
        err = _validate(data)
        if err:
            return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)
        uid = request.user.id if request.user.is_authenticated else None
        rule = RecurringRule(
            name=name, cadence=data.get("cadence") or "monthly", anchor=data.get("anchor") or {},
            lead_days=int(data.get("lead_days") or 0), labels=data.get("labels") or [],
            template=data.get("template") or {}, assignee_id=data.get("assignee_id") or None,
            blueprint_id=data.get("blueprint_id") or None,
            project_id=project_id, workspace_id=_ws_id(slug, project_id),
            created_by_id=uid, updated_by_id=uid)
        rule.save()
        seed_next_run(rule)  # 算出次回生成时刻
        today = now_jst_date(timezone.now())
        return Response(_rule_json(rule, today), status=status.HTTP_201_CREATED)


class RecurringRuleDetailEndpoint(BaseAPIView):
    """PATCH/DELETE /workspaces/{slug}/projects/{pid}/recurring/{rid}/"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, rule_id):
        data = request.data or {}
        err = _validate(data)
        if err:
            return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)
        rule = RecurringRule.objects.get(pk=rule_id, project_id=project_id, workspace__slug=slug)
        changed = []
        for f in _EDITABLE:
            key = f
            if key in data:
                setattr(rule, f, data[key])
                changed.append(f)
        if "name" in data:
            rule.name = (data["name"] or "").strip()[:255]
        rule.updated_by_id = request.user.id if request.user.is_authenticated else None
        rule.save()
        # 改了排程字段 → 重算 next_run(默认「次回から適用」, 不动在途卡)
        if any(c in _SCHED_FIELDS for c in changed):
            seed_next_run(rule)
        today = now_jst_date(timezone.now())
        return Response(_rule_json(rule, today), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, rule_id):
        # 软删(deleted_at)。已生成的在途卡不动(独立 SoR)。objects 管理器自动排软删行。
        rule = RecurringRule.objects.get(pk=rule_id, project_id=project_id, workspace__slug=slug)
        rule.status = "archived"
        rule.save(update_fields=["status", "updated_at"])
        rule.delete()  # SoftDeleteModel.delete 默认 soft=True → 置 deleted_at
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueRecurringContextEndpoint(BaseAPIView):
    """GET /workspaces/{slug}/projects/{pid}/issues/{iid}/recurring/ — 卡若是某规则的当前实例 → 返规则+次回(卡顶上下文条回链)。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        rule = (RecurringRule.objects.filter(last_generated_issue_id=issue_id, project_id=project_id, workspace__slug=slug)
                .select_related("project").first())
        if not rule:
            return Response({"recurring": False}, status=status.HTTP_200_OK)
        today = now_jst_date(timezone.now())
        due = _next_due(rule)
        return Response({
            "recurring": True,
            "rule": {
                "id": str(rule.id), "name": rule.name, "cadence": rule.cadence,
                "cadence_label": _cadence_short(rule),
                "next_due": due.isoformat() if due else None,
                "period_label": period_label(rule.cadence, rule.anchor or {}, due) if due else None,
                "status": rule.status,
                "derived_state": _derived_state(rule, today),
            },
        }, status=status.HTTP_200_OK)


def _cadence_short(rule):
    c = rule.cadence
    a = rule.anchor or {}
    if c == "weekly":
        return "毎週"
    if c == "monthly":
        return "毎月末" if a.get("mode") == "eom" else "毎月初" if a.get("mode") == "bom" else f"毎月{a.get('day', 1)}日"
    if c == "quarterly":
        return "四半期"
    return "毎年"


def _snooze_target(preset, until, today):
    """preset/绝対日 → JST 目标日。营业日跳周末。"""
    if until:
        try:
            return datetime.strptime(until, "%Y-%m-%d").date()
        except ValueError:
            return None
    if preset == "tomorrow":
        return today + timedelta(days=1)
    if preset == "biz2":
        return add_working_days(today, 2)
    if preset == "next_mon":
        delta = (1 - today.isoweekday()) % 7 or 7
        return today + timedelta(days=delta)
    if preset == "week1":
        return today + timedelta(days=7)
    return None


class IssueSnoozeEndpoint(BaseAPIView):
    """フォローアップ・スヌーズ: GET 当前状态 / POST 设置·清除。
    设置 → snoozed_until>now 使卡从 active 视图隐藏(IssueManager), 到点自动复活 + Beat 1 回ベル(零评论)。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        i = Issue.objects.select_related("snoozed_by").get(pk=issue_id, project_id=project_id, workspace__slug=slug)
        if not i.snoozed_until:
            return Response({"snoozed": False}, status=status.HTTP_200_OK)
        return Response({
            "snoozed": True,
            "until": i.snoozed_until.isoformat(),
            "until_date": now_jst_date(i.snoozed_until).isoformat(),  # JST 日界の対象日
            "by": {"id": str(i.snoozed_by_id), "display_name": i.snoozed_by.display_name} if i.snoozed_by_id else None,
        }, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, issue_id):
        i = Issue.objects.get(pk=issue_id, project_id=project_id, workspace__slug=slug)
        data = request.data or {}
        if data.get("clear"):
            i.snoozed_until = None
            i.snoozed_by = None
            i.save(update_fields=["snoozed_until", "snoozed_by", "updated_at"])
            return Response({"snoozed": False}, status=status.HTTP_200_OK)
        today = now_jst_date(timezone.now())
        target = _snooze_target(data.get("preset"), data.get("until"), today)
        if not target or target <= today:
            return Response({"error": "未来の日付を指定してください"}, status=status.HTTP_400_BAD_REQUEST)
        i.snoozed_until = snooze_datetime_utc(target)
        i.snoozed_by_id = request.user.id if request.user.is_authenticated else None
        i.save(update_fields=["snoozed_until", "snoozed_by", "updated_at"])
        return Response({"snoozed": True, "until": i.snoozed_until.isoformat(), "until_date": target.isoformat()},
                        status=status.HTTP_200_OK)


class RecurringRuleActionEndpoint(BaseAPIView):
    """POST /workspaces/{slug}/projects/{pid}/recurring/{rid}/action/ — {action: run_now|skip_next|pause|resume}"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, rule_id):
        action = (request.data or {}).get("action")
        rule = RecurringRule.objects.select_related("project", "project__workspace", "last_generated_issue",
                                                    "last_generated_issue__state").get(
            pk=rule_id, project_id=project_id, workspace__slug=slug)
        if action == "run_now":
            try:
                run_rule_now(rule)
            except Exception:
                logger.exception("recurring run_now failed rule %s", rule.id)
                return Response({"error": "生成に失敗しました"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        elif action == "skip_next":
            rule.skip_next = True
            rule.save(update_fields=["skip_next", "updated_at"])
        elif action == "pause":
            rule.status = "paused"
            rule.save(update_fields=["status", "updated_at"])
        elif action == "resume":
            rule.status = "active"
            rule.save(update_fields=["status", "updated_at"])
            seed_next_run(rule)
        else:
            return Response({"error": f"unknown action: {action}"}, status=status.HTTP_400_BAD_REQUEST)
        rule.refresh_from_db()
        today = now_jst_date(timezone.now())
        return Response(_rule_json(rule, today), status=status.HTTP_200_OK)
