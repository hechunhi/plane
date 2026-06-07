/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane helpers
import { MoreHorizontal } from "lucide-react";
import { useOutsideClickDetector } from "@plane/hooks";
// types
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssue, IIssueDisplayProperties, IIssueMap } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// ui
import { ControlLink, DropIndicator } from "@plane/ui";
import { cn, generateWorkItemLink } from "@plane/utils";
// components
import RenderIfVisible from "@/components/core/render-if-visible-HOC";
import { HIGHLIGHT_CLASS, getIssueBlockId } from "@/components/issues/issue-layouts/utils";
// helpers
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useKanbanView } from "@/hooks/store/use-kanban-view";
import { useProject } from "@/hooks/store/use-project";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
// BARSOUL: 未読関連 helper (IssueUnreadBadge は廃止 — v6 では border+bold)
import {
  useIssueUnreadCount,
  useIssueUnreadKind,
  isMutedState,
} from "@/components/notifications/issue-unread-badge";
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { usePinnedIssues } from "@/hooks/store/use-pinned-issues";
// BARSOUL ADR-029: 凍結カード(審査中) UX
import { useIssueApproval } from "@/hooks/use-issue-approval";
import { ApproverTitle } from "@/components/issues/approver-title";
// BARSOUL IUTEYA-9: Pin/収藏 ボタン
import { PinButton } from "@/components/issues/pin-button";
import { useProjectState } from "@/hooks/store/use-project-state";
// local components
import { IssueStats } from "@/plane-web/components/issues/issue-layouts/issue-stats";
import type { TRenderQuickActions } from "../list/list-view-types";
import { IssueProperties } from "../properties/all-properties";
import { WithDisplayPropertiesHOC } from "../properties/with-display-properties-HOC";
// BARSOUL DIS: 派生卡片当前态 摘要条 + 全局浮层控制器(整卡 hover 触发)
import { AICardBar, aiPopover, getCachedAIState } from "./ai-state-line";

interface IssueBlockProps {
  issueId: string;
  groupId: string;
  subGroupId: string;
  issuesMap: IIssueMap;
  displayProperties: IIssueDisplayProperties | undefined;
  draggableId: string;
  canDropOverIssue: boolean;
  canDragIssuesInCurrentGrouping: boolean;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  canEditProperties: (projectId: string | undefined) => boolean;
  scrollableContainerRef?: MutableRefObject<HTMLDivElement | null>;
  shouldRenderByDefault?: boolean;
  isEpic?: boolean;
}

interface IssueDetailsBlockProps {
  cardRef: React.RefObject<HTMLElement>;
  issue: TIssue;
  displayProperties: IIssueDisplayProperties | undefined;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  isReadOnly: boolean;
  isEpic?: boolean;
}

const KanbanIssueDetailsBlock = observer(function KanbanIssueDetailsBlock(
  props: IssueDetailsBlockProps & { hasUnread?: boolean; isMentionUnread?: boolean }
) {
  const {
    cardRef, issue, updateIssue, quickActions, isReadOnly, displayProperties, isEpic = false,
    hasUnread = false, isMentionUnread = false,
  } = props;
  // refs
  const menuActionRef = useRef<HTMLDivElement | null>(null);
  // states
  const [isMenuActive, setIsMenuActive] = useState(false);
  // hooks
  const { isMobile } = usePlatformOS();
  // BARSOUL ADR-029 続: pending_approver はタイトル交互フェードで強提示.
  const { frozen: _kbDetailFrozen, myRole: _kbDetailRole } = useIssueApproval(issue?.id);
  const isPendingApprover = _kbDetailFrozen && _kbDetailRole === "pending_approver";

  const customActionButton = (
    <div
      ref={menuActionRef}
      className={`flex h-full w-full cursor-pointer items-center rounded-sm p-1 text-placeholder hover:bg-layer-1 ${
        isMenuActive ? "bg-layer-1 text-primary" : "text-secondary"
      }`}
      onClick={() => setIsMenuActive(!isMenuActive)}
    >
      <MoreHorizontal className="h-3.5 w-3.5" />
    </div>
  );

  // derived values
  const subIssueCount = issue?.sub_issues_count ?? 0;

  const handleEventPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  useOutsideClickDetector(menuActionRef, () => setIsMenuActive(false));

  return (
    <>
      <div className="relative flex items-center gap-1">
        {issue.project_id && (
          <IssueIdentifier
            issueId={issue.id}
            projectId={issue.project_id}
            size="xs"
            variant="tertiary"
            displayProperties={displayProperties}
          />
        )}
        {/* BARSOUL IUTEYA-9: ★ pin button (pinned→常時表示金色,未→hover ☆) */}
        <PinButton issueId={issue.id} projectId={issue.project_id} variant="card" />
        <div
          className={cn("absolute -top-1 right-0", {
            "hidden group-hover/kanban-block:block": !isMobile,
            "!block": isMenuActive,
          })}
          onClick={handleEventPropagation}
        >
          {quickActions({
            issue,
            parentRef: cardRef,
            customActionButton,
          })}
        </div>
      </div>

      <Tooltip tooltipContent={issue.name} isMobile={isMobile} renderByDefault={false}>
        {/* BARSOUL 未読 v6: タイトル太字 + ID 太字化(Gmail unread mail と同じ
            タイポ言語)。赤縁取り(親 card border) と合わせて 3 信号同時提示. */}
        <div
          className={cn("line-clamp-1 w-full text-body-sm-medium text-primary", {
            "!font-bold": hasUnread,
          })}
        >
          <ApproverTitle title={issue.name ?? ""} active={isPendingApprover} />
        </div>
      </Tooltip>

      <IssueProperties
        className="flex flex-wrap items-center gap-2 pt-1.5 whitespace-nowrap text-tertiary"
        issue={issue}
        displayProperties={displayProperties}
        activeLayout="Kanban"
        updateIssue={updateIssue}
        isReadOnly={isReadOnly}
        isEpic={isEpic}
      />

      {/* BARSOUL DIS v3: AI 当前态摘要条(卡底 footer)。整卡 hover → 全局富浮层 */}
      {issue.project_id && <AICardBar issueId={issue.id} projectId={issue.project_id} />}

      {isEpic && displayProperties && (
        <WithDisplayPropertiesHOC
          displayProperties={displayProperties}
          displayPropertyKey="sub_issue_count"
          shouldRenderProperty={(properties) => !!properties.sub_issue_count && !!subIssueCount}
        >
          <IssueStats issueId={issue.id} className="mt-2 font-medium text-tertiary" />
        </WithDisplayPropertiesHOC>
      )}
    </>
  );
});

export const KanbanIssueBlock = observer(function KanbanIssueBlock(props: IssueBlockProps) {
  const {
    issueId,
    groupId,
    subGroupId,
    issuesMap,
    displayProperties,
    canDropOverIssue,
    canDragIssuesInCurrentGrouping,
    updateIssue,
    quickActions,
    canEditProperties,
    scrollableContainerRef,
    shouldRenderByDefault,
    isEpic = false,
  } = props;

  const cardRef = useRef<HTMLAnchorElement | null>(null);
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // hooks
  const { getProjectIdentifierById } = useProject();
  const { getIsIssuePeeked } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);
  const { isMobile } = usePlatformOS();
  // BARSOUL 修復(2026-05-25): 通知データの prefetch trigger を
  // <IssueUnreadBadge> から本ブロックへ移管。badge を v6 で廃止した結果、
  // ensureBadgeNotifications が誰からも呼ばれず store 空 → 全カード "既読扱い"
  // のバグを起こしていた。_badgeWS Set ガード付きで idempotent (50カード mount
  // しても workspace 単位で 1 回しか fetch しない)。
  const { ensureBadgeNotifications } = useWorkspaceNotifications();
  // BARSOUL IUTEYA-9: Pin/収藏 store も同じ idempotent prefetch.
  const { ensureFetched: ensurePinsFetched } = usePinnedIssues();
  useEffect(() => {
    if (workspaceSlug) {
      ensureBadgeNotifications(workspaceSlug);
      ensurePinsFetched(workspaceSlug);
    }
  }, [workspaceSlug, ensureBadgeNotifications, ensurePinsFetched]);

  // handlers
  const handleIssuePeekOverview = (issue: TIssue) => handleRedirection(workspaceSlug, issue, isMobile);

  const issue = issuesMap[issueId];

  const { setIsDragging: setIsKanbanDragging } = useKanbanView();

  const [isDraggingOverBlock, setIsDraggingOverBlock] = useState(false);
  const [isCurrentBlockDragging, setIsCurrentBlockDragging] = useState(false);

  const canEditIssueProperties = canEditProperties(issue?.project_id ?? undefined);

  // BARSOUL ADR-029: 凍結カード状態 (役割別 UX). frozen 時は拖拽禁止.
  const { frozen: isFrozen, myRole: frozenRole } = useIssueApproval(issue?.id);
  const isDragAllowed =
    canDragIssuesInCurrentGrouping && !issue?.tempId && canEditIssueProperties && !isFrozen;
  const projectIdentifier = getProjectIdentifierById(issue?.project_id);
  // BARSOUL: 未読更新があればカードに左端アクセントバー＋薄い底色を付与
  // （通知中心の未読行と同じ accent-primary 視覚言語。一覧で一目判別）。
  // A4: 已托管/已归档 等は静默（バー無し）。A1: mention は左バーを太く。
  const { getStateById: _getStateById } = useProjectState();
  const _kbState = _getStateById(issue?.state_id);
  const _kbMuted = isMutedState(_kbState?.name, _kbState?.group);
  const _kbKind = useIssueUnreadKind(issue?.id);
  const hasUnread = !_kbMuted && useIssueUnreadCount(issue?.id) > 0;
  const isMentionUnread = hasUnread && _kbKind === "mention";

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issue?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issue?.sequence_id,
    isEpic,
    isArchived: !!issue?.archived_at,
  });

  useOutsideClickDetector(cardRef, () => {
    cardRef?.current?.classList?.remove(HIGHLIGHT_CLASS);
  });

  // Make Issue block both as as Draggable and,
  // as a DropTarget for other issues being dragged to get the location of drop
  useEffect(() => {
    const element = cardRef.current;

    if (!element) return;

    return combine(
      draggable({
        element,
        dragHandle: element,
        canDrag: () => isDragAllowed,
        getInitialData: () => ({ id: issue?.id, type: "ISSUE" }),
        onDragStart: () => {
          setIsCurrentBlockDragging(true);
          setIsKanbanDragging(true);
        },
        onDrop: () => {
          setIsKanbanDragging(false);
          setIsCurrentBlockDragging(false);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source?.data?.id !== issue?.id && canDropOverIssue,
        getData: () => ({ id: issue?.id, type: "ISSUE" }),
        onDragEnter: () => {
          setIsDraggingOverBlock(true);
        },
        onDragLeave: () => {
          setIsDraggingOverBlock(false);
        },
        onDrop: () => {
          setIsDraggingOverBlock(false);
        },
      })
    );
  }, [cardRef?.current, issue?.id, isDragAllowed, canDropOverIssue, setIsCurrentBlockDragging, setIsDraggingOverBlock]);

  if (!issue) return null;

  return (
    <>
      <DropIndicator isVisible={!isCurrentBlockDragging && isDraggingOverBlock} />
      <div
        id={`issue-${issueId}`}
        // make Z-index higher at the beginning of drag, to have a issue drag image of issue block without any overlaps
        className={cn("group/kanban-block relative mb-2", { "z-[1]": isCurrentBlockDragging })}
        // BARSOUL DIS v3: 整卡 hover → 全局 AI 当前态浮层(仅当该卡有派生态时)
        onMouseEnter={(e) => {
          const st = issue?.id ? getCachedAIState(issue.id) : null;
          if (st && ((st.ball && st.state !== "UNKNOWN") || st.needs_info) && issue?.project_id) {
            aiPopover.show(issue.id, issue.project_id, e.currentTarget, {
              seq: issue.sequence_id ?? null,
              identifier: projectIdentifier ?? "",
              name: issue.name ?? "",
            });
          }
        }}
        onMouseLeave={() => aiPopover.hide()}
        onDragStart={() => {
          if (isDragAllowed) setIsCurrentBlockDragging(true);
          else {
            setToast({
              type: TOAST_TYPE.WARNING,
              title: "Cannot move work item",
              message: !canEditIssueProperties
                ? "You are not allowed to move this work item"
                : "Drag and drop is disabled for the current grouping",
            });
          }
        }}
      >
        <ControlLink
          id={getIssueBlockId(issueId, groupId, subGroupId)}
          href={workItemLink}
          ref={cardRef}
          className={cn(
            "relative block w-full rounded-lg border border-subtle bg-layer-2 p-3 text-13 shadow-raised-100 outline-[0.5px] outline-transparent transition-all hover:border-strong hover:shadow-raised-200",
            { "hover:cursor-pointer": isDragAllowed },
            { "border border-accent-strong hover:border-accent-strong": getIsIssuePeeked(issue.id) },
            // BARSOUL 未読 v6(2026-05-25, Gmail/Linear 流):
            //   カード境界線を赤に → 周辺視野で1発で "新着あり" と読める。
            //   ・通常未読: 1px 赤 solid border + 微弱 box-shadow ring
            //   ・@mention: 1.5px 赤 + ring 強め + pulse(行動要求)
            //   bg 染色は廃止 (子供っぽい)、bullet + 太字 title は子側で。
            hasUnread && !isMentionUnread &&
              "!border-[var(--bg-danger-primary)] hover:!border-[var(--bg-danger-primary)] shadow-[0_0_0_1px_var(--bg-danger-primary)]",
            isMentionUnread &&
              "!border-[var(--bg-danger-primary)] !border-[1.5px] hover:!border-[var(--bg-danger-primary)] shadow-[0_0_0_2px_var(--bg-danger-primary)]",
            { "z-[100] bg-layer-1": isCurrentBlockDragging },
            // BARSOUL ADR-029: 凍結カード(審査中) — 役割別視覚.
            //   pending_approver (要対応): 橙左バー4px + 8% 橙底色 + 微脈動
            //   initiator (発起人): 琥珀左バー3px + 5% 琥珀底色
            //   queued_approver (SEQ 待ち番): 琥珀左バー3px + 4% 底色 (弱)
            //   bystander (見守): 灰青左バー2px のみ (殆ど目立たない)
            // BARSOUL 色語(2026-05-25): 赤=未読(情報到達)、橙/琥珀=待行動
            // (審批 pending)、灰=傍観。pending_approver は赤から橙へ移行
            // して "新消息" 信号(red dot)と "要対応" 信号(amber bar)を分離。
            isFrozen && frozenRole === "pending_approver" && {
              "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[4px] before:rounded-l-lg before:bg-[#ea580c] before:content-[''] before:animate-pulse after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:bg-[#ea580c]/[0.08] after:content-['']":
                true,
            },
            isFrozen && frozenRole === "initiator" && {
              "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-lg before:bg-[#d97706] before:content-[''] after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:bg-[#d97706]/[0.05] after:content-['']":
                true,
            },
            isFrozen && frozenRole === "queued_approver" && {
              "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-lg before:bg-[#d97706]/70 before:content-['']":
                true,
            },
            isFrozen && frozenRole === "bystander" && {
              "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:rounded-l-lg before:bg-[#94a3b8] before:content-['']":
                true,
            },
            // frozen 時に hover:cursor-pointer を抑制(クリックは peek 開けるが
            // ドラッグ不可を視覚的に示す)
            isFrozen && "hover:cursor-not-allowed"
          )}
          onClick={() => handleIssuePeekOverview(issue)}
          disabled={!!issue?.tempId}
          title={
            isFrozen
              ? frozenRole === "pending_approver"
                ? "🔔 あなたの審査待ち — クリックして決定/詳細"
                : frozenRole === "queued_approver"
                ? "⏳ 順次審査 — 前の人が承認後にあなたの番"
                : frozenRole === "initiator"
                ? "📋 あなたが発起した審査が進行中 — クリックで状況"
                : "🔒 他人が審査中 — 操作不可"
              : undefined
          }
        >
          {/* BARSOUL 未読 v6.1: 呼吸 red dot を右上に再導入 — 但今度は
              赤縁取り + 太字 + 呼吸アニメ三位一体で "生きてる" 通知感.
              静的 dot だと "汚れ" だが、呼吸アニメ付きだと "意図的な信号" に
              読み替えられる(LINE / Twitter の live indicator 同様). */}
          {hasUnread && (
            <span
              aria-label={isMentionUnread ? "mention unread" : "unread"}
              className="barsoul-unread-breath pointer-events-none absolute right-2 top-2 z-10 rounded-full"
              style={{
                width: isMentionUnread ? 10 : 8,
                height: isMentionUnread ? 10 : 8,
                background: "var(--bg-danger-primary)",
              }}
            />
          )}
          <RenderIfVisible
            classNames="space-y-2"
            root={scrollableContainerRef}
            defaultHeight="100px"
            horizontalOffset={100}
            verticalOffset={200}
            defaultValue={shouldRenderByDefault}
          >
            <KanbanIssueDetailsBlock
              cardRef={cardRef}
              issue={issue}
              displayProperties={displayProperties}
              updateIssue={updateIssue}
              quickActions={quickActions}
              isReadOnly={!canEditIssueProperties}
              isEpic={isEpic}
              hasUnread={hasUnread}
              isMentionUnread={isMentionUnread}
            />
          </RenderIfVisible>
        </ControlLink>
      </div>
    </>
  );
});
