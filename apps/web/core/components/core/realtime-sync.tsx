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
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { invalidateAIState } from "@/components/issues/issue-layouts/kanban/ai-state-line";
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
  const { refreshBadgeNotifications, getUnreadNotificationsCount } = useWorkspaceNotifications();
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // SSE 健康度: 最後にイベント/openを受信した時刻. 3 分以上静默 → degraded.
  const lastEventAt = useRef<number>(Date.now());
  // BARSOUL 2026-06-18: safety 間隔での直前未読スナップショット。
  // カウントが変わっていない限り 300 件全量 fetch をスキップする(digest 最適化)。
  const lastUnreadSnapshot = useRef<{ total: number; mention: number } | null>(null);

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
          // ② notification list (badge 用) は store の refreshBadgeNotifications
          //    を呼ぶ. **ALL + MENTIONS 二経路の並列 fetch**(Plane apiserver は
          //    ALL タブで mention sender を EXCLUDE する仕様 → 旧コードの
          //    getNotifications 単呼出だと @mention 通知が SSE 経由で来ても
          //    store に入らず、@mention のみで unread のカードが永遠に既読
          //    扱いになる bug の根因. 2026-05-26 修正).
          void refreshBadgeNotifications(ws);
        } catch {
          /* notif refresh 失敗は SSE 主路を阻害しない */
        }
      }, NOTIF_REFETCH_DEBOUNCE_MS);
    };

    // BARSOUL 2026-06-18: digest 最適化 — safety 間隔専用の軽量チェック。
    // SSE 由来の refreshNotifications は毎回全量フェッチ(変化確実)のまま。
    // safety timer のみ count 先チェック → 差分あれば全量フェッチに落とす。
    const safetySync = async () => {
      const ws = (workspaceSlug || "").toString();
      if (!ws) return;
      try {
        const result = await getUnreadNotificationsCount(ws);
        if (!result) {
          // count エンドポイント失敗 → フォールバックで全量フェッチ
          void mutate("WORKSPACE_UNREAD_NOTIFICATION_COUNT");
          void refreshBadgeNotifications(ws);
          return;
        }
        const prev = lastUnreadSnapshot.current;
        const changed =
          !prev ||
          prev.total !== result.total_unread_notifications_count ||
          prev.mention !== result.mention_unread_notifications_count;
        lastUnreadSnapshot.current = {
          total: result.total_unread_notifications_count,
          mention: result.mention_unread_notifications_count,
        };
        if (changed) {
          // カウントが変わった → 全量フェッチで unreadByIssueId も更新
          void mutate("WORKSPACE_UNREAD_NOTIFICATION_COUNT");
          void refreshBadgeNotifications(ws);
        }
        // !changed: getUnreadNotificationsCount が MobX 更新済み → count badge OK
        // unreadByIssueId は変化なし → 300 件フェッチ不要
      } catch {
        // 何らかの例外 → 安全側(全量フェッチ)にフォールバック
        void mutate("WORKSPACE_UNREAD_NOTIFICATION_COUNT");
        void refreshBadgeNotifications(ws);
      }
    };

    let es: EventSource | null = null;
    let closed = false;

    const onInvalidate = (ev: MessageEvent) => {
      lastEventAt.current = Date.now(); // SSE 生きてる証跡(健康判定用)
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
          commentIssueIds = (d.comments as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0);
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
        try {
          refreshNotifications();
        } catch {
          /* noop */
        }
      }
      // BARSOUL ADR-029: 凍結カード状態同期. 変動した issue 毎に
      // ISSUE_APPROVAL SWR key を失効 → useIssueApproval re-fetch
      // → カード視覚(役割別)が SSE 秒級で切替わる.
      const affectedIssues = new Set<string>([...(ids || []), ...commentIssueIds]);
      affectedIssues.forEach((iid) => {
        try {
          void mutate(`ISSUE_APPROVAL:${iid}`);
        } catch {
          /* noop */
        }
      });
      // BARSOUL DIS: 评论/卡片变更很可能触发 AI 异步重判(debounce 4s + LLM)。
      //   延时失效该 issue 的 ai-state 缓存 → 看板/详情的「AI 当前态」在重判
      //   落地后自动刷新(近实时,无需手刷)。两档延时覆盖重判耗时窗口。
      affectedIssues.forEach((iid) => {
        setTimeout(() => {
          try {
            invalidateAIState(iid);
          } catch {
            /* noop */
          }
        }, 8000);
        setTimeout(() => {
          try {
            invalidateAIState(iid);
          } catch {
            /* noop */
          }
        }, 22000);
      });
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
      es.addEventListener("open", () => {
        lastEventAt.current = Date.now();
        if (firstOpen) {
          firstOpen = false;
          return;
        }
        try {
          realtimeBus.bumpAll();
        } catch {
          /* fail-safe */
        }
      });
      // error は EventSource 自動再接続に任せる. addEventListener("error") で
      // refresh を打つと一時的なネット揺れで雪崩発射する → 抑える.
      // 真に "切れた" 状態は safety interval(下記の degraded mode)で 30s に
      // 切替わって補捉される.
      es.addEventListener("error", () => {
        if (closed && es) es.close();
        // 自動再接続後の open イベントで lastEventAt が更新 → healthy 復帰
      });
    } catch {
      /* EventSource 生成失敗 → 退化(今日の挙動) */
    }

    // ── BARSOUL 堅牢性 + 性能配慮: 自適応兜底 ──
    // SSE 主路に加え、event-driven (visibility/focus/online) + adaptive
    // safety interval (healthy: 5min / degraded: 30s) + visibility-gated.
    // → 通常時は 5min/回(殆ど無負荷), SSE 切れ検知時のみ 30s に高頻度化,
    //   tab 後台時は完全停止 (見えないものを刷っても無意味).
    const SAFETY_HEALTHY_MS = 5 * 60 * 1000;
    const SAFETY_DEGRADED_MS = 30 * 1000;
    const SSE_STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3min 静默で stale 判定

    const isSSEHealthy = (): boolean => {
      if (!es || es.readyState !== 1 /* OPEN */) return false;
      // tab visible でも長期静默なら proxy 黙殺の可能性 (degraded)
      if (document.visibilityState === "visible" && Date.now() - lastEventAt.current > SSE_STALE_THRESHOLD_MS) {
        return false;
      }
      return true;
    };

    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSafety = () => {
      if (safetyTimer) clearTimeout(safetyTimer);
      const interval = isSSEHealthy() ? SAFETY_HEALTHY_MS : SAFETY_DEGRADED_MS;
      safetyTimer = setTimeout(() => {
        // tab 不可見 → 刷っても見えない. SWR revalidateOnFocus が tab 復帰時
        //   に拾うので skip して負荷ゼロ. 復帰時の visibilitychange でも拾う.
        if (document.visibilityState === "visible") {
          void safetySync();
        }
        scheduleSafety(); // 自己再スケジュール → state 変化に追従
      }, interval);
    };

    // event-driven 補強: tab 復帰 / focus / online で即時 refresh
    //   (ユーザ体感を担保 — degraded 30s より速い)
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshNotifications();
        scheduleSafety(); // visible 復帰時に interval も再計算
      }
    };
    const onFocus = () => refreshNotifications();
    const onOnline = () => {
      refreshNotifications();
      scheduleSafety(); // 復網時に間隔再計算
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    scheduleSafety();

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
      if (safetyTimer) clearTimeout(safetyTimer);
      if (notifTimer.current) {
        clearTimeout(notifTimer.current);
        notifTimer.current = null;
      }
    };
    // workspaceSlug を deps に含めることで ws 切替時に notification refetch
    // を新 ws 向けに走らせる(EventSource 自体は同源同 path で張り直し不要).
  }, [workspaceSlug, refreshBadgeNotifications, getUnreadNotificationsCount]);

  return null;
};
