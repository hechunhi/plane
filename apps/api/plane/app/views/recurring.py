# BARSOUL: 定期タスク / 周期任务 REST. 见 docs/architecture/recurring-tasks-mvp.md.
# 规则 CRUD + 今すぐ生成 / 次回スキップ / 一時停止。绝不写他域 SoR; 只动自有 recurring_rules + 经 Beat 引擎建卡。
import logging

from rest_framework.response import Response
from rest_framework import status

from datetime import datetime, timedelta, time as _time

from plane.app.views.base import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import Issue, Notification, Project, RecurringRule
from plane.bgtasks.recurring_task import run_rule_now, seed_next_run
from plane.utils.recurring import JST, add_working_days, now_jst_date, period_label, snooze_datetime_utc
from django.utils import timezone
from django.db.models import Q

logger = logging.getLogger(__name__)

_CADENCES = {"weekly", "monthly", "quarterly", "yearly"}
_DONE_GROUPS = ("completed", "cancelled")
_EDITABLE = ("name", "cadence", "anchor", "lead_days", "labels", "template", "blueprint_id", "assignee_id", "generation_prompt")
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
        "generation_prompt": rule.generation_prompt or "",
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
            generation_prompt=(data.get("generation_prompt") or "").strip(),
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


def _remind_at_utc(data, issue, today):
    """触发 UTC 时刻。优先级: at(ISO 绝対) > lead_days(相对 target_date) > preset/until(日付)。
    日付指定时の時刻 = time(hh:mm JST, 既定 09:00)。"""
    at = (data.get("at") or "").strip()
    if at:
        try:
            dt = datetime.fromisoformat(at.replace("Z", "+00:00"))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=JST)  # 前端裸时间按 JST
        return dt.astimezone(timezone.utc)
    hh, mm = 9, 0
    tt = (data.get("time") or "").strip()
    if tt:
        try:
            ps = tt.split(":")
            hh, mm = int(ps[0]), (int(ps[1]) if len(ps) > 1 else 0)
        except (ValueError, IndexError):
            hh, mm = 9, 0
    target = None
    lead = data.get("lead_days")
    if lead is not None and getattr(issue, "target_date", None):
        try:
            base = issue.target_date
            base = base.date() if hasattr(base, "date") else base
            target = base - timedelta(days=int(lead))
        except (ValueError, TypeError):
            target = None
    if target is None:
        target = _snooze_target(data.get("preset"), data.get("until"), today)
    if not target:
        return None
    return datetime.combine(target, _time(hh, mm), tzinfo=JST).astimezone(timezone.utc)


class IssueSnoozeEndpoint(BaseAPIView):
    """リマインダー(旧スヌーズ強化): GET 当前配置 / POST 设置·清除。
    可配置: 何时(at/preset/lead_days+time) · 是否隐藏(hide) · 强度(once/daily) · 受众(self/assignees/members)。
    hide=True → snoozed_until 使卡从 active 视图隐藏(IssueManager); hide=False → 卡留视图(前端显徽章)。
    到点由高频 Beat(reminder_sweep)给受众响铃(零评论); daily=每日续提醒至卡完成或解除。"""

    def _can_team_hide(self, i, request, slug, project_id):
        """カードを「全員から」盤面から消せるのは作成者 or プロジェクト/WS 管理者のみ。
        (誰でも他人のカードを隠せるのは不合理 — hechun 2026-06-21)。"""
        if i.created_by_id is not None and i.created_by_id == request.user.id:
            return True
        from plane.db.models import ProjectMember, WorkspaceMember
        return ProjectMember.objects.filter(
            project_id=project_id, member=request.user,
            role=ROLE.ADMIN.value, is_active=True,
        ).exists() or WorkspaceMember.objects.filter(
            workspace__slug=slug, member=request.user,
            role=ROLE.ADMIN.value, is_active=True,
        ).exists()

    def _state(self, i):
        if not i.remind_at:
            return {"set": False}
        return {
            "set": True,
            "at": i.remind_at.isoformat(),
            "at_date": now_jst_date(i.remind_at).isoformat(),
            "at_jst": i.remind_at.astimezone(JST).strftime("%Y-%m-%d %H:%M"),
            "hide": bool(i.remind_hide),
            "intensity": i.remind_intensity or "once",
            "audience": i.remind_audience or "self",
            "note": i.remind_note or "",
            "by": {"id": str(i.snoozed_by_id), "display_name": i.snoozed_by.display_name} if i.snoozed_by_id else None,
        }

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        i = Issue.objects.select_related("snoozed_by").get(pk=issue_id, project_id=project_id, workspace__slug=slug)
        can_hide = self._can_team_hide(i, request, slug, project_id)
        if i.remind_at:
            audience = i.remind_audience or "self"
            uid = request.user.id
            if audience == "self" and i.snoozed_by_id != uid:
                return Response({"set": False, "can_hide": can_hide}, status=status.HTTP_200_OK)
            if audience == "assignees" and i.snoozed_by_id != uid:
                from plane.db.models import IssueAssignee
                if not IssueAssignee.objects.filter(issue_id=issue_id, assignee_id=uid).exists():
                    return Response({"set": False, "can_hide": can_hide}, status=status.HTTP_200_OK)
        state = self._state(i)
        state["can_hide"] = can_hide
        return Response(state, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, issue_id):
        i = Issue.objects.select_related("snoozed_by").get(pk=issue_id, project_id=project_id, workspace__slug=slug)
        data = request.data or {}
        fields = ["snoozed_until", "snoozed_by", "remind_at", "remind_hide",
                  "remind_intensity", "remind_audience", "remind_note", "remind_fired_on", "updated_at"]
        if data.get("clear"):
            i.snoozed_until = None; i.snoozed_by = None; i.remind_at = None
            i.remind_hide = False; i.remind_intensity = "once"; i.remind_audience = "self"
            i.remind_note = ""; i.remind_fired_on = None
            i.save(update_fields=fields)
            # P3: 解除 → 取消 Temporal ReminderWorkflow(cancel signal)
            from plane.bgtasks.recurring_task import _cancel_reminder_workflow
            _cancel_reminder_workflow(issue_id)
            return Response(
                {"set": False, "can_hide": self._can_team_hide(i, request, slug, project_id)},
                status=status.HTTP_200_OK,
            )
        remind_at = _remind_at_utc(data, i, now_jst_date(timezone.now()))
        if not remind_at or remind_at <= timezone.now():
            return Response({"error": "未来の日時を指定してください"}, status=status.HTTP_400_BAD_REQUEST)
        hide = bool(data.get("hide"))
        # BARSOUL 2026-06-21: カードを「全員から」隠す減算的権力は作成者 or プロジェクト/WS 管理者のみ。
        # (誰でも他人のカードを盤面から消せると不合理 — hechun)。個人専用の非表示(自分だけ)は別表が要る別機能で後回し。
        # 既に非表示のカード(remind_hide)を別の人が編集(時刻変更等)して hide を保つのは許可 — 新規に隠す遷移だけを gate。
        if hide and not i.remind_hide and not self._can_team_hide(i, request, slug, project_id):
            return Response(
                {"error": "カードを全員から隠せるのは作成者またはプロジェクト管理者のみです"},
                status=status.HTTP_403_FORBIDDEN,
            )
        intensity = data.get("intensity") if data.get("intensity") in ("once", "daily") else "once"
        audience = data.get("audience") if data.get("audience") in ("self", "assignees", "members") else "self"
        # 新 remind_at 設定時に既存の未読提醒通知を削除 — 即リフレッシュで紫が出ないよう。
        Notification.objects.filter(
            entity_identifier=issue_id,
            entity_name="issue",
            sender="reminder",
            read_at__isnull=True,
            archived_at__isnull=True,
        ).delete()
        i.remind_at = remind_at
        i.remind_hide = hide
        i.remind_intensity = intensity
        i.remind_audience = audience
        i.remind_note = (data.get("note") or "").strip()[:200]
        i.remind_fired_on = None
        i.snoozed_until = remind_at if hide else None  # 隐藏驱动: 只有 hide 才进 IssueManager 过滤
        i.snoozed_by_id = request.user.id if request.user.is_authenticated else None
        i.save(update_fields=fields)
        # P3: 设/改提醒 → 排 Temporal 持久定时器(ai-bot /reminder/set, SignalWithStart 幂等改期)
        from plane.bgtasks.recurring_task import _schedule_reminder_workflow
        _schedule_reminder_workflow(i, slug)
        i = Issue.objects.select_related("snoozed_by").get(pk=i.pk)
        state = self._state(i)
        state["can_hide"] = self._can_team_hide(i, request, slug, project_id)
        return Response(state, status=status.HTTP_200_OK)


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


class MyRemindersEndpoint(BaseAPIView):
    """GET /workspaces/{slug}/reminders/ — 我的待回来提醒(我设的 + 指派给我且受众含我)。
    按 remind_at 升序; hub「リマインダー」用。隐藏卡也列在这(直链可开)。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        uid = request.user.id
        qs = (Issue.objects.filter(workspace__slug=slug, remind_at__isnull=False, deleted_at__isnull=True)
              .filter(Q(snoozed_by_id=uid) | Q(assignees__id=uid, remind_audience__in=["assignees", "members"]))
              .select_related("project", "state").distinct().order_by("remind_at"))
        out = []
        for i in qs[:200]:
            out.append({
                "id": str(i.id), "name": i.name, "sequence_id": i.sequence_id,
                "project_id": str(i.project_id), "project_identifier": i.project.identifier,
                "at": i.remind_at.isoformat(),
                "at_jst": i.remind_at.astimezone(JST).strftime("%Y-%m-%d %H:%M"),
                "at_date": now_jst_date(i.remind_at).isoformat(),
                "note": i.remind_note or "", "hide": bool(i.remind_hide),
                "intensity": i.remind_intensity or "once", "audience": i.remind_audience or "self",
                "state_group": i.state.group if i.state_id else None,
                "mine": str(i.snoozed_by_id) == str(uid) if i.snoozed_by_id else False,
            })
        return Response(out, status=status.HTTP_200_OK)
