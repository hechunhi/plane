/**
 * BARSOUL 週次ミーティング — サーバ生成 HTML の描画 (hechun 2026-07-24)
 *
 * 下書き HTML は **サーバが決定論的に組み立てた** 限定タグ集合だけを含む
 * (h4 / ul / li / span.wr-ref)。LLM には URL を書かせない — 出処リンクは
 * ここで **クライアント側の routing 知識** を使って作る(産品決定 条件①)。
 *
 * dangerouslySetInnerHTML を使わないのは、リンクを本物のボタンにしたいため:
 * クリックで peek を開けば会議画面から離脱しない(離脱すると議事が途切れる)。
 * 未知タグは文字列として落とす = 将来サーバが何を返しても壊れない。
 */
import { useMemo } from "react";
import { cn } from "@plane/utils";

type RefClick = (projectId: string, issueId: string) => void;

export type WeeklyRef = { key: string; projectId: string; issueId: string };
export type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: { text: string; refs: WeeklyRef[] }[] }
  | { kind: "paragraph"; text: string };

/** 限定タグの HTML → 描画用のブロック配列。解析できない断片は素通し(捨てない)。 */
export function parseWeeklyHtml(html: string): Block[] {
  if (!html) return [];
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return [{ kind: "paragraph", text: html.replace(/<[^>]+>/g, " ").trim() }];
  }
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return [{ kind: "paragraph", text: html.replace(/<[^>]+>/g, " ").trim() }];
  }

  const blocks: Block[] = [];
  doc.body.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || "").trim();
      if (t) blocks.push({ kind: "paragraph", text: t });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5") {
      blocks.push({ kind: "heading", text: (node.textContent || "").trim() });
      return;
    }
    if (tag === "ul" || tag === "ol") {
      const items = Array.from(node.querySelectorAll("li")).map((li) => {
        const refs = Array.from(li.querySelectorAll("span.wr-ref")).map((s) => ({
          key: (s.textContent || "").trim(),
          projectId: s.getAttribute("data-project-id") || "",
          issueId: s.getAttribute("data-issue-id") || "",
        }));
        const clone = li.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("span.wr-ref").forEach((s) => s.remove());
        return { text: (clone.textContent || "").trim(), refs };
      });
      if (items.length) blocks.push({ kind: "list", items });
      return;
    }
    const t = (node.textContent || "").trim();
    if (t) blocks.push({ kind: "paragraph", text: t });
  });
  return blocks;
}

/**
 * ブロック → 翻訳に渡す平文。**出処キーを `[BS-374]` の形で本文に残す** のが要点:
 * 翻訳エンドポイントは 1 オブジェクト 1 呼出なので、行ごとに翻訳すると LLM 呼出が
 * 爆発する。キーを平文に埋めて 1 回で訳し、戻ってきた訳文からキーを拾い直せば、
 * **見出し・箇条書き・出処リンクを保ったまま** 1 呼出で済む。
 * (モデルがキーを崩したら、その行はただの平文に退化する — 壊れはしない)
 */
export function blocksToPlain(blocks: Block[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.kind === "heading") lines.push(`# ${b.text}`);
    else if (b.kind === "paragraph") lines.push(b.text);
    else for (const it of b.items) lines.push(`- ${it.text}${it.refs.map((r) => ` [${r.key}]`).join("")}`);
  }
  return lines.join("\n");
}

/** 訳文(平文)→ ブロック。`[KEY]` は既知の出処にだけ復元する(捏造リンクを作らない)。 */
export function parseWeeklyPlain(text: string, refByKey: Map<string, WeeklyRef>): Block[] {
  const blocks: Block[] = [];
  let list: { text: string; refs: WeeklyRef[] }[] | null = null;
  const flush = () => {
    if (list?.length) blocks.push({ kind: "list", items: list });
    list = null;
  };
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,4}\s/.test(line)) {
      flush();
      blocks.push({ kind: "heading", text: line.replace(/^#{1,4}\s*/, "") });
      continue;
    }
    if (/^[-・*•]\s*/.test(line)) {
      const body = line.replace(/^[-・*•]\s*/, "");
      const refs: WeeklyRef[] = [];
      const stripped = body
        .replace(/[[［]([A-Za-z0-9]+-\d+)[\]］]/g, (m, key: string) => {
          const hit = refByKey.get(key);
          if (!hit) return m;
          if (!refs.some((r) => r.issueId === hit.issueId)) refs.push(hit);
          return "";
        })
        .trim();
      list = list ?? [];
      list.push({ text: stripped, refs });
      continue;
    }
    flush();
    blocks.push({ kind: "paragraph", text: line });
  }
  flush();
  return blocks;
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 平文 → 保存用 HTML(サーバ生成と **同じ限定タグ集合**)。確定版の編集は
 * 素の箇条書きで行う: 週報は見出し + 箇条書きしか要らないのに、リッチエディタを
 * 載せると貼り付けた書式が混ざって出処の構造が壊れる。ここを平文に閉じておくと
 * 「翻訳の往復」と「人の編集」がまったく同じ表現を通るので、崩れ方が一致する。
 */
export function plainToWeeklyHtml(text: string, refByKey: Map<string, WeeklyRef>): string {
  const out: string[] = [];
  for (const b of parseWeeklyPlain(text, refByKey)) {
    if (b.kind === "heading") out.push(`<h4>${escHtml(b.text)}</h4>`);
    else if (b.kind === "paragraph") out.push(`<p>${escHtml(b.text)}</p>`);
    else
      out.push(
        `<ul>${b.items
          .map(
            (it) =>
              `<li>${escHtml(it.text)}${it.refs
                .map(
                  (r) =>
                    ` <span class="wr-ref" data-project-id="${r.projectId}" data-issue-id="${r.issueId}">${escHtml(
                      r.key
                    )}</span>`
                )
                .join("")}</li>`
          )
          .join("")}</ul>`
      );
  }
  return out.join("\n");
}

export function RefChip(props: { label: string; onClick?: () => void }) {
  const { label, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "inline-flex shrink-0 items-center rounded border border-subtle bg-layer-1 px-1.5 py-px",
        "font-mono text-[10px] leading-4 tracking-tight text-tertiary transition-colors",
        onClick && "hover:border-accent-subtle hover:bg-accent-subtle hover:text-accent-primary"
      )}
    >
      {label}
    </button>
  );
}

export function WeeklyHtml(props: { html?: string; blocks?: Block[]; onRefClick?: RefClick; className?: string }) {
  const { html, blocks: given, onRefClick, className } = props;
  const parsed = useMemo(() => given ?? parseWeeklyHtml(html || ""), [given, html]);
  const blocks = parsed;
  if (!blocks.length) return null;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {blocks.map((b, i) => {
        if (b.kind === "heading")
          return (
            <div key={i} className="flex items-center gap-2">
              <h4 className="text-11 font-semibold tracking-wide text-tertiary uppercase">{b.text}</h4>
              <span className="h-px flex-1 bg-[var(--border-color-subtle)]" />
            </div>
          );
        if (b.kind === "paragraph")
          return (
            <p key={i} className="text-13 leading-relaxed text-secondary">
              {b.text}
            </p>
          );
        return (
          <ul key={i} className="flex flex-col gap-2">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2.5">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--border-color-strong)]" />
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
                  <span className="text-13 leading-relaxed text-primary">{it.text}</span>
                  {it.refs.map((r) => (
                    <RefChip
                      key={`${r.issueId}_${r.key}`}
                      label={r.key}
                      onClick={onRefClick && r.projectId && r.issueId ? () => onRefClick(r.projectId, r.issueId) : undefined}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
