/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Tooltip } from "@plane/propel/tooltip";
import { generateWorkItemLink } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { usePlatformOS } from "@/hooks/use-platform-os";

type TIssueLink = {
  activityId: string;
};

export function IssueLink(props: TIssueLink) {
  const { activityId } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const { isMobile } = usePlatformOS();
  const activity = getActivityById(activityId);

  if (!activity) return <></>;

  const workItemLink = generateWorkItemLink({
    workspaceSlug: activity.workspace_detail?.slug,
    projectId: activity.project,
    issueId: activity.issue,
    // BARSOUL 2026-06-07 (hechun): 关联/父/链接 活动指向的 issue/project 可被独立
    // 删除 → project_detail/issue_detail 运行时为 null(类型谎称非空)。本文件他处
    // 已守卫(L37「已删除」、L50 `?.`),这两行漏了 → null.identifier 崩整个活动流。
    // generateWorkItemLink 接受 undefined,安全。
    projectIdentifier: activity.project_detail?.identifier,
    sequenceId: activity.issue_detail?.sequence_id,
  });
  return (
    <Tooltip
      tooltipContent={activity.issue_detail ? activity.issue_detail.name : "This work item has been deleted"}
      isMobile={isMobile}
    >
      <a
        aria-disabled={activity.issue === null}
        href={`${activity.issue_detail ? workItemLink : "#"}`}
        target={activity.issue === null ? "_self" : "_blank"}
        rel={activity.issue === null ? "" : "noopener noreferrer"}
        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
      >
        {activity.issue_detail
          ? `${activity.project_detail?.identifier}-${activity.issue_detail.sequence_id}`
          : "Work items"}{" "}
        <span className="font-regular">{activity.issue_detail?.name}</span>
      </a>
    </Tooltip>
  );
}
