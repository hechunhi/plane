/**
 * BARSOUL: 智能表「表单」视图 (F-1 表单对象化). 见 docs/architecture/smart-table-mvp.md §10.
 * 一表多表单 = 列子集 + 有序 + 别名(label 覆盖名, 支持视角改名) + 表单级必填.
 * 左:表单列表; 右:录入(fill→建行) / 编辑(edit→配字段) 双模式. 全 Plane 语义 token.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Plus, Trash2, X, ChevronUp, ChevronDown, FileInput, Settings2, FileText } from "lucide-react";
import { cn } from "@plane/utils";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import {
  smartTableService,
  type TSmartColumn,
  type TSmartForm,
  type TSmartTable,
} from "@/services/smart-table.service";
import { TYPE_META } from "./smart-table-cells";
import { SmartTableRecordGrid } from "./smart-table-record-grid";

const isEmptyVal = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

type Props = { ws: string; pid: string; table: TSmartTable };

export function SmartTableForms({ ws, pid, table }: Props) {
  const zh = useZh();
  const manualCols = useMemo(() => table.columns.filter((c) => c.source === "manual"), [table.columns]);
  const colByKey = useMemo(() => {
    const m: Record<string, TSmartColumn> = {};
    table.columns.forEach((c) => (m[c.key] = c));
    return m;
  }, [table.columns]);

  const [forms, setForms] = useState<TSmartForm[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<"fill" | "edit">("fill");
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const T = zh
    ? { neww: "新建表单", empty: "还没有表单。表单 = 这张表的一个录入视图(选字段子集、排序、改名、设必填)。不同任务可绑不同表单。", fill: "录入", edit: "编辑", noFields: "这个表单还没有字段,去「编辑」添加。", add: "添加字段", alias: "显示名(可改)", required: "必填", submit: "提交入表", clear: "清空", del: "删除表单", colsDone: "全部字段已加入", namePh: "表单名", newName: "新表单" }
    : { neww: "新規フォーム", empty: "フォームがありません。フォーム = このテーブルの入力ビュー(列の選択・並び・改名・必須)。", fill: "入力", edit: "編集", noFields: "フィールド未設定。「編集」で追加。", add: "フィールド追加", alias: "表示名", required: "必須", submit: "テーブルに追加", clear: "クリア", del: "フォーム削除", colsDone: "全フィールド追加済", namePh: "フォーム名", newName: "新規フォーム" };

  const errToast = (msg: string) => setToast({ type: TOAST_TYPE.ERROR, title: msg, message: "" });
  const imageUpload = useCallback((f: File) => smartTableService.uploadCellImage(ws, pid, f), [ws, pid]);

  const reload = useCallback(async () => {
    const list = await smartTableService.listForms(ws, pid, table.id);
    setForms(list);
    setActiveId((cur) => (cur && list.some((f) => f.id === cur) ? cur : list[0]?.id ?? null));
    setLoading(false);
  }, [ws, pid, table.id]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setVals({}); }, [activeId]);

  const active = forms.find((f) => f.id === activeId) ?? null;
  // 表单字段 → 列(应用 别名译文 > 别名 > 列名;i18n 由 record-grid 二次解析列级译名)
  const lang = zh ? "zh" : "ja";
  const fillCols: TSmartColumn[] = (active?.fields ?? [])
    .map((f): TSmartColumn | null => {
      const c = colByKey[f.col];
      if (!c) return null;
      const aliasTr = active?.i18n?.[lang]?.labels?.[f.col];
      const name = aliasTr || f.label || c.i18n?.[lang]?.name || c.name;
      // i18n 置空: 名称已解析进 name, 避免 record-grid 再按列级 i18n 二次覆盖
      return { ...c, name, i18n: undefined, required: f.required ?? c.required };
    })
    .filter((c): c is TSmartColumn => !!c);

  // 整表单乐观更新 + 500ms 防抖落库(整体 last-wins, 不丢字段)
  const persist = useCallback((next: TSmartForm) => {
    setForms((p) => p.map((f) => (f.id === next.id ? next : f)));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      smartTableService.updateForm(ws, pid, table.id, next.id, { name: next.name, fields: next.fields }).catch(() => errToast(zh ? "保存失败" : "保存失敗"));
    }, 500);
  }, [ws, pid, table.id, zh]);

  const newForm = async () => {
    const f = await smartTableService.createForm(ws, pid, table.id, { name: T.newName, fields: manualCols.map((c) => ({ col: c.key })) }).catch(() => null);
    if (f) { setForms((p) => [...p, f]); setActiveId(f.id); setMode("edit"); }
    else errToast(zh ? "新建表单失败" : "作成失敗");
  };

  const removeForm = async () => {
    if (!active) return;
    const id = active.id;
    setForms((p) => p.filter((f) => f.id !== id));
    await smartTableService.deleteForm(ws, pid, table.id, id).catch(() => {});
  };

  const submit = async () => {
    if (!active) return;
    const fields = active.fields.filter((f) => colByKey[f.col]);
    const missing = fields.filter((f) => f.required && isEmptyVal(vals[f.col]));
    if (missing.length) { errToast((zh ? "缺少必填:" : "必須未入力:") + missing.map((f) => f.label || colByKey[f.col]?.name).join("、")); return; }
    const cells: Record<string, unknown> = {};
    fields.forEach((f) => { if (vals[f.col] !== undefined) cells[f.col] = vals[f.col]; });
    try {
      await smartTableService.addRow(ws, pid, table.id, cells);
      setVals({});
      setToast({ type: TOAST_TYPE.SUCCESS, title: zh ? "已添加到表" : "追加しました", message: "" });
    } catch {
      errToast(zh ? "添加失败" : "追加失敗");
    }
  };

  if (loading) return <div className="p-page-x py-6 text-13 text-tertiary">{zh ? "加载中…" : "読み込み中…"}</div>;

  const usedKeys = new Set((active?.fields ?? []).map((f) => f.col));
  const avail = manualCols.filter((c) => !usedKeys.has(c.key));

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-48 shrink-0 flex-col border-r border-subtle bg-layer-1">
        <div className="vertical-scrollbar flex-1 overflow-auto p-2">
          {forms.map((f) => (
            <button key={f.id} type="button" onClick={() => setActiveId(f.id)} className={cn("mb-0.5 flex w-full items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-left", f.id === activeId ? "bg-layer-2 font-medium text-primary" : "text-secondary hover:bg-layer-1-hover")}>
              <FileText className="size-3.5 shrink-0 text-tertiary" />
              <span className="grow truncate text-13">{f.i18n?.[lang]?.name || f.name}</span>
              <span className="shrink-0 text-10 text-placeholder">{f.fields.length}{zh ? "字段" : "項目"}</span>
              {(f.binding_count ?? 0) > 0 && (
                <span className="shrink-0 rounded-sm bg-layer-2 px-1 text-10 text-tertiary" title={zh ? `${f.binding_count} 张卡片使用此表单` : `${f.binding_count} 枚のカードが使用中`}>
                  {f.binding_count}{zh ? "卡" : "枚"}
                </span>
              )}
            </button>
          ))}
        </div>
        <button type="button" onClick={newForm} className="flex items-center gap-1.5 border-t border-subtle px-3 py-2.5 text-13 font-medium text-accent-primary hover:bg-layer-1-hover">
          <Plus className="size-4" /> {T.neww}
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col" onClick={() => addOpen && setAddOpen(false)}>
        {!active ? (
          <div className="m-auto max-w-sm px-6 text-center text-13 text-tertiary">{T.empty}</div>
        ) : (
          <>
            <div className="flex h-11 items-center gap-3 border-b border-subtle bg-layer-1 px-page-x">
              <input value={active.name} onChange={(e: ChangeEvent<HTMLInputElement>) => persist({ ...active, name: e.target.value })} placeholder={T.namePh} className="w-48 rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1 text-13 font-medium text-primary outline-none" />
              <div className="flex items-center gap-0.5 rounded-md bg-layer-2 p-0.5">
                <button type="button" onClick={() => setMode("fill")} className={cn("flex items-center gap-1 rounded-sm px-2.5 py-1 text-12 font-medium", mode === "fill" ? "bg-surface-1 text-primary shadow-raised-100" : "text-secondary hover:text-primary")}><FileInput className="size-3.5" /> {T.fill}</button>
                <button type="button" onClick={() => setMode("edit")} className={cn("flex items-center gap-1 rounded-sm px-2.5 py-1 text-12 font-medium", mode === "edit" ? "bg-surface-1 text-primary shadow-raised-100" : "text-secondary hover:text-primary")}><Settings2 className="size-3.5" /> {T.edit}</button>
              </div>
              <button type="button" onClick={removeForm} className="ml-auto flex size-7 items-center justify-center rounded-sm text-tertiary hover:bg-danger-subtle hover:text-danger-primary" title={T.del}><Trash2 className="size-4" /></button>
            </div>

            {/* 表单↔卡片: 哪些卡正在用这个表单(点击跳卡); 空态写明关联路径 */}
            {(active.binding_count ?? 0) > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-subtle bg-layer-1 px-page-x py-1.5">
                <span className="shrink-0 text-11 text-tertiary">{zh ? `使用此表单的卡片 (${active.binding_count})` : `このフォームを使うカード (${active.binding_count})`}</span>
                {/* 走查修复: 限显 4 枚防整行刷屏, 余数计数 */}
                {(active.bound_cards ?? []).slice(0, 4).map((c) => (
                  <a key={c.issue} href={`/${ws}/projects/${c.project}/issues/${c.issue}`} target="_blank" rel="noreferrer" className="inline-flex max-w-56 items-center rounded-sm bg-layer-2 px-1.5 py-0.5 text-11 text-secondary hover:text-primary" title={c.name}>
                    <span className="truncate">#{c.seq} {c.name}</span>
                  </a>
                ))}
                {(active.binding_count ?? 0) > 4 && (
                  <span className="text-11 text-placeholder">+{(active.binding_count ?? 0) - 4}</span>
                )}
              </div>
            ) : (
              <div className="border-b border-subtle bg-layer-1 px-page-x py-1.5 text-11 text-placeholder">
                {zh
                  ? "尚无卡片使用此表单 — 在卡片侧栏「关联到数据表…」里选它,或由蓝图/自动规则在建卡时绑定"
                  : "このフォームを使うカードはまだありません — カードのサイドバー「テーブルに連携…」で選択、またはブループリント/自動ルールで連携"}
              </div>
            )}

            <div className="vertical-scrollbar min-h-0 flex-1 overflow-auto p-page-x">
              {/* 走查修复: 居中(mx-auto)在超宽屏实测漂移贴右且不如左对齐自然 — 现代后台表单区=左对齐窄列, 与表单名头对齐 */}
              <div className="max-w-xl py-4">
                {mode === "edit" ? (
                  <div className="space-y-2">
                    {active.fields.length === 0 && <div className="mb-2 text-13 text-tertiary">{T.noFields}</div>}
                    {active.fields.map((fld, i) => {
                      const c = colByKey[fld.col];
                      if (!c) return null;
                      return (
                        <div key={fld.col} className="flex items-center gap-2 rounded-md border border-subtle bg-surface-1 px-2.5 py-2">
                          <div className="flex flex-col">
                            <button type="button" disabled={i === 0} onClick={() => { const a = [...active.fields]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; persist({ ...active, fields: a }); }} className="text-tertiary hover:text-secondary disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
                            <button type="button" disabled={i === active.fields.length - 1} onClick={() => { const a = [...active.fields]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; persist({ ...active, fields: a }); }} className="text-tertiary hover:text-secondary disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
                          </div>
                          {(() => { const M = TYPE_META.find((m) => m.v === c.type); const I = M?.Icon; return I ? <I className="size-3.5 shrink-0 text-tertiary" /> : null; })()}
                          <span className="w-24 shrink-0 truncate text-12 text-tertiary" title={c.name}>{c.name}</span>
                          <input value={fld.label ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => persist({ ...active, fields: active.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder={T.alias} className="grow rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1 text-12 text-primary outline-none placeholder:text-placeholder" />
                          <label className="flex shrink-0 items-center gap-1 text-11 text-secondary"><input type="checkbox" checked={!!fld.required} onChange={(e: ChangeEvent<HTMLInputElement>) => persist({ ...active, fields: active.fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} className="size-3.5" /> {T.required}</label>
                          <button type="button" onClick={() => persist({ ...active, fields: active.fields.filter((_, j) => j !== i) })} className="shrink-0 text-tertiary hover:text-danger-primary"><X className="size-3.5" /></button>
                        </div>
                      );
                    })}
                    <div className="relative">
                      <button type="button" disabled={avail.length === 0} onClick={(e) => { e.stopPropagation(); setAddOpen((s) => !s); }} className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-subtle px-3 py-1.5 text-13 text-tertiary hover:bg-layer-1-hover hover:text-secondary disabled:opacity-50">
                        <Plus className="size-4" /> {avail.length ? T.add : T.colsDone}
                      </button>
                      {addOpen && avail.length > 0 && (
                        <div className="absolute left-0 top-9 z-20 max-h-60 w-52 overflow-auto rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1 shadow-overlay-200" onClick={(e) => e.stopPropagation()}>
                          {avail.map((c) => {
                            const M = TYPE_META.find((m) => m.v === c.type);
                            const I = M?.Icon;
                            return (
                              <button key={c.key} type="button" onClick={() => { persist({ ...active, fields: [...active.fields, { col: c.key }] }); setAddOpen(false); }} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-13 text-secondary hover:bg-layer-transparent-hover">
                                {I && <I className="size-3.5 shrink-0 text-tertiary" />}
                                <span className="truncate">{c.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : fillCols.length === 0 ? (
                  <div className="text-13 text-tertiary">{T.noFields}</div>
                ) : (
                  <>
                    <SmartTableRecordGrid columns={fillCols} cells={vals} editable onEdit={(k, v) => setVals((p) => ({ ...p, [k]: v }))} imageUpload={imageUpload} />
                    <div className="mt-6 flex items-center gap-2">
                      <button type="button" onClick={submit} className="rounded-md bg-accent-primary px-3.5 py-1.5 text-13 font-medium text-white hover:bg-accent-primary-hover">{T.submit}</button>
                      <button type="button" onClick={() => setVals({})} className="rounded-md px-3 py-1.5 text-13 text-secondary hover:bg-layer-1-hover">{T.clear}</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
