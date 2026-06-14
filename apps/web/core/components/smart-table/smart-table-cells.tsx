/**
 * BARSOUL: 智能表 共享 cell 层 — glide 是唯一编辑器(见 docs/architecture/smart-table-mvp.md §11).
 * 「列类型 → glide cell」只此一处(cellForColumn)+ 反向取值(coerceEditedValue),
 * 表视图(记录成行)与卡/表单(转置: 字段成行)都复用 → 加类型只改这里, 图片等富类型全由 glide 原生编辑.
 */
import { type ChangeEvent } from "react";
import {
  GridCellKind,
  GridColumnIcon,
  type GridCell,
  type CustomCell,
  type CustomRenderer,
  type EditableGridCell,
  type Theme as GlideTheme,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { allCells } from "@glideapps/glide-data-grid-cells";
import { useCallback, useEffect, useRef, useState } from "react";
import { Type, Hash, CircleDot, List, Calendar, Check, Link2, DollarSign, Star, Percent, SlidersHorizontal, TrendingUp, User, Image as ImageIcon } from "lucide-react";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import type { TSmartColumn, TSmartColumnType, TSmartSelectOption } from "@/services/smart-table.service";

const C = {
  light: { surface1: "#ffffff", surface2: "#fafafa", layerHover: "#eff0f0", borderSubtle: "#eaebeb", borderStrong: "#dadcdd", txtPrimary: "#1d1f20", txtSecondary: "#4e5355", txtTertiary: "#676c6f", accent: "#006399", accentLight: "#ebf8ff", search: "#fff3c4" },
  dark: { surface1: "#141515", surface2: "#181a1b", layerHover: "#1d1f20", borderSubtle: "#222425", borderStrong: "#36393a", txtPrimary: "#e4e6e7", txtSecondary: "#cacdce", txtTertiary: "#afb3b6", accent: "#2893cc", accentLight: "#0a2533", search: "#3a2f12" },
} as const;
const FONT = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans", "Noto Sans JP", sans-serif';

export function getGlideTheme(dark: boolean, variant: "table" | "form" = "table"): Partial<GlideTheme> {
  const c = dark ? C.dark : C.light;
  // B-2o 走查(用户:「数据表部分 UI 不够现代」): form 变体去 Excel 化 —
  // 竖线透明 + 横线更淡(卡内表单/候补网格用); 数据表主网格保持 table 形态。
  const form = variant === "form";
  return {
    bgCell: c.surface1, bgCellMedium: c.surface2, bgHeader: c.surface2, bgHeaderHasFocus: c.layerHover, bgHeaderHovered: c.layerHover,
    bgBubble: c.surface2, bgBubbleSelected: c.surface1, bgSearchResult: c.search,
    textDark: c.txtPrimary, textMedium: c.txtSecondary, textLight: c.txtTertiary, textHeader: c.txtTertiary, textHeaderSelected: c.txtPrimary, textBubble: c.txtSecondary,
    borderColor: form ? "transparent" : c.borderSubtle,
    horizontalBorderColor: form ? (dark ? "#222425" : "#f1f2f4") : c.borderSubtle,
    accentColor: c.accent, accentFg: "#ffffff", accentLight: c.accentLight, linkColor: c.accent,
    fontFamily: FONT, baseFontStyle: "13px", headerFontStyle: "600 12px", editorFontSize: "13px", cellHorizontalPadding: 10, cellVerticalPadding: 6,
  };
}

export function useIsDark(): boolean {
  const read = () => typeof document !== "undefined" && (document.documentElement.getAttribute("data-theme") ?? "").includes("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(read()));
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    setDark(read());
    return () => obs.disconnect();
  }, []);
  return dark;
}

interface TagProps {
  readonly kind: "tag-cell";
  readonly label: string; // 显示文本(可为译文)
  readonly color: string;
  readonly options: TSmartSelectOption[];
  readonly storeV?: string; // 真正落库的原值 — 译文绝不落库(选项值=数据键)
  readonly optLabels?: Record<string, string>; // {原值: 译文} 编辑器下拉显示用
}
type TagCell = CustomCell<TagProps>;

function lighten(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * amt);
  const g = Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * amt);
  const b = Math.round((n & 255) + (255 - (n & 255)) * amt);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function isDarkBg(bg: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec((bg || "").trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 128;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const tagRenderer: CustomRenderer<TagCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is TagCell => (c.data as { kind?: string }).kind === "tag-cell",
  onPaste: (v, d) => ({ ...d, label: v, storeV: v }),
  draw: (args, cell) => {
    const { ctx, theme, rect } = args;
    const { label, color } = cell.data;
    if (!label) return true;
    const dark = isDarkBg(theme.bgCell);
    ctx.save();
    ctx.font = `12px ${theme.fontFamily}`;
    const tw = ctx.measureText(label).width;
    const chipH = 21;
    const chipW = tw + 18;
    const x = rect.x + theme.cellHorizontalPadding;
    const y = rect.y + (rect.height - chipH) / 2;
    roundRect(ctx, x, y, chipW, chipH, 6);
    ctx.fillStyle = color + (dark ? "33" : "20");
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = color + (dark ? "55" : "33");
    ctx.stroke();
    ctx.fillStyle = dark ? lighten(color, 0.45) : color;
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 9, y + chipH / 2 + 0.5);
    ctx.restore();
    return true;
  },
  provideEditor: () => (p) => {
    const cell = p.value as TagCell;
    const opts = cell.data.options ?? [];
    const labels = cell.data.optLabels ?? {};
    const pick = (v: string, color?: string) =>
      p.onFinishedEditing({ ...cell, copyData: v, data: { ...cell.data, label: v ? (labels[v] ?? v) : "", storeV: v, color: color || "#7a8088" } });
    return (
      <div className="max-h-60 w-44 overflow-auto bg-surface-1 p-1">
        <button type="button" onClick={() => pick("")} className="block w-full rounded-sm px-2 py-1.5 text-left text-13 text-tertiary hover:bg-layer-transparent-hover">—</button>
        {opts.map((o) => (
          <button key={o.v} type="button" onClick={() => pick(o.v, o.color)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-13 text-primary hover:bg-layer-transparent-hover">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.color || "#7a8088" }} />
            <span className="truncate">{labels[o.v] ?? o.v}</span>
          </button>
        ))}
      </div>
    );
  },
};

interface StarProps { readonly kind: "star-cell"; readonly rating: number; }
type StarCell = CustomCell<StarProps>;
const starRenderer: CustomRenderer<StarCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is StarCell => (c.data as { kind?: string }).kind === "star-cell",
  onPaste: (v, d) => ({ ...d, rating: Math.max(0, Math.min(5, Number(v) || 0)) }),
  draw: (args, cell) => {
    const { ctx, theme, rect } = args;
    const r = cell.data.rating || 0;
    ctx.save();
    ctx.font = `15px ${theme.fontFamily}`;
    ctx.textBaseline = "middle";
    let x = rect.x + theme.cellHorizontalPadding;
    const y = rect.y + rect.height / 2;
    for (let i = 1; i <= 5; i++) {
      ctx.fillStyle = i <= r ? "#f5a623" : theme.textLight;
      ctx.fillText(i <= r ? "★" : "☆", x, y);
      x += 16;
    }
    ctx.restore();
    return true;
  },
  provideEditor: () => (p) => {
    const cell = p.value as StarCell;
    const r = cell.data.rating || 0;
    return (
      <div className="flex items-center gap-1 bg-surface-1 px-3 py-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" onClick={() => { const nv = i === r ? i - 1 : i; p.onFinishedEditing({ ...cell, copyData: String(nv), data: { ...cell.data, rating: nv } }); }} className="text-lg leading-none" style={{ color: i <= r ? "#f5a623" : "#c4c4c4" }}>
            {i <= r ? "★" : "☆"}
          </button>
        ))}
      </div>
    );
  },
};

interface ProgProps { readonly kind: "prog-cell"; readonly value: number; }
type ProgCell = CustomCell<ProgProps>;
const progressRenderer: CustomRenderer<ProgCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is ProgCell => (c.data as { kind?: string }).kind === "prog-cell",
  onPaste: (v, d) => ({ ...d, value: Math.max(0, Math.min(100, Number(v) || 0)) }),
  draw: (args, cell) => {
    const { ctx, theme, rect } = args;
    const pct = Math.max(0, Math.min(100, cell.data.value || 0));
    const pad = theme.cellHorizontalPadding;
    const barH = 6;
    const w = Math.max(20, rect.width - 2 * pad - 38);
    const x = rect.x + pad;
    const y = rect.y + rect.height / 2 - barH / 2;
    roundRect(ctx, x, y, w, barH, 3);
    ctx.fillStyle = theme.accentColor + "26";
    ctx.fill();
    if (pct > 0) {
      roundRect(ctx, x, y, (w * pct) / 100, barH, 3);
      ctx.fillStyle = theme.accentColor;
      ctx.fill();
    }
    ctx.fillStyle = theme.textMedium;
    ctx.font = `11px ${theme.fontFamily}`;
    ctx.textBaseline = "middle";
    ctx.fillText(`${pct}%`, x + w + 6, rect.y + rect.height / 2);
    return true;
  },
  provideEditor: () => (p) => {
    const cell = p.value as ProgCell;
    return (
      <input
        type="number"
        min={0}
        max={100}
        autoFocus
        defaultValue={cell.data.value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => p.onChange({ ...cell, copyData: e.target.value, data: { ...cell.data, value: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })}
        className="w-full bg-surface-1 px-2 py-1.5 text-13 text-primary outline-none"
      />
    );
  },
};

export const CUSTOM_RENDERERS = [tagRenderer, starRenderer, progressRenderer, ...allCells];

export const TYPE_META: { v: TSmartColumnType; zh: string; ja: string; Icon: React.ElementType }[] = [
  { v: "text", zh: "文本", ja: "テキスト", Icon: Type },
  { v: "number", zh: "数字", ja: "数値", Icon: Hash },
  { v: "single_select", zh: "单选", ja: "単一選択", Icon: CircleDot },
  { v: "multi_select", zh: "多选", ja: "複数選択", Icon: List },
  { v: "date", zh: "日期", ja: "日付", Icon: Calendar },
  { v: "checkbox", zh: "勾选", ja: "チェック", Icon: Check },
  { v: "url", zh: "链接", ja: "リンク", Icon: Link2 },
  { v: "image", zh: "图片", ja: "画像", Icon: ImageIcon },
  { v: "money", zh: "金额", ja: "金額", Icon: DollarSign },
  { v: "rating", zh: "评分", ja: "評価", Icon: Star },
  { v: "progress", zh: "进度", ja: "進捗", Icon: Percent },
  { v: "range", zh: "滑块", ja: "スライダー", Icon: SlidersHorizontal },
  { v: "sparkline", zh: "折线图", ja: "スパークライン", Icon: TrendingUp },
  { v: "user", zh: "成员", ja: "メンバー", Icon: User },
];

// 列类型 → 表头图标(glide 内置 sprite, 跟随 textHeader 色)
export const TYPE_HEADER_ICON: Record<TSmartColumnType, GridColumnIcon> = {
  text: GridColumnIcon.HeaderString,
  number: GridColumnIcon.HeaderNumber,
  single_select: GridColumnIcon.HeaderSingleValue,
  multi_select: GridColumnIcon.HeaderArray,
  date: GridColumnIcon.HeaderDate,
  checkbox: GridColumnIcon.HeaderBoolean,
  url: GridColumnIcon.HeaderUri,
  image: GridColumnIcon.HeaderImage,
  money: GridColumnIcon.HeaderMath,
  rating: GridColumnIcon.HeaderNumber,
  progress: GridColumnIcon.HeaderNumber,
  range: GridColumnIcon.HeaderNumber,
  sparkline: GridColumnIcon.HeaderMath,
  user: GridColumnIcon.HeaderEmoji,
};

// 列类型 → 默认列宽(px). 主网格(root)与卡片侧网格(rollup/candidates)共用一套,
// 行为一致: 固定宽度 → 窄屏不挤扁、超出即横向滚动(grow 会自动挤满 → 永不溢出 → 无滚动条, 已弃用).
export function defaultColW(type: TSmartColumnType): number {
  switch (type) {
    case "text": return 200;
    case "single_select":
    case "multi_select": return 150;
    case "date":
    case "checkbox": return 116;
    case "image": return 96;
    case "money":
    case "number": return 120;
    default: return 140;
  }
}

// glide 的 `grow` 配 width="100%" 测不到容器宽就不分配(列停在基础宽 → 右侧大片空, 看着不像 data-grid)。
// 自己用 ResizeObserver 实测容器像素宽, 显式喂给 DataEditor + 撑满 flex 列 → 填满/溢出滚动都可控。
// 用 callback ref(非 useEffect+[]): 节点真正挂载时才装 observer → 异步数据/条件渲染(SWR 首渲染 return null)也稳;
// 否则 effect 在 ref.current 还是 null 时跑一次就不再跑, gridW 永远 0 → 不撑满 → 右侧空白列(2026-06-14 汇总表实锤)。
export function useGridWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [w, setW] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const cb = useCallback((node: T | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw) setW(Math.round(cw));
    });
    ro.observe(node);
    roRef.current = ro;
    setW(Math.round(node.clientWidth));
  }, []);
  return [cb, w];
}

// 网格布局: 把列宽精确填到「容器内容宽」(= gridW - 2px 边框), 余量按比例摊给 flex 列、
// **最后一个 flex 列吃余数 → 总和严丝合缝等于内容宽(零缝、无右侧空列)**; 喂给 glide 的 width 也用这个内容宽
// → 画布==内容区, 不会因 2px 边框冒出横向条→再顶出纵向条(2026-06-15 连环坑根治)。
// override(用户拖宽, 内存态)固定不参与摊派 → 拖的宽稳住; 若全被 override 仍留一列兜底吸收。
// 返回 overflow: 列总宽 > 内容宽(窄屏/拖宽超界)→ 调用方据此给容器高 +滚动条高, 避免纵向条。
export function gridFill(
  cols: { id: string; base: number; flex: boolean }[],
  gridW: number,
  overrides: Record<string, number> = {}
): { widths: Record<string, number>; totalW: number; overflow: boolean } {
  const inner = gridW > 2 ? gridW - 2 : 0;
  const widths: Record<string, number> = {};
  for (const c of cols) widths[c.id] = Math.max(40, overrides[c.id] ?? c.base);
  const used = cols.reduce((s, c) => s + widths[c.id], 0);
  if (inner && inner > used) {
    let pool = cols.filter((c) => c.flex && overrides[c.id] == null);
    if (!pool.length) pool = cols.filter((c) => c.flex); // 全被拖过 → 仍兜底填满
    if (pool.length) {
      const slack = inner - used;
      const fb = pool.reduce((s, c) => s + widths[c.id], 0) || 1;
      let acc = 0;
      pool.forEach((c, i) => {
        const add = i === pool.length - 1 ? slack - acc : Math.round((slack * widths[c.id]) / fb);
        widths[c.id] += add;
        acc += add;
      });
    }
  }
  const totalW = cols.reduce((s, c) => s + widths[c.id], 0);
  return { widths, totalW, overflow: !!inner && totalW > inner };
}

// ── 列类型 → glide cell(唯一映射). editable=false → 只读(投影/派生列). lang=显示语言(schema i18n overlay). ──
export function cellForColumn(col: TSmartColumn, raw: unknown, dark: boolean, editable: boolean, lang?: string): GridCell {
  switch (col.type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw ?? "");
      return { kind: GridCellKind.Number, data: Number.isFinite(n) ? n : undefined, displayData: raw == null || raw === "" ? "" : String(raw), allowOverlay: editable, contentAlign: "right" };
    }
    case "checkbox":
      return { kind: GridCellKind.Boolean, data: !!raw, allowOverlay: false, readonly: !editable };
    case "single_select": {
      const v = raw == null ? "" : String(raw);
      const opt = col.options.find((o) => o.v === v);
      const labels = (lang && col.i18n?.[lang]?.options) || undefined;
      return { kind: GridCellKind.Custom, allowOverlay: editable, copyData: v, data: { kind: "tag-cell", label: v && labels?.[v] ? labels[v] : v, color: opt?.color || (dark ? "#959a9d" : "#7a8088"), options: col.options, storeV: v, optLabels: labels } } as TagCell;
    }
    case "multi_select": {
      const arr = Array.isArray(raw) ? raw.map(String) : [];
      return { kind: GridCellKind.Custom, allowOverlay: editable, copyData: arr.join(", "), data: { kind: "multi-select-cell", values: arr, options: col.options.map((o) => ({ value: o.v, label: o.v, color: o.color })), allowCreation: false } } as unknown as GridCell;
    }
    case "date": {
      const s = raw == null ? "" : String(raw);
      const dt = s ? new Date(s) : undefined;
      return { kind: GridCellKind.Custom, allowOverlay: editable, copyData: s, data: { kind: "date-picker-cell", date: dt && !isNaN(dt.getTime()) ? dt : undefined, displayDate: s, format: "date" } } as unknown as GridCell;
    }
    case "url": {
      const v = raw == null ? "" : String(raw);
      return { kind: GridCellKind.Uri, data: v, allowOverlay: editable, readonly: !editable };
    }
    case "image": {
      const arr = Array.isArray(raw) ? raw.map(String).filter(Boolean) : raw ? [String(raw)] : [];
      // !!! glide 6.x 倒置语义(image-cell.js): overlay の canWrite = `readonly !== false`。
      // つまり readonly:false → 只読浮層 / readonly:true|undefined → 可写 — 直感と真逆。
      // ここは逆向きに書く: 可写=readonly 省略, 只読=readonly:false。(BS-294 图片上传不可の真因)
      return editable
        ? ({ kind: GridCellKind.Image, data: arr, allowAdd: true, allowOverlay: true } as GridCell)
        : ({ kind: GridCellKind.Image, data: arr, allowAdd: false, readonly: false, allowOverlay: true } as GridCell);
    }
    case "money": {
      const n = typeof raw === "number" ? raw : Number(raw ?? "");
      return { kind: GridCellKind.Number, data: Number.isFinite(n) ? n : undefined, displayData: raw == null || raw === "" ? "" : "¥" + Number(n).toLocaleString("ja-JP"), allowOverlay: editable, contentAlign: "right" };
    }
    case "rating":
      return { kind: GridCellKind.Custom, allowOverlay: editable, copyData: String(raw ?? ""), data: { kind: "star-cell", rating: Number(raw) || 0 } } as StarCell;
    case "progress":
      return { kind: GridCellKind.Custom, allowOverlay: editable, copyData: String(raw ?? ""), data: { kind: "prog-cell", value: Number(raw) || 0 } } as ProgCell;
    case "range":
      return { kind: GridCellKind.Custom, allowOverlay: editable, copyData: String(raw ?? ""), data: { kind: "range-cell", min: 0, max: 100, value: Number(raw) || 0, step: 1, label: String(Number(raw) || 0) } } as unknown as GridCell;
    case "sparkline": {
      const vals = String(raw ?? "").split(/[,，\s]+/).map(Number).filter((x) => !isNaN(x));
      return { kind: GridCellKind.Custom, allowOverlay: false, copyData: String(raw ?? ""), data: { kind: "sparkline-cell", values: vals.length ? vals : [0], color: dark ? "#2893cc" : "#006399", graphKind: "line", yAxis: [Math.min(0, ...vals), Math.max(1, ...vals)] } } as unknown as GridCell;
    }
    case "user": {
      const name = raw == null ? "" : String(raw);
      const tint = ["#e0567a", "#c9921f", "#2f7fd1", "#13a3a3", "#16a34a", "#7c5cff"][(name.charCodeAt(0) || 0) % 6];
      return { kind: GridCellKind.Custom, allowOverlay: false, copyData: name, data: { kind: "user-profile-cell", image: "", initial: (name.trim()[0] || "?").toUpperCase(), tint, name } } as unknown as GridCell;
    }
    default:
      return { kind: GridCellKind.Text, data: raw == null ? "" : String(raw), displayData: raw == null ? "" : String(raw), allowOverlay: editable };
  }
}

// ── glide 编辑结果 → 落库值(反向). skip=true → 不处理(只读 cell 等). ──
export function coerceEditedValue(val: EditableGridCell): { skip: boolean; value: unknown } {
  if (val.kind === GridCellKind.Number) return { skip: false, value: val.data ?? null };
  if (val.kind === GridCellKind.Boolean) return { skip: false, value: !!val.data };
  if (val.kind === GridCellKind.Text) return { skip: false, value: val.data };
  if (val.kind === GridCellKind.Uri) return { skip: false, value: val.data };
  // B-2q: 空串=清除语义(浮層 × 钮 onChange(\"\")) → 滤掉, 清空落 []
  if (val.kind === GridCellKind.Image) return { skip: false, value: ((val.data as string[]) ?? []).filter(Boolean) };
  if (val.kind === GridCellKind.Custom) {
    const d = val.data as { kind?: string; label?: string; storeV?: string; rating?: number; value?: number; date?: Date; values?: string[] };
    const value =
      d.kind === "star-cell" ? (d.rating ?? null)
        : d.kind === "prog-cell" || d.kind === "range-cell" ? (d.value ?? null)
          : d.kind === "date-picker-cell" ? (d.date ? new Date(d.date).toISOString().slice(0, 10) : null)
            : d.kind === "multi-select-cell" ? (d.values ?? [])
              : d.kind === "tag-cell" ? (d.storeV !== undefined ? (d.storeV || null) : (d.label || null)) // 落原值, 绝不落译文
                : d.label || null;
    return { skip: false, value };
  }
  return { skip: true, value: null };
}

// ── 图片单元格编辑器(glide imageEditorOverride) ─────────────────────────────
// B-2p: 用户主路径=截图→Cmd+V(glide 不处理剪贴板图片 blob → 浮層 onPaste 捕获)。
// B-2q 打磨: 清除×(空串→coerce 滤为[]) / 拖拽上传 / 点图新窗看大图 / 上传中
// 蒙层 / 失败显式红字 / zh·ja 文案。浮層全程存活(无对话框抢焦点)= 最可靠路径。
type ImgEditorProps = { urls: readonly string[]; canWrite: boolean; onChange: (newImage: string) => void; onCancel: () => void };

export function makeImageEditor(upload?: (file: File) => Promise<string | null>) {
  return function SmartImageEditor({ urls, canWrite, onChange }: ImgEditorProps) {
    const zh = useZh();
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(false);
    const [drag, setDrag] = useState(false);
    const cur = urls.filter(Boolean)[0] ?? "";
    const T = zh
      ? { empty: "⌘V 粘贴截图,或拖拽图片到此", uploading: "上传中…", upload: "上传图片", replace: "替换图片", clear: "清除", urlPh: "或粘贴图片 URL 后回车", fail: "上传失败,请重试", zoom: "点击查看大图" }
      : { empty: "⌘V でスクショ貼付け / 画像をドラッグ", uploading: "アップロード中…", upload: "画像をアップロード", replace: "画像を差し替え", clear: "クリア", urlPh: "または画像 URL を貼って Enter", fail: "アップロード失敗・再試行を", zoom: "クリックで拡大" };
    const doUpload = async (f: File) => {
      setErr(false);
      setBusy(true);
      const u = await upload!(f);
      setBusy(false);
      if (u) onChange(u);
      else setErr(true); // B-2o 教训: 失败绝不静默
    };
    const pickImageFile = (dt: DataTransfer | null): File | null => {
      if (!dt) return null;
      const item = Array.from(dt.items ?? []).find((i) => i.type.startsWith("image/"));
      return item?.getAsFile() ?? Array.from(dt.files ?? []).find((f) => f.type.startsWith("image/")) ?? null;
    };
    return (
      <div
        className="flex w-72 flex-col gap-2 bg-surface-1 p-3"
        onPaste={(e) => {
          if (!canWrite || !upload || busy) return;
          const f = pickImageFile(e.clipboardData);
          if (!f) return; // 非图片粘贴(如 URL 文本)交给 input 默认行为
          e.preventDefault();
          void doUpload(f);
        }}
        onDragOver={(e) => {
          if (!canWrite || !upload) return;
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          setDrag(false);
          if (!canWrite || !upload || busy) return;
          e.preventDefault();
          const f = pickImageFile(e.dataTransfer);
          if (f) void doUpload(f);
        }}
      >
        {cur ? (
          <div className="group relative">
            <a href={cur} target="_blank" rel="noreferrer" title={T.zoom}>
              <img src={cur} alt="" className={`max-h-44 w-full rounded-md object-contain ${busy ? "opacity-40" : ""}`} />
            </a>
            {busy && (
              <div className="absolute inset-0 flex items-center justify-center text-12 font-medium text-secondary">{T.uploading}</div>
            )}
            {canWrite && !busy && (
              <button
                type="button"
                title={T.clear}
                onClick={() => onChange("")}
                className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/55 text-11 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        ) : (
          <div
            className={`flex h-24 items-center justify-center rounded-md border border-dashed px-3 text-center text-11 transition-colors ${
              drag ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle text-placeholder"
            }`}
          >
            {busy ? T.uploading : T.empty}
          </div>
        )}
        {canWrite && (
          <>
            <div className="flex items-center gap-1.5">
              {upload && (
                <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-12 font-medium text-secondary hover:bg-layer-1-hover">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); }}
                  />
                  {busy ? T.uploading : cur ? T.replace : T.upload}
                </label>
              )}
              {cur && (
                <button
                  type="button"
                  onClick={() => onChange("")}
                  className="shrink-0 rounded-md border border-subtle px-2.5 py-1.5 text-12 text-tertiary hover:border-danger-strong/50 hover:text-danger-primary"
                >
                  {T.clear}
                </button>
              )}
            </div>
            <input
              type="text"
              defaultValue={cur}
              placeholder={T.urlPh}
              onKeyDown={(e) => { if (e.key === "Enter") onChange((e.target as HTMLInputElement).value.trim()); }}
              className="w-full rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1.5 text-11 text-primary outline-none placeholder:text-placeholder"
            />
            {err && <div className="text-11 text-danger-primary">{T.fail}</div>}
          </>
        )}
      </div>
    );
  };
}
