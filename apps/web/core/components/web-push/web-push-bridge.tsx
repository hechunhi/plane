/**
 * BARSOUL 2026-08: Web Push とアプリ本体をつなぐ常駐コンポーネント（描画なし）。
 *
 * やること 3 つ:
 *   1. Service Worker を登録する（/sw.js は 1 つだけ。2 つ目は作らない）
 *   2. 通知タップ時に SW から飛んでくる navigate メッセージを受けて、
 *      **既に開いているこの画面のまま**目的の課題まで遷移する
 *      （フルリロードすると開いていた編集内容が飛ぶ）
 *   3. 未読件数をホーム画面アイコンのバッジに反映する
 *      （タブ title / favicon は lib/tab-badge の担当。OS バッジは別の面）
 *   4. この端末の購読をサーバへ送り直す（自己修復）。端末側の「オン」は
 *      ブラウザの購読の有無で決まるが、届くかはサーバに行があるかで決まる。
 *      2026-10 まで登録 API が 400 で全滅しており、「オン表示なのに一度も届かない」
 *      端末が残っている。サーバ側は endpoint で upsert なので何度送っても無害。
 *
 * 唯一のマウント箇所: WorkspaceContentWrapper。
 */
"use client";
import { useEffect } from "react";
import { observer } from "mobx-react";
import { useNavigate } from "react-router";
import { useWorkspaceNotifications } from "@/hooks/store/notifications/use-workspace-notifications";
import {
  ensureServiceWorker,
  getExistingSubscription,
  isPushSupported,
  serializeSubscription,
  setAppBadgeCount,
} from "@/lib/web-push";
import { PushService } from "@/services/push.service";

const pushService = new PushService();
// タブ（PWA 起動）ごとに 1 回で十分。ページ遷移のたびに送らない。
const RESYNC_KEY = "barsoul-push-resynced";

export const WebPushBridge = observer(function WebPushBridge() {
  const navigate = useNavigate();
  const { unreadNotificationsCount } = useWorkspaceNotifications();
  const unread = unreadNotificationsCount?.total_unread_notifications_count ?? 0;

  // 1. SW 登録 + 4. 購読の自己修復
  useEffect(() => {
    if (!isPushSupported()) return;
    void ensureServiceWorker();
    if (Notification.permission !== "granted") return;
    try {
      if (sessionStorage.getItem(RESYNC_KEY)) return;
    } catch {
      /* private mode 等: 毎回送っても upsert なので害は無い */
    }
    void (async () => {
      const subscription = await getExistingSubscription();
      if (!subscription) return;
      try {
        await pushService.saveSubscription(serializeSubscription(subscription));
        try {
          sessionStorage.setItem(RESYNC_KEY, "1");
        } catch {
          /* noop */
        }
      } catch {
        /* 次の起動で再試行 */
      }
    })();
  }, []);

  // 2. 通知タップ → 画面遷移
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== "barsoul-push" || data.action !== "navigate") return;
      if (typeof data.url !== "string" || !data.url.startsWith("/")) return;
      navigate(data.url);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);

  // 3. OS のアプリアイコンバッジ
  useEffect(() => {
    setAppBadgeCount(unread);
  }, [unread]);

  return null;
});
