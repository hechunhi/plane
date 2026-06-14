/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import type { EditorRefApi } from "@plane/editor";
import type { TNameDescriptionLoader } from "@plane/types";
import { EFileAssetType, EIssueServiceType } from "@plane/types";
import { getTextContent } from "@plane/utils";
// components
import { DescriptionVersionsRoot } from "@/components/core/description-versions";
import { DescriptionInput } from "@/components/editor/rich-text/description-input";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
import useReloadConfirmations from "@/hooks/use-reload-confirmation";
import useSize from "@/hooks/use-window-size";
// plane web components
import { DeDupeIssuePopoverRoot } from "@/plane-web/components/de-dupe/duplicate-popover";
import { IssueTypeSwitcher } from "@/plane-web/components/issues/issue-details/issue-type-switcher";
import { useDebouncedDuplicateIssues } from "@/plane-web/hooks/use-debounced-duplicate-issues";
// services
import { WorkItemVersionService } from "@/services/issue";
// local imports
import { IssueDetailWidgets } from "../issue-detail-widgets";
import { NameDescriptionUpdateStatus } from "../issue-update-status";
import { PeekOverviewProperties } from "../peek-overview/properties";
import { IssueTitleInput } from "../title-input";
// BARSOUL DIS v4: 详情内嵌 AI 当前态区块
import { AICurrentStateInline } from "@/components/issues/issue-layouts/kanban/ai-current-state-inline";
// BARSOUL ADR-029: 凍結カード banner(役割別)
import { ApprovalHistory, FrozenBanner } from "./frozen-banner";
import { IssueFlowContext } from "./issue-flow-context";
import { RecurringContextBar, SnoozeBar } from "@/components/recurring/recurring-card";
import { IssueActivity } from "./issue-activity";
import { KeiriOrderWidget } from "./keiri-order-widget";
// BARSOUL B-4c(2026-06-15 移到主区): 子树台账汇总(横表) — 主内容区宽, 不被窄属性 sidebar 截
import { SmartTableSubtreeRollup } from "@/components/smart-table/smart-table-subtree-rollup";
import { IssueParentDetail } from "./parent";
import { IssueReaction } from "./reactions";
import type { TIssueOperations } from "./root";
// services init
const workItemVersionService = new WorkItemVersionService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueOperations: TIssueOperations;
  isEditable: boolean;
  isArchived: boolean;
};

export const IssueMainContent = observer(function IssueMainContent(props: Props) {
  const { workspaceSlug, projectId, issueId, issueOperations, isEditable, isArchived } = props;
  // refs
  const editorRef = useRef<EditorRefApi>(null);
  // states
  const [isSubmitting, setIsSubmitting] = useState<TNameDescriptionLoader>("saved");
  // hooks
  const windowSize = useSize();
  const { data: currentUser } = useUser();
  const { getUserDetails } = useMember();
  const {
    issue: { getIssueById },
    peekIssue,
  } = useIssueDetail();
  const { getProjectById } = useProject();
  const { setShowAlert } = useReloadConfirmations(isSubmitting === "submitting");
  // derived values
  const projectDetails = getProjectById(projectId);
  const issue = issueId ? getIssueById(issueId) : undefined;
  // debounced duplicate issues swr
  const { duplicateIssues } = useDebouncedDuplicateIssues(
    workspaceSlug,
    projectDetails?.workspace.toString(),
    projectDetails?.id,
    {
      name: issue?.name,
      description_html: getTextContent(issue?.description_html),
      issueId: issue?.id,
    }
  );

  useEffect(() => {
    if (isSubmitting === "submitted") {
      setShowAlert(false);
      setTimeout(async () => setIsSubmitting("saved"), 2000);
    } else if (isSubmitting === "submitting") setShowAlert(true);
  }, [isSubmitting, setShowAlert, setIsSubmitting]);

  if (!issue || !issue.project_id) return <></>;

  const isPeekModeActive = Boolean(peekIssue);

  return (
    <>
      <div className="space-y-4 rounded-lg">
        {issue.parent_id && (
          <IssueParentDetail
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId={issueId}
            issue={issue}
            issueOperations={issueOperations}
          />
        )}

        <div className="mb-2.5 flex items-center justify-between gap-4">
          <IssueTypeSwitcher issueId={issueId} disabled={isArchived || !isEditable} />
          <div className="flex items-center gap-3">
            <NameDescriptionUpdateStatus isSubmitting={isSubmitting} />
            {duplicateIssues?.length > 0 && (
              <DeDupeIssuePopoverRoot
                workspaceSlug={workspaceSlug}
                projectId={issue.project_id}
                rootIssueId={issueId}
                issues={duplicateIssues}
                issueOperations={issueOperations}
                renderDeDupeActionModals={!isPeekModeActive}
              />
            )}
          </div>
        </div>

        <IssueTitleInput
          workspaceSlug={workspaceSlug}
          projectId={issue.project_id}
          issueId={issue.id}
          isSubmitting={isSubmitting}
          setIsSubmitting={(value) => setIsSubmitting(value)}
          issueOperations={issueOperations}
          disabled={isArchived || !isEditable}
          value={issue.name}
          containerClassName="-ml-3"
        />

        {/* BARSOUL DIS v4: 详情内嵌 AI 当前态(标题下方,代替 hover 浮层) */}
        {issue.project_id && <AICurrentStateInline issueId={issue.id} projectId={issue.project_id} />}
        {/* B-2h: 審査の状態層 — AI 当前態と同区画(標題下)。ページ物理最上部は視覚的に不自然のため移設 */}
        <FrozenBanner issueId={issueId} />
        {/* B-2j: 流程上下文条 — 站卡単独打开時の「我在哪/做什么/做完会怎样」
            (B-2n v3: 兄弟樹は原生「子工作項」widget が親を根に描画 — collapsibles 参照) */}
        <IssueFlowContext issueId={issueId} />
        {/* BARSOUL 定期タスク: 该卡是某规则的当前实例 → 顶部上下文条回链规则(非实例则不渲染) */}
        {issue.project_id && <RecurringContextBar issueId={issueId} projectId={issue.project_id} />}
        {/* BARSOUL フォローアップ・スヌーズ: スヌーズ中なら期日+解除を表示(非 snooze は不渲染) */}
        {issue.project_id && <SnoozeBar issueId={issueId} projectId={issue.project_id} />}
        <ApprovalHistory issueId={issueId} />

        <DescriptionInput
          issueSequenceId={issue.sequence_id}
          containerClassName="-ml-6 border-none p-0! pl-6!"
          disabled={isArchived || !isEditable}
          editorRef={editorRef}
          entityId={issue.id}
          fileAssetType={EFileAssetType.ISSUE_DESCRIPTION}
          initialValue={issue.description_html}
          key={issue.id}
          onSubmit={async (value, isMigrationUpdate) => {
            if (!issue.id || !issue.project_id) return;
            await issueOperations.update(workspaceSlug, issue.project_id, issue.id, {
              description_html: value.description_html,
              ...(isMigrationUpdate ? { skip_activity: "true" } : {}),
            });
          }}
          projectId={issue.project_id}
          setIsSubmitting={(value) => setIsSubmitting(value)}
          workspaceSlug={workspaceSlug}
        />

        <div className="flex items-center justify-between gap-2">
          {currentUser && (
            <IssueReaction
              className="flex-shrink-0"
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              issueId={issueId}
              currentUser={currentUser}
              disabled={isArchived}
            />
          )}
          {isEditable && (
            <DescriptionVersionsRoot
              className="flex-shrink-0"
              entityInformation={{
                createdAt: issue.created_at ? new Date(issue.created_at) : new Date(),
                createdByDisplayName: getUserDetails(issue.created_by ?? "")?.display_name ?? "",
                id: issueId,
                isRestoreDisabled: !isEditable || isArchived,
              }}
              fetchHandlers={{
                listDescriptionVersions: (issueId) =>
                  workItemVersionService.listDescriptionVersions(workspaceSlug, projectId, issueId),
                retrieveDescriptionVersion: (issueId, versionId) =>
                  workItemVersionService.retrieveDescriptionVersion(workspaceSlug, projectId, issueId, versionId),
              }}
              handleRestore={(descriptionHTML) => editorRef.current?.setEditorValue(descriptionHTML, true)}
              projectId={projectId}
              workspaceSlug={workspaceSlug}
            />
          )}
        </div>
      </div>

      <IssueDetailWidgets
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        disabled={!isEditable || isArchived}
        renderWidgetModals={!isPeekModeActive}
        issueServiceType={EIssueServiceType.ISSUES}
      />

      {/* BARSOUL C1: keiri 受注ステータス＋単票リンク */}
      <KeiriOrderWidget workspaceSlug={workspaceSlug} issueId={issueId} />

      {/* BARSOUL B-4c(移到主区): 子树台账汇总 — 主内容区宽, 横表不被窄属性 sidebar 截 */}
      <SmartTableSubtreeRollup issueId={issueId} />

      {windowSize[0] < 768 && (
        <PeekOverviewProperties
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          issueOperations={issueOperations}
          disabled={!isEditable || isArchived}
        />
      )}

      <IssueActivity workspaceSlug={workspaceSlug} projectId={projectId} issueId={issueId} disabled={isArchived} />
    </>
  );
});
