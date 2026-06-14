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
  blueprint_id: string | null;
}>;

export type TRecurringAction = "run_now" | "skip_next" | "pause" | "resume";

// フォローアップ・スヌーズ(Linear 风: 隐藏到期日再浮现)
export type TSnoozePreset = "tomorrow" | "biz2" | "next_mon" | "week1";
export type TSnoozeState = {
  snoozed: boolean;
  until?: string;
  until_date?: string; // JST 目标日 YYYY-MM-DD
  by?: { id: string; display_name: string } | null;
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
      .then((r) => r?.data ?? { snoozed: false })
      .catch(() => ({ snoozed: false }));
  }
  async setSnooze(ws: string, pid: string, iid: string, body: { preset?: TSnoozePreset; until?: string }): Promise<TSnoozeState> {
    return this.post(this.snoozeUrl(ws, pid, iid), body).then((r) => r?.data);
  }
  async clearSnooze(ws: string, pid: string, iid: string): Promise<TSnoozeState> {
    return this.post(this.snoozeUrl(ws, pid, iid), { clear: true }).then((r) => r?.data);
  }
}

export const recurringService = new RecurringService();
