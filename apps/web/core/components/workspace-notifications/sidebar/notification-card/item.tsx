/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Clock, AlarmClock, Repeat } from "lucide-react";
// plane imports
import { Avatar, Row } from "@plane/ui";
import { cn, calculateTimeAgo, renderFormattedDate, renderFormattedTime, getFileURL } from "@plane/utils";
// hooks
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { useNotification } from "@/hooks/store/notifications/use-notification";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useWorkspace } from "@/hooks/store/use-workspace";
// local imports
import { NotificationContent } from "./content";
import { NotificationOption } from "./options";

type TNotificationItem = {
  workspaceSlug: string;
  notificationId: string;
};

export const NotificationItem = observer(function NotificationItem(props: TNotificationItem) {
  const { workspaceSlug, notificationId } = props;
  // hooks
  const { currentSelectedNotificationId, setCurrentSelectedNotificationId } = useWorkspaceNotifications();
  const { asJson: notification, markNotificationAsRead } = useNotification(notificationId);
  const { getIsIssuePeeked, setPeekIssue, setScrollToActivityCommentId } = useIssueDetail();
  const { getWorkspaceBySlug } = useWorkspace();
  // states
  const [isSnoozeStateModalOpen, setIsSnoozeStateModalOpen] = useState(false);
  const [customSnoozeModal, setCustomSnoozeModal] = useState(false);

  // derived values
  const projectId = notification?.project || undefined;
  const issueId = notification?.data?.issue?.id || undefined;
  const workspace = getWorkspaceBySlug(workspaceSlug);

  const notificationField = notification?.data?.issue_activity?.field || undefined;
  const notificationTriggeredBy = notification.triggered_by_details || undefined;
  // BARSOUL: 提醒/定期 通知无 issue_activity → 原守卫会吞成空白。按 data.kind 放行 + 专属样式。
  const _kind = (notification?.data as { kind?: string })?.kind;
  const isReminder = _kind === "reminder";
  const isRecurring = _kind === "recurring";
  const isBell = isReminder || isRecurring;

  const handleNotificationIssuePeekOverview = async () => {
    if (workspaceSlug && projectId && issueId && !isSnoozeStateModalOpen && !customSnoozeModal) {
      setPeekIssue(undefined);
      setCurrentSelectedNotificationId(notificationId);

      // make the notification as read
      if (notification.read_at === null) {
        try {
          await markNotificationAsRead(workspaceSlug);
        } catch (error) {
          console.error(error);
        }
      }

      if (notification?.is_inbox_issue === false) {
        if (!getIsIssuePeeked(issueId)) {
          setPeekIssue({ workspaceSlug, projectId, issueId });
        }
        // BARSOUL: 滚动定位到该通知对应的评论/活动（评论 id 优先，
        // 否则活动 id）。活动feed异步加载完后由 activity-comment-root 滚动。
        const _act = notification?.data?.issue_activity;
        const _target = _act?.issue_comment || _act?.id || undefined;
        if (_target) setScrollToActivityCommentId(_target);
      }
    }
  };

  if (
    !workspaceSlug ||
    !notificationId ||
    !notification?.id ||
    (!notificationField && !isBell) ||
    !workspace?.id ||
    !projectId
  )
    return <></>;

  return (
    <Row
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 overflow-hidden border-b border-subtle py-4 transition-all",
        {
          "bg-layer-1/30": currentSelectedNotificationId === notification?.id,
          "bg-accent-primary/5": notification.read_at === null,
        }
      )}
      onClick={handleNotificationIssuePeekOverview}
    >
      {notification.read_at === null && (
        <div className="absolute top-[50%] left-2 z-[2] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
      )}
      {/* BARSOUL: 提醒/定期 专属水印(整行大而淡 ⏰/🔁)— 一眼区分「我的提醒」「系统生成」vs 同事动态 */}
      {isBell && (
        <div className="pointer-events-none absolute top-1/2 right-[-6px] z-0 -translate-y-1/2" aria-hidden="true">
          {isReminder ? (
            <AlarmClock style={{ width: 78, height: 78, color: "#7c5cff", opacity: 0.07 }} />
          ) : (
            <Repeat style={{ width: 78, height: 78, color: "#7a7d85", opacity: 0.06 }} />
          )}
        </div>
      )}

      <div className="relative z-[1] flex w-full gap-2">
        <div
          className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-layer-1"
          style={isReminder ? { background: "#f1edff" } : isRecurring ? { background: "#eef0f2" } : undefined}
        >
          {isReminder ? (
            <AlarmClock style={{ width: 21, height: 21, color: "#7c5cff" }} />
          ) : isRecurring ? (
            <Repeat style={{ width: 20, height: 20, color: "#6b6f77" }} />
          ) : (
            notificationTriggeredBy && (
              <Avatar
                name={notificationTriggeredBy.display_name || notificationTriggeredBy?.first_name}
                src={getFileURL(notificationTriggeredBy.avatar_url)}
                size={42}
                shape="circle"
                className="bg-layer-1 text-body-sm-medium"
              />
            )
          )}
        </div>

        <div className="-mt-2 w-full space-y-1">
          <div className="relative flex h-8 items-center gap-3">
            <div className="line-clamp-1 w-full truncate overflow-hidden text-body-xs-medium break-all whitespace-normal text-primary">
              <NotificationContent
                notification={notification}
                workspaceId={workspace.id}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
              />
            </div>
            <NotificationOption
              workspaceSlug={workspaceSlug}
              notificationId={notification?.id}
              isSnoozeStateModalOpen={isSnoozeStateModalOpen}
              setIsSnoozeStateModalOpen={setIsSnoozeStateModalOpen}
              customSnoozeModal={customSnoozeModal}
              setCustomSnoozeModal={setCustomSnoozeModal}
            />
          </div>

          <div className="relative flex items-center gap-3 text-caption-sm-regular text-secondary">
            <div className="line-clamp-1 w-full truncate overflow-hidden break-words whitespace-normal">
              {notification?.data?.issue?.identifier}-{notification?.data?.issue?.sequence_id}&nbsp;
              {notification?.data?.issue?.name}
            </div>
            <div className="flex-shrink-0">
              {notification?.snoozed_till ? (
                <p className="flex flex-shrink-0 items-center justify-end gap-x-1 text-tertiary">
                  <Clock className="h-4 w-4" />
                  <span>
                    Till {renderFormattedDate(notification.snoozed_till)},&nbsp;
                    {renderFormattedTime(notification.snoozed_till, "12-hour")}
                  </span>
                </p>
              ) : (
                <p className="mt-auto flex-shrink-0 text-tertiary">
                  {notification.created_at && calculateTimeAgo(notification.created_at)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Row>
  );
});
