/**
 * BARSOUL 2026-08: Web Push（スマホ通知）のブラウザ側ロジック。
 *
 * ここに閉じ込める理由:
 *  - iOS は「ホーム画面に追加して、そこから開いた時」だけプッシュが使える。
 *    Safari のタブで開いているだけの状態と区別せずに permission を要求すると、
 *    iOS では黙って失敗する（ユーザーには「押しても何も起きない」に見える）。
 *  - Notification.requestPermission() は**必ずユーザー操作の中から**呼ぶ。
 *    ページ読み込み時に呼ぶと、ブラウザによっては即座に永久 deny 扱いになり
 *    二度と出せなくなる。この module から自動で呼ぶ関数は用意しない。
 *
 * UI に出す文言はここには置かない（i18n 側）。ここは状態を返すだけ。
 */

export const SW_URL = "/sw.js";
export const SW_SCOPE = "/";

/** 画面に出す状態。文言と出しわけは設定 UI 側で決める。 */
export type TPushState =
  /** このブラウザはそもそもプッシュ非対応（iOS 以外の古いブラウザ等） */
  | "unsupported"
  /** iPhone / iPad だが、まだホーム画面から開いていない */
  | "needs_install"
  /** ブラウザ／OS 側で拒否されている。もう requestPermission しても無駄 */
  | "denied"
  /** 使えるが、この端末ではまだオンにしていない */
  | "off"
  /** この端末でオン */
  | "on";

export type TPushEnvironment = {
  supported: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  permission: NotificationPermission | "unsupported";
};

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent || "");

/**
 * iPadOS 13 以降の Safari は UA が Macintosh になる。タッチ点数で見分ける。
 * （ここを UA だけで判定すると iPad が「未対応の Mac」に化ける）
 */
export const isIOS = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const agent = ua();
  if (/iPad|iPhone|iPod/.test(agent)) return true;
  return agent.includes("Macintosh") && (navigator.maxTouchPoints || 0) > 1;
};

/** ホーム画面（PWA）から開いているか。Safari のタブとは別物として扱う。 */
export const isStandalone = (): boolean => {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayMode =
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches);
  return Boolean(iosStandalone || displayMode);
};

export const isPushSupported = (): boolean => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
};

export const getPushEnvironment = (): TPushEnvironment => {
  const supported = isPushSupported();
  return {
    supported,
    isIOS: isIOS(),
    isStandalone: isStandalone(),
    permission: supported ? Notification.permission : "unsupported",
  };
};

/**
 * 画面に出す状態を 1 つに畳む。
 * iOS でホーム画面に追加していない場合は「未対応」ではなく「あと一手」なので、
 * needs_install を unsupported より先に判定する（案内文が変わる）。
 */
export const resolvePushState = (env: TPushEnvironment, hasSubscription: boolean): TPushState => {
  if (env.isIOS && !env.isStandalone) return "needs_install";
  if (!env.supported) return "unsupported";
  if (env.permission === "denied") return "denied";
  if (env.permission === "granted" && hasSubscription) return "on";
  return "off";
};

/** 「iPhone · Safari」程度の、本人が端末を見分けられる最低限のラベル */
export const deviceLabel = (): string => {
  const agent = ua();
  let device = "PC";
  if (/iPhone/.test(agent)) device = "iPhone";
  else if (/iPad/.test(agent) || (agent.includes("Macintosh") && (navigator.maxTouchPoints || 0) > 1))
    device = "iPad";
  else if (/Android/.test(agent)) device = "Android";
  else if (/Macintosh/.test(agent)) device = "Mac";
  else if (/Windows/.test(agent)) device = "Windows";

  let browser = "Browser";
  if (/Edg\//.test(agent)) browser = "Edge";
  else if (/CriOS|Chrome\//.test(agent)) browser = "Chrome";
  else if (/Firefox\//.test(agent)) browser = "Firefox";
  else if (/Safari\//.test(agent)) browser = "Safari";

  return `${device} · ${browser}`;
};

/* ------------------------------------------------------------------ *
 * service worker
 * ------------------------------------------------------------------ */

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * SW は 1 つだけ。/sw.js を register して ready を待つ。
 * （2 つ目の SW を登録しない。既存の /sw.js に push を足してある）
 */
export const ensureServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!registrationPromise) {
    registrationPromise = (async () => {
      try {
        await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
        return await navigator.serviceWorker.ready;
      } catch {
        registrationPromise = null;
        return null;
      }
    })();
  }
  return registrationPromise;
};

export const getExistingSubscription = async (): Promise<PushSubscription | null> => {
  if (!isPushSupported()) return null;
  const registration = await ensureServiceWorker();
  if (!registration) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ *
 * subscribe / unsubscribe
 * ------------------------------------------------------------------ */

export const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
};

export type TSubscribeResult =
  | { status: "subscribed"; subscription: PushSubscription }
  | { status: "denied" }
  | { status: "dismissed" }
  | { status: "failed"; error?: unknown };

/**
 * **必ずクリックハンドラの中から呼ぶこと。**
 * permission → SW ready → pushManager.subscribe の順。途中で断られたら
 * その理由をそのまま返す（呼び出し側が文言を決める）。
 */
export const subscribeToPush = async (vapidPublicKey: string): Promise<TSubscribeResult> => {
  if (!isPushSupported()) return { status: "failed" };

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch (error) {
    return { status: "failed", error };
  }
  if (permission === "denied") return { status: "denied" };
  // 「×」で閉じられた場合。次回また聞けるので denied とは分ける。
  if (permission !== "granted") return { status: "dismissed" };

  try {
    const registration = await ensureServiceWorker();
    if (!registration) return { status: "failed" };

    // 既存があればそれを使う（VAPID 鍵を変えていない限り再購読は不要）
    const existing = await registration.pushManager.getSubscription();
    if (existing) return { status: "subscribed", subscription: existing };

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
    return { status: "subscribed", subscription };
  } catch (error) {
    return { status: "failed", error };
  }
};

/** ブラウザ側の購読を解除する。サーバ側の削除は呼び出し側の責務。 */
export const unsubscribeFromPush = async (): Promise<string | null> => {
  const subscription = await getExistingSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  try {
    await subscription.unsubscribe();
  } catch {
    /* サーバ側だけでも止められるよう endpoint は返す */
  }
  return endpoint;
};

export const serializeSubscription = (subscription: PushSubscription) => {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
    user_agent: ua(),
    device_label: deviceLabel(),
    is_standalone: isStandalone(),
  };
};

/* ------------------------------------------------------------------ *
 * app badge
 * ------------------------------------------------------------------ */

/** 非対応ブラウザでは黙って何もしない（例外を投げない）。 */
export const setAppBadgeCount = (count: number): void => {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch?.(() => {});
    else void nav.clearAppBadge?.()?.catch?.(() => {});
  } catch {
    /* noop */
  }
};
