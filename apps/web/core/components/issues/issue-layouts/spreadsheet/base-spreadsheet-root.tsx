/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { FC } from "react";
import { useCallback, useEffect, useRef } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { applyRealtimeBoardUpdate, type RTViewStore } from "@/components/core/realtime-apply";
import { useRealtimeVersion } from "@/components/core/realtime-bus";
// plane imports
import { ALL_ISSUES, EIssueFilterType, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import type { EIssuesStoreType, IIssueDisplayFilterOptions } from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
// local imports
import { IssueLayoutHOC } from "../issue-layout-HOC";
import type { IQuickActionProps, TRenderQuickActions } from "../list/list-view-types";
import { SpreadsheetView } from "./spreadsheet-view";

export type SpreadsheetStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.TEAM
  | EIssuesStoreType.TEAM_VIEW
  | EIssuesStoreType.EPIC;

interface IBaseSpreadsheetRoot {
  QuickActions: FC<IQuickActionProps>;
  canEditPropertiesBasedOnProject?: (projectId: string) => boolean;
  isCompletedCycle?: boolean;
  viewId?: string | undefined;
  isEpic?: boolean;
}

export const BaseSpreadsheetRoot = observer(function BaseSpreadsheetRoot(props: IBaseSpreadsheetRoot) {
  const { QuickActions, canEditPropertiesBasedOnProject, isCompletedCycle = false, viewId, isEpic = false } = props;
  // router
  const { workspaceSlug, projectId } = useParams();
  // store hooks
  const storeType = useIssueStoreType() as SpreadsheetStoreType;
  const { allowPermissions } = useUserPermissions();
  const { issues, issuesFilter } = useIssues(storeType);
  const {
    fetchIssues,
    fetchNextIssues,
    quickAddIssue,
    updateIssue,
    removeIssue,
    removeIssueFromView,
    archiveIssue,
    restoreIssue,
    updateFilters,
  } = useIssuesActions(storeType);
  // derived values
  const { enableInlineEditing, enableQuickAdd, enableIssueCreation } = issues?.viewFlags || {};
  // user role validation
  const isEditingAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  useEffect(() => {
    fetchIssues("init-loader", { canGroup: false, perPageCount: 100 }, viewId);
  }, [fetchIssues, storeType, viewId]);

  // BARSOUL 看板実時失効(外科手術版): 変更 issue id のカードのみ
  //   Plane 自身の単 issue store 更新経路で差し替え。id 無し/削除等のみ
  //   従来の fetchIssues("mutation") 粗粒度退化。初回マウントは必ず
  //   スキップ(init-loader と競合→スケルトン固着の根治)。
  const rtVersion = useRealtimeVersion(projectId?.toString());
  const rtFirst = useRef(true);
  useEffect(() => {
    if (rtFirst.current) {
      rtFirst.current = false;
      return;
    }
    void applyRealtimeBoardUpdate({
      store: issues as unknown as RTViewStore,
      workspaceSlug: workspaceSlug?.toString() ?? "",
      projectId: projectId?.toString() ?? "",
      isEpic,
      coarseRefetch: () => fetchIssues("mutation", { canGroup: false, perPageCount: 100 }, viewId),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtVersion]);

  const canEditProperties = useCallback(
    (projectId: string | undefined) => {
      const isEditingAllowedBasedOnProject =
        canEditPropertiesBasedOnProject && projectId ? canEditPropertiesBasedOnProject(projectId) : isEditingAllowed;

      return enableInlineEditing && isEditingAllowedBasedOnProject;
    },
    [canEditPropertiesBasedOnProject, enableInlineEditing, isEditingAllowed]
  );

  const issueIds = issues.groupedIssueIds?.[ALL_ISSUES] ?? [];
  const nextPageResults = issues.getPaginationData(ALL_ISSUES, undefined)?.nextPageResults;

  const handleDisplayFiltersUpdate = useCallback(
    (updatedDisplayFilter: Partial<IIssueDisplayFilterOptions>) => {
      updateFilters(projectId?.toString() ?? "", EIssueFilterType.DISPLAY_FILTERS, {
        ...updatedDisplayFilter,
      });
    },
    [projectId, updateFilters]
  );

  const renderQuickActions: TRenderQuickActions = useCallback(
    ({ issue, parentRef, customActionButton, placement, portalElement }) => (
      <QuickActions
        parentRef={parentRef}
        customActionButton={customActionButton}
        issue={issue}
        handleDelete={async () => removeIssue(issue.project_id, issue.id)}
        handleUpdate={async (data) => updateIssue && updateIssue(issue.project_id, issue.id, data)}
        handleRemoveFromView={async () => removeIssueFromView && removeIssueFromView(issue.project_id, issue.id)}
        handleArchive={async () => archiveIssue && archiveIssue(issue.project_id, issue.id)}
        handleRestore={async () => restoreIssue && restoreIssue(issue.project_id, issue.id)}
        portalElement={portalElement}
        readOnly={!canEditProperties(issue.project_id ?? undefined) || isCompletedCycle}
        placements={placement}
      />
    ),
    [isCompletedCycle, canEditProperties, removeIssue, updateIssue, removeIssueFromView, archiveIssue, restoreIssue]
  );

  if (!Array.isArray(issueIds)) return null;

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.SPREADSHEET}>
      <SpreadsheetView
        displayProperties={issuesFilter.issueFilters?.displayProperties ?? {}}
        displayFilters={issuesFilter.issueFilters?.displayFilters ?? {}}
        handleDisplayFilterUpdate={handleDisplayFiltersUpdate}
        issueIds={issueIds}
        quickActions={renderQuickActions}
        updateIssue={updateIssue}
        canEditProperties={canEditProperties}
        quickAddCallback={quickAddIssue}
        enableQuickCreateIssue={enableQuickAdd}
        disableIssueCreation={!enableIssueCreation || !isEditingAllowed || isCompletedCycle}
        canLoadMoreIssues={!!nextPageResults}
        loadMoreIssues={fetchNextIssues}
        isEpic={isEpic}
      />
    </IssueLayoutHOC>
  );
});
