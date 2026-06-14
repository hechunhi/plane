/**
 * BARSOUL: 智能表 / 项目数据库 — feature 页. 见 docs/architecture/smart-table-mvp.md.
 * v5 glide 火力全开: 右键菜单(单元格/列头)+ 列宽拖拽 + 列拖拽重排(持久化)+ 复制/粘贴(Excel 块)
 * + 填充柄 + Delete 清空 + Ctrl+F 搜索 + 列头排序 + 原生追加行(onRowAppended) + 单选格内下拉. 全 Plane token(暗色).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useParams } from "next/navigation";
import { Plus, Trash2, Database, Pencil, Search, ArrowUp, ArrowDown, Eraser, Link2, Sigma, Filter, SlidersHorizontal, X, Share2, Sparkles, AlertTriangle, PanelLeftClose, PanelLeftOpen, Maximize2, Minimize2, LayoutTemplate, Copy, Files, ExternalLink, Snowflake, Download, Eye, EyeOff, ChevronsUp, ChevronsDown, Undo2, Redo2, RotateCcw, MoveHorizontal } from "lucide-react";
import { DataEditor, GridCellKind, type GridColumn, type Item, type GridCell, type EditableGridCell, type DataEditorRef, type GridSelection } from "@glideapps/glide-data-grid";
import { cn } from "@plane/utils";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { useProject } from "@/hooks/store/use-project";
import {
  smartTableService,
  type TBlueprint,
  type TSmartColumnType,
  type TSmartTable,
  type TSmartTableSummary,
  type TSchemaI18n,
  type TTableDeps,
} from "@/services/smart-table.service";
import { CUSTOM_RENDERERS, TYPE_HEADER_ICON, TYPE_META, cellForColumn, coerceEditedValue, getGlideTheme, makeImageEditor, useIsDark } from "./smart-table-cells";
import { SmartTableFields } from "./smart-table-fields";
import { useSpacePan } from "./use-space-pan";
import { SmartTableForms } from "./smart-table-forms";
import { SmartTableBlueprints } from "./smart-table-blueprints";
import { SmartTableI18n } from "./smart-table-i18n";

// 主题 / cell 渲染器 / TYPE_META / cellForColumn / coerceEditedValue 已抽到 ./smart-table-cells(glide 唯一编辑器)


// 派生/投影列(只读): 后端 _DERIVERS 镜像. 从卡片(source_issue)投影 Plane 状态/负责人 + ai-bot 的停滞/下一步.
const DERIVERS: { key: string; zh: string; ja: string }[] = [
  { key: "issue_status", zh: "状态(卡片)", ja: "ステータス(カード)" },
  { key: "issue_assignee", zh: "负责人(卡片)", ja: "担当者(カード)" },
  { key: "issue_stale", zh: "停滞天数(AI)", ja: "停滞日数(AI)" },
  { key: "issue_next", zh: "下一步(AI)", ja: "次アクション(AI)" },
  { key: "keiri_amount", zh: "订单金额(keiri)", ja: "注文金額(keiri)" },
  { key: "keiri_paid", zh: "已收款(keiri)", ja: "入金済(keiri)" },
  { key: "keiri_items", zh: "品目数(keiri)", ja: "品目数(keiri)" },
  { key: "keiri_freight", zh: "运费(keiri)", ja: "送料(keiri)" },
  { key: "keiri_customer", zh: "客户(keiri)", ja: "顧客(keiri)" },
  { key: "keiri_order_date", zh: "下单日(keiri)", ja: "注文日(keiri)" },
];

// ── 汇总行 聚合 ──
type Agg = "sum" | "avg" | "min" | "max" | "count" | "empty" | "none";
const NUMERIC_TYPES: TSmartColumnType[] = ["number", "money", "rating", "progress", "range"];
const defaultAgg = (t: TSmartColumnType): Agg => (NUMERIC_TYPES.includes(t) ? "sum" : "count");
function fmtAggNum(n: number, t: TSmartColumnType, isAvg = false): string {
  const v = isAvg ? Math.round(n * 10) / 10 : Number.isInteger(n) ? n : Math.round(n * 100) / 100;
  return (t === "money" ? "¥" : "") + v.toLocaleString("ja-JP");
}
function aggCompute(agg: Agg, t: TSmartColumnType, raws: unknown[]): string {
  if (agg === "none") return "";
  const filled = raws.filter((v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)).length;
  if (agg === "count") return String(filled);
  if (agg === "empty") return String(raws.length - filled);
  const nums = raws.filter((v) => v != null && v !== "").map((v) => Number(v)).filter((n) => Number.isFinite(n));
  if (!nums.length) return "—";
  switch (agg) {
    case "sum": return fmtAggNum(nums.reduce((a, b) => a + b, 0), t);
    case "avg": return fmtAggNum(nums.reduce((a, b) => a + b, 0) / nums.length, t, true);
    case "min": return fmtAggNum(Math.min(...nums), t);
    case "max": return fmtAggNum(Math.max(...nums), t);
    default: return "";
  }
}
const aggName = (agg: Agg, zh: boolean): string =>
  ({ sum: "Σ", avg: zh ? "均" : "平均", min: zh ? "最小" : "最小", max: zh ? "最大" : "最大", count: zh ? "计数" : "件数", empty: zh ? "空" : "空", none: "" } as Record<Agg, string>)[agg];

// ── 过滤 ──
type FilterOp = "contains" | "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "empty" | "notempty" | "is" | "isnot" | "checked" | "unchecked";
type FilterRule = { col: string; op: FilterOp; value: string };
function opsForType(t: TSmartColumnType): FilterOp[] {
  if (NUMERIC_TYPES.includes(t)) return ["eq", "neq", "gt", "lt", "gte", "lte", "empty", "notempty"];
  if (t === "single_select") return ["is", "isnot", "empty", "notempty"];
  if (t === "multi_select") return ["contains", "empty", "notempty"];
  if (t === "checkbox") return ["checked", "unchecked"];
  if (t === "date") return ["eq", "gt", "lt", "empty", "notempty"];
  return ["contains", "eq", "neq", "empty", "notempty"];
}
const defaultOp = (t: TSmartColumnType): FilterOp => opsForType(t)[0];
const NO_VALUE_OPS: FilterOp[] = ["empty", "notempty", "checked", "unchecked"];
const opNeedsValue = (op: FilterOp) => !NO_VALUE_OPS.includes(op);
function opLabel(op: FilterOp, zh: boolean): string {
  const m: Record<FilterOp, [string, string]> = {
    contains: ["包含", "含む"], eq: ["=", "="], neq: ["≠", "≠"], gt: [">", ">"], lt: ["<", "<"], gte: ["≥", "≥"], lte: ["≤", "≤"],
    empty: ["为空", "空"], notempty: ["非空", "空でない"], is: ["是", "は"], isnot: ["不是", "ではない"], checked: ["已勾选", "オン"], unchecked: ["未勾选", "オフ"],
  };
  return zh ? m[op][0] : m[op][1];
}
function matchRule(raw: unknown, op: FilterOp, value: string, t: TSmartColumnType): boolean {
  const s = raw == null ? "" : Array.isArray(raw) ? raw.map(String).join(",") : String(raw);
  const isEmpty = s === "" || (Array.isArray(raw) && raw.length === 0);
  if (op === "empty") return isEmpty;
  if (op === "notempty") return !isEmpty;
  if (op === "checked") return !!raw;
  if (op === "unchecked") return !raw;
  if (NUMERIC_TYPES.includes(t) && ["eq", "neq", "gt", "lt", "gte", "lte"].includes(op)) {
    const n = Number(raw), nv = Number(value);
    if (!Number.isFinite(n) || !Number.isFinite(nv)) return op === "neq";
    switch (op) { case "eq": return n === nv; case "neq": return n !== nv; case "gt": return n > nv; case "lt": return n < nv; case "gte": return n >= nv; case "lte": return n <= nv; }
  }
  const sl = s.toLowerCase(), vl = value.toLowerCase();
  switch (op) {
    case "contains": return sl.includes(vl);
    case "eq": case "is": return s === value;
    case "neq": case "isnot": return s !== value;
    case "gt": return s > value;
    case "lt": return s < value;
    default: return true;
  }
}

type Ctx = { kind: "cell" | "header"; col: number; row: number; x: number; y: number };

// 撤销/重做 op(收敛到「单元格编辑 + 行增删」三类可逆操作; 见 candidate-opt #7)
type UndoOp =
  | { k: "cell"; rowId: string; key: string; prev: unknown; next: unknown }
  | { k: "del"; row: { id: string; cells: Record<string, unknown> }; idx: number } // 行被删 → 存全量 + 落点
  | { k: "add"; rowId: string }; // 行被加 → 存 id 以便撤销时删除

export function SmartTablesRoot() {
  const params = useParams();
  const ws = (params?.workspaceSlug ?? "").toString();
  const pid = (params?.projectId ?? "").toString();
  const zh = useZh();
  // 共享范围对话框用: 工作区项目清单(指定项目白名单勾选)
  const { joinedProjectIds, getPartialProjectById } = useProject();
  const dark = useIsDark();
  const lang = zh ? "zh" : "ja"; // schema i18n 显示语言(跟随界面语言)
  const trName = useCallback((x: { name: string; i18n?: TSchemaI18n }) => x.i18n?.[lang]?.name || x.name, [lang]);
  const glideTheme = useMemo(() => getGlideTheme(dark), [dark]);
  const imageEditor = useMemo(() => makeImageEditor((f: File) => smartTableService.uploadCellImage(ws, pid, f)), [ws, pid]);

  const [tables, setTables] = useState<TSmartTableSummary[]>([]);
  const [table, setTable] = useState<TSmartTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"data" | "fields" | "form" | "blueprint" | "i18n">("data");
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [editName, setEditName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [colW, setColW] = useState<Record<string, number>>({});
  const [showSearch, setShowSearch] = useState(false);
  const [summaryOn, setSummaryOn] = useState(false);
  const [summaryAgg, setSummaryAgg] = useState<Record<string, Agg>>({});
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const [colorByCol, setColorByCol] = useState<string | null>(null);
  const [viewMenu, setViewMenu] = useState(false);
  const [rowH, setRowH] = useState(36);
  const [freezeN, setFreezeN] = useState(1);
  const [blueprints, setBlueprints] = useState<TBlueprint[]>([]);
  const [bpMenu, setBpMenu] = useState(false);
  const [bpSel, setBpSel] = useState<TBlueprint | null>(null);
  const [bpTitle, setBpTitle] = useState("");
  const [bpCustomer, setBpCustomer] = useState("");
  const [bpBusy, setBpBusy] = useState(false);
  const [tblDlg, setTblDlg] = useState<
    | { kind: "delete"; tid: string; tname: string; deps: TTableDeps }
    | { kind: "unshare"; tid: string; tname: string; fb: number; bps: { name: string; project: string }[]; scope: { shared_workspace: boolean; shared_projects: string[] } }
    | null
  >(null);
  // 共享范围对话框(私有/全工作区/指定项目白名单): 防外部协作项目经全工作区共享误看到敏感表
  const [shareDlg, setShareDlg] = useState<{ tid: string; tname: string; mode: "private" | "all" | "some"; pids: string[] } | null>(null);
  const [tblBusy, setTblBusy] = useState(false);
  const [listCtx, setListCtx] = useState<{ x: number; y: number; t: TSmartTableSummary } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const pref = window.localStorage.getItem("smart-table:sidebar-collapsed");
    if (pref === "1") return true;
    if (pref === "0") return false;
    return window.innerWidth < 860; // 无偏好且窄屏 → 默认折叠, 给网格让出宽度
  });
  const [maximized, setMaximized] = useState(false);
  const [fieldsFocus, setFieldsFocus] = useState<string | null>(null);
  // candidate-opt 状态: 隐藏列 / 缩放 / 行多选 / 批量填充弹层 / 撤销重做计数(驱动按钮可用态)
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [gridSel, setGridSel] = useState<GridSelection | undefined>(undefined);
  const [batchPop, setBatchPop] = useState(false);
  const [batchCol, setBatchCol] = useState("");
  const [batchVal, setBatchVal] = useState("");
  const [histTick, setHistTick] = useState(0);
  const gridRef = useRef<DataEditorRef>(null);
  const undoStack = useRef<UndoOp[]>([]);
  const redoStack = useRef<UndoOp[]>([]);
  const scrollPos = useRef<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    try { window.localStorage.setItem("smart-table:sidebar-collapsed", sidebarCollapsed ? "1" : "0"); } catch { /* private mode */ }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!maximized) return;
    const h = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setMaximized(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [maximized]);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const T = zh
    ? { title: "数据表", newTable: "新建表", untitled: "未命名表", empty: "还没有数据表", tabData: "数据", tabFields: "字段", tabForm: "表单", addCol: "新列", search: "搜索", del: "删除列", changeType: "类型", rename: "重命名", sortAsc: "升序", sortDesc: "降序", summary: "汇总行", share: "设置共享范围", shared: "已共享", foreign: "引用(他项目共享)", incomplete: "待补全", clear: "清空单元格", delRow: "删除此行", noCols: "右上「+」或「字段」视图加第一列", rows: (n: number) => `${n} 行`, cols: (n: number) => `${n} 列` }
    : { title: "データテーブル", newTable: "新規テーブル", untitled: "無題のテーブル", empty: "テーブルがありません", tabData: "データ", tabFields: "フィールド", tabForm: "フォーム", addCol: "新規列", search: "検索", del: "列を削除", changeType: "種類", rename: "名前変更", sortAsc: "昇順", sortDesc: "降順", summary: "集計行", share: "共有範囲を設定", shared: "共有中", foreign: "参照(他プロジェクト)", incomplete: "未補完", clear: "セルをクリア", delRow: "この行を削除", noCols: "右上「+」または「フィールド」で最初の列を", rows: (n: number) => `${n} 行`, cols: (n: number) => `${n} 列` };

  const errToast = useCallback((zhMsg: string, jaMsg: string) => setToast({ type: TOAST_TYPE.ERROR, title: zh ? zhMsg : jaMsg, message: "" }), [zh]);
  // 点击定位的 fixed 菜单(右键/表列表)在窄屏/低分辨下钳进视口, 不溢出被裁
  const clampMenu = useCallback((x: number, y: number, w: number, h: number) => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 9999;
    const vh = typeof window !== "undefined" ? window.innerHeight : 9999;
    return { left: Math.max(8, Math.min(x, vw - w - 8)), top: Math.max(8, Math.min(y, vh - h - 8)) };
  }, []);

  useEffect(() => {
    if (document.getElementById("portal")) return;
    const d = document.createElement("div");
    d.id = "portal";
    d.style.cssText = "position:fixed;left:0;top:0;z-index:9999";
    document.body.appendChild(d);
    return () => { d.remove(); };
  }, []);

  const refreshList = useCallback(async () => {
    if (!ws || !pid) return [];
    const list = await smartTableService.listTables(ws, pid);
    setTables(list);
    return list;
  }, [ws, pid]);

  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  useSpacePan(gridWrapRef); // 空格+拖动平移(Figma 手感)

  // 每用户视图配置: 换表时整取还原; 改动后防抖整存(后端 my-view, 按用户隔离)
  const lastViewTable = useRef<string | null>(null);
  const viewHydrating = useRef(false);
  const viewSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openTable = useCallback(async (tid: string) => {
    if (!ws || !pid) return;
    const t = await smartTableService.getTable(ws, pid, tid).catch(() => null);
    setTable(t);
    if (t && lastViewTable.current !== t.id) {
      lastViewTable.current = t.id;
      viewHydrating.current = true;
      const cfg = await smartTableService.getMyView(ws, pid, t.id);
      const fl = Array.isArray(cfg.filters) ? (cfg.filters as FilterRule[]) : [];
      setFilters(fl);
      setShowFilter(fl.length > 0);
      setSummaryOn(!!cfg.summaryOn);
      setSummaryAgg((cfg.summaryAgg && typeof cfg.summaryAgg === "object" ? cfg.summaryAgg : {}) as Record<string, Agg>);
      setColorByCol(typeof cfg.colorByCol === "string" ? cfg.colorByCol : null);
      setRowH(typeof cfg.rowH === "number" ? cfg.rowH : 36);
      setFreezeN(typeof cfg.freezeN === "number" ? cfg.freezeN : 1);
      setOnlyIncomplete(!!cfg.onlyIncomplete);
      setHidden(new Set(Array.isArray(cfg.hiddenCols) ? (cfg.hiddenCols as string[]) : []));
      setZoom(typeof cfg.zoom === "number" ? Math.min(1.7, Math.max(0.8, cfg.zoom)) : 1);
      setGridSel(undefined);
      undoStack.current = []; redoStack.current = []; setHistTick(0);
      setTimeout(() => { viewHydrating.current = false; }, 150);
    }
  }, [ws, pid]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const list = await refreshList();
      if (alive && list.length) await openTable(list[0].id);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [refreshList, openTable]);

  const selectTable = useCallback((tid: string) => { setView("data"); setFieldsFocus(null); openTable(tid); }, [openTable]);

  const createTable = useCallback(async () => {
    if (!ws || !pid) return;
    const t = await smartTableService.createTable(ws, pid, { name: T.untitled }).catch(() => null);
    await refreshList();
    if (t) { setTable(t); setView("data"); setRenameVal(t.name); setRenaming(true); }
    else errToast("新建表失败", "テーブル作成に失敗");
  }, [ws, pid, refreshList, T.untitled, errToast]);

  const commitRename = useCallback(async () => {
    setRenaming(false);
    const name = renameVal.trim();
    if (!table || !name || name === table.name) return;
    await smartTableService.updateTable(ws, pid, table.id, { name }).catch(() => {});
    setTable((p) => (p ? { ...p, name } : p));
    await refreshList();
  }, [renameVal, table, ws, pid, refreshList]);

  // 共享范围对话框(显式目标版: 右键哪张表作用哪张); 表头按钮经薄包装走同一路径
  const openShareFor = useCallback((t: { id: string; name: string; ws: boolean; pids: string[]; foreign: boolean }) => {
    setListCtx(null);
    if (t.foreign) return;
    setShareDlg({ tid: t.id, tname: t.name, mode: t.ws ? "all" : t.pids.length ? "some" : "private", pids: t.pids });
  }, []);

  const openShare = useCallback(() => {
    if (!table) return;
    openShareFor({ id: table.id, name: table.name, ws: !!table.shared_workspace, pids: table.shared_projects ?? [], foreign: !!table.foreign });
  }, [table, openShareFor]);

  const saveShare = useCallback(async () => {
    if (!shareDlg) return;
    const scope = {
      shared_workspace: shareDlg.mode === "all",
      shared_projects: shareDlg.mode === "some" ? shareDlg.pids : [],
    };
    setTblBusy(true);
    const res = await smartTableService.setTableShare(ws, pid, shareDlg.tid, scope, false);
    setTblBusy(false);
    if (res.ok) {
      setShareDlg(null);
      setTable((p) => (p && p.id === shareDlg.tid ? { ...p, ...scope } : p));
      await refreshList();
    } else {
      // 收窄遇外部依赖 → 409 + 报告 → 确认面板(祖父化语义), 绝不静默断
      setShareDlg(null);
      setTblDlg({ kind: "unshare", tid: shareDlg.tid, tname: shareDlg.tname, fb: res.foreign_bindings ?? 0, bps: res.blueprints ?? [], scope });
    }
  }, [shareDlg, ws, pid, refreshList]);

  const confirmUnshare = useCallback(async () => {
    if (!tblDlg || tblDlg.kind !== "unshare") return;
    setTblBusy(true);
    const res = await smartTableService.setTableShare(ws, pid, tblDlg.tid, tblDlg.scope, true);
    setTblBusy(false);
    setTblDlg(null);
    if (res.ok) {
      setTable((p) => (p && p.id === tblDlg.tid ? { ...p, ...tblDlg.scope } : p));
      await refreshList();
    } else {
      errToast("修改共享范围失败", "共有範囲の変更に失敗");
    }
  }, [tblDlg, ws, pid, refreshList, errToast]);

  const askDeleteTableFor = useCallback(async (t: { id: string; name: string; foreign: boolean }) => {
    setListCtx(null);
    if (t.foreign) return;
    const deps = await smartTableService.getTableDeps(ws, pid, t.id);
    setTblDlg({ kind: "delete", tid: t.id, tname: t.name, deps: deps ?? { rows: 0, forms: 0, views: 0, bindings: { total: 0, foreign: 0, cards: [] }, blueprints: [] } });
  }, [ws, pid]);

  const askDeleteTable = useCallback(() => {
    if (!table) return;
    void askDeleteTableFor({ id: table.id, name: table.name, foreign: !!table.foreign });
  }, [table, askDeleteTableFor]);

  const confirmDeleteTable = useCallback(async () => {
    if (!tblDlg) return;
    setTblBusy(true);
    const ok = await smartTableService.deleteTable(ws, pid, tblDlg.tid, true);
    setTblBusy(false);
    const wasCurrent = table?.id === tblDlg.tid;
    const tname = tblDlg.tname;
    setTblDlg(null);
    if (!ok) { errToast("删除失败", "削除に失敗"); return; }
    setToast({ type: TOAST_TYPE.SUCCESS, title: zh ? `表「${tname}」已删除` : `「${tname}」を削除しました`, message: zh ? "卡片侧绑定已一并解除" : "カード側の連携も解除済み" });
    const list = await refreshList();
    if (wasCurrent) {
      setTable(null);
      if (list.length) await openTable(list[0].id);
    }
  }, [tblDlg, table, ws, pid, refreshList, openTable, zh, errToast]);

  // Blueprint(B-1): 列表 + 实例化(详见 docs/architecture/blueprint-mvp.md)
  useEffect(() => {
    if (ws && pid) smartTableService.listBlueprints(ws, pid).then(setBlueprints).catch(() => {});
  }, [ws, pid]);

  const instantiateBp = useCallback(async () => {
    if (!bpSel || !bpTitle.trim()) return;
    setBpBusy(true);
    const res = await smartTableService.instantiateBlueprint(ws, pid, bpSel.id, { title: bpTitle.trim(), customer: bpCustomer.trim() || undefined });
    setBpBusy(false);
    if (res) {
      setBpMenu(false);
      setBpSel(null);
      setToast({ type: TOAST_TYPE.SUCCESS, title: zh ? `已按蓝图创建 (#${res.sequence_id})` : `作成しました (#${res.sequence_id})`, message: zh ? "卡片+台账行+表单绑定已就位" : "カード+行+フォーム連携 完了" });
      if (table) await openTable(table.id);
      await refreshList();
    } else {
      errToast("蓝图实例化失败", "作成に失敗");
    }
  }, [bpSel, bpTitle, bpCustomer, ws, pid, table, openTable, refreshList, zh, errToast]);

  const columns = useMemo(() => table?.columns ?? [], [table]);
  // 隐藏列(candidate-opt #4): glide 只渲染可见列; 所有「glide 列下标→列」的换算一律走 visibleColumns
  const visibleColumns = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden]);
  // 缩放(candidate-opt #6, Cmd+滚轮): 字号+行高同步缩放, 在密度预设(rowH)基础上乘 zoom
  const effRowH = useMemo(() => Math.round(rowH * zoom), [rowH, zoom]);
  const themed = useMemo(
    () => (zoom === 1 ? glideTheme : { ...glideTheme, baseFontStyle: `${Math.round(13 * zoom)}px`, editorFontSize: `${Math.round(13 * zoom)}px`, headerFontStyle: `600 ${Math.round(12 * zoom)}px`, markerFontStyle: `${Math.round(11 * zoom)}px` }),
    [glideTheme, zoom]
  );
  const rows = useMemo(() => table?.rows ?? [], [table]);
  const displayRows = useMemo(() => {
    let rs = rows;
    if (filters.length)
      rs = rs.filter((r) =>
        filters.every((f) => {
          const c = columns.find((x) => x.key === f.col);
          return c ? matchRule(r.cells?.[f.col], f.op, f.value, c.type) : true;
        })
      );
    if (onlyIncomplete) rs = rs.filter((r) => r.incomplete);
    return rs;
  }, [rows, filters, columns, onlyIncomplete]);

  useEffect(() => {
    if (!table || viewHydrating.current) return;
    if (viewSaveTimer.current) clearTimeout(viewSaveTimer.current);
    const tid = table.id;
    const config = { filters, summaryOn, summaryAgg, colorByCol, rowH, onlyIncomplete, freezeN, hiddenCols: [...hidden], zoom };
    viewSaveTimer.current = setTimeout(() => { smartTableService.saveMyView(ws, pid, tid, config); }, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, summaryOn, summaryAgg, colorByCol, rowH, onlyIncomplete, freezeN, hidden, zoom, table?.id, ws, pid]);

  const addFilter = useCallback(() => {
    const c = columns[0];
    if (!c) return;
    setFilters((p) => [...p, { col: c.key, op: defaultOp(c.type), value: "" }]);
    setShowFilter(true);
  }, [columns]);
  const updateFilter = useCallback((i: number, patch: Partial<FilterRule>) => {
    setFilters((p) => p.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }, []);
  const removeFilter = useCallback((i: number) => setFilters((p) => p.filter((_, j) => j !== i)), []);

  // 撤销栈记账 + 单元格写入(本地乐观 + 服务端); record 清空重做栈. 定义须早于所有调用它的回调(避免 TDZ)
  const record = useCallback((op: UndoOp) => { undoStack.current.push(op); if (undoStack.current.length > 100) undoStack.current.shift(); redoStack.current = []; setHistTick((t) => t + 1); }, []);
  const writeCell = useCallback((rowId: string, key: string, v: unknown) => {
    setTable((prev) => (prev ? { ...prev, rows: prev.rows.map((x) => (x.id === rowId ? { ...x, cells: { ...x.cells, [key]: v } } : x)) } : prev));
    if (table) smartTableService.updateRow(ws, pid, table.id, rowId, { [key]: v }).catch(() => {});
  }, [table, ws, pid]);

  const addTextColumn = useCallback(async () => {
    if (!table) return;
    const name = zh ? `字段 ${columns.length + 1}` : `Field ${columns.length + 1}`;
    await smartTableService.addColumn(ws, pid, table.id, { name, type: "text" }).catch(() => errToast("加列失败", "列追加に失敗"));
    await openTable(table.id);
    await refreshList();
  }, [table, columns.length, ws, pid, zh, openTable, refreshList, errToast]);

  const addDerived = useCallback(async (key: string, label: string) => {
    setViewMenu(false);
    if (!table) return;
    await smartTableService.addDerivedColumn(ws, pid, table.id, key, label).catch(() => errToast("加派生列失败", "派生列の追加に失敗"));
    await openTable(table.id);
    await refreshList();
  }, [table, ws, pid, openTable, refreshList, errToast]);

  const changeColType = useCallback(async (cid: string, type: TSmartColumnType) => {
    if (!table) return;
    await smartTableService.updateColumn(ws, pid, table.id, cid, { type }).catch(() => {});
    setCtx(null);
    await openTable(table.id);
  }, [table, ws, pid, openTable]);

  const renameColumn = useCallback(async (cid: string, name: string) => {
    if (!table || !name.trim()) return;
    await smartTableService.updateColumn(ws, pid, table.id, cid, { name: name.trim() }).catch(() => {});
    setCtx(null);
    await openTable(table.id);
  }, [table, ws, pid, openTable]);

  const deleteColumn = useCallback(async (cid: string) => {
    if (!table) return;
    await smartTableService.deleteColumn(ws, pid, table.id, cid).catch(() => {});
    setCtx(null);
    await openTable(table.id);
    await refreshList();
  }, [table, ws, pid, openTable, refreshList]);

  const reorderColumns = useCallback(async (from: number, to: number) => {
    // glide 传来的是「可见列」下标; 隐藏列存在时换算到完整列序再持久化 position
    if (!table || from === to) return;
    const movedId = visibleColumns[from]?.id;
    const targetId = visibleColumns[to]?.id;
    if (!movedId || !targetId) return;
    const re = [...columns];
    const fi = re.findIndex((c) => c.id === movedId);
    const [m] = re.splice(fi, 1);
    const ti = re.findIndex((c) => c.id === targetId);
    re.splice(to > from ? ti + 1 : ti, 0, m);
    setTable((prev) => (prev ? { ...prev, columns: re } : prev));
    await Promise.all(re.map((c, i) => smartTableService.updateColumn(ws, pid, table.id, c.id, { position: i }).catch(() => {})));
  }, [table, columns, visibleColumns, ws, pid]);

  const sortRows = useCallback((key: string, dir: "asc" | "desc") => {
    setTable((prev) => {
      if (!prev) return prev;
      const sorted = [...prev.rows].sort((a, b) => {
        const as = a.cells[key] == null ? "" : String(a.cells[key]);
        const bs = b.cells[key] == null ? "" : String(b.cells[key]);
        const an = Number(as), bn = Number(bs);
        const cmp = !isNaN(an) && !isNaN(bn) && as !== "" && bs !== "" ? an - bn : as.localeCompare(bs);
        return dir === "asc" ? cmp : -cmp;
      });
      return { ...prev, rows: sorted };
    });
    setCtx(null);
  }, []);

  const clearCell = useCallback((colIdx: number, rowIdx: number) => {
    const c = visibleColumns[colIdx]; const r = displayRows[rowIdx];
    setCtx(null);
    if (!c || !r || !table || c.source !== "manual") return;
    record({ k: "cell", rowId: r.id, key: c.key, prev: r.cells?.[c.key] ?? null, next: null });
    writeCell(r.id, c.key, null);
  }, [visibleColumns, displayRows, table, record, writeCell]);

  const deleteRow = useCallback((rowIdx: number) => {
    const r = displayRows[rowIdx];
    setCtx(null);
    if (!r || !table) return;
    const idx = rows.findIndex((x) => x.id === r.id);
    record({ k: "del", row: { id: r.id, cells: { ...(r.cells ?? {}) } }, idx: idx < 0 ? rows.length : idx });
    setTable((prev) => (prev ? { ...prev, rows: prev.rows.filter((x) => x.id !== r.id) } : prev));
    smartTableService.deleteRow(ws, pid, table.id, r.id).catch(() => {});
  }, [displayRows, rows, table, ws, pid, record]);

  // ── 右键菜单扩展: 复制/筛选/插行/副本/来源卡/插列(全部挂在既有引擎上)──
  const cellText = useCallback((colIdx: number, rowIdx: number): string => {
    const v = displayRows[rowIdx]?.cells?.[visibleColumns[colIdx]?.key ?? ""];
    return v == null ? "" : Array.isArray(v) ? v.map(String).join(", ") : String(v);
  }, [visibleColumns, displayRows]);

  const copyCell = useCallback((colIdx: number, rowIdx: number) => {
    setCtx(null);
    void navigator.clipboard?.writeText(cellText(colIdx, rowIdx)).then(() => setToast({ type: TOAST_TYPE.SUCCESS, title: zh ? "已复制" : "コピーしました", message: "" })).catch(() => {});
  }, [cellText, zh]);

  const copyRow = useCallback((rowIdx: number) => {
    setCtx(null);
    const line = visibleColumns.map((_, i) => cellText(i, rowIdx)).join("\t");
    void navigator.clipboard?.writeText(line).then(() => setToast({ type: TOAST_TYPE.SUCCESS, title: zh ? "已复制整行" : "行をコピーしました", message: "" })).catch(() => {});
  }, [visibleColumns, cellText, zh]);

  const filterByCell = useCallback((colIdx: number, rowIdx: number) => {
    const c = visibleColumns[colIdx]; const r = displayRows[rowIdx];
    setCtx(null);
    if (!c || !r) return;
    const v = r.cells?.[c.key];
    let rule: FilterRule;
    if (c.type === "checkbox") rule = { col: c.key, op: v ? "checked" : "unchecked", value: "" };
    else if (c.type === "single_select") rule = { col: c.key, op: "is", value: v == null ? "" : String(v) };
    else if (c.type === "multi_select") rule = { col: c.key, op: "contains", value: Array.isArray(v) && v.length ? String(v[0]) : "" };
    else rule = { col: c.key, op: "eq", value: v == null ? "" : String(v) };
    setFilters((p) => [...p, rule]);
    setShowFilter(true);
  }, [visibleColumns, displayRows]);

  const insertRowAt = useCallback(async (anchorRowIdx: number, below: boolean, cells?: Record<string, unknown>) => {
    setCtx(null);
    if (!table) return;
    const anchor = displayRows[anchorRowIdx];
    const created = await smartTableService.addRow(ws, pid, table.id, cells ?? {}).catch(() => null);
    if (!created) { errToast("插入行失败", "行追加に失敗"); return; }
    record({ k: "add", rowId: created.id });
    const base = rows.filter((x) => x.id !== created.id);
    let at = anchor ? base.findIndex((x) => x.id === anchor.id) : base.length;
    if (at < 0) at = base.length; else if (below) at += 1;
    const order = [...base.slice(0, at), created, ...base.slice(at)];
    await Promise.all(order.map((x, i) => smartTableService.moveRow(ws, pid, table.id, x.id, i).catch(() => {})));
    await openTable(table.id);
    await refreshList();
  }, [table, displayRows, rows, ws, pid, openTable, refreshList, errToast, record]);

  const duplicateRow = useCallback((rowIdx: number) => {
    const r = displayRows[rowIdx];
    if (!r) { setCtx(null); return; }
    void insertRowAt(rowIdx, true, { ...(r.cells ?? {}) });
  }, [displayRows, insertRowAt]);

  const openSourceCard = useCallback((rowIdx: number) => {
    setCtx(null);
    const r = displayRows[rowIdx];
    if (!r?.source_issue) return;
    window.open(`/${ws}/projects/${r.source_issue_project || pid}/issues/${r.source_issue}`, "_blank");
  }, [displayRows, ws, pid]);

  const insertColumnAt = useCallback(async (anchorColIdx: number, right: boolean) => {
    setCtx(null);
    if (!table) return;
    const name = zh ? `字段 ${columns.length + 1}` : `Field ${columns.length + 1}`;
    const c = await smartTableService.addColumn(ws, pid, table.id, { name, type: "text" }).catch(() => null);
    if (!c) { errToast("加列失败", "列追加に失敗"); return; }
    // anchorColIdx 是可见列下标 → 折算到完整列序的落点(隐藏列存在时仍正确)
    const anchorId = visibleColumns[anchorColIdx]?.id;
    const base = columns.filter((x) => x.id !== c.id);
    const anchorAt = anchorId ? base.findIndex((x) => x.id === anchorId) : base.length - 1;
    const at = Math.min((anchorAt < 0 ? base.length - 1 : anchorAt) + (right ? 1 : 0), base.length);
    const order = [...base.slice(0, at), c, ...base.slice(at)];
    await Promise.all(order.map((x, i) => smartTableService.updateColumn(ws, pid, table.id, x.id, { position: i }).catch(() => {})));
    await openTable(table.id);
    await refreshList();
  }, [table, columns, visibleColumns, ws, pid, zh, openTable, refreshList, errToast]);

  const gridColumns: GridColumn[] = useMemo(
    () =>
      visibleColumns.map((c) => ({
        // 派生/投影列(只读)加 ↗ 前缀 + 灰头,和可编辑 manual 列一眼分清
        title: (() => { const nm = c.i18n?.[lang]?.name || c.name; return c.source === "manual" ? nm : `↗ ${nm}`; })(),
        id: c.id,
        icon: TYPE_HEADER_ICON[c.type],
        width: colW[c.id] ?? c.width ?? (c.type === "text" ? 220 : c.type === "single_select" || c.type === "multi_select" ? 160 : c.type === "date" || c.type === "checkbox" ? 116 : c.type === "image" ? 96 : 140),
        hasMenu: true,
        ...(c.source !== "manual"
          ? { themeOverride: { textHeader: dark ? "#7e8488" : "#9aa0a3", bgHeader: dark ? "#161718" : "#f5f6f6" } }
          : {}),
      })),
    [visibleColumns, colW, dark, lang]
  );

  const getCellContent = useCallback(
    ([colIdx, rowIdx]: Item): GridCell => {
      const c = visibleColumns[colIdx];
      if (!c) return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
      if (summaryOn && rowIdx === displayRows.length) {
        const agg = summaryAgg[c.key] ?? defaultAgg(c.type);
        const text = agg === "none" ? "" : `${aggName(agg, zh)} ${aggCompute(agg, c.type, displayRows.map((r) => r.cells?.[c.key]))}`.trim();
        return { kind: GridCellKind.Text, data: "", displayData: text, allowOverlay: false, contentAlign: NUMERIC_TYPES.includes(c.type) ? "right" : undefined };
      }
      const r = displayRows[rowIdx];
      return cellForColumn(c, r?.cells?.[c.key], dark, c.source === "manual", lang);
    },
    [visibleColumns, displayRows, dark, summaryOn, summaryAgg, zh, lang]
  );

  const onCellEdited = useCallback(
    (cell: Item, val: EditableGridCell) => {
      const [colIdx, rowIdx] = cell;
      const c = visibleColumns[colIdx];
      if (!c || c.source !== "manual" || !table) return;
      const { skip, value: v } = coerceEditedValue(val);
      if (skip) return;
      if (rowIdx >= displayRows.length) return; // 汇总行只读(新建走原生追加行 onRowAppended)
      const r = displayRows[rowIdx];
      if (!r) return;
      record({ k: "cell", rowId: r.id, key: c.key, prev: r.cells?.[c.key] ?? null, next: v });
      writeCell(r.id, c.key, v);
    },
    [visibleColumns, displayRows, table, record, writeCell]
  );

  // ── candidate-opt #7: 撤销 / 重做(单元格 + 行增删)──
  const applyOp = useCallback(async (op: UndoOp, dir: "undo" | "redo") => {
    if (!table) return;
    if (op.k === "cell") { writeCell(op.rowId, op.key, dir === "undo" ? op.prev : op.next); return; }
    // add: undo 删除 / redo 重加;  del: undo 重加 / redo 删除
    const shouldRemove = op.k === "add" ? dir === "undo" : dir === "redo";
    if (shouldRemove) {
      const id = op.k === "add" ? op.rowId : op.row.id;
      setTable((prev) => (prev ? { ...prev, rows: prev.rows.filter((x) => x.id !== id) } : prev));
      await smartTableService.deleteRow(ws, pid, table.id, id).catch(() => {});
    } else {
      const cells = op.k === "del" ? op.row.cells : {};
      const created = await smartTableService.addRow(ws, pid, table.id, cells).catch(() => null);
      if (created) {
        if (op.k === "del") { op.row.id = created.id; if (op.idx >= 0) await smartTableService.moveRow(ws, pid, table.id, created.id, op.idx).catch(() => {}); }
        else op.rowId = created.id;
        await openTable(table.id);
      }
    }
  }, [table, ws, pid, writeCell, openTable]);
  const doUndo = useCallback(() => {
    const op = undoStack.current.pop();
    if (!op) return;
    void applyOp(op, "undo");
    redoStack.current.push(op);
    setHistTick((t) => t + 1);
  }, [applyOp]);
  const doRedo = useCallback(() => {
    const op = redoStack.current.pop();
    if (!op) return;
    void applyOp(op, "redo");
    undoStack.current.push(op);
    setHistTick((t) => t + 1);
  }, [applyOp]);

  // ── candidate-opt #4: 列显隐(每用户视图持久化)──
  const toggleHidden = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < columns.length - 1) next.add(key); // 至少留一列
      return next;
    });
  }, [columns.length]);

  // ── candidate-opt #9: 重置视图(筛选/隐藏/缩放/冻结/着色/汇总/列宽全回默认)──
  const resetView = useCallback(() => {
    setFilters([]); setShowFilter(false); setSummaryOn(false); setSummaryAgg({});
    setColorByCol(null); setRowH(36); setFreezeN(1); setOnlyIncomplete(false);
    setHidden(new Set()); setZoom(1); setColW({}); setViewMenu(false);
  }, []);

  // ── candidate-opt #2: 导出 CSV(当前筛选/排序/可见列的所见即所得; BOM 兼容 Excel 日文)──
  const exportCsv = useCallback(() => {
    if (!table) return;
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const head = visibleColumns.map((c) => esc(trName(c)));
    const body = displayRows.map((_, ri) => visibleColumns.map((_, ci) => esc(cellText(ci, ri))).join(","));
    const csv = "﻿" + [head.join(","), ...body].join("\r\n"); // BOM → Excel 日文不乱码
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${trName(table)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [table, visibleColumns, displayRows, cellText, trName]);

  // ── candidate-opt #1: 列宽适应内容(画布量测表头+全部单元格显示文本, 取最大)──
  const autoFitColumn = useCallback((colIdx: number) => {
    const c = visibleColumns[colIdx];
    setCtx(null);
    if (!c || !table) return;
    const cv = document.createElement("canvas").getContext("2d");
    if (!cv) return;
    const fs = Math.round(13 * zoom);
    cv.font = `${fs}px ${(glideTheme.fontFamily as string) || "system-ui"}`;
    let max = cv.measureText(trName(c)).width + 52; // 表头文字 + 图标/菜单留白
    for (let ri = 0; ri < displayRows.length; ri++) max = Math.max(max, cv.measureText(cellText(colIdx, ri)).width + 28);
    const w = Math.min(520, Math.max(72, Math.round(max)));
    setColW((p) => ({ ...p, [c.id]: w }));
    smartTableService.updateColumn(ws, pid, table.id, c.id, { width: w }).catch(() => {});
  }, [visibleColumns, table, zoom, glideTheme, displayRows, cellText, trName, ws, pid]);

  // ── candidate-opt #5: 行多选批量操作 ──
  const selectedRowIds = useMemo(() => {
    const arr = gridSel?.rows?.toArray?.() ?? [];
    return arr.map((i) => displayRows[i]?.id).filter((x): x is string => !!x);
  }, [gridSel, displayRows]);
  const batchDelete = useCallback(() => {
    if (!table || selectedRowIds.length === 0) return;
    const ids = new Set(selectedRowIds);
    rows.forEach((r) => { if (ids.has(r.id)) { const idx = rows.findIndex((x) => x.id === r.id); record({ k: "del", row: { id: r.id, cells: { ...(r.cells ?? {}) } }, idx }); } });
    setTable((prev) => (prev ? { ...prev, rows: prev.rows.filter((x) => !ids.has(x.id)) } : prev));
    selectedRowIds.forEach((id) => smartTableService.deleteRow(ws, pid, table.id, id).catch(() => {}));
    setGridSel(undefined);
  }, [table, selectedRowIds, rows, ws, pid, record]);
  const batchFill = useCallback(() => {
    if (!table || !batchCol || selectedRowIds.length === 0) return;
    const c = columns.find((x) => x.key === batchCol);
    if (!c || c.source !== "manual") return;
    const v: unknown = c.type === "number" || c.type === "money" || c.type === "rating" || c.type === "progress" || c.type === "range" ? (batchVal === "" ? null : Number(batchVal)) : c.type === "checkbox" ? batchVal === "true" : c.type === "multi_select" ? (batchVal ? [batchVal] : []) : batchVal;
    const ids = new Set(selectedRowIds);
    rows.forEach((r) => { if (ids.has(r.id)) record({ k: "cell", rowId: r.id, key: c.key, prev: r.cells?.[c.key] ?? null, next: v }); });
    setTable((prev) => (prev ? { ...prev, rows: prev.rows.map((x) => (ids.has(x.id) ? { ...x, cells: { ...x.cells, [c.key]: v } } : x)) } : prev));
    selectedRowIds.forEach((id) => smartTableService.updateRow(ws, pid, table.id, id, { [c.key]: v }).catch(() => {}));
    setBatchPop(false); setBatchVal("");
  }, [table, batchCol, batchVal, selectedRowIds, columns, rows, ws, pid, record]);

  // candidate-opt #6: Cmd/Ctrl+滚轮 缩放(字号+行高); 普通滚轮交给 glide 不拦
  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setZoom((z) => Math.min(1.7, Math.max(0.8, Math.round((z + (e.deltaY < 0 ? 0.1 : -0.1)) * 100) / 100)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [view, table?.id]);

  // candidate-opt #7: Cmd/Ctrl+Z 撤销 · Cmd/Ctrl+Shift+Z / Ctrl+Y 重做; 输入/编辑态不拦
  useEffect(() => {
    if (view !== "data") return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); doRedo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, doUndo, doRedo]);

  // candidate-opt #3: 滚动位置记忆 — 换表/切 tab 回来还原到上次可视格
  useEffect(() => {
    if (view !== "data" || !table) return;
    const pos = scrollPos.current[table.id];
    if (!pos) return;
    const id = setTimeout(() => { try { gridRef.current?.scrollTo(pos.x, pos.y); } catch { /* grid 未就绪 */ } }, 80);
    return () => clearTimeout(id);
  }, [table?.id, view]);

  if (loading)
    return (
      <div className="flex h-full items-center justify-center bg-surface-1">
        <div className="size-5 animate-spin rounded-full border-2 border-subtle border-t-accent-primary" />
      </div>
    );

  const menuCol = ctx && ctx.kind === "header" ? columns[ctx.col] : null;
  const tabBtn = "rounded-sm px-3 py-1 text-12 font-medium";

  return (
    <div className="flex h-full bg-surface-1" onClick={() => { if (ctx) setCtx(null); if (viewMenu) setViewMenu(false); if (bpMenu) setBpMenu(false); if (listCtx) setListCtx(null); if (batchPop) setBatchPop(false); }}>
      {/* 左:表列表(可折叠) */}
      {sidebarCollapsed ? (
        <div className="flex w-9 shrink-0 flex-col items-center gap-2 border-r border-subtle bg-layer-1 py-3">
          <button type="button" onClick={() => setSidebarCollapsed(false)} title={T.title} className="flex size-7 items-center justify-center rounded-sm text-tertiary hover:bg-layer-1-hover hover:text-secondary">
            <PanelLeftOpen className="size-4" />
          </button>
          <div className="my-0.5 h-px w-5 bg-layer-2" />
          {/* 迷你表导航: 折叠态直接切表(首字 + tooltip 全名) */}
          <div className="vertical-scrollbar flex w-full flex-1 flex-col items-center gap-1 overflow-auto px-1">
            {tables.map((t) => (
              <button key={t.id} type="button" onClick={() => selectTable(t.id)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setListCtx({ x: e.clientX, y: e.clientY, t }); }} title={t.name} className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-12 font-medium", table?.id === t.id ? "bg-accent-subtle text-accent-primary" : "text-secondary hover:bg-layer-1-hover")}>
                {trName(t).trim()[0] || "?"}
              </button>
            ))}
          </div>
          <button type="button" onClick={createTable} title={T.newTable} className="flex size-7 shrink-0 items-center justify-center rounded-md text-accent-primary hover:bg-layer-1-hover">
            <Plus className="size-4" />
          </button>
        </div>
      ) : (
      <div className="flex w-56 shrink-0 flex-col border-r border-subtle bg-layer-1">
        <div className="flex items-center gap-1.5 border-b border-subtle px-4 py-3 text-13 font-medium text-secondary">
          <Database className="size-4 text-tertiary" />
          {T.title}
          <button type="button" onClick={() => setSidebarCollapsed(true)} title={zh ? "折叠面板" : "パネルを畳む"} className="ml-auto flex size-6 items-center justify-center rounded-sm text-tertiary hover:bg-layer-1-hover hover:text-secondary">
            <PanelLeftClose className="size-4" />
          </button>
        </div>
        <div className="vertical-scrollbar flex-1 overflow-auto p-2">
          {tables.map((t) => (
            <button key={t.id} type="button" onClick={() => selectTable(t.id)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setListCtx({ x: e.clientX, y: e.clientY, t }); }} className={cn("mb-0.5 block w-full rounded-sm px-2.5 py-1.5 text-left", table?.id === t.id ? "bg-layer-2 font-medium text-primary" : "text-secondary hover:bg-layer-1-hover")}>
              <div className="flex items-center gap-1">
                <span className="truncate text-13">{trName(t)}</span>
                {t.foreign && <Link2 className="size-3 shrink-0 text-placeholder" />}
                {!t.foreign && (t.shared_workspace || (t.shared_projects?.length ?? 0) > 0) && <Share2 className="size-3 shrink-0 text-accent-primary" />}
              </div>
              <div className="mt-0.5 text-11 text-placeholder">{T.rows(t.row_count)} · {T.cols(t.column_count)}</div>
            </button>
          ))}
        </div>
        <button type="button" onClick={createTable} className="flex items-center gap-1.5 border-t border-subtle px-4 py-2.5 text-13 font-medium text-accent-primary hover:bg-layer-1-hover">
          <Plus className="size-4" />
          {T.newTable}
        </button>
      </div>
      )}

      {/* 表列表 右键菜单 */}
      {listCtx && (
        <div className="fixed z-40 w-48 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1 shadow-overlay-200" style={clampMenu(listCtx.x, listCtx.y, 192, 240)} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { selectTable(listCtx.t.id); setListCtx(null); }} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Database className="size-3.5 text-tertiary" /> {zh ? "打开" : "開く"}</button>
          <button type="button" onClick={() => { setListCtx(null); setRenameVal(listCtx.t.name); setRenaming(true); if (table?.id !== listCtx.t.id) selectTable(listCtx.t.id); }} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Pencil className="size-3.5 text-tertiary" /> {T.rename}</button>
          <button type="button" onClick={() => { setListCtx(null); if (table?.id !== listCtx.t.id) void openTable(listCtx.t.id); setView("fields"); }} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><SlidersHorizontal className="size-3.5 text-tertiary" /> {zh ? "字段设置" : "フィールド設定"}</button>
          {!listCtx.t.foreign ? (
            <>
              <div className="my-1 border-t border-subtle" />
              <button type="button" onClick={() => openShareFor({ id: listCtx.t.id, name: listCtx.t.name, ws: !!listCtx.t.shared_workspace, pids: listCtx.t.shared_projects ?? [], foreign: false })} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Share2 className="size-3.5 text-tertiary" /> {zh ? "共享…" : "共有…"}</button>
              <div className="my-1 border-t border-subtle" />
              <button type="button" onClick={() => void askDeleteTableFor({ id: listCtx.t.id, name: listCtx.t.name, foreign: false })} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-danger-primary hover:bg-danger-subtle"><Trash2 className="size-3.5" /> {zh ? "删除表…" : "テーブル削除…"}</button>
            </>
          ) : (
            <div className="px-2 py-1 text-10 text-placeholder">{T.foreign}</div>
          )}
        </div>
      )}

      {/* 右(可全屏) */}
      <div className={cn("flex min-w-0 flex-1 flex-col", maximized && "fixed inset-0 z-[60] bg-surface-1")}>
        {!table ? (
          <div className="m-auto max-w-xs px-6 text-center">
            <Database className="mx-auto size-9 text-placeholder" />
            <div className="mt-3 text-14 font-medium text-secondary">{T.empty}</div>
            <div className="mt-1.5 text-12 leading-relaxed text-placeholder">{zh ? "把项目数据收进可编辑的表格;卡片完成可自动入表。" : "プロジェクトのデータを編集可能な表に集約。カード完了で自動登録。"}</div>
            <button type="button" onClick={createTable} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:bg-accent-primary-hover">
              <Plus className="size-4" />
              {T.newTable}
            </button>
          </div>
        ) : (
          <>
            <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b border-subtle bg-layer-1 px-page-x py-1">
              {renaming ? (
                <input autoFocus value={renameVal} onChange={(e: ChangeEvent<HTMLInputElement>) => setRenameVal(e.target.value)} onBlur={commitRename} onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(false); }} className="rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1 text-13 font-medium text-primary outline-none" />
              ) : (
                <button type="button" onClick={() => { setRenameVal(table.name); setRenaming(true); }} className="group flex shrink-0 items-center gap-1.5 text-13 font-medium text-primary" title={T.rename}>
                  {trName(table)}
                  <Pencil className="size-3 text-placeholder opacity-0 group-hover:opacity-100" />
                </button>
              )}
              <div className="flex items-center gap-0.5 rounded-md bg-layer-2 p-0.5">
                <button type="button" onClick={() => selectTable(table.id)} className={cn(tabBtn, view === "data" ? "bg-surface-1 text-primary shadow-raised-100" : "text-secondary hover:text-primary")}>{T.tabData}</button>
                <button type="button" onClick={() => setView("form")} className={cn(tabBtn, view === "form" ? "bg-surface-1 text-primary shadow-raised-100" : "text-secondary hover:text-primary")}>{T.tabForm}</button>
                <button type="button" onClick={() => setView("fields")} className={cn(tabBtn, view === "fields" ? "bg-surface-1 text-primary shadow-raised-100" : "text-secondary hover:text-primary")}>{T.tabFields}</button>
                <button type="button" onClick={() => setView("blueprint")} className={cn(tabBtn, view === "blueprint" ? "bg-surface-1 text-primary shadow-raised-100" : "text-secondary hover:text-primary")}>{zh ? "蓝图" : "ブループリント"}</button>
                <button type="button" onClick={() => setView("i18n")} className={cn(tabBtn, view === "i18n" ? "bg-surface-1 text-primary shadow-raised-100" : "text-secondary hover:text-primary")}>{zh ? "翻译" : "翻訳"}</button>
              </div>
              {table.foreign ? (
                <span className="flex items-center gap-1 rounded-sm bg-layer-2 px-2 py-1 text-11 text-tertiary" title={T.foreign}><Link2 className="size-3" /> {zh ? "引用" : "参照"}</span>
              ) : (
                <button type="button" onClick={openShare} title={T.share} className={cn("flex items-center gap-1 rounded-sm px-2 py-1 text-11", table.shared_workspace || (table.shared_projects?.length ?? 0) > 0 ? "bg-accent-subtle text-accent-primary" : "text-tertiary hover:bg-layer-1-hover")}>
                  <Share2 className="size-3.5" />
                  {table.shared_workspace
                    ? (zh ? "已共享·全部" : "共有·全体")
                    : (table.shared_projects?.length ?? 0) > 0
                      ? (zh ? `已共享·${table.shared_projects?.length}项目` : `共有·${table.shared_projects?.length}PJ`)
                      : (zh ? "共享" : "共有")}
                </button>
              )}
              {!table.foreign && (
                <button type="button" onClick={() => void askDeleteTable()} title={zh ? "删除表(先盘点依赖)" : "テーブル削除"} className="flex size-7 items-center justify-center rounded-sm text-tertiary hover:bg-danger-subtle hover:text-danger-primary">
                  <Trash2 className="size-4" />
                </button>
              )}
              {blueprints.length > 0 && (
                <div className="relative">
                  <button type="button" onClick={(e) => { e.stopPropagation(); setBpMenu((s) => !s); setBpSel(null); }} title={zh ? "按业务蓝图创建(卡+行+表单一键就位)" : "ブループリントから作成"} className={cn("flex h-7 items-center gap-1 rounded-sm px-1.5", bpMenu ? "bg-accent-subtle text-accent-primary" : "text-tertiary hover:bg-layer-1-hover")}>
                    <LayoutTemplate className="size-4" />
                    <span className="text-11 font-medium">{zh ? "发起流程" : "フロー発起"}</span>
                  </button>
                  {bpMenu && (
                    <div className="absolute left-0 top-8 z-30 w-64 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1.5 shadow-overlay-200" onClick={(e) => e.stopPropagation()}>
                      {!bpSel ? (
                        <>
                          <div className="px-2 py-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{zh ? "选择业务蓝图" : "ブループリント選択"}</div>
                          {blueprints.map((bp) => (
                            <button key={bp.id} type="button" onClick={() => { setBpSel(bp); setBpTitle(""); setBpCustomer(""); }} className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-13 text-secondary hover:bg-layer-transparent-hover">
                              <span className="truncate">{bp.title}</span>
                              <span className="shrink-0 text-10 text-placeholder">v{bp.latest_version}</span>
                            </button>
                          ))}
                        </>
                      ) : (
                        <div className="space-y-1.5 p-1">
                          <div className="flex items-center gap-1.5 text-12 font-medium text-primary"><LayoutTemplate className="size-3.5 text-tertiary" /> {bpSel.title} <span className="text-10 text-placeholder">v{bpSel.latest_version}</span></div>
                          <input autoFocus value={bpTitle} onChange={(e: ChangeEvent<HTMLInputElement>) => setBpTitle(e.target.value)} onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && bpTitle.trim() && !bpBusy) void instantiateBp(); }} placeholder={zh ? "标题(必填)" : "タイトル(必須)"} className="w-full rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1.5 text-13 text-primary outline-none placeholder:text-placeholder" />
                          <input value={bpCustomer} onChange={(e: ChangeEvent<HTMLInputElement>) => setBpCustomer(e.target.value)} placeholder={zh ? "客户(可选)" : "顧客(任意)"} className="w-full rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1.5 text-13 text-primary outline-none placeholder:text-placeholder" />
                          <div className="flex items-center gap-1.5 pt-0.5">
                            <button type="button" disabled={!bpTitle.trim() || bpBusy} onClick={() => void instantiateBp()} className="rounded-md bg-accent-primary px-3 py-1.5 text-12 font-medium text-white hover:bg-accent-primary-hover disabled:opacity-50">{bpBusy ? (zh ? "创建中…" : "作成中…") : (zh ? "创建" : "作成")}</button>
                            <button type="button" onClick={() => setBpSel(null)} className="rounded-md px-2 py-1.5 text-12 text-secondary hover:bg-layer-1-hover">{zh ? "返回" : "戻る"}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {view === "data" && columns.length > 0 && (
                <button type="button" onClick={() => setShowSearch((s) => !s)} title={`${T.search} (Ctrl+F)`} className={cn("flex size-7 items-center justify-center rounded-sm", showSearch ? "bg-accent-subtle text-accent-primary" : "text-tertiary hover:bg-layer-1-hover")}>
                  <Search className="size-4" />
                </button>
              )}
              {view === "data" && columns.length > 0 && (
                <button type="button" onClick={() => setShowFilter((s) => !s)} title={zh ? "筛选" : "フィルタ"} className={cn("flex h-7 items-center gap-1 rounded-sm px-1.5", showFilter || filters.length ? "bg-accent-subtle text-accent-primary" : "text-tertiary hover:bg-layer-1-hover")}>
                  <Filter className="size-4" />
                  {filters.length > 0 && <span className="text-11 font-medium">{filters.length}</span>}
                </button>
              )}
              {view === "data" && columns.length > 0 && (
                <div className="relative">
                  <button type="button" onClick={(e) => { e.stopPropagation(); setViewMenu((s) => !s); }} title={zh ? "视图选项(汇总/着色/派生列)" : "ビュー設定"} className={cn("flex size-7 items-center justify-center rounded-sm", viewMenu || summaryOn || colorByCol ? "bg-accent-subtle text-accent-primary" : "text-tertiary hover:bg-layer-1-hover")}>
                    <SlidersHorizontal className="size-4" />
                  </button>
                  {viewMenu && (
                    <div className="absolute left-0 top-8 z-30 max-h-96 w-60 overflow-auto rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1.5 shadow-overlay-200" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => setSummaryOn((s) => !s)} className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover">
                        <span className="flex items-center gap-2"><Sigma className="size-3.5 text-tertiary" /> {T.summary}</span>
                        <span className={cn("text-11", summaryOn ? "text-accent-primary" : "text-placeholder")}>{summaryOn ? (zh ? "开" : "ON") : (zh ? "关" : "OFF")}</span>
                      </button>
                      <div className="mt-1 px-2 pb-0.5 pt-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{zh ? "行高" : "行の高さ"}</div>
                      <div className="flex gap-1 px-1 pb-1">
                        {([["紧凑", "コンパクト", 32], ["默认", "標準", 36], ["宽松", "広め", 44]] as const).map(([z, j, h]) => (
                          <button key={h} type="button" onClick={() => setRowH(h)} className={cn("flex-1 rounded-sm border px-2 py-0.5 text-11", rowH === h ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle text-tertiary hover:bg-layer-1-hover")}>{zh ? z : j}</button>
                        ))}
                      </div>
                      {columns.some((c) => c.type === "single_select" || c.type === "multi_select") && (
                        <>
                          <div className="mt-1 px-2 pb-0.5 pt-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{zh ? "行着色依据" : "行の色分け"}</div>
                          <div className="flex flex-wrap gap-1 px-1 pb-1">
                            <button type="button" onClick={() => setColorByCol(null)} className={cn("rounded-sm border px-2 py-0.5 text-11", !colorByCol ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle text-tertiary hover:bg-layer-1-hover")}>{zh ? "无" : "なし"}</button>
                            {columns.filter((c) => c.type === "single_select" || c.type === "multi_select").map((c) => (
                              <button key={c.key} type="button" onClick={() => setColorByCol(c.key)} className={cn("max-w-28 truncate rounded-sm border px-2 py-0.5 text-11", colorByCol === c.key ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle text-tertiary hover:bg-layer-1-hover")}>{trName(c)}</button>
                            ))}
                          </div>
                        </>
                      )}
                      {columns.length > 0 && (
                        <>
                          <div className="mt-1 flex items-center justify-between px-2 pb-0.5 pt-1">
                            <span className="text-10 font-semibold uppercase tracking-wide text-placeholder">{zh ? "列显隐" : "列の表示"}</span>
                            {hidden.size > 0 && <button type="button" onClick={() => setHidden(new Set())} className="text-10 text-accent-primary hover:underline">{zh ? "全部显示" : "全表示"}</button>}
                          </div>
                          <div className="max-h-40 overflow-auto px-1 pb-1">
                            {columns.map((c) => {
                              const on = !hidden.has(c.key);
                              return (
                                <button key={c.key} type="button" onClick={() => toggleHidden(c.key)} className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-12 text-secondary hover:bg-layer-transparent-hover">
                                  {on ? <Eye className="size-3.5 shrink-0 text-tertiary" /> : <EyeOff className="size-3.5 shrink-0 text-placeholder" />}
                                  <span className={cn("truncate", !on && "text-placeholder line-through")}>{trName(c)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                      <div className="mt-1 px-2 pb-0.5 pt-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{zh ? "添加派生列 · 只读投影" : "派生列を追加 · 読取専用"}</div>
                      {DERIVERS.map((dv) => (
                        <button key={dv.key} type="button" onClick={() => addDerived(dv.key, zh ? dv.zh : dv.ja)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-13 text-secondary hover:bg-layer-transparent-hover">
                          <Sparkles className="size-3.5 shrink-0 text-tertiary" /> {zh ? dv.zh : dv.ja}
                        </button>
                      ))}
                      <div className="my-1 border-t border-subtle" />
                      <button type="button" onClick={resetView} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-13 text-secondary hover:bg-layer-transparent-hover">
                        <RotateCcw className="size-3.5 shrink-0 text-tertiary" /> {zh ? "重置视图" : "ビューをリセット"}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {view === "data" && columns.length > 0 && (
                <>
                  <button type="button" onClick={doUndo} disabled={undoStack.current.length === 0} title={zh ? "撤销 (Ctrl+Z)" : "元に戻す (Ctrl+Z)"} className="flex size-7 items-center justify-center rounded-sm text-tertiary hover:bg-layer-1-hover disabled:opacity-30 disabled:hover:bg-transparent">
                    <Undo2 className="size-4" />
                  </button>
                  <button type="button" onClick={doRedo} disabled={redoStack.current.length === 0} title={zh ? "重做 (Ctrl+Shift+Z)" : "やり直し (Ctrl+Shift+Z)"} className="flex size-7 items-center justify-center rounded-sm text-tertiary hover:bg-layer-1-hover disabled:opacity-30 disabled:hover:bg-transparent">
                    <Redo2 className="size-4" />
                  </button>
                  <button type="button" onClick={exportCsv} title={zh ? "导出 CSV(当前视图)" : "CSV 出力(現在のビュー)"} className="flex size-7 items-center justify-center rounded-sm text-tertiary hover:bg-layer-1-hover hover:text-secondary">
                    <Download className="size-4" />
                  </button>
                </>
              )}
              {view === "data" && rows.some((r) => r.incomplete) && (
                <button type="button" onClick={() => setOnlyIncomplete((s) => !s)} title={T.incomplete} className={cn("flex h-7 items-center gap-1 rounded-sm px-1.5", onlyIncomplete ? "" : "text-tertiary hover:bg-layer-1-hover")} style={onlyIncomplete ? { background: dark ? "#3a2f1280" : "#fef3c7", color: dark ? "#fbbf24" : "#b45309" } : undefined}>
                  <AlertTriangle className="size-4" />
                  <span className="text-11 font-medium">{rows.filter((r) => r.incomplete).length}</span>
                </button>
              )}
              <span className="ml-auto text-11 text-placeholder">{T.rows(displayRows.length)}{filters.length || onlyIncomplete ? ` / ${rows.length}` : ""} · {T.cols(columns.length)}</span>
              <button type="button" onClick={() => setMaximized((m) => !m)} title={maximized ? (zh ? "退出全屏 (Esc)" : "全画面解除 (Esc)") : (zh ? "全屏" : "全画面")} className={cn("flex size-7 shrink-0 items-center justify-center rounded-sm", maximized ? "bg-accent-subtle text-accent-primary" : "text-tertiary hover:bg-layer-1-hover")}>
                {maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
            </div>

            {view === "data" && columns.length > 0 && (showFilter || filters.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-subtle bg-layer-1 px-page-x py-1.5">
                <Filter className="size-3.5 shrink-0 text-tertiary" />
                {filters.map((f, i) => {
                  const c = columns.find((x) => x.key === f.col);
                  const ops = c ? opsForType(c.type) : [];
                  return (
                    <div key={i} className="flex items-center gap-0.5 rounded-md border border-subtle bg-surface-1 py-0.5 pl-1.5 pr-0.5 text-12">
                      <select value={f.col} onChange={(e) => { const nc = columns.find((x) => x.key === e.target.value); updateFilter(i, { col: e.target.value, op: nc ? defaultOp(nc.type) : f.op, value: "" }); }} className="max-w-24 truncate bg-transparent text-primary outline-none">
                        {columns.map((c2) => (<option key={c2.key} value={c2.key}>{trName(c2)}</option>))}
                      </select>
                      <select value={f.op} onChange={(e) => updateFilter(i, { op: e.target.value as FilterOp })} className="bg-transparent text-secondary outline-none">
                        {ops.map((o) => (<option key={o} value={o}>{opLabel(o, zh)}</option>))}
                      </select>
                      {opNeedsValue(f.op) && c && ((c.type === "single_select" || c.type === "multi_select") ? (
                        <select value={f.value} onChange={(e) => updateFilter(i, { value: e.target.value })} className="max-w-28 bg-transparent text-primary outline-none">
                          <option value="">—</option>
                          {c.options.map((o) => (<option key={o.v} value={o.v}>{o.v}</option>))}
                        </select>
                      ) : (
                        <input value={f.value} onChange={(e: ChangeEvent<HTMLInputElement>) => updateFilter(i, { value: e.target.value })} type={NUMERIC_TYPES.includes(c.type) ? "number" : "text"} placeholder={zh ? "值" : "値"} className="w-20 bg-transparent text-primary outline-none placeholder:text-placeholder" />
                      ))}
                      <button type="button" onClick={() => removeFilter(i)} className="flex size-5 items-center justify-center rounded-sm text-tertiary hover:bg-layer-1-hover hover:text-danger-primary"><X className="size-3" /></button>
                    </div>
                  );
                })}
                <button type="button" onClick={addFilter} className="flex items-center gap-1 rounded-md border border-dashed border-subtle px-2 py-1 text-12 text-tertiary hover:bg-layer-1-hover hover:text-secondary"><Plus className="size-3" /> {zh ? "添加条件" : "条件追加"}</button>
                {filters.length > 0 && (<button type="button" onClick={() => setFilters([])} className="ml-1 text-11 text-tertiary hover:text-danger-primary">{zh ? "清除全部" : "全クリア"}</button>)}
              </div>
            )}

            {view === "fields" ? (
              <SmartTableFields ws={ws} pid={pid} table={table} focusColumnId={fieldsFocus} />
            ) : view === "form" ? (
              <SmartTableForms ws={ws} pid={pid} table={table} />
            ) : view === "blueprint" ? (
              <SmartTableBlueprints ws={ws} pid={pid} />
            ) : view === "i18n" ? (
              <SmartTableI18n ws={ws} pid={pid} table={table} onChanged={() => void openTable(table.id)} />
            ) : (
              <div className="relative min-h-0 flex-1 p-page-x">
                {columns.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                    <Database className="size-8 text-placeholder" />
                    <div className="text-14 font-medium text-secondary">{zh ? "空表" : "空のテーブル"}</div>
                    <div className="max-w-xs text-12 leading-relaxed text-placeholder">{T.noCols}</div>
                    <button type="button" onClick={addTextColumn} className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:bg-accent-primary-hover">
                      <Plus className="size-4" /> {T.addCol}
                    </button>
                  </div>
                ) : (
                  <div ref={gridWrapRef} className="smart-glide-scroll h-full overflow-hidden rounded-md border border-subtle">
                    <DataEditor
                      ref={gridRef}
                      columns={gridColumns}
                      rows={summaryOn ? displayRows.length + 1 : displayRows.length}
                      getCellContent={getCellContent}
                      onCellEdited={onCellEdited}
                      customRenderers={CUSTOM_RENDERERS}
                      imageEditorOverride={imageEditor}
                      theme={themed}
                      headerHeight={Math.round(36 * Math.min(1.3, zoom))}
                      rowHeight={effRowH}
                      rowMarkers="both"
                      columnSelect="none"
                      rowSelect="multi"
                      gridSelection={gridSel}
                      onGridSelectionChange={setGridSel}
                      onVisibleRegionChanged={(r) => { if (table) scrollPos.current[table.id] = { x: r.x, y: r.y }; }}
                      freezeColumns={freezeN}
                      freezeTrailingRows={summaryOn ? 1 : 0}
                      getRowThemeOverride={(row) => {
                        if (summaryOn && row === displayRows.length) return { bgCell: dark ? "#1e2021" : "#f3f4f4", bgCellMedium: dark ? "#1e2021" : "#f3f4f4", textDark: dark ? "#cacdce" : "#4e5355", textMedium: dark ? "#cacdce" : "#4e5355" };
                        if (displayRows[row]?.incomplete) return { bgCell: dark ? "#3a2f12" : "#fff8e6", bgCellMedium: dark ? "#3a2f12" : "#fff8e6" };
                        if (colorByCol) {
                          const cc = columns.find((x) => x.key === colorByCol);
                          const rr = displayRows[row];
                          if (cc && rr) {
                            const val = rr.cells?.[colorByCol];
                            const first = Array.isArray(val) ? val[0] : val;
                            const opt = cc.options.find((o) => o.v === String(first ?? ""));
                            if (opt?.color) return { bgCell: opt.color + (dark ? "26" : "1c"), bgCellMedium: opt.color + (dark ? "26" : "1c") };
                          }
                        }
                        return row % 2 === 1 ? { bgCell: dark ? "#181a1b" : "#fafafa", bgCellMedium: dark ? "#181a1b" : "#fafafa" } : undefined;
                      }}
                      smoothScrollX
                      smoothScrollY
                      width="100%"
                      height="100%"
                      getCellsForSelection
                      fillHandle
                      onPaste
                      onDelete={() => true}
                      onColumnResize={(col, newSize) => setColW((p) => ({ ...p, [col.id ?? ""]: newSize }))}
                      onColumnResizeEnd={(col, newSize) => { if (col.id) smartTableService.updateColumn(ws, pid, table.id, col.id, { width: Math.round(newSize) }).catch(() => {}); }}
                      onColumnMoved={(from, to) => void reorderColumns(from, to)}
                      onRowAppended={async () => {
                        if (!table) return undefined;
                        const at = displayRows.length; // 新行落点(未过滤时追加在尾)
                        const r = await smartTableService.addRow(ws, pid, table.id, {}).catch(() => null);
                        if (!r) { errToast("新建行失败", "行作成に失敗"); return undefined; }
                        record({ k: "add", rowId: r.id });
                        await openTable(table.id);
                        await refreshList();
                        return filters.length || onlyIncomplete ? undefined : at;
                      }}
                      trailingRowOptions={{ tint: true, sticky: false, hint: zh ? "新建行" : "新規行" }}
                      onRowMoved={(from, to) => {
                        if (from >= rows.length || to >= rows.length || !table || filters.length) return;
                        const re = [...rows];
                        const [m] = re.splice(from, 1);
                        re.splice(to, 0, m);
                        setTable((prev) => (prev ? { ...prev, rows: re } : prev));
                        re.forEach((r, i) => smartTableService.moveRow(ws, pid, table.id, r.id, i).catch(() => {}));
                      }}
                      showSearch={showSearch}
                      onSearchClose={() => setShowSearch(false)}
                      onHeaderMenuClick={(col, bounds) => { setEditName(columns[col]?.name ?? ""); setCtx({ kind: "header", col, row: -1, x: bounds.x, y: bounds.y + bounds.height }); }}
                      onHeaderContextMenu={(col, e) => { e.preventDefault(); setEditName(columns[col]?.name ?? ""); setCtx({ kind: "header", col, row: -1, x: e.bounds.x + (e.localEventX ?? 0), y: e.bounds.y + (e.localEventY ?? 0) }); }}
                      onCellContextMenu={(cell, e) => { e.preventDefault(); setCtx({ kind: "cell", col: cell[0], row: cell[1], x: e.bounds.x + (e.localEventX ?? 0), y: e.bounds.y + (e.localEventY ?? 0) }); }}
                      rightElement={
                        <div className="flex h-full items-center border-l border-subtle bg-layer-1 px-2">
                          <button type="button" onClick={addTextColumn} title={T.addCol} className="flex size-7 items-center justify-center rounded-sm text-tertiary hover:bg-layer-1-hover hover:text-secondary">
                            <Plus className="size-4" />
                          </button>
                        </div>
                      }
                      rightElementProps={{ fill: false, sticky: false }}
                    />
                  </div>
                )}

                {/* candidate-opt #8: 跳到首/末行(行多时浮于右下) */}
                {columns.length > 0 && displayRows.length > 24 && selectedRowIds.length === 0 && (
                  <div className="absolute bottom-6 right-7 z-10 flex flex-col gap-1">
                    <button type="button" onClick={() => { try { gridRef.current?.scrollTo(0, 0); } catch { /* noop */ } }} title={zh ? "回到顶部" : "先頭へ"} className="flex size-7 items-center justify-center rounded-md border-[0.5px] border-subtle-1 bg-surface-1 text-tertiary shadow-overlay-200 hover:text-secondary"><ChevronsUp className="size-4" /></button>
                    <button type="button" onClick={() => { try { gridRef.current?.scrollTo(0, Math.max(0, displayRows.length - 1)); } catch { /* noop */ } }} title={zh ? "到底部" : "末尾へ"} className="flex size-7 items-center justify-center rounded-md border-[0.5px] border-subtle-1 bg-surface-1 text-tertiary shadow-overlay-200 hover:text-secondary"><ChevronsDown className="size-4" /></button>
                  </div>
                )}

                {/* candidate-opt #5: 行多选批量操作条 */}
                {columns.length > 0 && selectedRowIds.length > 0 && (
                  <div className="absolute bottom-5 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-lg border-[0.5px] border-subtle-1 bg-surface-1 px-2.5 py-1.5 shadow-overlay-300">
                    <span className="px-1 text-12 font-medium text-primary">{zh ? `选中 ${selectedRowIds.length} 行` : `${selectedRowIds.length} 行選択`}</span>
                    <div className="relative">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setBatchPop((s) => !s); setBatchCol(columns.find((c) => c.source === "manual")?.key ?? ""); }} className="flex items-center gap-1 rounded-md px-2 py-1 text-12 text-secondary hover:bg-layer-1-hover"><Pencil className="size-3.5 text-tertiary" /> {zh ? "批量填充…" : "一括入力…"}</button>
                      {batchPop && (
                        <div className="absolute bottom-9 left-0 z-30 w-60 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-2 shadow-overlay-200" onClick={(e) => e.stopPropagation()}>
                          <div className="mb-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{zh ? "把所选行的某列设为" : "選択行の列を一括設定"}</div>
                          <select value={batchCol} onChange={(e) => setBatchCol(e.target.value)} className="mb-1.5 w-full rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1.5 text-12 text-primary outline-none">
                            {columns.filter((c) => c.source === "manual").map((c) => (<option key={c.key} value={c.key}>{trName(c)}</option>))}
                          </select>
                          {(() => {
                            const c = columns.find((x) => x.key === batchCol);
                            if (c && (c.type === "single_select" || c.type === "multi_select")) return (
                              <select value={batchVal} onChange={(e) => setBatchVal(e.target.value)} className="mb-1.5 w-full rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1.5 text-12 text-primary outline-none"><option value="">—</option>{c.options.map((o) => (<option key={o.v} value={o.v}>{o.v}</option>))}</select>
                            );
                            if (c && c.type === "checkbox") return (
                              <select value={batchVal} onChange={(e) => setBatchVal(e.target.value)} className="mb-1.5 w-full rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1.5 text-12 text-primary outline-none"><option value="false">{zh ? "未勾选" : "オフ"}</option><option value="true">{zh ? "已勾选" : "オン"}</option></select>
                            );
                            return <input value={batchVal} onChange={(e) => setBatchVal(e.target.value)} type={c && NUMERIC_TYPES.includes(c.type) ? "number" : "text"} placeholder={zh ? "值(空=清空)" : "値(空=クリア)"} className="mb-1.5 w-full rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1.5 text-12 text-primary outline-none placeholder:text-placeholder" />;
                          })()}
                          <button type="button" onClick={batchFill} className="w-full rounded-md bg-accent-primary px-2 py-1.5 text-12 font-medium text-white hover:bg-accent-primary-hover">{zh ? "应用到所选行" : "選択行に適用"}</button>
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={batchDelete} className="flex items-center gap-1 rounded-md px-2 py-1 text-12 text-danger-primary hover:bg-danger-subtle"><Trash2 className="size-3.5" /> {zh ? "删除" : "削除"}</button>
                    <button type="button" onClick={() => setGridSel(undefined)} className="flex size-6 items-center justify-center rounded-md text-tertiary hover:bg-layer-1-hover" title={zh ? "取消选择" : "選択解除"}><X className="size-3.5" /></button>
                  </div>
                )}

                {/* 右键 / 列头 菜单 */}
                {ctx && (
                  <div className="fixed z-30 max-h-[85vh] w-52 overflow-auto rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1.5 shadow-overlay-200" style={clampMenu(ctx.x, ctx.y, 208, ctx.kind === "header" ? 440 : 320)} onClick={(e) => e.stopPropagation()}>
                    {ctx.kind === "header" && menuCol ? (
                      <>
                        <input autoFocus value={editName} onChange={(e: ChangeEvent<HTMLInputElement>) => setEditName(e.target.value)} onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && renameColumn(menuCol.id, editName)} onBlur={() => renameColumn(menuCol.id, editName)} className="mb-1.5 w-full rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1.5 text-13 text-primary outline-none" />
                        {menuCol.source === "manual" ? (
                          <>
                            <div className="mb-1 px-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{T.changeType}</div>
                            <div className="mb-1.5 grid grid-cols-3 gap-1">
                              {TYPE_META.map(({ v, zh: z, ja, Icon }) => (
                                <button key={v} type="button" onClick={() => changeColType(menuCol.id, v)} className={cn("flex flex-col items-center gap-1 rounded-sm border px-1 py-1.5 text-10", menuCol.type === v ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle text-tertiary hover:bg-layer-1-hover")}>
                                  <Icon className="size-3.5" />
                                  {zh ? z : ja}
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="mb-1.5 flex items-center gap-1.5 rounded-sm bg-layer-2 px-2 py-1.5 text-11 text-tertiary"><Sparkles className="size-3.5 shrink-0" /> {zh ? "派生列 · 只读投影" : "派生列 · 読取専用"}</div>
                        )}
                        <button type="button" onClick={() => sortRows(menuCol.key, "asc")} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><ArrowUp className="size-3.5 text-tertiary" /> {T.sortAsc}</button>
                        <button type="button" onClick={() => sortRows(menuCol.key, "desc")} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><ArrowDown className="size-3.5 text-tertiary" /> {T.sortDesc}</button>
                        <div className="mb-1 mt-1.5 px-1 text-10 font-semibold uppercase tracking-wide text-placeholder">{T.summary}</div>
                        <div className="mb-1.5 flex flex-wrap gap-1 px-1">
                          {(NUMERIC_TYPES.includes(menuCol.type) ? (["sum", "avg", "max", "min", "count", "none"] as Agg[]) : (["count", "empty", "none"] as Agg[])).map((a) => {
                            const cur = summaryAgg[menuCol.key] ?? defaultAgg(menuCol.type);
                            return (
                              <button key={a} type="button" onClick={() => { setSummaryAgg((p) => ({ ...p, [menuCol.key]: a })); setSummaryOn(true); setCtx(null); }} className={cn("rounded-sm border px-2 py-1 text-11", cur === a ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle text-tertiary hover:bg-layer-1-hover")}>
                                {a === "none" ? (zh ? "无" : "なし") : aggName(a, zh)}
                              </button>
                            );
                          })}
                        </div>
                        <div className="my-1 border-t border-subtle" />
                        <button type="button" onClick={() => void insertColumnAt(ctx.col, false)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Plus className="size-3.5 text-tertiary" /> {zh ? "左侧插入列" : "左に列を挿入"}</button>
                        <button type="button" onClick={() => void insertColumnAt(ctx.col, true)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Plus className="size-3.5 text-tertiary" /> {zh ? "右侧插入列" : "右に列を挿入"}</button>
                        <button type="button" onClick={() => autoFitColumn(ctx.col)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><MoveHorizontal className="size-3.5 text-tertiary" /> {zh ? "宽度适应内容" : "幅を内容に合わせる"}</button>
                        <button type="button" onClick={() => { setFreezeN(freezeN === ctx.col + 1 ? 1 : ctx.col + 1); setCtx(null); }} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Snowflake className="size-3.5 text-tertiary" /> {freezeN === ctx.col + 1 ? (zh ? "取消冻结" : "固定を解除") : (zh ? "冻结至此列" : "ここまで列を固定")}</button>
                        <button type="button" onClick={() => { toggleHidden(menuCol.key); setCtx(null); }} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><EyeOff className="size-3.5 text-tertiary" /> {zh ? "隐藏此列" : "この列を隠す"}</button>
                        <button type="button" onClick={() => { setFieldsFocus(menuCol.id); setView("fields"); setCtx(null); }} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><SlidersHorizontal className="size-3.5 text-tertiary" /> {zh ? "字段设置…" : "フィールド設定…"}</button>
                        <button type="button" onClick={() => deleteColumn(menuCol.id)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-danger-primary hover:bg-danger-subtle"><Trash2 className="size-3.5" /> {T.del}</button>
                      </>
                    ) : ctx.row < displayRows.length ? (
                      <>
                        <button type="button" onClick={() => copyCell(ctx.col, ctx.row)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Copy className="size-3.5 text-tertiary" /> {zh ? "复制单元格" : "セルをコピー"}</button>
                        <button type="button" onClick={() => copyRow(ctx.row)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Copy className="size-3.5 text-tertiary" /> {zh ? "复制整行" : "行をコピー"}</button>
                        <button type="button" onClick={() => filterByCell(ctx.col, ctx.row)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Filter className="size-3.5 text-tertiary" /> {zh ? "按此值筛选" : "この値で絞り込み"}</button>
                        <div className="my-1 border-t border-subtle" />
                        <button type="button" onClick={() => void insertRowAt(ctx.row, false)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Plus className="size-3.5 text-tertiary" /> {zh ? "在上方插入行" : "上に行を挿入"}</button>
                        <button type="button" onClick={() => void insertRowAt(ctx.row, true)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Plus className="size-3.5 text-tertiary" /> {zh ? "在下方插入行" : "下に行を挿入"}</button>
                        <button type="button" onClick={() => duplicateRow(ctx.row)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Files className="size-3.5 text-tertiary" /> {zh ? "复制行(建副本)" : "行を複製"}</button>
                        {displayRows[ctx.row]?.source_issue && (
                          <button type="button" onClick={() => openSourceCard(ctx.row)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><ExternalLink className="size-3.5 text-tertiary" /> {zh ? "打开来源卡片" : "元カードを開く"}</button>
                        )}
                        <div className="my-1 border-t border-subtle" />
                        <button type="button" onClick={() => clearCell(ctx.col, ctx.row)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Eraser className="size-3.5 text-tertiary" /> {T.clear}</button>
                        <button type="button" onClick={() => deleteRow(ctx.row)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-danger-primary hover:bg-danger-subtle"><Trash2 className="size-3.5" /> {T.delRow}</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => void insertRowAt(displayRows.length, false)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Plus className="size-3.5 text-tertiary" /> {zh ? "在末尾插入行" : "末尾に行を挿入"}</button>
                    )}
                  </div>
                )}
              </div>
            )}
            {shareDlg && (
              <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onClick={() => setShareDlg(null)}>
                <div className="max-h-[88vh] w-[26rem] max-w-[calc(100vw-2rem)] overflow-auto rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-4 shadow-overlay-200" onClick={(e) => e.stopPropagation()}>
                  <div className="text-14 font-semibold text-primary">{zh ? `共享「${shareDlg.tname}」` : `「${shareDlg.tname}」を共有`}</div>
                  <div className="mt-1 text-11 leading-relaxed text-placeholder">
                    {zh ? "共享后其他项目可见此表并可绑卡。工作区里有外部协作项目时,用「指定项目」精确控制,避免泄露。" : "共有先のプロジェクトから参照・カード連携が可能。外部協業プロジェクトがある場合は「指定」推奨。"}
                  </div>
                  <div className="mt-3 space-y-1">
                    {([
                      { v: "private", zhL: "私有 — 仅本项目", jaL: "非公開 — このプロジェクトのみ" },
                      { v: "all", zhL: "全工作区 — 所有项目可见", jaL: "ワークスペース全体 — 全プロジェクト" },
                      { v: "some", zhL: "指定项目 — 仅勾选的项目可见", jaL: "指定プロジェクト — 選択のみ" },
                    ] as const).map((o) => (
                      <label key={o.v} className={cn("flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-13", shareDlg.mode === o.v ? "bg-layer-2 text-primary" : "text-secondary hover:bg-layer-1-hover")}>
                        <input type="radio" checked={shareDlg.mode === o.v} onChange={() => setShareDlg({ ...shareDlg, mode: o.v })} className="size-3.5" />
                        {zh ? o.zhL : o.jaL}
                      </label>
                    ))}
                  </div>
                  {shareDlg.mode === "some" && (
                    <div className="mt-2 max-h-44 space-y-0.5 overflow-auto rounded-sm border-[0.5px] border-subtle-1 bg-layer-1 p-1.5">
                      {joinedProjectIds.filter((p) => p !== pid).map((p) => {
                        const prj = getPartialProjectById(p);
                        const on = shareDlg.pids.includes(p);
                        return (
                          <label key={p} className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-12 text-secondary hover:bg-layer-1-hover">
                            <input type="checkbox" checked={on} onChange={() => setShareDlg({ ...shareDlg, pids: on ? shareDlg.pids.filter((x) => x !== p) : [...shareDlg.pids, p] })} className="size-3.5" />
                            <span className="truncate">{prj?.name ?? p}</span>
                          </label>
                        );
                      })}
                      {joinedProjectIds.filter((p) => p !== pid).length === 0 && (
                        <div className="px-1.5 py-1 text-11 text-placeholder">{zh ? "没有其他项目" : "他プロジェクトなし"}</div>
                      )}
                    </div>
                  )}
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={() => setShareDlg(null)} className="rounded-md px-3 py-1.5 text-13 text-secondary hover:bg-layer-1-hover">{zh ? "取消" : "キャンセル"}</button>
                    <button type="button" disabled={tblBusy || (shareDlg.mode === "some" && shareDlg.pids.length === 0)} onClick={() => void saveShare()} className="rounded-md bg-accent-primary px-3.5 py-1.5 text-13 font-medium text-white hover:bg-accent-primary-hover disabled:opacity-50">{tblBusy ? "…" : (zh ? "保存" : "保存")}</button>
                  </div>
                </div>
              </div>
            )}
            {tblDlg && (
              <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onClick={(e) => e.stopPropagation()}>
                <div className="max-h-[88vh] w-[26rem] max-w-[calc(100vw-2rem)] overflow-auto rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-4 shadow-overlay-200">
                  {tblDlg.kind === "delete" ? (
                    <>
                      <div className="text-14 font-semibold text-primary">{zh ? `删除表「${tblDlg.tname}」?` : `「${tblDlg.tname}」を削除しますか?`}</div>
                      <div className="mt-2.5 space-y-1.5 text-12 leading-relaxed text-secondary">
                        <div>· {zh ? `${tblDlg.deps.rows} 行数据、${tblDlg.deps.forms} 个表单、${tblDlg.deps.views} 份个人视图将一并移除(软删)` : `${tblDlg.deps.rows} 行・${tblDlg.deps.forms} フォーム・${tblDlg.deps.views} ビューを削除(ソフト)`}</div>
                        {tblDlg.deps.bindings.total > 0 && (
                          <div className="text-danger-primary">· {zh ? `${tblDlg.deps.bindings.total} 张卡片的「关联数据表」将解除${tblDlg.deps.bindings.foreign ? `(含其他项目 ${tblDlg.deps.bindings.foreign} 张)` : ""}` : `カード連携 ${tblDlg.deps.bindings.total} 件を解除`}</div>
                        )}
                        {tblDlg.deps.bindings.cards.length > 0 && (
                          <div className="rounded-sm bg-layer-2 px-2 py-1.5 text-11 text-tertiary">{tblDlg.deps.bindings.cards.join("  /  ")}</div>
                        )}
                        {tblDlg.deps.blueprints.length > 0 && (
                          <div className="text-danger-primary">· {zh ? "有蓝图按名引用此表, 删除后其发布与实例化将报错: " : "ブループリント参照あり: "}{tblDlg.deps.blueprints.map((b) => `${b.name} v${b.version}(${b.project})`).join(", ")}</div>
                        )}
                        {tblDlg.deps.rows === 0 && tblDlg.deps.bindings.total === 0 && tblDlg.deps.blueprints.length === 0 && (
                          <div className="text-placeholder">{zh ? "此表没有数据与依赖。" : "データ・依存なし。"}</div>
                        )}
                      </div>
                      <div className="mt-4 flex justify-end gap-2">
                        <button type="button" onClick={() => setTblDlg(null)} className="rounded-md px-3 py-1.5 text-13 text-secondary hover:bg-layer-1-hover">{zh ? "取消" : "キャンセル"}</button>
                        <button type="button" disabled={tblBusy} onClick={() => void confirmDeleteTable()} className="rounded-md px-3.5 py-1.5 text-13 font-medium text-white disabled:opacity-50" style={{ background: "#dc2626" }}>{tblBusy ? "…" : (zh ? "确认删除" : "削除する")}</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-14 font-semibold text-primary">{zh ? `收窄「${tblDlg.tname}」的共享范围?` : `「${tblDlg.tname}」の共有範囲を縮小しますか?`}</div>
                      <div className="mt-2.5 space-y-1.5 text-12 leading-relaxed text-secondary">
                        {tblDlg.fb > 0 && (
                          <div>· {zh ? `其他项目有 ${tblDlg.fb} 张卡片绑定此表:已有绑定仍可经卡片表单写入(祖父化),但此表将对其不可见、不可再新建绑定` : `他プロジェクトのカード連携 ${tblDlg.fb} 件:既存は継続、新規連携は不可に`}</div>
                        )}
                        {tblDlg.bps.length > 0 && (
                          <div className="text-danger-primary">· {zh ? "其他项目的蓝图引用此表, 取消后其实例化将报错: " : "他プロジェクトのブループリントが参照: "}{tblDlg.bps.map((b) => `${b.name}(${b.project})`).join(", ")}</div>
                        )}
                      </div>
                      <div className="mt-4 flex justify-end gap-2">
                        <button type="button" onClick={() => setTblDlg(null)} className="rounded-md px-3 py-1.5 text-13 text-secondary hover:bg-layer-1-hover">{zh ? "取消" : "キャンセル"}</button>
                        <button type="button" disabled={tblBusy} onClick={() => void confirmUnshare()} className="rounded-md px-3.5 py-1.5 text-13 font-medium text-white disabled:opacity-50" style={{ background: "#d97706" }}>{tblBusy ? "…" : (zh ? "仍要取消共享" : "解除する")}</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
