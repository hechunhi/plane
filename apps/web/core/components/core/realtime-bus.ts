/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// BARSOUL 看板実時失効バス(外科手術版)。
// Plane の看板/列表/表計算/ガント/カレンダーは issues を useSWR ではなく
// `useEffect → store.fetchIssues(...)` で命令的に取得する(SWR キー無し)。
// ゆえに SWR mutate では再取得できない。
//
// 設計2層:
//  1) numeric version(useSyncExternalStore・observer 非依存・堅牢)で
//     各 base layout root の effect を確実に発火させる "trigger" 専用。
//  2) project 毎の変更 issue id 集合を別途集積し、effect 内で命令的に
//     drain → その id だけ Plane API で取得し Plane 自身の単 issue
//     store 更新経路(updateIssueList)で該当カードのみ差し替える
//     = 看板全体の再フェッチ/再レンダを起こさない外科手術。
//  id が無い/削除等で単差分が不正になる場合のみ粗粒度(全体再取得)に
//  退化 = 正しさ優先のフェイルセーフ。

import { useSyncExternalStore } from "react";

type Listener = () => void;

const versions = new Map<string, number>();
// コメント実時: issue id 毎の世代。当該 issue にコメント変更が来たら
// bump → その issue の詳細/peek パネルが開いていれば(=パネル component
// がマウント中なら)comment store を静かに再取得。看板には波及しない。
const commentVersions = new Map<string, number>();
const listeners = new Set<Listener>();

// グローバル世代: SSE 再接続時に全ボードを一括 resync するための値。
// 接続断の隙間で取りこぼした変更を、再接続後に必ず追従させる(鲁棒性の要)。
let generation = 0;

// 外科手術チャネル: SSE が運ぶ変更 issue id を project 毎に集積。
// React スナップショット同一性問題を避けるため purely 命令的に
// effect 内で drain する(numeric version は trigger 専用に温存)。
const pendingIds = new Map<string, Set<string>>();
// 当該 project は粗粒度(全体再取得)必須 = 削除/フィルタ外れ/再接続等、
// 単カード差分では正しさを担保できないケース。
const coarseProjects = new Set<string>();
// 再接続 resync: 次回 drain は全 project 粗粒度(取りこぼし防止の要)。
let coarseAll = false;

function notify(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* listener 例外は隔離(他購読者に波及させない) */
    }
  });
}

export type RealtimeDrain =
  | { kind: "coarse" } // 全体再取得へ退化(削除/再接続/不明)
  | { kind: "ids"; ids: string[] } // この id だけ外科手術更新
  | { kind: "none" }; // 当該 project に保留無し(何もしない)

export const realtimeBus = {
  /**
   * SSE invalidate 受信時に呼ぶ。
   * @param ids 変更 issue id 配列。null/空 = 単差分不可(粗粒度退化)。
   */
  bump(projectId: string, ids: string[] | null): void {
    if (!projectId) return;
    if (ids === null || ids.length === 0) {
      coarseProjects.add(projectId);
    } else {
      let set = pendingIds.get(projectId);
      if (!set) {
        set = new Set<string>();
        pendingIds.set(projectId, set);
      }
      for (const id of ids) if (id) set.add(id);
    }
    versions.set(projectId, (versions.get(projectId) || 0) + 1);
    notify();
  },
  /**
   * SSE comments[issueId] 受信時に呼ぶ。当該 issue の購読者(開いている
   * 詳細/peek パネル)だけを起こす。パネル未オープン = 購読者無し = no-op。
   */
  bumpComment(issueId: string): void {
    if (!issueId) return;
    commentVersions.set(issueId, (commentVersions.get(issueId) || 0) + 1);
    notify();
  },
  /** SSE 再接続時に呼ぶ。世代を進め全ボードを一回粗粒度 resync(隙間取りこぼし防止)。 */
  bumpAll(): void {
    generation += 1;
    coarseAll = true;
    notify();
  },
  /**
   * effect 内で命令的に呼ぶ。当該 project の保留を取り出して消費。
   * coarse(削除/再接続/不明)→ 呼び元は従来の fetchIssues("mutation")。
   * ids → 呼び元はその id のみ外科手術更新。
   */
  drain(projectId: string | undefined): RealtimeDrain {
    if (!projectId) return { kind: "none" };
    if (coarseAll) {
      coarseAll = false;
      coarseProjects.delete(projectId);
      pendingIds.delete(projectId);
      return { kind: "coarse" };
    }
    if (coarseProjects.has(projectId)) {
      coarseProjects.delete(projectId);
      pendingIds.delete(projectId);
      return { kind: "coarse" };
    }
    const set = pendingIds.get(projectId);
    if (set && set.size > 0) {
      pendingIds.delete(projectId);
      return { kind: "ids", ids: Array.from(set) };
    }
    return { kind: "none" };
  },
  _subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  _get(projectId: string | undefined): number {
    // project 別カウント + グローバル世代 → どちらが進んでも依存値が変わる
    return (projectId ? versions.get(projectId) || 0 : 0) + generation;
  },
  _getComment(issueId: string | undefined): number {
    // issue 別コメント世代 + グローバル世代(再接続時=接続断中の
    // コメント取りこぼしを開いているパネルが補う)
    return (issueId ? commentVersions.get(issueId) || 0 : 0) + generation;
  },
};

/**
 * 当該 project の実時バージョン。SSE invalidate 毎に増える。
 * useSyncExternalStore ゆえ observer 不要・どの component でも確実に再レンダ
 * → 依存 effect 発火 → effect 内で realtimeBus.drain して外科手術更新。
 * projectId 無し(workspace 全体ビュー等)は常に 0(発火しない・SWR 経路別途)。
 */
export const useRealtimeVersion = (projectId: string | undefined): number =>
  useSyncExternalStore(
    realtimeBus._subscribe,
    () => realtimeBus._get(projectId),
    () => 0 // SSR/初期スナップショット(prerender は 0)
  );

/**
 * 当該 issue のコメント実時世代。SSE comments[issueId] 毎 / 再接続毎に増。
 * 詳細/peek パネル component(= 開いている時だけマウント)が依存に持ち、
 * 変化したら自分の comment store だけ静かに再取得する。看板非波及。
 */
export const useRealtimeCommentVersion = (issueId: string | undefined): number =>
  useSyncExternalStore(
    realtimeBus._subscribe,
    () => realtimeBus._getComment(issueId),
    () => 0
  );
