/**
 * BARSOUL ADR-029: detail/peek panel 凍結カード banner.
 * 役割別文言と CTA を表示 — pending_approver にだけ強提示, 他は弱提示.
 * SoR = ai-bot /api/issue/approval/{id} (approval PG). 失敗静默.
 * B-2e(2026-06-10 hechun「审批深度集成UI」): 承認/却下を**バナー上の実ボタン**に
 * 昇格 — fork 認証代理 action=decide → ai-bot apply_decision → Temporal signal。
 * B-2f(2026-06-10 hechun「審査は評論区に流さない」): 評論流水全廃 → 本ファイルが
 * 審査の表示面(バナー=進行中, ApprovalHistory=終結済)。文言は useZh で zh/ja 切替。
 */
import { Fragment, useState } from "react";
import { Bell, Check, ClipboardList, Hourglass, LayoutTemplate, Lock, ShieldCheck, Workflow, X, type LucideIcon } from "lucide-react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Avatar } from "@plane/ui";
import { getFileURL } from "@plane/utils";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { useIssueApproval, type TApprover, type TFrozenRole } from "@/hooks/use-issue-approval";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { smartTableService, type TIssueBlueprint } from "@/services/smart-table.service";

type Props = { issueId: string };

// Blueprint 系の審査 No は workflow id で長大 → 表示は省略形(全号は title で)。
const shortNo = (no: string) => (no.length > 22 ? `${no.slice(0, 10)}…${no.slice(-8)}` : no);

// B-2h 走査会診: alert 風(橙大色块+粗左条)→ 中性カード化。緊急度は
// pending のみ极淡琥珀(边框+底 4%)で伝え、他役割は素のカード。
// UI 禁 emoji 图标(2026-06-11 规范): 一律 lucide 单色线性图标。
const roleStyles: Record<TFrozenRole, { box: string; icon: LucideIcon | null }> = {
  pending_approver: { box: "border-[#d9920a]/40 bg-[#d9920a]/[0.04]", icon: Bell },
  queued_approver: { box: "border-subtle bg-surface-1", icon: Hourglass },
  initiator: { box: "border-subtle bg-surface-1", icon: ClipboardList },
  bystander: { box: "border-subtle bg-surface-1", icon: Lock },
  none: { box: "", icon: null },
};

const useT = () => {
  const zh = useZh();
  return zh
    ? {
        roleTitle: {
          pending_approver: "待你审批", queued_approver: "顺序审批(还没轮到你)",
          initiator: "你发起的审批进行中", bystander: "他人审批中(状态已冻结)", none: "",
        } as Record<TFrozenRole, string>,
        modeTxt: { ALL: "会签·全员通过", ANY: "或签·任一通过", SEQUENTIAL: "顺序审批" } as Record<string, string>,
        chainInit: "发起", stPending: "待审", stQueued: "排队", stOk: "已通过", stNo: "已驳回",
        progress: "进度", undecided: "未决", approve: "通过", reject: "驳回",
        sending: "提交中…", reasonPh: "理由·批语(可选,驳回时建议填)",
        sent: "决定已提交,结果马上反映。",
        sendOkA: "已提交通过", sendOkR: "已提交驳回",
        sendFail: "决定提交失败", netErr: "网络错误",
        withdraw: "撤回请评论", bystanderNote: "他人审批中,状态/期限/负责人暂不可改。",
        histTitle: "审查记录", histPass: "通过", histReject: "驳回", histWithdraw: "撤回",
      }
    : {
        roleTitle: {
          pending_approver: "あなたの審査待ち", queued_approver: "順次審査(あなたの番待ち)",
          initiator: "あなたが発起した審査が進行中", bystander: "他のメンバーが審査中(状態凍結)", none: "",
        } as Record<TFrozenRole, string>,
        modeTxt: { ALL: "会签・全員承認", ANY: "或签・いずれか1名", SEQUENTIAL: "順次承認" } as Record<string, string>,
        chainInit: "発起", stPending: "審査待ち", stQueued: "順番待ち", stOk: "承認済", stNo: "却下",
        progress: "進捗", undecided: "未決", approve: "承認する", reject: "却下する",
        sending: "送信中…", reasonPh: "理由・コメント(任意 / 却下時は推奨)",
        sent: "決定を送信しました。まもなく反映されます。",
        sendOkA: "承認を送信しました", sendOkR: "却下を送信しました",
        sendFail: "決定を送信できません", netErr: "ネットワークエラー",
        withdraw: "撤回はコメントで", bystanderNote: "他のメンバーの審査中。状態/期限/優先度は変更不可。",
        histTitle: "審査記録", histPass: "通過", histReject: "却下", histWithdraw: "撤回",
      };
};

/** B-2h: 審査チェーン可視化 — 発起人 → 各審査者を頭像 chip で。
 *  SEQUENTIAL は → 連結+現在番手を ring 強調; ANY/ALL は並列(・区切り)。
 *  状態徽: ✓承認(緑) ×却下(赤) ●現在審査待ち(琥珀) ◌順番待ち(灰)。 */
const ApprovalChain = observer(function ApprovalChain({
  approvers,
  mode,
  initiator,
}: {
  approvers: TApprover[];
  mode?: string;
  initiator?: { id: string; name: string } | null;
}) {
  const T = useT();
  const { getUserDetails } = useMember();
  const seq = mode === "SEQUENTIAL";
  // 走査会診: chip の状態は「边框色 + 状态词同色」一层表达(pill 中嵌 pill の層級混乱を解消)
  const stateOf = (a: TApprover) => {
    if (a.decided) {
      return a.decision === "通过"
        ? { badge: "✓", label: T.stOk, cls: "text-success-primary", box: "border-success-primary/40" }
        : { badge: "×", label: T.stNo, cls: "text-danger-primary", box: "border-danger-strong/50" };
    }
    if (seq && !a.is_current) return { badge: "◌", label: T.stQueued, cls: "text-placeholder", box: "border-subtle opacity-70" };
    return { badge: "●", label: T.stPending, cls: "text-[#b07509]", box: "border-[#d9920a]/60" };
  };
  const arrow = <span className="text-12 text-placeholder">→</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
      {/* 起点: 人発起=頭像 chip / 自動(Blueprint 等, initiator 無)=Workflow icon 灰起点 — 鎖鏈に必ず起点を持たせる */}
      {initiator ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-layer-2 py-0.5 pl-1 pr-2.5">
          <Avatar
            name={getUserDetails(initiator.id)?.display_name || initiator.name}
            src={getFileURL(getUserDetails(initiator.id)?.avatar_url ?? "")}
            size="sm"
            shape="circle"
            showTooltip={false}
          />
          <span className="text-12 text-secondary">{getUserDetails(initiator.id)?.display_name || initiator.name}</span>
          <span className="text-10 text-placeholder">{T.chainInit}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-layer-2 px-2.5 py-0.5">
          <Workflow className="size-3.5 text-tertiary" />
          <span className="text-12 text-secondary">Blueprint</span>
          <span className="text-10 text-placeholder">{T.chainInit}</span>
        </span>
      )}
      {arrow}
      {approvers.map((a, i) => {
        const st = stateOf(a);
        const d = getUserDetails(a.id);
        return (
          <Fragment key={a.id}>
            {i > 0 && (seq ? arrow : <span className="text-12 text-placeholder">·</span>)}
            <span className={`inline-flex items-center gap-1.5 rounded-full border bg-surface-1 py-0.5 pl-1 pr-2.5 ${st.box}`}>
              <Avatar name={d?.display_name || a.name} src={getFileURL(d?.avatar_url ?? "")} size="sm" shape="circle" showTooltip={false} />
              <span className="text-12 font-medium text-primary">{d?.display_name || a.name}</span>
              <span className={`text-11 ${st.cls}`}>
                {st.badge} {st.label}
              </span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
});

export const FrozenBanner = observer(function FrozenBanner({ issueId }: Props) {
  const T = useT();
  const { approval, frozen, myRole, refresh } = useIssueApproval(issueId);
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"OK" | "NO" | null>(null);
  const [sent, setSent] = useState(false);
  const projectId = getIssueById(issueId)?.project_id;
  // B-5c(2026-06-11「審査と Blueprint の割裂」): Blueprint 発の審査(No が bp-
  // 前缀)はフロー徽を掲げ、チェーン(flow-context)とバナーが互いを認知する。
  // 同 SWR key = flow-context と共用(同卡なら追加リクエストほぼゼロ)。
  const isBpApproval = !!approval?.no?.startsWith("bp-");
  const { data: flowCtx } = useSWR<TIssueBlueprint>(
    frozen && isBpApproval && workspaceSlug && projectId ? `ISSUE_FLOW_CTX:${issueId}` : null,
    () => smartTableService.getIssueBlueprint(workspaceSlug!, projectId!, issueId),
    { dedupingInterval: 30_000 }
  );
  // label 在 = 一定显示(endpoint 失敗/未読でも minimal banner)
  if (!frozen) return null;
  const s = roleStyles[myRole];
  const total = (approval?.approvers || []).length;
  const decidedN = (approval?.approvers || []).filter((a) => a.decided).length;
  const hasDetail = !!(approval && approval.no);
  const flowStage = flowCtx?.bound
    ? (flowCtx.progress || []).find((p) => p.kind === "approval" && p.status === "current")?.label
    : undefined;
  const flowBadge = flowCtx?.bound ? `${flowCtx.title}${flowStage ? ` · ${flowStage}` : ""}` : null;

  const decide = async (decision: "OK" | "NO") => {
    if (!approval?.no || !workspaceSlug || !projectId || busy) return;
    setBusy(decision);
    try {
      const r = await fetch(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/ai-approval/`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
          body: JSON.stringify({ action: "decide", no: approval.no, decision, reason: reason.trim() }),
        }
      );
      let j: { ok?: boolean; msg?: string; error?: string } = {};
      try {
        j = await r.json();
      } catch {
        /* 非 JSON 应答 → 下面统一报错 */
      }
      if (r.ok && j.ok) {
        setSent(true);
        setToast({ type: TOAST_TYPE.SUCCESS, title: decision === "OK" ? T.sendOkA : T.sendOkR, message: j.msg || "" });
        void refresh();
      } else {
        setToast({ type: TOAST_TYPE.ERROR, title: T.sendFail, message: j.error || j.msg || `HTTP ${r.status}` });
      }
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: T.sendFail, message: T.netErr });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`mb-3 space-y-2.5 rounded-lg border p-3.5 ${s.box}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-2.5">
          {/* 頭部行: 役割(強調) + 件名 / meta は右端へ降権(単審査者は進捗省略, 機械番号は尾 8 桁の超淡字+title 全号) */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="inline-flex items-center gap-1.5 text-13 font-semibold text-primary">
              {s.icon && <s.icon className="size-3.5 shrink-0 text-secondary" />} {T.roleTitle[myRole]}
            </span>
            {hasDetail && approval!.subject && <span className="min-w-0 truncate text-13 text-secondary">{approval!.subject}</span>}
            {/* B-5c: フロー徽 — この審査は流程の閘門站である事を明示(チェーン⇄バナー互認) */}
            {hasDetail && flowBadge && (
              <span className="inline-flex max-w-56 shrink-0 items-center gap-1 truncate rounded-sm bg-accent-subtle px-1.5 py-0.5 text-10 text-accent-primary">
                <LayoutTemplate className="size-3 shrink-0" /> <span className="truncate">{flowBadge}</span>
              </span>
            )}
            {hasDetail && (
              <span className="ml-auto shrink-0 text-11 text-placeholder" title={approval!.no}>
                {T.modeTxt[approval!.mode || "ANY"] ?? approval!.mode}
                {total > 1 ? ` · ${decidedN}/${total}` : ""}
                <span className="ml-1.5 opacity-60">…{approval!.no!.slice(-8)}</span>
              </span>
            )}
          </div>
          {/* B-2h: 審査チェーン(頭像+状態徽) */}
          {hasDetail && (
            <ApprovalChain approvers={approval!.approvers || []} mode={approval!.mode} initiator={approval!.initiator ?? null} />
          )}
          {/* B-2e: 承認/却下はバナー上の実ボタンで完結 — 操作組は舒適幅(max-w-xl)に収束, 形態は h-7/text-12 で統一 */}
          {hasDetail && myRole === "pending_approver" && !sent && (
            <div className="flex max-w-xl flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!!busy || !projectId}
                onClick={() => void decide("OK")}
                className="h-7 shrink-0 rounded-md bg-[#16a34a] px-3 text-12 font-medium text-white hover:bg-[#15803d] disabled:opacity-50"
              >
                {busy === "OK" ? T.sending : (<span className="inline-flex items-center gap-1"><Check className="size-3.5" />{T.approve}</span>)}
              </button>
              <button
                type="button"
                disabled={!!busy || !projectId}
                onClick={() => void decide("NO")}
                className="h-7 shrink-0 rounded-md border border-[#dc2626]/70 px-3 text-12 font-medium text-[#dc2626] hover:bg-[#dc2626]/[0.06] disabled:opacity-50"
              >
                {busy === "NO" ? T.sending : (<span className="inline-flex items-center gap-1"><X className="size-3.5" />{T.reject}</span>)}
              </button>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={T.reasonPh}
                className="h-7 min-w-44 flex-1 rounded-md border border-subtle bg-surface-1 px-2.5 text-12 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
              />
            </div>
          )}
          {hasDetail && myRole === "pending_approver" && sent && (
            <div className="text-12 font-medium text-secondary">{T.sent}</div>
          )}
          {myRole === "bystander" && <div className="text-12 text-tertiary">{T.bystanderNote}</div>}
        </div>
      </div>
    </div>
  );
});

/** B-2f: 終結済審査の記録(評論流水の代替表示面)。履歴ゼロなら非表示。
 *  B-2g 走査: 既定は折りたたみ 1 行(情報密度低い区画が視覚首位を占めない) —
 *  最新 1 件の結果を chip で要約、クリックで全履歴展開。 */
export const ApprovalHistory = observer(function ApprovalHistory({ issueId }: Props) {
  const T = useT();
  const { approval } = useIssueApproval(issueId);
  const [open, setOpen] = useState(false);
  const hist = approval?.history || [];
  if (hist.length === 0) return null;
  const statusMeta = (st: string) =>
    st === "通过"
      ? { icon: "✓", label: T.histPass, cls: "text-success-primary" }
      : st === "却下" || st === "驳回"
        ? { icon: "×", label: T.histReject, cls: "text-danger-primary" }
        : { icon: "↩", label: T.histWithdraw, cls: "text-tertiary" };
  const latest = hist[0];
  const lm = statusMeta(latest.status);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-12 text-tertiary hover:bg-layer-1-hover"
      >
        <span className="shrink-0">{open ? "▾" : "▸"}</span>
        <span className="inline-flex shrink-0 items-center gap-1 font-medium"><ShieldCheck className="size-3.5" /> {T.histTitle}({hist.length})</span>
        {!open && (
          <span className="flex min-w-0 items-center gap-1.5 text-12">
            <span className={`shrink-0 font-medium ${lm.cls}`}>{lm.icon} {lm.label}</span>
            <span className="truncate text-secondary">{latest.subject || shortNo(latest.no)}</span>
            <span className="shrink-0 text-placeholder">{(latest.approvers || []).join("・")}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 rounded-md border border-subtle px-3 py-2">
          {hist.map((h) => {
            const m = statusMeta(h.status);
            return (
              <div key={h.no} className="flex items-center gap-2 text-12 text-secondary" title={h.no}>
                <span className={`shrink-0 font-medium ${m.cls}`}>
                  {m.icon} {m.label}
                </span>
                <span className="truncate">{h.subject || shortNo(h.no)}</span>
                <span className="shrink-0 text-tertiary">{(h.approvers || []).join("・")}</span>
                <span className="ml-auto shrink-0 text-10 text-placeholder">
                  {h.finalized_at ? h.finalized_at.slice(0, 16).replace("T", " ") : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
