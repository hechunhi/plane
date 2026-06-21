/**
 * BARSOUL Option A: 候选行网格 — 每行是独立 SmartRow(Option A 2026-06-19 升).
 * 「glide = 唯一编辑器」铁律(§11)适用,绝不自绘表格。
 * 行=issue 的额外 SmartRow, 列=表单 manual 字段 + 尾部删除列(editable 时)。
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
import type { TSmartColumn, TSmartRow } from "@/services/smart-table.service";
import { Maximize2 } from "lucide-react";
import {
  CUSTOM_RENDERERS,
  cellForColumn,
  coerceEditedValue,
  defaultColW,
  getGlideTheme,
  gridFill,
  useGridWidth,
  useIsDark,
} from "./smart-table-cells";
import { SmartTableRowDetailModal } from "./smart-table-row-detail";

type Props = {
  columns: TSmartColumn[]; // 表单字段子集(调用方已按 form 裁剪)
  rows: TSmartRow[];
  editable?: boolean; // 默认 true; committed 后 false
  onUpsert: (id: string, values: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
};

const ROW_H = 34;

// 停滞染色: 「問い合わせ中」放置 2 天以上 → 行染淡琥珀
const STALE_MS = 2 * 24 * 3600 * 1000;
const isStale = (row: TSmartRow) =>
  Object.values(row.cells || {}).includes("問い合わせ中") &&
  !!row.updated_at &&
  Date.now() - new Date(row.updated_at).getTime() > STALE_MS;

export function SmartTableCandidatesGrid({ columns, rows, editable = true, onUpsert, onDelete }: Props) {
  const zh = useZh();
  const dark = useIsDark();
  const theme = useMemo(() => getGlideTheme(dark, "table"), [dark]);
  const lang = zh ? "zh" : "ja";
  const dataCols = useMemo(() => columns.filter((c) => c.source === "manual"), [columns]);

  const [wrapRef, gridW] = useGridWidth<HTMLDivElement>();
  const [colW, setColW] = useState<Record<string, number>>({});
  const [detail, setDetail] = useState<{ columns: TSmartColumn[]; cells: Record<string, unknown>; id: string } | null>(
    null
  );
  const [hoverRow, setHoverRow] = useState<number | null>(null);

  const { layout, overflow } = useMemo(() => {
    const defs = [
      ...dataCols.map((c) => ({ id: c.key, base: defaultColW(c.type), flex: true })),
      ...(editable ? [{ id: "__del", base: 44, flex: false }] : []),
    ];
    const r = gridFill(defs, gridW, colW);
    return { layout: r.widths, overflow: r.overflow };
  }, [dataCols, gridW, colW, editable]);

  const gridColumns: GridColumn[] = useMemo(
    () => [
      ...dataCols.map((c) => ({ title: c.i18n?.[lang]?.name || c.name, id: c.key, width: layout[c.key] })),
      ...(editable ? [{ title: "", id: "__del", width: layout["__del"] }] : []),
    ],
    [dataCols, lang, layout, editable]
  );

  const getCellContent = useCallback(
    ([col, rowIdx]: Item): GridCell => {
      const row = rows[rowIdx];
      if (!row) return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
      const staleBg = isStale(row) ? { bgCell: dark ? "#33270f" : "#fdf6e7" } : undefined;
      if (col < dataCols.length) {
        const c = dataCols[col];
        const base = cellForColumn(c, row.cells?.[c.key], dark, editable && c.editable !== false, lang) as GridCell & {
          themeOverride?: Record<string, string>;
        };
        return staleBg ? { ...base, themeOverride: { ...(base.themeOverride || {}), ...staleBg } } : base;
      }
      // delete column
      const del = zh ? "删" : "削";
      return {
        kind: GridCellKind.Text,
        data: del,
        displayData: del,
        allowOverlay: false,
        contentAlign: "center",
        themeOverride: { textDark: dark ? "#585e62" : "#a9aeb2", ...(staleBg || {}) },
      };
    },
    [rows, dataCols, dark, lang, zh, editable]
  );

  const onCellEdited = useCallback(
    ([col, rowIdx]: Item, val: EditableGridCell) => {
      if (!editable || col >= dataCols.length) return;
      const row = rows[rowIdx];
      const c = dataCols[col];
      if (!row || !c) return;
      const { skip, value } = coerceEditedValue(val);
      if (skip) return;
      onUpsert(row.id, { [c.key]: value });
    },
    [rows, dataCols, onUpsert, editable]
  );

  const onCellClicked = useCallback(
    ([col, rowIdx]: Item) => {
      const row = rows[rowIdx];
      if (!row) return;
      if (editable && col === dataCols.length) onDelete(row.id);
    },
    [rows, dataCols.length, onDelete, editable]
  );

  if (rows.length === 0) return null;
  const height = 34 + rows.length * ROW_H + 2 + (overflow ? 11 : 0);

  const firstColW = layout[dataCols[0]?.key ?? ""] ?? 120;
  return (
    <div
      ref={wrapRef}
      className="smart-glide-scroll relative overflow-hidden rounded-md border border-subtle"
      style={{ height }}
      onMouseLeave={() => setHoverRow(null)}
    >
      <DataEditor
        columns={gridColumns}
        rows={rows.length}
        getCellContent={getCellContent}
        onCellEdited={editable ? onCellEdited : undefined}
        onCellClicked={editable ? onCellClicked : undefined}
        onItemHovered={(args) => setHoverRow(args.kind === "cell" ? args.location[1] : null)}
        onColumnResize={(col, newSize) => {
          if (col.id) setColW((p) => ({ ...p, [col.id!]: Math.max(40, Math.round(newSize)) }));
        }}
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
      {hoverRow != null && rows[hoverRow] && (
        <button
          type="button"
          title={zh ? "展开为表单" : "フォームで展開"}
          onClick={() => setDetail({ columns: dataCols, cells: rows[hoverRow].cells ?? {}, id: rows[hoverRow].id })}
          className="shadow-sm absolute z-10 grid size-5 place-items-center rounded border-[0.5px] border-subtle bg-surface-1/95 text-tertiary backdrop-blur-sm transition-colors hover:bg-layer-1 hover:text-primary"
          style={{ top: 34 + hoverRow * ROW_H + (ROW_H - 20) / 2, left: Math.max(4, firstColW - 26) }}
        >
          <Maximize2 className="size-3" />
        </button>
      )}
      {detail && (
        <SmartTableRowDetailModal
          columns={detail.columns}
          cells={detail.cells}
          editable={editable}
          onEdit={editable ? (k, v) => onUpsert(detail.id, { [k]: v }) : undefined}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
