/**
 * BARSOUL B-4a: 候选记录 glide 网格 — 「glide = 唯一编辑器」铁律(§11)适用,
 * 绝不自绘表格(2026-06-11 自绘 HTML 表事故后重写)。
 * 行=候选(各家报价等), 列=站点表单的 manual 字段(cellForColumn 全类型复用)
 * + 尾部两操作列(采用/删, onCellClicked)。「采用」写主行表单, 全集留底。
 */
import { useCallback, useMemo, useState } from "react";
import {
  DataEditor,
  GridCellKind,
  type GridCell,
  type GridColumn,
  type Item,
  type EditableGridCell,
} from "@glideapps/glide-data-grid";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import type { TCandidate, TSmartColumn } from "@/services/smart-table.service";
import { CUSTOM_RENDERERS, cellForColumn, coerceEditedValue, defaultColW, getGlideTheme, gridFill, useGridWidth, useIsDark } from "./smart-table-cells";

type Props = {
  columns: TSmartColumn[]; // 表单字段子集(调用方已按 form 裁剪)
  candidates: TCandidate[];
  onUpsert: (id: string, values: Record<string, unknown>) => void;
  onAdopt: (id: string) => void;
  onDelete: (id: string) => void;
};

const ROW_H = 34;

export function SmartTableCandidatesGrid({ columns, candidates, onUpsert, onAdopt, onDelete }: Props) {
  const zh = useZh();
  const dark = useIsDark();
  const theme = useMemo(() => getGlideTheme(dark, "table"), [dark]); // 用户走查 2026-06-14: 还原 data-grid 网格质感
  const lang = zh ? "zh" : "ja";
  const dataCols = useMemo(() => columns.filter((c) => c.source === "manual"), [columns]);

  const [wrapRef, gridW] = useGridWidth<HTMLDivElement>();
  const [colW, setColW] = useState<Record<string, number>>({}); // 列宽拖动: 内存态(刷新回默认填满, 不持久化免污染)

  // gridFill: 按容器内容宽精确填满(数据列摊余量+末列吃余数=零缝零空列), 操作列固定; overflow→容器高补滚动条位
  const { layout, overflow } = useMemo(() => {
    const r = gridFill(
      [
        ...dataCols.map((c) => ({ id: c.key, base: defaultColW(c.type), flex: true })),
        { id: "__adopt", base: 86, flex: false },
        { id: "__del", base: 44, flex: false },
      ],
      gridW, colW
    );
    return { layout: r.widths, overflow: r.overflow };
  }, [dataCols, gridW, colW]);
  const gridColumns: GridColumn[] = useMemo(() => [
    ...dataCols.map((c) => ({ title: c.i18n?.[lang]?.name || c.name, id: c.key, width: layout[c.key] })),
    { title: "", id: "__adopt", width: layout["__adopt"] },
    { title: "", id: "__del", width: layout["__del"] },
  ], [dataCols, lang, layout]);

  // BS-216 会诊②: 「問い合わせ中」放置 2 天以上 → 行染淡琥珀(行动信号: 该催了/会忘的就是这种行)。
  // 值匹配不绑列 key(任何 single_select 含该值即算), adopted 优先。
  const STALE_MS = 2 * 24 * 3600 * 1000;
  const isStale = (cand: TCandidate) =>
    !cand.adopted &&
    Object.values(cand.values || {}).includes("問い合わせ中") &&
    !!cand.at &&
    Date.now() - new Date(cand.at).getTime() > STALE_MS;

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const cand = candidates[row];
      if (!cand) return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
      const adoptedBg = cand.adopted
        ? { bgCell: dark ? "#0a2533" : "#ebf8ff" }
        : isStale(cand)
          ? { bgCell: dark ? "#33270f" : "#fdf6e7" }
          : undefined;
      if (col < dataCols.length) {
        const c = dataCols[col];
        const base = cellForColumn(c, cand.values?.[c.key], dark, true, lang) as GridCell & {
          themeOverride?: Record<string, string>;
        };
        return adoptedBg ? { ...base, themeOverride: { ...(base.themeOverride || {}), ...adoptedBg } } : base;
      }
      if (col === dataCols.length) {
        const label = cand.adopted ? (zh ? "✓ 已采用" : "✓ 採用済") : zh ? "采用" : "採用";
        return {
          kind: GridCellKind.Text, data: label, displayData: label, allowOverlay: false,
          contentAlign: "center",
          themeOverride: { textDark: cand.adopted ? (dark ? "#2893cc" : "#006399") : theme.textMedium || "#4e5355", ...(adoptedBg || {}) },
        };
      }
      const del = zh ? "删" : "削";
      return {
        kind: GridCellKind.Text, data: del, displayData: del, allowOverlay: false,
        contentAlign: "center", themeOverride: { textDark: dark ? "#585e62" : "#a9aeb2", ...(adoptedBg || {}) }, // 降权: 破坏性操作不抢视线
      };
    },
    [candidates, dataCols, dark, lang, zh, theme]
  );

  const onCellEdited = useCallback(
    ([col, row]: Item, val: EditableGridCell) => {
      if (col >= dataCols.length) return;
      const cand = candidates[row];
      const c = dataCols[col];
      if (!cand || !c) return;
      const { skip, value } = coerceEditedValue(val);
      if (skip) return;
      onUpsert(cand.id, { [c.key]: value });
    },
    [candidates, dataCols, onUpsert]
  );

  const onCellClicked = useCallback(
    ([col, row]: Item) => {
      const cand = candidates[row];
      if (!cand) return;
      if (col === dataCols.length && !cand.adopted) onAdopt(cand.id);
      else if (col === dataCols.length + 1) onDelete(cand.id);
    },
    [candidates, dataCols.length, onAdopt, onDelete]
  );

  if (candidates.length === 0) return null;
  const height = 34 + candidates.length * ROW_H + 2 + (overflow ? 11 : 0); // 头34+行+边框2(+横向条10见globals.css→无纵向条)

  return (
    <div ref={wrapRef} className="smart-glide-scroll overflow-hidden rounded-md border border-subtle" style={{ height }}>
      <DataEditor
        columns={gridColumns}
        rows={candidates.length}
        getCellContent={getCellContent}
        onCellEdited={onCellEdited}
        onCellClicked={onCellClicked}
        onColumnResize={(col, newSize) => { if (col.id) setColW((p) => ({ ...p, [col.id!]: Math.max(40, Math.round(newSize)) })); }}
        customRenderers={CUSTOM_RENDERERS}
        theme={theme}
        headerHeight={34}
        rowHeight={ROW_H}
        rowMarkers="none"
        columnSelect="none"
        rowSelect="none"
        width={(gridW > 2 ? gridW - 2 : 0) || "100%"}
        height="100%"
      />
    </div>
  );
}
