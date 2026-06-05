/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane constants
import { ISSUE_DISPLAY_FILTERS_BY_PAGE, PROJECT_VIEW_TRACKER_ELEMENTS } from "@plane/constants";
import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
import { Spinner } from "@plane/ui";
import { useTranslation } from "@plane/i18n";
// BARSOUL DIS: 待我处理 视图 + 看板/待我处理 切换
import { AIDigestView } from "../kanban/ai-digest-view";
import { isZhLocale, Ico, ICON } from "../kanban/ai-state-line";
// components
import { ProjectLevelWorkItemFiltersHOC } from "@/components/work-item-filters/filters-hoc/project-level";
import { WorkItemFiltersRow } from "@/components/work-item-filters/filters-row";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { IssuesStoreContext } from "@/hooks/use-issue-layout-store";
// local imports
import { IssuePeekOverview } from "../../peek-overview";
import { CalendarLayout } from "../calendar/roots/project-root";
import { BaseGanttRoot } from "../gantt";
import { KanBanLayout } from "../kanban/roots/project-root";
import { ListLayout } from "../list/roots/project-root";
import { ProjectSpreadsheetLayout } from "../spreadsheet/roots/project-root";

function ProjectIssueLayout(props: { activeLayout: EIssueLayoutTypes | undefined }) {
  switch (props.activeLayout) {
    case EIssueLayoutTypes.LIST:
      return <ListLayout />;
    case EIssueLayoutTypes.KANBAN:
      return <KanBanLayout />;
    case EIssueLayoutTypes.CALENDAR:
      return <CalendarLayout />;
    case EIssueLayoutTypes.GANTT:
      return <BaseGanttRoot />;
    case EIssueLayoutTypes.SPREADSHEET:
      return <ProjectSpreadsheetLayout />;
    default:
      return null;
  }
}

// BARSOUL DIS: 看板 ↔ 待我处理 segmented 切换
function AIViewToggle({ view, setView }: { view: "board" | "digest"; setView: (v: "board" | "digest") => void }) {
  const { currentLocale } = useTranslation();
  const zh = isZhLocale(currentLocale);
  const L = zh ? { board: "看板", digest: "待我处理" } : { board: "ボード", digest: "対応待ち" };
  const Tab = ({ id, icon, label }: { id: "board" | "digest"; icon: string[]; label: string }) => {
    const active = view === id;
    return (
      <button
        type="button"
        onClick={() => setView(id)}
        className="inline-flex h-[26px] items-center gap-1.5 rounded-md border-0 px-2.5 text-xs font-semibold"
        style={{
          background: active ? "#fff" : "transparent",
          color: active ? "#1f2328" : "#71757c",
          boxShadow: active ? "0 1px 2px rgba(16,24,40,0.1)" : "none",
          cursor: "pointer",
        }}
      >
        <Ico d={icon} size={14} sw={1.8} color={id === "digest" ? (active ? "#7c5cff" : "#a3a7ad") : "currentColor"} />
        {label}
      </button>
    );
  };
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: "#eef0f2" }}>
      <Tab id="board" icon={ICON.columns} label={L.board} />
      <Tab id="digest" icon={ICON.sparkle} label={L.digest} />
    </div>
  );
}

export const ProjectLayoutRoot = observer(function ProjectLayoutRoot() {
  // router
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId } = useParams();
  const workspaceSlug = routerWorkspaceSlug ? routerWorkspaceSlug.toString() : undefined;
  const projectId = routerProjectId ? routerProjectId.toString() : undefined;
  // BARSOUL DIS: 当前视图(看板/待我处理)
  const [aiView, setAiView] = useState<"board" | "digest">("board");
  // hooks
  const { issues, issuesFilter } = useIssues(EIssuesStoreType.PROJECT);
  // derived values
  const workItemFilters = projectId ? issuesFilter?.getIssueFilters(projectId) : undefined;
  const activeLayout = workItemFilters?.displayFilters?.layout;

  useSWR(
    workspaceSlug && projectId ? `PROJECT_ISSUES_${workspaceSlug}_${projectId}` : null,
    async () => {
      if (workspaceSlug && projectId) {
        await issuesFilter?.fetchFilters(workspaceSlug, projectId);
      }
    },
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  if (!workspaceSlug || !projectId || !workItemFilters) return <></>;
  return (
    <IssuesStoreContext.Provider value={EIssuesStoreType.PROJECT}>
      <ProjectLevelWorkItemFiltersHOC
        enableSaveView
        entityType={EIssuesStoreType.PROJECT}
        entityId={projectId}
        filtersToShowByLayout={ISSUE_DISPLAY_FILTERS_BY_PAGE.issues.filters}
        initialWorkItemFilters={workItemFilters}
        updateFilters={issuesFilter?.updateFilterExpression.bind(issuesFilter, workspaceSlug, projectId)}
        projectId={projectId}
        workspaceSlug={workspaceSlug}
      >
        {({ filter: projectWorkItemsFilter }) => (
          <div className="relative flex h-full w-full flex-col overflow-hidden">
            {projectWorkItemsFilter && (
              <WorkItemFiltersRow
                filter={projectWorkItemsFilter}
                trackerElements={{
                  saveView: PROJECT_VIEW_TRACKER_ELEMENTS.PROJECT_HEADER_SAVE_AS_VIEW_BUTTON,
                }}
              />
            )}
            {/* BARSOUL DIS: 看板 / 待我处理 切换条 */}
            <div className="flex items-center justify-end gap-2 border-b border-subtle bg-surface-1 px-4 py-1.5">
              <AIViewToggle view={aiView} setView={setAiView} />
            </div>
            <div className="relative h-full w-full overflow-auto bg-surface-1">
              {/* mutation loader */}
              {issues?.getIssueLoader() === "mutation" && (
                <div className="shadow-sm fixed top-[70px] right-[20px] z-50 flex h-[40px] w-[40px] items-center justify-center rounded-sm bg-layer-1">
                  <Spinner className="h-4 w-4" />
                </div>
              )}
              {aiView === "digest" ? (
                <AIDigestView workspaceSlug={workspaceSlug} projectId={projectId} />
              ) : (
                <ProjectIssueLayout activeLayout={activeLayout} />
              )}
            </div>
            {/* peek overview */}
            <IssuePeekOverview />
          </div>
        )}
      </ProjectLevelWorkItemFiltersHOC>
    </IssuesStoreContext.Provider>
  );
});
