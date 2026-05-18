/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
// plane imports
import type { E_SORT_ORDER, TActivityFilters, EActivityFilterType } from "@plane/constants";
import { BASE_ACTIVITY_FILTER_TYPES, filterActivityOnSelectedFilters } from "@plane/constants";
import type { TCommentsOperations } from "@plane/types";
// components
import { CommentCard } from "@/components/comments/card/root";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// plane web components
import { IssueAdditionalPropertiesActivity } from "@/plane-web/components/issues/issue-details/issue-properties-activity";
import { IssueActivityWorklog } from "@/plane-web/components/issues/worklog/activity/root";
// local imports
import { IssueActivityItem } from "./activity/activity-list";
import { IssueActivityLoader } from "./loader";

type TIssueActivityCommentRoot = {
  workspaceSlug: string;
  projectId: string;
  isIntakeIssue: boolean;
  issueId: string;
  selectedFilters: TActivityFilters[];
  activityOperations: TCommentsOperations;
  showAccessSpecifier?: boolean;
  disabled?: boolean;
  sortOrder: E_SORT_ORDER;
};

export const IssueActivityCommentRoot = observer(function IssueActivityCommentRoot(props: TIssueActivityCommentRoot) {
  const {
    workspaceSlug,
    isIntakeIssue,
    issueId,
    selectedFilters,
    activityOperations,
    showAccessSpecifier,
    projectId,
    disabled,
    sortOrder,
  } = props;
  // store hooks
  const {
    activity: { getActivityAndCommentsByIssueId },
    comment: { getCommentById },
    scrollToActivityCommentId,
    setScrollToActivityCommentId,
  } = useIssueDetail();

  // BARSOUL: 通知中心点击某条 → 这里自动滚到对应评论/活动并短暂高亮。
  // 活动feed异步加载，故有界轮询等元素入 DOM 再滚（最长~6s），完成清除
  // store 目标避免重复触发。Hooks 规则: effect 必须在任何 early return 之前。
  useEffect(() => {
    if (!scrollToActivityCommentId) return;
    const target = scrollToActivityCommentId;
    let tries = 0;
    let cancelled = false;
    let timer: number | undefined;
    const tick = () => {
      if (cancelled) return;
      const el = document.getElementById(`ac-${target}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // BARSOUL: accent 主題色のソフトハイライト（カード/ドットと統一）。
        // ゆっくり浮かび上がり(0.7s)→ 少し留め → ゆっくり消える(1.4s)。
        const HL = "color-mix(in oklab, var(--bg-accent-primary) 14%, transparent)";
        el.style.borderRadius = "6px";
        el.style.transition = "background-color .7s ease";
        el.style.backgroundColor = HL;
        window.setTimeout(() => {
          el.style.transition = "background-color 1.4s ease";
          el.style.backgroundColor = "";
        }, 2200);
        setScrollToActivityCommentId(undefined);
        return;
      }
      if (tries++ < 24) timer = window.setTimeout(tick, 250);
      else setScrollToActivityCommentId(undefined);
    };
    timer = window.setTimeout(tick, 150);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [scrollToActivityCommentId, setScrollToActivityCommentId]);

  // derived values
  const activityAndComments = getActivityAndCommentsByIssueId(issueId, sortOrder);

  if (!activityAndComments) return <IssueActivityLoader />;

  if (activityAndComments.length <= 0) return null;

  const filteredActivityAndComments = filterActivityOnSelectedFilters(activityAndComments, selectedFilters);

  return (
    <div>
      {filteredActivityAndComments.map((activityComment, index) => {
        const comment = getCommentById(activityComment.id);
        const ends = index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined;
        const node =
          activityComment.activity_type === "COMMENT" ? (
            <CommentCard
              workspaceSlug={workspaceSlug}
              entityId={issueId}
              comment={comment}
              activityOperations={activityOperations}
              ends={ends}
              showAccessSpecifier={!!showAccessSpecifier}
              showCopyLinkOption={!isIntakeIssue}
              disabled={disabled}
              projectId={projectId}
              enableReplies
            />
          ) : BASE_ACTIVITY_FILTER_TYPES.includes(activityComment.activity_type as EActivityFilterType) ? (
            <IssueActivityItem activityId={activityComment.id} ends={ends} />
          ) : activityComment.activity_type === "ISSUE_ADDITIONAL_PROPERTIES_ACTIVITY" ? (
            <IssueAdditionalPropertiesActivity activityId={activityComment.id} ends={ends} />
          ) : activityComment.activity_type === "WORKLOG" ? (
            <IssueActivityWorklog
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              issueId={issueId}
              activityComment={activityComment}
              ends={ends}
            />
          ) : null;
        // BARSOUL: 稳定锚点，供通知点击后滚动定位（scroll-mt 让其不被
        // 顶部 sticky 区遮挡）。
        return (
          <div key={activityComment.id} id={`ac-${activityComment.id}`} className="scroll-mt-20 rounded-sm">
            {node}
          </div>
        );
      })}
    </div>
  );
});
