/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// BARSOUL peer-sync ブリッジ: peer-sync(transport/疎結合)と Plane の
// MobX store を繋ぐ唯一の場所。store にアクセスできる React 文脈
// (StoreProvider 内)で op 種別ハンドラを登録する。peer から届いた
// op を Plane 自身の冪等な store mutator にそのまま適用 = 操作窓口と
// 同じ最終状態(最善努力 UI 状態同期)。ハンドラは再 broadcast しない
// ので無限ループしない(broadcast は user action 側のみ)。
//
// 新しい op 種別の対応 = ここに register を 1 つ足すだけ。

import { useEffect } from "react";
import { useWorkspaceNotifications } from "@/hooks/store/notifications/use-workspace-notifications";
import { peerSync, type PeerOp } from "./peer-sync";

export const PeerSyncBridge = () => {
  const workspaceNotification = useWorkspaceNotifications();

  useEffect(() => {
    // 通知: 既読/未読/帰档/解帰档/snooze。発信側 store action が
    //   楽観更新で使った patch をそのまま冪等適用(対象未ロードなら
    //   no-op = 次回 fetch で是正、最善努力)。
    const offNotif = peerSync.register("notif.mutate", (op: PeerOp) => {
      try {
        const nid = typeof op.nid === "string" ? op.nid : undefined;
        const patch = op.patch && typeof op.patch === "object" ? (op.patch as Record<string, unknown>) : undefined;
        if (!nid || !patch) return;
        const n = workspaceNotification?.notifications?.[nid];
        if (n && typeof n.mutateNotification === "function") {
          n.mutateNotification(patch);
        }
      } catch {
        /* fail-safe: peer-sync は Plane を壊さない */
      }
    });

    return () => {
      offNotif();
    };
  }, [workspaceNotification]);

  return null;
};
