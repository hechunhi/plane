/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { MutableRefObject } from "react";
import { useMemo } from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssue, IIssueDisplayProperties, IIssueMap } from "@plane/types";
// BARSOUL IUTEYA-9: Pin → sort to top
import { usePinnedIssues } from "@/hooks/store/use-pinned-issues";
// local imports
import type { TRenderQuickActions } from "../list/list-view-types";
import { KanbanIssueBlock } from "./block";

interface IssueBlocksListProps {
  sub_group_id: string;
  groupId: string;
  issuesMap: IIssueMap;
  issueIds: string[];
  displayProperties: IIssueDisplayProperties | undefined;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  canEditProperties: (projectId: string | undefined) => boolean;
  canDropOverIssue: boolean;
  canDragIssuesInCurrentGrouping: boolean;
  scrollableContainerRef?: MutableRefObject<HTMLDivElement | null>;
  isEpic?: boolean;
}

export const KanbanIssueBlocksList = observer(function KanbanIssueBlocksList(props: IssueBlocksListProps) {
  const {
    sub_group_id,
    groupId,
    issuesMap,
    issueIds,
    displayProperties,
    canDropOverIssue,
    canDragIssuesInCurrentGrouping,
    updateIssue,
    quickActions,
    canEditProperties,
    scrollableContainerRef,
    isEpic = false,
  } = props;

  // BARSOUL IUTEYA-9: Pin → 列内で pinned-first 並び替え (per-user, 安定 sort)
  // pinnedSet 変化で再評価. ドラッグソート等の元順序は保ったまま、pin だけ上へ.
  const { pinnedSet } = usePinnedIssues();
  const sortedIssueIds = useMemo(() => {
    if (!issueIds || issueIds.length === 0) return issueIds;
    if (pinnedSet.size === 0) return issueIds;
    const pinned: string[] = [];
    const rest: string[] = [];
    for (const id of issueIds) (pinnedSet.has(id) ? pinned : rest).push(id);
    return pinned.length === 0 ? issueIds : [...pinned, ...rest];
  }, [issueIds, pinnedSet]);

  return (
    <>
      {sortedIssueIds && sortedIssueIds.length > 0 ? (
        <>
          {sortedIssueIds.map((issueId, index) => {
            if (!issueId) return null;

            let draggableId = issueId;
            if (groupId) draggableId = `${draggableId}__${groupId}`;
            if (sub_group_id) draggableId = `${draggableId}__${sub_group_id}`;

            return (
              <KanbanIssueBlock
                key={draggableId}
                issueId={issueId}
                groupId={groupId}
                subGroupId={sub_group_id}
                shouldRenderByDefault={index <= 10}
                issuesMap={issuesMap}
                displayProperties={displayProperties}
                updateIssue={updateIssue}
                quickActions={quickActions}
                draggableId={draggableId}
                canDropOverIssue={canDropOverIssue}
                canDragIssuesInCurrentGrouping={canDragIssuesInCurrentGrouping}
                canEditProperties={canEditProperties}
                scrollableContainerRef={scrollableContainerRef}
                isEpic={isEpic}
              />
            );
          })}
        </>
      ) : null}
    </>
  );
});
