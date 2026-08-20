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
 *
 * 唯一のマウント箇所: WorkspaceContentWrapper。
 */
"use client";
import { useEffect } from "react";
import { observer } from "mobx-react";
import { useNavigate } from "react-router";
import { useWorkspaceNotifications } from "@/hooks/store/notifications/use-workspace-notifications";
import { ensureServiceWorker, isPushSupported, setAppBadgeCount } from "@/lib/web-push";

export const WebPushBridge = observer(function WebPushBridge() {
  const navigate = useNavigate();
  const { unreadNotificationsCount } = useWorkspaceNotifications();
  const unread = unreadNotificationsCount?.total_unread_notifications_count ?? 0;

  // 1. SW 登録
  useEffect(() => {
    if (!isPushSupported()) return;
    void ensureServiceWorker();
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
