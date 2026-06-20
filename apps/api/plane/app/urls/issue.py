# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import (
    BulkCreateIssueLabelsEndpoint,
    BulkDeleteIssuesEndpoint,
    SubIssuesEndpoint,
    IssueLinkViewSet,
    IssueAttachmentEndpoint,
    CommentReactionViewSet,
    CommentTranslateOnDemandEndpoint,
    IssueTranslateOnDemandEndpoint,
    IssueAIApprovalEndpoint,
    IssueAIStateBatchEndpoint,
    IssueAIStateCorrectEndpoint,
    IssueAIStateTranslateEndpoint,
    IssueAIStateRederiveEndpoint,
    IssueAIStateUrgeEndpoint,
    IssueActivityEndpoint,
    IssueArchiveViewSet,
    IssueCommentViewSet,
    IssueListEndpoint,
    IssueReactionViewSet,
    IssueRelationViewSet,
    IssueSubscriberViewSet,
    ProjectUserDisplayPropertyEndpoint,
    IssueViewSet,
    LabelViewSet,
    BulkArchiveIssuesEndpoint,
    DeletedIssuesListViewSet,
    IssuePaginatedViewSet,
    IssueDetailEndpoint,
    IssueAttachmentV2Endpoint,
    IssueBulkUpdateDateEndpoint,
    IssueVersionEndpoint,
    WorkItemDescriptionVersionEndpoint,
    IssueMetaEndpoint,
    IssueDetailIdentifierEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/list/",
        IssueListEndpoint.as_view(),
        name="project-issue",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/",
        IssueViewSet.as_view({"get": "list", "post": "create"}),
        name="project-issue",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues-detail/",
        IssueDetailEndpoint.as_view(),
        name="project-issue-detail",
    ),
    # updated v1 paginated issues
    # updated v2 paginated issues
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/v2/issues/",
        IssuePaginatedViewSet.as_view({"get": "list"}),
        name="project-issues-paginated",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:pk>/",
        IssueViewSet.as_view(
            {
                "get": "retrieve",
                "put": "update",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project-issue",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issue-labels/",
        LabelViewSet.as_view({"get": "list", "post": "create"}),
        name="project-issue-labels",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issue-labels/<uuid:pk>/",
        LabelViewSet.as_view(
            {
                "get": "retrieve",
                "put": "update",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project-issue-labels",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/bulk-create-labels/",
        BulkCreateIssueLabelsEndpoint.as_view(),
        name="project-bulk-labels",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/bulk-delete-issues/",
        BulkDeleteIssuesEndpoint.as_view(),
        name="project-issues-bulk",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/bulk-archive-issues/",
        BulkArchiveIssuesEndpoint.as_view(),
        name="bulk-archive-issues",
    ),
    ##
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/sub-issues/",
        SubIssuesEndpoint.as_view(),
        name="sub-issues",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-links/",
        IssueLinkViewSet.as_view({"get": "list", "post": "create"}),
        name="project-issue-links",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-links/<uuid:pk>/",
        IssueLinkViewSet.as_view(
            {
                "get": "retrieve",
                "put": "update",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project-issue-links",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-attachments/",
        IssueAttachmentEndpoint.as_view(),
        name="project-issue-attachments",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-attachments/<uuid:pk>/",
        IssueAttachmentEndpoint.as_view(),
        name="project-issue-attachments",
    ),
    # V2 Attachments
    path(
        "assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/attachments/",
        IssueAttachmentV2Endpoint.as_view(),
        name="project-issue-attachments",
    ),
    path(
        "assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/attachments/<uuid:pk>/",
        IssueAttachmentV2Endpoint.as_view(),
        name="project-issue-attachments",
    ),
    ## End Issues
    ## Issue Activity
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/history/",
        IssueActivityEndpoint.as_view(),
        name="project-issue-history",
    ),
    ## Issue Activity
    ## IssueComments
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/comments/",
        IssueCommentViewSet.as_view({"get": "list", "post": "create"}),
        name="project-issue-comment",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/comments/<uuid:pk>/",
        IssueCommentViewSet.as_view(
            {
                "get": "retrieve",
                "put": "update",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project-issue-comment",
    ),
    # BARSOUL: X-style 即点即译 endpoint(cookie auth, project member)
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/comments/<uuid:comment_id>/translate/",
        CommentTranslateOnDemandEndpoint.as_view(),
        name="project-issue-comment-translate",
    ),
    # BARSOUL 2026-06-15: 卡片标题/正文 即点即译(display-only, 不改原内容)
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/translate/",
        IssueTranslateOnDemandEndpoint.as_view(),
        name="project-issue-translate",
    ),
    # BARSOUL 2026-06-06: Plane 原生发起审批(爱酱图标/表单 → 认证代理 → ai-bot → Temporal)
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/ai-approval/",
        IssueAIApprovalEndpoint.as_view(),
        name="project-issue-ai-approval",
    ),
    ## End IssueComments
    # BARSOUL: 派生卡片当前态 (DIS) 批量读取(看板卡顶状态行, cookie auth, project member)
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/ai-states/",
        IssueAIStateBatchEndpoint.as_view(),
        name="project-issue-ai-states",
    ),
    # BARSOUL DIS: 人工纠正/补充(向 AI 补足背景 → 双语留痕 + 触发重判)
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/ai-state/correct/",
        IssueAIStateCorrectEndpoint.as_view(),
        name="project-issue-ai-state-correct",
    ),
    # BARSOUL DIS: 引用依据按需翻译(语言≠阅览者时,走 ai-bot 与评论区同款翻译)
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/ai-state/translate/",
        IssueAIStateTranslateEndpoint.as_view(),
        name="project-issue-ai-state-translate",
    ),
    # BARSOUL DIS: 手动再分析(仅重算派生表,不碰 SoR)
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/ai-state/rederive/",
        IssueAIStateRederiveEndpoint.as_view(),
        name="project-issue-ai-state-rederive",
    ),
    # BARSOUL DIS: 以 愛ちゃん 名义催促(@当前行动人,发评论;不碰 SoR)
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/ai-state/urge/",
        IssueAIStateUrgeEndpoint.as_view(),
        name="project-issue-ai-state-urge",
    ),
    # Issue Subscribers
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-subscribers/",
        IssueSubscriberViewSet.as_view({"get": "list", "post": "create"}),
        name="project-issue-subscribers",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-subscribers/<uuid:subscriber_id>/",
        IssueSubscriberViewSet.as_view({"delete": "destroy"}),
        name="project-issue-subscribers",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/subscribe/",
        IssueSubscriberViewSet.as_view({"get": "subscription_status", "post": "subscribe", "delete": "unsubscribe"}),
        name="project-issue-subscribers",
    ),
    ## End Issue Subscribers
    # Issue Reactions
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/reactions/",
        IssueReactionViewSet.as_view({"get": "list", "post": "create"}),
        name="project-issue-reactions",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/reactions/<str:reaction_code>/",
        IssueReactionViewSet.as_view({"delete": "destroy"}),
        name="project-issue-reactions",
    ),
    ## End Issue Reactions
    # Comment Reactions
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/comments/<uuid:comment_id>/reactions/",
        CommentReactionViewSet.as_view({"get": "list", "post": "create"}),
        name="project-issue-comment-reactions",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/comments/<uuid:comment_id>/reactions/<str:reaction_code>/",
        CommentReactionViewSet.as_view({"delete": "destroy"}),
        name="project-issue-comment-reactions",
    ),
    ## End Comment Reactions
    ## ProjectUserProperty
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/user-properties/",
        ProjectUserDisplayPropertyEndpoint.as_view(),
        name="project-issue-display-properties",
    ),
    ## ProjectUserProperty End
    ## Issue Archives
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/archived-issues/",
        IssueArchiveViewSet.as_view({"get": "list"}),
        name="project-issue-archive",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:pk>/archive/",
        IssueArchiveViewSet.as_view({"get": "retrieve", "post": "archive", "delete": "unarchive"}),
        name="project-issue-archive-unarchive",
    ),
    ## End Issue Archives
    ## Issue Relation
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-relation/",
        IssueRelationViewSet.as_view({"get": "list", "post": "create"}),
        name="issue-relation",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/remove-relation/",
        IssueRelationViewSet.as_view({"post": "remove_relation"}),
        name="issue-relation",
    ),
    ## End Issue Relation
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/deleted-issues/",
        DeletedIssuesListViewSet.as_view(),
        name="deleted-issues",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issue-dates/",
        IssueBulkUpdateDateEndpoint.as_view(),
        name="project-issue-dates",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/versions/",
        IssueVersionEndpoint.as_view(),
        name="issue-versions",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/versions/<uuid:pk>/",
        IssueVersionEndpoint.as_view(),
        name="issue-versions",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:work_item_id>/description-versions/",
        WorkItemDescriptionVersionEndpoint.as_view(),
        name="work-item-versions",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:work_item_id>/description-versions/<uuid:pk>/",
        WorkItemDescriptionVersionEndpoint.as_view(),
        name="work-item-versions",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/meta/",
        IssueMetaEndpoint.as_view(),
        name="issue-meta",
    ),
    path(
        "workspaces/<str:slug>/work-items/<str:project_identifier>-<str:issue_identifier>/",
        IssueDetailIdentifierEndpoint.as_view(),
        name="issue-detail-identifier",
    ),
]
