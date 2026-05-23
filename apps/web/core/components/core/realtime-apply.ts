/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// BARSOUL 看板実時失効: 外科手術的単カード更新。
// SSE が運んだ変更 issue id を realtimeBus.drain で取り出し、その id
// だけ Plane API(retrieveIssues = GET /list/?issues=)で取得し、
// Plane 自身が「自分でカードを編集/ドラッグした時」に使う単 issue
// store 更新経路(issuesMap upsert + updateIssueList の group 再配置)
// をそのまま再利用 = 該当カードのみ動く。看板全体の再フェッチ・
// 再レンダは起こさない(= ユーザ指摘「1枚動かすと全カード再描画」の根治)。
//
// updateIssueList は Plane の issueUpdate(ローカル ドラッグ/編集)が
// 呼ぶのと同一メソッド。差異は API PATCH を呼ばない点のみ(変更は
// 既にサーバ側で発生済・我々はリモート観測者)。
//
// フェイルセーフ(正しさ優先): 取得失敗 / 要求 id が返らない(削除 or
// 現フィルタ外)/ 再接続 resync は粗粒度(従来の fetchIssues("mutation")
// 全体再取得)へ退化。ホットパス(別列へドラッグ・優先度変更等、当該
// issue が返る)は純外科手術。

import { runInAction } from "mobx";
import { EIssueServiceType } from "@plane/types";
import type { TIssue } from "@plane/types";
import { IssueService } from "@/services/issue";
// EIssueGroupedAction: Plane 自身の新規作成経路が
//   `updateIssueList(issue, undefined, EIssueGroupedAction.ADD)` で
//   使うのと同一の "明示 ADD" 指定。非グループ化ボード
//   (spreadsheet/gantt/非 group_by list)は action 無しだと
//   getUpdateDetails が ALL_ISSUES へ ADD を返さない(= 新規カードが
//   外科手術で出ない)。before 不在=このクライアントにとって新規 →
//   明示 ADD で確実に追加。
import { EIssueGroupedAction } from "@/store/issue/helpers/base-issues.store";
import { realtimeBus } from "./realtime-bus";

// Plane の view store(BaseIssuesStore 派生: ProjectIssues/CycleIssues/…)
// から実時更新に必要な最小構造のみを構造的に要求(型結合を最小化し
// 将来の Plane アップグレード耐性を上げる)。
export type RTViewStore = {
  rootIssueStore: {
    issues: {
      getIssueById: (issueId: string) => TIssue | undefined;
      addIssue: (issues: TIssue[]) => void;
      removeIssue: (issueId: string) => void;
    };
  };
  updateIssueList: (
    issue?: TIssue,
    issueBeforeUpdate?: TIssue,
    action?: EIssueGroupedAction.ADD | EIssueGroupedAction.DELETE
  ) => void;
  // Plane 自身が「自分でカードを削除した時」に使う surgical な
  //   group 配列からの ID 除去(全板再取得しない)。realtime 削除も
  //   これを再利用 = 該当カードだけ消える(= move と同じ体験)。
  removeIssueFromList: (issueId: string) => void;
};

export async function applyRealtimeBoardUpdate(opts: {
  store: RTViewStore;
  workspaceSlug: string;
  projectId: string;
  isEpic: boolean;
  /** 単差分が成立しない場合の退避: その layout の fetchIssues("mutation",…)。 */
  coarseRefetch: () => void;
}): Promise<void> {
  const { store, workspaceSlug, projectId, isEpic, coarseRefetch } = opts;
  if (!workspaceSlug || !projectId) return;

  const drained = realtimeBus.drain(projectId);
  if (drained.kind === "none") return;
  if (drained.kind === "coarse") {
    coarseRefetch();
    return;
  }

  const ids = drained.ids;

  // 変更前スナップショット。addIssue が issuesMap を merge する前に取る
  // 必要(updateIssueList は old/new の group 値差から再配置先を決める)。
  // getUpdateDetails は scalar/array の group フィールドしか読まないので
  // 浅いコピーで十分(古い配列参照は merge で別実体に置換され不変)。
  const before: Record<string, TIssue | undefined> = {};
  for (const id of ids) {
    const cur = store.rootIssueStore.issues.getIssueById(id);
    before[id] = cur ? ({ ...cur } as TIssue) : undefined;
  }

  let fresh: TIssue[];
  try {
    const svc = new IssueService(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
    fresh = await svc.retrieveIssues(workspaceSlug, projectId, ids);
  } catch {
    coarseRefetch(); // 取得失敗 → 安全に粗粒度退化
    return;
  }

  const list = Array.isArray(fresh) ? fresh : [];
  const returned = new Set(list.map((f) => f.id));
  // 要求 id が返らない = 削除済 or 現フィルタ外(状態変化で板から外れた等)。
  //   どちらも「この板から当該カードを消す」が正しい挙動なので、
  //   Plane 自身が自分で削除した時に使う surgical 経路
  //   (removeIssueFromList + issuesMap.removeIssue)をそのまま再利用。
  //   ★粗粒度 fetchIssues は使わない = 全カード再描画を起こさない
  //   (= ユーザ指摘「1枚消して全板リフレッシュ」の根治。move と同体験)。
  const missing = ids.filter((id) => !returned.has(id));

  runInAction(() => {
    for (const id of missing) {
      store.removeIssueFromList(id); // group 配列から当該 ID のみ除去
      store.rootIssueStore.issues.removeIssue(id); // issuesMap から除去
    }
    store.rootIssueStore.issues.addIssue(list); // issuesMap に当該カードのみ upsert
    for (const f of list) {
      const prev = before[f.id];
      if (prev) {
        // 既存 = 更新/移動。old/new の差分から group 再配置
        //   (action 無し → ADD/DELETE/REORDER を自動判定)。
        store.updateIssueList(f, prev);
      } else {
        // 不在 = このクライアントにとって新規(他者が作成 or 未ロード)。
        //   明示 ADD。グループ化ボードは新 group へ、非グループ化
        //   ボードは ALL_ISSUES へ確実に追加(Plane 自身の作成経路と同一)。
        store.updateIssueList(f, undefined, EIssueGroupedAction.ADD);
      }
    }
  });
}
