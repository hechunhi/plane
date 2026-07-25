/**
 * BARSOUL 2026-07-25 (hechun「審査を一等市民に·受信箱」): ワークスペース級
 * 「審査」受信箱の service。同源 Django 認証代理
 *   POST /api/workspaces/<slug>/ai-approvals/   {action:"list"|"decide", ...}
 * を叩くだけの薄い層。actor は Django が session から服务端解析するため、
 * 前端は actor_id を **一切送らない**(§X.3 可归因)。裁決は既存の
 * ai-bot /ai/decide-approval → Temporal に集約(このビューは engine を触らない)。
 */
import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TApprovalScope = "assigned" | "mine" | "all";
export type TApprovalStatusFilter = "open" | "closed" | "all";

// 独立(issue 無し)発起の愛ちゃん解析結果。工作项経路と同一の JSON。
export type TApprovalAnalyze = {
  subject: string;
  detail: string;
  suggested_approver_ids: string[];
  suggested_mode: "" | "ANY" | "ALL" | "SEQUENTIAL";
  risk_flags: string[];
  risk_note: string;
  clarify: string;
};

export type TApprovalInboxItem = {
  no: string;
  subject: string;
  preview: string;
  detail_full: string; // 独立は clickthrough 無し → 全文を受信箱で読む
  scope_note: string; // detail.范围(あれば)
  status: string; // 待批 / 通过 / 却下 / 撤回
  mode: string; // ALL / ANY / SEQUENTIAL
  mode_label: string; // 会签 / 或签 / 順次
  requester: string;
  requester_id: string;
  approvers: { id: string; name: string }[];
  approver_names: string;
  project_id: string;
  issue_id: string;
  scope: string; // 工作项 / 独立
  created_ms: number;
  is_mine: boolean;
  is_assigned: boolean;
  my_decision: string | null;
  my_pending: boolean;
};

class ApprovalsService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async list(
    workspaceSlug: string,
    scope: TApprovalScope,
    statusFilter: TApprovalStatusFilter
  ): Promise<TApprovalInboxItem[]> {
    return this.post(`/api/workspaces/${workspaceSlug}/ai-approvals/`, {
      action: "list",
      scope,
      status: statusFilter,
    })
      .then((res) => (Array.isArray(res?.data?.items) ? (res.data.items as TApprovalInboxItem[]) : []))
      .catch((err) => {
        throw err?.response?.data ?? err;
      });
  }

  async decide(
    workspaceSlug: string,
    no: string,
    decision: "OK" | "NO",
    reason: string
  ): Promise<{ ok: boolean; msg?: string }> {
    return this.post(`/api/workspaces/${workspaceSlug}/ai-approvals/`, {
      action: "decide",
      no,
      decision,
      reason,
    })
      .then((res) => ({ ok: !!res?.data?.ok, msg: res?.data?.msg }))
      .catch((err) => {
        throw err?.response?.data ?? err;
      });
  }

  // ── 独立(issue 無し)発起。engine は工作项経路と完全共有(scope-generic)。──

  // 自由文 → 件名/詳細/審査者/方式/リスク(**読むだけ**、起票しない)。
  async analyze(workspaceSlug: string, text: string, lang: string): Promise<TApprovalAnalyze> {
    return this.post(`/api/workspaces/${workspaceSlug}/ai-approvals/`, {
      action: "analyze",
      text,
      lang,
    })
      .then((res) => {
        const d = res?.data ?? {};
        return {
          subject: d.subject || "",
          detail: d.detail || "",
          suggested_approver_ids: Array.isArray(d.suggested_approver_ids) ? d.suggested_approver_ids : [],
          suggested_mode: d.suggested_mode || "",
          risk_flags: Array.isArray(d.risk_flags) ? d.risk_flags : [],
          risk_note: d.risk_note || "",
          clarify: d.clarify || "",
        } as TApprovalAnalyze;
      })
      .catch((err) => {
        throw err?.response?.data ?? err;
      });
  }

  // カード構成プレビュー(**読むだけ**)。人が組み替え、確定分を invoke.blocks で返す。
  async blocks(workspaceSlug: string, subject: string, detail: string): Promise<Record<string, unknown>[]> {
    return this.post(`/api/workspaces/${workspaceSlug}/ai-approvals/`, {
      action: "blocks",
      subject,
      detail,
      text: detail || subject,
    })
      .then((res) => (Array.isArray(res?.data?.blocks) ? (res.data.blocks as Record<string, unknown>[]) : []))
      .catch((err) => {
        throw err?.response?.data ?? err;
      });
  }

  // 独立審査を発起(create_approval → Temporal; project_id/issue_id は送らない)。
  async invoke(
    workspaceSlug: string,
    payload: {
      subject: string;
      detail: string;
      approver_ids: string[];
      mode: string;
      blocks?: Record<string, unknown>[];
    }
  ): Promise<{ ok: boolean; no?: string; msg?: string }> {
    return this.post(`/api/workspaces/${workspaceSlug}/ai-approvals/`, {
      action: "invoke",
      subject: payload.subject,
      detail: payload.detail,
      text: payload.detail || payload.subject,
      approver_ids: payload.approver_ids,
      mode: payload.mode,
      ...(payload.blocks && payload.blocks.length ? { blocks: payload.blocks } : {}),
    })
      .then((res) => ({ ok: !!res?.data?.ok, no: res?.data?.no, msg: res?.data?.msg }))
      .catch((err) => {
        throw err?.response?.data ?? err;
      });
  }
}

export const approvalsService = new ApprovalsService();
