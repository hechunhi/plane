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
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
// R5: A2UI v0.9 試験導入（摘要部のみ・フラグ既定 OFF）。詳細は ./a2ui/ 配下。
import type { AtomicActionHandlers } from "./a2ui";
import {
  AtomicPresentationSurface,
  leadingPresentationCount,
  readA2uiAtomsFlag,
  safeExternalHref,
  subscribeA2uiAtomsFlag,
} from "./a2ui";
import { celebrate, isExtraAtom, renderExtraAtom } from "./form-atoms";
import { evalSummary as evalSummaryWith, fieldText, isRequired, matchWhen, resolveQuick } from "./form-helpers";

type Blk = Record<string, any>;
type Theme = Record<string, string>;

const FALLBACK: Theme = {
  bg: "#FFFFFF",
  fg: "#111827",
  muted: "#6B7280",
  border: "#E5E7EB",
  accent: "#2563EB",
  approveBg: "#15803D",
  approveFg: "#FFFFFF",
  rejectFg: "#B91C1C",
  rejectBorder: "#FCA5A5",
  chipBg: "#F3F4F6",
  radius: "10px",
  pad: "14px 16px",
  font: "13px",
  titleFont: "15px",
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
    } catch {
      /* ignore, degrade */
    }
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
    if (!ref) {
      setErr("no ref");
      return;
    }
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
    (async () => {
      if (on) await load();
    })();
    return () => {
      on = false;
    };
  }, [load]);

  // R3: 署名 /__act を Ajax 実行 → 成功で spec 再取得（整頁遷移しない）
  const runAction = useCallback(
    async (p: NonNullable<Pending>) => {
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
    },
    [load]
  );

  /* ── R5: A2UI v0.9 試験導入 ────────────────────────────────────────────
   * 対象は先頭から連続する **表示専用** ブロックだけ（R4 系の presentation-only
   * 原子＋header/kv/modebadge/detail）。chain / actions_grouped / form / timeline
   * など決裁に関わるブロックは従来描画のまま。A2UI は「記述と描画」だけを担い、
   * 取得・権限・状態・業務判断は既存経路のまま一切触らない。
   * フラグ OFF もしくは A2UI 側が失敗 → a2uiSplit=0 → 従来 UI が全部描く。
   * ──────────────────────────────────────────────────────────────────── */
  const a2uiOn = useSyncExternalStore(subscribeA2uiAtomsFlag, readA2uiAtomsFlag, () => false);
  const [a2uiFailed, setA2uiFailed] = useState(false);
  const onA2uiFail = useCallback(() => setA2uiFailed(true), []);
  const a2uiSurfaceId = useMemo(() => `barsoul-card:${ref || "unknown"}`, [ref]);
  const a2uiSplit = a2uiOn && !a2uiFailed && data ? leadingPresentationCount(data.blocks) : 0;
  // ホワイトリスト Action の実処理。すべて **既存の** 経路へ委譲する。
  const a2uiHandlers: AtomicActionHandlers = useMemo(
    () => ({
      // 遷移：context.href があれば spec の link/ref 先（scheme 検査済）、
      // 無ければ err 分岐と同じ署名付き進捗 URL。可否はサーバ側が判定する。
      openAtomicComponent: (ctx) => {
        const target = safeExternalHref(ctx.href) ?? (ref ? `/c/${encodeURIComponent(ref)}?as=view` : "");
        if (!target) return;
        window.open(target, "_blank", "noopener,noreferrer");
      },
      // 詳細(md)の開閉：従来と同じくローカル表示状態のみ。
      editAtomicComponent: (ctx) => setOpenDetail((cur) => (typeof ctx.open === "boolean" ? ctx.open : !cur)),
      // 決裁：従来と同じ確認条 →署名 /__act（runAction）。ここでは権限判断をしない。
      changeStatus: (ctx) => {
        const href = typeof ctx.href === "string" ? ctx.href : "";
        if (!href) return;
        setConfirm({ href, label: String(ctx.label ?? ""), ok: ctx.act === "approve" });
      },
    }),
    [ref]
  );

  const t = data?.theme || FALLBACK;
  const S = useMemo(
    () => ({
      // 文字は選択/コピー可（userSelect は付けない）。青い節点選択背景は
      // config の selectable:false で根治済 ＝ 見栄え悪化なし & コピー可能。
      card: {
        border: `1px solid ${t.border}`,
        background: t.bg,
        color: t.fg,
        borderRadius: t.radius,
        padding: t.pad,
        margin: "6px 0",
        maxWidth: 540,
        font: `${t.font}/1.65 system-ui,-apple-system,'Hiragino Sans','PingFang SC'`,
      } as React.CSSProperties,
      eyebrow: {
        fontSize: 11,
        letterSpacing: ".08em",
        color: t.muted,
        textTransform: "uppercase",
        fontWeight: 600,
      } as React.CSSProperties,
      title: { fontSize: parseInt(t.titleFont), fontWeight: 700, margin: "2px 0 0" } as React.CSSProperties,
      meta: { fontSize: 12, color: t.muted, margin: "6px 0 0" } as React.CSSProperties,
      detailBtn: {
        fontSize: 12,
        color: t.accent,
        cursor: "pointer",
        background: "none",
        border: 0,
        padding: "4px 0",
      } as React.CSSProperties,
      detailBox: {
        fontSize: 12.5,
        color: t.fg,
        background: t.chipBg,
        borderRadius: 8,
        padding: "8px 10px",
        margin: "6px 0 0",
        whiteSpace: "pre-wrap",
      } as React.CSSProperties,
      badge: (all: boolean): React.CSSProperties => ({
        display: "inline-block",
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 9px",
        borderRadius: 999,
        margin: "8px 0 2px",
        border: `1px solid ${all ? t.accent : t.border}`,
        color: all ? t.accent : t.muted,
        background: all ? "transparent" : t.chipBg,
      }),
      badgeNote: { fontSize: 11, color: t.muted, marginLeft: 8 } as React.CSSProperties,
      sep: { border: 0, borderTop: `1px solid ${t.border}`, margin: "10px 0" } as React.CSSProperties,
      chainRow: {
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "3px 0",
        fontSize: 13,
      } as React.CSSProperties,
      progress: { fontSize: 12, fontWeight: 700, color: t.fg, margin: "2px 0 6px" } as React.CSSProperties,
      arow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0" } as React.CSSProperties,
      aname: { flex: 1, fontWeight: 500 } as React.CSSProperties,
      btn: (ok: boolean): React.CSSProperties => ({
        appearance: "none",
        cursor: busy ? "default" : "pointer",
        fontSize: 12,
        fontWeight: 600,
        padding: "4px 12px",
        borderRadius: 6,
        marginLeft: 6,
        opacity: busy ? 0.5 : 1,
        border: `1px solid ${ok ? t.approveBg : t.rejectBorder}`,
        background: ok ? t.approveBg : "transparent",
        color: ok ? t.approveFg : t.rejectFg,
      }),
      confirmBar: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        fontSize: 12.5,
        background: t.chipBg,
        borderRadius: 8,
        padding: "8px 10px",
        margin: "8px 0 0",
      } as React.CSSProperties,
      cBtn: (ok: boolean): React.CSSProperties => ({
        appearance: "none",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 700,
        padding: "4px 12px",
        borderRadius: 6,
        border: `1px solid ${ok ? t.approveBg : t.border}`,
        background: ok ? t.approveBg : "transparent",
        color: ok ? t.approveFg : t.muted,
      }),
      flash: (bad: boolean): React.CSSProperties => ({
        fontSize: 12.5,
        borderRadius: 8,
        padding: "7px 10px",
        margin: "8px 0 0",
        background: bad ? "#FEF2F2" : "#F0FDF4",
        color: bad ? t.rejectFg : t.approveBg,
        border: `1px solid ${bad ? t.rejectBorder : t.approveBg}`,
      }),
      closed: (good: boolean): React.CSSProperties => ({
        fontSize: 12.5,
        fontWeight: 600,
        borderRadius: 8,
        padding: "8px 10px",
        margin: "10px 0 0",
        background: good ? "#F0FDF4" : t.chipBg,
        color: good ? t.approveBg : t.muted,
        border: `1px solid ${good ? t.approveBg : t.border}`,
      }),
      hint: {
        fontSize: 12,
        color: t.muted,
        background: t.chipBg,
        borderRadius: 8,
        padding: "7px 10px",
        margin: "8px 0 0",
      } as React.CSSProperties,
      foot: { marginTop: 12, paddingTop: 10, borderTop: `1px solid ${t.border}`, fontSize: 12 } as React.CSSProperties,
      link: { color: t.muted, textDecoration: "none" } as React.CSSProperties,
      note: { color: t.muted, fontSize: 12 } as React.CSSProperties,
    }),
    [t, busy]
  );

  const dot = (state: string) => {
    const c = state === "approved" ? t.approveBg : state === "rejected" ? t.rejectFg : "transparent";
    const b = state === "pending" ? t.muted : c;
    return (
      <span
        style={{
          display: "inline-block",
          width: 9,
          height: 9,
          borderRadius: 999,
          border: `2px solid ${b}`,
          background: c,
          marginTop: 5,
          flexShrink: 0,
        }}
      />
    );
  };
  const stTxt = (st: string, note: string) =>
    st === "approved"
      ? `承認済${note ? "・" + note : ""}`
      : st === "rejected"
        ? `却下${note ? "・" + note : ""}`
        : "未決";

  return (
    <NodeViewWrapper as="div" data-barsoul-card contentEditable={false}>
      <div style={S.card} contentEditable={false}>
        {err && (
          <div style={S.note}>
            審査カードを読み込めませんでした。
            {ref && (
              <a
                style={S.link}
                target="_blank"
                rel="noopener noreferrer"
                href={`/c/${encodeURIComponent(ref)}?as=view`}
              >
                {" "}
                進捗を開く
              </a>
            )}
          </div>
        )}
        {!data && !err && <div style={S.note}>読み込み中…</div>}
        {/* R5: フラグ ON のときだけ表示専用区間を A2UI で描く。失敗すれば onA2uiFail →
            a2uiSplit が 0 に戻り、下の従来描画が全ブロックを描く（要件 9）。 */}
        {data && a2uiSplit > 0 && (
          <AtomicPresentationSurface
            surfaceId={a2uiSurfaceId}
            blocks={data.blocks}
            detailOpen={openDetail}
            handlers={a2uiHandlers}
            onFail={onA2uiFail}
          />
        )}
        {data &&
          data.blocks.map((b, i) => {
            if (i < a2uiSplit) return null; // A2UI が描いた摘要部は従来側では描かない
            const ty = b.type;
            if (ty === "header")
              return (
                <div key={i}>
                  {/* eyebrow: 既定「審査」。登録フォーム等は spec 側で上書き("" で非表示) */}
                  {(b.eyebrow ?? "審査") !== "" && (
                    <div style={S.eyebrow}>
                      {b.eyebrow ?? "審査"}
                      {b.badge ? ` · ${b.badge}` : ""}
                    </div>
                  )}
                  <div style={S.title}>{b.title}</div>
                  {b.sub && <div style={S.meta}>{b.sub}</div>}
                </div>
              );
            if (ty === "kv")
              return (
                <div key={i} style={S.meta}>
                  {(b.rows || []).map((r: Blk) => `${r.k}：${r.v}`).join("　·　")}
                </div>
              );
            if (ty === "detail") {
              const txt = String(b.md ?? b.text ?? "");
              if (!txt.trim()) return null;
              return (
                <div key={i}>
                  <button style={S.detailBtn} onClick={() => setOpenDetail(!openDetail)}>
                    {openDetail ? "詳細を隠す ▲" : "詳細を見る ▼"}
                  </button>
                  {openDetail && <div style={S.detailBox}>{txt}</div>}
                </div>
              );
            }
            // R4: LLM 工具箱组合的新原子块（presentation-only，主题驱动）
            if (ty === "section")
              return (
                <div key={i} style={{ fontSize: 12, fontWeight: 700, color: t.fg, margin: "12px 0 2px" }}>
                  {b.title}
                </div>
              );
            if (ty === "kvgrid")
              return (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    gap: "2px 12px",
                    fontSize: 12,
                    margin: "6px 0 0",
                  }}
                >
                  {(b.rows || []).flatMap((r: Blk, j: number) => [
                    <div key={`k${j}`} style={{ color: t.muted }}>
                      {r.k}
                    </div>,
                    <div key={`v${j}`}>{r.v}</div>,
                  ])}
                </div>
              );
            if (ty === "table")
              return (
                <table key={i} style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, margin: "6px 0 0" }}>
                  <thead>
                    <tr>
                      {(b.cols || []).map((c: any, j: number) => (
                        <th
                          key={j}
                          style={{
                            textAlign: "left",
                            padding: "4px 8px",
                            borderBottom: `1px solid ${t.border}`,
                            color: t.muted,
                            fontWeight: 600,
                          }}
                        >
                          {String(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(b.rows || []).map((row: any[], j: number) => (
                      <tr key={j}>
                        {(row || []).map((cell, k: number) => (
                          <td key={k} style={{ padding: "4px 8px", borderBottom: `1px solid ${t.border}` }}>
                            {String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            if (ty === "amount")
              return (
                <div key={i} style={{ margin: "8px 0 0", display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 12, color: t.muted }}>{b.label}</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: t.fg }}>{b.value}</span>
                </div>
              );
            if (ty === "callout") {
              const warn = b.tone === "warn";
              return (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    borderRadius: 8,
                    padding: "7px 10px",
                    margin: "8px 0 0",
                    background: warn ? "#FEF3F2" : t.chipBg,
                    border: `1px solid ${warn ? t.rejectBorder : t.border}`,
                  }}
                >
                  {warn ? "⚠ " : "ℹ "}
                  {b.text}
                </div>
              );
            }
            if (ty === "list")
              return (
                <ul key={i} style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
                  {(b.items || []).map((it: any, j: number) => {
                    if (it && typeof it === "object")
                      return (
                        <li key={j}>
                          {it.done ? "✓ " : "○ "}
                          {it.text}
                        </li>
                      );
                    return <li key={j}>{String(it)}</li>;
                  })}
                </ul>
              );
            if (ty === "badge") {
              const tn = b.tone;
              const c =
                tn === "warn"
                  ? { color: t.rejectFg, bg: "#FEF3F2", bd: t.rejectBorder }
                  : tn === "ok"
                    ? { color: t.approveBg, bg: "#F0FDF4", bd: t.approveBg }
                    : tn === "info"
                      ? { color: t.accent, bg: t.chipBg, bd: t.accent }
                      : { color: t.muted, bg: t.chipBg, bd: t.border };
              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 9px",
                    borderRadius: 999,
                    margin: "8px 6px 0 0",
                    color: c.color,
                    background: c.bg,
                    border: `1px solid ${c.bd}`,
                  }}
                >
                  {b.label}
                </span>
              );
            }
            if (ty === "ref" || ty === "link") {
              if (!b.href) return null;
              return (
                <div key={i} style={{ fontSize: 12.5, margin: "6px 0 0" }}>
                  🔗{" "}
                  <a href={b.href} target="_blank" rel="noopener" style={{ color: t.accent }}>
                    {b.label || b.href}
                  </a>
                </div>
              );
            }
            if (ty === "compare") {
              const rows = b.rows || [];
              if (!rows.length) return null;
              return (
                <div key={i} style={{ margin: "8px 0 0" }}>
                  {b.title && (
                    <div style={{ fontSize: 12, fontWeight: 600, margin: "0 0 2px", color: t.muted }}>{b.title}</div>
                  )}
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th
                          style={{
                            textAlign: "left",
                            padding: "3px 6px",
                            color: t.muted,
                            borderBottom: `1px solid ${t.border}`,
                          }}
                        />
                        <th
                          style={{
                            textAlign: "left",
                            padding: "3px 6px",
                            color: t.muted,
                            borderBottom: `1px solid ${t.border}`,
                          }}
                        >
                          変更前
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: "3px 6px",
                            color: t.accent,
                            borderBottom: `1px solid ${t.border}`,
                          }}
                        >
                          変更後
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r: any, j: number) => (
                        <tr key={j}>
                          <td style={{ padding: "3px 6px", color: t.muted }}>{r.k}</td>
                          <td style={{ padding: "3px 6px", textDecoration: "line-through", color: t.muted }}>
                            {r.before}
                          </td>
                          <td style={{ padding: "3px 6px", fontWeight: 600 }}>{r.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
            if (ty === "image") {
              if (!b.src) return null;
              return (
                <figure key={i} style={{ margin: "8px 0 0" }}>
                  <img
                    src={b.src}
                    alt={b.alt || "参照画像"}
                    loading="lazy"
                    style={{ maxWidth: "100%", maxHeight: 280, borderRadius: 6, border: `1px solid ${t.border}` }}
                  />
                  {b.caption && (
                    <figcaption style={{ fontSize: 11, color: t.muted, marginTop: 3 }}>{b.caption}</figcaption>
                  )}
                </figure>
              );
            }
            if (ty === "modebadge")
              return (
                <div key={i}>
                  <span style={S.badge(b.mode === "ALL")}>{b.label}</span>
                  <span style={S.badgeNote} title={b.note}>
                    {b.note}
                  </span>
                </div>
              );
            if (ty === "chain")
              return (
                <div key={i}>
                  <hr style={S.sep} />
                  <div style={S.progress}>進捗：{b.progress}</div>
                  {(b.items || []).map((it: Blk, j: number) => (
                    <div key={j} style={S.chainRow}>
                      {dot(it.state)}
                      <span style={{ flex: 1 }}>
                        <b>{it.name}</b>
                        <span style={{ color: t.muted, marginLeft: 8, fontSize: 12 }}>{stTxt(it.state, it.note)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              );
            // BARSOUL Tier2: 経過事件タイムライン(折り畳み default)。
            // 起票/転審/催促/漂移/決定/終結 を内化、Plane comment 流から排除。
            if (ty === "timeline") return <TimelineBlock key={i} b={b} t={t} S={S} />;
            if (ty === "actions_grouped")
              return (
                <div key={i}>
                  <hr style={S.sep} />
                  {(b.groups || []).map((g: Blk, j: number) => (
                    <div key={j} style={S.arow}>
                      <span style={S.aname}>{g.name}</span>
                      {(g.items || []).map((it: Blk, k: number) => (
                        <button
                          key={k}
                          type="button"
                          disabled={busy}
                          style={S.btn(it.act === "approve")}
                          onClick={() =>
                            it.href &&
                            setConfirm({
                              href: it.href,
                              label: it.label,
                              ok: it.act === "approve",
                            })
                          }
                        >
                          {it.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              );
            // BARSOUL 通用富表单：原子组合的交互表单（场景无关）
            if (ty === "form") return <FormBlock key={i} spec={b} t={t} S={S} reload={load} />;
            if (ty === "closed") {
              const st = String(b.status || "");
              const good = st === "通过";
              return (
                <div key={i} style={S.closed(good)}>
                  {good ? "✅" : st === "却下" ? "❌" : "🛑"} この審査は終了しました（{st}）
                </div>
              );
            }
            if (ty === "authhint")
              return (
                <div key={i} style={S.hint}>
                  {b.text}
                </div>
              );
            // viewlink は冗長(カードが既に進捗表示)→正常時は出さない。
            // カード描画失敗時の導線は上の err 分岐に集約済。
            if (ty === "viewlink") return null;
            if (ty === "divider") return <hr key={i} style={S.sep} />;
            if (ty === "text")
              return (
                <div key={i} style={S.meta}>
                  {b.md}
                </div>
              );
            return null;
          })}

        {/* R3: 確認条（軽量浮層・誤操作防止）。整頁遷移しない */}
        {confirm && (
          <div style={S.confirmBar}>
            <span style={{ flex: 1 }}>
              「<b>{confirm.label}</b>」で送信します。よろしいですか？
            </span>
            <button type="button" style={S.cBtn(confirm.ok)} onClick={() => runAction(confirm)}>
              確定
            </button>
            <button type="button" style={S.cBtn(false)} onClick={() => setConfirm(null)}>
              やめる
            </button>
          </div>
        )}
        {busy && <div style={S.note}>送信中…</div>}
        {flash && (
          <div style={S.flash(flash.bad)}>
            {flash.msg}
            {flash.bad && ref && (
              <>
                {" "}
                <a
                  style={{ ...S.link, color: "inherit", textDecoration: "underline" }}
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`/c/${encodeURIComponent(ref)}?as=view`}
                >
                  進捗ページを開く
                </a>
              </>
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
      const k = m[1],
        idx = +m[2];
      const arr = Array.isArray(c[k]) ? [...c[k]] : [];
      c[k] = arr;
      if (last) arr[idx] = v;
      else {
        arr[idx] = arr[idx] && typeof arr[idx] === "object" ? { ...arr[idx] } : {};
        c = arr[idx];
      }
    } else if (last) c[s] = v;
    else {
      c[s] = c[s] && typeof c[s] === "object" ? (Array.isArray(c[s]) ? [...c[s]] : { ...c[s] }) : {};
      c = c[s];
    }
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
const evalSummary = (st: any, expr: string) => evalSummaryWith(st, expr, resolveP);
// when 用：[idx] 付きの行パスも読めるよう getP で 1 値を返す（cards formWhen と同義）
const whenGet = (s: any, p: string) => [getP(s, p)];
const isEmpty = (v: any) =>
  v == null ||
  (typeof v === "string" && !v.trim()) ||
  (Array.isArray(v) && !v.length) ||
  (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
const toNum = (v: any) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

function validateForm(state: any, rules: any[]): { path: string; msg: string }[] {
  const out: { path: string; msg: string }[] = [];
  for (const r of rules || []) {
    // when = 条件付き rule（隠れている欄は検証しない。cards form.go と同義）
    if (r.when && !matchWhen(state, r.when, "", whenGet)) continue;
    const as = r.assert,
      msg = r.msg || "";
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
      let n = 0;
      vals.forEach((v) => (n += Array.isArray(v) ? v.length : isEmpty(v) ? 0 : 1));
      bad = n < (toNum(r.value) ?? 0);
    } else if (as === "min") bad = vals.some((v) => toNum(v) != null && (toNum(v) as number) < (toNum(r.value) ?? 0));
    else if (as === "max") bad = vals.some((v) => toNum(v) != null && (toNum(v) as number) > (toNum(r.value) ?? 0));
    else if (as === "regex") {
      const re = new RegExp(r.value);
      bad = vals.some((v) => !re.test(String(v)));
    } else if (as === "unique") {
      const s = new Set();
      bad = vals.some((v) => (s.has(String(v)) ? true : (s.add(String(v)), false)));
    }
    if (bad) out.push({ path: r.on, msg: msg || `${r.on} が条件を満たしません` });
  }
  return out;
}

// BARSOUL Tier2: 経過タイムライン(折り畳みリスト)。
// items = [{actor, decision, reason, channel, at_ms}]。decision ∈
// 发起/通过/驳回/催审/状态恢复/转审/撤回/终结/... → 図標 + 短文に正規化。
function TimelineBlock(props: { b: any; t: Theme; S: any }) {
  const { b, t, S } = props;
  const items: any[] = b.items || [];
  const [open, setOpen] = useState<boolean>(!b.collapsed);
  if (items.length === 0) return null;
  const fmtTs = (ms: number) => {
    if (!ms) return "";
    try {
      const d = new Date(ms);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      if (sameDay) return `${hh}:${mm}`;
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${mo}/${dd} ${hh}:${mm}`;
    } catch {
      return "";
    }
  };
  const icon = (dec: string) => {
    if (dec === "通过") return "✓";
    if (dec === "驳回") return "✕";
    if (dec === "撤回") return "↩";
    if (dec === "终结") return "🏁";
    if (dec === "催审") return "⏰";
    if (dec === "状态恢复") return "🔒";
    if (dec === "转审" || dec === "転審") return "🔄";
    if (dec === "发起" || dec === "起票") return "▸";
    return "•";
  };
  return (
    <div style={{ marginTop: 8 }}>
      <hr style={S.sep} />
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: 0,
          padding: "2px 0",
          cursor: "pointer",
          color: t.muted,
          fontSize: 11.5,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 9 }}>{open ? "▼" : "▶"}</span>
        <span>
          {b.label || "経過"} ({items.length})
        </span>
      </button>
      {open && (
        <div style={{ paddingLeft: 12, marginTop: 4 }}>
          {items.map((it: any, i: number) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                fontSize: 12,
                padding: "3px 0",
                color: t.fg,
              }}
            >
              <span style={{ width: 14, textAlign: "center", color: t.muted, fontSize: 12 }}>{icon(it.decision)}</span>
              <span style={{ color: t.muted, fontSize: 11, minWidth: 60, fontVariantNumeric: "tabular-nums" }}>
                {fmtTs(it.at_ms)}
              </span>
              <span style={{ fontWeight: 500 }}>{it.actor}</span>
              <span style={{ color: t.muted }}>{it.decision}</span>
              {it.reason && (
                <span style={{ color: t.muted, fontSize: 11.5, opacity: 0.85, flex: 1 }}>— {it.reason}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const QUICK_LABEL: Record<string, string> = {
  today: "今日",
  tomorrow: "明日",
  eom: "月末",
  "+7d": "1週間後",
  "-1d": "昨日",
};

function CopyBtn(props: { text: string; t: Theme }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      title="コピー"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.text);
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        } catch {
          /* clipboard 不可（http 等） */
        }
      }}
      style={{
        flexShrink: 0,
        padding: "1px 8px",
        fontSize: 11.5,
        borderRadius: 10,
        border: `1px solid ${props.t.border}`,
        background: "transparent",
        color: ok ? props.t.approveBg : props.t.muted,
        cursor: "pointer",
      }}
    >
      {ok ? "✓ コピー済" : "コピー"}
    </button>
  );
}

function FormBlock(props: { spec: any; t: Theme; S: any; reload: () => Promise<void> }) {
  const { spec, t, S, reload } = props;
  const editable = spec?.editable !== false && !!spec?.submit && !spec?.closed;
  const [st, setSt] = useState<any>(() => spec?.state ?? {});
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ msg: string; bad: boolean } | null>(null);
  // 押して弾かれるまでは赤枠を出さない（開いた瞬間に全部赤＝怒られてる感しかない）
  const [tried, setTried] = useState(false);
  // 下書き自動保存（per 端末の便利機能。消えても困らない＝localStorage で十分）
  // 共有チェックリスト（spec.shared）は 1 タップ＝即送信なので下書きは持たない
  const draftKey =
    spec?.submit?.url && spec?.submit?.u && !spec?.shared ? `bs-card-draft:${spec.submit.url}:${spec.submit.u}` : "";
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const baseRef = useRef<string>(JSON.stringify(spec?.state ?? {}));
  const btnRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!editable || !draftKey) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d?.state && JSON.stringify(d.state) !== baseRef.current) {
        setSt(d.state);
        setDraftAt(d.at || Date.now());
      }
    } catch {
      /* 保存領域なし・壊れた下書きは無視 */
    }
  }, [draftKey, editable]);
  useEffect(() => {
    if (!editable || !draftKey) return;
    const id = setTimeout(() => {
      try {
        const cur = JSON.stringify(st);
        if (cur === baseRef.current) localStorage.removeItem(draftKey);
        else localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), state: st }));
      } catch {
        /* noop */
      }
    }, 600);
    return () => clearTimeout(id);
  }, [st, draftKey, editable]);
  const discardDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* noop */
    }
    setSt(JSON.parse(baseRef.current));
    setDraftAt(null);
  };
  const errs = useMemo(() => validateForm(st, spec?.rules || []), [st, spec]);
  const errsNow = errs;
  const stNow = st;
  // clap：値を入れて即送信（確認ダイアログなし＝1 タップで完結）
  const quick = (path: string, v: any, anchor?: HTMLElement | null) => {
    const next = setP(st, path, v);
    setSt(next);
    void submit("approve", { state: next, anchor });
  };
  // sharedlist：1 件だけ静かに送る（flash も 1.5s 待ちも無し。取り直しは原子側）
  const post = async (state: any): Promise<{ ok: boolean; msg?: string }> => {
    try {
      const r = await fetch(spec.submit.url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          u: spec.submit.u,
          sig: spec.submit.sig,
          decision: "approve",
          nonce: `shared-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          state,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) return { ok: false, msg: j.msg || `HTTP ${r.status}` };
      return { ok: true, msg: j.msg };
    } catch (e) {
      return { ok: false, msg: `送信に失敗しました（${String(e)}）` };
    }
  };
  const errAt = useMemo(() => {
    const m = new Map<string, string>();
    if (tried) for (const e of errs) if (!m.has(e.path)) m.set(e.path, e.msg);
    return m;
  }, [errs, tried]);
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

  const submit = async (decision: "approve" | "reject", over?: { state: any; anchor?: HTMLElement | null }) => {
    setConfirm(null);
    const errs = over ? validateForm(over.state, spec?.rules || []) : errsNow;
    const st = over ? over.state : stNow;
    if (decision === "approve" && errs.length) {
      setTried(true);
      setFlash({ msg: errs[0].msg, bad: true });
      return;
    }
    setBusy(true);
    setFlash(null);
    try {
      const r = await fetch(spec.submit.url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          u: spec.submit.u,
          sig: spec.submit.sig,
          decision,
          nonce: `${decision}-${Date.now()}`,
          state: st,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) {
        const m = (j.errors && j.errors[0]?.msg) || j.msg || `HTTP ${r.status}`;
        setFlash({ msg: m, bad: true });
        setBusy(false);
        return;
      }
      setFlash({ msg: (j.msg || "受け付けました") + " — 状態を更新中…", bad: false });
      try {
        if (draftKey) localStorage.removeItem(draftKey);
      } catch {
        /* noop */
      }
      baseRef.current = JSON.stringify(st);
      setDraftAt(null);
      if (decision === "approve" && spec.celebrate) celebrate(over?.anchor || btnRef.current);
      // ADR-027 補正: Temporal は async 故 BaseUpdate に 1-3s かかる. その間
      // reload しても chain block が古いまま → ユーザ "効いてない?" と再 submit
      // → 重複 reassign signal. 1.5s 待ってから reload で大半救う + busy 維持.
      await new Promise((res) => setTimeout(res, 1500));
      await reload();
      // 更新が済んだら「更新中…」を外す（残ると止まって見える）
      setFlash({ msg: j.msg || "受け付けました", bad: false });
    } catch (e) {
      setFlash({ msg: `送信に失敗しました（${String(e)}）`, bad: true });
    } finally {
      setBusy(false);
    }
  };

  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.fg, margin: "10px 0 4px" };
  const inp: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 13,
    padding: "6px 8px",
    border: `1px solid ${t.border}`,
    borderRadius: 6,
    background: t.bg,
    color: t.fg,
  };
  const ro = !editable;

  const Atom = (a: any, bp = "", k?: React.Key): React.ReactNode => {
    // when: 条件表示（「.x」は repeater 行内の相対パス）
    if (a.when && !matchWhen(st, a.when, bp, whenGet)) return null;
    const bind = bp ? `${bp}.${a.bind}` : a.bind;
    const val = bind ? getP(st, bind) : undefined;
    const req = !ro && !!bind && isRequired(spec?.rules || [], bind);
    const head = (a.label || a.help) && (
      <>
        {a.label && (
          <div style={lbl}>
            {a.label}
            {req && (
              <span style={{ color: t.rejectFg, marginLeft: 3 }} title="必須">
                *
              </span>
            )}
          </div>
        )}
        {a.help && !ro && <div style={{ fontSize: 11.5, color: t.muted, margin: "-2px 0 4px" }}>{a.help}</div>}
      </>
    );
    if (isExtraAtom(a.atom))
      return renderExtraAtom(
        a,
        {
          bind,
          val,
          set,
          ro,
          t,
          S,
          inp,
          err: bind ? errAt.get(bind) : undefined,
          label: head,
          evalExpr: (e: string) => evalSummary(st, e),
          renderChild: (c: any, ck: React.Key) => Atom(c, bp, ck),
          crowd: spec?.crowd,
          me: spec?.me,
          quick: editable ? quick : undefined,
          crowdTotal: spec?.crowd_total,
          closed: !!spec?.closed,
          shared: spec?.shared,
          post: editable ? post : undefined,
          reload,
        },
        k
      );
    switch (a.atom) {
      case "field": {
        const it = a.input || "text";
        if (ro)
          return (
            <div key={k} style={{ ...S.meta, display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                <b>{a.label}</b>：{fieldText(val, a)}
              </span>
              {a.copy && !isEmpty(val) && <CopyBtn text={String(val)} t={t} />}
            </div>
          );
        const err = errAt.get(bind);
        // quick = ワンタップ入力（"today" / "+7d" 等は日付に解決）
        const quick: any[] = Array.isArray(a.quick) ? a.quick : [];
        const box = err ? { ...inp, borderColor: t.rejectFg } : inp;
        // suggest = 候補（自由入力可）。datalist id はカード内で一意なら十分
        const listId = Array.isArray(a.suggest) && a.suggest.length ? `dl-${bind.replace(/[^\w]/g, "_")}` : undefined;
        return (
          <div key={k}>
            {head}
            {it === "textarea" ? (
              <textarea
                style={{ ...box, minHeight: 56 }}
                value={val ?? ""}
                placeholder={a.placeholder}
                onChange={(e) => set(bind, e.target.value)}
              />
            ) : it === "select" ? (
              <select style={box} value={val ?? ""} onChange={(e) => set(bind, e.target.value)}>
                <option value="">{a.placeholder || "選択してください"}</option>
                {(a.options || []).map((o: any) => (
                  <option key={o.value ?? o} value={o.value ?? o}>
                    {o.label ?? o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                style={box}
                type={it}
                inputMode={it === "number" ? "decimal" : undefined}
                value={val ?? ""}
                placeholder={a.placeholder}
                min={a.min}
                max={a.max}
                step={a.step}
                list={listId}
                onChange={(e) => set(bind, it === "number" ? toNum(e.target.value) : e.target.value)}
              />
            )}
            {listId && (
              <datalist id={listId}>
                {a.suggest.map((s: string) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
            {quick.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                {quick.map((q: any) => {
                  const qv = resolveQuick(q && typeof q === "object" ? q.value : q);
                  const ql = q && typeof q === "object" ? q.label : QUICK_LABEL[q] || String(q);
                  const on = val === qv || String(val ?? "") === String(qv);
                  return (
                    <button
                      key={ql}
                      type="button"
                      onClick={() => set(bind, it === "number" ? toNum(qv) : qv)}
                      style={{
                        minHeight: 28,
                        padding: "2px 10px",
                        fontSize: 12,
                        borderRadius: 14,
                        border: `1px solid ${on ? t.accent : t.border}`,
                        background: on ? t.accent : "transparent",
                        color: on ? "#fff" : t.fg,
                        cursor: "pointer",
                      }}
                    >
                      {ql}
                    </button>
                  );
                })}
              </div>
            )}
            {err && <div style={{ color: t.rejectFg, fontSize: 11.5, marginTop: 3 }}>{err}</div>}
          </div>
        );
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
                <div
                  key={it.id}
                  onClick={() => toggle(it.id)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "5px 0",
                    cursor: ro ? "default" : "pointer",
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      flexShrink: 0,
                      marginTop: 1,
                      borderRadius: 4,
                      border: `1.5px solid ${on ? t.approveBg : t.border}`,
                      background: on ? t.approveBg : "transparent",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span style={{ flex: 1 }}>
                    {it.label}
                    {it.sub && <span style={{ color: t.muted, marginLeft: 6, fontSize: 12 }}>{it.sub}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        );
      }
      case "repeater": {
        const arr: any[] = Array.isArray(val) ? val : [];
        const addItem = () => set(bind, [...arr, a.itemDefault ? JSON.parse(JSON.stringify(a.itemDefault)) : {}]);
        const del = (idx: number) =>
          set(
            bind,
            arr.filter((_, x) => x !== idx)
          );
        return (
          <div key={k}>
            {a.label && <div style={lbl}>{a.label}</div>}
            {arr.map((_, idx) => (
              <div
                key={idx}
                style={{ border: `1px solid ${t.border}`, borderRadius: 8, padding: "8px 10px", margin: "6px 0" }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    fontWeight: 600,
                    color: t.muted,
                  }}
                >
                  <span>{(a.itemLabel || "項目 {i}").replace("{i}", String(idx + 1))}</span>
                  {!ro && (a.min == null || arr.length > a.min) && (
                    <button
                      type="button"
                      onClick={() => del(idx)}
                      style={{ background: "none", border: 0, color: t.rejectFg, cursor: "pointer", fontSize: 12 }}
                    >
                      削除
                    </button>
                  )}
                </div>
                {(a.template || []).map((c: any, ci: number) => Atom(c, `${bind}[${idx}]`, ci))}
              </div>
            ))}
            {!ro && (a.max == null || arr.length < a.max) && (
              <button type="button" onClick={addItem} style={{ ...S.detailBtn, fontWeight: 600 }}>
                {a.addLabel || "＋ 追加"}
              </button>
            )}
          </div>
        );
      }
      case "summary": {
        const out = evalSummary(st, a.expr || "");
        return (
          <div key={k} style={{ ...S.meta, fontWeight: 600 }}>
            {a.label}：{out}
            {a.unit || ""}
          </div>
        );
      }
      case "table": {
        const rows: any[] = a.rows ? (Array.isArray(a.rows) ? a.rows : resolveP(st, a.rows)) : [];
        const cols = a.columns || [];
        return (
          <div key={k} style={{ overflowX: "auto", margin: "6px 0" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
              <thead>
                <tr>
                  {cols.map((c: any) => (
                    <th
                      key={c.key}
                      style={{
                        textAlign: "left",
                        padding: "4px 8px",
                        borderBottom: `1px solid ${t.border}`,
                        color: t.muted,
                      }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((rw, ri) => (
                  <tr key={ri}>
                    {cols.map((c: any) => (
                      <td key={c.key} style={{ padding: "4px 8px", borderBottom: `1px solid ${t.border}` }}>
                        {String(rw?.[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "pool": {
        const arr: any[] = Array.isArray(val) ? val : [];
        const into = a.into; // 例 "state.packages"（触屏兜底の移動先箱）
        const boxes: any[] = into ? getP(st, into) || [] : [];
        const rowS: React.CSSProperties = {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 8px",
          margin: "4px 0",
          border: `1px solid ${t.border}`,
          borderRadius: 6,
          background: t.chipBg,
          fontSize: 13,
        };
        return (
          <div key={k}>
            {a.label && (
              <div style={lbl}>
                {a.label}（未分配 {arr.length}）
              </div>
            )}
            {arr.map((it: any, ix: number) => (
              <div
                key={it.id ?? ix}
                draggable={!ro}
                onDragStart={() => {
                  if (!ro) _dragItem = { from: bind, id: it.id };
                }}
                style={{ ...rowS, cursor: ro ? "default" : "grab" }}
              >
                <span style={{ flex: 1 }}>
                  {!ro && <span style={{ color: t.muted, marginRight: 6 }}>⠿</span>}
                  {it.name}
                  {it.qty != null ? ` ×${it.qty}` : ""}
                </span>
                {!ro && boxes.length > 0 && (
                  <select
                    value=""
                    style={{ ...inp, width: 110 }}
                    onChange={(e) => {
                      const bi = parseInt(e.target.value, 10);
                      if (!isNaN(bi)) moveItem(bind, `${into}[${bi}].items`, it.id);
                    }}
                  >
                    <option value="">→ 箱へ</option>
                    {boxes.map((_: any, bi: number) => (
                      <option key={bi} value={bi}>
                        箱{bi + 1}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
            {arr.length === 0 && <div style={S.note}>（すべて分配済み）</div>}
          </div>
        );
      }
      case "dropzone": {
        const arr: any[] = Array.isArray(val) ? val : [];
        const from = a.from || "state.pool";
        const rowS: React.CSSProperties = {
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 6px",
          margin: "3px 0",
          fontSize: 13,
        };
        return (
          <div
            key={k}
            onDragOver={(e) => {
              if (!ro) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (ro || !_dragItem) return;
              moveItem(_dragItem.from || from, bind, _dragItem.id);
              _dragItem = null;
            }}
            style={{
              border: `1.5px dashed ${t.border}`,
              borderRadius: 8,
              padding: "8px 10px",
              margin: "4px 0",
              minHeight: 36,
              background: t.bg,
            }}
          >
            {arr.length === 0 && <div style={S.note}>{ro ? "（空）" : "ここに商品をドラッグ／池で「→ 箱へ」"}</div>}
            {arr.map((it: any, ix: number) => (
              <div key={it.id ?? ix} style={rowS}>
                <span style={{ flex: 1 }}>{it.name}</span>
                {a.qty !== false && (
                  <input
                    type="number"
                    style={{ ...inp, width: 70 }}
                    disabled={ro}
                    value={it.qty ?? ""}
                    min={0}
                    onChange={(e) => set(`${bind}[${ix}].qty`, toNum(e.target.value))}
                  />
                )}
                {!ro && (
                  <button
                    type="button"
                    title="池へ戻す"
                    onClick={() => moveItem(bind, from, it.id)}
                    style={{ background: "none", border: 0, color: t.rejectFg, cursor: "pointer", fontSize: 13 }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      }
      case "ordered_checklist": {
        // ADR-027: 承認チェーンの順序可視 + 拖動入替 + 未選択候補から追加.
        // val = checked ids の **順序を持つ array**; items = 全候補 [{id,label}].
        // 表示順: 選択中(val 順) → 未選択(items 残り).
        const arr: string[] = (Array.isArray(val) ? val : []).filter((x: any) => typeof x === "string");
        const items: any[] = a.items || [];
        const inArr = new Set(arr);
        const orderedSelected = arr.map((id) => items.find((it) => it.id === id)).filter(Boolean);
        const unselected = items.filter((it) => !inArr.has(it.id));
        const toggle = (id: string) => {
          if (ro) return;
          if (inArr.has(id))
            set(
              bind,
              arr.filter((x) => x !== id)
            );
          else set(bind, [...arr, id]);
        };
        const reorder = (from: number, to: number) => {
          if (ro || from === to || from < 0 || to < 0 || from >= arr.length) return;
          const next = [...arr];
          const [m] = next.splice(from, 1);
          next.splice(Math.min(to, next.length), 0, m);
          set(bind, next);
        };
        // BARSOUL: read-only 模式下隐藏所有编辑提示语和候选追加区。
        // 标签中括号内的操作说明(例「審査者(⠿でドラッグ=...)」)在 ro 时
        // 也截掉,呈现为纯静态信息卡片。
        const _labelText = a.label
          ? ro
            ? String(a.label)
                .split(/[（(]/)[0]
                .trim()
            : a.label
          : null;
        return (
          <div key={k}>
            {_labelText && <div style={lbl}>{_labelText}</div>}
            <div
              style={{
                border: `1px solid ${t.border}`,
                borderRadius: 8,
                padding: "4px 6px",
                margin: "4px 0",
                background: t.bg,
              }}
            >
              {orderedSelected.map((it: any, ix: number) => (
                <div
                  key={it.id}
                  draggable={!ro}
                  onDragStart={(e) => {
                    if (!ro) e.dataTransfer.setData("text/plain", String(ix));
                  }}
                  onDragOver={(e) => {
                    if (!ro) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (ro) return;
                    const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
                    if (!isNaN(from)) reorder(from, ix);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 6px",
                    margin: "2px 0",
                    fontSize: 13,
                    borderRadius: 6,
                    background: t.chipBg,
                    cursor: ro ? "default" : "grab",
                  }}
                >
                  {!ro && (
                    <span style={{ color: t.muted, fontSize: 12, width: 14 }} title="ドラッグで順序入替">
                      ⠿
                    </span>
                  )}
                  <span style={{ width: 18, color: t.approveBg, fontWeight: 700, fontSize: 12, textAlign: "center" }}>
                    {ix + 1}
                  </span>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: `1.5px solid ${t.approveBg}`,
                      background: t.approveBg,
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: ro ? "default" : "pointer",
                    }}
                    onClick={() => toggle(it.id)}
                  >
                    ✓
                  </span>
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {!ro && (
                    <button
                      type="button"
                      title="外す"
                      onClick={() => toggle(it.id)}
                      style={{
                        background: "none",
                        border: 0,
                        color: t.rejectFg,
                        cursor: "pointer",
                        fontSize: 13,
                        padding: "2px 6px",
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {orderedSelected.length === 0 && !ro && (
                <div style={{ ...S.note, padding: "6px 4px" }}>(未選択 — 下から追加してください)</div>
              )}
              {orderedSelected.length === 0 && ro && <div style={{ ...S.note, padding: "6px 4px" }}>(未選択)</div>}
            </div>
            {/* BARSOUL: read-only ユーザに「追加可能」候補を出さない(編集示唆を消す) */}
            {!ro && unselected.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: t.muted, margin: "8px 0 4px" }}>＋ 追加可能</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {unselected.map((it: any) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => toggle(it.id)}
                      style={{
                        padding: "4px 10px",
                        fontSize: 12.5,
                        border: `1px dashed ${t.border}`,
                        borderRadius: 14,
                        background: "transparent",
                        color: t.fg,
                        cursor: "pointer",
                      }}
                    >
                      ＋ {it.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      }
      case "text":
        return (
          <div key={k} style={S.meta}>
            {a.md ?? a.text}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div>
      {draftAt && editable && (
        <div style={{ ...S.note, display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
          <span style={{ flex: 1 }}>
            前回の入力途中を復元しました（
            {new Date(draftAt).toLocaleString("ja-JP", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            ）
          </span>
          <button
            type="button"
            onClick={discardDraft}
            style={{
              background: "none",
              border: 0,
              color: t.accent,
              cursor: "pointer",
              fontSize: 12,
              textDecoration: "underline",
            }}
          >
            破棄
          </button>
        </div>
      )}
      {(spec.blocks || []).map((a: any, i: number) => Atom(a, "", i))}
      {editable && (
        <>
          {errs.length > 0 && (
            <div style={{ ...S.hint, color: t.rejectFg, background: "#FEF2F2", border: `1px solid ${t.rejectBorder}` }}>
              ⚠ {errs[0].msg}
              {errs.length > 1 && ` 他 ${errs.length - 1} 件`}
            </div>
          )}
          {/* 紙吹雪の起点。ボタン自体は確認バー/送信中で消えるので常在の枠に ref を付ける */}
          <div ref={btnRef} />
          {/* hideButton = 原子だけで送信が完結するフォーム（poll/clap のみ）。ボタンがあると「押さないと投票されない？」と迷う */}
          {!confirm && !busy && spec.hideButton !== true && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                aria-disabled={errs.length > 0}
                // 無効化せず押せる：押したら未入力欄を赤枠で示す（disabled だと何が足りないか分からない）
                // confirm:false = 取り消しの効く軽い送信（ひとこと等）は確認バーを挟まない
                onClick={() => (errs.length || spec.confirm === false ? submit("approve") : setConfirm("approve"))}
                style={{
                  ...S.btn(true),
                  marginLeft: 0,
                  opacity: errs.length > 0 ? 0.55 : 1,
                }}
              >
                {spec.approveLabel || "✅ 承認"}
              </button>
              {/* reject:false = 登録型フォーム(発送等)。審査ではないので却下ボタンなし */}
              {spec.reject !== false && (
                <button type="button" onClick={() => setConfirm("reject")} style={S.btn(false)}>
                  {spec.rejectLabel || "❌ 却下"}
                </button>
              )}
            </div>
          )}
          {confirm && (
            <div style={S.confirmBar}>
              <span style={{ flex: 1 }}>
                「<b>{confirm === "approve" ? spec.approveText || "承認" : spec.rejectText || "却下"}</b>」
                で送信します。よろしいですか？
              </span>
              <button type="button" style={S.cBtn(confirm === "approve")} onClick={() => submit(confirm)}>
                確定
              </button>
              <button type="button" style={S.cBtn(false)} onClick={() => setConfirm(null)}>
                やめる
              </button>
            </div>
          )}
          {busy && <div style={S.note}>送信中…</div>}
        </>
      )}
      {flash && <div style={S.flash(flash.bad)}>{flash.msg}</div>}
    </div>
  );
}
