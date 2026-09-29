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
  // select は value ではなく見出しを出す
  const opt = (a.options || []).find((o: any) => (o?.value ?? o) === val);
  const s = opt ? String(opt.label ?? opt) : String(val);
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
