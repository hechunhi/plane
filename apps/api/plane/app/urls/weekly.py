# BARSOUL 週次ミーティング支援 路由. 见 docs/architecture/weekly-report-mvp.md v2.
from django.urls import path

from plane.app.views import (
    ContentTranslateEndpoint,
    MeetingChatEndpoint,
    MeetingChatMessageEndpoint,
    MeetingChatReactionEndpoint,
    WeeklyMeetingActionEndpoint,
    WeeklyMeetingDetailEndpoint,
    WeeklyMeetingListEndpoint,
    WeeklyReportEntryEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/weekly-meetings/",
        WeeklyMeetingListEndpoint.as_view(),
        name="weekly-meetings",
    ),
    path(
        "workspaces/<str:slug>/weekly-meetings/<uuid:meeting_id>/",
        WeeklyMeetingDetailEndpoint.as_view(),
        name="weekly-meeting-detail",
    ),
    path(
        "workspaces/<str:slug>/weekly-meetings/<uuid:meeting_id>/action/",
        WeeklyMeetingActionEndpoint.as_view(),
        name="weekly-meeting-action",
    ),
    path(
        "workspaces/<str:slug>/weekly-meetings/<uuid:meeting_id>/entries/<uuid:entry_id>/",
        WeeklyReportEntryEndpoint.as_view(),
        name="weekly-report-entry",
    ),
    path(
        "workspaces/<str:slug>/weekly-meetings/<uuid:meeting_id>/chat/",
        MeetingChatEndpoint.as_view(),
        name="weekly-meeting-chat",
    ),
    path(
        "workspaces/<str:slug>/weekly-meetings/<uuid:meeting_id>/chat/<uuid:message_id>/",
        MeetingChatMessageEndpoint.as_view(),
        name="weekly-meeting-chat-message",
    ),
    path(
        "workspaces/<str:slug>/weekly-meetings/<uuid:meeting_id>/chat/<uuid:message_id>/reactions/",
        MeetingChatReactionEndpoint.as_view(),
        name="weekly-meeting-chat-reaction",
    ),
    path(
        "workspaces/<str:slug>/content-translate/",
        ContentTranslateEndpoint.as_view(),
        name="content-translate",
    ),
]
