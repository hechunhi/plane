/**
 * BARSOUL: 转置 glide(字段成行: 标签 | 值)= 卡片/表单的「表单」. 见 docs/architecture/smart-table-mvp.md §11.
 * 用 glide 当唯一编辑器: 值列按字段类型走 cellForColumn(含图片/下拉/星级/日期), 编辑回 coerceEditedValue.
 * 表视图(记录成行)与此(字段成行)共享同一套 cell 逻辑 → 零重复、富类型/图片到处一致.
 */
import { useCallback, useMemo, useState } from "react";
import {
  DataEditor,
  GridCellKind,
  type GridColumn,
  type GridCell,
  type Item,
  type EditableGridCell,
} from "@glideapps/glide-data-grid";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import type { TSmartColumn } from "@/services/smart-table.service";
import {
  CUSTOM_RENDERERS,
  cellForColumn,
  coerceEditedValue,
  getGlideTheme,
  makeImageEditor,
  useGridWidth,
  useIsDark,
} from "./smart-table-cells";

type Props = {
  columns: TSmartColumn[];
  cells: Record<string, unknown>;
  editable?: boolean;
  onEdit: (key: string, value: unknown) => void;
  imageUpload?: (file: File) => Promise<string | null>;
};

const ROW_H = 40;

export function SmartTableRecordGrid({ columns, cells, editable = true, onEdit, imageUpload }: Props) {
  const zh = useZh();
  const dark = useIsDark();
  // 用户走查(2026-06-14):「不像 data-grid / 表格行为被禁用 / 丑」→ 还原 table 质感(竖线网格)
  const theme = useMemo(() => getGlideTheme(dark, "table"), [dark]);
  const imageEditor = useMemo(() => makeImageEditor(imageUpload), [imageUpload]);

  // 标签列宽: 自适应最长字段名为默认; 用户拖动后存 localStorage(全卡通用偏好, 本表单无独立 id)
  const autoLabelW = useMemo(() => {
    const lang = zh ? "zh" : "ja";
    const maxLen = columns.reduce((m, f) => {
      const nm = (f.i18n?.[lang]?.name || f.name) + (f.required ? " *" : "");
      return Math.max(m, nm.length);
    }, 0);
    return Math.min(224, Math.max(104, maxLen * 13 + 24)); // CJK ~13px/字 @12px 字号
  }, [columns, zh]);
  const [labelOverride, setLabelOverride] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = Number(window.localStorage.getItem("smart-table:record-label-w"));
    return v > 0 ? v : null;
  });
  const labelWidth = labelOverride ?? autoLabelW;

  // grow 失灵(width=100% 测不到容器宽) → 实测容器, 值列显式撑满剩余宽。
  // innerW=gridW-2(减容器 1px*2 边框) → 画布==内容区, 不冒 2px 横向条→再顶纵向条(2026-06-15 连环坑)。
  const [wrapRef, gridW] = useGridWidth<HTMLDivElement>();
  const innerW = gridW > 2 ? gridW - 2 : 0;
  const valueWidth = Math.max(180, innerW - labelWidth);
  const hOverflow = innerW > 0 && labelWidth + valueWidth > innerW; // 极窄卡: 值列触底 180 → 横向滚动
  const gridColumns: GridColumn[] = useMemo(
    () => [
      { title: zh ? "字段" : "項目", id: "__label", width: labelWidth },
      { title: zh ? "值" : "値", id: "__value", width: valueWidth },
    ],
    [zh, labelWidth, valueWidth]
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const f = columns[row];
      if (!f) return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
      if (col === 0) {
        const nm = f.i18n?.[zh ? "zh" : "ja"]?.name || f.name; // schema i18n 显示层
        const label = `${nm}${f.required ? " *" : ""}`;
        // B-2o: label 列现代表单形态 — 透明底(去灰块)+ 三级文字 + 右对齐贴值
        return {
          kind: GridCellKind.Text,
          data: label,
          displayData: label,
          allowOverlay: false,
          contentAlign: "right",
          themeOverride: { textDark: dark ? "#9a9ea1" : "#6b7075" },
        };
      }
      let cell = cellForColumn(
        f,
        cells[f.key],
        dark,
        editable && f.editable !== false && f.source === "manual",
        zh ? "zh" : "ja"
      );
      // 表单形态: 值一律左对齐 — 右对齐是表格列惯例(纵向对位), 转置表单里会把数字甩到最右、撕裂横向扫读
      if (cell.contentAlign === "right") cell = { ...cell, contentAlign: "left" } as GridCell;
      // B-2o: 空值占位 — 全空表单不再像表格故障; 仅显示层, 编辑取原值
      if ("displayData" in cell && cell.displayData === "" && cell.kind === GridCellKind.Text)
        cell = {
          ...cell,
          displayData: "—",
          themeOverride: { ...cell.themeOverride, textDark: dark ? "#5a5e61" : "#c2c6c9" },
        } as GridCell;
      // 必填且空: 值格淡琥珀底 — 把「必須あと N 項目」落到具体格子上(显示层, 不阻塞)
      const v = cells[f.key];
      if (
        f.required &&
        editable &&
        f.source === "manual" &&
        (v == null || v === "" || (Array.isArray(v) && v.length === 0))
      )
        cell = { ...cell, themeOverride: { ...cell.themeOverride, bgCell: dark ? "#272014" : "#fdf4e3" } } as GridCell;
      return cell;
    },
    [columns, cells, dark, editable, zh]
  );

  const onCellEdited = useCallback(
    ([col, row]: Item, val: EditableGridCell) => {
      if (col !== 1) return;
      const f = columns[row];
      if (!f || f.source !== "manual") return;
      const { skip, value } = coerceEditedValue(val);
      if (skip) return;
      onEdit(f.key, value);
    },
    [columns, onEdit]
  );

  if (columns.length === 0) return null;
  const HEAD_H = 32; // 列头露出 → 既像 data-grid, 又给「字段|值」分界一个可拖手柄
  const height = columns.length * ROW_H + HEAD_H + 2 + (hOverflow ? 11 : 0); // 横向条10见globals.css → 无纵向条
  const persistLabelW = (newSize: number) => {
    const w = Math.max(80, Math.round(newSize));
    setLabelOverride(w);
    try {
      window.localStorage.setItem("smart-table:record-label-w", String(w));
    } catch {
      /* private mode */
    }
  };

  return (
    <div
      ref={wrapRef}
      className="smart-glide-scroll overflow-hidden rounded-md border border-subtle"
      style={{ height }}
    >
      <DataEditor
        columns={gridColumns}
        rows={columns.length}
        getCellContent={getCellContent}
        onCellEdited={onCellEdited}
        onPaste // B-2p: 启用 glide 粘贴链(文本/URL 直贴进格; 截图 blob 走浮層 onPaste)
        customRenderers={CUSTOM_RENDERERS}
        imageEditorOverride={imageEditor}
        theme={theme}
        headerHeight={HEAD_H}
        rowHeight={ROW_H}
        rowMarkers="none"
        rowSelect="none"
        freezeColumns={1}
        onColumnResize={(col, newSize) => {
          if (col.id === "__label") setLabelOverride(Math.max(80, Math.round(newSize)));
        }}
        onColumnResizeEnd={(col, newSize) => {
          if (col.id === "__label") persistLabelW(newSize);
        }}
        width={innerW || "100%"}
        height="100%"
      />
    </div>
  );
}
