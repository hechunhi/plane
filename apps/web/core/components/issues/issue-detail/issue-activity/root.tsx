/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef } from "react";
import uniq from "lodash-es/uniq";
import { observer } from "mobx-react";
// plane package imports
import type { TActivityFilters } from "@plane/constants";
import { E_SORT_ORDER, defaultActivityFilters, EUserPermissions } from "@plane/constants";
import { useLocalStorage } from "@plane/hooks";
// i18n
import { useTranslation } from "@plane/i18n";
//types
import type { TFileSignedURLResponse, TIssueComment } from "@plane/types";
// components
import { CommentCreate } from "@/components/comments/comment-create";
import { useRealtimeCommentVersion } from "@/components/core/realtime-bus";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useUser, useUserPermissions } from "@/hooks/store/user";
// plane web components
import { ActivityFilterRoot } from "@/plane-web/components/issues/worklog/activity/filter-root";
import { IssueActivityWorklogCreateButton } from "@/plane-web/components/issues/worklog/activity/worklog-create-button";
import { IssueActivityCommentRoot } from "./activity-comment-root";
import { useWorkItemCommentOperations } from "./helper";
import { ActivitySortRoot } from "./sort-root";

type TIssueActivity = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
  isIntakeIssue?: boolean;
};

export type TActivityOperations = {
  createComment: (data: Partial<TIssueComment>) => Promise<TIssueComment>;
  updateComment: (commentId: string, data: Partial<TIssueComment>) => Promise<void>;
  removeComment: (commentId: string) => Promise<void>;
  uploadCommentAsset: (blockId: string, file: File, commentId?: string) => Promise<TFileSignedURLResponse>;
};

export const IssueActivity = observer(function IssueActivity(props: TIssueActivity) {
  const { workspaceSlug, projectId, issueId, disabled = false, isIntakeIssue = false } = props;
  // i18n
  const { t } = useTranslation();
  // hooks
  const { setValue: setFilterValue, storedValue: selectedFilters } = useLocalStorage(
    "issue_activity_filters",
    defaultActivityFilters
  );
  const { setValue: setSortOrder, storedValue: sortOrder } = useLocalStorage("activity_sort_order", E_SORT_ORDER.ASC);
  // store hooks
  const {
    issue: { getIssueById },
    comment,
  } = useIssueDetail();

  // BARSOUL コメント実時(この class の根治): パネルが開いている間、
  //   当該 issue にコメント変更(他者/愛ちゃん の 追加・編集・削除)が
  //   来たら comment store を【全件再取得して置換】(fetchCommentsReplace)。
  //   旧実装の増分 fetchComments(created_at__gt で append 専用)は
  //   削除/編集が永久に反映されない欠陥 → 全件置換に変更。レンダは
  //   comment id を key にしているので: 変更行のみ再描画・削除行のみ
  //   unmount・新規のみ mount・既存は据え置き = フラッシュ無し、
  //   スクロール位置/入力中の返信欄も保持。看板には一切波及しない。
  //   ★初回マウントはスキップ: パネル open 時の本来の取得と競合させない
  //   (rtVersion は generation を含むためマウント時点で >0 になり得る)。
  const rtCommentVersion = useRealtimeCommentVersion(issueId);
  const rtcFirst = useRef(true);
  useEffect(() => {
    if (rtcFirst.current) {
      rtcFirst.current = false;
      return;
    }
    if (!workspaceSlug || !projectId || !issueId) return;
    void comment.fetchCommentsReplace(workspaceSlug, projectId, issueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtCommentVersion]);

  const { getProjectRoleByWorkspaceSlugAndProjectId } = useUserPermissions();
  const { getProjectById } = useProject();
  const { data: currentUser } = useUser();
  // derived values
  const issue = issueId ? getIssueById(issueId) : undefined;
  const currentUserProjectRole = getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId);
  const isAdmin = currentUserProjectRole === EUserPermissions.ADMIN;
  const isGuest = currentUserProjectRole === EUserPermissions.GUEST;
  const isAssigned = issue?.assignee_ids && currentUser?.id ? issue?.assignee_ids.includes(currentUser?.id) : false;
  const isWorklogButtonEnabled = !isIntakeIssue && !isGuest && (isAdmin || isAssigned);
  // toggle filter
  const toggleFilter = (filter: TActivityFilters) => {
    if (!selectedFilters) return;
    let _filters = [];
    if (selectedFilters.includes(filter)) {
      if (selectedFilters.length === 1) return selectedFilters; // Ensure at least one filter is applied
      _filters = selectedFilters.filter((f) => f !== filter);
    } else {
      _filters = [...selectedFilters, filter];
    }

    setFilterValue(uniq(_filters));
  };

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === E_SORT_ORDER.ASC ? E_SORT_ORDER.DESC : E_SORT_ORDER.ASC);
  };

  // helper hooks
  const activityOperations = useWorkItemCommentOperations(workspaceSlug, projectId, issueId);

  const project = getProjectById(projectId);
  const renderCommentCreationBox = useMemo(
    () => (
      <CommentCreate
        workspaceSlug={workspaceSlug}
        entityId={issueId}
        activityOperations={activityOperations}
        showToolbarInitially
        projectId={projectId}
        // BARSOUL: 愛ちゃん私聊パネルが「何を読んだ上で答えているか」を明示するためだけに渡す。
        entityTitle={issue?.name}
      />
    ),
    [workspaceSlug, issueId, activityOperations, projectId, issue?.name]
  );
  if (!project) return <></>;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="text-h5-medium text-primary">{t("common.activity")}</div>
        <div className="flex items-center gap-2">
          {isWorklogButtonEnabled && (
            <IssueActivityWorklogCreateButton
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              issueId={issueId}
              disabled={disabled}
            />
          )}
          <ActivitySortRoot sortOrder={sortOrder || E_SORT_ORDER.ASC} toggleSort={toggleSortOrder} />
          <ActivityFilterRoot
            selectedFilters={selectedFilters || defaultActivityFilters}
            toggleFilter={toggleFilter}
            isIntakeIssue={isIntakeIssue}
            projectId={projectId}
          />
        </div>
      </div>

      {/* rendering activity */}
      <div className="space-y-3">
        <div className="min-h-[200px]">
          <div className="space-y-3">
            {!disabled && sortOrder === E_SORT_ORDER.DESC && renderCommentCreationBox}
            <IssueActivityCommentRoot
              projectId={projectId}
              workspaceSlug={workspaceSlug}
              isIntakeIssue={isIntakeIssue}
              issueId={issueId}
              selectedFilters={selectedFilters || defaultActivityFilters}
              activityOperations={activityOperations}
              showAccessSpecifier={!!project.anchor}
              disabled={disabled}
              sortOrder={sortOrder || E_SORT_ORDER.ASC}
            />
            {!disabled && sortOrder === E_SORT_ORDER.ASC && renderCommentCreationBox}
          </div>
        </div>
      </div>
    </div>
  );
});
