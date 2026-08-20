/**
 * BARSOUL 2026-08 — 行を並べる所。ここが持つ仕事は 2 つだけ。
 *
 *   1. **今見えている順** を context に渡す(↑↓ で行を移るのに要る)。
 *      畳まれた子は入れない —— 見えていない行にキャレットが飛ぶと、
 *      画面は動いていないのに打った字がどこかへ消える。
 *   2. 一番上に開く composer を出す。行の直後に開く分は行が自分で出す。
 */
import { useEffect } from "react";
import { observer } from "mobx-react";
// hooks
import { useWorkspaceDraftIssues } from "@/hooks/store/workspace-draft";
// local imports
import { TodoComposer } from "./composer";
import { useTodoList } from "./context";
import { TodoRow } from "./row";

type Props = {
  workspaceSlug: string;
  issueIds: string[];
  /** 完了した ToDo の引き出しの中。並べ替えも子も出さない。 */
  isInCompletedDrawer?: boolean;
};

export const TodoList = observer(function TodoList(props: Props) {
  const { workspaceSlug, issueIds, isInCompletedDrawer = false } = props;
  const { getSubIssueIds } = useWorkspaceDraftIssues();
  const { setVisibleOrder, isExpanded, composer } = useTodoList();

  // 見えている順を平らにする。子は開いている親の下だけ。
  const visibleOrder = isInCompletedDrawer
    ? issueIds
    : issueIds.flatMap((issueId) => (isExpanded(issueId) ? [issueId, ...getSubIssueIds(issueId)] : [issueId]));

  useEffect(() => {
    if (!isInCompletedDrawer) setVisibleOrder(visibleOrder);
    // 中身が変わった時だけ入れ直す。配列の同一性で回すと毎描画で書き込む。
  }, [isInCompletedDrawer, setVisibleOrder, visibleOrder.join(",")]);

  return (
    <div className="relative">
      {/* 一番上に足す欄(afterId 無し = この並びの先頭)。 */}
      {!isInCompletedDrawer && composer?.parentId === null && composer.afterId === undefined && (
        <TodoComposer workspaceSlug={workspaceSlug} parentId={null} afterId={undefined} />
      )}
      {issueIds.map((issueId) => (
        <TodoRow
          key={issueId}
          workspaceSlug={workspaceSlug}
          issueId={issueId}
          depth={0}
          isInCompletedDrawer={isInCompletedDrawer}
        />
      ))}
    </div>
  );
});
