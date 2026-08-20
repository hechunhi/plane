/**
 * BARSOUL 2026-08: Web Push（スマホ通知）の API クライアント。
 *
 * バックエンド側は plane/app/views/push.py。すべて「ログイン中の本人」に
 * 紐づく（他人の購読は見えないし消せない）。
 */
import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TPushConfig = {
  /** サーバに VAPID 鍵が設定されているか。false ならプッシュ機能ごと隠す */
  enabled: boolean;
  vapid_public_key: string;
};

export type TPushSubscriptionRecord = {
  id: string;
  device_label: string;
  is_standalone: boolean;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
};

export type TPushPreference = {
  mention: boolean;
  comment_reply: boolean;
  assigned: boolean;
  deadline: boolean;
  important_update: boolean;
};

export type TPushSubscriptionPayload = {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
  device_label?: string;
  is_standalone?: boolean;
};

export class PushService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async config(): Promise<TPushConfig> {
    return this.get("/api/users/me/push-config/")
      .then((res) => res?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listSubscriptions(): Promise<TPushSubscriptionRecord[]> {
    return this.get("/api/users/me/push-subscriptions/")
      .then((res) => res?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async saveSubscription(data: TPushSubscriptionPayload): Promise<TPushSubscriptionRecord> {
    return this.post("/api/users/me/push-subscriptions/", data)
      .then((res) => res?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** endpoint 指定で 1 端末ぶんだけ解除。サーバ側は物理削除（論理削除禁止） */
  async removeSubscription(endpoint: string): Promise<void> {
    return this.delete("/api/users/me/push-subscriptions/", { endpoint })
      .then((res) => res?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async preferences(): Promise<TPushPreference> {
    return this.get("/api/users/me/push-preferences/")
      .then((res) => res?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updatePreferences(data: Partial<TPushPreference>): Promise<TPushPreference> {
    return this.patch("/api/users/me/push-preferences/", data)
      .then((res) => res?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
