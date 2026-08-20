/**
 * BARSOUL 2026-08 — 「この行の直後」に来る並び順(todo_order)を求める。
 *
 * 前後の中点を取るだけ。全行の振り直しをしないので、1 回の挿入や
 * 並べ替えで飛ぶ PATCH は常に 1 本で済む。float なので中点は尽きない。
 */
import { DEFAULT_TODO_ORDER } from "@/store/issue/workspace-draft/issue.store";

/** 端に置く時の刻み。前後どちらかしか無い場合に使う。 */
const STEP = 1000;

export const orderBetween = (before: number | undefined, after: number | undefined): number => {
  if (before !== undefined && after !== undefined) return (before + after) / 2;
  if (before !== undefined) return before + STEP;
  if (after !== undefined) return after - STEP;
  return 0;
};

/**
 * 並び(表示順の id 配列)の中で、`afterId` の直後に入る値。
 * `afterId` が undefined = 先頭に置く(その欄が出るのも先頭なので、
 * 見えている位置と入る位置が食い違わない)。
 */
export const orderAfter = (
  siblingIds: string[],
  afterId: string | undefined,
  orderOf: (issueId: string) => number | undefined
): number => {
  const index = afterId ? siblingIds.indexOf(afterId) : -1;
  const before = index >= 0 ? (orderOf(siblingIds[index]) ?? DEFAULT_TODO_ORDER) : undefined;
  const after = index + 1 < siblingIds.length ? (orderOf(siblingIds[index + 1]) ?? DEFAULT_TODO_ORDER) : undefined;
  return orderBetween(before, after);
};
