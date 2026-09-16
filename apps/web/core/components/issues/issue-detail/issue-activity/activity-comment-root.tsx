/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
// plane imports
import type { E_SORT_ORDER, TActivityFilters, EActivityFilterType } from "@plane/constants";
import { BASE_ACTIVITY_FILTER_TYPES, filterActivityOnSelectedFilters } from "@plane/constants";
import type { TCommentsOperations } from "@plane/types";
// components
import { CommentCard } from "@/components/comments/card/root";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// plane web components
import { IssueAdditionalPropertiesActivity } from "@/plane-web/components/issues/issue-details/issue-properties-activity";
import { IssueActivityWorklog } from "@/plane-web/components/issues/worklog/activity/root";
// local imports
import { IssueActivityItem } from "./activity/activity-list";
import { IssueActivityLoader } from "./loader";

type TIssueActivityCommentRoot = {
  workspaceSlug: string;
  projectId: string;
  isIntakeIssue: boolean;
  issueId: string;
  selectedFilters: TActivityFilters[];
  activityOperations: TCommentsOperations;
  showAccessSpecifier?: boolean;
  disabled?: boolean;
  sortOrder: E_SORT_ORDER;
};

export const IssueActivityCommentRoot = observer(function IssueActivityCommentRoot(props: TIssueActivityCommentRoot) {
  const {
    workspaceSlug,
    isIntakeIssue,
    issueId,
    selectedFilters,
    activityOperations,
    showAccessSpecifier,
    projectId,
    disabled,
    sortOrder,
  } = props;
  // store hooks
  const {
    activity: { getActivityAndCommentsByIssueId },
    comment: { getCommentById },
    scrollToActivityCommentId,
    setScrollToActivityCommentId,
  } = useIssueDetail();

  // BARSOUL: 通知中心点击某条 → 这里自动滚到对应评论/活动并短暂高亮。
  // 活动feed异步加载，故有界轮询等元素入 DOM 再滚（最长~6s），完成清除
  // store 目标避免重复触发。Hooks 规则: effect 必须在任何 early return 之前。
  useEffect(() => {
    if (!scrollToActivityCommentId) return;
    const target = scrollToActivityCommentId;
    let tries = 0;
    let cancelled = false;
    let timer: number | undefined;
    const tick = () => {
      if (cancelled) return;
      const el = document.getElementById(`ac-${target}`);
      if (el) {
        // BARSOUL 2026-09-16: smooth scroll は途中で止まる —— 本文の画像やリンクカードが
        // 遅れて読み込まれ、レイアウトが動いた瞬間にブラウザがアニメーションを捨てる
        // (実測: 53 件の feed で本文の途中に取り残された)。だから 1 回撃って終わりに
        // せず、着くまで ~3.5 秒は見張り、ずれていれば即時スクロールで引き戻す。
        // ハイライトは **着いてから** 点ける(道中で消えてしまわないように)。
        const HL = "color-mix(in oklab, var(--bg-accent-primary) 14%, transparent)";
        const offCenter = () => {
          const b = el.getBoundingClientRect();
          return b.top + b.height / 2 - window.innerHeight / 2;
        };
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        let settleTries = 0;
        let lastOff = offCenter();
        let lit = false;
        const light = () => {
          if (lit) return;
          lit = true;
          el.style.borderRadius = "6px";
          el.style.transition = "background-color .7s ease";
          el.style.backgroundColor = HL;
          window.setTimeout(() => {
            el.style.transition = "background-color 1.4s ease";
            el.style.backgroundColor = "";
          }, 2200);
        };
        // ★ この見張りは effect の cleanup に繋がない —— 直後の setScrollToActivityCommentId(undefined)
        //   で依存が変わり cleanup(cancelled=true)が走るため。要素が DOM から外れたら自然に止まる。
        const settle = () => {
          if (!el.isConnected) return;
          const off = offCenter();
          const arrived = Math.abs(off) < 80 || (el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().bottom <= window.innerHeight);
          if (arrived) {
            light();
            return;
          }
          // 動いていない = smooth が捨てられた → 即時で引き戻す
          if (Math.abs(off - lastOff) < 4) el.scrollIntoView({ behavior: "auto", block: "center" });
          lastOff = off;
          if (settleTries++ < 10) window.setTimeout(settle, 350);
          else light();
        };
        window.setTimeout(settle, 350);
        setScrollToActivityCommentId(undefined);
        return;
      }
      if (tries++ < 24) timer = window.setTimeout(tick, 250);
      else setScrollToActivityCommentId(undefined);
    };
    timer = window.setTimeout(tick, 150);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [scrollToActivityCommentId, setScrollToActivityCommentId]);

  // derived values
  const activityAndComments = getActivityAndCommentsByIssueId(issueId, sortOrder);

  if (!activityAndComments) return <IssueActivityLoader />;

  if (activityAndComments.length <= 0) return null;

  const filteredActivityAndComments = filterActivityOnSelectedFilters(activityAndComments, selectedFilters);

  return (
    <div>
      {filteredActivityAndComments.map((activityComment, index) => {
        const comment = getCommentById(activityComment.id);
        const ends = index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined;
        const node =
          activityComment.activity_type === "COMMENT" ? (
            <CommentCard
              workspaceSlug={workspaceSlug}
              entityId={issueId}
              comment={comment}
              activityOperations={activityOperations}
              ends={ends}
              showAccessSpecifier={!!showAccessSpecifier}
              showCopyLinkOption={!isIntakeIssue}
              disabled={disabled}
              projectId={projectId}
              enableReplies
            />
          ) : BASE_ACTIVITY_FILTER_TYPES.includes(activityComment.activity_type as EActivityFilterType) ? (
            <IssueActivityItem activityId={activityComment.id} ends={ends} />
          ) : activityComment.activity_type === "ISSUE_ADDITIONAL_PROPERTIES_ACTIVITY" ? (
            <IssueAdditionalPropertiesActivity activityId={activityComment.id} ends={ends} />
          ) : activityComment.activity_type === "WORKLOG" ? (
            <IssueActivityWorklog
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              issueId={issueId}
              activityComment={activityComment}
              ends={ends}
            />
          ) : null;
        // BARSOUL: 稳定锚点，供通知点击后滚动定位（scroll-mt 让其不被
        // 顶部 sticky 区遮挡）。
        return (
          <div key={activityComment.id} id={`ac-${activityComment.id}`} className="scroll-mt-20 rounded-sm">
            {node}
          </div>
        );
      })}
    </div>
  );
});
