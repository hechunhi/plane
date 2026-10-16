/**
 * BARSOUL リマインダー共用ヘルパー — 详情动作栏(ReminderActionButton)・完整弹窗(ReminderDialog)・右键菜单(helper.tsx)三处同源。
 * 日付は全てブラウザのローカル日(社内=JST)。toISOString() は UTC 日付になり JST 0-9 時に 1 日ずれるので使わない。
 */
import type { TReminderAudience } from "@/services/recurring.service";

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const mkDay = (add: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + add);
  return d;
};
export const nextMon = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d;
};

const WD_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WD_JA = ["日", "月", "火", "水", "木", "金", "土"];
export const weekday = (zh: boolean, d: Date) => (zh ? WD_ZH : WD_JA)[d.getDay()];
// 预设副标: 「周六 09:00」— 让「明早/后天」落在周末一眼可见。
export const presetSub = (zh: boolean, d: Date, time: string) => `${weekday(zh, d)} ${time}`;

// 预览动词: 选了「担当/全员」就别再写「提醒你」。
export const remindWho = (zh: boolean, a: TReminderAudience) =>
  a === "members"
    ? zh
      ? "提醒全员"
      : "全員に通知"
    : a === "assignees"
      ? zh
        ? "提醒担当"
        : "担当に通知"
      : zh
        ? "提醒你"
        : "に通知";

// 错误文案按真实原因区分(旧实现把 500/断网也说成「请选未来时间」, 误导排查)。
export function reminderErrorTitle(zh: boolean, e: unknown): string {
  const status = (e as { response?: { status?: number } })?.response?.status;
  if (status === 403)
    return zh ? "无权限:仅创建者/管理者可对所有人隐藏" : "権限なし:全員から隠せるのは作成者/管理者のみ";
  if (status === 400) return zh ? "设置失败:请选未来的时间" : "設定失敗:未来の日時を選んでください";
  if (!status) return zh ? "设置失败:网络异常,请重试" : "設定失敗:通信エラー、再試行してください";
  return zh ? `设置失败:服务器错误(${status}),请重试` : `設定失敗:サーバーエラー(${status})、再試行してください`;
}
