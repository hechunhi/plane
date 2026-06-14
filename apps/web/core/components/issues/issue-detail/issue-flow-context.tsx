/**
 * BARSOUL B-2j: 流程上下文条 — 子卡(流程站卡)単独打开时的「我在哪/做什么/做完会怎样」。
 * ユーザ課題: 蓝图自动建的站卡在看板平铺, 単独进入时执行人迷失(创建时の上下文が無い)。
 * 设计(方向A, 用户拍板): ①所属流程行(父卡链接+蓝图徽) ②站点链(B-2c progress 同型,
 * 本卡●高亮, 各站可点跳卡) ③行动指引(完全从蓝图 def 读时投影: 表单名+完成驱动语义+
 * 下一站&担当 — def 改版旧卡自动跟新, 绝不写死)。根卡也显示链(总览), 不显示指引。
 * B-2p v2(用户点名快捷动作行): 発起入口は IssueDetailWidgetActionButtons の
 * StartFlowButton へ全面移設 — 本组件回归纯展示(链条/指引/呼救/干预)。
 * 数据: GET issues/{iid}/blueprint-instance/(三向反查, 见 views/blueprint.py)。
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ArrowRight, LayoutTemplate, LifeBuoy, Settings2 } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import type { TIssue } from "@plane/types";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { useUser } from "@/hooks/store/user";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { smartTableService, type TBlueprintStage, type TIssueBlueprint } from "@/services/smart-table.service";

type Props = { issueId: string };

const STAGE_ICON: Record<TBlueprintStage["status"], string> = {
  done: "✓",
  current: "●",
  pending: "○",
  cancelled: "×",
};

export const IssueFlowContext = observer(function IssueFlowContext({ issueId }: Props) {
  const zh = useZh();
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { handleRedirection } = useIssuePeekOverviewRedirection();
  const issue = getIssueById(issueId);
  const projectId = issue?.project_id;
  // SPA 跳卡(peek): store に居る卡はそのまま, 居ない卡は最小 TIssue を合成
  const openIssue = (id: string, pid: string, seq?: number) => {
    if (!workspaceSlug) return;
    const full = getIssueById(id);
    handleRedirection(workspaceSlug, full ?? ({ id, project_id: pid, sequence_id: seq ?? 0 } as unknown as TIssue));
  };
  const { data, mutate } = useSWR<TIssueBlueprint>(
    workspaceSlug && projectId && issueId ? `ISSUE_FLOW_CTX:${issueId}` : null,
    () => smartTableService.getIssueBlueprint(workspaceSlug!, projectId!, issueId),
    { dedupingInterval: 30_000, revalidateOnFocus: true }
  );

  const T = zh
    ? { flow: "流程", thisCard: "本卡", guideFill: "填写", guideForm: (f: string) => `《${f}》`, guideThen: "完成本卡后", autoNext: (l: string) => `「${l}」自动创建`, enterApproval: (l: string) => `进入${l}`, assignee: "担当", lastStage: "完成本卡即收尾整条流程", openRoot: "打开流程总卡", callAdmin: "呼叫管理员", callAdminOk: "已通知管理员", callAdminFail: "通知失败" }
    : { flow: "フロー", thisCard: "このカード", guideFill: "入力", guideForm: (f: string) => `「${f}」`, guideThen: "このカード完了で", autoNext: (l: string) => `「${l}」が自動作成`, enterApproval: (l: string) => `${l}へ進む`, assignee: "担当", lastStage: "このカード完了でフロー全体が収束", openRoot: "フロー親カードを開く", callAdmin: "管理者を呼ぶ", callAdminOk: "管理者に通知しました", callAdminFail: "通知失敗" };

  // B-4b 客服逃生门(UX 批判会: 客服只有两个动作 — 填表, 或喊人):
  // @项目 ADMIN 们发一条评论 → Plane 原生通知管线(收件箱)送达。
  const { project: memberProject } = useMember();
  const { data: currentUser } = useUser();
  const [calling, setCalling] = useState(false);
  // B-3e 管理员干预(低频高权 — 仅 ADMIN 可见; 校验在 Temporal Update validator)
  const isAdmin = !!(currentUser?.id && projectId && memberProject.getProjectMemberDetails(currentUser.id, projectId)?.role === 20);
  const [ivOpen, setIvOpen] = useState(false); // 低频高权 → 默认收敛成一枚 icon(UX 批判会)
  const [ivVerb, setIvVerb] = useState<"set_parallelism" | "skip" | null>(null);
  const [ivN, setIvN] = useState(2);
  const [ivReason, setIvReason] = useState("");
  const [ivBusy, setIvBusy] = useState(false);
  const doIntervene = async (key: string) => {
    if (!workspaceSlug || !projectId || !ivVerb || ivBusy || !ivReason.trim()) return;
    setIvBusy(true);
    const r = await smartTableService.flowIntervene(workspaceSlug, projectId, issueId, {
      verb: ivVerb, key, n: ivVerb === "set_parallelism" ? ivN : undefined, reason: ivReason.trim(),
    });
    setIvBusy(false);
    if (r.ok) {
      setToast({ type: TOAST_TYPE.SUCCESS, title: zh ? "干预已生效" : "介入を適用しました", message: "" });
      setIvVerb(null);
      setIvReason("");
      void mutate();
    } else {
      setToast({ type: TOAST_TYPE.ERROR, title: zh ? "干预被拒绝" : "介入が拒否されました", message: r.error || r.msg || "" });
    }
  };
  const callAdmin = async () => {
    if (!workspaceSlug || !projectId || calling) return;
    setCalling(true);
    try {
      const ids: string[] = memberProject.getProjectMemberIds(projectId, false) ?? [];
      const admins = ids.filter((uid) => memberProject.getProjectMemberDetails(uid, projectId)?.role === 20);
      const mentions = admins
        .map((uid) => `<mention-component entity_identifier="${uid}" entity_name="user_mention"></mention-component>`)
        .join(" ");
      const r = await fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/comments/`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ comment_html: `<p>🆘 ${mentions} ${zh ? "这里需要帮助,请看一下这张卡。" : "ここで助けが必要です。このカードを見てください。"}</p>` }),
      });
      if (r.ok) setToast({ type: TOAST_TYPE.SUCCESS, title: T.callAdminOk, message: "" });
      else setToast({ type: TOAST_TYPE.ERROR, title: T.callAdminFail, message: `HTTP ${r.status}` });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: T.callAdminFail, message: "" });
    } finally {
      setCalling(false);
    }
  };

  if (!data) return null;

  // B-2p v2: 未挂流程は何も描画しない — 発起入口は快捷动作行の StartFlowButton(常駐)
  if (!data.bound) return null;

  if (!(data.progress?.length > 0)) return null;
  const d = data;

  const stageChip = (p: TBlueprintStage) => {
    const isThis = !d.is_root && p.key === d.current_key;
    const cls = cn(
      "rounded-sm px-1 py-px text-11",
      p.status === "done" && "text-success-primary",
      p.status === "current" && "bg-accent-subtle font-medium text-accent-primary",
      p.status === "pending" && "text-placeholder",
      p.status === "cancelled" && "text-danger-primary",
      isThis && "ring-1 ring-accent-strong"
    );
    const inner = (
      <>
        <span className="font-mono">{p.kind === "approval" && p.status !== "done" ? "◇" : STAGE_ICON[p.status]}</span> {p.label}
        {(p.cards ?? 0) > 1 && <span className="ml-0.5 text-10 opacity-80">{p.cards_done ?? 0}/{p.cards}</span>}
        {isThis && <span className="ml-0.5 text-10 opacity-80">({T.thisCard})</span>}
      </>
    );
    // 本卡不自链; 其他有卡的站 → SPA peek(B-2n v2: <a> 新窗跳转は非専門と拷打され全廃)
    if (p.issue && !isThis)
      return (
        <button
          type="button"
          onClick={() => openIssue(p.issue!.id, d.root_issue.project_id, p.issue!.sequence_id)}
          title={`#${p.issue.sequence_id}`}
          className={cn(cls, "hover:underline")}
        >
          {inner}
        </button>
      );
    return <span className={cls}>{inner}</span>;
  };

  const guide = d.guide;
  const guideNext = (guide?.next || [])
    .map((n) =>
      n.approval
        ? `${T.enterApproval(n.label)}${n.assignees.length ? `(${n.assignees.join("・")})` : ""}`
        : `${T.autoNext(n.label)}${n.assignees.length ? `(${T.assignee}: ${n.assignees.join("・")})` : ""}`
    )
    .join(" / ");

  return (
    <div className="mb-3 space-y-1.5 rounded-lg border border-subtle bg-surface-1 p-3">
      {/* 行1: 所属流程 — 站卡は父カードへのリンク, 根卡は自分の総覧 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-12">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-accent-subtle px-1.5 py-0.5 text-10 text-accent-primary">
          <LayoutTemplate className="size-3" /> {d.title} v{d.version}
        </span>
        {!d.is_root && (
          <button
            type="button"
            onClick={() => openIssue(d.root_issue.id, d.root_issue.project_id, d.root_issue.sequence_id)}
            title={T.openRoot}
            className="min-w-0 truncate text-left text-secondary hover:text-primary hover:underline"
          >
            {d.root_issue.name} <span className="text-placeholder">#{d.root_issue.sequence_id}</span>
          </button>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {/* B-4b 客服逃生门: 填表或喊人 — @项目管理员(原生收件箱通知) */}
          <button
            type="button"
            disabled={calling}
            onClick={() => void callAdmin()}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-11 text-tertiary hover:bg-layer-1-hover hover:text-danger-primary disabled:opacity-50"
          >
            <span className="inline-flex items-center gap-1"><LifeBuoy className="size-3.5" />{T.callAdmin}</span>
          </button>
        </span>
      </div>
      {/* 行2: 站点链(B-2c 同型) */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
        {d.progress.map((p, i) => (
          <span key={p.key} className="flex items-center gap-1">
            {i > 0 && <span className="text-10 text-placeholder">›</span>}
            {stageChip(p)}
          </span>
        ))}
      </div>
      {/* 行3: 行動指引(未完成の本站のみ; def 読時投影) */}
      {guide && (
        <div className="flex items-start gap-1 text-12 text-secondary">
          <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-tertiary" />
          {guide.form ? `${T.guideFill}${T.guideForm(guide.form)} → ` : ""}
          {guide.wait ? `${T.guideThen}${guideNext || T.lastStage}` : guideNext || T.lastStage}
        </div>
      )}
      {/* B-3e 管理员干预行(低频高权: 仅 ADMIN; 动词闭集 ×N/跳过; 理由必填; 拒绝原因同步人话) */}
      {isAdmin && (() => {
        const cur = d.progress.find((p) => p.status === "current" && p.kind === "card");
        if (!cur) return null;
        if (!ivOpen)
          return (
            <div className="border-t border-subtle pt-1">
              <button
                type="button"
                onClick={() => setIvOpen(true)}
                title={zh ? "流程干预(管理员)" : "フロー介入(管理者)"}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-11 text-placeholder hover:bg-layer-1-hover hover:text-secondary"
              >
                <Settings2 className="size-3.5" />{zh ? "干预…" : "介入…"}
              </button>
            </div>
          );
        return (
          <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-1.5 text-11">
            <span className="inline-flex items-center gap-1 text-placeholder"><Settings2 className="size-3.5" />{zh ? "干预" : "介入"}「{cur.label}」:</span>
            {ivVerb === null ? (
              <>
                <button type="button" onClick={() => { setIvVerb("set_parallelism"); setIvN(2); }} className="rounded-md border border-subtle px-2 py-0.5 text-tertiary hover:border-accent-strong hover:text-accent-primary">
                  {zh ? "并行 ×N(多人分头做)" : "並列 ×N(分担)"}
                </button>
                <button type="button" onClick={() => setIvVerb("skip")} className="rounded-md border border-subtle px-2 py-0.5 text-tertiary hover:border-danger-strong hover:text-danger-primary">
                  {zh ? "跳过本站" : "この站をスキップ"}
                </button>
                <button type="button" onClick={() => setIvOpen(false)} className="rounded-md px-1 text-11 text-tertiary hover:bg-layer-1-hover">×</button>
              </>
            ) : (
              <>
                {ivVerb === "set_parallelism" && (
                  <span className="flex items-center gap-1">
                    ×
                    <input
                      type="number" min={2} max={9} value={ivN}
                      onChange={(e) => setIvN(Math.max(2, Math.min(9, Number(e.target.value) || 2)))}
                      className="h-6 w-12 rounded-md border border-subtle bg-surface-1 px-1.5 text-11 text-primary outline-none focus:border-accent-strong"
                    />
                  </span>
                )}
                <input
                  autoFocus
                  value={ivReason}
                  onChange={(e) => setIvReason(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void doIntervene(cur.key); if (e.key === "Escape") setIvVerb(null); }}
                  placeholder={zh ? "理由(必填,留痕)" : "理由(必須・記録されます)"}
                  className="h-6 min-w-40 flex-1 rounded-md border border-subtle bg-surface-1 px-2 text-11 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
                />
                <button
                  type="button" disabled={ivBusy || !ivReason.trim()}
                  onClick={() => void doIntervene(cur.key)}
                  className={`h-6 rounded-md px-2.5 text-11 font-medium text-white disabled:opacity-50 ${ivVerb === "skip" ? "bg-[#dc2626] hover:bg-[#b91c1c]" : "bg-accent-primary hover:bg-accent-primary-hover"}`}
                >
                  {ivBusy ? "…" : ivVerb === "skip" ? (zh ? "确认跳过" : "スキップ確定") : (zh ? `确认 ×${ivN}` : `×${ivN} 確定`)}
                </button>
                <button type="button" onClick={() => setIvVerb(null)} className="rounded-md px-1 text-11 text-tertiary hover:bg-layer-1-hover">×</button>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
});
