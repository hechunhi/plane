/**
 * BARSOUL 審査カードの「原子」定義（2026-07-25, hechun「原子組件を組める」）
 *
 * ここは **一枚の宣言表** —— 原子の種類ごとに「何を編集できるか」だけを書く。
 * UI（composer.tsx）はこの表を読んで機械的にフォームを生やす。原子が増えても
 * UI を書き足さない、が要点（種類 × 画面 の掛け算を作らない）。
 *
 * 種類と schema は Go 側 cards サービスの工具箱目録（`GET /api/toolbox`）に
 * 合わせてある。**こちらは SoR ではない** —— カードの真実は Go 側が持ち、
 * ここは「人が組むための入力形」を写しているだけ。値の検疫（presentation-only
 * 白名单 / href scheme / 動作剥奪）は ai-bot の sanitize_content_blocks が
 * 唯一の関所として行う。前端の型は親切であって、防壁ではない。
 */

export type TAtom = { type: string } & Record<string, unknown>;

/** k/v 系の 1 行。列は種類ごとに違う（kv=k,v / compare=k,before,after）。 */
export type TAtomRow = Record<string, string>;

export type TAtomField =
  | { key: string; kind: "line"; label: string }
  | { key: string; kind: "multiline"; label: string }
  | { key: string; kind: "select"; label: string; options: readonly string[] }
  | { key: "rows"; kind: "rows"; cols: readonly { key: string; label: string }[] }
  | { key: "items"; kind: "items" }
  | { key: "table"; kind: "table" };

export type TAtomSpec = {
  /** i18n キーの末尾（`approval_atoms.type_<name>`）。 */
  type: string;
  fields: readonly TAtomField[];
  /** 「＋追加」で作る空の原子。 */
  make: () => TAtom;
  /** 折り畳み時の 1 行要約（データ由来・翻訳不要な字面のみ）。 */
  summary: (a: TAtom) => string;
};

const s = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const rowsOf = (a: TAtom): TAtomRow[] => (Array.isArray(a.rows) ? (a.rows as TAtomRow[]) : []);

/** list の items は `string | {text, done}` の混在を許す（Go 側の schema がそう）。 */
export const itemText = (it: unknown): string =>
  it && typeof it === "object" ? s((it as Record<string, unknown>).text) : s(it);
export const itemDone = (it: unknown): boolean =>
  !!(it && typeof it === "object" && (it as Record<string, unknown>).done);

const KV_COLS = [
  { key: "k", label: "col_k" },
  { key: "v", label: "col_v" },
] as const;

const CMP_COLS = [
  { key: "k", label: "col_k" },
  { key: "before", label: "col_before" },
  { key: "after", label: "col_after" },
] as const;

/**
 * 原子の宣言表。並び順は「＋追加」パレットの並び順でもある——
 * 上から順に **使う頻度が高く、決裁者に効く** ものを置く（detail は最後）。
 */
export const ATOM_SPECS: readonly TAtomSpec[] = [
  {
    type: "header",
    fields: [{ key: "title", kind: "line", label: "f_title" }],
    make: () => ({ type: "header", title: "" }),
    summary: (a) => s(a.title),
  },
  {
    type: "kv",
    fields: [{ key: "rows", kind: "rows", cols: KV_COLS }],
    make: () => ({ type: "kv", rows: [{ k: "", v: "" }] }),
    summary: (a) =>
      rowsOf(a)
        .map((r) => `${s(r.k)}：${s(r.v)}`)
        .join(" · "),
  },
  {
    type: "kvgrid",
    fields: [{ key: "rows", kind: "rows", cols: KV_COLS }],
    make: () => ({ type: "kvgrid", rows: [{ k: "", v: "" }] }),
    summary: (a) =>
      rowsOf(a)
        .map((r) => s(r.k))
        .filter(Boolean)
        .join(" · "),
  },
  {
    type: "amount",
    fields: [
      { key: "label", kind: "line", label: "f_label" },
      { key: "value", kind: "line", label: "f_value" },
    ],
    make: () => ({ type: "amount", label: "", value: "" }),
    summary: (a) => [s(a.label), s(a.value)].filter(Boolean).join(" "),
  },
  {
    type: "compare",
    fields: [
      { key: "title", kind: "line", label: "f_title" },
      { key: "rows", kind: "rows", cols: CMP_COLS },
    ],
    make: () => ({ type: "compare", title: "", rows: [{ k: "", before: "", after: "" }] }),
    summary: (a) =>
      [
        s(a.title),
        rowsOf(a)
          .map((r) => `${s(r.k)} ${s(r.before)}→${s(r.after)}`)
          .join(" · "),
      ]
        .filter(Boolean)
        .join(" / "),
  },
  {
    type: "list",
    fields: [{ key: "items", kind: "items" }],
    make: () => ({ type: "list", items: [{ text: "", done: false }] }),
    summary: (a) => (Array.isArray(a.items) ? a.items.map(itemText).filter(Boolean).join(" · ") : ""),
  },
  {
    type: "badge",
    fields: [
      { key: "label", kind: "line", label: "f_label" },
      { key: "tone", kind: "select", label: "f_tone", options: ["info", "warn", "ok", "muted"] },
    ],
    make: () => ({ type: "badge", label: "", tone: "info" }),
    summary: (a) => s(a.label),
  },
  {
    type: "callout",
    fields: [
      { key: "tone", kind: "select", label: "f_tone", options: ["info", "warn"] },
      { key: "text", kind: "multiline", label: "f_text" },
    ],
    make: () => ({ type: "callout", tone: "info", text: "" }),
    summary: (a) => s(a.text),
  },
  {
    type: "table",
    fields: [{ key: "table", kind: "table" }],
    make: () => ({ type: "table", cols: ["", ""], rows: [] }),
    summary: (a) => {
      const cols = Array.isArray(a.cols) ? a.cols.map(s).filter(Boolean) : [];
      const n = Array.isArray(a.rows) ? a.rows.length : 0;
      return cols.length ? `${cols.join(" / ")}（${n}）` : "";
    },
  },
  {
    type: "ref",
    fields: [
      { key: "label", kind: "line", label: "f_label" },
      { key: "href", kind: "line", label: "f_href" },
      {
        key: "kind",
        kind: "select",
        label: "f_kind",
        options: ["order", "invoice", "shipping", "issue", "policy", "other"],
      },
    ],
    make: () => ({ type: "ref", label: "", href: "", kind: "other" }),
    summary: (a) => s(a.label) || s(a.href),
  },
  {
    type: "image",
    fields: [
      { key: "src", kind: "line", label: "f_src" },
      { key: "caption", kind: "line", label: "f_caption" },
      { key: "alt", kind: "line", label: "f_alt" },
    ],
    make: () => ({ type: "image", src: "", caption: "" }),
    summary: (a) => s(a.caption) || s(a.src),
  },
  {
    type: "section",
    fields: [{ key: "title", kind: "line", label: "f_title" }],
    make: () => ({ type: "section", title: "" }),
    summary: (a) => s(a.title),
  },
  {
    type: "detail",
    fields: [{ key: "md", kind: "multiline", label: "f_md" }],
    make: () => ({ type: "detail", md: "" }),
    summary: (a) => s(a.md).replace(/\s+/g, " "),
  },
  {
    type: "divider",
    fields: [],
    make: () => ({ type: "divider" }),
    summary: () => "",
  },
] as const;

const BY_TYPE = new Map(ATOM_SPECS.map((sp) => [sp.type, sp]));

export const specOf = (type: unknown): TAtomSpec | undefined => BY_TYPE.get(s(type));

/**
 * 送信前の掃除。空の原子は落とし、行・項目の空要素も落とす。
 * 人が触った直後の下書き状態（空行が 1 本ぶら下がっている等）を
 * そのままカードに焼かないため —— UI の都合をカードに漏らさない。
 */
export function pruneAtoms(atoms: readonly TAtom[]): TAtom[] {
  const out: TAtom[] = [];
  for (const a of atoms) {
    const sp = specOf(a.type);
    if (!sp) continue;
    const next: TAtom = { ...a };
    if (Array.isArray(next.rows)) {
      next.rows = (next.rows as TAtomRow[]).filter((r) => Object.values(r ?? {}).some((v) => s(v).trim()));
    }
    if (Array.isArray(next.items)) {
      next.items = (next.items as unknown[]).filter((it) => itemText(it).trim());
    }
    if (Array.isArray(next.cols)) {
      next.cols = (next.cols as unknown[]).map(s);
    }
    if (next.type === "divider") {
      out.push(next);
      continue;
    }
    // 中身が何も無い原子は「まだ書いていない」ので落とす。
    const hasRows = Array.isArray(next.rows) && next.rows.length > 0;
    const hasItems = Array.isArray(next.items) && next.items.length > 0;
    const hasTableRows = Array.isArray(next.rows) && next.type === "table" && next.rows.length > 0;
    const hasScalar = sp.fields.some((f) => (f.kind === "line" || f.kind === "multiline") && s(next[f.key]).trim());
    if (hasRows || hasItems || hasTableRows || hasScalar) out.push(next);
  }
  return out;
}
