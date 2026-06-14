/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssueServiceType } from "@plane/types";
import { Collapsible } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import { SubIssuesCollapsibleContent } from "./content";
import { SubIssuesCollapsibleTitle } from "./title";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
  // BARSOUL B-2n v3: 子卡上以父为根渲染兄弟树时, 标题「子工作项」语义错位 → 可覆盖
  titleOverride?: string;
};

export const SubIssuesCollapsible = observer(function SubIssuesCollapsible(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled = false, issueServiceType, titleOverride } = props;
  // store hooks
  const { openWidgets, toggleOpenWidget } = useIssueDetail(issueServiceType);
  // derived values
  const isCollapsibleOpen = openWidgets.includes("sub-work-items");

  return (
    <Collapsible
      isOpen={isCollapsibleOpen}
      onToggle={() => toggleOpenWidget("sub-work-items")}
      title={
        <SubIssuesCollapsibleTitle
          isOpen={isCollapsibleOpen}
          parentIssueId={issueId}
          disabled={disabled}
          projectId={projectId}
          workspaceSlug={workspaceSlug}
          titleOverride={titleOverride}
        />
      }
      buttonClassName="w-full"
    >
      <SubIssuesCollapsibleContent
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        parentIssueId={issueId}
        disabled={disabled}
        issueServiceType={issueServiceType}
      />
    </Collapsible>
  );
});
