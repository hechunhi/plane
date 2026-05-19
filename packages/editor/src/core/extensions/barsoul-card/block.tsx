/**
 * BARSOUL: barsoulCard 节点 React NodeView —— 纯主题驱动渲染器。
 * 视觉真相源 = cards `theme()`+blocks（改 Go 秒级，零 Plane 重建）。
 * R1: 审批链/方式可视化（detail/modebadge/chain）。
 * R2: 用 Plane 自身 session 调 /api/users/me 取当前用户 → ?me 过滤；
 *     取不到身份 → 安全降级（只读 + 登录提示，绝不显他人按钮/泄漏）。
 * R3(UX): 节点不可选中（selectable:false@config + userSelect:none）；
 *     操作按钮不再整页跳转 —— 内联確認条（誤操作防止の軽量浮層）→
 *     Ajax で署名 /__act を叩き、成功後その場で spec 再取得して進捗更新。
 *     失敗時のみフォールバックの進捗ページリンクを提示。
 * 「冻结薄缝」：不写死配色/文案，不耦合 Plane 内部（仅用其公开 me API）。
 */
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Blk = Record<string, any>;
type Theme = Record<string, string>;

const FALLBACK: Theme = {
  bg: "#FFFFFF", fg: "#111827", muted: "#6B7280", border: "#E5E7EB",
  accent: "#2563EB", approveBg: "#15803D", approveFg: "#FFFFFF",
  rejectFg: "#B91C1C", rejectBorder: "#FCA5A5", chipBg: "#F3F4F6",
  radius: "10px", pad: "14px 16px", font: "13px", titleFont: "15px",
};

async function currentUserId(): Promise<string> {
  // Plane 自身 session（卡片在 tasks.barsoul.jp，cookie 已在）。零代码耦合。
  for (const u of ["/api/users/me/", "/api/me/"]) {
    try {
      const r = await fetch(u, { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        const id = d?.id || d?.user?.id;
        if (id) return String(id);
      }
    } catch { /* ignore, degrade */ }
  }
  return "";
}

type Pending = { href: string; label: string; ok: boolean } | null;

export function BarsoulCardBlock(props: NodeViewProps) {
  const ref: string = props.node?.attrs?.["data-card"] || "";
  const [data, setData] = useState<{ blocks: Blk[]; theme: Theme } | null>(null);
  const [err, setErr] = useState("");
  const [openDetail, setOpenDetail] = useState(false);
  // R3: 確認 / 送信 / 結果フラッシュ
  const [confirm, setConfirm] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ msg: string; bad: boolean } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!ref) { setErr("no ref"); return; }
    const me = await currentUserId();
    const q = `/c/${encodeURIComponent(ref)}?as=spec${me ? `&me=${encodeURIComponent(me)}` : ""}`;
    try {
      const r = await fetch(q, { credentials: "same-origin" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setErr("");
      setData({
        blocks: Array.isArray(d?.blocks) ? d.blocks : [],
        theme: { ...FALLBACK, ...(d?.theme || {}) },
      });
    } catch (e) {
      setErr(String(e));
    }
  }, [ref]);

  useEffect(() => {
    let on = true;
    (async () => { if (on) await load(); })();
    return () => { on = false; };
  }, [load]);

  // R3: 署名 /__act を Ajax 実行 → 成功で spec 再取得（整頁遷移しない）
  const runAction = useCallback(async (p: NonNullable<Pending>) => {
    setConfirm(null);
    setBusy(true);
    setFlash(null);
    try {
      const r = await fetch(p.href, { credentials: "same-origin", redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setFlash({ msg: `「${p.label}」を受け付けました`, bad: false });
      await load(); // 進捗/終結を反映（カードが自分で更新）
    } catch (e) {
      setFlash({ msg: `送信に失敗しました（${String(e)}）。下のリンクから開いてください。`, bad: true });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const t = data?.theme || FALLBACK;
  const S = useMemo(() => ({
    // 文字は選択/コピー可（userSelect は付けない）。青い節点選択背景は
    // config の selectable:false で根治済 ＝ 見栄え悪化なし & コピー可能。
    card: { border: `1px solid ${t.border}`, background: t.bg, color: t.fg,
      borderRadius: t.radius, padding: t.pad, margin: "6px 0", maxWidth: 540,
      font: `${t.font}/1.65 system-ui,-apple-system,'Hiragino Sans','PingFang SC'` } as React.CSSProperties,
    eyebrow: { fontSize: 11, letterSpacing: ".08em", color: t.muted,
      textTransform: "uppercase", fontWeight: 600 } as React.CSSProperties,
    title: { fontSize: parseInt(t.titleFont), fontWeight: 700, margin: "2px 0 0" } as React.CSSProperties,
    meta: { fontSize: 12, color: t.muted, margin: "6px 0 0" } as React.CSSProperties,
    detailBtn: { fontSize: 12, color: t.accent, cursor: "pointer", background: "none",
      border: 0, padding: "4px 0" } as React.CSSProperties,
    detailBox: { fontSize: 12.5, color: t.fg, background: t.chipBg, borderRadius: 8,
      padding: "8px 10px", margin: "6px 0 0", whiteSpace: "pre-wrap" } as React.CSSProperties,
    badge: (all: boolean): React.CSSProperties => ({ display: "inline-block",
      fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999,
      margin: "8px 0 2px", border: `1px solid ${all ? t.accent : t.border}`,
      color: all ? t.accent : t.muted, background: all ? "transparent" : t.chipBg }),
    badgeNote: { fontSize: 11, color: t.muted, marginLeft: 8 } as React.CSSProperties,
    sep: { border: 0, borderTop: `1px solid ${t.border}`, margin: "10px 0" } as React.CSSProperties,
    chainRow: { display: "flex", alignItems: "flex-start", gap: 8, padding: "3px 0",
      fontSize: 13 } as React.CSSProperties,
    progress: { fontSize: 12, fontWeight: 700, color: t.fg, margin: "2px 0 6px" } as React.CSSProperties,
    arow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0" } as React.CSSProperties,
    aname: { flex: 1, fontWeight: 500 } as React.CSSProperties,
    btn: (ok: boolean): React.CSSProperties => ({ appearance: "none", cursor: busy ? "default" : "pointer",
      fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 6, marginLeft: 6,
      opacity: busy ? 0.5 : 1,
      border: `1px solid ${ok ? t.approveBg : t.rejectBorder}`,
      background: ok ? t.approveBg : "transparent", color: ok ? t.approveFg : t.rejectFg }),
    confirmBar: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      fontSize: 12.5, background: t.chipBg, borderRadius: 8, padding: "8px 10px",
      margin: "8px 0 0" } as React.CSSProperties,
    cBtn: (ok: boolean): React.CSSProperties => ({ appearance: "none", cursor: "pointer",
      fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 6,
      border: `1px solid ${ok ? t.approveBg : t.border}`,
      background: ok ? t.approveBg : "transparent", color: ok ? t.approveFg : t.muted }),
    flash: (bad: boolean): React.CSSProperties => ({ fontSize: 12.5, borderRadius: 8,
      padding: "7px 10px", margin: "8px 0 0",
      background: bad ? "#FEF2F2" : "#F0FDF4", color: bad ? t.rejectFg : t.approveBg,
      border: `1px solid ${bad ? t.rejectBorder : t.approveBg}` }),
    closed: (good: boolean): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 600,
      borderRadius: 8, padding: "8px 10px", margin: "10px 0 0",
      background: good ? "#F0FDF4" : t.chipBg, color: good ? t.approveBg : t.muted,
      border: `1px solid ${good ? t.approveBg : t.border}` }),
    hint: { fontSize: 12, color: t.muted, background: t.chipBg, borderRadius: 8,
      padding: "7px 10px", margin: "8px 0 0" } as React.CSSProperties,
    foot: { marginTop: 12, paddingTop: 10, borderTop: `1px solid ${t.border}`, fontSize: 12 } as React.CSSProperties,
    link: { color: t.muted, textDecoration: "none" } as React.CSSProperties,
    note: { color: t.muted, fontSize: 12 } as React.CSSProperties,
  }), [t, busy]);

  const dot = (state: string) => {
    const c = state === "approved" ? t.approveBg
      : state === "rejected" ? t.rejectFg : "transparent";
    const b = state === "pending" ? t.muted : c;
    return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 999,
      border: `2px solid ${b}`, background: c, marginTop: 5, flexShrink: 0 }} />;
  };
  const stTxt = (st: string, note: string) =>
    st === "approved" ? `承認済${note ? "・" + note : ""}`
      : st === "rejected" ? `却下${note ? "・" + note : ""}` : "未決";

  return (
    <NodeViewWrapper as="div" data-barsoul-card contentEditable={false}>
      <div style={S.card} contentEditable={false}>
        {err && (<div style={S.note}>審査カードを読み込めませんでした。
          {ref && <a style={S.link} target="_blank" rel="noopener noreferrer"
            href={`/c/${encodeURIComponent(ref)}?as=view`}> 進捗を開く</a>}</div>)}
        {!data && !err && <div style={S.note}>読み込み中…</div>}
        {data && data.blocks.map((b, i) => {
          const ty = b.type;
          if (ty === "header") return (
            <div key={i}>
              <div style={S.eyebrow}>審査{b.badge ? ` · ${b.badge}` : ""}</div>
              <div style={S.title}>{b.title}</div>
            </div>);
          if (ty === "kv") return (
            <div key={i} style={S.meta}>
              {(b.rows || []).map((r: Blk) => `${r.k}：${r.v}`).join("　·　")}
            </div>);
          if (ty === "detail") {
            const txt = String(b.md ?? b.text ?? "");
            if (!txt.trim()) return null;
            return (
              <div key={i}>
                <button style={S.detailBtn} onClick={() => setOpenDetail(!openDetail)}>
                  {openDetail ? "詳細を隠す ▲" : "詳細を見る ▼"}</button>
                {openDetail && <div style={S.detailBox}>{txt}</div>}
              </div>);
          }
          if (ty === "modebadge") return (
            <div key={i}>
              <span style={S.badge(b.mode === "ALL")}>{b.label}</span>
              <span style={S.badgeNote} title={b.note}>{b.note}</span>
            </div>);
          if (ty === "chain") return (
            <div key={i}>
              <hr style={S.sep} />
              <div style={S.progress}>進捗：{b.progress}</div>
              {(b.items || []).map((it: Blk, j: number) => (
                <div key={j} style={S.chainRow}>
                  {dot(it.state)}
                  <span style={{ flex: 1 }}>
                    <b>{it.name}</b>
                    <span style={{ color: t.muted, marginLeft: 8, fontSize: 12 }}>
                      {stTxt(it.state, it.note)}</span>
                  </span>
                </div>))}
            </div>);
          if (ty === "actions_grouped") return (
            <div key={i}>
              <hr style={S.sep} />
              {(b.groups || []).map((g: Blk, j: number) => (
                <div key={j} style={S.arow}>
                  <span style={S.aname}>{g.name}</span>
                  {(g.items || []).map((it: Blk, k: number) => (
                    <button key={k} type="button" disabled={busy} style={S.btn(it.act === "approve")}
                      onClick={() => it.href && setConfirm({
                        href: it.href, label: it.label, ok: it.act === "approve" })}>
                      {it.label}</button>))}
                </div>))}
            </div>);
          // BARSOUL 通用富表单：原子组合的交互表单（场景无关）
          if (ty === "form") return <FormBlock key={i} spec={b} t={t} S={S} reload={load} />;
          if (ty === "closed") {
            const st = String(b.status || "");
            const good = st === "通过";
            return (
              <div key={i} style={S.closed(good)}>
                {good ? "✅" : st === "却下" ? "❌" : "🛑"} この審査は終了しました（{st}）
              </div>);
          }
          if (ty === "authhint") return <div key={i} style={S.hint}>{b.text}</div>;
          // viewlink は冗長(カードが既に進捗表示)→正常時は出さない。
          // カード描画失敗時の導線は上の err 分岐に集約済。
          if (ty === "viewlink") return null;
          if (ty === "divider") return <hr key={i} style={S.sep} />;
          if (ty === "text") return <div key={i} style={S.meta}>{b.md}</div>;
          return null;
        })}

        {/* R3: 確認条（軽量浮層・誤操作防止）。整頁遷移しない */}
        {confirm && (
          <div style={S.confirmBar}>
            <span style={{ flex: 1 }}>「<b>{confirm.label}</b>」で送信します。よろしいですか？</span>
            <button type="button" style={S.cBtn(confirm.ok)} onClick={() => runAction(confirm)}>
              確定</button>
            <button type="button" style={S.cBtn(false)} onClick={() => setConfirm(null)}>
              やめる</button>
          </div>
        )}
        {busy && <div style={S.note}>送信中…</div>}
        {flash && (
          <div style={S.flash(flash.bad)}>
            {flash.msg}
            {flash.bad && ref && (
              <> <a style={{ ...S.link, color: "inherit", textDecoration: "underline" }}
                target="_blank" rel="noopener noreferrer"
                href={`/c/${encodeURIComponent(ref)}?as=view`}>進捗ページを開く</a></>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * BARSOUL 通用富表单引擎 + 原子（场景无关）。
 * spec = { state, rules, blocks:[atoms], editable, submit:{url,u,sig} }
 * 原子: field / checklist / repeater / summary / table。bind=JSON 路径。
 * 校验=声明式(与 cards ValidateForm 同义，前端 UX 拦截，服务端权威)。
 * 节点只持本地编辑态，签名 POST，成功后以服务端新 spec 为准（薄缝纪律）。
 * ────────────────────────────────────────────────────────────────────── */
const _norm = (p: string) => p.replace(/^state\.?/, "");
// P2: ドラッグ中の項目（単一ウィンドウ前提で十分。dataTransfer の
// React 跨レンダー不安定を回避）。{from=池/箱の bind, id}
let _dragItem: { from: string; id: any } | null = null;
// 構造化クローン後のインプレース変異用：path のライブ参照を返す
function gpLive(o: any, path: string): any {
  const segs = _norm(path).split(".").filter(Boolean);
  let c = o;
  for (const s of segs) {
    const m = s.match(/^(.*?)\[(\d+)\]$/);
    if (m) c = c?.[m[1]]?.[+m[2]];
    else c = c?.[s];
    if (c == null) return c;
  }
  return c;
}
function getP(o: any, path: string): any {
  const segs = _norm(path).split(".").filter(Boolean);
  let c = o;
  for (const s of segs) {
    const m = s.match(/^(.*?)\[(\d+)\]$/);
    if (m) c = c?.[m[1]]?.[+m[2]];
    else c = c?.[s];
    if (c == null) return c;
  }
  return c;
}
function setP(o: any, path: string, v: any): any {
  const segs = _norm(path).split(".").filter(Boolean);
  const root = Array.isArray(o) ? [...o] : { ...o };
  let c: any = root;
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    const m = s.match(/^(.*?)\[(\d+)\]$/);
    if (m) {
      const k = m[1], idx = +m[2];
      const arr = Array.isArray(c[k]) ? [...c[k]] : [];
      c[k] = arr;
      if (last) arr[idx] = v;
      else { arr[idx] = arr[idx] && typeof arr[idx] === "object" ? { ...arr[idx] } : {}; c = arr[idx]; }
    } else if (last) c[s] = v;
    else { c[s] = c[s] && typeof c[s] === "object" ? (Array.isArray(c[s]) ? [...c[s]] : { ...c[s] }) : {}; c = c[s]; }
  });
  return root;
}
// resolve path → flat values（支持 a.b[].c 展开数组），与 form.go 同义
function resolveP(root: any, path: string): any[] {
  const segs = _norm(path).split(".").filter(Boolean);
  const walk = (node: any, ss: string[]): any[] => {
    if (node == null) return [];
    if (!ss.length) return [node];
    const [seg, ...rest] = ss;
    const flat = seg.endsWith("[]");
    const key = seg.replace(/\[\]$/, "");
    const cur = key ? node?.[key] : node;
    if (flat) return Array.isArray(cur) ? cur.flatMap((e) => walk(e, rest)) : [];
    return walk(cur, rest);
  };
  return walk(root, segs);
}
const isEmpty = (v: any) =>
  v == null || (typeof v === "string" && !v.trim()) ||
  (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
const toNum = (v: any) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

function validateForm(state: any, rules: any[]): { path: string; msg: string }[] {
  const out: { path: string; msg: string }[] = [];
  for (const r of rules || []) {
    const as = r.assert, msg = r.msg || "";
    if (r.each) {
      // r.each = 数组路径。getP で配列本体を取り、その「要素」を巡回する
      // （resolveP は [配列] と1段包むため要素反復にならない — 本 bug 修正）。
      const arr = getP(state, r.each);
      (Array.isArray(arr) ? arr : []).forEach((el: any, idx: number) => {
        for (const f of r.fields || []) {
          const vs = resolveP(el, f);
          if (!vs.length || vs.some(isEmpty))
            out.push({ path: `${r.each}[${idx}].${f}`, msg: msg || `${f} は必須です` });
        }
      });
      continue;
    }
    if (as === "sum_equals") {
      const sum = (p: string) => resolveP(state, p).reduce((a, v) => a + (toNum(v) ?? 0), 0);
      if (sum(r.left) !== sum(r.right)) out.push({ path: r.left, msg: msg || "合計が一致しません" });
      continue;
    }
    const vals = resolveP(state, r.on);
    let bad = false;
    if (as === "required") bad = !vals.length || vals.some(isEmpty);
    else if (as === "empty") bad = vals.some((v) => !isEmpty(v));
    else if (as === "minLength") {
      let n = 0; vals.forEach((v) => (n += Array.isArray(v) ? v.length : isEmpty(v) ? 0 : 1));
      bad = n < (toNum(r.value) ?? 0);
    } else if (as === "min") bad = vals.some((v) => toNum(v) != null && (toNum(v) as number) < (toNum(r.value) ?? 0));
    else if (as === "max") bad = vals.some((v) => toNum(v) != null && (toNum(v) as number) > (toNum(r.value) ?? 0));
    else if (as === "regex") { const re = new RegExp(r.value); bad = vals.some((v) => !re.test(String(v))); }
    else if (as === "unique") { const s = new Set(); bad = vals.some((v) => (s.has(String(v)) ? true : (s.add(String(v)), false))); }
    if (bad) out.push({ path: r.on, msg: msg || `${r.on} が条件を満たしません` });
  }
  return out;
}

function FormBlock(props: { spec: any; t: Theme; S: any; reload: () => Promise<void> }) {
  const { spec, t, S, reload } = props;
  const editable = spec?.editable !== false && !!spec?.submit;
  const [st, setSt] = useState<any>(() => spec?.state ?? {});
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ msg: string; bad: boolean } | null>(null);
  const errs = useMemo(() => validateForm(st, spec?.rules || []), [st, spec]);
  const set = (path: string, v: any) => setSt((s: any) => setP(s, path, v));
  // P2: 池↔箱の項目移動（数量保存）。複数 path を 1 回で原子変異。
  const moveItem = (fromPath: string, toPath: string, id: any) =>
    setSt((s: any) => {
      const c = JSON.parse(JSON.stringify(s));
      const fa = gpLive(c, fromPath);
      if (!Array.isArray(fa)) return s;
      const i = fa.findIndex((x: any) => x?.id === id);
      if (i < 0) return s;
      const [it] = fa.splice(i, 1);
      const ta = gpLive(c, toPath);
      if (!Array.isArray(ta)) return s;
      const ex = ta.find((x: any) => x?.id === id);
      if (ex) ex.qty = (toNum(ex.qty) ?? 0) + (toNum(it.qty) ?? 0);
      else ta.push(it);
      return c;
    });

  const submit = async (decision: "approve" | "reject") => {
    setConfirm(null);
    if (decision === "approve" && errs.length) { setFlash({ msg: errs[0].msg, bad: true }); return; }
    setBusy(true); setFlash(null);
    try {
      const r = await fetch(spec.submit.url, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          u: spec.submit.u, sig: spec.submit.sig, decision,
          nonce: `${decision}-${Date.now()}`, state: st,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) {
        const m = (j.errors && j.errors[0]?.msg) || j.msg || `HTTP ${r.status}`;
        setFlash({ msg: m, bad: true }); setBusy(false); return;
      }
      setFlash({ msg: j.msg || "受け付けました", bad: false });
      await reload();
    } catch (e) {
      setFlash({ msg: `送信に失敗しました（${String(e)}）`, bad: true });
    } finally { setBusy(false); }
  };

  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.fg, margin: "10px 0 4px" };
  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px",
    border: `1px solid ${t.border}`, borderRadius: 6, background: t.bg, color: t.fg,
  };
  const ro = !editable;

  const Atom = (a: any, bp = "", k?: React.Key) => {
    const bind = bp ? `${bp}.${a.bind}` : a.bind;
    const val = bind ? getP(st, bind) : undefined;
    switch (a.atom) {
      case "field": {
        const it = a.input || "text";
        if (ro) return <div key={k} style={S.meta}><b>{a.label}</b>：{String(val ?? "—")}</div>;
        return (
          <div key={k}>
            {a.label && <div style={lbl}>{a.label}</div>}
            {it === "textarea" ? (
              <textarea style={{ ...inp, minHeight: 56 }} value={val ?? ""}
                placeholder={a.placeholder} onChange={(e) => set(bind, e.target.value)} />
            ) : it === "select" ? (
              <select style={inp} value={val ?? ""} onChange={(e) => set(bind, e.target.value)}>
                <option value=""></option>
                {(a.options || []).map((o: any) => (
                  <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>))}
              </select>
            ) : (
              <input style={inp} type={it} value={val ?? ""} placeholder={a.placeholder}
                min={a.min} max={a.max} step={a.step}
                onChange={(e) => set(bind, it === "number" ? toNum(e.target.value) : e.target.value)} />
            )}
          </div>);
      }
      case "checklist": {
        const arr: any[] = Array.isArray(val) ? val : [];
        const toggle = (id: string) => {
          if (ro) return;
          set(bind, arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
        };
        return (
          <div key={k}>
            {a.label && <div style={lbl}>{a.label}</div>}
            {(a.items || []).map((it: any) => {
              const on = arr.includes(it.id);
              return (
                <div key={it.id} onClick={() => toggle(it.id)}
                  style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0",
                    cursor: ro ? "default" : "pointer", fontSize: 13 }}>
                  <span style={{ width: 16, height: 16, flexShrink: 0, marginTop: 1,
                    borderRadius: 4, border: `1.5px solid ${on ? t.approveBg : t.border}`,
                    background: on ? t.approveBg : "transparent", color: "#fff",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 800 }}>{on ? "✓" : ""}</span>
                  <span style={{ flex: 1 }}>{it.label}
                    {it.sub && <span style={{ color: t.muted, marginLeft: 6, fontSize: 12 }}>{it.sub}</span>}
                  </span>
                </div>);
            })}
          </div>);
      }
      case "repeater": {
        const arr: any[] = Array.isArray(val) ? val : [];
        const addItem = () => set(bind, [...arr,
          a.itemDefault ? JSON.parse(JSON.stringify(a.itemDefault)) : {}]);
        const del = (idx: number) => set(bind, arr.filter((_, x) => x !== idx));
        return (
          <div key={k}>
            {a.label && <div style={lbl}>{a.label}</div>}
            {arr.map((_, idx) => (
              <div key={idx} style={{ border: `1px solid ${t.border}`, borderRadius: 8,
                padding: "8px 10px", margin: "6px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  fontSize: 12, fontWeight: 600, color: t.muted }}>
                  <span>{(a.itemLabel || "項目 {i}").replace("{i}", String(idx + 1))}</span>
                  {!ro && (a.min == null || arr.length > a.min) && (
                    <button type="button" onClick={() => del(idx)}
                      style={{ background: "none", border: 0, color: t.rejectFg,
                        cursor: "pointer", fontSize: 12 }}>削除</button>)}
                </div>
                {(a.template || []).map((c: any, ci: number) => Atom(c, `${bind}[${idx}]`, ci))}
              </div>))}
            {!ro && (a.max == null || arr.length < a.max) && (
              <button type="button" onClick={addItem}
                style={{ ...S.detailBtn, fontWeight: 600 }}>{a.addLabel || "＋ 追加"}</button>)}
          </div>);
      }
      case "summary": {
        const fn = (a.expr || "").match(/^(sum|count|len)\((.+)\)$/);
        let out: any = "";
        if (fn) {
          const vs = resolveP(st, fn[2]);
          out = fn[1] === "sum" ? vs.reduce((x, v) => x + (toNum(v) ?? 0), 0)
            : fn[1] === "count" ? vs.filter((v) => !isEmpty(v)).length : vs.length;
        }
        return <div key={k} style={{ ...S.meta, fontWeight: 600 }}>{a.label}：{out}{a.unit || ""}</div>;
      }
      case "table": {
        const rows: any[] = a.rows ? (Array.isArray(a.rows) ? a.rows : resolveP(st, a.rows)) : [];
        const cols = a.columns || [];
        return (
          <div key={k} style={{ overflowX: "auto", margin: "6px 0" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
              <thead><tr>{cols.map((c: any) => (
                <th key={c.key} style={{ textAlign: "left", padding: "4px 8px",
                  borderBottom: `1px solid ${t.border}`, color: t.muted }}>{c.label}</th>))}</tr></thead>
              <tbody>{rows.map((rw, ri) => (
                <tr key={ri}>{cols.map((c: any) => (
                  <td key={c.key} style={{ padding: "4px 8px",
                    borderBottom: `1px solid ${t.border}` }}>{String(rw?.[c.key] ?? "")}</td>))}</tr>))}</tbody>
            </table>
          </div>);
      }
      case "pool": {
        const arr: any[] = Array.isArray(val) ? val : [];
        const into = a.into; // 例 "state.packages"（触屏兜底の移動先箱）
        const boxes: any[] = into ? (getP(st, into) || []) : [];
        const rowS: React.CSSProperties = {
          display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
          margin: "4px 0", border: `1px solid ${t.border}`, borderRadius: 6,
          background: t.chipBg, fontSize: 13,
        };
        return (
          <div key={k}>
            {a.label && <div style={lbl}>{a.label}（未分配 {arr.length}）</div>}
            {arr.map((it: any, ix: number) => (
              <div key={it.id ?? ix} draggable={!ro}
                onDragStart={() => { if (!ro) _dragItem = { from: bind, id: it.id }; }}
                style={{ ...rowS, cursor: ro ? "default" : "grab" }}>
                <span style={{ flex: 1 }}>
                  {!ro && <span style={{ color: t.muted, marginRight: 6 }}>⠿</span>}
                  {it.name}{it.qty != null ? ` ×${it.qty}` : ""}
                </span>
                {!ro && boxes.length > 0 && (
                  <select value="" style={{ ...inp, width: 110 }}
                    onChange={(e) => {
                      const bi = parseInt(e.target.value, 10);
                      if (!isNaN(bi)) moveItem(bind, `${into}[${bi}].items`, it.id);
                    }}>
                    <option value="">→ 箱へ</option>
                    {boxes.map((_: any, bi: number) => (
                      <option key={bi} value={bi}>箱{bi + 1}</option>))}
                  </select>)}
              </div>))}
            {arr.length === 0 && <div style={S.note}>（すべて分配済み）</div>}
          </div>);
      }
      case "dropzone": {
        const arr: any[] = Array.isArray(val) ? val : [];
        const from = a.from || "state.pool";
        const rowS: React.CSSProperties = {
          display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
          margin: "3px 0", fontSize: 13,
        };
        return (
          <div key={k}
            onDragOver={(e) => { if (!ro) e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              if (ro || !_dragItem) return;
              moveItem(_dragItem.from || from, bind, _dragItem.id);
              _dragItem = null;
            }}
            style={{
              border: `1.5px dashed ${t.border}`, borderRadius: 8,
              padding: "8px 10px", margin: "4px 0", minHeight: 36,
              background: t.bg,
            }}>
            {arr.length === 0 && (
              <div style={S.note}>{ro ? "（空）" : "ここに商品をドラッグ／池で「→ 箱へ」"}</div>)}
            {arr.map((it: any, ix: number) => (
              <div key={it.id ?? ix} style={rowS}>
                <span style={{ flex: 1 }}>{it.name}</span>
                {a.qty !== false && (
                  <input type="number" style={{ ...inp, width: 70 }} disabled={ro}
                    value={it.qty ?? ""} min={0}
                    onChange={(e) => set(`${bind}[${ix}].qty`, toNum(e.target.value))} />)}
                {!ro && (
                  <button type="button" title="池へ戻す"
                    onClick={() => moveItem(bind, from, it.id)}
                    style={{ background: "none", border: 0, color: t.rejectFg,
                      cursor: "pointer", fontSize: 13 }}>✕</button>)}
              </div>))}
          </div>);
      }
      case "text":
        return <div key={k} style={S.meta}>{a.md ?? a.text}</div>;
      default:
        return null;
    }
  };

  return (
    <div>
      {(spec.blocks || []).map((a: any, i: number) => Atom(a, "", i))}
      {editable && (
        <>
          {errs.length > 0 && (
            <div style={{ ...S.hint, color: t.rejectFg, background: "#FEF2F2",
              border: `1px solid ${t.rejectBorder}` }}>⚠ {errs[0].msg}
              {errs.length > 1 && ` 他 ${errs.length - 1} 件`}</div>)}
          {!confirm && !busy && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" disabled={errs.length > 0}
                onClick={() => setConfirm("approve")}
                style={{ ...S.btn(true), marginLeft: 0,
                  opacity: errs.length > 0 ? 0.4 : 1,
                  cursor: errs.length > 0 ? "not-allowed" : "pointer" }}>✅ 承認</button>
              <button type="button" onClick={() => setConfirm("reject")}
                style={S.btn(false)}>❌ 却下</button>
            </div>)}
          {confirm && (
            <div style={S.confirmBar}>
              <span style={{ flex: 1 }}>「<b>{confirm === "approve" ? "承認" : "却下"}</b>」
                で送信します。よろしいですか？</span>
              <button type="button" style={S.cBtn(confirm === "approve")}
                onClick={() => submit(confirm)}>確定</button>
              <button type="button" style={S.cBtn(false)}
                onClick={() => setConfirm(null)}>やめる</button>
            </div>)}
          {busy && <div style={S.note}>送信中…</div>}
        </>)}
      {flash && <div style={S.flash(flash.bad)}>{flash.msg}</div>}
    </div>
  );
}
