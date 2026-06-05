/**
 * BARSOUL: 待我处理 · 当前态汇总(Digest)。看板↔待我处理 切换的第二视图。
 * 拉该 project 全部活跃(Todo/Doing)已派生卡,按 ball 分两组(需我方行动 / 等待对方),
 * 按 severity(逾期>停滞>待指派>停滞天数)排序。viewer 语言 i18n。
 * 数据源: GET /issues/ai-states/(无 issues 参数 → 全活跃派生卡, 含 name/seq/state_group)。
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import {
  type DerivedIssueState, StallChip, dueInfo, AvatarBadge,
  stallTone, isZhLocale, pick, Ico, ICON,
} from "./ai-state-line";

type DigestItem = DerivedIssueState & {
  name: string;
  sequence_id: number | null;
  project_identifier: string;
  state_group: string | null;
};

function severity(s: DigestItem): number {
  let v = 0;
  const di = dueInfo(s.due_date, true);
  if (di?.tone === "overdue") v += 120;
  const tone = stallTone(s.stale_days);
  if (tone === "high") v += 60;
  else if (tone === "mid") v += 30;
  if (s.unassigned) v += 25;
  v += s.stale_days;
  return v;
}

function StatusDot({ group }: { group: string | null }) {
  const color = group === "started" ? "#e67e22" : "#e0a82e"; // inprogress / todo
  return <span style={{ width: 9, height: 9, borderRadius: 99, background: color, flex: "none" }} />;
}

function DigestRow({ s, zh }: { s: DigestItem; zh: boolean }) {
  const [hover, setHover] = useState(false);
  const di = dueInfo(s.due_date, zh);
  const next = pick(s.next_action, zh);
  const waiting = pick(s.waiting_on, zh);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8,
        background: hover ? "#f8f9fb" : "#fff", border: "1px solid " + (hover ? "#e6e8ec" : "#eceef1"), cursor: "default" }}
    >
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
        {s.ball === "OTHER" && waiting && (
          <span style={{ fontSize: 11, color: "#5d6f81", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Ico d={ICON.clock} size={11} />{zh ? `等 ${waiting}` : `${waiting} 待ち`}
          </span>
        )}
        <StallChip days={s.stale_days} zh={zh} />
        {di && (
          <span style={{ fontSize: 11, fontWeight: 600, width: 70, justifyContent: "flex-end",
            color: di.tone === "overdue" ? "#c0392b" : di.tone === "soon" ? "#b45309" : "#9ca3af",
            display: "inline-flex", alignItems: "center", gap: 3 }}>
            {di.tone === "overdue" && <Ico d={ICON.alert} size={11} sw={2} />}{di.label}
          </span>
        )}
        <span style={{ width: 22, display: "inline-flex", justifyContent: "flex-end" }}>
          {s.actor_kind === "person" && s.actor_name ? <AvatarBadge name={s.actor_name} size={20} />
            : s.unassigned
              ? <span title={zh ? "待指派" : "担当未定"} style={{ width: 20, height: 20, borderRadius: 4, border: "1.5px dashed #d6b483",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#b45309", fontSize: 13 }}>?</span>
              : <Ico d={ICON.building} size={15} color="#a3a7ad" />}
        </span>
      </div>
    </div>
  );
}

function Stat({ value, label, color, icon }: { value: number; label: string; color: string; icon: string[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#fff",
      border: "1px solid #eceef1", borderRadius: 10, flex: "1 1 0", minWidth: 130 }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, background: color + "18", color,
        display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <Ico d={icon} size={15} sw={1.9} color={color} />
      </span>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#2b2e34", lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: "#8a8e95", marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}

function GroupHeader({ icon, color, title, count, sub }: { icon: string[]; color: string; title: string; count: number; sub: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px 2px" }}>
      <Ico d={icon} size={15} sw={1.9} color={color} />
      <span style={{ fontSize: 13, fontWeight: 700, color: "#3a3d42" }}>{title}</span>
      <span style={{ fontSize: 12, color: "#fff", background: color, borderRadius: 99, padding: "0 7px", fontWeight: 600, minWidth: 18, textAlign: "center" }}>{count}</span>
      <span style={{ fontSize: 11.5, color: "#9499a0", marginLeft: 2 }}>{sub}</span>
    </div>
  );
}

export function AIDigestView({ workspaceSlug, projectId }: { workspaceSlug: string; projectId: string }) {
  const { workspaceSlug: routerWs } = useParams();
  const slug = workspaceSlug || routerWs?.toString() || "";
  const { currentLocale } = useTranslation();
  const zh = isZhLocale(currentLocale);
  const [items, setItems] = useState<DigestItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/workspaces/${slug}/projects/${projectId}/issues/ai-states/`,
          { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
        if (!r.ok) { if (alive) setItems([]); return; }
        const data: Record<string, DigestItem> = await r.json();
        if (alive) setItems(Object.values(data).filter((x) => x.ball && (x.confidence ?? 0) >= 0.4));
      } catch {
        if (alive) setItems([]);
      }
    })();
    return () => { alive = false; };
  }, [slug, projectId]);

  const T = zh ? {
    title: "待我处理 · 当前态汇总",
    sub: "AI 根据标题、描述、最新评论与截止日期推断 Todo / 对应中 的真实进展,无需逐张打开卡片。",
    needMe: "需我方行动", waiting: "等待对方", stall: `停滞 ≥ ${4} 天`, overdue: "已逾期",
    gNeed: "需我方行动", gNeedSub: "球在我方,等待我们推进", gWait: "等待对方", gWaitSub: "球在对方,必要时催办",
    empty: "暂无已派生的活跃卡片", loading: "加载中…",
  } : {
    title: "対応待ち · 現状サマリー",
    sub: "AI がタイトル・説明・最新コメント・期限から Todo / 対応中 の実際の進捗を推定。カードを開かずに把握できます。",
    needMe: "自社対応", waiting: "先方待ち", stall: `${4}日以上停滞`, overdue: "期限超過",
    gNeed: "自社対応", gNeedSub: "ボールは自社、対応が必要", gWait: "先方待ち", gWaitSub: "ボールは先方、必要なら催促",
    empty: "派生済みのアクティブカードはありません", loading: "読み込み中…",
  };

  const list = items || [];
  const needMe = list.filter((s) => s.ball === "SELF").sort((a, b) => severity(b) - severity(a));
  const waiting = list.filter((s) => s.ball === "OTHER").sort((a, b) => severity(b) - severity(a));
  const stalledN = list.filter((s) => stallTone(s.stale_days) !== "none").length;
  const overdueN = list.filter((s) => dueInfo(s.due_date, true)?.tone === "overdue").length;

  return (
    <div style={{ height: "100%", overflow: "auto", background: "#f7f8fa" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 24px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <Ico d={ICON.sparkle} size={17} color="#7c5cff" sw={1.8} />
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#26292f", margin: 0 }}>{T.title}</h1>
        </div>
        <p style={{ fontSize: 12.5, color: "#8a8e95", margin: "0 0 18px", lineHeight: 1.5 }}>{T.sub}</p>

        {items === null ? (
          <div style={{ fontSize: 13, color: "#9499a0", padding: "20px 0" }}>{T.loading}</div>
        ) : list.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9499a0", padding: "20px 0" }}>{T.empty}</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 22 }}>
              <Stat value={needMe.length} label={T.needMe} color="#d97a0a" icon={ICON.inbox} />
              <Stat value={waiting.length} label={T.waiting} color="#5d6f81" icon={ICON.send} />
              <Stat value={stalledN} label={T.stall} color="#c0392b" icon={ICON.clock} />
              <Stat value={overdueN} label={T.overdue} color="#dc2626" icon={ICON.alert} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
              <GroupHeader icon={ICON.inbox} color="#d97a0a" title={T.gNeed} count={needMe.length} sub={T.gNeedSub} />
              {needMe.map((s) => <DigestRow key={s.issue_id} s={s} zh={zh} />)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <GroupHeader icon={ICON.send} color="#5d6f81" title={T.gWait} count={waiting.length} sub={T.gWaitSub} />
              {waiting.map((s) => <DigestRow key={s.issue_id} s={s} zh={zh} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
