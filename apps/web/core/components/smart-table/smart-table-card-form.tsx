/**
 * BARSOUL: 卡片「关联数据表」+ 卡内自动表单. 见 docs/architecture/smart-table-mvp.md.
 * v2 原生化: 渲染成 Plane 侧栏属性行(横向 label+值), 全用语义 token(自适应暗色),
 * 无边框盒 / 无 emoji / 无硬编码 hex(数据色 option.color 除外). 参照 SidebarPropertyListItem.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Sheet, Check, FileText, AlertTriangle, LayoutTemplate } from "lucide-react";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import {
  smartTableService,
  type TCandidate,
  type TSmartBinding,
  type TSmartForm,
  type TSmartRow,
  type TSmartTableSummary,
  type TIssueBlueprint,
} from "@/services/smart-table.service";
import { SmartTableCandidatesGrid } from "./smart-table-candidates-grid";
import { SmartTableRecordGrid } from "./smart-table-record-grid";

const cellEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const trN = (x: { name: string; i18n?: Record<string, { name?: string }> }, lang: string) => x.i18n?.[lang]?.name || x.name;

type Props = { workItemId: string; projectId: string; workspaceSlug: string; isEditable: boolean };

// Plane 侧栏属性行范式: 左 label(w-30 三级文字) + 右 值区(grow)
function PropRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7.5 w-30 shrink-0 items-center gap-1.5 text-body-xs-regular text-tertiary">{label}</div>
      <div className="flex min-h-7.5 grow flex-wrap items-center gap-1 text-body-xs-regular text-primary">{children}</div>
    </div>
  );
}

export function SmartTableCardForm({ workItemId, projectId, workspaceSlug, isEditable }: Props) {
  const zh = useZh();
  const [binding, setBinding] = useState<TSmartBinding | null>(null);
  const [bpInfo, setBpInfo] = useState<TIssueBlueprint | null>(null);
  const [tables, setTables] = useState<TSmartTableSummary[]>([]);
  const [formsByTable, setFormsByTable] = useState<Record<string, TSmartForm[]>>({});
  const [cells, setCells] = useState<Record<string, unknown>>({});
  // B-4a 候选行(专家批判会:「比价是数据问题不是卡片问题」)
  const [candidates, setCandidates] = useState<TCandidate[]>([]);
  const [picking, setPicking] = useState(false);
  const [rowPicking, setRowPicking] = useState(false);
  const [tableRows, setTableRows] = useState<TSmartRow[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const T = zh
    ? { table: "数据表", associate: "关联到数据表…", noTables: "本项目还没有数据表", committed: "已入表", change: "换表", unbind: "解除", hint: "卡片完成后自动入表", wholeTable: "整表(全部字段)", bindRow: "绑到已有行", bindRowHint: "把本卡接到已存在的一行(如同一订单的某阶段)", row: "行", noRows: "表里还没有行", candTitle: "候选", candAdd: "+ 候选记录", candAdopt: "采用", candAdopted: "✓ 已采用", candDel: "删", candHint: "各记一行,「采用」写入表单;全部留底。" }
    : { table: "テーブル", associate: "テーブルに連携…", noTables: "テーブルがありません", committed: "登録済", change: "変更", unbind: "解除", hint: "完了時に自動登録", wholeTable: "テーブル全体", bindRow: "既存行へ連携", bindRowHint: "このカードを既存の行に接続(同一注文の各段階など)", row: "行", noRows: "行がありません", candTitle: "候補", candAdd: "+ 候補を追加", candAdopt: "採用", candAdopted: "✓ 採用済", candDel: "削", candHint: "1件1行で記録、「採用」でフォームへ反映。全件残ります。" };

  const load = useCallback(async () => {
    if (!workspaceSlug || !projectId || !workItemId) return;
    const b = await smartTableService.getBinding(workspaceSlug, projectId, workItemId);
    setBinding(b);
    if (b.bound) {
      setCells({ ...(b.row?.cells ?? {}) });
      setCandidates(b.candidates ?? []);
    }
    smartTableService.getIssueBlueprint(workspaceSlug, projectId, workItemId).then(setBpInfo).catch(() => {});
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
        if (b.bound) setCells({ ...(b.row?.cells ?? {}) });
      }
    },
    [workspaceSlug, projectId, workItemId]
  );

  const openRowPicker = useCallback(async () => {
    if (!binding || !binding.bound) return;
    const t = await smartTableService.getTable(workspaceSlug, projectId, binding.table.id).catch(() => null);
    setTableRows(t?.rows ?? []);
    setRowPicking(true);
  }, [binding, workspaceSlug, projectId]);

  const bindExistingRow = useCallback(
    async (rid: string) => {
      if (!binding || !binding.bound) return;
      const b = binding.form
        ? await smartTableService.bindForm(workspaceSlug, projectId, workItemId, binding.form.id, rid).catch(() => null)
        : await smartTableService.setBinding(workspaceSlug, projectId, workItemId, binding.table.id, rid).catch(() => null);
      setRowPicking(false);
      if (b) {
        setBinding(b);
        if (b.bound) setCells({ ...(b.row?.cells ?? {}) });
      }
    },
    [binding, workspaceSlug, projectId, workItemId]
  );

  const associate = useCallback(
    async (tid: string) => {
      const b = await smartTableService.setBinding(workspaceSlug, projectId, workItemId, tid).catch(() => null);
      setPicking(false);
      if (b) {
        setBinding(b);
        if (b.bound) setCells({ ...(b.row?.cells ?? {}) });
      }
    },
    [workspaceSlug, projectId, workItemId]
  );

  const unbind = useCallback(async () => {
    await smartTableService.clearBinding(workspaceSlug, projectId, workItemId).catch(() => {});
    setBinding({ bound: false });
    setCells({});
  }, [workspaceSlug, projectId, workItemId]);

  const setCell = useCallback(
    (key: string, v: unknown) => {
      setCells((prev) => ({ ...prev, [key]: v }));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        smartTableService.saveBindingRow(workspaceSlug, projectId, workItemId, { [key]: v }).catch(() => {});
      }, 500);
    },
    [workspaceSlug, projectId, workItemId]
  );

  // B-4a 候选行操作(upsert 防抖 / delete / adopt→主表单原地刷新)
  const candTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candUpsert = useCallback(
    (id: string, values: Record<string, unknown>) => {
      setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, values: { ...c.values, ...values } } : c)));
      if (candTimer.current) clearTimeout(candTimer.current);
      candTimer.current = setTimeout(() => {
        smartTableService.candidatesAction(workspaceSlug, projectId, workItemId, {
          action: "upsert", candidate: { id, values },
        }).catch(() => {});
      }, 500);
    },
    [workspaceSlug, projectId, workItemId]
  );
  const candAdd = useCallback(async () => {
    const r = await smartTableService.candidatesAction(workspaceSlug, projectId, workItemId, {
      action: "upsert", candidate: { values: {} },
    });
    if (r) setCandidates(r.candidates);
  }, [workspaceSlug, projectId, workItemId]);
  const candDelete = useCallback(async (id: string) => {
    const r = await smartTableService.candidatesAction(workspaceSlug, projectId, workItemId, { action: "delete", id });
    if (r) setCandidates(r.candidates);
  }, [workspaceSlug, projectId, workItemId]);
  const candAdopt = useCallback(async (id: string) => {
    const r = await smartTableService.candidatesAction(workspaceSlug, projectId, workItemId, { action: "adopt", id });
    if (r) {
      setCandidates(r.candidates);
      setCells({ ...r.cells }); // 选定值进主表单, 原地可见
    }
  }, [workspaceSlug, projectId, workItemId]);

  const imageUpload = useCallback((f: File) => smartTableService.uploadCellImage(workspaceSlug, projectId, f), [workspaceSlug, projectId]);

  if (binding === null) return null;

  const pickerList = picking && (
    <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-60 overflow-auto rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1 shadow-overlay-200">
      {tables.length === 0 ? (
        <div className="px-2 py-1.5 text-11 text-tertiary">{T.noTables}</div>
      ) : (
        tables.map((t) => (
          <div key={t.id} className="mb-1 last:mb-0">
            <div className="px-2 pb-0.5 pt-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{trN(t, zh ? "zh" : "ja")}</div>
            <button type="button" onClick={() => associate(t.id)} className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-body-xs-regular text-secondary hover:bg-layer-transparent-hover">
              {T.wholeTable}
            </button>
            {(formsByTable[t.id] ?? []).map((f) => (
              <button key={f.id} type="button" onClick={() => associateForm(f.id)} className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-body-xs-regular text-secondary hover:bg-layer-transparent-hover">
                <FileText className="size-3 shrink-0 text-tertiary" />
                <span className="truncate">{trN(f, zh ? "zh" : "ja")}</span>
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );

  const rowPickerList = rowPicking && binding && binding.bound && (
    <div className="absolute left-0 top-full z-20 mt-1 max-h-60 w-60 overflow-auto rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1 shadow-overlay-200">
      <div className="px-2 pb-0.5 pt-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{T.bindRowHint}</div>
      {tableRows.length === 0 ? (
        <div className="px-2 py-1.5 text-11 text-tertiary">{T.noRows}</div>
      ) : (
        tableRows.map((r, i) => {
          const k = binding.columns[0]?.key;
          const raw = k ? r.cells?.[k] : undefined;
          const lbl = raw != null && raw !== "" ? String(raw) : `${T.row} ${i + 1}`;
          return (
            <button key={r.id} type="button" onClick={() => bindExistingRow(r.id)} className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-body-xs-regular text-secondary hover:bg-layer-transparent-hover">{lbl}</button>
          );
        })
      )}
    </div>
  );

  // 未关联: 一行属性, placeholder 风格入口
  if (!binding.bound) {
    return (
      <div className="mt-2">
        <PropRow label={<><Sheet className="size-4 shrink-0" />{T.table}</>}>
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

  // 已关联: 表名行 + 各字段属性行
  const missingReq = binding.columns.filter((c) => c.required && cellEmpty(cells[c.key]));
  return (
    <div className="group/stform mt-2 space-y-2.5">
      <PropRow label={<><Sheet className="size-4 shrink-0" />{T.table}</>}>
        <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-body-xs-medium text-primary">{trN(binding.table, zh ? "zh" : "ja")}</span>
          {bpInfo?.bound && (
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-accent-subtle px-1.5 py-0.5 text-10 text-accent-primary" title={zh ? "来自业务蓝图" : "ブループリント由来"}>
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
            // 走查 B-2g: 管理动作平时隐身, hover 表名行才显现(动词不与名词抢视线)
            <span className="flex items-center gap-2 opacity-0 transition-opacity group-hover/stform:opacity-100">
              <button type="button" onClick={openPicker} className="text-11 text-tertiary hover:text-secondary">{T.change}</button>
              <button type="button" onClick={openRowPicker} className="text-11 text-tertiary hover:text-secondary">{T.bindRow}</button>
              <button type="button" onClick={unbind} className="text-11 text-tertiary hover:text-danger-primary">{T.unbind}</button>
            </span>
          )}
          {pickerList}
          {rowPickerList}
        </div>
      </PropRow>
      {/* 走查 B-2g: 编辑舒适宽度上限(超宽屏输入框不再拉满) + 提示合并为网格下一行 */}
      <div className="max-w-3xl">
        <SmartTableRecordGrid columns={binding.columns} cells={cells} editable={isEditable} onEdit={setCell} imageUpload={imageUpload} />
        {/* B-4a 候选记录: 比价等多候选 — 「采用」写主表单, 全集留底。
            glide=唯一编辑器铁律(§11): 网格复用 cellForColumn 全类型, 绝不自绘表格。
            仅表单绑定显示(候选=站点表单的数据契约; 整表=总账视图非录入场景, 且全列会爆炸)。 */}
        {!binding.committed && isEditable && binding.form && (
          <div className="mt-2">
            {candidates.length > 0 && (
              <div className="mb-1 flex items-center gap-2">
                {/* 说明文不常驻(降噪) — hover 标题可见 */}
                <span className="text-10 font-semibold uppercase tracking-wide text-placeholder" title={T.candHint}>
                  {T.candTitle}({candidates.length})
                </span>
              </div>
            )}
            <SmartTableCandidatesGrid
              columns={binding.columns}
              candidates={candidates}
              onUpsert={candUpsert}
              onAdopt={(id) => void candAdopt(id)}
              onDelete={(id) => void candDelete(id)}
            />
            <button type="button" onClick={() => void candAdd()} className="mt-1 rounded-md px-1.5 py-0.5 text-11 text-tertiary hover:bg-layer-1-hover hover:text-accent-primary">
              {T.candAdd}
            </button>
          </div>
        )}
        {!binding.committed && (
          <div className="mt-1.5 flex items-center gap-1.5 text-11 text-placeholder">
            {missingReq.length > 0 && (
              <span className="inline-flex items-center gap-1 text-secondary">
                <AlertTriangle className="size-3.5 shrink-0" style={{ color: "#d9920a" }} />
                {zh ? `还差 ${missingReq.length} 项必填` : `必須あと ${missingReq.length} 項目`}
              </span>
            )}
            {missingReq.length > 0 && <span>·</span>}
            <span>{T.hint}</span>
          </div>
        )}
      </div>
    </div>
  );
}
