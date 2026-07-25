/**
 * BARSOUL: 卡片「关联数据表」+ 卡内自动表单. 见 docs/architecture/smart-table-mvp.md.
 * Option A (2026-06-19): 候选行提升为独立 SmartRow — 统一走 SmartTableCandidatesGrid 多行网格.
 * 原双栏(主表单 + 候选表)合并为单一多行网格;binding.row 保留向后兼容但不再渲染.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Sheet, Check, FileText, LayoutTemplate } from "lucide-react";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import {
  smartTableService,
  type TSmartBinding,
  type TSmartForm,
  type TSmartRow,
  type TSmartTableSummary,
  type TIssueBlueprint,
} from "@/services/smart-table.service";
import { SmartTableCandidatesGrid } from "./smart-table-candidates-grid";

const trN = (x: { name: string; i18n?: Record<string, { name?: string }> }, lang: string) =>
  x.i18n?.[lang]?.name || x.name;

type Props = { workItemId: string; projectId: string; workspaceSlug: string; isEditable: boolean };

function PropRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7.5 w-30 shrink-0 items-center gap-1.5 text-body-xs-regular text-tertiary">{label}</div>
      <div className="flex min-h-7.5 grow flex-wrap items-center gap-1 text-body-xs-regular text-primary">
        {children}
      </div>
    </div>
  );
}

export function SmartTableCardForm({ workItemId, projectId, workspaceSlug, isEditable }: Props) {
  const zh = useZh();
  const [binding, setBinding] = useState<TSmartBinding | null>(null);
  const [bpInfo, setBpInfo] = useState<TIssueBlueprint | null>(null);
  const [tables, setTables] = useState<TSmartTableSummary[]>([]);
  const [formsByTable, setFormsByTable] = useState<Record<string, TSmartForm[]>>({});
  const [rows, setRows] = useState<TSmartRow[]>([]);
  const [picking, setPicking] = useState(false);
  const rowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // BS-328: 每行待落盘字段累积缓冲。共享单定时器会丢掉除最后一格外的所有编辑,
  // 改为按行累积 values, 防抖到点后逐行整体 upsert(配合后端 merge, 不丢任一字段)。
  const pendingRef = useRef<Map<string, Record<string, unknown>>>(new Map());

  const T = zh
    ? {
        table: "数据表",
        associate: "关联到数据表…",
        noTables: "本项目还没有数据表",
        committed: "已入表",
        change: "换表",
        unbind: "解除",
        hint: "卡片完成后自动入表",
        wholeTable: "整表(全部字段)",
        rowAdd: "+ 提交记录",
      }
    : {
        table: "テーブル",
        associate: "テーブルに連携…",
        noTables: "テーブルがありません",
        committed: "登録済",
        change: "変更",
        unbind: "解除",
        hint: "完了時に自動登録",
        wholeTable: "テーブル全体",
        rowAdd: "+ 提出を追加",
      };

  const load = useCallback(async () => {
    if (!workspaceSlug || !projectId || !workItemId) return;
    const b = await smartTableService.getBinding(workspaceSlug, projectId, workItemId);
    setBinding(b);
    setRows(b.bound ? (b.rows ?? []) : []);
    smartTableService
      .getIssueBlueprint(workspaceSlug, projectId, workItemId)
      .then(setBpInfo)
      .catch(() => {});
  }, [workspaceSlug, projectId, workItemId]);

  useEffect(() => {
    load();
  }, [load]);

  const openPicker = useCallback(async () => {
    const list = await smartTableService.listTables(workspaceSlug, projectId);
    setTables(list);
    const entries = await Promise.all(
      list.map(async (t) => [t.id, await smartTableService.listForms(workspaceSlug, projectId, t.id)] as const)
    );
    setFormsByTable(Object.fromEntries(entries));
    setPicking(true);
  }, [workspaceSlug, projectId]);

  const associateForm = useCallback(
    async (fid: string) => {
      const b = await smartTableService.bindForm(workspaceSlug, projectId, workItemId, fid).catch(() => null);
      setPicking(false);
      if (b) {
        setBinding(b);
        setRows(b.bound ? (b.rows ?? []) : []);
      }
    },
    [workspaceSlug, projectId, workItemId]
  );

  const associate = useCallback(
    async (tid: string) => {
      const b = await smartTableService.setBinding(workspaceSlug, projectId, workItemId, tid).catch(() => null);
      setPicking(false);
      if (b) {
        setBinding(b);
        setRows(b.bound ? (b.rows ?? []) : []);
      }
    },
    [workspaceSlug, projectId, workItemId]
  );

  const unbind = useCallback(async () => {
    await smartTableService.clearBinding(workspaceSlug, projectId, workItemId).catch(() => {});
    setBinding({ bound: false });
    setRows([]);
  }, [workspaceSlug, projectId, workItemId]);

  // Option A 行操作: upsert 乐观更新 + 防抖落盘; delete/add 立即刷新
  // BS-328: 防抖到点时把每行累积的字段一次性落盘(逐行 upsert),失败回灌待重试,不静默丢。
  const flushPending = useCallback(() => {
    if (rowTimer.current) {
      clearTimeout(rowTimer.current);
      rowTimer.current = null;
    }
    const batch = Array.from(pendingRef.current.entries());
    pendingRef.current = new Map();
    for (const [id, values] of batch) {
      smartTableService
        .candidatesAction(workspaceSlug, projectId, workItemId, {
          action: "upsert",
          candidate: { id, values },
        })
        .catch(() => {
          // 落盘失败: 把本次字段回灌缓冲(已有更新者优先),下次编辑/卸载时重试
          const cur = pendingRef.current.get(id) || {};
          pendingRef.current.set(id, { ...values, ...cur });
        });
    }
  }, [workspaceSlug, projectId, workItemId]);

  const rowUpsert = useCallback(
    (id: string, values: Record<string, unknown>) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, cells: { ...r.cells, ...values } } : r)));
      const prev = pendingRef.current.get(id) || {};
      pendingRef.current.set(id, { ...prev, ...values });
      if (rowTimer.current) clearTimeout(rowTimer.current);
      rowTimer.current = setTimeout(flushPending, 500);
    },
    [flushPending]
  );

  // 卸载(关卡片)前把未落盘的编辑冲掉,杜绝「填了又关→丢」
  useEffect(() => {
    return () => {
      if (rowTimer.current) clearTimeout(rowTimer.current);
      flushPending();
    };
  }, [flushPending]);

  const rowAdd = useCallback(async () => {
    const r = await smartTableService.candidatesAction(workspaceSlug, projectId, workItemId, {
      action: "upsert",
      candidate: { values: {} },
    });
    if (r) setRows(r.rows);
  }, [workspaceSlug, projectId, workItemId]);

  const rowDelete = useCallback(
    async (id: string) => {
      const r = await smartTableService.candidatesAction(workspaceSlug, projectId, workItemId, {
        action: "delete",
        id,
      });
      if (r) setRows(r.rows);
    },
    [workspaceSlug, projectId, workItemId]
  );

  if (binding === null) return null;

  const pickerList = picking && (
    <div className="absolute top-full left-0 z-20 mt-1 max-h-72 w-60 overflow-auto rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1 shadow-overlay-200">
      {tables.length === 0 ? (
        <div className="px-2 py-1.5 text-11 text-tertiary">{T.noTables}</div>
      ) : (
        tables.map((t) => (
          <div key={t.id} className="mb-1 last:mb-0">
            <div className="px-2 pt-1 pb-0.5 text-10 font-semibold tracking-wide text-placeholder uppercase">
              {trN(t, zh ? "zh" : "ja")}
            </div>
            <button
              type="button"
              onClick={() => associate(t.id)}
              className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-body-xs-regular text-secondary hover:bg-layer-transparent-hover"
            >
              {T.wholeTable}
            </button>
            {(formsByTable[t.id] ?? []).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => associateForm(f.id)}
                className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-body-xs-regular text-secondary hover:bg-layer-transparent-hover"
              >
                <FileText className="size-3 shrink-0 text-tertiary" />
                <span className="truncate">{trN(f, zh ? "zh" : "ja")}</span>
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );

  if (!binding.bound) {
    return (
      <div className="mt-2">
        <PropRow
          label={
            <>
              <Sheet className="size-4 shrink-0" />
              {T.table}
            </>
          }
        >
          <div className="relative">
            <button
              type="button"
              disabled={!isEditable}
              onClick={openPicker}
              className="text-body-xs-regular text-placeholder hover:text-secondary disabled:opacity-60"
            >
              {T.associate}
            </button>
            {pickerList}
          </div>
        </PropRow>
      </div>
    );
  }

  const canEdit = isEditable && !binding.committed;
  return (
    <div className="group/stform mt-2 space-y-2.5">
      <PropRow
        label={
          <>
            <Sheet className="size-4 shrink-0" />
            {T.table}
          </>
        }
      >
        <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-body-xs-medium text-primary">{trN(binding.table, zh ? "zh" : "ja")}</span>
          {bpInfo?.bound && (
            <span
              className="inline-flex items-center gap-0.5 rounded-sm bg-accent-subtle px-1.5 py-0.5 text-10 text-accent-primary"
              title={zh ? "来自业务蓝图" : "ブループリント由来"}
            >
              <LayoutTemplate className="size-3" /> {bpInfo.title} v{bpInfo.version}
            </span>
          )}
          {binding.form && <span className="text-11 text-tertiary">· {trN(binding.form, zh ? "zh" : "ja")}</span>}
          {binding.committed && (
            <span className="inline-flex items-center gap-0.5 text-11 text-success-primary">
              <Check className="size-3" />
              {T.committed}
            </span>
          )}
          {isEditable && (
            <span className="flex items-center gap-2 opacity-0 transition-opacity group-hover/stform:opacity-100">
              <button type="button" onClick={openPicker} className="text-11 text-tertiary hover:text-secondary">
                {T.change}
              </button>
              <button type="button" onClick={unbind} className="text-11 text-tertiary hover:text-danger-primary">
                {T.unbind}
              </button>
            </span>
          )}
          {pickerList}
        </div>
      </PropRow>
      <div className="max-w-3xl">
        <SmartTableCandidatesGrid
          columns={binding.columns}
          rows={rows}
          editable={canEdit}
          onUpsert={rowUpsert}
          onDelete={(id) => void rowDelete(id)}
        />
        {canEdit && (
          <button
            type="button"
            onClick={() => void rowAdd()}
            className="mt-1 rounded-md px-1.5 py-0.5 text-11 text-tertiary hover:bg-layer-1-hover hover:text-accent-primary"
          >
            {T.rowAdd}
          </button>
        )}
        {!binding.committed && <div className="mt-1.5 text-11 text-placeholder">{T.hint}</div>}
      </div>
    </div>
  );
}
