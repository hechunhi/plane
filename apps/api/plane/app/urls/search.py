# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path


from plane.app.views import BarsoulSearchAskEndpoint, BarsoulSearchEndpoint, GlobalSearchEndpoint, IssueSearchEndpoint, SearchEndpoint


urlpatterns = [
    path(
        "workspaces/<str:slug>/search/",
        GlobalSearchEndpoint.as_view(),
        name="global-search",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/search-issues/",
        IssueSearchEndpoint.as_view(),
        name="project-issue-search",
    ),
    path(
        "workspaces/<str:slug>/entity-search/",
        SearchEndpoint.as_view(),
        name="entity-search",
    ),
    # BARSOUL 2026-10-08: 全屏搜索浮层(关键字+语义混合, 权限在服务端过滤)
    path(
        "workspaces/<str:slug>/barsoul-search/",
        BarsoulSearchEndpoint.as_view(),
        name="barsoul-search",
    ),
    # BARSOUL 2026-10-08 P1: 问爱酱(只读问答, 带出处)
    path(
        "workspaces/<str:slug>/barsoul-search/ask/",
        BarsoulSearchAskEndpoint.as_view(),
        name="barsoul-search-ask",
    ),
]
