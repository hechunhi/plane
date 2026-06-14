/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
// BARSOUL: 智能表 卡内自动表单(填充 EE 留空的 additional-properties 槽)
import { SmartTableCardForm } from "@/components/smart-table/smart-table-card-form";

export type TWorkItemAdditionalSidebarProperties = {
  workItemId: string;
  workItemTypeId: string | null;
  projectId: string;
  workspaceSlug: string;
  isEditable: boolean;
  isPeekView?: boolean;
};

export function WorkItemAdditionalSidebarProperties(props: TWorkItemAdditionalSidebarProperties) {
  return (
    <>
      <SmartTableCardForm
        workItemId={props.workItemId}
        projectId={props.projectId}
        workspaceSlug={props.workspaceSlug}
        isEditable={props.isEditable}
      />
      {/* BARSOUL(2026-06-15): 子树台账汇总(横表)移到主内容区 — 在窄属性 sidebar 会横向
          滚/物品列被截。此处只留竖式数据表单(适配窄列)。横表见 main-content + peek issue-detail。 */}
    </>
  );
}
