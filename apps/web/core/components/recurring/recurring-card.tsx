/**
 * BARSOUL: 定期タスク 卡集成(IUTEYA-15) — 卡上「この作業を定期化」入口 + 卡顶「定期上下文条」。
 * 见 docs/architecture/recurring-tasks-mvp.md。
 * 入口与一览「新規」共用 RecurringRuleEditor(一组件一概念); 上下文条复用 flow-context 区位、Repeat 中性标(非琥珀非蓝)。
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { Repeat, ArrowRight, Clock, Calendar, X } from "lucide-react";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { recurringService, type TSnoozePreset } from "@/services/recurring.service";
import { RecurringRuleEditor } from "./recurring-editor";

type Props = { issueId: string; disabled?: boolean };

// 卡上「この作業を定期化」: 把当前卡快照成模板, 打开同一个编辑器(seed 预填)。
export const RecurrizeButton = observer(function RecurrizeButton({ issueId, disabled = false }: Props) {
  const zh = useZh();
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const { issue: { getIssueById } } = useIssueDetail();
  const issue = getIssueById(issueId);
  const pid = issue?.project_id;
  const [open, setOpen] = useState(false);
  if (!workspaceSlug || !pid || !issue) return null;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div onClick={() => !disabled && setOpen(true)}>
        <Button variant="secondary" disabled={disabled} size="lg">
          <Repeat className="size-4" />
          <span className="text-body-xs-medium">{zh ? "定期化" : "定期化"}</span>
        </Button>
      </div>
      {open && (
        <RecurringRuleEditor
          ws={workspaceSlug}
          pid={pid}
          seed={{ name: issue.name, assignee_id: issue.assignee_ids?.[0] ?? null }}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </div>
  );
});

// 卡上「あとで通知」(フォローアップ・スヌーズ): 快捷选时 → 卡从 active 视图隐藏到该日再浮现 + 到点 1 铃铛。
export const SnoozeButton = observer(function SnoozeButton({ issueId, disabled = false }: Props) {
  const zh = useZh();
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const { issue: { getIssueById } } = useIssueDetail();
  const issue = getIssueById(issueId);
  const pid = issue?.project_id;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!workspaceSlug || !pid || !issue) return null;

  const presets: { v: TSnoozePreset; label: string }[] = [
    { v: "tomorrow", label: zh ? "明天" : "明日" },
    { v: "biz2", label: zh ? "2 个工作日后" : "2営業日後" },
    { v: "next_mon", label: zh ? "下周一" : "来週月曜" },
    { v: "week1", label: zh ? "1 周后" : "1週間後" },
  ];
  const apply = async (body: { preset?: TSnoozePreset; until?: string }) => {
    setBusy(true);
    const r = await recurringService.setSnooze(workspaceSlug, pid, issueId, body).catch(() => null);
    setBusy(false);
    setOpen(false);
    if (!r?.snoozed) { setToast({ type: TOAST_TYPE.ERROR, title: zh ? "设置失败" : "設定に失敗しました", message: "" }); return; }
    const d = (r.until_date ?? "").slice(5).replace("-", "/");
    setToast({ type: TOAST_TYPE.SUCCESS, title: zh ? `${d} までスヌーズしました` : `${d} までスヌーズしました`, message: zh ? "それまでカードは一覧から隠れます" : "それまでカードは一覧から隠れます" });
    void globalMutate(`SNOOZE:${issueId}`);
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <div onClick={() => !disabled && setOpen((s) => !s)}>
        <Button variant="secondary" disabled={disabled} size="lg">
          <Clock className="size-4" />
          <span className="text-body-xs-medium">{zh ? "稍后提醒" : "あとで通知"}</span>
        </Button>
      </div>
      {open && (
        <div data-prevent-outside-click onMouseDown={(e) => e.stopPropagation()} className="absolute left-0 top-10 z-30 w-52 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1.5 shadow-overlay-200">
          <div className="px-2 pb-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{zh ? "何时再通知?" : "いつ再通知する?"}</div>
          {presets.map((p) => (
            <button key={p.v} type="button" disabled={busy} onClick={() => void apply({ preset: p.v })} className="block w-full rounded-sm px-2 py-1.5 text-left text-13 text-secondary hover:bg-layer-transparent-hover disabled:opacity-50">{p.label}</button>
          ))}
          <div className="my-1 border-t border-subtle" />
          <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover">
            <Calendar className="size-3.5 text-tertiary" /> {zh ? "指定日期…" : "日付を指定…"}
            <input type="date" onClick={(e) => e.stopPropagation()} onChange={(e) => e.target.value && void apply({ until: e.target.value })} className="ml-auto w-0 opacity-0" />
          </label>
        </div>
      )}
    </div>
  );
});

// 卡顶「スヌーズ中」指示条: snooze 的卡仍可经直链打开 → 这里显示到期日 + 解除。
export const SnoozeBar = observer(function SnoozeBar({ issueId, projectId }: { issueId: string; projectId: string }) {
  const zh = useZh();
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const { data, mutate } = useSWR(
    workspaceSlug && projectId && issueId ? `SNOOZE:${issueId}` : null,
    () => recurringService.getSnooze(workspaceSlug!, projectId, issueId),
    { dedupingInterval: 30_000 }
  );
  if (!data?.snoozed) return null;
  const d = (data.until_date ?? "").slice(5).replace("-", "/");
  const release = async () => {
    await recurringService.clearSnooze(workspaceSlug!, projectId, issueId).catch(() => {});
    void mutate();
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-subtle bg-surface-1 px-3 py-2 text-12">
      <Clock className="size-3.5 shrink-0 text-tertiary" />
      <span className="text-secondary">{zh ? "稍后提醒中" : "スヌーズ中"} · <span className="font-medium text-primary">{d} {zh ? "まで" : "まで"}</span>{zh ? "一覧から非表示" : "(一覧では非表示)"}</span>
      <button type="button" onClick={() => void release()} className="ml-auto flex shrink-0 items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-11 text-accent-primary hover:bg-accent-subtle">
        <X className="size-3" /> {zh ? "解除" : "解除"}
      </button>
    </div>
  );
});

// 卡顶「定期上下文条」: 该卡是某规则的当前实例 → 显示规则 + 次回 + 回链。复用 flow-context 容器样式。
export const RecurringContextBar = observer(function RecurringContextBar({ issueId, projectId }: { issueId: string; projectId: string }) {
  const zh = useZh();
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const { data } = useSWR(
    workspaceSlug && projectId && issueId ? `RECURRING_CTX:${issueId}` : null,
    () => recurringService.getIssueContext(workspaceSlug!, projectId, issueId),
    { dedupingInterval: 30_000 }
  );
  if (!data?.recurring || !data.rule) return null;
  const r = data.rule;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-subtle bg-surface-1 px-3 py-2 text-12">
      <Repeat className="size-3.5 shrink-0 text-tertiary" />
      <span className="text-secondary">
        {zh ? "定期タスク" : "定期タスク"}
        <span className="font-medium text-primary">「{r.name}」</span>
        <span className="text-tertiary"> · {r.cadence_label}</span>
      </span>
      {r.next_due && r.period_label && (
        <span className="text-tertiary">{zh ? "次回" : "次回"} {r.period_label}({r.next_due.slice(5).replace("-", "/")})</span>
      )}
      <a
        href={`/${workspaceSlug}/projects/${projectId}/recurring`}
        className="ml-auto flex shrink-0 items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-11 text-accent-primary hover:bg-accent-subtle"
      >
        {zh ? "ルールを開く" : "ルールを開く"} <ArrowRight className="size-3" />
      </a>
    </div>
  );
});
