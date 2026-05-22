/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// BARSOUL 看板実時失効: realtime-sse(/__rt/stream, 同源・Authelia/Plane
// セッション内)から `invalidate {project}` SSE を受け、該当 project の
// issue 系 SWR キーを revalidate → 既存フックが再フェッチ → MobX 更新 →
// 看板/リスト/カンバンが手動リフレッシュ無しで再描画。
//
// 設計: 失効信号のみ受信し権威データは Plane API から再取得
//   (至多一回 + クライアント回源 → 丢/重/乱序に鲁棒)。
// 失敗安全: SSE 不通/未対応でも何もしない＝今日の挙動に退化、Plane を
//   阻塞しない。EventSource はブラウザ標準で自動再接続(retry:3000)。
// 更新は realtimeBus 経由の外科手術的再取得のみ(全 SWR revalidate は
//   しない=全画面刷新を起こさない)。

import { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { mutate } from "swr";
import { ENotificationLoader, ENotificationQueryParamType } from "@plane/constants";
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { peerSync } from "./peer-sync";
import { realtimeBus } from "./realtime-bus";

const RT_URL = "/__rt/stream";
// BARSOUL 未読同期(SSE→SWR mutate + store): Plane CE は unread count を
// **SWR** で管理(key: WORKSPACE_UNREAD_NOTIFICATION_COUNT). store 内部の
// mobx 値だけ書換えても **SWR cache が変わらない → 観察コンポーネントが
// SWR data を信じて再描画しない** (本事件の真因). SWR mutate でキー失効
// → SWR が fetcher を再呼出 → fetcher 内部の getUnreadNotificationsCount
// が mobx も更新 → 観察コンポーネントが両方経由で確実に更新. debounce で
// 連発合流(500ms).
const NOTIF_REFETCH_DEBOUNCE_MS = 500;

export const RealtimeSync = () => {
  const { workspaceSlug } = useParams();
  const { getNotifications } = useWorkspaceNotifications();
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const refreshNotifications = () => {
      const ws = (workspaceSlug || "").toString();
      if (!ws) return;
      if (notifTimer.current) clearTimeout(notifTimer.current);
      notifTimer.current = setTimeout(() => {
        try {
          // ① SWR cache 失効 → top-nav/sidebar の useSWR が fetcher 再呼出
          //    → getUnreadNotificationsCount → mobx update → observer 再描画
          void mutate("WORKSPACE_UNREAD_NOTIFICATION_COUNT");
          // ② notification list (badge 用) は store 直呼出(SWR で管理外)
          void getNotifications(ws, ENotificationLoader.MUTATION_LOADER,
                                ENotificationQueryParamType.INIT);
        } catch {
          /* notif refresh 失敗は SSE 主路を阻害しない */
        }
      }, NOTIF_REFETCH_DEBOUNCE_MS);
    };

    let es: EventSource | null = null;
    let closed = false;

    const onInvalidate = (ev: MessageEvent) => {
      let project = "";
      let ids: string[] | null = null;
      let hasIssueSignal = false;
      let commentIssueIds: string[] = [];
      try {
        const d = JSON.parse(ev.data || "{}");
        project = (d.project as string) || "";
        // 「issues キーの有無」=「看板(issue)活動があったか」。
        //   キー存在時のみ看板へ通知する。コメントのみのフレーム
        //   (issues キー無し)では看板に一切触れない = コメントが
        //   看板を再取得させる問題の構造的根絶(防御層: client 側)。
        //   ・issues=配列(非空) → その id を外科手術更新
        //   ・issues=[](空)/非配列 → null = 粗粒度退化(id 不明)
        if (Object.prototype.hasOwnProperty.call(d, "issues")) {
          hasIssueSignal = true;
          if (Array.isArray(d.issues)) {
            const arr = (d.issues as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0);
            ids = arr.length > 0 ? arr : null;
          }
        }
        // comments 配列 = コメント変更のあった issue id。開いてる
        //   詳細/peek パネルのみが反応(看板には一切波及しない)。
        if (Array.isArray(d.comments)) {
          commentIssueIds = (d.comments as unknown[]).filter(
            (x): x is string => typeof x === "string" && x.length > 0
          );
        }
      } catch {
        return;
      }
      if (!project) return;
      // ※クライアント側 time-throttle は撤去。distinct な issue id を
      //   落とすと外科手術更新が取りこぼす。サーバ側 debounce(300ms/
      //   project)+ バスの id 集合集積で既に合流済。
      const now = Date.now();
      // 診断(検証用・無害): デプロイ済クライアントが prod 経路で
      //   invalidate を受領・処理した証跡。ログイン不要で headless 検証可。
      try {
        (window as unknown as { __rtLast?: { project: string; ts: number; ids: string[] | null } }).__rtLast = {
          project,
          ts: now,
          ids,
        };
      } catch {
        /* noop */
      }
      // realtime はサイレント/シームレス(トースト等の通知は出さない。
      //   カードが静かに動くだけ — それが正しい体験)。
      // 看板更新は【issues キーがあった時のみ】。bump(project, ids)
      //   → base root の useRealtimeVersion effect が drain して該当
      //   id のカードだけ Plane 単 issue 経路で差し替え(全板再取得無)。
      //   ids=null かつ issues キー有 = 粗粒度。issues キー無
      //   (コメントのみ)は bump を呼ばない → 看板は不変。
      if (hasIssueSignal) {
        try {
          realtimeBus.bump(project, ids);
        } catch {
          /* fail-safe */
        }
      }
      // コメント: 当該 issue の世代を bump。開いてるパネルだけが
      //   useRealtimeCommentVersion 経由で反応 → comment store のみ
      //   静かに再取得(看板/全画面には一切触れない)。
      try {
        for (const iid of commentIssueIds) realtimeBus.bumpComment(iid);
      } catch {
        /* fail-safe */
      }
      // BARSOUL 未読同期: 何らかの活動(issue 変更 or comment 追加/編集)
      //   が起きたら notification store を再取得 → 🔔 赤点 + カード未読
      //   ハイライトをリアルタイム化(従来 polling のみ).
      if (hasIssueSignal || commentIssueIds.length > 0) {
        try { refreshNotifications(); } catch { /* noop */ }
      }
    };

    // BARSOUL peer-sync: 同一ブラウザ多タブ受信を有効化(BroadcastChannel)。
    try {
      peerSync.ensureLocalChannel();
    } catch {
      /* noop */
    }

    // 跨ブラウザの UI op を既存 SSE で受ける(専用 EventSource は張らない)。
    const onPeerOp = (ev: MessageEvent) => {
      try {
        peerSync.ingestRemote(ev.data || "");
      } catch {
        /* fail-safe */
      }
    };

    let firstOpen = true;
    try {
      es = new EventSource(RT_URL); // 同源 → Cookie 自動付与
      es.addEventListener("invalidate", onInvalidate as EventListener);
      es.addEventListener("op", onPeerOp as EventListener);
      // 接続/再接続成功。初回以外(=再接続)は接続断の隙間で取りこぼした
      // 変更がありうるので全ボードを一回 resync(鲁棒性の要)。
      es.onopen = () => {
        if (firstOpen) {
          firstOpen = false;
          return;
        }
        try {
          realtimeBus.bumpAll();
        } catch {
          /* fail-safe */
        }
      };
      // error 時はブラウザが自動再接続。閉じない(closed 時のみ後始末)。
      // onerror 発火時に通知も refetch(切断中に来た mention を再接続後に補捉)
      es.onerror = () => {
        if (closed && es) {
          es.close();
        } else {
          // SSE 復活時(自動再接続後)は通知も補捉
          refreshNotifications();
        }
      };
    } catch {
      /* EventSource 生成失敗 → 退化(今日の挙動) */
    }

    // ── BARSOUL 堅牢性多層: SSE 主路の他に visibility/focus/online/interval
    //    全てが refreshNotifications を発火(全部 debounce 統合). どれか1本
    //    が死んでも他の経路で 60s 内に通知 UI が同期する.
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshNotifications();
    };
    const onFocus = () => refreshNotifications();
    const onOnline = () => refreshNotifications();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    // 60s safety net: SSE が静かに死んでも(プロキシ閉/サーバ再起動の取りこぼし)
    // 1 分以内にバッジが揃う. polling より頻度抑え(SSE 主路ありき).
    const safetyInterval = setInterval(refreshNotifications, 60_000);

    return () => {
      closed = true;
      try {
        es?.removeEventListener("invalidate", onInvalidate as EventListener);
        es?.removeEventListener("op", onPeerOp as EventListener);
        es?.close();
      } catch {
        /* noop */
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      clearInterval(safetyInterval);
      if (notifTimer.current) {
        clearTimeout(notifTimer.current);
        notifTimer.current = null;
      }
    };
    // workspaceSlug を deps に含めることで ws 切替時に notification refetch
    // を新 ws 向けに走らせる(EventSource 自体は同源同 path で張り直し不要).
  }, [workspaceSlug, getNotifications]);

  return null;
};
