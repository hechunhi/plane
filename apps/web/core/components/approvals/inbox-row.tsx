/**
 * BARSOUL 2026-07-25 (hechun「審査を一等市民に·受信箱」): 受信箱の 1 行。
 * 決めるべき審査を「件名 + 発起人 + 審査者チェーン + 状態」で一覧し、自分の
 * 裁決待ち(my_pending)なら承認/却下をその場で完結させる。裁決は既存の
 * ai-bot /ai/decide-approval → Temporal に集約(このビューは engine を触らない)。
 *
 * 色の約束(§UI 色彩语义): 琥珀 = 行動信号専属 → my_pending の左縁/徽章のみ。
 * accent 蓝 = 位置/選中(タブ側)。状態徽は success/red/muted の意味色。
 */
import { useState } from "react";
import { Check, X, ChevronRight, ChevronDown, User2 } from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { approvalsService, type TApprovalInboxItem } from "@/services/approvals.service";

type Props = {
  item: TApprovalInboxItem;
  workspaceSlug: string;
  onDecided: () => void;
};

// 状態徽の意味色(通过=success / 却下・驳回=red / 撤回=muted / 待批=neutral)。
function statusClass(status: string): string {
  if (status === "通过") return "bg-success-subtle text-success-primary";
  if (status === "却下" || status === "驳回") return "bg-danger-subtle text-danger-primary";
  if (status === "撤回") return "bg-surface-2 text-tertiary";
  return "border border-subtle text-secondary"; // 待批
}

export function ApprovalInboxRow({ item, workspaceSlug, onDecided }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"OK" | "NO" | null>(null);
  const [done, setDone] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // 独立(issue 無し)は clickthrough 先が無い → 受信箱で全文を展開して読む。
  const isStandalone = item.scope === "独立";
  const hasFullDetail = !!(item.detail_full || item.scope_note);

  const decide = async (decision: "OK" | "NO") => {
    if (busy || done) return;
    setBusy(decision);
    try {
      const r = await approvalsService.decide(workspaceSlug, item.no, decision, reason.trim());
      if (r.ok) {
        setDone(true);
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: decision === "OK" ? t("approval_inbox.sent_approve") : t("approval_inbox.sent_reject"),
          message: r.msg || "",
        });
        onDecided();
      } else {
        setToast({ type: TOAST_TYPE.ERROR, title: t("approval_inbox.decide_failed"), message: r.msg || "" });
      }
    } catch (e) {
      const msg = (e as { error?: string; msg?: string })?.error || (e as { msg?: string })?.msg || "";
      setToast({ type: TOAST_TYPE.ERROR, title: t("approval_inbox.decide_failed"), message: msg });
    } finally {
      setBusy(null);
    }
  };

  const created = item.created_ms ? new Date(item.created_ms) : null;
  const createdLabel = created
    ? created.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const statusLabel =
    item.status === "待批" ? t("approval_inbox.status_pending") : item.status || t("approval_inbox.status_pending");
  const showActions = item.my_pending && !done;

  return (
    <div
      className={`rounded-lg border bg-surface-1 p-3.5 ${
        showActions ? "border-l-2 border-subtle border-l-[#d97706]" : "border-subtle"
      }`}
    >
      {/* 頭部: 件名(強調)+ 状態徽 + スコープ + 番号尾 */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 truncate text-13 font-semibold text-primary" title={item.subject}>
          {item.subject || t("approval_inbox.no_subject")}
        </span>
        <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-10 ${statusClass(item.status)}`}>{statusLabel}</span>
        <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-10 text-tertiary">
          {item.scope === "独立" ? t("approval_inbox.scope_standalone") : t("approval_inbox.scope_work_item")}
        </span>
        <span className="shrink-0 text-10 text-placeholder" title={item.no}>
          …{item.no.slice(-8)}
        </span>
      </div>

      {/* meta: 発起人 · モード · 審査者 · 時刻 */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-11 text-tertiary">
        <span className="inline-flex items-center gap-1">
          <User2 className="size-3 shrink-0" />
          {item.requester || t("approval_inbox.unknown_requester")}
        </span>
        <span className="text-placeholder">·</span>
        <span>{item.mode_label || item.mode}</span>
        {item.approver_names && (
          <>
            <span className="text-placeholder">·</span>
            <span className="min-w-0 truncate" title={item.approver_names}>
              {t("approval_inbox.approvers_label")}: {item.approver_names}
            </span>
          </>
        )}
        {createdLabel && (
          <>
            <span className="text-placeholder">·</span>
            <span>{createdLabel}</span>
          </>
        )}
        {item.my_decision && (
          <>
            <span className="text-placeholder">·</span>
            <span className="text-secondary">
              {t("approval_inbox.my_decision")}: {item.my_decision}
            </span>
          </>
        )}
      </div>

      {/* preview / 独立は展開で全文 */}
      {isStandalone && expanded && hasFullDetail ? (
        <div className="mt-1.5 space-y-1.5">
          {item.detail_full && <div className="text-12 whitespace-pre-wrap text-secondary">{item.detail_full}</div>}
          {item.scope_note && (
            <div className="text-11 text-tertiary">
              {t("approval_inbox.scope_note_label")}: {item.scope_note}
            </div>
          )}
        </div>
      ) : (
        item.preview && <div className="mt-1.5 line-clamp-1 text-12 text-secondary">{item.preview}</div>
      )}

      {/* 底部: issue へのリンク / 独立は全文トグル + 裁決 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {item.issue_id && item.project_id ? (
          <Link
            to={`/${workspaceSlug}/projects/${item.project_id}/issues/${item.issue_id}`}
            className="inline-flex items-center gap-0.5 text-11 text-accent-primary hover:underline"
          >
            {t("approval_inbox.open_work_item")}
            <ChevronRight className="size-3" />
          </Link>
        ) : (
          isStandalone &&
          hasFullDetail && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-0.5 text-11 text-tertiary hover:text-secondary"
            >
              {expanded ? t("approval_inbox.hide_detail") : t("approval_inbox.show_detail")}
              <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )
        )}
        {showActions && (
          <div className="ml-auto flex flex-1 flex-wrap items-center justify-end gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("approval_inbox.reason_placeholder")}
              className="h-7 min-w-44 flex-1 rounded-md border border-subtle bg-surface-1 px-2.5 text-12 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
            />
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void decide("OK")}
              className="h-7 shrink-0 rounded-md bg-[#16a34a] px-3 text-12 font-medium text-white hover:bg-[#15803d] disabled:opacity-50"
            >
              {busy === "OK" ? (
                t("approval_inbox.sending")
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-3.5" />
                  {t("approval_inbox.approve")}
                </span>
              )}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void decide("NO")}
              className="h-7 shrink-0 rounded-md border border-[#dc2626]/70 px-3 text-12 font-medium text-[#dc2626] hover:bg-[#dc2626]/[0.06] disabled:opacity-50"
            >
              {busy === "NO" ? (
                t("approval_inbox.sending")
              ) : (
                <span className="inline-flex items-center gap-1">
                  <X className="size-3.5" />
                  {t("approval_inbox.reject")}
                </span>
              )}
            </button>
          </div>
        )}
        {done && <span className="ml-auto text-12 font-medium text-secondary">{t("approval_inbox.decided")}</span>}
      </div>
    </div>
  );
}
