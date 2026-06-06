/**
 * BARSOUL DIS v6: 「対応待ち」作业台(从列表升级)。
 * 本批(console 外壳):①自分/全員 作用域 ②统计卡可点=筛选切片 ④並び替え + 折叠分组
 * ⑤AI 最終更新时效 ⑧-⑬日文文案规范 + カードを開く 行操作。
 * 下一批(SoR 写+实时):催促/担当者変更/既読、再分析、实时迁移、键盘导航(task #42)。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUser } from "@/hooks/store/user";
import {
  type DerivedIssueState, dueInfo, AvatarBadge, stallTone, useZh, pick, Ico, ICON,
} from "./ai-state-line";
import { DISActionBar, disDialog, rederiveAIState } from "./ai-state-actions";

const STALL_TH = 4;
type DigestItem = DerivedIssueState & { name: string; sequence_id: number | null; project_identifier: string; state_group: string | null };
type Slice = "self" | "other" | "stall" | "overdue";
type SortKey = "urgency" | "due" | "stall" | "updated";

function severity(s: DigestItem): number {
  let v = 0;
  const di = dueInfo(s.due_date, true);
  if (di?.tone === "overdue") v += 120 - di.diff;
  const t = stallTone(s.stale_days);
  if (t === "high") v += 60; else if (t === "mid") v += 30;
  if (s.unassigned) v += 25;
  return v + s.stale_days;
}
function isOverdue(s: DigestItem) { return dueInfo(s.due_date, true)?.tone === "overdue"; }
function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  try { return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); } catch { return null; }
}

function StatusDot({ group }: { group: string | null }) {
  return <span style={{ width: 9, height: 9, borderRadius: 99, background: group === "started" ? "#e67e22" : "#e0a82e", flex: "none" }} />;
}

function Row({ s, zh, projectId, focused, onOpen }: { s: DigestItem; zh: boolean; projectId: string; focused: boolean; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const di = dueInfo(s.due_date, zh);
  const next = pick(s.next_action, zh);
  const overdue = di?.tone === "overdue";
  const st = stallTone(s.stale_days);
  const showActions = hover || focused;
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "nearest" }); }, [focused]);
  return (
    <div ref={ref} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={onOpen}
      title={zh ? "打开卡片" : "カードを開く"}
      style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px", borderRadius: 8, cursor: "pointer",
        background: focused ? "#f5f3ff" : hover ? "#f8f9fb" : "#fff",
        border: "1px solid " + (focused ? "#c9bdff" : hover ? "#e6e8ec" : "#eceef1"),
        boxShadow: focused ? "0 0 0 1px #c9bdff" : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
        <StatusDot group={s.state_group} />
        <div style={{ width: 56, flex: "none", fontSize: 11.5, color: "#9499a0", fontWeight: 500 }}>
          {s.project_identifier && s.sequence_id != null ? `${s.project_identifier}-${s.sequence_id}` : ""}
        </div>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: "#2b2e34", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
          {next && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, fontSize: 11.5, color: "#6b6e74", minWidth: 0 }}>
              <Ico d={ICON.arrowRight} size={11} sw={2} color="#b5b8be" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{next}</span>
            </div>
          )}
        </div>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8 }}>
          {s.ball === "OTHER" && s.actor_name && (
            <span style={{ fontSize: 11, color: "#5d6f81", whiteSpace: "nowrap" }}>{zh ? `对方:${s.actor_name}` : `先方:${s.actor_name}`}</span>
          )}
          {st !== "none" && (
            <span style={{ fontSize: 11, fontWeight: 600, color: st === "high" ? "#c0392b" : "#b06d09", whiteSpace: "nowrap" }}>{zh ? `停滞 ${s.stale_days} 天` : `${s.stale_days}日停滞`}</span>
          )}
          {di && (
            <span style={{ fontSize: 11, fontWeight: 600, minWidth: 78, textAlign: "right",
              color: overdue ? "#c0392b" : di.tone === "soon" ? "#b45309" : "#9ca3af", display: "inline-flex", alignItems: "center", gap: 3, justifyContent: "flex-end" }}>
              {overdue && <Ico d={ICON.alert} size={11} sw={2} />}{overdue ? (zh ? `逾期 ${-di.diff} 天` : `期限を${-di.diff}日超過`) : di.label}
            </span>
          )}
          <span style={{ width: 22, display: "inline-flex", justifyContent: "flex-end" }}>
            {s.actor_kind === "person" && s.actor_name ? <AvatarBadge name={s.actor_name} size={20} />
              : s.unassigned ? <span title={zh ? "待指派" : "担当未定"} style={{ width: 20, height: 20, borderRadius: 4, border: "1.5px dashed #d6b483", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#b45309", fontSize: 13 }}>?</span>
                : <Ico d={ICON.building} size={15} color="#a3a7ad" />}
          </span>
        </div>
      </div>
      {/* v9 行操作(hover/键盘聚焦时):催促 / 改担当(确认闸门)/ 再分析 */}
      {showActions && (
        <div style={{ display: "flex", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
          <DISActionBar s={s} projectId={projectId} zh={zh} compact />
        </div>
      )}
    </div>
  );
}

function StatCard({ value, label, color, icon, active, onClick }: { value: number; label: string; color: string; icon: string[]; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 10, flex: "1 1 0", minWidth: 130, cursor: "pointer", fontFamily: "inherit", textAlign: "left",
      background: active ? color + "12" : "#fff", border: "1px solid " + (active ? color : "#eceef1"), boxShadow: active ? "0 0 0 1px " + color : "none" }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, background: color + "18", color, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <Ico d={icon} size={15} sw={1.9} color={color} />
      </span>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#2b2e34", lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: "#8a8e95", marginTop: 3 }}>{label}</div>
      </div>
    </button>
  );
}

function Group({ icon, color, title, count, sub, collapsed, onToggle, children }: { icon: string[]; color: string; title: string; count: number; sub: string; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px 2px", cursor: "pointer" }}>
        <Ico d={collapsed ? ["M9 18l6-6-6-6"] : ["M6 9l6 6 6-6"]} size={13} color="#9499a0" />
        <Ico d={icon} size={15} sw={1.9} color={color} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#3a3d42" }}>{title}</span>
        <span style={{ fontSize: 12, color: "#fff", background: color, borderRadius: 99, padding: "0 7px", fontWeight: 600, minWidth: 18, textAlign: "center" }}>{count}</span>
        <span style={{ fontSize: 11.5, color: "#9499a0", marginLeft: 2 }}>{sub}</span>
      </div>
      {!collapsed && children}
    </div>
  );
}

export function AIDigestView({ workspaceSlug, projectId }: { workspaceSlug: string; projectId: string }) {
  const { workspaceSlug: routerWs } = useParams();
  const slug = workspaceSlug || routerWs?.toString() || "";
  const zh = useZh();
  const issueDetail = useIssueDetail();
  const { setPeekIssue } = issueDetail;
  const { data: currentUser } = useUser();
  const openCard = (id: string) => setPeekIssue({ workspaceSlug: slug, projectId, issueId: id });

  const [items, setItems] = useState<DigestItem[] | null>(null);
  const [scope, setScope] = useState<"self" | "all">("self");
  const [slices, setSlices] = useState<Set<Slice>>(new Set());
  const [sort, setSort] = useState<SortKey>("urgency");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(-1); // 键盘聚焦行(-1=无)

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/workspaces/${slug}/projects/${projectId}/issues/ai-states/`, { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
        if (!r.ok) { if (alive) setItems([]); return; }
        const data: Record<string, DigestItem> = await r.json();
        if (alive) setItems(Object.values(data).filter((x) => x.ball && (x.confidence ?? 0) >= 0.4));
      } catch { if (alive) setItems([]); }
    })();
    return () => { alive = false; };
  }, [slug, projectId]);

  const T = zh ? {
    title: "待我处理", sub: "AI 根据标题、描述、最新评论与截止日期推断当前进展。",
    self: "我的", all: "全部", needMe: "要我处理", waiting: "等待对方", stall: `停滞 ≥ ${STALL_TH} 天`, overdue: "已逾期",
    gNeed: "要我处理", gNeedSub: "球在我方,需处理", gWait: "等待对方", gWaitSub: "球在对方,必要时催办",
    sortLabel: "排序", urgency: "紧急度", due: "期限近", stallS: "停滞久", updated: "最近更新",
    lastUpd: (n: number) => `AI 最终更新:${n < 60 ? n + " 分钟前" : Math.round(n / 60) + " 小时前"}`, reanalyze: "重新分析",
    emptyAll: "没有需要处理的项目", emptyAllSub: "等待对方的项目可在「等待对方」查看", emptyFilter: "没有符合条件的项目", clear: "清除筛选",
    kbd: "↑↓ 选择 · Enter 打开 · e 催促 · r 再分析",
  } : {
    title: "対応待ち", sub: "タイトル・説明・最新コメント・期限からAIが現在の状況を推定します。",
    self: "自分", all: "全員", needMe: "要対応", waiting: "先方待ち", stall: `${STALL_TH}日以上停滞`, overdue: "期限超過",
    gNeed: "要対応", gNeedSub: "ボールは自社、対応が必要", gWait: "先方待ち", gWaitSub: "ボールは先方、必要に応じて催促",
    sortLabel: "並び替え", urgency: "緊急度順", due: "期限が近い順", stallS: "停滞が長い順", updated: "更新が新しい順",
    lastUpd: (n: number) => `AI 最終更新:${n < 60 ? n + "分前" : Math.round(n / 60) + "時間前"}`, reanalyze: "再分析",
    emptyAll: "対応が必要な項目はありません", emptyAllSub: "先方待ちの項目はこちらで確認できます", emptyFilter: "条件に一致する項目がありません", clear: "フィルターをクリア",
    kbd: "↑↓ 選択 · Enter 開く · e 催促 · r 再分析",
  };

  const myId = currentUser?.id;
  const myName = currentUser?.display_name;
  const isMine = (s: DigestItem) => (myId && s.actor_user_id === myId) || (!!myName && !!s.owner && (s.owner === myName || s.owner.includes(myName)));

  const scoped = useMemo(() => (items || []).filter((s) => scope === "all" || isMine(s)), [items, scope, myId, myName]);
  const sliceOf = (s: DigestItem, sl: Slice) =>
    sl === "self" ? s.ball === "SELF" : sl === "other" ? s.ball === "OTHER" : sl === "stall" ? stallTone(s.stale_days) !== "none" : isOverdue(s);
  const filtered = useMemo(() => scoped.filter((s) => slices.size === 0 || Array.from(slices).every((sl) => sliceOf(s, sl))), [scoped, slices]);
  const sortFn = (a: DigestItem, b: DigestItem) =>
    sort === "due" ? ((dueInfo(a.due_date, true)?.diff ?? 9999) - (dueInfo(b.due_date, true)?.diff ?? 9999))
      : sort === "stall" ? b.stale_days - a.stale_days
        : sort === "updated" ? String(b.updated_at).localeCompare(String(a.updated_at))
          : severity(b) - severity(a);
  const needMe = useMemo(() => filtered.filter((s) => s.ball === "SELF").sort(sortFn), [filtered, sort]);
  const waiting = useMemo(() => filtered.filter((s) => s.ball === "OTHER").sort(sortFn), [filtered, sort]);
  const lastUpd = minutesAgo(scoped.reduce<string | null>((m, s) => (!m || String(s.updated_at) > m ? (s.updated_at ?? m) : m), null));

  // ── 分组显隐(切片联动)+ 扁平可聚焦行(供键盘导航;折叠组的行不可聚焦)──
  const showNeed = (!slices.has("other") || slices.has("self")) && needMe.length > 0;
  const showWait = (!slices.has("self") || slices.has("other")) && waiting.length > 0;
  const flat = useMemo(() => [
    ...(showNeed && !collapsed.has("need") ? needMe : []),
    ...(showWait && !collapsed.has("wait") ? waiting : []),
  ], [showNeed, showWait, collapsed, needMe, waiting]);
  // flat 变动后夹紧聚焦下标
  useEffect(() => { setFocusIdx((i) => (i >= flat.length ? flat.length - 1 : i)); }, [flat.length]);

  // 键盘导航:↑/↓ 或 j/k 移动、Enter 打开、e 催促、r 再分析。
  // 在输入/可编辑元素中、或卡片详情(peek)打开时不拦截。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (issueDetail.peekIssue) return;
      if (disDialog.get()) return; // 对话框打开时让位
      if (flat.length === 0) return;
      const k = e.key;
      if (k === "ArrowDown" || k === "j") { e.preventDefault(); setFocusIdx((i) => Math.min(flat.length - 1, i + 1)); return; }
      if (k === "ArrowUp" || k === "k") { e.preventDefault(); setFocusIdx((i) => Math.max(0, (i < 0 ? 1 : i) - 1)); return; }
      const cur = focusIdx >= 0 && focusIdx < flat.length ? flat[focusIdx] : undefined;
      if (!cur) return;
      if (k === "Enter") { e.preventDefault(); setPeekIssue({ workspaceSlug: slug, projectId, issueId: cur.issue_id }); }
      else if (k === "e") { e.preventDefault(); disDialog.open({ kind: "urge", issueId: cur.issue_id, projectId, actorName: cur.actor_name || "", nextAction: pick(cur.next_action, zh) }); }
      else if (k === "r") { e.preventDefault(); rederiveAIState(slug, projectId, cur.issue_id, zh); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flat, focusIdx, slug, projectId, zh, issueDetail, setPeekIssue]);

  const statN = (sl: Slice) => scoped.filter((s) => sliceOf(s, sl)).length;
  const toggleSlice = (sl: Slice) => setSlices((p) => { const n = new Set(p); n.has(sl) ? n.delete(sl) : n.add(sl); return n; });
  const toggleGroup = (g: string) => setCollapsed((p) => { const n = new Set(p); n.has(g) ? n.delete(g) : n.add(g); return n; });

  const Seg = ({ v, label }: { v: "self" | "all"; label: string }) => (
    <button type="button" onClick={() => setScope(v)} className="inline-flex h-[26px] items-center rounded-md border-0 px-3 text-xs font-semibold"
      style={{ background: scope === v ? "#fff" : "transparent", color: scope === v ? "#1f2328" : "#71757c", boxShadow: scope === v ? "0 1px 2px rgba(16,24,40,0.1)" : "none", cursor: "pointer", fontFamily: "inherit" }}>{label}</button>
  );

  const sliceLabels: Record<Slice, string> = { self: T.needMe, other: T.waiting, stall: T.stall, overdue: T.overdue };

  return (
    <div style={{ height: "100%", overflow: "auto", background: "#f7f8fa" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "22px 24px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Ico d={ICON.sparkle} size={17} color="#7c5cff" sw={1.8} />
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#26292f", margin: 0 }}>{T.title}</h1>
          <div className="inline-flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: "#eef0f2", marginLeft: 4 }}>
            <Seg v="self" label={T.self} /><Seg v="all" label={T.all} />
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            {lastUpd != null && <span style={{ fontSize: 11.5, color: "#9499a0" }}>{T.lastUpd(lastUpd)}</span>}
            <span style={{ fontSize: 10.5, color: "#b4b8bf", whiteSpace: "nowrap" }} title={T.kbd}>{T.kbd}</span>
            <label style={{ fontSize: 12, color: "#71757c", display: "inline-flex", alignItems: "center", gap: 5 }}>
              {T.sortLabel}
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ fontSize: 12, color: "#33363c", border: "1px solid #e3e5e9", borderRadius: 6, padding: "3px 6px", background: "#fff", fontFamily: "inherit", cursor: "pointer" }}>
                <option value="urgency">{T.urgency}</option><option value="due">{T.due}</option><option value="stall">{T.stallS}</option><option value="updated">{T.updated}</option>
              </select>
            </label>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: "#8a8e95", margin: "0 0 16px", lineHeight: 1.5 }}>{T.sub}</p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <StatCard value={statN("self")} label={T.needMe} color="#d97a0a" icon={ICON.inbox} active={slices.has("self")} onClick={() => toggleSlice("self")} />
          <StatCard value={statN("other")} label={T.waiting} color="#5d6f81" icon={ICON.send} active={slices.has("other")} onClick={() => toggleSlice("other")} />
          <StatCard value={statN("stall")} label={T.stall} color="#c0392b" icon={ICON.clock} active={slices.has("stall")} onClick={() => toggleSlice("stall")} />
          <StatCard value={statN("overdue")} label={T.overdue} color="#dc2626" icon={ICON.alert} active={slices.has("overdue")} onClick={() => toggleSlice("overdue")} />
        </div>

        {slices.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {Array.from(slices).map((sl) => (
              <span key={sl} onClick={() => toggleSlice(sl)} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "#3a3d42", background: "#eef0f2", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                {sliceLabels[sl]}<span style={{ color: "#9499a0" }}>×</span>
              </span>
            ))}
            <button type="button" onClick={() => setSlices(new Set())} style={{ fontSize: 11.5, color: "#7c5cff", border: "none", background: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>{T.clear}</button>
          </div>
        )}

        {items === null ? (
          <div style={{ fontSize: 13, color: "#9499a0", padding: "20px 0" }}>{zh ? "加载中…" : "読み込み中…"}</div>
        ) : needMe.length === 0 && waiting.length === 0 ? (
          <div style={{ padding: "28px 0", textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#54585f" }}>{slices.size > 0 ? T.emptyFilter : T.emptyAll}</div>
            {slices.size > 0
              ? <button type="button" onClick={() => setSlices(new Set())} style={{ marginTop: 8, fontSize: 12.5, color: "#7c5cff", border: "none", background: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>{T.clear}</button>
              : <div style={{ marginTop: 6, fontSize: 12.5, color: "#9499a0" }}>{T.emptyAllSub}</div>}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {showNeed && (
              <Group icon={ICON.inbox} color="#d97a0a" title={T.gNeed} count={needMe.length} sub={T.gNeedSub} collapsed={collapsed.has("need")} onToggle={() => toggleGroup("need")}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{needMe.map((s) => <Row key={s.issue_id} s={s} zh={zh} projectId={projectId} focused={flat[focusIdx] === s} onOpen={() => openCard(s.issue_id)} />)}</div>
              </Group>
            )}
            {showWait && (
              <Group icon={ICON.send} color="#5d6f81" title={T.gWait} count={waiting.length} sub={T.gWaitSub} collapsed={collapsed.has("wait")} onToggle={() => toggleGroup("wait")}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{waiting.map((s) => <Row key={s.issue_id} s={s} zh={zh} projectId={projectId} focused={flat[focusIdx] === s} onOpen={() => openCard(s.issue_id)} />)}</div>
              </Group>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
