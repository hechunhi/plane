/**
 * BARSOUL: 汎用 form 原子（場面に依存しない入力部品）。
 * block.tsx の FormBlock.Atom から renderExtraAtom(a, ctx) で呼ぶ。
 * cards サーバは原子を知らない（rules だけ検証）ので、ここに足すだけで使える。
 *
 *   choice    チップ選択（multi で複数）
 *   toggle    スイッチ（onLabel / offLabel）
 *   stepper   − / ＋ 付き数値（min / max / step、直接入力も可）
 *   rating    ★ 評価（max 既定 5、同じ★で解除）
 *   slider    スライダー（min / max / step / unit）
 *   tags      タグ入力（Enter・読点で追加、Backspace で末尾削除、suggest）
 *   progress  進捗バー（expr か value / of。100% で小さく祝う）
 *   tally     タップで数えるカウンター（振動・1 つ戻す）
 *   countdown 期限までの残り（at か bind の日時、毎分更新）
 *   group     見出し付きの枠（cols 横並び・collapsed 折り畳み・children）
 *   clap      みんなで 1 回ずつ押すボタン（押した人数と名前、押すと即送信＋紙吹雪）※cheer 卡
 *   wall      みんなのひとこと一覧（bind=本文、rateBind=評価を添える）※cheer 卡
 *   poll      みんなで投票（選択肢ごとの票数バー＋投票者、タップで即送信・付け替え可、img で画像選択肢）※多人卡
 */
import { Check, PartyPopper } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { addTags, countdownText, crowdTally, normOptions, pct, pollTally, stepBy, wallEntries } from "./form-helpers";
import type { CrowdEntry } from "./form-helpers";

type Theme = Record<string, string>;
export type AtomCtx = {
  bind: string;
  val: any;
  set: (path: string, v: any) => void;
  ro: boolean;
  t: Theme;
  S: any;
  inp: React.CSSProperties;
  err?: string;
  /** 見出し（help・必須印込み）。block.tsx 側で組み立てて渡す */
  label: React.ReactNode;
  /** summary と同じ式評価（progress 用） */
  evalExpr: (expr: string) => number | "";
  /** 子原子の描画（group 用） */
  renderChild: (a: any, k: React.Key) => React.ReactNode;
  /** 多人参与卡：全員の最新提出（cards が配る）と自分の id */
  crowd?: CrowdEntry[];
  me?: string;
  /** 値を入れて即送信（clap のワンタップ用）。anchor は紙吹雪の起点 */
  quick?: (path: string, v: any, anchor?: HTMLElement | null) => void;
  /** 参加できる人数（cards の crowd_total、0/未指定＝不明）と締切済みか */
  crowdTotal?: number;
  closed?: boolean;
};

const EXTRA = new Set(["choice", "toggle", "stepper", "rating", "slider", "tags", "progress", "tally", "countdown", "group", "clap", "wall", "poll"]);
export const isExtraAtom = (atom: string) => EXTRA.has(atom);

const chip = (t: Theme, on: boolean, ro: boolean): React.CSSProperties => ({
  minHeight: 32,
  padding: "5px 12px",
  fontSize: 13,
  borderRadius: 16,
  border: `1px solid ${on ? t.accent : t.border}`,
  background: on ? t.accent : "transparent",
  color: on ? "#fff" : t.fg,
  cursor: ro ? "default" : "pointer",
  transition: "background .12s, border-color .12s, transform .08s",
});
const sqBtn = (t: Theme, disabled: boolean): React.CSSProperties => ({
  width: 34,
  height: 34,
  flexShrink: 0,
  fontSize: 18,
  lineHeight: "30px",
  borderRadius: 8,
  border: `1px solid ${t.border}`,
  background: t.chipBg,
  color: t.fg,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.4 : 1,
  userSelect: "none",
});
const reduceMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};
const errLine = (t: Theme, err?: string) =>
  err ? <div style={{ color: t.rejectFg, fontSize: 11.5, marginTop: 3 }}>{err}</div> : null;

export function renderExtraAtom(a: any, c: AtomCtx, k?: React.Key): React.ReactNode {
  switch (a.atom) {
    case "choice":
      return <Choice key={k} a={a} c={c} />;
    case "toggle":
      return <Toggle key={k} a={a} c={c} />;
    case "stepper":
      return <Stepper key={k} a={a} c={c} />;
    case "rating":
      return <Rating key={k} a={a} c={c} />;
    case "slider":
      return <Slider key={k} a={a} c={c} />;
    case "tags":
      return <Tags key={k} a={a} c={c} />;
    case "progress":
      return <Progress key={k} a={a} c={c} />;
    case "tally":
      return <Tally key={k} a={a} c={c} />;
    case "countdown":
      return <Countdown key={k} a={a} c={c} />;
    case "clap":
      return <Clap key={k} a={a} c={c} />;
    case "wall":
      return <Wall key={k} a={a} c={c} />;
    case "poll":
      return <Poll key={k} a={a} c={c} />;
    case "group":
      return <Group key={k} a={a} c={c} />;
    default:
      return null;
  }
}

type P = { a: any; c: AtomCtx };

function Choice({ a, c }: P) {
  const { t, ro, val, bind, set } = c;
  const opts = normOptions(a.options || []);
  const multi = !!a.multi;
  const arr: any[] = multi ? (Array.isArray(val) ? val : []) : [];
  const isOn = (v: any) => (multi ? arr.includes(v) : val === v);
  const pick = (v: any) => {
    if (ro) return;
    if (multi) set(bind, isOn(v) ? arr.filter((x) => x !== v) : a.max && arr.length >= a.max ? arr : [...arr, v]);
    else set(bind, isOn(v) && a.clearable !== false ? null : v);
  };
  const shown = ro ? opts.filter((o) => isOn(o.value)) : opts;
  return (
    <div>
      {c.label}
      <div role={multi ? "group" : "radiogroup"} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {shown.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={isOn(o.value)}
            disabled={ro}
            onClick={() => pick(o.value)}
            style={chip(t, isOn(o.value), ro)}
          >
            {isOn(o.value) && multi ? "✓ " : ""}
            {o.label}
            {o.sub && <span style={{ opacity: 0.7, marginLeft: 4, fontSize: 11.5 }}>{o.sub}</span>}
          </button>
        ))}
        {ro && !shown.length && <span style={{ color: t.muted, fontSize: 13 }}>—</span>}
      </div>
      {errLine(t, c.err)}
    </div>
  );
}

function Toggle({ a, c }: P) {
  const { t, ro, val, bind, set } = c;
  const on = val === true;
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={ro}
        onClick={() => !ro && set(bind, !on)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          minHeight: 36,
          padding: "6px 0",
          background: "none",
          border: 0,
          color: t.fg,
          cursor: ro ? "default" : "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{a.label}</span>
        <span style={{ fontSize: 12, color: on ? t.accent : t.muted }}>
          {on ? a.onLabel || "オン" : a.offLabel || "オフ"}
        </span>
        <span
          aria-hidden
          style={{
            width: 40,
            height: 22,
            borderRadius: 11,
            background: on ? t.accent : t.border,
            position: "relative",
            transition: "background .15s",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: on ? 20 : 2,
              width: 18,
              height: 18,
              borderRadius: 9,
              background: "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,.25)",
              transition: "left .15s",
            }}
          />
        </span>
      </button>
      {a.help && <div style={{ fontSize: 11.5, color: t.muted, marginTop: -2 }}>{a.help}</div>}
      {errLine(t, c.err)}
    </div>
  );
}

function Stepper({ a, c }: P) {
  const { t, ro, val, bind, set, inp } = c;
  const o = { min: a.min, max: a.max, step: a.step };
  const n = typeof val === "number" ? val : null;
  if (ro)
    return (
      <div style={c.S.meta}>
        <b>{a.label}</b>：{n == null ? "—" : `${n}${a.unit ? ` ${a.unit}` : ""}`}
      </div>
    );
  const atMin = n != null && a.min != null && n <= a.min;
  const atMax = n != null && a.max != null && n >= a.max;
  return (
    <div>
      {c.label}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" aria-label="減らす" disabled={atMin} onClick={() => set(bind, stepBy(n, -1, o))} style={sqBtn(t, atMin)}>
          −
        </button>
        <input
          type="number"
          inputMode="decimal"
          value={n ?? ""}
          placeholder={a.placeholder}
          min={a.min}
          max={a.max}
          step={a.step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            set(bind, isNaN(v) ? null : v);
          }}
          style={{
            ...inp,
            width: 90,
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
            borderColor: c.err ? t.rejectFg : inp.borderColor,
          }}
        />
        <button type="button" aria-label="増やす" disabled={atMax} onClick={() => set(bind, stepBy(n, 1, o))} style={sqBtn(t, atMax)}>
          ＋
        </button>
        {a.unit && <span style={{ fontSize: 13, color: t.muted }}>{a.unit}</span>}
      </div>
      {errLine(t, c.err)}
    </div>
  );
}

function Rating({ a, c }: P) {
  const { t, ro, val, bind, set } = c;
  const max = Math.max(1, Math.min(10, a.max || 5));
  const cur = typeof val === "number" ? val : 0;
  const [hover, setHover] = useState(0);
  const [pop, setPop] = useState(0);
  const show = hover || cur;
  const labels: string[] = Array.isArray(a.labels) ? a.labels : [];
  return (
    <div>
      {c.label}
      <div style={{ display: "flex", alignItems: "center", gap: 2 }} onMouseLeave={() => setHover(0)}>
        {Array.from({ length: max }, (_, i) => i + 1).map((i) => (
          <button
            key={i}
            type="button"
            aria-label={`${i} / ${max}`}
            disabled={ro}
            onMouseEnter={() => !ro && setHover(i)}
            onClick={() => {
              if (ro) return;
              set(bind, cur === i ? null : i);
              setPop(i);
              setTimeout(() => setPop(0), 220);
            }}
            style={{
              width: 32,
              height: 32,
              padding: 0,
              fontSize: 22,
              lineHeight: "32px",
              background: "none",
              border: 0,
              // 琥珀は行動信号専用なので★は accent 青
              color: i <= show ? t.accent : t.border,
              cursor: ro ? "default" : "pointer",
              transform: pop === i && !reduceMotion() ? "scale(1.3)" : "scale(1)",
              transition: "transform .18s, color .1s",
            }}
          >
            ★
          </button>
        ))}
        <span style={{ marginLeft: 6, fontSize: 12.5, color: t.muted, fontVariantNumeric: "tabular-nums" }}>
          {show ? labels[show - 1] || `${show} / ${max}` : ro ? "—" : a.placeholder || ""}
        </span>
      </div>
      {errLine(t, c.err)}
    </div>
  );
}

function Slider({ a, c }: P) {
  const { t, ro, val, bind, set } = c;
  const min = a.min ?? 0;
  const max = a.max ?? 100;
  const n = typeof val === "number" ? val : null;
  const shown = n == null ? "—" : `${n}${a.unit ? ` ${a.unit}` : ""}`;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <div style={{ flex: 1 }}>{c.label}</div>
        <span style={{ fontSize: 13, fontWeight: 700, color: n == null ? t.muted : t.accent, fontVariantNumeric: "tabular-nums" }}>
          {shown}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={a.step ?? 1}
        disabled={ro}
        value={n ?? min}
        onChange={(e) => set(bind, parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: t.accent, height: 28, opacity: n == null && !ro ? 0.5 : 1 }}
      />
      {(a.minLabel || a.maxLabel) && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.muted }}>
          <span>{a.minLabel}</span>
          <span>{a.maxLabel}</span>
        </div>
      )}
      {errLine(t, c.err)}
    </div>
  );
}

function Tags({ a, c }: P) {
  const { t, ro, val, bind, set, inp } = c;
  const arr: string[] = Array.isArray(val) ? val.map(String) : [];
  const [draft, setDraft] = useState("");
  const full = a.max != null && arr.length >= a.max;
  const commit = (s: string) => {
    const next = addTags(arr, s, { max: a.max });
    if (next.length !== arr.length) set(bind, next);
    setDraft("");
  };
  const rest = (a.suggest || []).map(String).filter((s: string) => !arr.some((x) => x.toLowerCase() === s.toLowerCase()));
  return (
    <div>
      {c.label}
      <div
        style={{
          ...inp,
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          alignItems: "center",
          minHeight: 34,
          borderColor: c.err ? t.rejectFg : inp.borderColor,
          ...(ro ? { border: 0, padding: 0, background: "transparent" } : {}),
        }}
      >
        {arr.map((s, i) => (
          <span
            key={s}
            style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "2px 4px 2px 9px", fontSize: 12.5, borderRadius: 12, background: t.chipBg, border: `1px solid ${t.border}` }}
          >
            {s}
            {!ro && (
              <button
                type="button"
                aria-label={`${s} を外す`}
                onClick={() => set(bind, arr.filter((_, x) => x !== i))}
                style={{ width: 20, height: 20, padding: 0, border: 0, background: "none", color: t.muted, cursor: "pointer", fontSize: 12 }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {ro && !arr.length && <span style={{ color: t.muted, fontSize: 13 }}>—</span>}
        {!ro && !full && (
          <input
            value={draft}
            placeholder={arr.length ? "" : a.placeholder || "入力して Enter"}
            onChange={(e) => {
              const v = e.target.value;
              // 読点・カンマを打った瞬間に確定（IME 変換中は onChange に来ない区切りもあるので Enter も拾う）
              if (/[,，、]$/.test(v)) commit(v);
              else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") {
                e.preventDefault();
                commit(draft);
              } else if (e.key === "Backspace" && !draft && arr.length) set(bind, arr.slice(0, -1));
            }}
            onBlur={() => draft.trim() && commit(draft)}
            onPaste={(e) => {
              const s = e.clipboardData.getData("text");
              if (/[,，、\n\t]/.test(s)) {
                e.preventDefault();
                commit(draft + s);
              }
            }}
            style={{ flex: 1, minWidth: 80, border: 0, outline: 0, background: "transparent", color: t.fg, fontSize: 13, padding: "2px 0" }}
          />
        )}
      </div>
      {!ro && !full && rest.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
          {rest.slice(0, 12).map((s: string) => (
            <button
              key={s}
              type="button"
              onClick={() => commit(s)}
              style={{ padding: "3px 9px", fontSize: 12, borderRadius: 12, border: `1px dashed ${t.border}`, background: "transparent", color: t.fg, cursor: "pointer" }}
            >
              ＋ {s}
            </button>
          ))}
        </div>
      )}
      {a.max != null && !ro && (
        <div style={{ fontSize: 11, color: t.muted, marginTop: 3 }}>
          {arr.length} / {a.max}
        </div>
      )}
      {errLine(t, c.err)}
    </div>
  );
}

function Progress({ a, c }: P) {
  const { t } = c;
  const v = a.expr ? c.evalExpr(a.expr) : a.value;
  const of = typeof a.of === "string" ? c.evalExpr(a.of) : a.of;
  const p = pct(v, of);
  const done = p >= 100;
  const [flare, setFlare] = useState(false);
  const was = useRef(done);
  useEffect(() => {
    // 途中から 100% に届いた瞬間だけ（開いた時点で 100% なら祝わない）
    if (done && !was.current && !reduceMotion()) {
      setFlare(true);
      const id = setTimeout(() => setFlare(false), 900);
      was.current = done;
      return () => clearTimeout(id);
    }
    was.current = done;
  }, [done]);
  const green = t.approveBg;
  return (
    <div style={{ margin: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", fontSize: 12, marginBottom: 4 }}>
        <span style={{ flex: 1, fontWeight: 600, color: t.fg }}>{a.label}</span>
        <span style={{ color: done ? green : t.muted, fontWeight: done ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
          {done ? `✓ ${a.doneLabel || "完了"}` : a.showCount === false ? `${p}%` : `${v === "" || v == null ? 0 : v} / ${of || 0}${a.unit ? ` ${a.unit}` : ""}`}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: t.chipBg, border: `1px solid ${t.border}`, overflow: "hidden" }}>
        <div
          style={{
            width: `${p}%`,
            height: "100%",
            background: done ? green : t.accent,
            transition: "width .35s ease, background .2s",
            boxShadow: flare ? `0 0 10px ${green}` : "none",
          }}
        />
      </div>
    </div>
  );
}

function Tally({ a, c }: P) {
  const { t, ro, val, bind, set } = c;
  const n = typeof val === "number" ? val : 0;
  const step = a.step || 1;
  const [bump, setBump] = useState(false);
  const hit = () => {
    if (ro || (a.max != null && n >= a.max)) return;
    set(bind, n + step);
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 非対応端末 */
    }
    if (!reduceMotion()) {
      setBump(true);
      setTimeout(() => setBump(false), 140);
    }
  };
  const reached = a.goal != null && n >= a.goal;
  return (
    <div>
      {c.label}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          disabled={ro}
          onClick={hit}
          aria-label={`${a.label || "カウント"} ＋${step}`}
          style={{
            minWidth: 88,
            height: 64,
            padding: "0 16px",
            borderRadius: 14,
            border: `1.5px solid ${reached ? t.approveBg : t.accent}`,
            background: reached ? t.approveBg : t.bg,
            color: reached ? "#fff" : t.accent,
            fontSize: 28,
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            cursor: ro ? "default" : "pointer",
            transform: bump ? "scale(0.94)" : "scale(1)",
            transition: "transform .12s, background .2s",
            touchAction: "manipulation",
          }}
        >
          {n}
        </button>
        <div style={{ fontSize: 12, color: t.muted, lineHeight: 1.6 }}>
          {a.unit && <div>{a.unit}</div>}
          {a.goal != null && <div>{reached ? `✓ 目標 ${a.goal} 達成` : `目標 ${a.goal} まであと ${a.goal - n}`}</div>}
          {!ro && n > 0 && (
            <button
              type="button"
              onClick={() => set(bind, Math.max(0, n - step))}
              style={{ padding: "2px 0", border: 0, background: "none", color: t.muted, cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
            >
              1 つ戻す
            </button>
          )}
        </div>
      </div>
      {errLine(t, c.err)}
    </div>
  );
}

function Countdown({ a, c }: P) {
  const { t } = c;
  const target = a.at ?? c.val;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const r = countdownText(target, now);
  const color = r.overdue ? t.rejectFg : r.soon ? "#B45309" : t.fg;
  return (
    <div style={{ ...c.S.meta, display: "flex", alignItems: "baseline", gap: 6 }}>
      <b>{a.label || "期限"}</b>
      <span style={{ color, fontWeight: r.overdue || r.soon ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>{r.text}</span>
      {target && r.text !== "—" && (
        <span style={{ fontSize: 11.5, color: t.muted }}>
          （{new Date(typeof target === "number" ? target : Date.parse(target)).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）
        </span>
      )}
    </div>
  );
}

function Group({ a, c }: P) {
  const { t } = c;
  const [open, setOpen] = useState(!a.collapsed);
  const cols = Math.max(1, Math.min(4, a.cols || 1));
  const kids = (a.children || []).map((ch: any, i: number) => c.renderChild(ch, i));
  return (
    <div style={{ border: a.border === false ? 0 : `1px solid ${t.border}`, borderRadius: 8, padding: a.border === false ? 0 : "6px 10px 8px", margin: "8px 0" }}>
      {a.label && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", minHeight: 28, padding: 0, border: 0, background: "none", color: t.fg, fontSize: 12.5, fontWeight: 700, cursor: "pointer", textAlign: "left" }}
        >
          <span style={{ display: "inline-block", width: 10, color: t.muted, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
          <span style={{ flex: 1 }}>{a.label}</span>
          {!open && a.summary && <span style={{ fontWeight: 400, color: t.muted, fontSize: 12 }}>{a.summary}</span>}
        </button>
      )}
      {open && (
        <div
          style={
            cols > 1
              ? { display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${a.minColWidth || 140}px, 1fr))`, columnGap: 10 }
              : undefined
          }
        >
          {kids}
        </div>
      )}
    </div>
  );
}

const Avatar = ({ name, t, size = 26 }: { name: string; t: Theme; size?: number }) => (
  <span
    title={name}
    style={{
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: "50%",
      background: t.chipBg,
      border: `1px solid ${t.border}`,
      color: t.fg,
      fontSize: size * 0.46,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {Array.from(name || "?")[0]}
  </span>
);

function Clap({ a, c }: P) {
  const { t, ro, bind } = c;
  const btn = useRef<HTMLButtonElement | null>(null);
  const tally = crowdTally(c.crowd, bind, c.me);
  // 送信直後〜reload までの間も押した見た目にする（二度押し防止）
  const mine = tally.mine || !!c.val;
  const shown = tally.names.slice(0, a.maxNames || 12);
  const rest = tally.names.length - shown.length;
  const hit = () => {
    if (ro || mine || !c.quick) return;
    try {
      navigator.vibrate?.(15);
    } catch {
      /* 非対応端末 */
    }
    c.quick(bind, true, btn.current);
  };
  return (
    <div style={{ margin: "10px 0" }}>
      {c.label}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          ref={btn}
          type="button"
          disabled={ro || mine}
          onClick={hit}
          aria-pressed={mine}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            minHeight: 48,
            padding: "0 20px",
            borderRadius: 24,
            border: `1.5px solid ${mine ? t.approveBg : t.accent}`,
            background: mine ? t.approveBg : t.bg,
            color: mine ? "#fff" : t.accent,
            fontSize: 15,
            fontWeight: 700,
            cursor: ro || mine ? "default" : "pointer",
            touchAction: "manipulation",
            transition: "background .2s",
          }}
        >
          <PartyPopper size={18} strokeWidth={2.2} />
          <span>{mine ? a.doneText || `${a.text || "おめでとう"} 送りました` : a.text || "おめでとう"}</span>
          <span
            style={{
              minWidth: 22,
              padding: "0 6px",
              borderRadius: 11,
              fontSize: 13,
              background: mine ? "rgba(255,255,255,.25)" : t.chipBg,
              color: mine ? "#fff" : t.fg,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {tally.count + (mine && !tally.mine ? 1 : 0)}
          </span>
        </button>
        {tally.count === 0 && !mine && (
          <span style={{ fontSize: 12, color: t.muted }}>{a.emptyText || "最初のひとりになろう"}</span>
        )}
      </div>
      {shown.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
          {shown.map((n, i) => (
            <Avatar key={i} name={n} t={t} />
          ))}
          <span style={{ fontSize: 12, color: t.muted, marginLeft: 4 }}>
            {shown.join("、")}
            {rest > 0 ? ` ほか${rest}人` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function Wall({ a, c }: P) {
  const { t } = c;
  const rows = wallEntries(c.crowd, c.bind, a.rateBind || "");
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div style={{ margin: "10px 0" }}>
      {c.label}
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: t.muted }}>{a.emptyText || "まだメッセージはありません"}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Avatar name={r.name} t={t} />
              <div style={{ flex: 1, minWidth: 0, background: t.chipBg, borderRadius: 10, padding: "6px 10px" }}>
                <div style={{ fontSize: 11.5, color: t.muted, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, color: t.fg }}>{r.name}</span>
                  {r.rate != null && <span style={{ color: t.accent }}>{"★".repeat(Math.min(5, r.rate))}</span>}
                  <span>{fmt(r.at_ms)}</span>
                </div>
                <div style={{ fontSize: 13, color: t.fg, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Poll({ a, c }: P) {
  const { t, bind } = c;
  const opts: { value: any; label: string; sub?: string; img?: string }[] = normOptions(a.options || []).map(
    (o, i) => ({ ...o, img: (a.options || [])[i]?.img })
  );
  const multi = !!a.multi;
  const ro = c.ro || !!c.closed || !c.quick;
  const mineArr: any[] = multi ? (Array.isArray(c.val) ? c.val : []) : c.val == null || c.val === "" ? [] : [c.val];
  const { counts, voters, lead } = pollTally(c.crowd, bind, opts, c.me, c.me ? (multi ? mineArr : (c.val ?? null)) : undefined);
  const total = c.crowdTotal || 0;
  const all = total > 0 && voters >= total;
  const pick = (v: any, el: HTMLElement) => {
    if (ro) return;
    let next: any;
    if (multi) next = mineArr.includes(v) ? mineArr.filter((x) => x !== v) : a.max && mineArr.length >= a.max ? mineArr : [...mineArr, v];
    else next = mineArr[0] === v ? null : v; // 同じのをもう一度＝取り消し
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 非対応端末 */
    }
    c.quick!(bind, next, el);
  };
  const status = c.closed
    ? `締め切り · ${voters}人が投票`
    : all
      ? `全員投票済み（${voters}/${total}）`
      : total > 0
        ? `${voters}/${total} 人が投票`
        : `${voters}人が投票`;
  const hasImg = opts.some((o) => o.img);
  return (
    <div style={{ margin: "10px 0" }}>
      {c.label}
      <div
        style={
          hasImg
            ? { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }
            : { display: "flex", flexDirection: "column", gap: 6 }
        }
      >
        {opts.map((o) => {
          const cnt = counts.get(o.value) || { n: 0, names: [] };
          const on = mineArr.includes(o.value);
          const w = voters ? Math.round((cnt.n / voters) * 100) : 0;
          const top = lead !== undefined && lead === o.value && (c.closed || all);
          return (
            <button
              key={String(o.value)}
              type="button"
              disabled={ro}
              aria-pressed={on}
              onClick={(e) => pick(o.value, e.currentTarget)}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: hasImg ? 6 : "8px 10px",
                borderRadius: 10,
                border: `1.5px solid ${on || top ? t.accent : t.border}`,
                background: t.bg,
                color: t.fg,
                textAlign: "left",
                cursor: ro ? "default" : "pointer",
                overflow: "hidden",
                touchAction: "manipulation",
              }}
            >
              {o.img && (
                <img
                  src={o.img}
                  alt={o.label}
                  loading="lazy"
                  style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 6, background: t.chipBg }}
                />
              )}
              {!hasImg && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${w}%`,
                    background: t.chipBg,
                    transition: "width .3s",
                  }}
                />
              )}
              <span style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
                {on && <Check size={15} strokeWidth={2.6} color={t.accent} />}
                <span style={{ flex: 1, minWidth: 0, fontWeight: on ? 700 : 500, wordBreak: "break-word" }}>{o.label}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{cnt.n}</span>
                <span style={{ fontSize: 11.5, color: t.muted, minWidth: 32, textAlign: "right" }}>{voters ? `${w}%` : ""}</span>
              </span>
              {cnt.names.length > 0 && (
                <span style={{ position: "relative", fontSize: 11.5, color: t.muted, wordBreak: "break-word" }}>
                  {cnt.names.join("・")}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: all || c.closed ? t.fg : t.muted }}>
        {status}
        {!ro && (multi ? "　· 複数選べます・もう一度押すと外れます" : "　· 押すと投票・付け替えもできます")}
      </div>
    </div>
  );
}

/** 登録成功のささやかな紙吹雪（DOM/CSS のみ・reduced-motion なら出さない）。 */
export function celebrate(anchor?: HTMLElement | null) {
  if (typeof document === "undefined" || reduceMotion()) return;
  const r = anchor?.getBoundingClientRect();
  const x0 = r ? r.left + Math.min(r.width, 160) / 2 : window.innerWidth / 2;
  const y0 = r ? r.top : window.innerHeight / 2;
  const colors = ["#2563EB", "#16A34A", "#7C3AED", "#DB2777", "#0EA5E9"];
  const layer = document.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:hidden";
  document.body.appendChild(layer);
  for (let i = 0; i < 28; i++) {
    const p = document.createElement("i");
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
    const dist = 80 + Math.random() * 120;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    p.style.cssText = `position:absolute;left:${x0}px;top:${y0}px;width:6px;height:${6 + Math.random() * 6}px;background:${colors[i % colors.length]};border-radius:1px;opacity:1`;
    layer.appendChild(p);
    p.animate(
      [
        { transform: "translate(0,0) rotate(0)", opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx * 1.1}px,${dy + 140}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 400, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }
    );
  }
  setTimeout(() => layer.remove(), 1700);
}
