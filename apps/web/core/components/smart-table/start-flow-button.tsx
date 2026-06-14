/**
 * BARSOUL B-2p v2(用户点名: 「各种任务相关的动作按钮做在这里面比较好」=
 * IssueDetailWidgetActionButtons 行): 「发起流程」widget 风格按钮 + 下拉面板。
 * 选蓝图 → 标题(预填卡名) → 创建 — 流程根卡挂为本卡子卡, 流程链经 SWR
 * mutate 原地出现/切到最新一批(分批采购)。
 * B-5b(2026-06-11 拍板「審査と Blueprint 全統一」): 審査=フローの閘門站,
 * 単発審査=最短のフロー(一站) — 下拉が「仅审批」項を吸収し入口は本按钮
 * ただ一つ(蓝图列表は顶层卡のみ, 仅审批は全卡常設)。AichanApprovalButton
 * は controlled 変体で modal だけ間借り(下拉 unmount に巻き込まれない)。
 * 弹层铁律: data-prevent-outside-click + onMouseDown stop(peek 连坐坑)。
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { Sparkle, Zap } from "lucide-react";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { AichanApprovalButton } from "@/components/comments/aichan-approval-button";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { smartTableService, type TBlueprint } from "@/services/smart-table.service";

type Props = { issueId: string; disabled?: boolean };

export const StartFlowButton = observer(function StartFlowButton({ issueId, disabled = false }: Props) {
  const zh = useZh();
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const issue = getIssueById(issueId);
  const projectId = issue?.project_id;
  const isTopLevel = !!issue && !issue.parent_id;

  const { data: bps } = useSWR<TBlueprint[]>(
    isTopLevel && workspaceSlug && projectId ? `BP_LIST:${projectId}` : null,
    () => smartTableService.listBlueprints(workspaceSlug!, projectId!),
    { dedupingInterval: 60_000 }
  );
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<TBlueprint | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false); // B-5b: 仅审批 modal(受控)

  const published = (bps || []).filter((b) => b.latest_version);
  if (!workspaceSlug || !projectId) return null;

  const T = zh
    ? { btn: "发起流程", pick: "选择业务蓝图", approvalOnly: "仅审批", approvalHint: "不挂流程链", titlePh: "流程标题(如货品名)", create: "创建", creating: "创建中…", ok: "流程已创建", fail: "创建失败" }
    : { btn: "フロー発起", pick: "ブループリント選択", approvalOnly: "承認のみ", approvalHint: "フロー外", titlePh: "フロー名(品名など)", create: "作成", creating: "作成中…", ok: "フローを作成しました", fail: "作成失敗" };

  const start = async (bp: TBlueprint) => {
    const t = title.trim();
    if (!t || busy || !workspaceSlug || !projectId) return;
    setBusy(true);
    const r = await smartTableService.instantiateBlueprint(workspaceSlug, projectId, bp.id, {
      title: t,
      parent_issue: issueId,
    });
    setBusy(false);
    if (r) {
      setToast({ type: TOAST_TYPE.SUCCESS, title: `${T.ok} #${r.sequence_id}`, message: "" });
      setOpen(false);
      setPicking(null);
      void globalMutate(`ISSUE_FLOW_CTX:${issueId}`); // 流程链原地出现/切到最新一批
      void globalMutate(`SUBTREE_ROWS:${issueId}`);
    } else {
      setToast({ type: TOAST_TYPE.ERROR, title: T.fail, message: "" });
    }
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <div onClick={() => { setOpen((s) => !s); setPicking(null); }}>
        <Button variant="secondary" disabled={disabled} size="lg">
          <Zap className="size-4" />
          <span className="text-body-xs-medium">{T.btn}</span>
        </Button>
      </div>
      {open && (
        // peek 鉄律: portal 級弹层は data-prevent-outside-click + mousedown stop
        <div
          data-prevent-outside-click
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute left-0 top-10 z-30 w-72 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-2 shadow-overlay-200"
        >
          {picking === null ? (
            <>
              {isTopLevel && published.length > 0 && (
                <>
                  <div className="px-1 pb-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{T.pick}</div>
                  {published.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setPicking(b);
                        setTitle(issue?.name ?? "");
                      }}
                      className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-13 text-secondary hover:bg-layer-transparent-hover"
                    >
                      {b.title} <span className="text-11 text-placeholder">v{b.latest_version}</span>
                    </button>
                  ))}
                  <div className="mx-1 my-1 border-t border-subtle" />
                </>
              )}
              {/* B-5b: 審査=最短のフロー(一站) — 単発審査もこの入口に統一 */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setApprovalOpen(true);
                }}
                className="flex w-full items-center gap-2 truncate rounded-sm px-2 py-1.5 text-left text-13 text-secondary hover:bg-layer-transparent-hover"
              >
                <Sparkle className="size-3.5 shrink-0 text-accent-primary" />
                {T.approvalOnly}
                <span className="ml-auto shrink-0 text-11 text-placeholder">{T.approvalHint}</span>
              </button>
            </>
          ) : (
            <div className="space-y-2 p-1">
              <div className="text-12 font-medium text-primary">{picking.title}</div>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void start(picking);
                  if (e.key === "Escape") setPicking(null);
                }}
                placeholder={T.titlePh}
                className="h-7 w-full rounded-md border border-subtle bg-surface-1 px-2.5 text-12 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button type="button" onClick={() => setPicking(null)} className="rounded-md px-2 py-1 text-12 text-secondary hover:bg-layer-1-hover">
                  ←
                </button>
                <button
                  type="button"
                  disabled={busy || !title.trim()}
                  onClick={() => void start(picking)}
                  className="rounded-md bg-accent-primary px-3 py-1 text-12 font-medium text-white hover:bg-accent-primary-hover disabled:opacity-50"
                >
                  {busy ? T.creating : T.create}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* B-5b: 仅审批 modal — trigger は上の下拉項, 本体は外置(unmount 安全) */}
      <AichanApprovalButton
        variant="controlled"
        open={approvalOpen}
        onClose={() => setApprovalOpen(false)}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
      />
    </div>
  );
});
