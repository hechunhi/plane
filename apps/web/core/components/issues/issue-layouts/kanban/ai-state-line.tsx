/**
 * BARSOUL: 派生卡片当前态 (Derived Issue State, DIS) v2 — 看板卡顶状态行 + 富 hover 详情。
 *
 * 真相=issue+comments,派生=ai-bot(cloud Claude)写入 issue_ai_states。本组件**只读**。
 * 设计对齐用户 mockup:球在我方=暖琥珀(inbox)/球在对方=冷灰蓝(send);actor person/external;
 * next/reason/waiting 按**阅览者语言**(中/日双存,前端按 currentLocale 取);hover 出富 popover
 * (下一步/当前行动人/推断依据=源评论引用/reason/置信度)。
 * 取数:模块级 batcher 120ms 去抖,同 project 多卡合并一次 /ai-states 请求。
 * 失败安全:无派生/UNKNOWN(无 ball)/低置信 → 不渲染。详 docs/architecture/derived-issue-state-mvp.md。
 */
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";

type Bilingual = { zh: string; ja: string };
export type DerivedIssueState = {
  issue_id: string;
  state: "ACTIVE" | "WAITING" | "STALE" | "UNKNOWN";
  ball: "SELF" | "OTHER" | null;
  actor_kind: "person" | "external" | null;
  actor_name: string | null;
  actor_user_id: string | null;
  owner: string | null;
  unassigned: boolean;
  waiting_on: Bilingual;
  next_action: Bilingual;
  reasoning: Bilingual;
  source: { author: string; quote: string };
  due_date: string | null;
  stale_days: number;
  confidence: number;
  updated_at: string | null;
};

const STALL_TH = 4; // 停滞阈值(天):≥TH=mid(琥珀),≥2×TH=high(红)

// ── 模块级批量取数器 ────────────────────────────────────────────────────────
const _cache = new Map<string, DerivedIssueState | null>();
const _cacheTs = new Map<string, number>();
const _TTL_MS = 90_000; // 缓存 90s; 过期则下次渲染重拉(ai-bot 改派生后看板自然刷新)
const _subs = new Map<string, Set<() => void>>();
const _pending = new Map<string, Set<string>>();
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _slug = "";

function _notify(id: string) {
  _subs.get(id)?.forEach((f) => f());
}
function _store(id: string, v: DerivedIssueState | null) {
  _cache.set(id, v);
  _cacheTs.set(id, Date.now());
  _notify(id);
}
function _fresh(id: string) {
  return _cacheTs.has(id) && Date.now() - (_cacheTs.get(id) || 0) < _TTL_MS;
}
async function _flush() {
  const slug = _slug;
  const byProject = new Map(_pending);
  _pending.clear();
  for (const [projectId, idSet] of byProject) {
    const ids = Array.from(idSet);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      try {
        const r = await fetch(
          `/api/workspaces/${slug}/projects/${projectId}/issues/ai-states/?issues=${chunk.join(",")}`,
          { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } }
        );
        if (!r.ok) {
          chunk.forEach((id) => _store(id, _cache.get(id) ?? null)); // 保留旧值, 仅更新 ts 防抖
          continue;
        }
        const data: Record<string, DerivedIssueState> = await r.json();
        chunk.forEach((id) => _store(id, data[id] ?? null));
      } catch {
        chunk.forEach((id) => _store(id, _cache.get(id) ?? null));
      }
    }
  }
}
function _scheduleFlush(slug: string) {
  _slug = slug;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    void _flush();
  }, 120);
}
export function useIssueAIState(
  slug: string | undefined,
  projectId: string | null | undefined,
  issueId: string | undefined
): DerivedIssueState | null {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!slug || !projectId || !issueId) return;
    let set = _subs.get(issueId);
    if (!set) {
      set = new Set();
      _subs.set(issueId, set);
    }
    set.add(force);
    if (!_fresh(issueId)) {
      let ps = _pending.get(projectId);
      if (!ps) {
        ps = new Set();
        _pending.set(projectId, ps);
      }
      ps.add(issueId);
      _scheduleFlush(slug);
    }
    return () => {
      set?.delete(force);
      if (set && set.size === 0) _subs.delete(issueId);
    };
  }, [slug, projectId, issueId, force]);
  return issueId ? _cache.get(issueId) ?? null : null;
}

// ── i18n / 视觉常量 ─────────────────────────────────────────────────────────
export function isZhLocale(loc: string | undefined) {
  return (loc || "").toLowerCase().startsWith("zh");
}
export function pick(b: Bilingual | undefined, zh: boolean): string {
  if (!b) return "";
  return (zh ? b.zh : b.ja) || b.zh || b.ja || "";
}
export const BALL_META = {
  SELF: { key: "us" as const, bg: "#fef3e2", border: "#f3d3a0", text: "#9a5b08", dot: "#d97a0a",
    label: { zh: "球在我方", ja: "自社対応" } },
  OTHER: { key: "them" as const, bg: "#eef2f6", border: "#dbe3ea", text: "#4d6076", dot: "#7a8da0",
    label: { zh: "球在对方", ja: "先方待ち" } },
};
export function stallTone(days: number): "none" | "mid" | "high" {
  if (days >= STALL_TH * 2) return "high";
  if (days >= STALL_TH) return "mid";
  return "none";
}
const AV_COLORS = ["#167e56", "#0e7490", "#4f46e5", "#b45309", "#7c3aed", "#c8493f", "#2563eb"];
export function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

// 内联图标
export function Ico({ d, size = 12, sw = 1.7, color = "currentColor" }: { d: string[] | string; size?: number; sw?: number; color?: string }) {
  const ps = Array.isArray(d) ? d : [d];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
      {ps.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
export const ICON = {
  inbox: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4 20-7z"],
  arrowRight: ["M5 12h14", "M12 5l7 7-7 7"],
  building: ["M3 21h18", "M5 21V7l8-4v18", "M19 21V11l-6-4"],
  user: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  alert: ["M12 9v4", "M12 17h.01", "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"],
  sparkle: ["M12 3l1.6 4.5L18 9l-4.4 1.5L12 15l-1.6-4.5L6 9l4.4-1.5L12 3z"],
  calendar: ["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"],
  columns: ["M3 3h18v18H3z", "M12 3v18"],
};

export function AvatarBadge({ name, size = 18 }: { name: string; size?: number }) {
  const initial = (name || "?").trim().charAt(0) || "?";
  return (
    <span title={name} style={{
      width: size, height: size, borderRadius: 4, background: avatarColor(name), color: "#fff",
      fontSize: size * 0.56, fontWeight: 600, display: "inline-flex", alignItems: "center",
      justifyContent: "center", flex: "none",
    }}>{initial}</span>
  );
}

export function StallChip({ days, zh }: { days: number; zh: boolean }) {
  const tone = stallTone(days);
  if (tone === "none") return null;
  const c = tone === "high" ? { bg: "#fdeaea", bd: "#f3c4c4", tx: "#c0392b" } : { bg: "#fdf3e2", bd: "#f0d9a8", tx: "#b06d09" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600,
      background: c.bg, border: "1px solid " + c.bd, color: c.tx, borderRadius: 4, padding: "0px 5px", flex: "none" }}>
      {tone === "high" && <Ico d={ICON.alert} size={10} sw={2} />}
      {zh ? `停滞 ${days} 天` : `${days}日停滞`}
    </span>
  );
}

// due 标签 + tone
export function dueInfo(due: string | null, zh: boolean): { label: string; tone: "normal" | "soon" | "overdue" } | null {
  if (!due) return null;
  try {
    const d = new Date(due + "T00:00:00");
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
    let tone: "normal" | "soon" | "overdue" = "normal";
    if (diff < 0) tone = "overdue";
    else if (diff <= 2) tone = "soon";
    const label = tone === "overdue"
      ? (zh ? `逾期 ${-diff} 天` : `${-diff}日超過`)
      : diff === 0 ? (zh ? "今天" : "本日") : `${d.getMonth() + 1}/${d.getDate()}`;
    return { label, tone };
  } catch {
    return null;
  }
}

// ── 富 popover ──────────────────────────────────────────────────────────────
function Popover({ s, zh, rect }: { s: DerivedIssueState; zh: boolean; rect: DOMRect }) {
  const ball = s.ball ? BALL_META[s.ball] : null;
  const W = 300;
  const m = 12;
  let left = rect.right + 10;
  if (left + W > window.innerWidth - m) left = rect.left - W - 10;
  if (left < m) left = m;
  let top = rect.top;
  if (top + 250 > window.innerHeight - m) top = Math.max(m, window.innerHeight - 250 - m);
  const di = dueInfo(s.due_date, zh);
  const conf = s.confidence >= 0.75 ? { t: zh ? "高" : "高", c: "#16a34a" } : s.confidence >= 0.45 ? { t: zh ? "中" : "中", c: "#b45309" } : { t: zh ? "低" : "低", c: "#9ca3af" };
  const reason = pick(s.reasoning, zh);
  return (
    <div style={{ position: "fixed", left, top, width: W, zIndex: 90, pointerEvents: "none",
      background: "#fff", border: "1px solid #e3e5e9", borderRadius: 9, maxHeight: "min(360px, 80vh)",
      boxShadow: "0 12px 32px -8px rgba(16,24,40,0.22)", overflow: "hidden", textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px", borderBottom: "1px solid #f0f1f3", background: "#fbfbfc" }}>
        <Ico d={ICON.sparkle} size={13} color="#7c5cff" sw={1.8} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3a3d42" }}>{zh ? "AI 当前态" : "AI 現状"}</span>
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: conf.c, fontWeight: 600 }}>{zh ? "置信度" : "確度"} {conf.t}</span>
      </div>
      <div style={{ padding: "10px 11px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {ball && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600,
              background: ball.bg, border: "1px solid " + ball.border, color: ball.text, borderRadius: 4, padding: "1px 7px" }}>
              <Ico d={s.ball === "SELF" ? ICON.inbox : ICON.send} size={11} sw={1.8} color={ball.text} />
              {pick(ball.label, zh)}
            </span>
          )}
          <StallChip days={s.stale_days} zh={zh} />
          {di && (
            <span style={{ fontSize: 11, color: di.tone === "overdue" ? "#c0392b" : "#6b7280",
              display: "inline-flex", alignItems: "center", gap: 3, border: "1px solid #eceef1", borderRadius: 4, padding: "0px 6px" }}>
              <Ico d={ICON.calendar} size={10} />{di.label}
            </span>
          )}
        </div>
        <PField label={zh ? "下一步" : "次アクション"} icon={ICON.arrowRight} zh={zh}>{pick(s.next_action, zh) || "—"}</PField>
        <PField label={zh ? "当前行动人" : "対応者"} icon={s.actor_kind === "person" ? ICON.user : ICON.building} zh={zh}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            {s.actor_kind === "person" && s.actor_name && <AvatarBadge name={s.actor_name} size={16} />}
            {s.actor_name || "—"}
            {s.unassigned && <span style={{ color: "#b45309", fontWeight: 600 }}>（{zh ? "待指派" : "担当未定"}）</span>}
          </span>
        </PField>
        {s.ball === "OTHER" && pick(s.waiting_on, zh) && (
          <PField label={zh ? "在等" : "待ち"} icon={ICON.clock} zh={zh}>{pick(s.waiting_on, zh)}</PField>
        )}
        {(s.source.quote || reason) && (
          <div style={{ borderTop: "1px dashed #ebedf0", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 10, color: "#9ca3af", letterSpacing: ".05em" }}>{zh ? "推断依据" : "推定根拠"}</div>
            {s.source.quote && (
              <div style={{ display: "flex", gap: 7 }}>
                {s.source.author && <AvatarBadge name={s.source.author} size={18} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: "#4a4d53", lineHeight: 1.45, background: "#f6f7f9", borderRadius: 6, padding: "6px 8px",
                    display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>「{s.source.quote}」</div>
                  {s.source.author && <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 3 }}>{s.source.author}{zh ? " · 最新评论" : " · 最新コメント"}</div>}
                </div>
              </div>
            )}
            {reason && <div style={{ fontSize: 11, color: "#7c8088", lineHeight: 1.5, fontStyle: "italic",
              display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>→ {reason}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
function PField({ label, icon, zh, children }: { label: string; icon: string[]; zh: boolean; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 10.5, color: "#9ca3af", width: zh ? 60 : 70, flex: "none", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Ico d={icon} size={11} color="#b5b8be" />{label}
      </span>
      <span style={{ fontSize: 12.5, color: "#33363c", fontWeight: 500, lineHeight: 1.4, minWidth: 0 }}>{children}</span>
    </div>
  );
}

// ── 卡顶状态行(极简条 + hover 富详情)─────────────────────────────────────
export function AIStateLine({ issueId, projectId }: { issueId: string; projectId: string | null | undefined }) {
  const { workspaceSlug } = useParams();
  const { currentLocale } = useTranslation();
  const zh = isZhLocale(currentLocale);
  const s = useIssueAIState(workspaceSlug?.toString(), projectId, issueId);
  const ref = useRef<HTMLDivElement | null>(null);
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);

  if (!s || !s.ball || s.state === "UNKNOWN" || (s.confidence ?? 0) < 0.4) return null;
  const ball = BALL_META[s.ball];
  const next = pick(s.next_action, zh);

  return (
    <div
      ref={ref}
      onMouseEnter={() => ref.current && setHoverRect(ref.current.getBoundingClientRect())}
      onMouseLeave={() => setHoverRect(null)}
      style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 11.5, lineHeight: 1.3,
        marginTop: 8, paddingTop: 7, borderTop: "1px solid #f0f1f3" }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 99, background: ball.dot, flex: "none" }} />
      <span style={{ fontWeight: 600, color: ball.text, flex: "none" }}>{pick(ball.label, zh)}</span>
      {next && (
        <>
          <span style={{ color: "#c8cace", flex: "none" }}>·</span>
          <span style={{ color: "#52555b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{next}</span>
        </>
      )}
      <span style={{ flex: "none", marginLeft: next ? 0 : "auto" }}><StallChip days={s.stale_days} zh={zh} /></span>
      {hoverRect && <Popover s={s} zh={zh} rect={hoverRect} />}
    </div>
  );
}
