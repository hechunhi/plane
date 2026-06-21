/**
 * BARSOUL 2026-06-15 (hechun): 创建任务弹窗的「业务流程」模式面板。
 * 选蓝图 + 标题(+客户)→ instantiate(根卡 + 子卡 DAG + 台账行 + 表单绑定一键就位),
 * 发起后打开根卡。复用既有 BlueprintInstantiateEndpoint, 不造新逻辑。display: 与「单发任务」并列。
 */
import { useCallback, useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { LayoutTemplate, Loader2 } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssue } from "@plane/types";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { smartTableService, type TBlueprint } from "@/services/smart-table.service";

type Props = { workspaceSlug: string; projectId: string; onClose: () => void };

export function BlueprintFlowPanel({ workspaceSlug, projectId, onClose }: Props) {
  const zh = useZh();
  const { handleRedirection } = useIssuePeekOverviewRedirection();
  const [list, setList] = useState<TBlueprint[] | null>(null);
  const [sel, setSel] = useState<TBlueprint | null>(null);
  const [title, setTitle] = useState("");
  const [customer, setCustomer] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    smartTableService.listBlueprints(workspaceSlug, projectId).then((bs) => {
      if (alive) setList(bs.filter((b) => b.enabled && b.latest_version));
      return;
    });
    return () => {
      alive = false;
    };
  }, [workspaceSlug, projectId]);

  // 切项目/重开 → 清选择(防止串项目蓝图)
  useEffect(() => {
    setSel(null);
    setTitle("");
    setCustomer("");
  }, [projectId]);

  const T = zh
    ? {
        head: "选择业务流程",
        none: "本项目还没有业务蓝图。去「数据表」页右上「蓝图」可创建。",
        pick: "选择流程…",
        titlePh: "标题(必填,如 客户名/项目名)",
        custPh: "客户/对象(可选)",
        go: "发起流程",
        back: "换流程",
        hint: "发起后将一键铺开:根卡 + 各阶段子卡 + 台账行 + 表单绑定",
      }
    : {
        head: "業務フローを選択",
        none: "このプロジェクトにブループリントがありません。「テーブル」ページ右上「BP」で作成。",
        pick: "フローを選択…",
        titlePh: "タイトル(必須:顧客名/案件名 等)",
        custPh: "顧客・対象(任意)",
        go: "フロー発起",
        back: "選び直す",
        hint: "発起で一括展開: 親カード + 各段階の子カード + 台帳行 + フォーム連携",
      };

  const fire = useCallback(async () => {
    if (!sel || !title.trim() || busy) return;
    setBusy(true);
    const res = await smartTableService.instantiateBlueprint(workspaceSlug, projectId, sel.id, {
      title: title.trim(),
      customer: customer.trim() || undefined,
    });
    setBusy(false);
    if (res) {
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: zh ? `已发起流程 (#${res.sequence_id})` : `フロー発起しました (#${res.sequence_id})`,
        message: zh ? "根卡+子卡+台账行已就位" : "親+子カード+行 完了",
      });
      onClose();
      handleRedirection(workspaceSlug, {
        id: res.issue_id,
        project_id: projectId,
        sequence_id: res.sequence_id,
      } as unknown as TIssue);
    } else {
      setToast({ type: TOAST_TYPE.ERROR, title: zh ? "发起失败" : "発起に失敗", message: "" });
    }
  }, [sel, title, customer, busy, workspaceSlug, projectId, zh, onClose, handleRedirection]);

  return (
    <div className="rounded-lg bg-surface-1 p-5 shadow-overlay-200">
      <div className="mb-3 flex items-center gap-2 text-14 font-medium text-primary">
        <LayoutTemplate className="size-4 text-accent-primary" /> {T.head}
      </div>
      {list === null ? (
        <div className="flex items-center gap-2 py-6 text-13 text-tertiary">
          <Loader2 className="size-4 animate-spin" /> …
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-md bg-layer-1 px-3 py-4 text-13 leading-relaxed text-tertiary">{T.none}</div>
      ) : !sel ? (
        <div className="space-y-1">
          {list.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSel(b)}
              className="flex w-full items-center gap-2 rounded-md border-[0.5px] border-subtle-1 bg-layer-1 px-3 py-2.5 text-left hover:border-accent-strong hover:bg-layer-1-hover"
            >
              <LayoutTemplate className="size-4 shrink-0 text-tertiary" />
              <span className="grow truncate text-13 font-medium text-primary">{b.title || b.name}</span>
              <span className="shrink-0 text-10 text-placeholder">v{b.latest_version}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5 text-13 font-medium text-primary">
            <LayoutTemplate className="size-3.5 text-accent-primary" /> {sel.title || sel.name}
            <span className="text-10 text-placeholder">v{sel.latest_version}</span>
            <button
              type="button"
              onClick={() => setSel(null)}
              className="ml-auto text-11 text-tertiary hover:text-secondary"
            >
              {T.back}
            </button>
          </div>
          <input
            value={title}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") void fire();
            }}
            placeholder={T.titlePh}
            className="w-full rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-3 py-2 text-13 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
          />
          <input
            value={customer}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setCustomer(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") void fire();
            }}
            placeholder={T.custPh}
            className="w-full rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-3 py-2 text-13 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
          />
          <div className="text-11 leading-relaxed text-placeholder">{T.hint}</div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-13 text-secondary hover:bg-layer-1-hover"
            >
              {zh ? "取消" : "キャンセル"}
            </button>
            <button
              type="button"
              disabled={!title.trim() || busy}
              onClick={() => void fire()}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent-primary px-3.5 py-1.5 text-13 font-medium text-white hover:bg-accent-primary-hover disabled:opacity-50"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />} {T.go}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
