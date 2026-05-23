/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// BARSOUL peer-sync: 跨クライアント UI 状態同期の汎用層。
//
// 思想(ユーザの再定義に基づく): これは DB 強整合ではなく「跨ブラウザ
// の前端 UI 状態同期」要件。Plane の webhook 発火に依存する従来路は
// Plane CE が多くの mutation で webhook を出さないため永遠に穴が残る。
// 代わりに【全 mutation が必ず通る前端 store action 層】を choke point
// にする: ユーザが SPA で操作 → その store が楽観的ローカル更新を行う
// (= 操作窓口が即時反映される所以)→ その直後に本層で操作を peer へ
// ブロードキャスト → peer は同じ store mutation を冪等に適用。
//
// 新しい op の対応 = その action 1 箇所で broadcastOp を呼ぶだけ。
// Plane backend にも webhook にも DB にも一切依存しない = この class
// (削除/帰档/通知/子資源… が同期しない)の構造的根絶。
//
// 輸送: 同一ブラウザ多タブ = BroadcastChannel(無料・即時)。
//   跨ブラウザ/端末 = 既存 realtime-sse リレー(POST /__rt/op →
//   SSE `event: op` で全 client へ fan-out。Caddy+Authelia 保護)。
// 最善努力: 取りこぼしは次回ロード/手動更新/既存 invalidate 経路で
//   是正。強整合は要件外。失敗は全て握り潰し(Plane を阻害しない)。

export type PeerOp = {
  id: string; // 一意。BroadcastChannel と SSE 双方経由の重複排除に使用
  origin: string; // 発信タブ識別。自分発の op は適用しない(既に適用済)
  t: string; // op 種別(例 "notif.read" / "issue.delete" / "comment.touch")
  ts: number;
  [k: string]: unknown; // 種別ごとの payload(server は不透明・素通し)
};

type Handler = (op: PeerOp) => void;

const RT_OP_URL = "/__rt/op";

// このタブの一意 origin(自分発の op を弾く)
const ORIGIN = `t_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

// 種別 → ハンドラ。store にアクセスできる React ブリッジが登録する
//   (peer-sync 自体は store を知らない = 疎結合・アップグレード耐性)。
const handlers = new Map<string, Set<Handler>>();

// 直近適用済 op id(BroadcastChannel と SSE の二重到達を排除)。
const seen = new Set<string>();
const seenOrder: string[] = [];
function markSeen(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  seenOrder.push(id);
  if (seenOrder.length > 512) {
    const old = seenOrder.shift();
    if (old) seen.delete(old);
  }
  return true;
}

let bc: BroadcastChannel | null = null;
function getBC(): BroadcastChannel | null {
  if (bc) return bc;
  try {
    if (typeof BroadcastChannel === "undefined") return null;
    bc = new BroadcastChannel("barsoul-peer-sync");
    bc.onmessage = (ev) => dispatchIncoming(ev.data as PeerOp);
  } catch {
    bc = null;
  }
  return bc;
}

function dispatchIncoming(op: PeerOp | null | undefined): void {
  try {
    if (!op || typeof op !== "object" || !op.id || !op.t) return;
    if (op.origin === ORIGIN) return; // 自分発 = 既にローカル適用済
    if (!markSeen(op.id)) return; // 重複(別経路で既受信)
    const set = handlers.get(op.t);
    if (!set) return;
    set.forEach((h) => {
      try {
        h(op);
      } catch {
        /* ハンドラ例外は隔離 */
      }
    });
  } catch {
    /* fail-safe: peer-sync は決して Plane を壊さない */
  }
}

export const peerSync = {
  /** 種別ハンドラ登録。戻り値で解除。store アクセス可能な React ブリッジから呼ぶ。 */
  register(type: string, handler: Handler): () => void {
    let set = handlers.get(type);
    if (!set) {
      set = new Set();
      handlers.set(type, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  },

  /**
   * 楽観的ローカル更新の【直後】に store action から呼ぶ。
   * 同一ブラウザ多タブ即時 + 跨ブラウザ(realtime-sse)へ配布。
   * 自タブは何もしない(既に適用済)。全失敗は握り潰し。
   */
  broadcast(t: string, payload: Record<string, unknown>): void {
    try {
      const op: PeerOp = {
        id: `${ORIGIN}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        origin: ORIGIN,
        t,
        ts: Date.now(),
        ...payload,
      };
      markSeen(op.id); // 自分発も seen に積み二重適用を防ぐ
      try {
        getBC()?.postMessage(op);
      } catch {
        /* noop */
      }
      try {
        const body = JSON.stringify(op);
        // keepalive: タブ遷移中でも送り切る。応答は不要(最善努力)。
        void fetch(RT_OP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
          credentials: "same-origin",
        }).catch(() => {});
      } catch {
        /* noop */
      }
    } catch {
      /* fail-safe */
    }
  },

  /** realtime-sse の `op` SSE フレーム受信時に RealtimeSync から呼ぶ。 */
  ingestRemote(raw: string): void {
    let op: PeerOp | null = null;
    try {
      op = JSON.parse(raw) as PeerOp;
    } catch {
      return;
    }
    dispatchIncoming(op);
  },

  /** 同一ブラウザ多タブ受信を有効化(冪等)。 */
  ensureLocalChannel(): void {
    getBC();
  },
};
