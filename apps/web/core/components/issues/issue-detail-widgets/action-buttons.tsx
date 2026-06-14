/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { Paperclip } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { LinkIcon, ViewsIcon, RelationPropertyIcon } from "@plane/propel/icons";
// plane imports
import type { TIssueServiceType, TWorkItemWidgets } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// plane web imports
import { WorkItemAdditionalWidgetActionButtons } from "@/plane-web/components/issues/issue-detail-widgets/action-buttons";
// BARSOUL B-2p v2: 任务动作统一进快捷动作行; B-5b: 审批并入发起流程下拉(仅审批=最短流程)
import { StartFlowButton } from "@/components/smart-table/start-flow-button";
// local imports
import { IssueAttachmentActionButton } from "./attachments";
import { IssueLinksActionButton } from "./links";
import { RelationActionButton } from "./relations";
import { SubIssuesActionButton } from "./sub-issues";
import { IssueDetailWidgetButton } from "./widget-button";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  issueServiceType: TIssueServiceType;
  hideWidgets?: TWorkItemWidgets[];
};

export function IssueDetailWidgetActionButtons(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled, issueServiceType, hideWidgets } = props;
  // translation
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hideWidgets?.includes("sub-work-items") && (
        <SubIssuesActionButton
          issueId={issueId}
          customButton={
            <IssueDetailWidgetButton
              title={t("issue.add.sub_issue")}
              icon={<ViewsIcon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />}
              disabled={disabled}
            />
          }
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {!hideWidgets?.includes("relations") && (
        <RelationActionButton
          issueId={issueId}
          customButton={
            <IssueDetailWidgetButton
              title={t("issue.add.relation")}
              icon={<RelationPropertyIcon className="h-3.5 w-3.5 flex-shrink-0" />}
              disabled={disabled}
            />
          }
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {!hideWidgets?.includes("links") && (
        <IssueLinksActionButton
          customButton={
            <IssueDetailWidgetButton
              title={t("issue.add.link")}
              icon={<LinkIcon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />}
              disabled={disabled}
            />
          }
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {!hideWidgets?.includes("attachments") && (
        <IssueAttachmentActionButton
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          customButton={
            <IssueDetailWidgetButton
              title={t("common.attach")}
              icon={<Paperclip className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />}
              disabled={disabled}
            />
          }
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      <WorkItemAdditionalWidgetActionButtons
        disabled={disabled}
        hideWidgets={hideWidgets ?? []}
        issueServiceType={issueServiceType}
        projectId={projectId}
        workItemId={issueId}
        workspaceSlug={workspaceSlug}
      />
      {/* BARSOUL B-2p v2(用户点名: 任务相关动作统一进本行); B-5b: 単一入口 —
          下拉=已发布蓝图(顶层卡)+仅审批(全卡), 審査=最短のフロー */}
      {issueServiceType === EIssueServiceType.ISSUES && !disabled && (
        <StartFlowButton issueId={issueId} disabled={disabled} />
      )}
      {/* BARSOUL 定期化 / あとで通知 は卡片右键・⋯メニューに移設(用户: 独立ボタンは雑然) — 此处不再放按钮 */}
    </div>
  );
}
