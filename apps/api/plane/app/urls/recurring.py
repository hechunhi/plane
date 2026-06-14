# BARSOUL: 定期タスク / 周期任务 路由. 见 docs/architecture/recurring-tasks-mvp.md.
from django.urls import path

from plane.app.views import (
    RecurringRuleListEndpoint,
    RecurringRuleDetailEndpoint,
    RecurringRuleActionEndpoint,
    IssueRecurringContextEndpoint,
    IssueSnoozeEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/recurring/",
        IssueRecurringContextEndpoint.as_view(),
        name="issue-recurring-context",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/snooze/",
        IssueSnoozeEndpoint.as_view(),
        name="issue-snooze",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/recurring/",
        RecurringRuleListEndpoint.as_view(),
        name="recurring-rules",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/recurring/<uuid:rule_id>/",
        RecurringRuleDetailEndpoint.as_view(),
        name="recurring-rule-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/recurring/<uuid:rule_id>/action/",
        RecurringRuleActionEndpoint.as_view(),
        name="recurring-rule-action",
    ),
]
