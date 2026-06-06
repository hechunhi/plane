/**
 * BARSOUL: 派生卡片当前态 (DIS) v3 — 卡片摘要条 + 全局单浮层(整卡 hover 触发)。
 *
 * v3 改:①整卡触发(防抖120/80,允许移到浮层,全局仅一个浮层)②浮层 header 带卡号+标题、
 * 智能翻转避免盖来源卡、来源卡高亮描边+指向箭头 ③卡片条=球+最紧急告警+下一步(摘要),
 * 浮层=完整详情(口径一致)④label 高对比+固定列宽 ⑤状态条 hover 轻高亮+✦ 暗示
 * ⑦置信度默认弱化、低置信黄底告警 ⑨AI 文案语言设置(跟随/日/中)+ 空状态兜底。
 * 取数:模块级 batcher 120ms 去抖合并;失败安全:无派生 → 不渲染。
 */
import { useEffect, useReducer, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { useUser } from "@/hooks/store/user";

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
  human_note: Bilingual;       // 人工补充说明(双语)
  corrected_by: string | null; // 最近补充/纠正者
  corrected_at: string | null;
};

const STALL_TH = 4;
const LOW_CONF = 0.45;

export function isZhLocale(loc: string | undefined) { return (loc || "").toLowerCase().startsWith("zh"); }

// ── 看板 ↔ 待我处理 视图(切换在真实 header, digest 在 layout root → 模块级共享)──
type AiView = "board" | "digest";
let _aiView: AiView = "board";
const _viewSubs = new Set<() => void>();
export function setAiView(v: AiView) { _aiView = v; _viewSubs.forEach((f) => f()); }
export function useAiView(): AiView {
  return useSyncExternalStore((cb) => { _viewSubs.add(cb); return () => _viewSubs.delete(cb); }, () => _aiView, () => _aiView);
}
/** 派生文案显示语言 = 跟随 Plane 界面语言设置(v5 移除独立语言控件)。 */
export function useZh(): boolean {
  const { currentLocale } = useTranslation();
  return isZhLocale(currentLocale);
}
export function pick(b: Bilingual | undefined, zh: boolean): string {
  if (!b) return "";
  return (zh ? b.zh : b.ja) || b.zh || b.ja || "";
}

// ── 视觉常量 ────────────────────────────────────────────────────────────────
export const BALL_META = {
  SELF: { bg: "#fef3e2", border: "#f3d3a0", text: "#9a5b08", dot: "#d97a0a", label: { zh: "球在我方", ja: "自社ボール" } },
  OTHER: { bg: "#eef2f6", border: "#dbe3ea", text: "#4d6076", dot: "#7a8da0", label: { zh: "球在对方", ja: "先方ボール" } },
};
/** 视角相关的「球在谁手」: actor=阅览者 → 需我处理(暖琥珀);其他人(同事或外部)→ 球在{具体名}(冷灰),
 *  靠 icon 区分 同事(人)/外部(送出)。myId 来自当前登录用户。 */
export function ballView(s: DerivedIssueState, zh: boolean, myId?: string): { label: string; bg: string; border: string; text: string; dot: string; icon: string[]; mine: boolean } {
  const actor = (s.actor_name || "").trim();
  const mine = s.ball === "SELF" && !!myId && !!s.actor_user_id && s.actor_user_id === myId;
  if (mine) return { mine: true, label: zh ? "需我处理" : "自分が対応", bg: "#fef3e2", border: "#f3d3a0", text: "#9a5b08", dot: "#d97a0a", icon: ICON.inbox };
  const external = s.ball === "OTHER" || s.actor_kind === "external";
  const name = actor || (external ? (zh ? "对方" : "先方") : (zh ? "他人" : "担当者"));
  return { mine: false, label: zh ? `球在 ${name}` : `${name}待ち`, bg: "#eef2f6", border: "#dbe3ea", text: "#4d6076", dot: "#7a8da0", icon: external ? ICON.send : ICON.user };
}
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
export function Ico({ d, size = 12, sw = 1.7, color = "currentColor" }: { d: string[] | string; size?: number; sw?: number; color?: string }) {
  const ps = Array.isArray(d) ? d : [d];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
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
  external: ["M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", "M15 3h6v6", "M10 14L21 3"],
  message: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  refresh: ["M23 4v6h-6", "M1 20v-6h6", "M3.51 9a9 9 0 0 1 14.85-3.36L23 10", "M1 14l4.64 4.36A9 9 0 0 0 20.49 15"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.73 21a2 2 0 0 1-3.46 0"],
  users: ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M23 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  close: ["M18 6L6 18", "M6 6l12 12"],
};

export function AvatarBadge({ name, size = 18 }: { name: string; size?: number }) {
  const initial = (name || "?").trim().charAt(0) || "?";
  return (
    <span title={name} style={{ width: size, height: size, borderRadius: 4, background: avatarColor(name), color: "#fff",
      fontSize: size * 0.56, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{initial}</span>
  );
}
export function StallChip({ days, zh }: { days: number; zh: boolean }) {
  const tone = stallTone(days);
  if (tone === "none") return null; // minor a: 无停滞不占位
  const c = tone === "high" ? { bg: "#fdeaea", bd: "#f3c4c4", tx: "#c0392b" } : { bg: "#fdf3e2", bd: "#f0d9a8", tx: "#b06d09" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, background: c.bg, border: "1px solid " + c.bd, color: c.tx, borderRadius: 4, padding: "0px 5px", flex: "none" }}>
      {tone === "high" && <Ico d={ICON.alert} size={10} sw={2} />}{zh ? `停滞 ${days} 天` : `${days}日停滞`}
    </span>
  );
}
export function dueInfo(due: string | null, zh: boolean): { label: string; tone: "normal" | "soon" | "overdue"; diff: number } | null {
  if (!due) return null;
  try {
    const d = new Date(due + "T00:00:00"); const t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
    let tone: "normal" | "soon" | "overdue" = "normal";
    if (diff < 0) tone = "overdue"; else if (diff <= 2) tone = "soon";
    const label = tone === "overdue" ? (zh ? `逾期 ${-diff} 天` : `${-diff}日超過`) : diff === 0 ? (zh ? "今天" : "本日") : `${d.getMonth() + 1}/${d.getDate()}`;
    return { label, tone, diff };
  } catch { return null; }
}
/** item 3: 最紧急的单条告警(逾期 > 高停滞 > 中停滞),卡片条与浮层同口径。 */
export function topAlert(s: DerivedIssueState, zh: boolean): { text: string; tone: "red" | "amber" } | null {
  const di = dueInfo(s.due_date, zh);
  if (di?.tone === "overdue") return { text: di.label, tone: "red" };
  const st = stallTone(s.stale_days);
  if (st === "high") return { text: zh ? `停滞 ${s.stale_days} 天` : `${s.stale_days}日停滞`, tone: "red" };
  if (st === "mid") return { text: zh ? `停滞 ${s.stale_days} 天` : `${s.stale_days}日停滞`, tone: "amber" };
  return null;
}

// ── 模块级批量取数器 ────────────────────────────────────────────────────────
const _cache = new Map<string, DerivedIssueState | null>();
const _cacheTs = new Map<string, number>();
const _TTL_MS = 90_000;
const _subs = new Map<string, Set<() => void>>();
const _pending = new Map<string, Set<string>>();
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _slug = "";
function _notify(id: string) { _subs.get(id)?.forEach((f) => f()); }
function _store(id: string, v: DerivedIssueState | null) { _cache.set(id, v); _cacheTs.set(id, Date.now()); _notify(id); }
function _fresh(id: string) { return _cacheTs.has(id) && Date.now() - (_cacheTs.get(id) || 0) < _TTL_MS; }
export function getCachedAIState(id: string): DerivedIssueState | null { return _cache.get(id) ?? null; }
/** 失效某卡缓存 → 订阅者重拉(人工补充/重判后刷新)。 */
export function invalidateAIState(id: string) { _cache.delete(id); _cacheTs.delete(id); _notify(id); }
async function _flush() {
  const slug = _slug; const byProject = new Map(_pending); _pending.clear();
  for (const [projectId, idSet] of byProject) {
    const ids = Array.from(idSet);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      try {
        const r = await fetch(`/api/workspaces/${slug}/projects/${projectId}/issues/ai-states/?issues=${chunk.join(",")}`, { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
        if (!r.ok) { chunk.forEach((id) => _store(id, _cache.get(id) ?? null)); continue; }
        const data: Record<string, DerivedIssueState> = await r.json();
        chunk.forEach((id) => _store(id, data[id] ?? null));
      } catch { chunk.forEach((id) => _store(id, _cache.get(id) ?? null)); }
    }
  }
}
function _scheduleFlush(slug: string) { _slug = slug; if (_flushTimer) return; _flushTimer = setTimeout(() => { _flushTimer = null; void _flush(); }, 120); }
export function useIssueAIState(slug: string | undefined, projectId: string | null | undefined, issueId: string | undefined): DerivedIssueState | null {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!slug || !projectId || !issueId) return;
    let set = _subs.get(issueId); if (!set) { set = new Set(); _subs.set(issueId, set); }
    set.add(force);
    if (!_fresh(issueId)) {
      let ps = _pending.get(projectId); if (!ps) { ps = new Set(); _pending.set(projectId, ps); }
      ps.add(issueId); _scheduleFlush(slug);
    }
    return () => { set?.delete(force); if (set && set.size === 0) _subs.delete(issueId); };
  }, [slug, projectId, issueId, force]);
  return issueId ? _cache.get(issueId) ?? null : null;
}

// ── 全局单浮层 控制器(item 1)──────────────────────────────────────────────
export type AIPopoverMeta = { seq: number | null; identifier: string; name: string };
export type AIPopSide = "right" | "left" | "below";
type ActivePop = { issueId: string; projectId: string; el: HTMLElement; meta: AIPopoverMeta; side: AIPopSide } | null;
let _active: ActivePop = null;
let _showT: ReturnType<typeof setTimeout> | null = null;
let _hideT: ReturnType<typeof setTimeout> | null = null;
const _popSubs = new Set<() => void>();
function _emitPop() { _popSubs.forEach((f) => f()); }
function _highlight(el: HTMLElement | null, on: boolean) {
  if (!el) return;
  if (on) {
    // 打磨(v6.1): 弃刺眼 2px 蓝框,改柔和上浮 + 发丝级紫描边(呼应 AI 紫、连接浮层)
    el.style.transition = "box-shadow .12s ease";
    el.style.borderRadius = "8px";
    el.style.boxShadow = "0 8px 24px -8px rgba(16,24,40,0.16), 0 0 0 1px rgba(124,92,255,0.32)";
  } else {
    el.style.boxShadow = "";
  }
}
// item 6: 在浮层挂载前用 elementFromPoint 选不盖其他卡片的方位(右→左→下,取重叠最少)
export const POP_W = 320;
const _POP_H = 230, _GAP = 12, _EDGE = 10;
function _overlapCount(x: number, y: number, srcId: string): number {
  const vw = window.innerWidth, vh = window.innerHeight;
  const pts: Array<[number, number]> = [[x + 10, y + 10], [x + POP_W - 10, y + 10], [x + 10, y + _POP_H / 2], [x + POP_W - 10, y + _POP_H - 10]];
  let c = 0;
  for (const [px, py] of pts) {
    if (px < 0 || py < 0 || px > vw || py > vh) continue;
    const card = (document.elementFromPoint(px, py) as HTMLElement | null)?.closest('[id^="issue-"]') as HTMLElement | null;
    if (card && card.id !== `issue-${srcId}`) c++;
  }
  return c;
}
function _chooseSide(rect: DOMRect, srcId: string): AIPopSide {
  const vw = window.innerWidth;
  const cands: Array<{ side: AIPopSide; x: number; y: number }> = [];
  if (rect.right + _GAP + POP_W <= vw - _EDGE) cands.push({ side: "right", x: rect.right + _GAP, y: rect.top });
  if (rect.left - _GAP - POP_W >= _EDGE) cands.push({ side: "left", x: rect.left - _GAP - POP_W, y: rect.top });
  cands.push({ side: "below", x: Math.min(Math.max(_EDGE, rect.left), vw - POP_W - _EDGE), y: rect.bottom + _GAP });
  let best = cands[0], bestScore = Infinity;
  for (const c of cands) {
    const s = _overlapCount(c.x, c.y, srcId);
    if (s < bestScore) { bestScore = s; best = c; }
    if (s === 0) break;
  }
  return best.side;
}
export const aiPopover = {
  show(issueId: string, projectId: string, el: HTMLElement, meta: AIPopoverMeta) {
    if (_hideT) { clearTimeout(_hideT); _hideT = null; }
    if (_active && _active.issueId === issueId) return;
    if (_showT) clearTimeout(_showT);
    _showT = setTimeout(() => {
      if (_active) _highlight(_active.el, false);
      const side = _chooseSide(el.getBoundingClientRect(), issueId);
      _active = { issueId, projectId, el, meta, side };
      _highlight(el, true);
      _emitPop();
    }, 120);
  },
  hide() {
    if (_showT) { clearTimeout(_showT); _showT = null; }
    if (_hideT) clearTimeout(_hideT);
    _hideT = setTimeout(() => {
      if (_active) _highlight(_active.el, false);
      _active = null; _emitPop();
    }, 80);
  },
  keep() { if (_hideT) { clearTimeout(_hideT); _hideT = null; } }, // 鼠标移到浮层上 → 取消隐藏
  get() { return _active; },
};
export function useActivePopover(): ActivePop {
  return useSyncExternalStore((cb) => { _popSubs.add(cb); return () => _popSubs.delete(cb); }, () => _active, () => _active);
}

// ── 卡片摘要条(item 3,5)──────────────────────────────────────────────────
export function AICardBar({ issueId, projectId }: { issueId: string; projectId: string | null | undefined }) {
  const { workspaceSlug } = useParams();
  const zh = useZh();
  const { data: currentUser } = useUser();
  const s = useIssueAIState(workspaceSlug?.toString(), projectId, issueId);
  if (!s) return null; // 无派生 → 不渲染

  const sep = { marginTop: 8, paddingTop: 7, borderTop: "1px solid #f0f1f3" } as const;
  const row = "flex items-center gap-1.5 min-w-0 cursor-pointer rounded transition-colors group-hover/kanban-block:bg-[rgba(0,0,0,0.03)]";
  const spark = <span style={{ marginLeft: "auto", flex: "none", color: "#c0b6f0" }}><Ico d={ICON.sparkle} size={11} sw={1.6} /></span>;

  // 空状态兜底(minor b): UNKNOWN / 无 ball → 谦逊提示, 不给笃定结论
  if (s.state === "UNKNOWN" || !s.ball) {
    return (
      <div className={row} style={{ ...sep, fontSize: 11.5, lineHeight: 1.3, color: "#9499a0" }}>
        <Ico d={ICON.sparkle} size={11} color="#c4c7cc" />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{zh ? "信息不足,建议补充评论" : "情報不足、コメント追記を推奨"}</span>
      </div>
    );
  }

  const bv = ballView(s, zh, currentUser?.id);
  const next = pick(s.next_action, zh);
  const alert = topAlert(s, zh);
  const lowConf = s.confidence < LOW_CONF;
  return (
    <div className={row} style={{ ...sep, fontSize: 11.5, lineHeight: 1.3 }}>
      <Ico d={bv.icon} size={12} sw={1.8} color={bv.dot} />
      <span style={{ fontWeight: 600, color: bv.text, flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{bv.label}</span>
      {next && (<>
        <span style={{ color: "#c8cace", flex: "none" }}>·</span>
        <span style={{ color: "#52555b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{next}</span>
      </>)}
      {lowConf && (
        <span title={zh ? "AI 推断不确定,建议人工确认" : "AI の推定が不確実、確認推奨"} style={{ flex: "none", fontSize: 10.5, fontWeight: 600, color: "#92700a", background: "#fdf6dd", border: "1px solid #ecd98a", borderRadius: 4, padding: "0 4px" }}>?</span>
      )}
      {alert && (
        <span style={{ flex: "none", fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 2,
          color: alert.tone === "red" ? "#c0392b" : "#b06d09", background: alert.tone === "red" ? "#fdeaea" : "#fdf3e2",
          border: "1px solid " + (alert.tone === "red" ? "#f3c4c4" : "#f0d9a8"), borderRadius: 4, padding: "0 5px" }}>
          {alert.tone === "red" && <Ico d={ICON.alert} size={10} sw={2} />}{alert.text}
        </span>
      )}
      {!alert && spark}
    </div>
  );
}
