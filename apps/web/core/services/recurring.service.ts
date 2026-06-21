/**
 * BARSOUL: 定期タスク / 周期任务 service(IUTEYA-15). 见 docs/architecture/recurring-tasks-mvp.md.
 * 规则 CRUD + 今すぐ生成 / 次回スキップ / 一時停止。照 smart-table.service(APIService)。
 */
import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TRecurringCadence = "weekly" | "monthly" | "quarterly" | "yearly";
// anchor 语义锚点(JST 求值): weekly{weekdays} / monthly{mode:day|eom|bom, day} / quarterly{start_month, mode, day} / yearly{month, day}
export type TRecurringAnchor = {
  weekdays?: number[];
  mode?: "day" | "eom" | "bom";
  day?: number;
  start_month?: number;
  month?: number;
};
// 派生态(读时投影): 有効/停止中(paused)/要対応(逾期,attention)/進行中(inflight)
export type TRecurringDerived = "active" | "paused" | "archived" | "attention" | "inflight";

export type TRecurringRule = {
  id: string;
  name: string;
  cadence: TRecurringCadence;
  anchor: TRecurringAnchor;
  lead_days: number;
  status: "active" | "paused" | "archived";
  skip_next: boolean;
  assignee: { id: string; display_name: string } | null;
  labels: string[];
  template: { title?: string; description_html?: string; priority?: string };
  generation_prompt: string; // 以上一张卡为基, 按此提示词 LLM 改写出新卡正文(空=原样克隆)
  blueprint: string | null;
  next_run_at: string | null; // 次回作成(生成日)
  next_due: string | null; // 次回期日(≠ 作成日, 信任命门)
  period_label: string | null;
  derived_state: TRecurringDerived;
  fail_count: number;
  last_issue: {
    id: string;
    name: string;
    sequence_id: number;
    identifier: string;
    state_group: string | null;
    target_date: string | null;
  } | null;
};

export type TRecurringInput = Partial<{
  name: string;
  cadence: TRecurringCadence;
  anchor: TRecurringAnchor;
  lead_days: number;
  assignee_id: string | null;
  labels: string[];
  template: Record<string, unknown>;
  generation_prompt: string;
  blueprint_id: string | null;
}>;

export type TRecurringAction = "run_now" | "skip_next" | "pause" | "resume";

// リマインダー(2026-06-15 強化: 何时/是否隐藏/强度/受众 可配置)
export type TSnoozePreset = "tomorrow" | "biz2" | "next_mon" | "week1";
export type TReminderIntensity = "once" | "daily";
export type TReminderAudience = "self" | "assignees" | "members";
export type TSnoozeState = {
  set: boolean;
  at?: string; // ISO
  at_date?: string; // JST 目标日 YYYY-MM-DD
  at_jst?: string; // "YYYY-MM-DD HH:MM" JST 显示
  hide?: boolean;
  intensity?: TReminderIntensity;
  audience?: TReminderAudience;
  note?: string; // 备忘: 到时提醒我做什么
  by?: { id: string; display_name: string } | null;
};
export type TReminderInput = {
  at?: string; // ISO datetime(绝対, 优先)
  preset?: TSnoozePreset;
  until?: string; // YYYY-MM-DD
  time?: string; // "HH:MM" JST(preset/until/lead 配合)
  lead_days?: number; // 相对 target_date 提前 N 天
  hide?: boolean;
  intensity?: TReminderIntensity;
  audience?: TReminderAudience;
  note?: string;
};
// hub「リマインダー」: 我的待回来提醒(工作区级)
export type TMyReminder = {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  project_identifier: string;
  at: string;
  at_jst: string;
  at_date: string;
  note: string;
  hide: boolean;
  intensity: TReminderIntensity;
  audience: TReminderAudience;
  state_group: string | null;
  mine: boolean;
};

// 卡顶上下文条: 该卡若是某规则的当前实例
export type TRecurringContext = {
  recurring: boolean;
  rule?: {
    id: string;
    name: string;
    cadence: TRecurringCadence;
    cadence_label: string;
    next_due: string | null;
    period_label: string | null;
    status: string;
    derived_state: TRecurringDerived;
  };
};

class RecurringService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(ws: string, pid: string) {
    return `/api/workspaces/${ws}/projects/${pid}/recurring`;
  }

  async list(ws: string, pid: string): Promise<TRecurringRule[]> {
    return this.get(`${this.base(ws, pid)}/`)
      .then((r) => r?.data ?? [])
      .catch(() => []);
  }

  async create(ws: string, pid: string, data: TRecurringInput): Promise<TRecurringRule> {
    return this.post(`${this.base(ws, pid)}/`, data).then((r) => r?.data);
  }

  async update(ws: string, pid: string, rid: string, data: TRecurringInput): Promise<TRecurringRule> {
    return this.patch(`${this.base(ws, pid)}/${rid}/`, data).then((r) => r?.data);
  }

  async remove(ws: string, pid: string, rid: string): Promise<void> {
    return this.delete(`${this.base(ws, pid)}/${rid}/`).then(() => undefined);
  }

  async action(ws: string, pid: string, rid: string, action: TRecurringAction): Promise<TRecurringRule> {
    return this.post(`${this.base(ws, pid)}/${rid}/action/`, { action }).then((r) => r?.data);
  }

  // 卡顶上下文条: 该卡是否某规则的当前实例
  async getIssueContext(ws: string, pid: string, iid: string): Promise<TRecurringContext> {
    return this.get(`/api/workspaces/${ws}/projects/${pid}/issues/${iid}/recurring/`)
      .then((r) => r?.data ?? { recurring: false })
      .catch(() => ({ recurring: false }));
  }

  // フォローアップ・スヌーズ
  private snoozeUrl(ws: string, pid: string, iid: string) {
    return `/api/workspaces/${ws}/projects/${pid}/issues/${iid}/snooze/`;
  }
  async getSnooze(ws: string, pid: string, iid: string): Promise<TSnoozeState> {
    return this.get(this.snoozeUrl(ws, pid, iid))
      .then((r) => r?.data ?? { set: false })
      .catch(() => ({ set: false }));
  }
  async setSnooze(ws: string, pid: string, iid: string, body: TReminderInput): Promise<TSnoozeState> {
    return this.post(this.snoozeUrl(ws, pid, iid), body).then((r) => r?.data);
  }
  async clearSnooze(ws: string, pid: string, iid: string): Promise<TSnoozeState> {
    return this.post(this.snoozeUrl(ws, pid, iid), { clear: true }).then((r) => r?.data);
  }

  // hub: 我的待回来提醒(工作区级, 跨项目)
  async listReminders(ws: string): Promise<TMyReminder[]> {
    return this.get(`/api/workspaces/${ws}/reminders/`)
      .then((r) => r?.data ?? [])
      .catch(() => []);
  }
}

export const recurringService = new RecurringService();
