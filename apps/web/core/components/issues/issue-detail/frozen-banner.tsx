/**
 * BARSOUL ADR-029: detail/peek panel 凍結カード banner.
 * 役割別文言と CTA を表示 — pending_approver にだけ強提示, 他は弱提示.
 * SoR = ai-bot /api/issue/approval/{id} (Lark Base 由来. 将来 Postgres
 * 移行は useIssueApproval が単一エントリポイントとして抽象). 失敗静默.
 */
import { observer } from "mobx-react";
import { useIssueApproval, type TFrozenRole } from "@/hooks/use-issue-approval";

type Props = { issueId: string };

const roleStyles: Record<TFrozenRole, { bar: string; bg: string; icon: string }> = {
  pending_approver: { bar: "border-l-[5px] border-[#dc2626]", bg: "bg-[#dc2626]/[0.10]", icon: "🔔" },
  queued_approver: { bar: "border-l-4 border-[#d97706]/70", bg: "bg-[#d97706]/[0.06]", icon: "⏳" },
  initiator: { bar: "border-l-4 border-[#d97706]", bg: "bg-[#d97706]/[0.06]", icon: "📋" },
  bystander: { bar: "border-l-2 border-[#94a3b8]", bg: "bg-[#94a3b8]/[0.06]", icon: "🔒" },
  none: { bar: "", bg: "", icon: "" },
};

const roleTitle: Record<TFrozenRole, string> = {
  pending_approver: "あなたの審査待ち / 待你审批",
  queued_approver: "順次審査(あなたの番待ち)",
  initiator: "あなたが発起した審査が進行中",
  bystander: "他人が審査中(操作不可)",
  none: "",
};

export const FrozenBanner = observer(function FrozenBanner({ issueId }: Props) {
  const { approval, frozen, myRole } = useIssueApproval(issueId);
  if (!frozen || !approval) return null;
  const s = roleStyles[myRole];
  const undecided = (approval.approvers || []).filter((a) => !a.decided);
  const decided = (approval.approvers || []).filter((a) => a.decided);
  return (
    <div className={`mb-3 rounded-r-md p-3 ${s.bar} ${s.bg}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-13 font-medium text-primary">
            {s.icon} {roleTitle[myRole]}
            <span className="ml-2 text-tertiary text-12">
              #{approval.no} · {approval.mode === "ALL" ? "全員承認" : approval.mode === "ANY" ? "いずれか1名" : "順次承認"}
            </span>
          </div>
          <div className="mt-1.5 text-12 text-secondary">
            <span className="text-tertiary">承認進捗: </span>
            {decided.length}/{(approval.approvers || []).length}
            {decided.length > 0 && (
              <span className="ml-1 text-tertiary">
                ({decided.map((a) => `${a.name} ${a.decision === "通过" ? "✅" : "❌"}`).join("・")})
              </span>
            )}
            {undecided.length > 0 && (
              <span className="ml-2 text-tertiary">
                · 未決: {undecided.map((a) => a.name).join("・")}
              </span>
            )}
          </div>
          {myRole === "pending_approver" && (
            <div className="mt-2 text-12 text-secondary">
              💡 評論で <code className="rounded bg-layer-1 px-1">@愛ちゃん 通過 #{approval.no} 理由</code> または
              <code className="ml-1 rounded bg-layer-1 px-1">却下 ...</code> で決定. または下の審査カードへ.
            </div>
          )}
          {myRole === "initiator" && (
            <div className="mt-2 text-12 text-secondary">
              💡 撤回するには <code className="rounded bg-layer-1 px-1">@愛ちゃん 撤回 #{approval.no} 理由</code>
            </div>
          )}
          {myRole === "bystander" && (
            <div className="mt-1 text-12 text-tertiary">他のメンバーの審査中. 状態/期限/優先度 変更不可.</div>
          )}
        </div>
      </div>
    </div>
  );
});
