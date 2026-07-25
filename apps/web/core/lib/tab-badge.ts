/**
 * BARSOUL: ブラウザタブの「気づき」チャンネル(title prefix + favicon バッジ)を
 * **1 箇所で所有する**共有レジストリ (hechun 2026-07-25)
 *
 * なぜレジストリが要るか:
 *   title を書く主体が 2 つ以上あると、各々が MutationObserver で自分の prefix を
 *   復元し合う。相手の prefix は自分の正規表現に一致しないので「ページ題名の一部」
 *   と見なされ、互いに前置し続ける — "(1) ⚖️ (2) 💬 (1) ⚖️ …" と際限なく伸びる。
 *   favicon も 1 本の <link href> の取り合いになり、後勝ちで片方が消える。
 *   → **DOM を書くのはこのモジュールだけ**。各機能は count を register するだけ。
 *
 * sticky banner は貼らない方針([[feedback_plane_no_sticky_banner]])なので、
 * 裏タブに回した時の通知面はここしかない。壊れると「気づけない」に直結する。
 */

export type TTabBadgeSource = {
  /** タブ題名での並び順(小さいほど左)。対応必須のものを左に置く。 */
  priority: number;
  /** 題名に出す記号。タブ題名は lucide を置けない唯一の面なので文字で代替する。 */
  glyph: string;
  count: number;
};

const sources = new Map<string, TTabBadgeSource>();

/** 自前で生成した prefix 群だけを剥がす("(N) X " の繰り返しに一致)。 */
const PREFIX_RE = /^(?:\(\d+\) \S+ )+/;

let titleObserver: MutationObserver | null = null;
let baseFaviconUrl: string | null = null;
/** favicon 描画は非同期。古い描画が新しい状態を上書きしないよう世代で捨てる。 */
let faviconGeneration = 0;

const activeSources = (): TTabBadgeSource[] =>
  Array.from(sources.values())
    .filter((s) => s.count > 0)
    .sort((a, b) => a.priority - b.priority);

const buildPrefix = (): string => {
  const active = activeSources();
  return active.length ? `${active.map((s) => `(${s.count}) ${s.glyph}`).join(" ")} ` : "";
};

const totalCount = (): number => activeSources().reduce((sum, s) => sum + s.count, 0);

function applyTitle() {
  if (typeof document === "undefined") return;
  const cur = document.title || "";
  const next = buildPrefix() + cur.replace(PREFIX_RE, "");
  if (cur !== next) document.title = next;
}

/**
 * 既存 <link rel="icon"> から baseline を抜く。bundler が hash 化するので
 * path 直書きは不可。32×32 を優先、無ければ最初に見つかった icon。
 */
function detectBaseFaviconUrl(): string {
  if (typeof document === "undefined") return "";
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
  const candidates = links.filter((l) => !l.hasAttribute("data-tab-badge"));
  const png32 = candidates.find((l) => l.getAttribute("sizes") === "32x32");
  return (png32 || candidates[0])?.href || "";
}

function findOrCreateFaviconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"][data-tab-badge]');
  if (existing) return existing;
  // 既存 favicon link は触らず、自前の 1 本を足す(count=0 で baseline に戻せる)。
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.setAttribute("data-tab-badge", "1");
  document.head.appendChild(link);
  return link;
}

async function renderFaviconWithBadge(count: number, baseUrl: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // baseline 画像の上に描く。取得失敗(または tainted)ならバッジだけ出す。
  if (baseUrl) {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, size, size);
        } catch {
          /* tainted canvas — バッジのみで続行 */
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = baseUrl;
    });
  }

  const cx = size - 9;
  const cy = size - 9;
  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  const label = count > 99 ? "99+" : String(count);
  const fontSize = label.length >= 3 ? 8 : label.length === 2 ? 10 : 12;
  ctx.font = `bold ${fontSize}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 1);

  return canvas.toDataURL("image/png");
}

function applyFavicon() {
  if (typeof document === "undefined") return;
  if (baseFaviconUrl === null) baseFaviconUrl = detectBaseFaviconUrl();
  const link = findOrCreateFaviconLink();
  if (!link) return;

  const count = totalCount();
  const generation = ++faviconGeneration;
  if (count === 0) {
    link.href = baseFaviconUrl;
    return;
  }
  void renderFaviconWithBadge(count, baseFaviconUrl).then((dataUrl) => {
    // 描いている間に状態が変わっていたら捨てる(古い件数で上書きしない)。
    if (generation !== faviconGeneration || !dataUrl) return;
    link.href = dataUrl;
  });
}

/** 個々のページが title を差し替えても prefix を復元し続ける。 */
function ensureTitleObserver() {
  if (typeof document === "undefined" || titleObserver) return;
  const titleEl = document.querySelector("title");
  if (!titleEl) return;
  titleObserver = new MutationObserver(() => applyTitle());
  titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
}

function apply() {
  ensureTitleObserver();
  applyTitle();
  applyFavicon();
}

/** バッジ源を登録/更新する。同じ key の再登録は上書き。 */
export function registerTabBadge(key: string, source: TTabBadgeSource) {
  const cur = sources.get(key);
  if (cur && cur.count === source.count && cur.glyph === source.glyph && cur.priority === source.priority) return;
  sources.set(key, source);
  apply();
}

/** バッジ源を外す(アンマウント時は必ず呼ぶ — 残ると幽霊バッジになる)。 */
export function unregisterTabBadge(key: string) {
  if (!sources.delete(key)) return;
  apply();
}
