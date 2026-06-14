# BARSOUL: Blueprint 业务蓝图 路由. 见 docs/architecture/blueprint-mvp.md.
from django.urls import path

from plane.app.views import (
    BlueprintListEndpoint,
    BlueprintDetailEndpoint,
    BlueprintPublishEndpoint,
    BlueprintInstancesEndpoint,
    BlueprintInstantiateEndpoint,
    IssueBlueprintInstanceEndpoint,
    IssueFlowInterveneEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/blueprints/",
        BlueprintListEndpoint.as_view(),
        name="blueprints",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/blueprints/<uuid:blueprint_id>/",
        BlueprintDetailEndpoint.as_view(),
        name="blueprint-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/blueprints/<uuid:blueprint_id>/publish/",
        BlueprintPublishEndpoint.as_view(),
        name="blueprint-publish",
    ),
    path(
        # 注意: 路径绝不能含子串 "instances" — 上游 session 中间件按子串切 admin 会话
        # (authentication/middleware/session.py)会把普通用户打成匿名 401 → 前端整页跳登录。
        "workspaces/<str:slug>/projects/<uuid:project_id>/blueprints/<uuid:blueprint_id>/runs/",
        BlueprintInstancesEndpoint.as_view(),
        name="blueprint-runs",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/blueprints/<uuid:blueprint_id>/instantiate/",
        BlueprintInstantiateEndpoint.as_view(),
        name="blueprint-instantiate",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/blueprint-instance/",
        IssueBlueprintInstanceEndpoint.as_view(),
        name="issue-blueprint-instance",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/flow-intervene/",
        IssueFlowInterveneEndpoint.as_view(),
        name="issue-flow-intervene",
    ),
]
