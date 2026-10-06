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
  const one = (v: any) =>
    opts.find((o) => o.value === v)?.label ?? (typeof v === "boolean" ? (v ? "はい" : "いいえ") : String(v));
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
export function evalSummary(
  state: any,
  expr: string,
  getAll: (s: any, p: string) => any[] = defaultGetAll
): number | "" {
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
    o && typeof o === "object"
      ? { value: o.value ?? o.label, label: String(o.label ?? o.value), sub: o.sub }
      : { value: o, label: String(o) }
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
  return walk(
    root,
    path
      .replace(/^state\.?/, "")
      .split(".")
      .filter(Boolean)
  );
}

/** 多人参与卡（barsoul.form.cheer.v1）：cards が配る crowd の 1 行。 */
export type CrowdEntry = { id: string; name: string; state: any; at_ms: number };

const crowdVal = (st: any, bind: string) => bind.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), st);

/** clap：押した人（crowd 順＝参加順）と本人が押したか。 */
export function crowdTally(
  crowd: CrowdEntry[] | undefined,
  bind: string,
  me = ""
): { count: number; names: string[]; mine: boolean } {
  const on = (crowd || []).filter((e) => !!crowdVal(e.state, bind));
  return { count: on.length, names: on.map((e) => e.name), mine: !!me && on.some((e) => e.id === me) };
}

/** wall：ひとことのある人だけ、新しい順。rateBind があれば評価も添える。 */
export function wallEntries(
  crowd: CrowdEntry[] | undefined,
  bind: string,
  rateBind = ""
): { id: string; name: string; text: string; rate: number | null; at_ms: number }[] {
  return (crowd || [])
    .map((e) => {
      const text = String(crowdVal(e.state, bind) ?? "").trim();
      const r = rateBind ? Number(crowdVal(e.state, rateBind)) : NaN;
      return { id: e.id, name: e.name, text, rate: Number.isFinite(r) && r > 0 ? r : null, at_ms: e.at_ms };
    })
    .filter((e) => e.text)
    .sort((a, b) => b.at_ms - a.at_ms);
}

/**
 * poll：選択肢ごとの票数と投票者。myVal があれば自分の行をそれで差し替える
 * （送信直後〜reload までの間も自分の票を反映）。multi は配列値を 1 票ずつ数える。
 * voters=投票した人数（選択肢数ではない）、lead=最多票の value（同数なら無し）。
 */
export function pollTally(
  crowd: CrowdEntry[] | undefined,
  bind: string,
  options: { value: any }[],
  me = "",
  myVal?: any
): { counts: Map<any, { n: number; names: string[] }>; voters: number; lead: any } {
  const counts = new Map<any, { n: number; names: string[] }>();
  for (const o of options) counts.set(o.value, { n: 0, names: [] });
  const rows = (crowd || []).map((e) => ({ id: e.id, name: e.name, v: crowdVal(e.state, bind) }));
  if (me && myVal !== undefined) {
    const i = rows.findIndex((r) => r.id === me);
    if (i >= 0) rows[i] = { ...rows[i], v: myVal };
    else rows.push({ id: me, name: "", v: myVal });
  }
  let voters = 0;
  for (const r of rows) {
    const vs = (Array.isArray(r.v) ? r.v : [r.v]).filter((x) => x !== null && x !== undefined && x !== "");
    let hit = false;
    for (const v of vs) {
      const c = counts.get(v);
      if (!c) continue; // 選択肢から消えた値は数えない
      c.n++;
      if (r.name) c.names.push(r.name);
      hit = true;
    }
    if (hit) voters++;
  }
  let lead: any = undefined;
  let best = 0;
  let tie = false;
  for (const [v, c] of counts) {
    if (c.n > best) {
      best = c.n;
      lead = v;
      tie = false;
    } else if (c.n === best && best > 0) tie = true;
  }
  return { counts, voters, lead: tie ? undefined : lead };
}

// ── 共有チェックリスト（sharedlist、barsoul.form.shared.v1）────────────────
export type MdSeg = { t: string; b?: boolean; i?: boolean; code?: boolean; s?: boolean; href?: string };

/** 行内 Markdown の最小集合（**太字** *斜体* `code` ~~取消~~ [文字](URL)）。HTML は解釈しない＝原文は文字のまま。 */
export function inlineMd(src: string): MdSeg[] {
  const out: MdSeg[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|~~(.+?)~~|\[([^\]]+)\]\(([^)\s]+)\)|(?<![*\w])\*(?!\s)([^*]+?)\*(?![*\w])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const s = String(src ?? "");
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: m[1], b: true });
    else if (m[2] !== undefined) out.push({ t: m[2], code: true });
    else if (m[3] !== undefined) out.push({ t: m[3], s: true });
    else if (m[4] !== undefined) {
      const href = /^(https?:|mailto:|\/)/i.test(m[5]) ? m[5] : undefined;
      out.push(href ? { t: m[4], href } : { t: m[0] });
    } else out.push({ t: m[6], i: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: s.slice(last) });
  return out;
}

export type SharedItem = { on: boolean; by?: string; at_ms?: number };

/** 項目の現在値：手元の楽観値 → cards の回放結果 → 原文の [x] の順。 */
export function sharedOn(
  id: string,
  part: any,
  items: Record<string, SharedItem> | undefined,
  pend: Record<string, boolean> = {}
): boolean {
  if (id in pend) return pend[id];
  const it = items?.[id];
  if (it) return !!it.on;
  return !!part?.checked;
}

/** 全体と各セクションの進捗。タスク 0 のセクションは total=0（表示側で数字を出さない）。 */
export function sharedProgress(
  sections: any[],
  items: Record<string, SharedItem> | undefined,
  pend: Record<string, boolean> = {}
): { done: number; total: number; bySec: { done: number; total: number }[] } {
  let done = 0;
  let total = 0;
  const bySec = (sections || []).map((sec) => {
    let d = 0;
    let n = 0;
    for (const p of sec?.parts || []) {
      if (p?.kind !== "task" || !p.id) continue;
      n++;
      if (sharedOn(p.id, p, items, pend)) d++;
    }
    done += d;
    total += n;
    return { done: d, total: n };
  });
  return { done, total, bySec };
}

/** 見出しタグ（【確定済み】【重要】など）の色調。done=緑 / warn=赤 / それ以外は中立。 */
export function tagTone(tag: string): "done" | "warn" | "plain" {
  const s = String(tag || "");
  if (/(確定|完了|済|完成|done|DONE)/.test(s)) return "done";
  if (/(重要|必須|至急|緊急|注意|要確認)/.test(s)) return "warn";
  return "plain";
}
