/**
 * BARSOUL 2026-08: 設定 > 通知 の「スマホ通知」ブロック。
 *
 * 設計方針:
 *  - 画面に技術用語を出さない。Service Worker / VAPID / PushSubscription は
 *    コードの中だけの言葉。ここに出したら負け。
 *  - 状態は 5 つに畳んである（lib/web-push の TPushState）。
 *    「オフ」「オン」「ブラウザで拒否」「ホーム画面に追加が先」「非対応」。
 *    状態ごとにボタンの意味が変わるので、ボタンは 1 つだけ出す。
 *  - iPhone で Safari のタブから開いている場合は permission を要求しない。
 *    iOS はホーム画面から開いた時しか通知を出せず、要求しても黙って失敗する
 *    ＝ ユーザーには「押しても何も起きない」に見える。案内カードを出す。
 *  - 端末ごとの購読なので「この端末」と明示する。iPhone でオンにしても
 *    会社の Windows には届かない、を誤解させない。
 */
"use client";
import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import { BellRing, MonitorSmartphone, Share, SquarePlus } from "lucide-react";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { ToggleSwitch } from "@plane/ui";
// components
import { SettingsControlItem } from "@/components/settings/control-item";
// lib
import type { TPushState } from "@/lib/web-push";
import {
  getExistingSubscription,
  getPushEnvironment,
  resolvePushState,
  serializeSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/web-push";
// services
import type { TPushPreference } from "@/services/push.service";
import { PushService } from "@/services/push.service";

const pushService = new PushService();

const PREFERENCE_KEYS: (keyof TPushPreference)[] = [
  "mention",
  "comment_reply",
  "assigned",
  "deadline",
  "important_update",
];

export const PushNotificationSettings = observer(function PushNotificationSettings() {
  const { t } = useTranslation();
  // サーバに鍵が入っているか。入っていなければブロックごと出さない。
  const { data: config } = useSWR("PUSH_CONFIG", () => pushService.config(), {
    revalidateOnFocus: false,
  });
  const { data: preference, mutate: mutatePreference } = useSWR("PUSH_PREFERENCE", () => pushService.preferences(), {
    revalidateOnFocus: false,
  });
  const { data: devices, mutate: mutateDevices } = useSWR("PUSH_DEVICES", () => pushService.listSubscriptions(), {
    revalidateOnFocus: false,
  });

  const [state, setState] = useState<TPushState | null>(null);
  // 「拒否」の直し方は端末で違う。iPhone は OS の設定、PC はアドレスバーの
  // サイト設定。片方だけ書くともう片方のユーザーは永久に直せない。
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshState = useCallback(async () => {
    const env = getPushEnvironment();
    const subscription = env.supported ? await getExistingSubscription() : null;
    setIsIOSDevice(env.isIOS);
    setState(resolvePushState(env, Boolean(subscription)));
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const handleEnable = useCallback(async () => {
    if (!config?.vapid_public_key) return;
    setBusy(true);
    try {
      const result = await subscribeToPush(config.vapid_public_key);
      if (result.status === "denied") {
        setToast({ type: TOAST_TYPE.ERROR, title: t("push_notifications.toasts.denied") });
      } else if (result.status === "subscribed") {
        await pushService.saveSubscription(serializeSubscription(result.subscription));
        await mutateDevices();
        setToast({ type: TOAST_TYPE.SUCCESS, title: t("push_notifications.toasts.enabled") });
      } else if (result.status === "failed") {
        setToast({ type: TOAST_TYPE.ERROR, title: t("push_notifications.toasts.failed") });
      }
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("push_notifications.toasts.failed") });
    } finally {
      await refreshState();
      setBusy(false);
    }
  }, [config?.vapid_public_key, mutateDevices, refreshState, t]);

  const handleDisable = useCallback(async () => {
    setBusy(true);
    try {
      // ブラウザ側を解除 → サーバ側も物理削除。片方だけだと送信が止まらない。
      const endpoint = await unsubscribeFromPush();
      if (endpoint) await pushService.removeSubscription(endpoint);
      await mutateDevices();
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("push_notifications.toasts.disabled") });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("push_notifications.toasts.failed") });
    } finally {
      await refreshState();
      setBusy(false);
    }
  }, [mutateDevices, refreshState, t]);

  const handlePreferenceChange = useCallback(
    async (key: keyof TPushPreference, value: boolean) => {
      const previous = preference;
      void mutatePreference({ ...(preference as TPushPreference), [key]: value }, false);
      try {
        const next = await pushService.updatePreferences({ [key]: value });
        void mutatePreference(next, false);
      } catch {
        void mutatePreference(previous, false);
        setToast({ type: TOAST_TYPE.ERROR, title: t("push_notifications.toasts.update_failed") });
      }
    },
    [mutatePreference, preference, t]
  );

  // サーバ未設定 or 判定前は何も出さない（半端な UI を見せない）
  if (!config?.enabled || state === null) return null;

  const otherDeviceCount = (devices ?? []).filter((d) => d.is_active).length - (state === "on" ? 1 : 0);

  return (
    <div className="mt-8 border-t border-subtle-1 pt-6">
      <div className="mb-2 flex items-center gap-2">
        <BellRing className="size-4 text-secondary" />
        <h3 className="text-body-sm-semibold text-primary">{t("push_notifications.heading")}</h3>
      </div>
      <p className="text-caption-md-regular text-secondary">{t("push_notifications.description")}</p>

      {/* --- 状態 + ボタン --------------------------------------------- */}
      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-subtle-1 bg-layer-1 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-secondary" />
          <div className="min-w-0">
            <p className="text-body-sm-medium text-primary">{t(`push_notifications.status.${state}`)}</p>
            {state === "on" && otherDeviceCount > 0 && (
              <p className="text-caption-md-regular text-secondary">
                {t("push_notifications.devices.others", { count: otherDeviceCount })}
              </p>
            )}
            {state === "denied" && (
              <p className="text-caption-md-regular text-secondary">
                {t(isIOSDevice ? "push_notifications.denied_help_ios" : "push_notifications.denied_help")}
              </p>
            )}
            {state === "unsupported" && (
              <p className="text-caption-md-regular text-secondary">{t("push_notifications.unsupported_help")}</p>
            )}
          </div>
        </div>

        {state === "off" && (
          <Button variant="primary" size="lg" onClick={handleEnable} loading={busy} disabled={busy}>
            {busy ? t("push_notifications.actions.enabling") : t("push_notifications.actions.enable")}
          </Button>
        )}
        {state === "on" && (
          <Button variant="secondary" size="lg" onClick={handleDisable} loading={busy} disabled={busy}>
            {t("push_notifications.actions.disable")}
          </Button>
        )}
        {/* denied / needs_install / unsupported ではボタンを出さない。
            押しても何も起きないボタンは、無いより悪い。 */}
      </div>

      {/* --- ホーム画面に追加の手順 ------------------------------------ */}
      {state === "needs_install" && (
        <div className="mt-3 rounded-lg border border-subtle-1 bg-layer-1 p-3">
          <p className="text-body-sm-medium text-primary">{t("push_notifications.install.title")}</p>
          <ol className="mt-2 flex flex-col gap-2">
            <li className="flex items-center gap-2 text-caption-md-regular text-secondary">
              <Share className="size-3.5 shrink-0" />
              {t("push_notifications.install.step_1")}
            </li>
            <li className="flex items-center gap-2 text-caption-md-regular text-secondary">
              <SquarePlus className="size-3.5 shrink-0" />
              {t("push_notifications.install.step_2")}
            </li>
            <li className="flex items-center gap-2 text-caption-md-regular text-secondary">
              <span className="w-3.5 shrink-0 text-center">3</span>
              {t("push_notifications.install.step_3")}
            </li>
            <li className="flex items-center gap-2 text-caption-md-regular text-secondary">
              <span className="w-3.5 shrink-0 text-center">4</span>
              {t("push_notifications.install.step_4")}
            </li>
          </ol>
        </div>
      )}

      {/* --- 種類ごとのスイッチ ---------------------------------------- */}
      {state === "on" && preference && (
        <div className="mt-4">
          <h4 className="text-caption-md-medium text-secondary">{t("push_notifications.types.heading")}</h4>
          <div className="mt-1 flex flex-col gap-y-1">
            {PREFERENCE_KEYS.map((key) => (
              <SettingsControlItem
                key={key}
                title={t(`push_notifications.types.${key}`)}
                description={t(`push_notifications.types.${key}_description`)}
                control={
                  <ToggleSwitch
                    value={Boolean(preference[key])}
                    onChange={(value) => handlePreferenceChange(key, value)}
                    size="sm"
                  />
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
