/**
 * BARSOUL: 定期タスク / 周期任务 feature 页(IUTEYA-15). 见 docs/architecture/recurring-tasks-mvp.md.
 * 规则一览 = glide(铁律: 表格必用 glide 绝不自绘)。列: タスク名/周期/次回作成/期日/担当/状態/⋯。
 * 状态色(铁律): 有効=绿 / 進行中=中性 / 要対応=琥珀(一览唯一琥珀) / 停止中=灰。次回作成 ≠ 期日 两列分明(信任命门)。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Repeat, Plus, Play, SkipForward, Pause, Pencil, Trash2 } from "lucide-react";
import { DataEditor, GridCellKind, type GridColumn, type GridCell, type Item } from "@glideapps/glide-data-grid";
import { cn } from "@plane/utils";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { getGlideTheme, useIsDark } from "@/components/smart-table/smart-table-cells";
import { recurringService, type TRecurringRule, type TRecurringAction } from "@/services/recurring.service";
import { RecurringRuleEditor } from "./recurring-editor";

const ROW_H = 38;

const cadenceLabel = (r: TRecurringRule, zh: boolean): string => {
  const a = r.anchor || {};
  if (r.cadence === "weekly") {
    const wk = zh ? ["一", "二", "三", "四", "五", "六", "日"] : ["月", "火", "水", "木", "金", "土", "日"];
    return (zh ? "毎週 " : "毎週 ") + (a.weekdays ?? []).map((d) => wk[d - 1]).join("・");
  }
  if (r.cadence === "monthly") return a.mode === "eom" ? "毎月末" : a.mode === "bom" ? "毎月初" : `毎月${a.day ?? 1}日`;
  if (r.cadence === "quarterly") return zh ? "四半期" : "四半期";
  return zh ? "毎年" : "毎年";
};

const STATE_META: Record<string, { zh: string; ja: string; light: string; dark: string }> = {
  active: { zh: "有効", ja: "有効", light: "#167e56", dark: "#3fae84" },
  inflight: { zh: "進行中", ja: "進行中", light: "#676c6f", dark: "#9a9ea1" },
  attention: { zh: "要対応", ja: "要対応", light: "#b06d09", dark: "#e0a23c" },
  paused: { zh: "停止中", ja: "停止中", light: "#9aa0a3", dark: "#6b7075" },
};
const fmtDate = (iso: string | null) => (iso ? iso.slice(5).replace("-", "/") : "—"); // YYYY-MM-DD → M/D

export function RecurringRoot() {
  const params = useParams();
  const ws = (params?.workspaceSlug ?? "").toString();
  const pid = (params?.projectId ?? "").toString();
  const zh = useZh();
  const dark = useIsDark();
  const theme = useMemo(() => getGlideTheme(dark, "form"), [dark]);

  const [rules, setRules] = useState<TRecurringRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<TRecurringRule | "new" | null>(null);
  const [menu, setMenu] = useState<{ rule: TRecurringRule; x: number; y: number } | null>(null);
  const [delRule, setDelRule] = useState<TRecurringRule | null>(null);

  const T = zh
    ? { title: "定期タスク", neww: "新規定期タスク", empty: "まだ定期タスクはありません", emptyHint: "毎月・四半期ごとに繰り返す作業(出勤簿提出、家賃振込確認、棚卸など)を登録すると、期日のN日前に自動でカードが作られます。", colName: "タスク名", colCad: "周期", colNext: "次回作成", colDue: "期日", colAssignee: "担当", colState: "状態", unassigned: "未認領", runNow: "今すぐ生成", skip: "次回をスキップ", pause: "一時停止", resume: "再開", edit: "編集", del: "削除", delQ: (n: string) => `定期タスク「${n}」を削除しますか?`, delNote: "生成済みの進行中カードはそのまま残ります。", cancel: "キャンセル" }
    : { title: "定期タスク", neww: "新規定期タスク", empty: "まだ定期タスクはありません", emptyHint: "毎月・四半期ごとに繰り返す作業(出勤簿提出、家賃振込確認、棚卸など)を登録すると、期日のN日前に自動でカードが作られます。", colName: "タスク名", colCad: "周期", colNext: "次回作成", colDue: "期日", colAssignee: "担当", colState: "状態", unassigned: "未認領", runNow: "今すぐ生成", skip: "次回をスキップ", pause: "一時停止", resume: "再開", edit: "編集", del: "削除", delQ: (n: string) => `定期タスク「${n}」を削除しますか?`, delNote: "生成済みの進行中カードはそのまま残ります。", cancel: "キャンセル" };

  const load = useCallback(async () => {
    if (!ws || !pid) return;
    setLoading(true);
    const list = await recurringService.list(ws, pid);
    setRules(list);
    setLoading(false);
  }, [ws, pid]);

  useEffect(() => { load(); }, [load]);

  const doAction = useCallback(async (rule: TRecurringRule, action: TRecurringAction) => {
    setMenu(null);
    const r = await recurringService.action(ws, pid, rule.id, action).catch(() => null);
    if (!r) { setToast({ type: TOAST_TYPE.ERROR, title: zh ? "操作に失敗しました" : "操作に失敗しました", message: "" }); return; }
    if (action === "run_now" && r.last_issue) setToast({ type: TOAST_TYPE.SUCCESS, title: `「${r.last_issue.name}」を作成しました`, message: "" });
    setRules((prev) => prev.map((x) => (x.id === r.id ? r : x)));
  }, [ws, pid, zh]);

  const confirmDelete = useCallback(async () => {
    if (!delRule) return;
    await recurringService.remove(ws, pid, delRule.id).catch(() => {});
    setRules((prev) => prev.filter((x) => x.id !== delRule.id));
    setDelRule(null);
  }, [delRule, ws, pid]);

  const cols = useMemo<GridColumn[]>(
    () => [
      { title: T.colName, id: "name", grow: 1 },
      { title: T.colCad, id: "cadence", width: 120 },
      { title: T.colNext, id: "next", width: 92 },
      { title: T.colDue, id: "due", width: 80 },
      { title: T.colAssignee, id: "assignee", width: 96 },
      { title: T.colState, id: "state", width: 88 },
      { title: "", id: "__act", width: 44 },
    ],
    [T]
  );

  const getCell = useCallback(
    ([col, row]: Item): GridCell => {
      const r = rules[row];
      if (!r) return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
      const txt = (s: string, over?: Record<string, string>, align?: "center" | "right"): GridCell => ({
        kind: GridCellKind.Text, data: s, displayData: s, allowOverlay: false, contentAlign: align, themeOverride: over,
      });
      switch (col) {
        case 0: return txt(r.name);
        case 1: return txt(cadenceLabel(r, zh), { textDark: theme.textMedium || "#4e5355" });
        case 2: return txt(fmtDate(r.next_run_at), { textDark: theme.textMedium || "#4e5355" });
        case 3: return txt(fmtDate(r.next_due), { textDark: theme.textMedium || "#4e5355" });
        case 4: return txt(r.assignee?.display_name ?? T.unassigned, { textDark: r.assignee ? (theme.textMedium || "#4e5355") : (theme.textLight || "#9aa0a3") });
        case 5: {
          const m = STATE_META[r.derived_state] ?? STATE_META.active;
          return txt(zh ? m.zh : m.ja, { textDark: dark ? m.dark : m.light });
        }
        default: return txt("⋯", { textDark: theme.textLight || "#9aa0a3" }, "center");
      }
    },
    [rules, zh, dark, theme, T]
  );

  const onCellClicked = useCallback(
    ([col, row]: Item, e: { bounds: { x: number; y: number; width: number; height: number }; localEventX?: number; localEventY?: number }) => {
      const r = rules[row];
      if (!r) return;
      if (col === cols.length - 1) {
        setMenu({ rule: r, x: e.bounds.x + (e.localEventX ?? 0) - 180, y: e.bounds.y + (e.localEventY ?? 0) + 8 });
      } else {
        setEditor(r); // 行点击 → 编辑
      }
    },
    [rules, cols.length]
  );

  if (loading)
    return (
      <div className="flex h-full items-center justify-center bg-surface-1">
        <div className="size-5 animate-spin rounded-full border-2 border-subtle border-t-accent-primary" />
      </div>
    );

  const height = rules.length * ROW_H + 36 + 2;

  return (
    <div className="flex h-full flex-col bg-surface-1" onClick={() => menu && setMenu(null)}>
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-subtle bg-layer-1 px-page-x py-1.5">
        <Repeat className="size-4 text-tertiary" />
        <span className="text-13 font-medium text-primary">{T.title}</span>
        <span className="text-11 text-placeholder">{rules.length}</span>
        <button type="button" onClick={() => setEditor("new")} className="ml-auto flex items-center gap-1 rounded-md bg-accent-primary px-3 py-1.5 text-12 font-medium text-white hover:bg-accent-primary-hover">
          <Plus className="size-4" /> {T.neww}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-page-x">
        {rules.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md px-6 text-center">
            <Repeat className="mx-auto size-9 text-placeholder" />
            <div className="mt-3 text-14 font-medium text-secondary">{T.empty}</div>
            <div className="mt-1.5 text-12 leading-relaxed text-placeholder">{T.emptyHint}</div>
            <button type="button" onClick={() => setEditor("new")} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:bg-accent-primary-hover">
              <Plus className="size-4" /> {T.neww}
            </button>
          </div>
        ) : (
          <div className="smart-glide-scroll overflow-hidden rounded-md border border-subtle" style={{ height }}>
            <DataEditor
              columns={cols}
              rows={rules.length}
              getCellContent={getCell}
              onCellClicked={onCellClicked}
              theme={theme}
              headerHeight={36}
              rowHeight={ROW_H}
              rowMarkers="none"
              columnSelect="none"
              rowSelect="none"
              width="100%"
              height="100%"
            />
          </div>
        )}
      </div>

      {/* 行操作菜单 */}
      {menu && (
        <div className="fixed z-40 w-48 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1 shadow-overlay-200" style={{ left: Math.max(8, menu.x), top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => void doAction(menu.rule, "run_now")} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Play className="size-3.5 text-tertiary" /> {T.runNow}</button>
          <button type="button" onClick={() => void doAction(menu.rule, "skip_next")} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><SkipForward className="size-3.5 text-tertiary" /> {T.skip}</button>
          {menu.rule.status === "paused" ? (
            <button type="button" onClick={() => void doAction(menu.rule, "resume")} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Play className="size-3.5 text-tertiary" /> {T.resume}</button>
          ) : (
            <button type="button" onClick={() => void doAction(menu.rule, "pause")} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Pause className="size-3.5 text-tertiary" /> {T.pause}</button>
          )}
          <div className="my-1 border-t border-subtle" />
          <button type="button" onClick={() => { setEditor(menu.rule); setMenu(null); }} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"><Pencil className="size-3.5 text-tertiary" /> {T.edit}</button>
          <button type="button" onClick={() => { setDelRule(menu.rule); setMenu(null); }} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-13 text-danger-primary hover:bg-danger-subtle"><Trash2 className="size-3.5" /> {T.del}</button>
        </div>
      )}

      {/* 编辑器 */}
      {editor && (
        <RecurringRuleEditor
          ws={ws}
          pid={pid}
          rule={editor === "new" ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={(r) => { setEditor(null); setRules((prev) => (prev.some((x) => x.id === r.id) ? prev.map((x) => (x.id === r.id ? r : x)) : [...prev, r])); }}
        />
      )}

      {/* 删除确认(写死: 在途卡保留) */}
      {delRule && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4" onClick={() => setDelRule(null)}>
          <div className="w-[24rem] max-w-full rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-4 shadow-overlay-200" onClick={(e) => e.stopPropagation()}>
            <div className="text-14 font-semibold text-primary">{T.delQ(delRule.name)}</div>
            <div className="mt-2 text-12 leading-relaxed text-secondary">{T.delNote}</div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDelRule(null)} className="rounded-md px-3 py-1.5 text-13 text-secondary hover:bg-layer-1-hover">{T.cancel}</button>
              <button type="button" onClick={() => void confirmDelete()} className="rounded-md px-3.5 py-1.5 text-13 font-medium text-white" style={{ background: "#dc2626" }}>{T.del}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
