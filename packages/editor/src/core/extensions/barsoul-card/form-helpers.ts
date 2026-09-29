/**
 * BARSOUL: form 原子の純関数（React 非依存・テスト対象）。
 * block.tsx の FormBlock から使う。
 */

const toNum = (v: any): number | null => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};
const isEmpty = (v: any) =>
  v == null ||
  (typeof v === "string" && !v.trim()) ||
  (Array.isArray(v) && !v.length) ||
  (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);

/** 読み取り専用表示の値。未入力は「—」（空文字を素通しすると「ラベル：」だけの行になる）。 */
export function fieldText(val: any, a: { options?: any[]; unit?: string } = {}): string {
  if (isEmpty(val)) return "—";
  // select / choice は value ではなく見出しを出す（複数選択は「、」区切り）
  const opts = normOptions(a.options || []);
  const one = (v: any) => opts.find((o) => o.value === v)?.label ?? (typeof v === "boolean" ? (v ? "はい" : "いいえ") : String(v));
  const s = Array.isArray(val) ? val.map(one).join("、") : one(val);
  return a.unit ? `${s} ${a.unit}` : s;
}

/** 浮動小数の足し算誤差（0.1+0.2）を表示に出さない。 */
const tidy = (n: number) => Math.round(n * 1000) / 1000;

/**
 * summary 原子の式。
 *   sum(path) / count(path) / len(path)
 *   sumprod(arrayPath, a, b) = Σ el[a]×el[b]（例: 数量×単重量＝総重量）
 * path 解決は呼び出し側の resolveP と同じ規約（getAll で注入）。
 */
export function evalSummary(state: any, expr: string, getAll: (s: any, p: string) => any[] = defaultGetAll): number | "" {
  const sp = expr.match(/^sumprod\(\s*([^,]+?)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)$/);
  if (sp) {
    const arr = getAll(state, sp[1]).flatMap((v) => (Array.isArray(v) ? v : [v]));
    return tidy(arr.reduce((x, el) => x + (toNum(el?.[sp[2]]) ?? 0) * (toNum(el?.[sp[3]]) ?? 0), 0));
  }
  const fn = expr.match(/^(sum|count|len)\((.+)\)$/);
  if (!fn) return "";
  const vs = getAll(state, fn[2]);
  if (fn[1] === "sum") return tidy(vs.reduce((x, v) => x + (toNum(v) ?? 0), 0));
  if (fn[1] === "count") return vs.filter((v) => !isEmpty(v)).length;
  return vs.length;
}

/* ── 通用原子の共通ロジック ─────────────────────────────────────────── */

type GetAll = (s: any, p: string) => any[];

/**
 * 条件表示。原子の `when` と rule の `when` で共通（cards form.go formWhen と同義）。
 *   {path, eq} / {path, ne} / {path, in:[...]} / {path, truthy:bool} / {path}=truthy
 * path が「.」始まりなら repeater 行内の相対パス（base を前置）。
 */
export function matchWhen(state: any, w: any, base = "", getAll: GetAll = defaultGetAll): boolean {
  if (!w || typeof w !== "object" || !w.path) return true;
  const p = String(w.path).startsWith(".") && base ? `${base}${w.path}` : String(w.path);
  const v = getAll(state, p)[0];
  const same = (x: any) => (v == null || x == null ? v == null && x == null : String(v) === String(x));
  const truthy = !isEmpty(v) && v !== false && v !== 0;
  if ("eq" in w) return same(w.eq);
  if ("ne" in w) return !same(w.ne);
  if (Array.isArray(w.in)) return w.in.some(same);
  if (typeof w.truthy === "boolean") return truthy === w.truthy;
  return truthy;
}

const normPath = (p: string) => String(p || "").replace(/^state\.?/, "");

/** bind が必須か（ラベルに「*」を出す用）。required / minLength / each.fields を見る。 */
export function isRequired(rules: any[], bind: string): boolean {
  const b = normPath(bind);
  for (const r of rules || []) {
    if (r.each) {
      const each = normPath(r.each).replace(/\[\]$/, "");
      const m = b.match(/^(.*)\[\d+\]\.(.+)$/);
      if (m && m[1] === each && (r.fields || []).includes(m[2])) return true;
      continue;
    }
    if ((r.assert === "required" || r.assert === "minLength") && normPath(r.on) === b) return true;
  }
  return false;
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 日付クイック入力: "today" / "tomorrow" / "+7d" / "-1d" / "eom"(月末)。それ以外はそのまま返す。 */
export function resolveQuick(token: any, now: Date = new Date()): any {
  if (typeof token !== "string") return token;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (token === "today") return ymd(d);
  if (token === "tomorrow") return ymd(new Date(d.getTime() + 864e5));
  if (token === "eom") return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const m = token.match(/^([+-]\d+)d$/);
  if (m) {
    d.setDate(d.getDate() + parseInt(m[1], 10));
    return ymd(d);
  }
  return token;
}

/** stepper: 浮動小数の刻み誤差を出さず min/max に収める。 */
export function stepBy(v: any, dir: number, o: { min?: number; max?: number; step?: number } = {}): number {
  const step = o.step || 1;
  const dec = (String(step).split(".")[1] || "").length;
  let n = (toNum(v) ?? o.min ?? 0) + dir * step;
  n = parseFloat(n.toFixed(dec));
  if (o.min != null) n = Math.max(o.min, n);
  if (o.max != null) n = Math.min(o.max, n);
  return n;
}

/** tags: 「a, b、c」やペーストした改行区切りをまとめて足す。重複・空は捨てる。 */
export function addTags(arr: any, input: string, o: { max?: number } = {}): string[] {
  const cur: string[] = Array.isArray(arr) ? arr.map(String) : [];
  const seen = new Set(cur.map((s) => s.toLowerCase()));
  for (const raw of String(input || "").split(/[,，、\n\t]/)) {
    const s = raw.trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    if (o.max != null && cur.length >= o.max) break;
    cur.push(s);
    seen.add(s.toLowerCase());
  }
  return cur;
}

/** progress: 0..100 の整数。of<=0 は 0。 */
export function pct(value: any, of: any): number {
  const v = toNum(value) ?? 0;
  const o = toNum(of) ?? 0;
  if (o <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((v / o) * 100)));
}

/** countdown の表示文。soon = 24h 以内。 */
export function countdownText(target: any, now = Date.now()): { text: string; overdue: boolean; soon: boolean } {
  const t = typeof target === "number" ? target : Date.parse(String(target ?? ""));
  if (!isFinite(t)) return { text: "—", overdue: false, soon: false };
  const diff = t - now;
  const a = Math.abs(diff);
  const d = Math.floor(a / 864e5);
  const h = Math.floor((a % 864e5) / 36e5);
  const m = Math.floor((a % 36e5) / 6e4);
  const span = d > 0 ? `${d}日${h}時間` : h > 0 ? `${h}時間${m}分` : `${Math.max(m, diff < 0 ? 1 : 0)}分`;
  return diff < 0
    ? { text: `${span} 超過`, overdue: true, soon: false }
    : { text: `あと ${span}`, overdue: false, soon: diff <= 864e5 };
}

/** 選択肢の正規化: "A" / {value,label} どちらも {value,label} に。 */
export function normOptions(opts: any[]): { value: any; label: string; sub?: string }[] {
  return (opts || []).map((o) =>
    o && typeof o === "object" ? { value: o.value ?? o.label, label: String(o.label ?? o.value), sub: o.sub } : { value: o, label: String(o) }
  );
}

/** 最小の path 解決（a.b[].c）。block.tsx では本物の resolveP を渡す。 */
function defaultGetAll(root: any, path: string): any[] {
  const walk = (node: any, segs: string[]): any[] => {
    if (!segs.length) return [node];
    const [seg, ...rest] = segs;
    const flat = seg.endsWith("[]");
    const key = seg.replace(/\[\]$/, "");
    const cur = key ? node?.[key] : node;
    if (flat) return Array.isArray(cur) ? cur.flatMap((e) => walk(e, rest)) : [];
    return walk(cur, rest);
  };
  return walk(root, path.replace(/^state\.?/, "").split(".").filter(Boolean));
}
