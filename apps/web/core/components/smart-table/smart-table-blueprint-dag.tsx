/**
 * BARSOUL: 蓝图 DAG 任务编辑器 (B-2b). 见 docs/architecture/blueprint-mvp.md §6/§9.5。
 * 每任务一行: 类型(建卡/审批)切换、卡名模板、依赖 chips(after)、bind 三连下拉(表/表单/行)、
 * wait(完成驱动)+slaMin、审批节点(成员 picker + ANY/ALL/SEQUENTIAL + 两级 SLA)。
 * 断引用红显(表/表单/成员/after 不存在); 顶部 Kahn 分层预览(环→⚠)。
 * key 自动生成(t1,t2…), 改名联动所有 after 引用。引用项一律下拉, 不给自由文本(设计 §6)。
 */
import { useState, type ChangeEvent } from "react";
import { Plus, Trash2, GitBranch, AlertTriangle } from "lucide-react";
import { cn } from "@plane/utils";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";

export type TDagTask = {
  key: string;
  card?: string;
  labels?: string[];
  assignees?: string[]; // B-2d: 站点担当(member UUID, 建卡即指派)
  after?: string[];
  bind?: { table?: string; form?: string; row?: string } | null;
  wait?: boolean;
  slaMin?: number;
  approval?: {
    subject?: string;
    detail?: string;
    mode?: string;
    approvers?: { id: string; name: string; lang?: string }[];
    sla1Min?: number;
    sla2Min?: number;
  } | null;
};

type Refs = {
  tables: { name: string; forms: string[] }[];
  labels: string[];
  members?: { id: string; name: string }[];
};

type Props = { tasks: TDagTask[]; refs: Refs; zh: boolean; onChange: (tasks: TDagTask[]) => void };

/** Kahn 分层(声明序稳定)。环 → layers 截断 + cyclic=true。 */
function layerize(tasks: TDagTask[]): { layers: string[][]; cyclic: boolean } {
  const keys = tasks.map((t) => t.key);
  const kset = new Set(keys);
  const done = new Set<string>();
  const layers: string[][] = [];
  let remaining = tasks.slice();
  while (remaining.length) {
    const layer = remaining.filter((t) => (t.after ?? []).every((d) => !kset.has(d) || done.has(d)));
    if (!layer.length) return { layers, cyclic: true };
    layers.push(layer.map((t) => t.key));
    layer.forEach((t) => done.add(t.key));
    remaining = remaining.filter((t) => !done.has(t.key));
  }
  return { layers, cyclic: false };
}

const numOr = (v: string, d: number) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export function BlueprintDagEditor({ tasks, refs, zh, onChange }: Props) {
  const [keyEdit, setKeyEdit] = useState<{ idx: number; val: string } | null>(null);

  const T = zh
    ? { title: "流程链(DAG → Temporal)", empty: "无流程链。加任务后,实例化会启动 Temporal 工作流逐站推进。", add: "加任务", card: "建卡", appr: "审批", tmpl: "卡名模板(支持 {{title}})", after: "依赖(完成后才开始)", root: "无依赖=起点", bindT: "表", bindF: "表单", bindR: "行", rowSame: "同实例行", rowNew: "各建各行", wait: "完成驱动(人完成此卡才放下一站)", sla: "提醒(分)", subj: "审批主题", detail: "审批说明", apprs: "审批人", assg: "担当(建卡即指派)", mode: "模式", sla1: "一催(分)", sla2: "二催(分)", broken: "不存在", cyc: "依赖成环 — 发布会被拒", keyDup: "key 重复/为空,未改", noMembers: "(无成员数据,重新打开此蓝图)", preview: "执行预览", del: "删任务" }
    : { title: "フロー(DAG → Temporal)", empty: "フローなし。タスク追加でインスタンス化時に Temporal ワークフローが進行します。", add: "タスク追加", card: "カード", appr: "承認", tmpl: "カード名テンプレート({{title}})", after: "依存(完了後に開始)", root: "依存なし=起点", bindT: "テーブル", bindF: "フォーム", bindR: "行", rowSame: "同一行", rowNew: "新規行", wait: "完了駆動(完了で次へ)", sla: "リマインド(分)", subj: "承認件名", detail: "承認説明", apprs: "承認者", assg: "担当(作成時にアサイン)", mode: "モード", sla1: "催促1(分)", sla2: "催促2(分)", broken: "存在せず", cyc: "依存が循環 — 公開不可", keyDup: "key 重複/空のため未変更", noMembers: "(メンバー情報なし)", preview: "実行プレビュー", del: "削除" };

  const patchTask = (idx: number, patch: Partial<TDagTask>) =>
    onChange(tasks.map((t, i) => (i === idx ? { ...t, ...patch } : t)));

  const addTask = () => {
    let n = tasks.length + 1;
    while (tasks.some((t) => t.key === `t${n}`)) n += 1;
    const last = tasks[tasks.length - 1];
    onChange([...tasks, { key: `t${n}`, card: "", wait: true, after: last ? [last.key] : [] }]);
  };

  const removeTask = (idx: number) => {
    const k = tasks[idx].key;
    onChange(tasks.filter((_, i) => i !== idx).map((t) => ({ ...t, after: (t.after ?? []).filter((d) => d !== k) })));
  };

  const renameKey = (idx: number, raw: string) => {
    setKeyEdit(null);
    const nk = raw.trim();
    const old = tasks[idx].key;
    if (nk === old) return;
    if (!nk || tasks.some((t, i) => i !== idx && t.key === nk)) {
      setToast({ type: TOAST_TYPE.ERROR, title: T.keyDup, message: "" });
      return;
    }
    onChange(tasks.map((t, i) => ({
      ...t,
      key: i === idx ? nk : t.key,
      after: (t.after ?? []).map((d) => (d === old ? nk : d)),
    })));
  };

  const toggleType = (idx: number, toApproval: boolean) => {
    const t = tasks[idx];
    if (toApproval === !!t.approval) return;
    patchTask(idx, toApproval
      ? { approval: { subject: "", mode: "ANY", approvers: [], sla1Min: 60, sla2Min: 240 }, card: "", bind: null, wait: false, slaMin: 0 }
      : { approval: null, card: t.card ?? "", wait: true });
  };

  const { layers, cyclic } = layerize(tasks);
  const members = refs.members ?? [];
  const inputCls = "w-full rounded-md border border-subtle bg-surface-1 px-2 py-1 text-12 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong";
  const miniSel = "rounded-md border border-subtle bg-surface-1 px-1.5 py-1 text-12 text-primary outline-none focus:border-accent-strong";
  const lbl = "mb-0.5 text-10 text-tertiary";

  return (
    <div className="space-y-2">
      {/* 执行预览(分层) */}
      {tasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-subtle bg-layer-2 px-2.5 py-2 text-11">
          <GitBranch className="size-3.5 shrink-0 text-tertiary" />
          <span className="text-placeholder">{T.preview}:</span>
          {layers.map((layer, li) => (
            <span key={li} className="flex items-center gap-1.5">
              {li > 0 && <span className="text-placeholder">→</span>}
              <span className="flex gap-1">
                {layer.map((k) => {
                  const tk = tasks.find((t) => t.key === k);
                  return (
                    <span key={k} className={cn("rounded-sm px-1.5 py-0.5", tk?.approval ? "bg-accent-subtle text-accent-primary" : "bg-surface-1 text-secondary")}>
                      {tk?.approval ? "◇" : ""}{k}
                    </span>
                  );
                })}
              </span>
            </span>
          ))}
          {cyclic && <span className="flex items-center gap-1 font-medium text-danger-primary"><AlertTriangle className="size-3.5" />{T.cyc}</span>}
        </div>
      )}

      {tasks.length === 0 && <div className="text-12 text-placeholder">{T.empty}</div>}

      {tasks.map((t, idx) => {
        const isApproval = !!t.approval;
        const bind = t.bind ?? null;
        const bindTable = bind?.table ? refs.tables.find((x) => x.name === bind.table) : undefined;
        const tableBroken = !!bind?.table && !bindTable;
        const formBroken = !!bind?.form && !!bindTable && !bindTable.forms.includes(bind.form);
        return (
          <div key={idx} className="rounded-md border border-subtle p-2.5">
            {/* 行头: key + 类型 + 删除 */}
            <div className="mb-2 flex items-center gap-2">
              <input
                value={keyEdit?.idx === idx ? keyEdit.val : t.key}
                onFocus={() => setKeyEdit({ idx, val: t.key })}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyEdit({ idx, val: e.target.value })}
                onBlur={(e) => renameKey(idx, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="w-24 rounded-md border border-subtle bg-layer-2 px-1.5 py-0.5 font-mono text-11 text-secondary outline-none focus:border-accent-strong"
              />
              <div className="flex overflow-hidden rounded-md border border-subtle text-11">
                <button type="button" onClick={() => toggleType(idx, false)} className={cn("px-2 py-0.5", !isApproval ? "bg-accent-primary text-white" : "text-tertiary hover:bg-layer-1-hover")}>{T.card}</button>
                <button type="button" onClick={() => toggleType(idx, true)} className={cn("px-2 py-0.5", isApproval ? "bg-accent-primary text-white" : "text-tertiary hover:bg-layer-1-hover")}>{T.appr}</button>
              </div>
              <button type="button" title={T.del} onClick={() => removeTask(idx)} className="ml-auto rounded-sm p-1 text-tertiary hover:bg-layer-1-hover hover:text-danger-primary"><Trash2 className="size-3.5" /></button>
            </div>

            {!isApproval ? (
              <div className="space-y-2">
                <div>
                  <div className={lbl}>{T.tmpl}</div>
                  <input value={t.card ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchTask(idx, { card: e.target.value })} placeholder="💰 询价 — {{title}}" className={inputCls} />
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-28">
                    <div className={cn(lbl, tableBroken && "text-danger-primary")}>{T.bindT}{tableBroken && ` ⚠${T.broken}`}</div>
                    <select value={bind?.table ?? ""} onChange={(e) => patchTask(idx, { bind: e.target.value ? { table: e.target.value, row: bind?.row ?? "same" } : null })} className={cn(miniSel, "w-full", tableBroken && "border-danger-strong text-danger-primary")}>
                      <option value="">—</option>
                      {tableBroken && <option value={bind!.table}>{bind!.table}</option>}
                      {refs.tables.map((x) => (<option key={x.name} value={x.name}>{x.name}</option>))}
                    </select>
                  </div>
                  <div className="min-w-28">
                    <div className={cn(lbl, formBroken && "text-danger-primary")}>{T.bindF}{formBroken && ` ⚠${T.broken}`}</div>
                    <select value={bind?.form ?? ""} disabled={!bind?.table || tableBroken} onChange={(e) => patchTask(idx, { bind: { ...bind!, form: e.target.value || undefined } })} className={cn(miniSel, "w-full disabled:opacity-50", formBroken && "border-danger-strong text-danger-primary")}>
                      <option value="">—</option>
                      {formBroken && <option value={bind!.form}>{bind!.form}</option>}
                      {(bindTable?.forms ?? []).map((f) => (<option key={f} value={f}>{f}</option>))}
                    </select>
                  </div>
                  <div>
                    <div className={lbl}>{T.bindR}</div>
                    <select value={bind?.row ?? "same"} disabled={!bind?.table} onChange={(e) => patchTask(idx, { bind: { ...bind!, row: e.target.value } })} className={cn(miniSel, "disabled:opacity-50")}>
                      <option value="same">{T.rowSame}</option>
                      <option value="new">{T.rowNew}</option>
                    </select>
                  </div>
                  <label className="flex cursor-pointer items-center gap-1.5 pb-1 text-12 text-secondary">
                    <input type="checkbox" checked={!!t.wait} onChange={(e: ChangeEvent<HTMLInputElement>) => patchTask(idx, { wait: e.target.checked })} className="size-3.5" />
                    {T.wait}
                  </label>
                  {!!t.wait && (
                    <div>
                      <div className={lbl}>{T.sla}</div>
                      <input value={t.slaMin || ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchTask(idx, { slaMin: numOr(e.target.value, 0) })} placeholder="1440" className={cn(miniSel, "w-20")} />
                    </div>
                  )}
                </div>
                {/* B-2d: 站点担当(member UUID 多选; 离项成员红显可删) */}
                <div>
                  <div className={lbl}>{T.assg}</div>
                  <div className="flex flex-wrap gap-1">
                    {(t.assignees ?? []).filter((id) => !members.some((m) => m.id === id)).map((id) => (
                      <button key={id} type="button" title={T.broken} onClick={() => patchTask(idx, { assignees: (t.assignees ?? []).filter((x) => x !== id) })} className="rounded-full border border-danger-strong bg-danger-subtle px-2 py-0.5 text-11 text-danger-primary">⚠{id.slice(0, 8)} ×</button>
                    ))}
                    {members.map((m) => {
                      const on = (t.assignees ?? []).includes(m.id);
                      return (
                        <button key={m.id} type="button" onClick={() => patchTask(idx, { assignees: on ? (t.assignees ?? []).filter((x) => x !== m.id) : [...(t.assignees ?? []), m.id] })} className={cn("rounded-full border px-2 py-0.5 text-11", on ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle text-tertiary hover:bg-layer-1-hover")}>{m.name}</button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <div className={lbl}>{T.subj}</div>
                    <input value={t.approval?.subject ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchTask(idx, { approval: { ...t.approval, subject: e.target.value } })} placeholder="采购审批 — {{title}}" className={inputCls} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={lbl}>{T.detail}</div>
                    <input value={t.approval?.detail ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchTask(idx, { approval: { ...t.approval, detail: e.target.value } })} className={inputCls} />
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-0 grow">
                    <div className={lbl}>{T.apprs}{members.length === 0 && <span className="text-placeholder"> {T.noMembers}</span>}</div>
                    <div className="flex flex-wrap gap-1">
                      {(t.approval?.approvers ?? []).filter((a) => !members.some((m) => m.id === a.id)).map((a) => (
                        <button key={a.id} type="button" title={T.broken} onClick={() => patchTask(idx, { approval: { ...t.approval, approvers: (t.approval?.approvers ?? []).filter((x) => x.id !== a.id) } })} className="rounded-full border border-danger-strong bg-danger-subtle px-2 py-0.5 text-11 text-danger-primary">⚠{a.name} ×</button>
                      ))}
                      {members.map((m) => {
                        const cur = t.approval?.approvers ?? [];
                        const on = cur.some((a) => a.id === m.id);
                        const seq = (t.approval?.mode ?? "ANY") === "SEQUENTIAL" && on ? cur.findIndex((a) => a.id === m.id) + 1 : 0;
                        return (
                          <button key={m.id} type="button" onClick={() => patchTask(idx, { approval: { ...t.approval, approvers: on ? cur.filter((a) => a.id !== m.id) : [...cur, { id: m.id, name: m.name, lang: "zh" }] } })} className={cn("rounded-full border px-2 py-0.5 text-11", on ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle text-tertiary hover:bg-layer-1-hover")}>
                            {seq > 0 && <span className="mr-0.5 font-mono text-10">{seq}.</span>}{m.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div className={lbl}>{T.mode}</div>
                    <select value={t.approval?.mode ?? "ANY"} onChange={(e) => patchTask(idx, { approval: { ...t.approval, mode: e.target.value } })} className={miniSel}>
                      <option value="ANY">ANY</option>
                      <option value="ALL">ALL</option>
                      <option value="SEQUENTIAL">SEQUENTIAL</option>
                    </select>
                  </div>
                  <div>
                    <div className={lbl}>{T.sla1}</div>
                    <input value={t.approval?.sla1Min ?? 60} onChange={(e: ChangeEvent<HTMLInputElement>) => patchTask(idx, { approval: { ...t.approval, sla1Min: numOr(e.target.value, 60) } })} className={cn(miniSel, "w-16")} />
                  </div>
                  <div>
                    <div className={lbl}>{T.sla2}</div>
                    <input value={t.approval?.sla2Min ?? 240} onChange={(e: ChangeEvent<HTMLInputElement>) => patchTask(idx, { approval: { ...t.approval, sla2Min: numOr(e.target.value, 240) } })} className={cn(miniSel, "w-16")} />
                  </div>
                </div>
              </div>
            )}

            {/* 依赖 chips(自身除外; 断引用红显) */}
            <div className="mt-2">
              <div className={lbl}>{T.after} <span className="text-placeholder">({T.root})</span></div>
              <div className="flex flex-wrap gap-1">
                {(t.after ?? []).filter((d) => !tasks.some((x) => x.key === d)).map((d) => (
                  <button key={d} type="button" title={T.broken} onClick={() => patchTask(idx, { after: (t.after ?? []).filter((x) => x !== d) })} className="rounded-full border border-danger-strong bg-danger-subtle px-2 py-0.5 font-mono text-11 text-danger-primary">⚠{d} ×</button>
                ))}
                {tasks.filter((x) => x.key !== t.key).map((x) => {
                  const on = (t.after ?? []).includes(x.key);
                  return (
                    <button key={x.key} type="button" onClick={() => patchTask(idx, { after: on ? (t.after ?? []).filter((d) => d !== x.key) : [...(t.after ?? []), x.key] })} className={cn("rounded-full border px-2 py-0.5 font-mono text-11", on ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle text-tertiary hover:bg-layer-1-hover")}>{x.key}</button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      <button type="button" onClick={addTask} className="flex items-center gap-1.5 rounded-md border border-dashed border-subtle px-3 py-1.5 text-12 font-medium text-accent-primary hover:bg-layer-1-hover">
        <Plus className="size-3.5" /> {T.add}
      </button>
    </div>
  );
}
