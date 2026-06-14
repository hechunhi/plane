/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect } from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssueServiceType, TWorkItemWidgets } from "@plane/types";
// hooks
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// Plane-web
import { WorkItemAdditionalWidgetCollapsibles } from "@/plane-web/components/issues/issue-detail-widgets/collapsibles";
import { useTimeLineRelationOptions } from "@/plane-web/components/relations";
// local imports
import { AttachmentsCollapsible } from "./attachments";
import { LinksCollapsible } from "./links";
import { RelationsCollapsible } from "./relations";
import { SubIssuesCollapsible } from "./sub-issues";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  issueServiceType: TIssueServiceType;
  hideWidgets?: TWorkItemWidgets[];
};

export const IssueDetailWidgetCollapsibles = observer(function IssueDetailWidgetCollapsibles(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled, issueServiceType, hideWidgets } = props;
  const zhLocale = useZh();
  // store hooks
  const {
    issue: { getIssueById },
    subIssues: { subIssuesByIssueId, fetchSubIssues, subIssueHelpersByIssueId, setSubIssueHelpers },
    attachment: { getAttachmentsCountByIssueId, getAttachmentsUploadStatusByIssueId },
    relation: { getRelationCountByIssueId },
  } = useIssueDetail(issueServiceType);
  // derived values
  const issue = getIssueById(issueId);
  const subIssues = subIssuesByIssueId(issueId);
  const ISSUE_RELATION_OPTIONS = useTimeLineRelationOptions();
  const issueRelationsCount = getRelationCountByIssueId(issueId, ISSUE_RELATION_OPTIONS);
  // render conditions
  // BARSOUL B-2n v3→v6(用户:「树要递归遍历」「有父节点但不显示」): **只要有父**
  // (叶子或中间节点都算)→ 爬祖先链到最顶层祖先, 以根渲染同一个 SubIssuesCollapsible
  // (完整树, 自带本卡的子层), 并预展开 根→…→父→本卡 路径。「子工作项」widget
  // 仅顶层卡(无父)保留 — 有父时全树取代之(树里本来就含自己的子)。
  // 爬链用 store 指针(observer 下 fetch 增量进 issueMap 后自动向上收敛)。
  const parentId = issue?.parent_id || null;
  const chain: string[] = []; // [父, 祖父, …, 已知最高层]
  {
    let curId: string | null = parentId;
    let guard = 0;
    while (curId && guard++ < 10) {
      chain.push(curId);
      curId = getIssueById(curId)?.parent_id || null;
    }
  }
  const rootAncestorId = chain.length ? chain[chain.length - 1] : null;
  const rootAncestorProjectId =
    (rootAncestorId ? getIssueById(rootAncestorId)?.project_id : null) ?? projectId;
  const shouldRenderSiblingTree = !!parentId && !hideWidgets?.includes("sub-work-items");
  const shouldRenderSubIssues =
    !shouldRenderSiblingTree && !!subIssues && subIssues.length > 0 && !hideWidgets?.includes("sub-work-items");
  const hasOwnChildren = (issue?.sub_issues_count ?? 0) > 0;
  const chainKey = chain.join(">");
  useEffect(() => {
    if (!shouldRenderSiblingTree || !workspaceSlug || chain.length === 0) return;
    // 链上每层 fetch(数据进 issueMap → 链向上收敛 → chainKey 变化本 effect 重跑)
    chain.forEach((pid) => {
      const p = getIssueById(pid);
      fetchSubIssues(workspaceSlug, p?.project_id ?? projectId, pid).catch(() => {});
    });
    // 预展开: 根→…→父 路径上每个中间节点(setSubIssueHelpers 是 toggle, 必须 includes 守卫)
    for (let i = chain.length - 1; i > 0; i--) {
      const parentNode = chain[i];
      const childNode = chain[i - 1];
      if (!subIssueHelpersByIssueId(parentNode).issue_visibility.includes(childNode))
        setSubIssueHelpers(parentNode, "issue_visibility", childNode);
    }
    // 本卡自身有子 → 也展开自己的子层(中间节点场景: 根→…→本卡→本卡的子 全可见)
    if (hasOwnChildren && parentId) {
      fetchSubIssues(workspaceSlug, projectId, issueId).catch(() => {});
      if (!subIssueHelpersByIssueId(parentId).issue_visibility.includes(issueId))
        setSubIssueHelpers(parentId, "issue_visibility", issueId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRenderSiblingTree, workspaceSlug, chainKey, hasOwnChildren]);
  const shouldRenderRelations = issueRelationsCount > 0 && !hideWidgets?.includes("relations");
  const shouldRenderLinks = !!issue?.link_count && issue?.link_count > 0 && !hideWidgets?.includes("links");
  const attachmentUploads = getAttachmentsUploadStatusByIssueId(issueId);
  const attachmentsCount = getAttachmentsCountByIssueId(issueId);
  const shouldRenderAttachments =
    attachmentsCount > 0 ||
    (!!attachmentUploads && attachmentUploads.length > 0 && !hideWidgets?.includes("attachments"));

  return (
    <div className="flex flex-col">
      {shouldRenderSubIssues && (
        <SubIssuesCollapsible
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {shouldRenderSiblingTree && rootAncestorId && (
        // B-2n v4/v5: 标题改「所属任务树」+ 本卡行高亮 + **以最顶祖先为根**(递归全树)
        // (行 DOM 自带 id="issue-<uuid>" → scoped 样式零 prop 穿透; 底色+左琥珀条)
        <div className="barsoul-sibling-tree">
          {/* 高亮挂内层视觉行 div — id 在 ControlLink(<a> inline 元素), 直接染 a 的背景/inset 阴影在含 block 子时不可见(v4 翻车根因)。
              色 = accent 蓝(位置信号, 与流程链●本卡/Plane 选中语义统一) — 琥珀专属「必填待填」行动信号, 混用会诱导用户去"填"树行(用户拷打)。 */}
          <style>{`.barsoul-sibling-tree [id="issue-${issueId}"]>div{background:color-mix(in srgb,#006399 7%,transparent);box-shadow:inset 3px 0 0 0 #006399}
html[data-theme*="dark"] .barsoul-sibling-tree [id="issue-${issueId}"]>div{background:color-mix(in srgb,#2893cc 10%,transparent);box-shadow:inset 3px 0 0 0 #2893cc}`}</style>
          <SubIssuesCollapsible
            workspaceSlug={workspaceSlug}
            projectId={rootAncestorProjectId}
            issueId={rootAncestorId}
            disabled={disabled}
            issueServiceType={issueServiceType}
            titleOverride={zhLocale ? "所属任务树" : "タスクツリー"}
          />
        </div>
      )}
      {shouldRenderRelations && (
        <RelationsCollapsible
          workspaceSlug={workspaceSlug}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {shouldRenderLinks && (
        <LinksCollapsible
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      {shouldRenderAttachments && (
        <AttachmentsCollapsible
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
      <WorkItemAdditionalWidgetCollapsibles
        disabled={disabled}
        hideWidgets={hideWidgets ?? []}
        issueServiceType={issueServiceType}
        projectId={projectId}
        workItemId={issueId}
        workspaceSlug={workspaceSlug}
      />
    </div>
  );
});
