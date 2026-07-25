/**
 * BARSOUL 審査カード構成エディタ（2026-07-25, hechun「原子組件を組める」）
 *
 * 発起の瞬間まで、カードの中身は愛ちゃんの自動組成任せで **人には見えなかった**。
 * ここはそれを開ける —— 何が載るのかを見せ、並べ替え・書き換え・足し引きを許す。
 *
 * 設計の芯:
 *   ・**見えているものが、そのまま載る**。プレビューでも要約でもなく構成そのもの。
 *     編集した結果は invoke の blocks として送られ、愛ちゃんの再組成は走らない。
 *   ・原子ごとの画面を書かない。schema.ts の宣言表からフォームを生やす（種類が
 *     増えても UI は増えない）。
 *   ・**触らなければ従来どおり**。人が一度も編集しなければ愛ちゃんの提案が
 *     そのまま通る —— 「使える」が「使わされる」にならない線。
 *   ・折り畳み既定。決裁の主役は件名・審査者・方式であって、構成は「開けば触れる」
 *     二段目に置く。
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlignLeft,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Info,
  JapaneseYen,
  Layers,
  LayoutGrid,
  Link2,
  ListChecks,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Rows3,
  Table as TableIcon,
  Tag,
  Trash2,
} from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";
// local
import { ATOM_SPECS, itemDone, itemText, specOf } from "./schema";
import type { TAtom, TAtomField, TAtomRow } from "./schema";

const ICONS: Record<string, React.ReactNode> = {
  header: <Heading1 className="size-3.5" />,
  section: <Heading2 className="size-3.5" />,
  detail: <AlignLeft className="size-3.5" />,
  kv: <Rows3 className="size-3.5" />,
  kvgrid: <LayoutGrid className="size-3.5" />,
  table: <TableIcon className="size-3.5" />,
  amount: <JapaneseYen className="size-3.5" />,
  callout: <Info className="size-3.5" />,
  list: <ListChecks className="size-3.5" />,
  badge: <Tag className="size-3.5" />,
  ref: <Link2 className="size-3.5" />,
  compare: <ArrowLeftRight className="size-3.5" />,
  image: <ImageIcon className="size-3.5" />,
  divider: <Minus className="size-3.5" />,
};

type Props = {
  atoms: TAtom[];
  onChange: (next: TAtom[]) => void;
  /** 愛ちゃんの提案を取り直す。実行中は true。 */
  onRegenerate: () => void;
  regenerating: boolean;
  /** 人が一度でも触ったか。触っていれば「あなたの構成」と明示する。 */
  edited: boolean;
  /**
   * 折り畳みの開閉。**開いた瞬間に初回取得する** ため親に上げる ——
   * 開かない人に愛ちゃんの組成 1 回分を払わせない（発起の大半は素通り）。
   */
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
};

export function ApprovalAtomComposer(props: Props) {
  const { atoms, onChange, onRegenerate, regenerating, edited, onOpenChange, disabled } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number>(-1);
  const [adding, setAdding] = useState(false);

  const patch = useCallback(
    (index: number, next: TAtom) => onChange(atoms.map((a, i) => (i === index ? next : a))),
    [atoms, onChange]
  );

  const move = useCallback(
    (index: number, delta: number) => {
      const to = index + delta;
      if (to < 0 || to >= atoms.length) return;
      const next = [...atoms];
      [next[index], next[to]] = [next[to], next[index]];
      onChange(next);
      setEditing((cur) => (cur === index ? to : cur === to ? index : cur));
    },
    [atoms, onChange]
  );

  const remove = useCallback(
    (index: number) => {
      onChange(atoms.filter((_, i) => i !== index));
      setEditing(-1);
    },
    [atoms, onChange]
  );

  const append = useCallback(
    (type: string) => {
      const sp = specOf(type);
      if (!sp) return;
      onChange([...atoms, sp.make()]);
      setEditing(atoms.length);
      setAdding(false);
    },
    [atoms, onChange]
  );

  const countLabel = useMemo(() => t("approval_atoms.count", { count: atoms.length }), [atoms.length, t]);

  return (
    <div className="rounded-md border border-subtle">
      {/* ── 見出し（折り畳み）───────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => {
          // setState の updater 内で副作用を呼ばない（StrictMode で二重発火し、
          // 初回取得が 2 回走る）。open は素直に外で反転させる。
          const next = !open;
          setOpen(next);
          onOpenChange?.(next);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-tertiary" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-tertiary" />
        )}
        <Layers className="size-3.5 shrink-0 text-tertiary" />
        <span className="text-sm font-medium text-secondary">{t("approval_atoms.title")}</span>
        <span className="text-xs text-tertiary">{countLabel}</span>
        {edited && (
          <span className="text-xs rounded-full border border-subtle px-1.5 py-0.5 text-tertiary">
            {t("approval_atoms.edited_tag")}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-subtle px-3 py-2.5">
          <p className="text-xs text-tertiary">{t("approval_atoms.hint")}</p>

          {atoms.length === 0 ? (
            <p className="text-xs py-2 text-tertiary">{t("approval_atoms.empty")}</p>
          ) : (
            <ul className="space-y-1">
              {atoms.map((atom, i) => (
                <AtomRow
                  key={`${String(atom.type)}-${i}`}
                  atom={atom}
                  index={i}
                  last={i === atoms.length - 1}
                  expanded={editing === i}
                  disabled={disabled}
                  onToggle={() => setEditing((cur) => (cur === i ? -1 : i))}
                  onPatch={(next) => patch(i, next)}
                  onMove={(d) => move(i, d)}
                  onRemove={() => remove(i)}
                />
              ))}
            </ul>
          )}

          {/* ── 追加パレット + 提案取り直し ──────────────────────────── */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              disabled={disabled}
              className="text-xs flex items-center gap-1 rounded border border-subtle px-1.5 py-1 text-secondary transition-colors hover:bg-layer-1 hover:text-primary disabled:opacity-50"
            >
              <Plus className="size-3" />
              {t("approval_atoms.add")}
            </button>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={disabled || regenerating}
              className="text-xs flex items-center gap-1 rounded border border-subtle px-1.5 py-1 text-secondary transition-colors hover:bg-layer-1 hover:text-primary disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", regenerating && "animate-spin")} />
              {t("approval_atoms.regenerate")}
            </button>
          </div>

          {adding && (
            <div className="flex flex-wrap gap-1 rounded-md bg-layer-1 p-2">
              {ATOM_SPECS.map((sp) => (
                <button
                  key={sp.type}
                  type="button"
                  onClick={() => append(sp.type)}
                  className="text-xs flex items-center gap-1 rounded border border-subtle bg-surface-1 px-1.5 py-1 text-secondary transition-colors hover:border-strong hover:text-primary"
                >
                  {ICONS[sp.type]}
                  {t(`approval_atoms.type_${sp.type}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 1 原子 ──────────────────────────────────────────────────────────── */

type RowProps = {
  atom: TAtom;
  index: number;
  last: boolean;
  expanded: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onPatch: (next: TAtom) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
};

function AtomRow({ atom, index, last, expanded, disabled, onToggle, onPatch, onMove, onRemove }: RowProps) {
  const { t } = useTranslation();
  const sp = specOf(atom.type);
  if (!sp) return null;
  const summary = sp.summary(atom);

  return (
    <li className="rounded border border-subtle bg-layer-1">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="shrink-0 text-tertiary">{ICONS[sp.type]}</span>
        <span className="text-xs shrink-0 text-tertiary">{t(`approval_atoms.type_${sp.type}`)}</span>
        <span className={cn("text-xs min-w-0 flex-1 truncate", summary ? "text-secondary" : "text-tertiary")}>
          {summary || t("approval_atoms.blank")}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconBtn label={t("approval_atoms.move_up")} onClick={() => onMove(-1)} disabled={disabled || index === 0}>
            <ArrowUp className="size-3" />
          </IconBtn>
          <IconBtn label={t("approval_atoms.move_down")} onClick={() => onMove(1)} disabled={disabled || last}>
            <ArrowDown className="size-3" />
          </IconBtn>
          {sp.fields.length > 0 && (
            <IconBtn label={t("approval_atoms.edit")} onClick={onToggle} disabled={disabled} active={expanded}>
              <Pencil className="size-3" />
            </IconBtn>
          )}
          <IconBtn label={t("approval_atoms.remove")} onClick={onRemove} disabled={disabled}>
            <Trash2 className="size-3" />
          </IconBtn>
        </div>
      </div>

      {expanded && sp.fields.length > 0 && (
        <div className="space-y-2 border-t border-subtle px-2 py-2">
          {sp.fields.map((f) => (
            <AtomField key={f.key} field={f} atom={atom} onPatch={onPatch} />
          ))}
        </div>
      )}
    </li>
  );
}

function IconBtn(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  const { label, onClick, disabled, active, children } = props;
  return (
    <Tooltip tooltipContent={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          "grid size-5 place-items-center rounded text-tertiary transition-colors hover:bg-layer-2 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40",
          active && "text-accent-primary"
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/* ── 宣言表からフォームを生やす ─────────────────────────────────────── */

const INPUT_CLS =
  "w-full rounded border border-subtle bg-surface-1 px-1.5 py-1 text-xs text-primary outline-none focus:border-strong placeholder:text-tertiary";

function AtomField({ field, atom, onPatch }: { field: TAtomField; atom: TAtom; onPatch: (n: TAtom) => void }) {
  const { t } = useTranslation();
  const set = (key: string, value: unknown) => onPatch({ ...atom, [key]: value });

  if (field.kind === "line" || field.kind === "multiline") {
    const value = typeof atom[field.key] === "string" ? (atom[field.key] as string) : "";
    return (
      <label className="block space-y-1">
        <span className="text-xs text-tertiary">{t(`approval_atoms.${field.label}`)}</span>
        {field.kind === "line" ? (
          <input value={value} onChange={(e) => set(field.key, e.target.value)} className={INPUT_CLS} />
        ) : (
          <textarea
            value={value}
            rows={3}
            onChange={(e) => set(field.key, e.target.value)}
            className={cn(INPUT_CLS, "resize-none")}
          />
        )}
      </label>
    );
  }

  if (field.kind === "select") {
    const value = typeof atom[field.key] === "string" ? (atom[field.key] as string) : field.options[0];
    return (
      <label className="block space-y-1">
        <span className="text-xs text-tertiary">{t(`approval_atoms.${field.label}`)}</span>
        <div className="flex flex-wrap gap-1">
          {field.options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => set(field.key, opt)}
              className={cn(
                "text-xs rounded border px-1.5 py-0.5 transition-colors",
                value === opt
                  ? "border-accent-primary text-accent-primary"
                  : "border-subtle text-tertiary hover:text-primary"
              )}
            >
              {t(`approval_atoms.opt_${opt}`)}
            </button>
          ))}
        </div>
      </label>
    );
  }

  if (field.kind === "rows") {
    const rows: TAtomRow[] = Array.isArray(atom.rows) ? (atom.rows as TAtomRow[]) : [];
    const setRows = (next: TAtomRow[]) => set("rows", next);
    return (
      <div className="space-y-1">
        <div className="flex gap-1">
          {field.cols.map((c) => (
            <span key={c.key} className="text-xs flex-1 text-tertiary">
              {t(`approval_atoms.${c.label}`)}
            </span>
          ))}
          <span className="w-5" />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1">
            {field.cols.map((c) => (
              <input
                key={c.key}
                value={typeof row?.[c.key] === "string" ? row[c.key] : ""}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, [c.key]: e.target.value } : r)))}
                className={cn(INPUT_CLS, "flex-1")}
              />
            ))}
            <IconBtn label={t("approval_atoms.remove")} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <Trash2 className="size-3" />
            </IconBtn>
          </div>
        ))}
        <AddLine
          label={t("approval_atoms.add_row")}
          onClick={() => setRows([...rows, Object.fromEntries(field.cols.map((c) => [c.key, ""]))])}
        />
      </div>
    );
  }

  if (field.kind === "items") {
    const items: unknown[] = Array.isArray(atom.items) ? (atom.items as unknown[]) : [];
    const setItems = (next: unknown[]) => set("items", next);
    return (
      <div className="space-y-1">
        <span className="text-xs text-tertiary">{t("approval_atoms.f_items")}</span>
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-1">
            {/* ✓/○ は既存カードの字面そのもの（emoji ではない幾何記号）。 */}
            <button
              type="button"
              onClick={() => setItems(items.map((x, j) => (j === i ? { text: itemText(x), done: !itemDone(x) } : x)))}
              aria-label={t("approval_atoms.toggle_done")}
              className="text-xs grid size-5 shrink-0 place-items-center rounded text-tertiary hover:text-primary"
            >
              {itemDone(it) ? "✓" : "○"}
            </button>
            <input
              value={itemText(it)}
              onChange={(e) =>
                setItems(items.map((x, j) => (j === i ? { text: e.target.value, done: itemDone(x) } : x)))
              }
              className={cn(INPUT_CLS, "flex-1")}
            />
            <IconBtn label={t("approval_atoms.remove")} onClick={() => setItems(items.filter((_, j) => j !== i))}>
              <Trash2 className="size-3" />
            </IconBtn>
          </div>
        ))}
        <AddLine label={t("approval_atoms.add_item")} onClick={() => setItems([...items, { text: "", done: false }])} />
      </div>
    );
  }

  // table: 列名 + 「1 行 = 縦棒区切り」。表を格子で編集させるより速く、
  // 貼り付けも効く（決裁カードの表はせいぜい数行という前提での割り切り）。
  const cols: string[] = Array.isArray(atom.cols) ? (atom.cols as unknown[]).map((c) => String(c ?? "")) : [];
  const rows: unknown[][] = Array.isArray(atom.rows) ? (atom.rows as unknown[][]) : [];
  const rowsText = rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")).join(" | ") : "")).join("\n");
  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-xs text-tertiary">{t("approval_atoms.f_cols")}</span>
        <input
          value={cols.join(" | ")}
          onChange={(e) =>
            set(
              "cols",
              e.target.value.split("|").map((c) => c.trim())
            )
          }
          className={INPUT_CLS}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-tertiary">{t("approval_atoms.f_rows_pipe")}</span>
        <textarea
          value={rowsText}
          rows={3}
          onChange={(e) =>
            set(
              "rows",
              e.target.value
                .split("\n")
                .filter((line) => line.trim())
                .map((line) => line.split("|").map((c) => c.trim()))
            )
          }
          className={cn(INPUT_CLS, "font-mono resize-none")}
        />
      </label>
    </div>
  );
}

function AddLine({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs flex items-center gap-1 text-tertiary transition-colors hover:text-accent-primary"
    >
      <Plus className="size-3" />
      {label}
    </button>
  );
}
