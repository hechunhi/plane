/**
 * BARSOUL: 「蓝图」管理视图 (B-2). 见 docs/architecture/blueprint-mvp.md §6.
 * 左=蓝图列表+新建; 右=草稿编辑器(实例化节=下拉选已有对象, 不给自由文本 / 阶段=governance 只读 /
 * 高级=JSON 全量) + 发布(静态校验) + 版本史 + 实例列表. 全 Plane token.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Plus, LayoutTemplate, CheckCircle2, CircleDashed, Lock, RefreshCw } from "lucide-react";
import { cn } from "@plane/utils";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import {
  smartTableService,
  type TBlueprint,
  type TBlueprintDetail,
  type TBlueprintInstanceRow,
} from "@/services/smart-table.service";
import { BlueprintDagEditor, type TDagTask } from "./smart-table-blueprint-dag";

type Props = { ws: string; pid: string };

type Defn = Record<string, unknown> & {
  instantiate?: { card?: { labels?: string[]; name_template?: string }; row?: { table?: string; form?: string; mode?: string } | null };
  stages?: { on?: { label?: string }; ref?: string; creates_card?: string; bind?: { form?: string; row?: string } }[];
  dag?: { workflow?: string; tasks?: TDagTask[] } | null;
  guards?: { incomplete?: string };
};

export function SmartTableBlueprints({ ws, pid }: Props) {
  const zh = useZh();
  const [list, setList] = useState<TBlueprint[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TBlueprintDetail | null>(null);
  const [defn, setDefn] = useState<Defn | null>(null);
  const [instances, setInstances] = useState<TBlueprintInstanceRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [changelog, setChangelog] = useState("");
  const [pubErrors, setPubErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [showJson, setShowJson] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const T = zh
    ? { neww: "新建蓝图", empty: "还没有蓝图。蓝图 = 声明式业务清单:实例化一键落成 卡+台账行+表单绑定;阶段边由 reaction 承接。", inst: "实例化(创建时落成)", tmpl: "卡名模板", labels: "卡片标签", table: "台账表", form: "录入表单", none: "无", stages: "阶段边(governance 持有,改动走提案)", noStages: "无阶段边", guards: "完整性守卫", guardMark: "必填未齐 → 标「待补全」", advanced: "高级(JSON 全量)", publish: "发布", publishing: "发布中…", changelogPh: "本版变更说明(可选)", versions: "版本史", draftChip: "草稿", instancesT: "实例", noInst: "还没有实例", slugPh: "slug(如 procurement)", titlePh: "标题(如 采购)", create: "创建", jsonBad: "JSON 解析失败,未应用", saved: "草稿已存", pubOk: "已发布", pubFail: "发布校验未过" }
    : { neww: "新規ブループリント", empty: "ブループリントがありません。", inst: "インスタンス化(作成時)", tmpl: "カード名テンプレート", labels: "ラベル", table: "台帳テーブル", form: "入力フォーム", none: "なし", stages: "ステージ(governance 管理)", noStages: "ステージなし", guards: "ガード", guardMark: "必須未入力 → 「未補完」", advanced: "詳細(JSON)", publish: "公開", publishing: "公開中…", changelogPh: "変更内容(任意)", versions: "バージョン履歴", draftChip: "下書き", instancesT: "インスタンス", noInst: "まだありません", slugPh: "slug", titlePh: "タイトル", create: "作成", jsonBad: "JSON 解析失敗", saved: "保存しました", pubOk: "公開しました", pubFail: "検証エラー" };

  const reloadList = useCallback(async () => {
    const l = await smartTableService.listBlueprints(ws, pid);
    setList(l);
    setSelId((cur) => (cur && l.some((b) => b.id === cur) ? cur : l[0]?.id ?? null));
  }, [ws, pid]);

  useEffect(() => { reloadList(); }, [reloadList]);

  const openDetail = useCallback(async (bid: string) => {
    const d = await smartTableService.getBlueprint(ws, pid, bid);
    setDetail(d);
    setDefn((d?.draft as Defn) ?? null);
    setJsonDraft(d?.draft ? JSON.stringify(d.draft, null, 2) : "");
    setPubErrors([]);
    setChangelog("");
    setInstances(await smartTableService.listBlueprintInstances(ws, pid, bid));
  }, [ws, pid]);

  useEffect(() => { if (selId) openDetail(selId); }, [selId, openDetail]);

  // 草稿防抖落库(整体 last-wins)
  const persistDefn = useCallback((next: Defn) => {
    setDefn(next);
    setJsonDraft(JSON.stringify(next, null, 2));
    if (!selId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      smartTableService.patchBlueprint(ws, pid, selId, { definition: next }).catch(() => {});
    }, 800);
  }, [ws, pid, selId]);

  const create = useCallback(async () => {
    const slug = newSlug.trim();
    if (!slug) return;
    const b = await smartTableService.createBlueprint(ws, pid, { name: slug, title: newTitle.trim() || slug });
    if (b) {
      setCreating(false); setNewSlug(""); setNewTitle("");
      await reloadList(); setSelId(b.id);
    } else {
      setToast({ type: TOAST_TYPE.ERROR, title: zh ? "新建失败(slug 重复?)" : "作成失敗", message: "" });
    }
  }, [newSlug, newTitle, ws, pid, reloadList, zh]);

  const publish = useCallback(async () => {
    if (!selId) return;
    setBusy(true);
    setPubErrors([]);
    const res = await smartTableService.publishBlueprint(ws, pid, selId, changelog.trim() || undefined);
    setBusy(false);
    if (res.published) {
      setToast({ type: TOAST_TYPE.SUCCESS, title: `${T.pubOk} v${res.published}`, message: "" });
      await openDetail(selId); await reloadList();
    } else {
      setPubErrors(res.details ?? [T.pubFail]);
    }
  }, [selId, changelog, ws, pid, openDetail, reloadList, T.pubOk, T.pubFail]);

  const inst = defn?.instantiate ?? {};
  const card = inst.card ?? {};
  const row = inst.row ?? null;
  const selTable = detail?.refs.tables.find((t) => t.name === row?.table);

  const setInst = (patch: Partial<NonNullable<Defn["instantiate"]>>) => {
    if (!defn) return;
    persistDefn({ ...defn, instantiate: { ...inst, ...patch } });
  };

  const inputCls = "w-full rounded-md border border-subtle bg-surface-1 px-2.5 py-1.5 text-13 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong";
  const secCls = "mb-1 mt-5 text-11 font-semibold uppercase tracking-wide text-placeholder";

  return (
    <div className="flex h-full min-h-0 bg-surface-1">
      {/* 左: 蓝图列表 */}
      <div className="flex w-60 shrink-0 flex-col border-r border-subtle bg-layer-1">
        <div className="vertical-scrollbar flex-1 overflow-auto p-2">
          {list.length === 0 && <div className="px-2 py-8 text-center text-12 leading-relaxed text-tertiary">{T.empty}</div>}
          {list.map((b) => (
            <button key={b.id} type="button" onClick={() => setSelId(b.id)} className={cn("mb-0.5 flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left", b.id === selId ? "bg-layer-2 font-medium text-primary" : "text-secondary hover:bg-layer-1-hover")}>
              <LayoutTemplate className={cn("size-3.5 shrink-0", b.id === selId ? "text-accent-primary" : "text-tertiary")} />
              <span className="grow truncate text-13">{b.title}</span>
              <span className="shrink-0 text-10 text-placeholder">{b.latest_version ? `v${b.latest_version}` : T.draftChip}</span>
            </button>
          ))}
        </div>
        {creating ? (
          <div className="space-y-1.5 border-t border-subtle p-2.5">
            <input autoFocus value={newSlug} onChange={(e: ChangeEvent<HTMLInputElement>) => setNewSlug(e.target.value)} placeholder={T.slugPh} className={inputCls} />
            <input value={newTitle} onChange={(e: ChangeEvent<HTMLInputElement>) => setNewTitle(e.target.value)} placeholder={T.titlePh} className={inputCls} />
            <div className="flex gap-1.5">
              <button type="button" disabled={!newSlug.trim()} onClick={() => void create()} className="rounded-md bg-accent-primary px-3 py-1 text-12 font-medium text-white disabled:opacity-50">{T.create}</button>
              <button type="button" onClick={() => setCreating(false)} className="rounded-md px-2 py-1 text-12 text-secondary hover:bg-layer-1-hover">×</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1.5 border-t border-subtle px-4 py-2.5 text-13 font-medium text-accent-primary hover:bg-layer-1-hover">
            <Plus className="size-4" /> {T.neww}
          </button>
        )}
      </div>

      {/* 右: 草稿编辑器 + 发布 + 版本 + 实例 */}
      <div className="vertical-scrollbar min-w-0 flex-1 overflow-auto">
        {!detail || !defn ? (
          <div className="flex h-full items-center justify-center text-13 text-tertiary">{list.length ? "…" : T.empty}</div>
        ) : (
          <div className="mx-auto max-w-2xl px-6 py-6">
            <div className="flex items-center gap-2">
              <LayoutTemplate className="size-5 text-accent-primary" />
              <span className="text-16 font-semibold text-primary">{detail.title}</span>
              <span className="rounded-sm bg-layer-2 px-1.5 py-0.5 text-10 text-tertiary">{detail.name}</span>
              {detail.draft_version && <span className="rounded-sm bg-accent-subtle px-1.5 py-0.5 text-10 text-accent-primary">{T.draftChip} v{detail.draft_version}</span>}
            </div>

            {/* 实例化节 */}
            <div className={secCls}>{T.inst}</div>
            <div className="space-y-2.5 rounded-md border border-subtle p-3">
              <div>
                <div className="mb-1 text-11 text-tertiary">{T.tmpl}</div>
                <input value={card.name_template ?? "{title}"} onChange={(e: ChangeEvent<HTMLInputElement>) => setInst({ card: { ...card, name_template: e.target.value } })} className={inputCls} />
              </div>
              <div>
                <div className="mb-1 text-11 text-tertiary">{T.labels}</div>
                <div className="flex flex-wrap gap-1">
                  {detail.refs.labels.map((l) => {
                    const on = (card.labels ?? []).includes(l);
                    return (
                      <button key={l} type="button" onClick={() => setInst({ card: { ...card, labels: on ? (card.labels ?? []).filter((x) => x !== l) : [...(card.labels ?? []), l] } })} className={cn("max-w-56 truncate rounded-full border px-2 py-0.5 text-11", on ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle text-tertiary hover:bg-layer-1-hover")}>{l}</button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-11 text-tertiary">{T.table}</div>
                  <select value={row?.table ?? ""} onChange={(e) => setInst({ row: e.target.value ? { table: e.target.value, form: undefined, mode: "new_row" } : null })} className={inputCls}>
                    <option value="">{T.none}</option>
                    {detail.refs.tables.map((t) => (<option key={t.name} value={t.name}>{t.name}</option>))}
                  </select>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-11 text-tertiary">{T.form}</div>
                  <select value={row?.form ?? ""} disabled={!row?.table} onChange={(e) => setInst({ row: row ? { ...row, form: e.target.value || undefined } : null })} className={cn(inputCls, "disabled:opacity-50")}>
                    <option value="">{T.none}</option>
                    {(selTable?.forms ?? []).map((f) => (<option key={f} value={f}>{f}</option>))}
                  </select>
                </div>
              </div>
            </div>

            {/* 流程链 DAG(B-2b 编辑器) */}
            <div className={secCls}>{zh ? "流程链(完成驱动 · Temporal)" : "フロー(完了駆動 · Temporal)"}</div>
            <BlueprintDagEditor
              tasks={defn.dag?.tasks ?? []}
              refs={detail.refs}
              zh={zh}
              onChange={(tasks) =>
                persistDefn({
                  ...defn,
                  dag: tasks.length ? { ...(defn.dag ?? {}), workflow: defn.dag?.workflow ?? detail.name, tasks } : null,
                })
              }
            />

            {/* 阶段(governance 只读) */}
            <div className={secCls}>{T.stages}</div>
            <div className="rounded-md border border-subtle p-3">
              {(defn.stages ?? []).length === 0 ? (
                <div className="text-12 text-placeholder">{T.noStages}</div>
              ) : (
                <div className="space-y-1.5">
                  {(defn.stages ?? []).map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-12 text-secondary">
                      <Lock className="size-3 shrink-0 text-placeholder" />
                      <span className="truncate">{s.on?.label}</span>
                      <span className="text-placeholder">→</span>
                      <span className="truncate">{s.creates_card ?? s.ref}</span>
                      {s.bind?.form && <span className="shrink-0 rounded-sm bg-layer-2 px-1.5 py-0.5 text-10 text-tertiary">{s.bind.form}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 守卫 */}
            <div className={secCls}>{T.guards}</div>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-13 text-secondary">
              <input type="checkbox" checked={(defn.guards?.incomplete ?? "mark") === "mark"} onChange={(e: ChangeEvent<HTMLInputElement>) => persistDefn({ ...defn, guards: { incomplete: e.target.checked ? "mark" : "off" } })} className="size-3.5" />
              {T.guardMark}
            </label>

            {/* 高级 JSON */}
            <button type="button" onClick={() => setShowJson((s) => !s)} className={secCls + " block"}>{T.advanced} {showJson ? "▾" : "▸"}</button>
            {showJson && (
              <textarea
                value={jsonDraft}
                onChange={(e) => setJsonDraft(e.target.value)}
                onBlur={() => {
                  try { persistDefn(JSON.parse(jsonDraft) as Defn); }
                  catch { setToast({ type: TOAST_TYPE.ERROR, title: T.jsonBad, message: "" }); }
                }}
                spellCheck={false}
                className="h-64 w-full rounded-md border border-subtle bg-layer-2 p-3 font-mono text-11 text-primary outline-none"
              />
            )}

            {/* 发布 */}
            <div className="mt-5 flex items-center gap-2">
              <input value={changelog} onChange={(e: ChangeEvent<HTMLInputElement>) => setChangelog(e.target.value)} placeholder={T.changelogPh} className={cn(inputCls, "flex-1")} />
              <button type="button" disabled={busy || !detail.draft_version} onClick={() => void publish()} className="shrink-0 rounded-md bg-accent-primary px-3.5 py-1.5 text-13 font-medium text-white hover:bg-accent-primary-hover disabled:opacity-50">
                {busy ? T.publishing : `${T.publish} v${detail.draft_version ?? "?"}`}
              </button>
            </div>
            {pubErrors.length > 0 && (
              <div className="mt-2 space-y-1 rounded-md border border-subtle bg-layer-2 p-2.5">
                {pubErrors.map((e, i) => (<div key={i} className="text-12 text-danger-primary">· {e}</div>))}
              </div>
            )}

            {/* 版本史 */}
            <div className={secCls}>{T.versions}</div>
            <div className="space-y-1">
              {detail.versions.map((v) => (
                <div key={v.version} className="flex items-center gap-2 text-12 text-secondary">
                  {v.published_at ? <CheckCircle2 className="size-3.5 shrink-0 text-success-primary" /> : <CircleDashed className="size-3.5 shrink-0 text-placeholder" />}
                  <span className="font-medium">v{v.version}</span>
                  <span className="text-placeholder">{v.published_at ? v.published_at.slice(0, 16).replace("T", " ") : T.draftChip}</span>
                  <span className="truncate text-tertiary">{v.changelog}</span>
                </div>
              ))}
            </div>

            {/* 实例 */}
            <div className={secCls}>{T.instancesT}({instances.length})<button type="button" onClick={() => selId && smartTableService.listBlueprintInstances(ws, pid, selId).then(setInstances)} className="ml-1 inline-flex align-middle text-tertiary hover:text-secondary"><RefreshCw className="size-3" /></button></div>
            {instances.length === 0 ? (
              <div className="text-12 text-placeholder">{T.noInst}</div>
            ) : (
              <div className="space-y-1.5">
                {instances.map((i) => (
                  <div key={i.id} className="rounded-md border border-subtle px-2 py-1.5">
                    <div className="flex items-center gap-2 text-12 text-secondary">
                      <span className="shrink-0 rounded-sm bg-layer-2 px-1.5 py-0.5 text-10 text-tertiary">#{i.issue.sequence_id}</span>
                      <span className="truncate">{i.issue.name}</span>
                      <span className="shrink-0 text-placeholder">{i.issue.state ?? ""}</span>
                      <span className="ml-auto shrink-0 text-10 text-placeholder">v{i.version}</span>
                    </div>
                    {/* B-2c: 运行进度 — 流程走到哪站(done✓/current●/审批◆/pending○/cancelled×) */}
                    {(i.progress ?? []).length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                        {(i.progress ?? []).map((s, si) => {
                          const inner = (
                            <>
                              <span className="font-mono">
                                {s.status === "done" ? "✓" : s.status === "cancelled" ? "×" : s.kind === "approval" ? (s.status === "current" ? "◆" : "◇") : s.status === "current" ? "●" : "○"}
                              </span>{" "}
                              {s.label}
                            </>
                          );
                          const cls = cn(
                            "rounded-sm px-1 py-px text-10",
                            s.status === "done" && "text-success-primary",
                            s.status === "current" && "bg-accent-subtle font-medium text-accent-primary",
                            s.status === "pending" && "text-placeholder",
                            s.status === "cancelled" && "text-danger-primary"
                          );
                          return (
                            <span key={s.key} className="flex items-center gap-1">
                              {si > 0 && <span className="text-10 text-placeholder">›</span>}
                              {s.issue ? (
                                <a href={`/${ws}/projects/${pid}/issues/${s.issue.id}`} target="_blank" rel="noreferrer" title={`#${s.issue.sequence_id}`} className={cn(cls, "hover:underline")}>
                                  {inner}
                                </a>
                              ) : (
                                <span className={cls}>{inner}</span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
