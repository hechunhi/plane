/**
 * BARSOUL: 宽表「行 → 转置详情」居中弹层。各取所长:
 * - editable=true(可编辑表 主表/候选): 用 SmartTableRecordGrid(glide 转置, 字段成行) →
 *   富类型编辑体验(单选浮层/日期选择器/星级/图片), 与主表格同一套 cell 逻辑、零降级;
 *   编辑回 onEdit 写 manual cells(绝不碰 SoR)。
 * - editable=false(只读汇总/派生 rollup): 用纯 HTML <dl> → 文本可选中复制(canvas 做不到的)。
 * 受控 cells 走本地 state 即时反映 + 同步 onEdit 落库; 重开不同行随 cells prop 重置。
 * portal+data-prevent-outside-click: 不被表格 stacking 困, 不误关 peek。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import type { TSmartColumn } from "@/services/smart-table.service";
import { SmartTableRecordGrid } from "./smart-table-record-grid";

type Props = {
  title?: string;
  subtitle?: string;
  columns: TSmartColumn[];
  cells: Record<string, unknown>;
  editable?: boolean;
  onEdit?: (key: string, value: unknown) => void;
  imageUpload?: (file: File) => Promise<string | null>;
  onClose: () => void;
};

const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-12 font-medium select-text"
      style={{ color, backgroundColor: `${color}1f` }}
    >
      {label}
    </span>
  );
}

// 只读值渲染(展示态, 可选中复制) —— 仅 editable=false(rollup 汇总)用
function FieldValue({ col, raw, zh }: { col: TSmartColumn; raw: unknown; zh: boolean }) {
  const lang = zh ? "zh" : "ja";
  if (isEmpty(raw)) return <span className="text-placeholder">—</span>;
  switch (col.type) {
    case "single_select": {
      const sv = String(raw);
      const opt = (col.options ?? []).find((o) => o.v === sv);
      return <Tag label={col.i18n?.[lang]?.options?.[sv] || sv} color={opt?.color || "#7a8088"} />;
    }
    case "multi_select": {
      const arr = Array.isArray(raw) ? raw.map(String) : [];
      return (
        <span className="flex flex-wrap gap-1">
          {arr.map((sv) => {
            const opt = (col.options ?? []).find((o) => o.v === sv);
            return <Tag key={sv} label={col.i18n?.[lang]?.options?.[sv] || sv} color={opt?.color || "#7a8088"} />;
          })}
        </span>
      );
    }
    case "checkbox":
      return <span>{raw ? "✓" : "—"}</span>;
    case "money":
      return <span className="tabular-nums select-text">¥{Number(raw).toLocaleString("ja-JP")}</span>;
    case "number":
    case "range":
    case "progress":
      return <span className="tabular-nums select-text">{String(raw)}</span>;
    case "rating": {
      const n = Number(raw) || 0;
      return (
        <span style={{ color: "#f5a623" }}>
          {"★".repeat(n)}
          <span className="text-tertiary">{"☆".repeat(Math.max(0, 5 - n))}</span>
        </span>
      );
    }
    case "url":
      return (
        <a
          href={String(raw)}
          target="_blank"
          rel="noreferrer"
          className="break-all text-accent-primary select-text hover:underline"
        >
          {String(raw)}
        </a>
      );
    case "image": {
      const arr = Array.isArray(raw) ? raw.map(String).filter(Boolean) : raw ? [String(raw)] : [];
      return (
        <span className="flex flex-wrap gap-1.5">
          {arr.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer">
              <img src={u} alt="" className="h-14 w-14 rounded border border-subtle object-cover" />
            </a>
          ))}
        </span>
      );
    }
    default:
      return <span className="break-words whitespace-pre-wrap select-text">{String(raw)}</span>;
  }
}

export function SmartTableRowDetailModal({
  title,
  subtitle,
  columns,
  cells,
  editable = false,
  onEdit,
  imageUpload,
  onClose,
}: Props) {
  const zh = useZh();
  const lang = zh ? "zh" : "ja";
  const [local, setLocal] = useState<Record<string, unknown>>(cells);
  useEffect(() => setLocal(cells), [cells]); // 重开不同行 → 随快照重置
  const set = (k: string, v: unknown) => {
    setLocal((p) => ({ ...p, [k]: v })); // 即时反映
    onEdit?.(k, v); // 同步写回(主表 writeCell / 候选 onUpsert)
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
      data-prevent-outside-click="true"
      // 仅点背景本身关闭(target===currentTarget)。★绝不在 panel 上 stopPropagation ——
      //   那会吃掉内嵌 glide 编辑器需要冒泡的事件 = modal 内不可编辑的真因。
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="shadow-overlay-300 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-subtle bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-subtle px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-13 font-semibold text-primary select-text">
              {title || (zh ? "记录详情" : "レコード詳細")}
            </div>
            {subtitle && <div className="truncate text-11 text-tertiary">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={zh ? "关闭" : "閉じる"}
            className="grid size-7 shrink-0 place-items-center rounded-sm text-tertiary hover:bg-layer-1 hover:text-primary"
          >
            <X className="size-4" />
          </button>
        </div>
        {editable ? (
          // 富类型编辑: glide 转置(与主表格同套 cell 体验); canvas 不可选, 但编辑场景=改值不需复制
          <div className="vertical-scrollbar min-h-0 flex-1 overflow-auto p-4">
            <SmartTableRecordGrid columns={columns} cells={local} editable onEdit={set} imageUpload={imageUpload} />
          </div>
        ) : (
          // 只读: HTML, 文本可选中复制
          <dl className="vertical-scrollbar min-h-0 flex-1 divide-y divide-subtle overflow-auto px-4 select-text">
            {columns.map((col) => {
              const name = col.i18n?.[lang]?.name || col.name;
              return (
                <div key={col.key} className="grid grid-cols-[minmax(96px,32%)_1fr] items-start gap-3 py-2.5">
                  <dt className="pt-px text-12 text-tertiary select-text">
                    {name}
                    {col.required ? <span className="text-amber-500"> *</span> : null}
                  </dt>
                  <dd className="text-13 text-primary select-text">
                    <FieldValue col={col} raw={local[col.key]} zh={zh} />
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </div>,
    document.body
  );
}
