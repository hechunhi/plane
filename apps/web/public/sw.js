/*
 * BARSOUL Tasks Service Worker
 *
 * 役割は 2 つだけ。**キャッシュは一切やらない。**
 *
 * 1) 旧 workbox SW の後始末（2026-07 の kill-switch を引き継ぐ）
 *    Plane の Next.js / next-pwa 時代に各員のブラウザへ workbox SW が
 *    インストールされ、リクエストを横取りして古いバンドルを返していた
 *    （NetworkFirst の start-url、Authelia の opaqueredirect を 200 と
 *    誤ってキャッシュ、等）。「直したのに直ってない」「強制リロードでも
 *    直らない」「シークレットウィンドウだけ正常」の原因。
 *    → activate のたびに Cache Storage を全消しし、**fetch ハンドラを
 *      一切登録しない**。この 2 点は今後も絶対に崩さないこと。
 *      キャッシュを足したくなったら、まず「なぜ前回死んだか」を読むこと。
 *
 * 2) Web Push（2026-08 追加）
 *    push / notificationclick / pushsubscriptionchange を担当する。
 *    このために SW は「自分を unregister する」のをやめた（旧版は自滅する
 *    だけのスクリプトだった）。代わりにアプリ側から明示的に register する。
 *    fetch を持たないので、ページの読み込み経路には今も一切干渉しない。
 *
 * 更新の効き方: ブラウザは既存 SW を導航時／24h 以内に再取得して差分を見る。
 * Caddy は /sw.js を no-store で返しているので、デプロイすれば全員のブラウザ
 * が次のアクセスで新しい本文を拾って自動で入れ替わる。手作業は不要。
 */

const PUSH_CONFIG_URL = "/api/users/me/push-config/";
const PUSH_SUBSCRIPTION_URL = "/api/users/me/push-subscriptions/";
const APP_ICON = "/icons/icon-192x192.png";
const FALLBACK_TITLE = "BARSOUL Tasks";

self.addEventListener("install", () => {
  // 待たずに即座に入れ替わる
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 旧 workbox の残骸（start-url / dev / precache …）を全部消す
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {
        /* noop */
      }
      // 既に開いているタブをこの SW の管理下に入れる（reload はしない。
      // 入力中のフォームを飛ばすほうが害が大きい）
      try {
        await self.clients.claim();
      } catch (e) {
        /* noop */
      }
    })()
  );
});

/* ------------------------------------------------------------------ *
 * push
 * ------------------------------------------------------------------ */

/**
 * サーバ側 `_build_payload`（plane/bgtasks/web_push_task.py）が送る形:
 *   { type, title, body, url, taskId, commentId, notificationId, badgeCount, actor }
 * 文言はサーバで受信者の言語に翻訳済み。SW 側では一切組み立てない。
 */
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = {};
      try {
        payload = event.data ? event.data.json() : {};
      } catch (e) {
        payload = {};
      }

      const title = payload.title || FALLBACK_TITLE;
      const body = payload.body || "";
      const url = payload.url || "/";

      // tag: 同じ通知が二重に積まれないように。通知 ID があればそれ、
      // 無ければタスク単位でまとめる。renotify は付けない（同じ件で
      // 何度もバイブされるのは害）。
      const tag = payload.notificationId || (payload.taskId ? `task-${payload.taskId}` : undefined);

      try {
        await self.registration.showNotification(title, {
          body,
          tag,
          icon: APP_ICON,
          badge: APP_ICON,
          timestamp: Date.now(),
          data: {
            url,
            type: payload.type || "",
            taskId: payload.taskId || null,
            commentId: payload.commentId || null,
            notificationId: payload.notificationId || null,
          },
        });
      } catch (e) {
        /* noop */
      }

      // アプリアイコンの数字バッジ（iOS 16.4+ / Chrome）。
      // 非対応ブラウザでは navigator.setAppBadge が無いだけなので落ちない。
      try {
        if (typeof payload.badgeCount === "number" && "setAppBadge" in navigator) {
          if (payload.badgeCount > 0) await navigator.setAppBadge(payload.badgeCount);
          else await navigator.clearAppBadge();
        }
      } catch (e) {
        /* noop */
      }
    })()
  );
});

/* ------------------------------------------------------------------ *
 * notificationclick
 * ------------------------------------------------------------------ */

/**
 * 既に BARSOUL Tasks が開いていれば **そのウィンドウを使い回す**。
 * 毎回新しいタブ／新しい PWA 画面が生えるのは相当うっとうしいので、
 * focus してから postMessage で目的の URL へ遷移させる。
 * 開いていなければ openWindow。どちらの経路でも「ホーム画面に飛ばす」
 * ことは絶対にしない（url は課題とコメントまで特定されている）。
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const target = data.url || "/";

  event.waitUntil(
    (async () => {
      const targetUrl = new URL(target, self.location.origin).href;

      let clientList = [];
      try {
        clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      } catch (e) {
        clientList = [];
      }

      for (const client of clientList) {
        // 同一オリジンのウィンドウなら再利用する
        let sameOrigin = false;
        try {
          sameOrigin = new URL(client.url).origin === self.location.origin;
        } catch (e) {
          sameOrigin = false;
        }
        if (!sameOrigin) continue;

        try {
          await client.focus();
        } catch (e) {
          /* noop */
        }
        // SPA なので navigate() でフルリロードさせず、アプリ側の
        // router に任せる。受け手がいなければ navigate にフォールバック。
        try {
          client.postMessage({ source: "barsoul-push", action: "navigate", url: target, data });
        } catch (e) {
          try {
            await client.navigate(targetUrl);
          } catch (e2) {
            /* noop */
          }
        }
        return;
      }

      try {
        await self.clients.openWindow(targetUrl);
      } catch (e) {
        /* noop */
      }
    })()
  );
});

/* ------------------------------------------------------------------ *
 * pushsubscriptionchange
 * ------------------------------------------------------------------ */

/**
 * ブラウザが購読を勝手に作り直すことがある（鍵のローテーション等）。
 * その時に黙って通知が止まらないよう、SW 側で購読し直してサーバへ送る。
 * セッション Cookie は same-origin fetch に自動で載る。
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch(PUSH_CONFIG_URL, { credentials: "include" });
        if (!res.ok) return;
        const config = await res.json();
        if (!config.enabled || !config.vapid_public_key) return;

        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.vapid_public_key),
        });

        const json = subscription.toJSON();
        await fetch(PUSH_SUBSCRIPTION_URL, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            p256dh: json.keys && json.keys.p256dh,
            auth: json.keys && json.keys.auth,
            user_agent: navigator.userAgent,
          }),
        });
      } catch (e) {
        /* noop */
      }
    })()
  );
});

/* ------------------------------------------------------------------ *
 * message（ページ → SW）
 * ------------------------------------------------------------------ */

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.source !== "barsoul-push") return;

  if (msg.action === "set-badge") {
    try {
      if (!("setAppBadge" in navigator)) return;
      if (typeof msg.count === "number" && msg.count > 0) navigator.setAppBadge(msg.count);
      else navigator.clearAppBadge();
    } catch (e) {
      /* noop */
    }
    return;
  }

  if (msg.action === "close-notifications") {
    // 既読にした通知のトーストを OS 側からも片付ける
    event.waitUntil(
      (async () => {
        try {
          const list = await self.registration.getNotifications();
          for (const n of list) {
            const d = n.data || {};
            if (!msg.taskId || d.taskId === msg.taskId) n.close();
          }
        } catch (e) {
          /* noop */
        }
      })()
    );
  }
});

/* ------------------------------------------------------------------ *
 * util
 * ------------------------------------------------------------------ */

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = self.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
