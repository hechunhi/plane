/**
 * BARSOUL 2026-10: 看板の列名・ラベル名の「閲覧者の言語だけ」表示(display-only 投影)。
 *
 * 当社の状態名・ラベル名はチーム(日中)が両方読めるよう併記で保存している。書き方は
 * プロジェクトごとにまちまち(実データ 2026-10-01):
 *   "In Progress / 対応中·处理中"   (BS: EN / 日·中)
 *   "仮予定 / 暂定"  "取消 / キャンセル"  "灵感池 / アイデア"   (日中の順序は不定)
 *   "⏳ Waiting / 待ち・待機中"  "💡 提案"   (先頭に絵文字)
 * 列幅 ~280px では併記が「In Progress / 対応中・…」と切れて肝心の部分が読めない。
 * そこで表示だけ閲覧者の言語の片側に絞る。**保存値(SoR)は一切変えない** — 全文は tooltip。
 *
 * 判定: " / " で分割 → EN 側を含む名前だけ "·"(U+00B7) でさらに分割(BS 形式)。
 * 各片を 英字 / 日(仮名・日本字形) / 中(簡体字) に分類し、決まらない片は
 * 「残った方の言語」→ それでも決まらなければ 並び順(日→中)で埋める。
 * 字形表は translate/issue-field-translate.tsx の正本を共有(複製しない)。
 * 日本語の中黒「・」は 1 語内の区切り(共有・周知)なので分割しない。
 */
import { CN_GLYPH_CHARS, JA_GLYPH_CHARS } from "@/components/issues/translate/issue-field-translate";

type TLang = "en" | "ja" | "zh";

const LEADING_SYMBOLS = /^[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍•\s]+/u;
const KANA_RE = /[ぁ-ゟァ-ヺー]/;
const JA_RE = new RegExp("[" + JA_GLYPH_CHARS + "]");
const CN_RE = new RegExp("[" + CN_GLYPH_CHARS + "]");
const LATIN_ONLY_RE = /^[\x20-\x7E]+$/;
// 共用漢字だけで出来た日本語の状態語(字形では決まらない「完了」等の救済)。
const JA_WORD_RE = /完了|予定|今週|中止|保留|確認|提案|対応/;

/** 先頭の絵文字を落とす(列ヘッダ・チップはアイコン/色点を別に持つ。絵文字アイコン禁止の方針)。 */
export const stripLeadingEmoji = (name: string): string => (name || "").replace(LEADING_SYMBOLS, "").trim() || name;

const classify = (token: string): TLang | null => {
  if (LATIN_ONLY_RE.test(token)) return "en";
  const ja = KANA_RE.test(token) || JA_RE.test(token);
  const zh = CN_RE.test(token);
  if (ja && !zh) return "ja";
  if (zh && !ja) return "zh";
  if (ja || zh) return null;
  // 字形で決まらない: 日本語の語彙 → 日 / 中国語 IME の間隔号「·」を含む → 中。
  if (JA_WORD_RE.test(token)) return "ja";
  if (token.includes("·")) return "zh";
  return null;
};

const viewerLang = (locale: string | undefined): TLang => {
  const l = (locale || "").toLowerCase();
  if (l.startsWith("zh")) return "zh";
  if (l.startsWith("ja")) return "ja";
  return "en";
};

/** 併記名から閲覧者の言語の片側を返す。分けられなければ(絵文字を落とした)全文。 */
export function pickBilingualName(name: string, locale: string | undefined): string {
  const base = stripLeadingEmoji(name || "");
  let tokens = base
    .split(" / ")
    .map((s) => stripLeadingEmoji(s.trim()))
    .filter(Boolean);
  if (tokens.some((t) => LATIN_ONLY_RE.test(t)))
    tokens = tokens.flatMap((t) => t.split("·").map((s) => s.trim())).filter(Boolean);
  // 「質問・提问」型(日・中 を中黒で併記): 片方が仮名入りの日本語で、もう片方が日本語でない時だけ分ける。
  // 「共有・周知」「経理・入金」のような 1 語内の中黒は分けない。
  if (tokens.length === 1) {
    const parts = tokens[0].split("・").map((s) => s.trim());
    if (parts.length === 2 && parts[0] && parts[1]) {
      const [a, b] = parts.map(classify);
      const kanaA = KANA_RE.test(parts[0]);
      const kanaB = KANA_RE.test(parts[1]);
      if ((a === "ja" && b === "zh") || (a === "zh" && b === "ja") || (kanaA && !kanaB && b !== "ja") || (kanaB && !kanaA && a !== "ja"))
        tokens = parts;
    }
  }
  if (tokens.length < 2) return base;

  const langs = tokens.map(classify);
  // 未判定の片を埋める: CJK 片が 2 つで片方だけ決まっていれば、もう片方は反対の言語。
  const cjkIdx = langs.map((l, i) => (l === "en" ? -1 : i)).filter((i) => i >= 0);
  // 片方だけの「·」推定などで同じ言語が 2 つになったら、仮名を含む方を日本語に寄せる。
  if (cjkIdx.length === 2) {
    const [a, b] = cjkIdx;
    if (langs[a] && !langs[b]) langs[b] = langs[a] === "ja" ? "zh" : "ja";
    else if (!langs[a] && langs[b]) langs[a] = langs[b] === "ja" ? "zh" : "ja";
    else if (!langs[a] && !langs[b]) {
      langs[a] = "ja";
      langs[b] = "zh";
    } else if (langs[a] === langs[b]) {
      const ka = KANA_RE.test(tokens[a]);
      const kb = KANA_RE.test(tokens[b]);
      if (ka !== kb) {
        langs[a] = ka ? "ja" : "zh";
        langs[b] = kb ? "ja" : "zh";
      }
    }
  }

  const want = viewerLang(locale);
  const hit = tokens.find((_, i) => langs[i] === want);
  if (hit) return hit;
  // 欲しい言語の片が無く、CJK 片が「確実に相手の言語」なら英語片の方が読みやすい(Backlog / 待办池)。
  const en = tokens.find((_, i) => langs[i] === "en");
  if (en && want !== "en" && tokens.every((_, i) => langs[i] === "en" || (langs[i] && langs[i] !== want))) return en;
  // 欲しい言語が無い: 中⇔日は互いに漢字で読めるので CJK 側を優先、無ければ先頭。
  const cjk = tokens.find((_, i) => langs[i] !== "en");
  return (want === "en" ? tokens[0] : cjk) ?? tokens[0];
}

/** ラベル用: 片側に絞ったうえで、日本語の「総務・社内」は頭の語(総務)だけにする。 */
export function shortLabelName(name: string, locale: string | undefined): string {
  const picked = pickBilingualName(name, locale);
  const head = picked.split("・")[0]?.trim();
  return head || picked;
}
