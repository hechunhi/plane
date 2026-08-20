/**
 * BARSOUL 2026-08 — ToDo リストの「手」の部分をまとめた場所。
 *
 * ここが持つのは 3 つだけ:
 *   1. どの行の入力欄が今どこに居るか(= フォーカスを次/前の行へ渡すため)
 *   2. どの親を開いているか(子タスクの畳み/開き)
 *   3. 新しい行を書き込む欄(composer)を今どこに出しているか
 *
 * 行そのものは自分の状態しか知らない。行を跨ぐ操作(Enter で下に足す、
 * ↑↓ で行を移る、Tab で子にする)は必ずここを経由する —— そうしないと
 * 行同士が互いの ref を探し始めて、すぐに手が付けられなくなる。
 *
 * 並び順(order)は **表示されている順** をそのまま配列で受け取る。木を
 * 辿り直さないのは、畳まれた子を飛ばす判断を 2 箇所に置きたくないから。
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/** 新しい行を書き込む欄を、どの親の下の・どの行の直後に出すか。 */
export type TTodoComposer = {
  /** null = トップレベル。 */
  parentId: string | null;
  /** undefined = その並びの一番下に足す。 */
  afterId: string | undefined;
};

type TTodoListContext = {
  // フォーカス
  registerRow: (issueId: string, element: HTMLTextAreaElement | null) => void;
  focusRow: (issueId: string, caret?: "start" | "end") => boolean;
  /** 表示順で 1 つ隣の行。端なら undefined。 */
  neighbourOf: (issueId: string, direction: -1 | 1) => string | undefined;
  setVisibleOrder: (issueIds: string[]) => void;
  // 子タスクの畳み
  isExpanded: (issueId: string) => boolean;
  setExpanded: (issueId: string, value: boolean) => void;
  toggleExpanded: (issueId: string) => void;
  // 新しい行
  composer: TTodoComposer | null;
  openComposer: (composer: TTodoComposer) => void;
  closeComposer: () => void;
};

const TodoListContext = createContext<TTodoListContext | null>(null);

export const useTodoList = () => {
  const context = useContext(TodoListContext);
  if (!context) throw new Error("useTodoList must be used inside <TodoListProvider>");
  return context;
};

export const TodoListProvider = function TodoListProvider({ children }: { children: React.ReactNode }) {
  // 入力欄の実体。ref に入れる = 行が増減しても再描画を起こさない。
  const rowsRef = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const orderRef = useRef<string[]>([]);
  // 畳み状態と composer は見た目に効くので state。
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [composer, setComposer] = useState<TTodoComposer | null>(null);

  const registerRow = useCallback((issueId: string, element: HTMLTextAreaElement | null) => {
    if (element) rowsRef.current.set(issueId, element);
    else rowsRef.current.delete(issueId);
  }, []);

  const focusRow = useCallback((issueId: string, caret: "start" | "end" = "end") => {
    const element = rowsRef.current.get(issueId);
    if (!element) return false;
    element.focus();
    const position = caret === "start" ? 0 : element.value.length;
    // 行を移った直後は必ずキャレットを端に置く。押しっぱなしの ↑↓ で
    // 途中に取り残されると、次の 1 打が行内移動に化けて進まなくなる。
    element.setSelectionRange(position, position);
    return true;
  }, []);

  const neighbourOf = useCallback((issueId: string, direction: -1 | 1) => {
    const index = orderRef.current.indexOf(issueId);
    if (index < 0) return undefined;
    return orderRef.current[index + direction];
  }, []);

  const setVisibleOrder = useCallback((issueIds: string[]) => {
    orderRef.current = issueIds;
  }, []);

  const isExpanded = useCallback((issueId: string) => expandedMap[issueId] ?? true, [expandedMap]);
  const setExpanded = useCallback((issueId: string, value: boolean) => {
    setExpandedMap((previous) => ({ ...previous, [issueId]: value }));
  }, []);
  const toggleExpanded = useCallback((issueId: string) => {
    setExpandedMap((previous) => ({ ...previous, [issueId]: !(previous[issueId] ?? true) }));
  }, []);

  const openComposer = useCallback((next: TTodoComposer) => setComposer(next), []);
  const closeComposer = useCallback(() => setComposer(null), []);

  const value = useMemo<TTodoListContext>(
    () => ({
      registerRow,
      focusRow,
      neighbourOf,
      setVisibleOrder,
      isExpanded,
      setExpanded,
      toggleExpanded,
      composer,
      openComposer,
      closeComposer,
    }),
    [
      registerRow,
      focusRow,
      neighbourOf,
      setVisibleOrder,
      isExpanded,
      setExpanded,
      toggleExpanded,
      composer,
      openComposer,
      closeComposer,
    ]
  );

  return <TodoListContext.Provider value={value}>{children}</TodoListContext.Provider>;
};
