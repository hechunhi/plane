/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { MutableRefObject } from "react";
import { useMemo } from "react";
import { observer } from "mobx-react";
// components
import type { TIssue, IIssueDisplayProperties, TIssueMap, TGroupedIssues } from "@plane/types";
// hooks
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
// BARSOUL IUTEYA-9: Pin → sort to top
import { usePinnedIssues } from "@/hooks/store/use-pinned-issues";
// types
import { IssueBlockRoot } from "./block-root";
import type { TRenderQuickActions } from "./list-view-types";

interface Props {
  issueIds: TGroupedIssues | any;
  issuesMap: TIssueMap;
  groupId: string;
  canEditProperties: (projectId: string | undefined) => boolean;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  displayProperties: IIssueDisplayProperties | undefined;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  isDragAllowed: boolean;
  canDropOverIssue: boolean;
  selectionHelpers: TSelectionHelper;
  isEpic?: boolean;
}

export const IssueBlocksList = observer(function IssueBlocksList(props: Props) {
  const {
    issueIds,
    issuesMap,
    groupId,
    updateIssue,
    quickActions,
    displayProperties,
    canEditProperties,
    containerRef,
    selectionHelpers,
    isDragAllowed,
    canDropOverIssue,
    isEpic = false,
  } = props;

  // BARSOUL IUTEYA-9: Pin → pinned-first 並び替え (per-user, 安定 sort)
  const { pinnedSet } = usePinnedIssues();
  const sortedIssueIds = useMemo(() => {
    if (!issueIds || (issueIds as string[]).length === 0) return issueIds;
    if (pinnedSet.size === 0) return issueIds;
    const pinned: string[] = [];
    const rest: string[] = [];
    for (const id of issueIds as string[]) (pinnedSet.has(id) ? pinned : rest).push(id);
    return pinned.length === 0 ? issueIds : [...pinned, ...rest];
  }, [issueIds, pinnedSet]);

  return (
    <div className="relative h-full w-full">
      {sortedIssueIds &&
        sortedIssueIds.length > 0 &&
        sortedIssueIds.map((issueId: string, index: number) => (
          <IssueBlockRoot
            key={issueId}
            issueId={issueId}
            issuesMap={issuesMap}
            updateIssue={updateIssue}
            quickActions={quickActions}
            canEditProperties={canEditProperties}
            displayProperties={displayProperties}
            nestingLevel={0}
            spacingLeft={0}
            containerRef={containerRef}
            selectionHelpers={selectionHelpers}
            groupId={groupId}
            isLastChild={index === sortedIssueIds.length - 1}
            isDragAllowed={isDragAllowed}
            canDropOverIssue={canDropOverIssue}
            isEpic={isEpic}
          />
        ))}
    </div>
  );
});
