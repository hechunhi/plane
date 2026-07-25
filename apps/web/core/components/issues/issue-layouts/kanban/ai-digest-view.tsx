/**
 * BARSOUL DIS v6: 「対応待ち」作业台(从列表升级)。
 * 本批(console 外壳):①自分/全員 作用域 ②统计卡可点=筛选切片 ④並び替え + 折叠分组
 * ⑤AI 最終更新时效 ⑧-⑬日文文案规范 + カードを開く 行操作。
 * 下一批(SoR 写+实时):催促/担当者変更/既読、再分析、实时迁移、键盘导航(task #42)。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUser } from "@/hooks/store/user";
import { useProject } from "@/hooks/store/use-project";
import {
  type DerivedIssueState,
  dueInfo,
  AvatarBadge,
  stallTone,
  useZh,
  pick,
  Ico,
  ICON,
  onAIStateChange,
  type TInboxTriage,
} from "./ai-state-line";
import { DISActionBar, disDialog, rederiveAIState, triageInbox, type TriageAction } from "./ai-state-actions";
import { useMyPendingApprovals, type TPendingApprovalItem } from "@/hooks/use-my-pending-approvals";

const STALL_TH = 4;
// BARSOUL 2026-06-07: 「待审批」分区图标(check-in-circle)。审批=决定论 process gate,
// 数据走既有 useMyPendingApprovals(Temporal 写的 PG 台账,权威),不进 DIS 推断。
const ICON_APPROVAL = ["M9 12l2 2 4-4", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"];
type DigestItem = DerivedIssueState & {
  name: string;
  sequence_id: number | null;
  // 工作区级作业台: 各カードが所属 project を自帯(跨项目)。project_id は action の
  // ルーティング先(そのカード自身の project)、project_identifier は BS-123 の表示用。
  project_id: string;
  project_identifier: string;
  state_group: string | null;
};
type Slice = "self" | "other" | "stall" | "overdue";
type SortKey = "urgency" | "due" | "stall" | "updated";
// BS-216 线框A 左栏子导航项(决策段 + 时间段)。@提及走原生 notification 表(mention SoR);
// 指派给我走原生 workspace issues 表(assignees=我 & 未完成),覆盖全部活跃指派卡(非 DIS 子集)。
type NavKey = "inbox" | "need" | "gap" | "approval" | "mention" | "assigned" | "today" | "overdue";
// 指派给我项:从工作区 issues 端点投影(assignees=我 & state_group∈{backlog,unstarted,started})。
// 独立 lens,不折入 inbox(避免与 need/wait/gap 重复);无「清零」——完成卡即自然移出。
type AssignedItem = {
  issue_id: string;
  project_id: string;
  name: string;
  sequence_id?: number;
  state_group?: string;
  target_date?: string | null;
};
// @提及项:从原生 Notification(?mentioned=true)投影而来,只读展示 + 原生标记已读(≠ inbox_states 分流)。
type MentionItem = {
  notification_id: string;
  issue_id: string;
  project_id: string;
  name: string;
  identifier?: string;
  sequence_id?: number;
  by?: string; // 提及人显示名
  at?: string; // created_at ISO
};

function severity(s: DigestItem): number {
  let v = 0;
  const di = dueInfo(s.due_date, true);
  if (di?.tone === "overdue") v += 120 - di.diff;
  const t = stallTone(s.stale_days);
  if (t === "high") v += 60;
  else if (t === "mid") v += 30;
  if (s.unassigned) v += 25;
  return v + s.stale_days;
}
function isOverdue(s: DigestItem) {
  return dueInfo(s.due_date, true)?.tone === "overdue";
}
// @提及 行的相对时间(分/时/天)。
function relTime(iso: string, zh: boolean): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return zh ? "刚刚" : "たった今";
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins}分前`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return zh ? `${hrs} 小时前` : `${hrs}時間前`;
  const days = Math.round(hrs / 24);
  return zh ? `${days} 天前` : `${days}日前`;
}
function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  try {
    return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  } catch {
    return null;
  }
}

// ── BARSOUL Inbox Phase3: 个人分流态读取(纯投影,不改 SoR)──
// 「清出队」= 完成 / 归档 / 未来 snooze。这三态从活跃队列隐藏,进「已清」抽屉可回队。
function isCleared(s: DigestItem): boolean {
  const ib = s.inbox;
  if (!ib) return false;
  if (ib.done_at || ib.archived_at) return true;
  if (ib.snoozed_till) {
    const t = Date.parse(ib.snoozed_till);
    if (!isNaN(t) && t > Date.now()) return true;
  }
  return false;
}
function isPinned(s: DigestItem): boolean {
  return !!s.inbox?.pinned;
}
function clearedKind(s: DigestItem, zh: boolean): string {
  const ib = s.inbox;
  if (ib?.done_at) return zh ? "已完成" : "完了";
  if (ib?.archived_at) return zh ? "已归档" : "アーカイブ";
  if (ib?.snoozed_till) {
    const d = new Date(ib.snoozed_till);
    const md = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return (zh ? "Snooze 至 " : "スヌーズ ") + md;
  }
  return "";
}
// Snooze 预设(本地时区计算 → 送 ISO,后端 make_aware 落个人表)。
function snoozePresets(zh: boolean): { key: string; label: string; at: () => Date }[] {
  const at9 = (d: Date) => {
    d.setHours(9, 0, 0, 0);
    return d;
  };
  return [
    { key: "3h", label: zh ? "3 小时后" : "3時間後", at: () => new Date(Date.now() + 3 * 3600 * 1000) },
    {
      key: "tomorrow",
      label: zh ? "明天早上" : "明日の朝",
      at: () => at9(new Date(Date.now() + 24 * 3600 * 1000)),
    },
    {
      key: "monday",
      label: zh ? "下周一" : "来週月曜",
      at: () => {
        const d = new Date();
        const dow = d.getDay(); // 0=Sun
        const add = ((8 - dow) % 7) || 7; // 到下一个周一
        d.setDate(d.getDate() + add);
        return at9(d);
      },
    },
  ];
}

// 分流托盘:完成 / 归档 / Snooze / Pin。审批冻结时隐藏类(完成/归档/Snooze)禁用(服务层 409 兜底)。
function TriageBar({
  slug,
  projectId,
  issueId,
  inbox,
  frozen,
  zh,
  onPatch,
}: {
  slug: string;
  projectId: string;
  issueId: string;
  inbox?: TInboxTriage;
  frozen: boolean;
  zh: boolean;
  onPatch: (next: TInboxTriage | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const pinned = !!inbox?.pinned;
  const run = async (action: TriageAction, opts?: { snoozedTill?: string; value?: boolean }) => {
    setBusy(true);
    const next = await triageInbox(slug, projectId, issueId, action, zh, opts);
    setBusy(false);
    setSnoozeOpen(false);
    if (next) onPatch(next);
  };
  const IconBtn = ({
    icon,
    label,
    onClick,
    disabled,
    active,
    tone,
  }: {
    icon: string[];
    label: string;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
    tone?: string;
  }) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled && !busy) onClick();
      }}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        border: "1px solid " + (active ? (tone || "#7c5cff") : "#e3e5e9"),
        borderRadius: 6,
        background: active ? (tone || "#7c5cff") + "14" : "#fff",
        color: disabled ? "#c4c7cc" : tone || "#5a5e66",
        cursor: disabled || busy ? "default" : "pointer",
        flex: "none",
      }}
    >
      <Ico d={icon} size={13} sw={2} color={disabled ? "#c4c7cc" : active ? tone || "#7c5cff" : tone || "#7a7e86"} />
    </button>
  );
  return (
    <div style={{ position: "relative", display: "inline-flex", gap: 6 }} role="presentation" onClick={(e) => e.stopPropagation()}>
      <IconBtn
        icon={ICON.check}
        label={frozen ? (zh ? "审批中,暂不能完成" : "承認中は完了不可") : zh ? "完成(清出收件箱)" : "完了(受信箱から外す)"}
        tone="#1a9e6b"
        disabled={frozen}
        onClick={() => run("done")}
      />
      <IconBtn
        icon={ICON.archive}
        label={frozen ? (zh ? "审批中,暂不能归档" : "承認中はアーカイブ不可") : zh ? "归档(知会已阅)" : "アーカイブ(既読)"}
        disabled={frozen}
        onClick={() => run("archive")}
      />
      <IconBtn
        icon={ICON.moon}
        label={frozen ? (zh ? "审批中,暂不能 Snooze" : "承認中はスヌーズ不可") : "Snooze"}
        disabled={frozen}
        active={snoozeOpen}
        onClick={() => setSnoozeOpen((v) => !v)}
      />
      <IconBtn
        icon={ICON.pin}
        label={pinned ? (zh ? "取消置顶" : "ピン解除") : zh ? "置顶" : "ピン留め"}
        tone="#d97a0a"
        active={pinned}
        onClick={() => run("pin", { value: !pinned })}
      />
      {snoozeOpen && (
        <div
          role="presentation"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 30,
            right: 0,
            zIndex: 30,
            background: "#fff",
            border: "1px solid #e3e5e9",
            borderRadius: 8,
            boxShadow: "0 10px 30px -8px rgba(16,24,40,0.28)",
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 132,
          }}
        >
          {snoozePresets(zh).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                run("snooze", { snoozedTill: p.at().toISOString() });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12,
                color: "#3a3d42",
                background: "transparent",
                border: "none",
                borderRadius: 5,
                padding: "6px 8px",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f5f7")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Ico d={ICON.moon} size={12} color="#8a8e95" />
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusDot({ group }: { group: string | null }) {
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: 99,
        background: group === "started" ? "#e67e22" : "#e0a82e",
        flex: "none",
      }}
    />
  );
}

function Row({
  s,
  zh,
  projectId,
  focused,
  onOpen,
  gapBadge,
  slug,
  frozen,
  onPatch,
}: {
  s: DigestItem;
  zh: boolean;
  projectId: string;
  focused: boolean;
  onOpen: () => void;
  gapBadge?: string;
  slug: string;
  frozen: boolean;
  onPatch: (next: TInboxTriage | null) => void;
}) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const di = dueInfo(s.due_date, zh);
  const gapInfo = s.needs_info;
  // 要補足 行:副行显示「缺什么/请补什么」,而非 next(完成卡无 next)
  const sub = gapInfo
    ? pick(s.info_gap, zh) || (zh ? "状态变更原因不明,请补充" : "状態変更の理由が不明、補足を")
    : pick(s.next_action, zh);
  const overdue = di?.tone === "overdue";
  const st = stallTone(s.stale_days);
  const showActions = hover || focused;
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  return (
    <div
      ref={ref}
      role="presentation"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      title={zh ? "打开卡片" : "カードを開く"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 8,
        cursor: "pointer",
        background: focused ? "#f5f3ff" : hover ? "#f8f9fb" : "#fff",
        border: "1px solid " + (focused ? "#c9bdff" : hover ? "#e6e8ec" : "#eceef1"),
        boxShadow: focused ? "0 0 0 1px #c9bdff" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
        <StatusDot group={s.state_group} />
        {isPinned(s) && (
          <span title={zh ? "已置顶" : "ピン留め"} style={{ flex: "none", marginLeft: -6, marginRight: -4, display: "inline-flex" }}>
            <Ico d={ICON.pin} size={12} sw={2} color="#d97a0a" />
          </span>
        )}
        <div style={{ width: 56, flex: "none", fontSize: 11.5, color: "#9499a0", fontWeight: 500 }}>
          {s.project_identifier && s.sequence_id != null ? `${s.project_identifier}-${s.sequence_id}` : ""}
        </div>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5,
              color: "#2b2e34",
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {s.name}
          </div>
          {sub && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginTop: 3,
                fontSize: 11.5,
                color: gapInfo ? "#b06d09" : "#6b6e74",
                minWidth: 0,
              }}
            >
              <Ico
                d={gapInfo ? ICON.alert : ICON.arrowRight}
                size={11}
                sw={2}
                color={gapInfo ? "#d97706" : "#b5b8be"}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
            </div>
          )}
        </div>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8 }}>
          {gapBadge && gapInfo && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#92560a",
                background: "#fdf3e2",
                border: "1px solid #f0d9a8",
                borderRadius: 4,
                padding: "1px 7px",
                whiteSpace: "nowrap",
              }}
            >
              {gapBadge}
            </span>
          )}
          {s.ball === "OTHER" && s.actor_name && (
            <span style={{ fontSize: 11, color: "#5d6f81", whiteSpace: "nowrap" }}>
              {zh ? `对方:${s.actor_name}` : `先方:${s.actor_name}`}
            </span>
          )}
          {st !== "none" && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: st === "high" ? "#c0392b" : "#b06d09",
                whiteSpace: "nowrap",
              }}
            >
              {zh ? `停滞 ${s.stale_days} 天` : `${s.stale_days}日停滞`}
            </span>
          )}
          {di && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                minWidth: 78,
                textAlign: "right",
                color: overdue ? "#c0392b" : di.tone === "soon" ? "#b45309" : "#9ca3af",
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                justifyContent: "flex-end",
              }}
            >
              {overdue && <Ico d={ICON.alert} size={11} sw={2} />}
              {overdue ? (zh ? `逾期 ${-di.diff} 天` : `期限を${-di.diff}日超過`) : di.label}
            </span>
          )}
          <span style={{ width: 22, display: "inline-flex", justifyContent: "flex-end" }}>
            {s.actor_kind === "person" && s.actor_name ? (
              <AvatarBadge name={s.actor_name} size={20} />
            ) : s.unassigned ? (
              <span
                title={zh ? "待指派" : "担当未定"}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  border: "1.5px dashed #d6b483",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#b45309",
                  fontSize: 13,
                }}
              >
                ?
              </span>
            ) : (
              <Ico d={ICON.building} size={15} color="#a3a7ad" />
            )}
          </span>
        </div>
      </div>
      {/* BS-216 线框A:分流托盘**常驻可见**(收件箱=决策队列,一眼可清);次要的催促/再分析留 hover */}
      <div
        role="presentation"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <TriageBar
          slug={slug}
          projectId={projectId}
          issueId={s.issue_id}
          inbox={s.inbox}
          frozen={frozen}
          zh={zh}
          onPatch={onPatch}
        />
        {showActions && <DISActionBar s={s} projectId={projectId} zh={zh} compact />}
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
  color,
  icon,
  active,
  onClick,
}: {
  value: number;
  label: string;
  color: string;
  icon: string[];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderRadius: 10,
        flex: "1 1 0",
        minWidth: 130,
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        background: active ? color + "12" : "#fff",
        border: "1px solid " + (active ? color : "#eceef1"),
        boxShadow: active ? "0 0 0 1px " + color : "none",
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: color + "18",
          color,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <Ico d={icon} size={15} sw={1.9} color={color} />
      </span>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#2b2e34", lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: "#8a8e95", marginTop: 3 }}>{label}</div>
      </div>
    </button>
  );
}

function Group({
  icon,
  color,
  title,
  count,
  sub,
  collapsed,
  onToggle,
  children,
}: {
  icon: string[];
  color: string;
  title: string;
  count: number;
  sub: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        role="presentation"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter") onToggle();
        }}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px 2px", cursor: "pointer" }}
      >
        <Ico d={collapsed ? ["M9 18l6-6-6-6"] : ["M6 9l6 6 6-6"]} size={13} color="#9499a0" />
        <Ico d={icon} size={15} sw={1.9} color={color} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#3a3d42" }}>{title}</span>
        <span
          style={{
            fontSize: 12,
            color: "#fff",
            background: color,
            borderRadius: 99,
            padding: "0 7px",
            fontWeight: 600,
            minWidth: 18,
            textAlign: "center",
          }}
        >
          {count}
        </span>
        <span style={{ fontSize: 11.5, color: "#9499a0", marginLeft: 2 }}>{sub}</span>
      </div>
      {!collapsed && children}
    </div>
  );
}

// BARSOUL: 待审批行(我作为审批人、等我裁决的 issue)。点击打开卡片 → barsoulCard 裁决。
function ApprovalRow({
  a,
  zh,
  dis,
  modeLabel,
  roleLabel,
  queued,
  onOpen,
}: {
  a: TPendingApprovalItem;
  zh: boolean;
  dis?: DigestItem;
  modeLabel: string;
  roleLabel: string;
  queued: boolean;
  onOpen: () => void;
}) {
  const [hover, setHover] = useState(false);
  const ident =
    dis && dis.project_identifier && dis.sequence_id != null ? `${dis.project_identifier}-${dis.sequence_id}` : "";
  const title = a.subject || dis?.name || `${zh ? "审批" : "審査"} ${a.no}`;
  const accent = queued ? "#9499a0" : "#7c5cff";
  return (
    <div
      role="presentation"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      title={zh ? "打开卡片裁决" : "カードを開いて裁決"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderRadius: 8,
        cursor: "pointer",
        opacity: queued ? 0.72 : 1,
        background: hover ? "#f6f4ff" : "#fff",
        border: "1px solid " + (hover ? "#d9d0ff" : "#eceef1"),
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 99, background: accent, flex: "none" }} />
      <div style={{ width: 56, flex: "none", fontSize: 11.5, color: "#9499a0", fontWeight: 500 }}>{ident}</div>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            color: "#2b2e34",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, fontSize: 11.5, color: accent }}>
          <Ico d={ICON_APPROVAL} size={11} sw={2} color={accent} />
          <span>{(zh ? "审批" : "審査") + " · " + modeLabel}</span>
        </div>
      </div>
      <span
        style={{
          flex: "none",
          fontSize: 11,
          fontWeight: 700,
          color: queued ? "#9499a0" : "#6b4bd6",
          background: queued ? "#f0f0f3" : "#efeaff",
          border: "1px solid " + (queued ? "#e3e3e8" : "#ddd2ff"),
          borderRadius: 4,
          padding: "1px 8px",
          whiteSpace: "nowrap",
        }}
      >
        {roleLabel}
      </span>
    </div>
  );
}

export function AIDigestView({
  workspaceSlug,
  projectId,
}: {
  workspaceSlug: string;
  // projectId 省略 → **工作区级「我的工作」モード**(跨在籍プロジェクト集約)。
  // 指定あり → 従来の項目級作业台(看板の digest モード)。
  projectId?: string;
}) {
  // 工作区级モードでは各カードが自分の project を持つ → action は必ずカード自身の
  // project へ(下記 pidOf)。ビュー全体の projectId はもう単一項目を意味しない。
  const ws = !projectId;
  const pidOf = (s: DigestItem) => s.project_id || projectId || "";
  const { workspaceSlug: routerWs } = useParams();
  const slug = workspaceSlug || routerWs?.toString() || "";
  const zh = useZh();
  const issueDetail = useIssueDetail();
  const { setPeekIssue } = issueDetail;
  const { data: currentUser } = useUser();
  const { getProjectById } = useProject();
  const openCard = (s: DigestItem) => setPeekIssue({ workspaceSlug: slug, projectId: pidOf(s), issueId: s.issue_id });
  const { items: myApprovals } = useMyPendingApprovals(); // 我作为审批人的待裁决(权威台账)

  const [items, setItems] = useState<DigestItem[] | null>(null);
  const [scope, setScope] = useState<"self" | "all">("self");
  const [slices, setSlices] = useState<Set<Slice>>(new Set());
  const [sort, setSort] = useState<SortKey>("urgency");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(-1); // 键盘聚焦行(-1=无)
  const [refreshKey, setRefreshKey] = useState(0); // 重拉信号
  const [showCleared, setShowCleared] = useState(false); // 「已清」抽屉展开
  // BS-216 线框A:左栏子导航单选(决策收件箱的分区)。inbox=全部;其余=聚焦该分区。
  const [nav, setNav] = useState<NavKey>("inbox");
  // BS-216 线框A:@提及(原生 Notification 投影)。仅工作区级模式拉取;清零=原生标记已读。
  const [mentions, setMentions] = useState<MentionItem[]>([]);
  // BS-216 线框A:指派给我(原生 workspace issues 投影)。仅工作区级;独立 lens,不折 inbox。
  const [assigned, setAssigned] = useState<AssignedItem[]>([]);

  // 分流回执:乐观更新本地 items 的个人分流态(triage 端点已落库,这里同步 UI 不必整表重拉)。
  const patchInbox = useCallback((issueId: string, next: TInboxTriage | null) => {
    if (!next) return;
    setItems((prev) => (prev ? prev.map((it) => (it.issue_id === issueId ? { ...it, inbox: next } : it)) : prev));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // ws=工作区级 → 跨在籍プロジェクトの DIS 集約端点; そうでなければ従来の項目級。
        const url = ws
          ? `/api/workspaces/${slug}/my-work/ai-states/`
          : `/api/workspaces/${slug}/projects/${projectId}/issues/ai-states/`;
        const r = await fetch(url, {
          credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });
        if (!r.ok) {
          if (alive) setItems([]);
          return;
        }
        const data: Record<string, DigestItem> = await r.json();
        if (alive) setItems(Object.values(data).filter((x) => (x.ball && (x.confidence ?? 0) >= 0.4) || x.needs_info));
      } catch {
        if (alive) setItems([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, projectId, refreshKey]);

  // BS-216 线框A:@提及 = 原生 Notification 表(mention SoR),仅工作区级模式。
  // ?mentioned=true&read=false&archived=false → 未读且目标卡存活的 @我 通知(alive-issue 过滤在后端)。
  // 只读投影 + 原生标记已读,绝不经 inbox_states(两套 SoR 不混)。
  useEffect(() => {
    if (!ws) {
      setMentions([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const url = `/api/workspaces/${slug}/users/notifications/?mentioned=true&read=false&archived=false&per_page=50`;
        const r = await fetch(url, {
          credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });
        if (!r.ok) {
          if (alive) setMentions([]);
          return;
        }
        const data = await r.json();
        const rows: any[] = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
        const mapped: MentionItem[] = rows
          .map((n) => {
            const iss = n?.data?.issue;
            const issueId = iss?.id || n?.entity_identifier;
            if (!issueId || !n?.project) return null;
            return {
              notification_id: n.id,
              issue_id: issueId,
              project_id: n.project,
              name: iss?.name || "",
              identifier: iss?.identifier,
              sequence_id: iss?.sequence_id,
              by: n?.triggered_by_details?.display_name || n?.triggered_by_details?.first_name,
              at: n?.created_at,
            } as MentionItem;
          })
          .filter(Boolean) as MentionItem[];
        if (alive) setMentions(mapped);
      } catch {
        if (alive) setMentions([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, ws, refreshKey]);

  // @提及 清零 = 原生标记已读(POST .../read/),本地乐观移除。
  const markMentionRead = useCallback(
    async (m: MentionItem) => {
      setMentions((prev) => prev.filter((x) => x.notification_id !== m.notification_id));
      try {
        await fetch(`/api/workspaces/${slug}/users/notifications/${m.notification_id}/read/`, {
          method: "POST",
          credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });
      } catch {
        /* 失败非致命:下次刷新自然回列 */
      }
    },
    [slug]
  );

  // BS-216 线框A:指派给我 = 原生 workspace issues(assignees=我 & 未完成),仅工作区级。
  // 覆盖**全部**活跃指派卡(含无 DIS 判定的 backlog),是 need/wait/gap(DIS 子集)之外的完整清单。
  // state_group 排除 completed/cancelled;project identifier 走 useProject store 映射。
  const uid = currentUser?.id;
  useEffect(() => {
    if (!ws || !uid) {
      setAssigned([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const url = `/api/workspaces/${slug}/issues/?assignees=${uid}&state_group=backlog,unstarted,started&per_page=100`;
        const r = await fetch(url, {
          credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });
        if (!r.ok) {
          if (alive) setAssigned([]);
          return;
        }
        const data = await r.json();
        const rows: any[] = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
        const mapped: AssignedItem[] = rows
          .map((n) => {
            const issueId = n?.id;
            if (!issueId || !n?.project_id) return null;
            return {
              issue_id: issueId,
              project_id: n.project_id,
              name: n?.name || "",
              sequence_id: n?.sequence_id,
              state_group: n?.state__group,
              target_date: n?.target_date,
            } as AssignedItem;
          })
          .filter(Boolean) as AssignedItem[];
        if (alive) setAssigned(mapped);
      } catch {
        if (alive) setAssigned([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, ws, uid, refreshKey]);

  // 作业台自己取数(不走 per-id 缓存)→ 人工补充/重判/回到本视图后必须重拉,否则
  // 「要補足」清了 DB 却仍挂在列表上(BS-24 现象)。订阅全局 DIS 变更 + 标签页重新可见时刷新。
  useEffect(() => {
    const bump = () => setRefreshKey((k) => k + 1);
    const off = onAIStateChange(bump);
    const onVis = () => {
      if (document.visibilityState === "visible") bump();
    };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      off();
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const T = zh
    ? {
        title: "待我处理",
        sub: "AI 根据标题、描述、最新评论与截止日期推断当前进展。",
        self: "我的",
        all: "全部",
        needMe: "要我处理",
        waiting: "等待对方",
        stall: `停滞 ≥ ${STALL_TH} 天`,
        overdue: "已逾期",
        gNeed: "要我处理",
        gNeedSub: "球在我方,需处理",
        gWait: "等待对方",
        gWaitSub: "球在对方,必要时催办",
        gGap: "要补充(留痕)",
        gGapSub: "状态变更原因不明,补充后才完整",
        gapBadge: "要补充",
        sortLabel: "排序",
        urgency: "紧急度",
        due: "期限近",
        stallS: "停滞久",
        updated: "最近更新",
        lastUpd: (n: number) => `AI 最终更新:${n < 60 ? n + " 分钟前" : Math.round(n / 60) + " 小时前"}`,
        reanalyze: "重新分析",
        emptyAll: "没有需要处理的项目",
        emptyAllSub: "等待对方的项目可在「等待对方」查看",
        emptyFilter: "没有符合条件的项目",
        clear: "清除筛选",
        kbd: "↑↓ 选择 · Enter 打开 · e 催促 · r 再分析",
        gAppr: "待审批",
        gApprSub: "需你裁决,卡着后续",
        apprStat: "待审批",
        apprPendingLabel: "轮到你",
        apprQueuedLabel: "排队中",
        apprAny: "或签",
        apprAll: "会签",
        apprSeq: "顺次",
      }
    : {
        title: "対応待ち",
        sub: "タイトル・説明・最新コメント・期限からAIが現在の状況を推定します。",
        self: "自分",
        all: "全員",
        needMe: "要対応",
        waiting: "先方待ち",
        stall: `${STALL_TH}日以上停滞`,
        overdue: "期限超過",
        gNeed: "要対応",
        gNeedSub: "ボールは自社、対応が必要",
        gWait: "先方待ち",
        gWaitSub: "ボールは先方、必要に応じて催促",
        gGap: "要補足(履歴)",
        gGapSub: "状態変更の理由が不明、補足で完全に",
        gapBadge: "要補足",
        sortLabel: "並び替え",
        urgency: "緊急度順",
        due: "期限が近い順",
        stallS: "停滞が長い順",
        updated: "更新が新しい順",
        lastUpd: (n: number) => `AI 最終更新:${n < 60 ? n + "分前" : Math.round(n / 60) + "時間前"}`,
        reanalyze: "再分析",
        emptyAll: "対応が必要な項目はありません",
        emptyAllSub: "先方待ちの項目はこちらで確認できます",
        emptyFilter: "条件に一致する項目がありません",
        clear: "フィルターをクリア",
        kbd: "↑↓ 選択 · Enter 開く · e 催促 · r 再分析",
        gAppr: "承認待ち",
        gApprSub: "あなたの裁決が必要、後続をブロック",
        apprStat: "承認待ち",
        apprPendingLabel: "あなたの番",
        apprQueuedLabel: "順番待ち",
        apprAny: "いずれか",
        apprAll: "全員",
        apprSeq: "順次",
      };

  const myId = currentUser?.id;
  const myName = currentUser?.display_name;
  const isMine = useCallback(
    (s: DigestItem) =>
      (myId && s.actor_user_id === myId) || (!!myName && !!s.owner && (s.owner === myName || s.owner.includes(myName))),
    [myId, myName]
  );

  const scopedAll = useMemo(() => (items || []).filter((s) => scope === "all" || isMine(s)), [items, scope, isMine]);
  // 个人分流:已完成/已归档/未来 snooze 的卡移出活跃队列 → live;进「已清」抽屉可回队。
  const scoped = useMemo(() => scopedAll.filter((s) => !isCleared(s)), [scopedAll]);
  const cleared = useMemo(() => scopedAll.filter(isCleared), [scopedAll]);
  const sliceOf = (s: DigestItem, sl: Slice) =>
    sl === "self"
      ? s.ball === "SELF"
      : sl === "other"
        ? s.ball === "OTHER"
        : sl === "stall"
          ? stallTone(s.stale_days) !== "none"
          : isOverdue(s);
  const filtered = useMemo(
    () => scoped.filter((s) => slices.size === 0 || Array.from(slices).every((sl) => sliceOf(s, sl))),
    [scoped, slices]
  );
  const sortFn = useCallback(
    (a: DigestItem, b: DigestItem) => {
      // 置顶恒在前(不受排序键影响)
      const pin = (isPinned(b) ? 1 : 0) - (isPinned(a) ? 1 : 0);
      if (pin) return pin;
      return sort === "due"
        ? (dueInfo(a.due_date, true)?.diff ?? 9999) - (dueInfo(b.due_date, true)?.diff ?? 9999)
        : sort === "stall"
          ? b.stale_days - a.stale_days
          : sort === "updated"
            ? String(b.updated_at).localeCompare(String(a.updated_at))
            : severity(b) - severity(a);
    },
    [sort]
  );
  // 留痕缺口优先成独立组(不混入 要対応/先方待ち);基于 scoped 而非 filtered →
  // 切片筛选不会把「要補足」藏起来(信息完整性最高优先,不能漏)。
  const gap = useMemo(() => scoped.filter((s) => s.needs_info), [scoped]);
  // BS-216 线框A 时间段:今天到期 / 已逾期(跨分组横切,基于 scoped 活跃队列)。
  const todayItems = useMemo(() => scoped.filter((s) => dueInfo(s.due_date, true)?.diff === 0).sort(sortFn), [scoped, sortFn]);
  const overdueItems = useMemo(() => scoped.filter((s) => isOverdue(s)).sort(sortFn), [scoped, sortFn]);
  // 待审批: 我等裁决的 issue(本 project)。issue_id→DIS 项 join 取 BS-xxx/标题。
  const disById = useMemo(() => {
    const m: Record<string, DigestItem> = {};
    (items || []).forEach((s) => {
      if (s.issue_id) m[s.issue_id] = s;
    });
    return m;
  }, [items]);
  // 项目级: 本 project の待裁決のみ。工作区级: myApprovals は既に workspace 全域 →
  // そのまま全件(跨项目の審批も「我的工作」に集約表示)。
  const approvals = useMemo(
    () => (ws ? myApprovals : myApprovals.filter((a) => a.project_id === projectId)),
    [myApprovals, projectId, ws]
  );
  const pendingAppr = useMemo(() => approvals.filter((a) => a.role === "pending_approver"), [approvals]);
  const queuedAppr = useMemo(() => approvals.filter((a) => a.role === "queued_approver"), [approvals]);
  // 托管=审批闸门:等我裁决的卡冻结分流(隐藏类动作禁用;服务层 409 兜底)。
  const frozenIds = useMemo(
    () => new Set(pendingAppr.map((a) => a.issue_id).filter(Boolean) as string[]),
    [pendingAppr]
  );
  const needMe = useMemo(
    () => filtered.filter((s) => s.ball === "SELF" && !s.needs_info).sort(sortFn),
    [filtered, sortFn]
  );
  const waiting = useMemo(
    () => filtered.filter((s) => s.ball === "OTHER" && !s.needs_info).sort(sortFn),
    [filtered, sortFn]
  );
  const lastUpd = minutesAgo(
    scoped.reduce<string | null>((m, s) => (!m || String(s.updated_at) > m ? (s.updated_at ?? m) : m), null)
  );

  // ── 分组显隐(左栏 nav 单选门控)+ 扁平可聚焦行(供键盘导航;折叠组的行不可聚焦)──
  // inbox=全部分组;need/gap/approval=只显对应组;today/overdue=横切时间视图(单列)。
  const timeMode = nav === "today" || nav === "overdue";
  const timeList = nav === "today" ? todayItems : nav === "overdue" ? overdueItems : [];
  const showApproval = (nav === "inbox" || nav === "approval") && approvals.length > 0;
  const showGap = (nav === "inbox" || nav === "gap") && gap.length > 0;
  const showNeed = (nav === "inbox" || nav === "need") && needMe.length > 0;
  const showWait = nav === "inbox" && waiting.length > 0;
  const showMention = (nav === "inbox" || nav === "mention") && mentions.length > 0;
  // 指派给我=独立 lens,只在自己挡位显(不折 inbox,避免与 DIS 分组重复)。
  const showAssigned = nav === "assigned" && assigned.length > 0;
  // 当前 nav 下的活跃项数(供空态判断:0 → 显空态而非空白)
  const activeCount = timeMode
    ? timeList.length
    : nav === "need"
      ? needMe.length
      : nav === "gap"
        ? gap.length
        : nav === "approval"
          ? approvals.length
          : nav === "mention"
            ? mentions.length
            : nav === "assigned"
              ? assigned.length
              : needMe.length + waiting.length + gap.length + approvals.length + mentions.length;
  const flat = useMemo(
    () =>
      timeMode
        ? timeList
        : [
            ...(showGap && !collapsed.has("gap") ? gap : []),
            ...(showNeed && !collapsed.has("need") ? needMe : []),
            ...(showWait && !collapsed.has("wait") ? waiting : []),
          ],
    [timeMode, timeList, showGap, showNeed, showWait, collapsed, gap, needMe, waiting]
  );
  // flat 变动后夹紧聚焦下标
  useEffect(() => {
    setFocusIdx((i) => (i >= flat.length ? flat.length - 1 : i));
  }, [flat.length]);

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
      if (k === "ArrowDown" || k === "j") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(flat.length - 1, i + 1));
        return;
      }
      if (k === "ArrowUp" || k === "k") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, (i < 0 ? 1 : i) - 1));
        return;
      }
      const cur = focusIdx >= 0 && focusIdx < flat.length ? flat[focusIdx] : undefined;
      if (!cur) return;
      // 工作区级では cur が属する project へ(pidOf); 项目级では従来通り単一 projectId。
      const cpid = cur.project_id || projectId || "";
      if (k === "Enter") {
        e.preventDefault();
        setPeekIssue({ workspaceSlug: slug, projectId: cpid, issueId: cur.issue_id });
      } else if (k === "e") {
        e.preventDefault();
        disDialog.open({
          issueId: cur.issue_id,
          projectId: cpid,
          actorName: cur.actor_name || "",
          nextAction: pick(cur.next_action, zh),
        });
      } else if (k === "r") {
        e.preventDefault();
        rederiveAIState(slug, cpid, cur.issue_id, zh);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flat, focusIdx, slug, projectId, zh, issueDetail, setPeekIssue]);

  const statN = (sl: Slice) => scoped.filter((s) => sliceOf(s, sl)).length;
  const toggleSlice = (sl: Slice) =>
    setSlices((p) => {
      const n = new Set(p);
      if (n.has(sl)) n.delete(sl);
      else n.add(sl);
      return n;
    });
  const toggleGroup = (g: string) =>
    setCollapsed((p) => {
      const n = new Set(p);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });

  const Seg = ({ v, label }: { v: "self" | "all"; label: string }) => (
    <button
      type="button"
      onClick={() => setScope(v)}
      className="text-xs inline-flex h-[26px] items-center rounded-md border-0 px-3 font-semibold"
      style={{
        background: scope === v ? "#fff" : "transparent",
        color: scope === v ? "#1f2328" : "#71757c",
        boxShadow: scope === v ? "0 1px 2px rgba(16,24,40,0.1)" : "none",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );

  const sliceLabels: Record<Slice, string> = { self: T.needMe, other: T.waiting, stall: T.stall, overdue: T.overdue };

  // ── BS-216 线框A 左栏子导航(决策段 + 时间段)──计数取活跃队列派生;action 项计数用琥珀=行动色。
  const navCount: Record<NavKey, number> = {
    inbox: scoped.length,
    need: needMe.length,
    gap: gap.length,
    approval: approvals.length,
    mention: mentions.length,
    assigned: assigned.length,
    today: todayItems.length,
    overdue: overdueItems.length,
  };
  type NavCfg = { key: NavKey; label: string; icon: string[]; action?: boolean };
  const NAV_SECTIONS: { title: string; items: NavCfg[] }[] = [
    {
      title: zh ? "决策" : "決定",
      items: [
        { key: "inbox", label: zh ? "收件箱" : "受信箱", icon: ICON.inbox },
        { key: "need", label: T.needMe, icon: ICON.user, action: true },
        { key: "assigned", label: zh ? "指派给我" : "担当", icon: ICON.columns },
        { key: "gap", label: T.gapBadge, icon: ICON.alert, action: true },
        { key: "approval", label: T.apprStat, icon: ICON_APPROVAL, action: true },
        { key: "mention", label: zh ? "@ 提及" : "@ メンション", icon: ICON.message, action: true },
      ],
    },
    {
      title: zh ? "时间" : "期限",
      items: [
        { key: "today", label: zh ? "今天" : "今日", icon: ICON.calendar, action: true },
        { key: "overdue", label: T.overdue, icon: ICON.clock, action: true },
      ],
    },
  ];
  const NavItem = ({ item }: { item: NavCfg }) => {
    const active = nav === item.key;
    const n = navCount[item.key];
    return (
      <button
        type="button"
        onClick={() => setNav(item.key)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          width: "100%",
          textAlign: "left",
          padding: "6px 9px",
          borderRadius: 7,
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: active ? 600 : 500,
          color: active ? "#3538cd" : "#4a4e56", // 蓝=位置/选中
          background: active ? "#eef0ff" : "transparent",
        }}
      >
        <Ico d={item.icon} size={15} sw={1.8} color={active ? "#3538cd" : "#8a8e95"} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.label}
        </span>
        {n > 0 && (
          <span
            style={{
              flex: "none",
              fontSize: 11.5,
              fontWeight: 600,
              minWidth: 18,
              textAlign: "center",
              padding: "0 5px",
              borderRadius: 999,
              color: item.action ? "#b45309" : "#71757c", // 琥珀=行动(需处理分区);收件箱总数用中性
              background: item.action ? "#fdf0d9" : "#eef0f2",
            }}
          >
            {n}
          </span>
        )}
      </button>
    );
  };
  const Rail = (
    <nav
      style={{
        flex: "none",
        width: 208,
        position: "sticky",
        top: 12,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {NAV_SECTIONS.map((sec) => (
        <div key={sec.title} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: "#a3a7ad",
              textTransform: "uppercase",
              padding: "0 9px",
              marginBottom: 2,
            }}
          >
            {sec.title}
          </div>
          {sec.items.map((it) => (
            <NavItem key={it.key} item={it} />
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div style={{ height: "100%", overflow: "auto", background: "#f7f8fa" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "22px 24px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Ico d={ICON.sparkle} size={17} color="#7c5cff" sw={1.8} />
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#26292f", margin: 0 }}>{T.title}</h1>
          <div
            className="inline-flex items-center gap-0.5 rounded-lg p-0.5"
            style={{ background: "#eef0f2", marginLeft: 4 }}
          >
            <Seg v="self" label={T.self} />
            <Seg v="all" label={T.all} />
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            {lastUpd != null && <span style={{ fontSize: 11.5, color: "#9499a0" }}>{T.lastUpd(lastUpd)}</span>}
            <span style={{ fontSize: 10.5, color: "#b4b8bf", whiteSpace: "nowrap" }} title={T.kbd}>
              {T.kbd}
            </span>
            <label style={{ fontSize: 12, color: "#71757c", display: "inline-flex", alignItems: "center", gap: 5 }}>
              {T.sortLabel}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                style={{
                  fontSize: 12,
                  color: "#33363c",
                  border: "1px solid #e3e5e9",
                  borderRadius: 6,
                  padding: "3px 6px",
                  background: "#fff",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <option value="urgency">{T.urgency}</option>
                <option value="due">{T.due}</option>
                <option value="stall">{T.stallS}</option>
                <option value="updated">{T.updated}</option>
              </select>
            </label>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: "#8a8e95", margin: "0 0 16px", lineHeight: 1.5 }}>{T.sub}</p>

        {/* BS-216 线框A:两栏 IA —— 左=决策队列子导航,右=收件箱主区 */}
        <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
          {Rail}
          <div style={{ flex: 1, minWidth: 0 }}>

        {/* BS-216 线框A:Inbox Zero 进度(收件箱=可清空的决策队列,给「清零」一个可见目标) */}
        {(() => {
          const done = cleared.length;
          const left = scoped.length;
          const total = done + left;
          if (total === 0) return null;
          const pct = Math.round((done / total) * 100);
          const zero = left === 0;
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 16px" }}>
              <div
                style={{
                  flex: "1 1 auto",
                  height: 6,
                  borderRadius: 999,
                  background: "#e9ebee",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: zero ? "#3aa76d" : "#7c5cff",
                    transition: "width .3s ease",
                  }}
                />
              </div>
              <span style={{ fontSize: 12, color: "#71757c", whiteSpace: "nowrap", flex: "none" }}>
                {zero ? (
                  <span style={{ color: "#3aa76d", fontWeight: 600 }}>
                    {zh ? "✓ 已清空 · Inbox Zero" : "✓ 空になりました · Inbox Zero"}
                  </span>
                ) : (
                  <>
                    {zh ? `已清 ${done}/${total} · 距 Inbox Zero 还剩 ` : `${done}/${total} 片付け済み · 残り `}
                    <span style={{ color: "#d97a0a", fontWeight: 600 }}>{left}</span>
                  </>
                )}
              </span>
            </div>
          );
        })()}

        {items === null ? (
          <div style={{ fontSize: 13, color: "#9499a0", padding: "20px 0" }}>{zh ? "加载中…" : "読み込み中…"}</div>
        ) : activeCount === 0 ? (
          <div style={{ padding: "28px 0", textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#54585f" }}>
              {nav === "inbox" ? T.emptyAll : zh ? "此分区暂无待办" : "このセクションは空です"}
            </div>
            {nav === "inbox" ? (
              <div style={{ marginTop: 6, fontSize: 12.5, color: "#9499a0" }}>{T.emptyAllSub}</div>
            ) : (
              <button
                type="button"
                onClick={() => setNav("inbox")}
                style={{
                  marginTop: 8,
                  fontSize: 12.5,
                  color: "#7c5cff",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 600,
                }}
              >
                {zh ? "← 回收件箱" : "← 受信箱へ"}
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {timeMode && (
              <Group
                icon={nav === "today" ? ICON.calendar : ICON.clock}
                color={nav === "today" ? "#d97a0a" : "#dc2626"}
                title={nav === "today" ? (zh ? "今天到期" : "今日期限") : T.overdue}
                count={timeList.length}
                sub={nav === "today" ? (zh ? "今天到期,优先处理" : "本日締切、優先") : zh ? "已过期限,尽快跟进" : "期限超過、要フォロー"}
                collapsed={false}
                onToggle={() => {}}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {timeList.map((s) => (
                    <Row
                      key={s.issue_id}
                      s={s}
                      zh={zh}
                      projectId={pidOf(s)}
                      focused={flat[focusIdx] === s}
                      onOpen={() => openCard(s)}
                      slug={slug}
                      frozen={frozenIds.has(s.issue_id)}
                      onPatch={(next) => patchInbox(s.issue_id, next)}
                    />
                  ))}
                </div>
              </Group>
            )}
            {showAssigned && (
              <Group
                icon={ICON.columns}
                color="#5d6f81"
                title={zh ? "指派给我" : "担当"}
                count={assigned.length}
                sub={zh ? "所有指派给我的活跃卡(含无 AI 判定的)" : "自分に割り当てられた進行中カード全て"}
                collapsed={collapsed.has("assigned")}
                onToggle={() => toggleGroup("assigned")}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {assigned.map((a) => {
                    const ident = getProjectById(a.project_id)?.identifier;
                    const di = a.target_date ? dueInfo(a.target_date, zh) : null;
                    return (
                      <div
                        key={a.issue_id}
                        role="presentation"
                        onClick={() =>
                          setPeekIssue({ workspaceSlug: slug, projectId: a.project_id, issueId: a.issue_id })
                        }
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "9px 12px",
                          borderRadius: 9,
                          background: "#fff",
                          border: "1px solid #eceef1",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ width: 56, flex: "none", fontSize: 11.5, color: "#9499a0", fontWeight: 500 }}>
                          {ident && a.sequence_id != null ? `${ident}-${a.sequence_id}` : ""}
                        </div>
                        <div
                          style={{
                            flex: "1 1 auto",
                            minWidth: 0,
                            fontSize: 13,
                            color: "#33363c",
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {a.name}
                        </div>
                        {di && (
                          <span
                            style={{
                              flex: "none",
                              fontSize: 11,
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                              color: di.tone === "overdue" ? "#d97a0a" : "#8a8e95",
                            }}
                          >
                            {di.label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Group>
            )}
            {showApproval && (
              <Group
                icon={ICON_APPROVAL}
                color="#7c5cff"
                title={T.gAppr}
                count={approvals.length}
                sub={T.gApprSub}
                collapsed={collapsed.has("approval")}
                onToggle={() => toggleGroup("approval")}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pendingAppr.map((a) => (
                    <ApprovalRow
                      key={a.no}
                      a={a}
                      zh={zh}
                      dis={a.issue_id ? disById[a.issue_id] : undefined}
                      modeLabel={a.mode === "ALL" ? T.apprAll : a.mode === "SEQUENTIAL" ? T.apprSeq : T.apprAny}
                      roleLabel={T.apprPendingLabel}
                      queued={false}
                      onOpen={() => a.issue_id && openCard(a.issue_id)}
                    />
                  ))}
                  {queuedAppr.map((a) => (
                    <ApprovalRow
                      key={a.no}
                      a={a}
                      zh={zh}
                      dis={a.issue_id ? disById[a.issue_id] : undefined}
                      modeLabel={a.mode === "ALL" ? T.apprAll : a.mode === "SEQUENTIAL" ? T.apprSeq : T.apprAny}
                      roleLabel={T.apprQueuedLabel}
                      queued={true}
                      onOpen={() => a.issue_id && openCard(a.issue_id)}
                    />
                  ))}
                </div>
              </Group>
            )}
            {showMention && (
              <Group
                icon={ICON.message}
                color="#7c5cff"
                title={zh ? "@ 提及" : "@ メンション"}
                count={mentions.length}
                sub={zh ? "有人在评论/描述里 @ 了你" : "コメント・説明であなたが @ されました"}
                collapsed={collapsed.has("mention")}
                onToggle={() => toggleGroup("mention")}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {mentions.map((m) => (
                    <div
                      key={m.notification_id}
                      role="presentation"
                      onClick={() => setPeekIssue({ workspaceSlug: slug, projectId: m.project_id, issueId: m.issue_id })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 12px",
                        borderRadius: 9,
                        background: "#fff",
                        border: "1px solid #eceef1",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ width: 56, flex: "none", fontSize: 11.5, color: "#9499a0", fontWeight: 500 }}>
                        {m.identifier && m.sequence_id != null ? `${m.identifier}-${m.sequence_id}` : ""}
                      </div>
                      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            color: "#33363c",
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.name}
                        </div>
                        <div style={{ fontSize: 11.5, color: "#8a8e95", marginTop: 2 }}>
                          {m.by
                            ? zh
                              ? `${m.by} 提及了你`
                              : `${m.by} さんがあなたに @ しました`
                            : zh
                              ? "有人提及了你"
                              : "あなたが @ されました"}
                          {m.at ? ` · ${relTime(m.at, zh)}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        title={zh ? "标记已读(移出队列)" : "既読にする"}
                        onClick={(e) => {
                          e.stopPropagation();
                          markMentionRead(m);
                        }}
                        style={{
                          flex: "none",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          height: 26,
                          padding: "0 9px",
                          border: "1px solid #e3e5e9",
                          borderRadius: 7,
                          background: "#fff",
                          color: "#5a5e66",
                          fontSize: 11.5,
                          fontWeight: 600,
                          fontFamily: "inherit",
                          cursor: "pointer",
                        }}
                      >
                        <Ico d={ICON.check} size={13} sw={2} color="#3aa76d" />
                        {zh ? "已读" : "既読"}
                      </button>
                    </div>
                  ))}
                </div>
              </Group>
            )}
            {showGap && (
              <Group
                icon={ICON.alert}
                color="#d97706"
                title={T.gGap}
                count={gap.length}
                sub={T.gGapSub}
                collapsed={collapsed.has("gap")}
                onToggle={() => toggleGroup("gap")}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {gap.map((s) => (
                    <Row
                      key={s.issue_id}
                      s={s}
                      zh={zh}
                      projectId={pidOf(s)}
                      gapBadge={T.gapBadge}
                      focused={flat[focusIdx] === s}
                      onOpen={() => openCard(s)}
                      slug={slug}
                      frozen={frozenIds.has(s.issue_id)}
                      onPatch={(next) => patchInbox(s.issue_id, next)}
                    />
                  ))}
                </div>
              </Group>
            )}
            {showNeed && (
              <Group
                icon={ICON.inbox}
                color="#d97a0a"
                title={T.gNeed}
                count={needMe.length}
                sub={T.gNeedSub}
                collapsed={collapsed.has("need")}
                onToggle={() => toggleGroup("need")}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {needMe.map((s) => (
                    <Row
                      key={s.issue_id}
                      s={s}
                      zh={zh}
                      projectId={pidOf(s)}
                      focused={flat[focusIdx] === s}
                      onOpen={() => openCard(s)}
                      slug={slug}
                      frozen={frozenIds.has(s.issue_id)}
                      onPatch={(next) => patchInbox(s.issue_id, next)}
                    />
                  ))}
                </div>
              </Group>
            )}
            {showWait && (
              <Group
                icon={ICON.send}
                color="#5d6f81"
                title={T.gWait}
                count={waiting.length}
                sub={T.gWaitSub}
                collapsed={collapsed.has("wait")}
                onToggle={() => toggleGroup("wait")}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {waiting.map((s) => (
                    <Row
                      key={s.issue_id}
                      s={s}
                      zh={zh}
                      projectId={pidOf(s)}
                      focused={flat[focusIdx] === s}
                      onOpen={() => openCard(s)}
                      slug={slug}
                      frozen={frozenIds.has(s.issue_id)}
                      onPatch={(next) => patchInbox(s.issue_id, next)}
                    />
                  ))}
                </div>
              </Group>
            )}
          </div>
        )}

        {/* 已清抽屉:完成/归档/Snooze 的卡收在这里,可回队(可搜回,不丢) */}
        {cleared.length > 0 && (
          <div style={{ marginTop: 22, borderTop: "1px solid #eceef1", paddingTop: 14 }}>
            <button
              type="button"
              onClick={() => setShowCleared((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12.5,
                fontWeight: 600,
                color: "#71757c",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              <Ico d={showCleared ? ["M6 9l6 6 6-6"] : ["M9 18l6-6-6-6"]} size={13} color="#9499a0" />
              <Ico d={ICON.check} size={13} sw={2} color="#8a8e95" />
              {(zh ? "已清出收件箱" : "受信箱から片付け済み") + ` · ${cleared.length}`}
            </button>
            {showCleared && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {cleared.map((s) => (
                  <div
                    key={s.issue_id}
                    role="presentation"
                    onClick={() => openCard(s)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "#fafbfc",
                      border: "1px solid #eceef1",
                      cursor: "pointer",
                      opacity: 0.85,
                    }}
                  >
                    <div style={{ width: 56, flex: "none", fontSize: 11.5, color: "#9499a0", fontWeight: 500 }}>
                      {s.project_identifier && s.sequence_id != null ? `${s.project_identifier}-${s.sequence_id}` : ""}
                    </div>
                    <div
                      style={{
                        flex: "1 1 auto",
                        minWidth: 0,
                        fontSize: 13,
                        color: "#6b6e74",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.name}
                    </div>
                    <span style={{ flex: "none", fontSize: 11, color: "#9499a0", whiteSpace: "nowrap" }}>
                      {clearedKind(s, zh)}
                    </span>
                    <button
                      type="button"
                      title={zh ? "回队(放回收件箱)" : "受信箱に戻す"}
                      onClick={async (e) => {
                        e.stopPropagation();
                        const next = await triageInbox(slug, pidOf(s), s.issue_id, "reset", zh);
                        patchInbox(s.issue_id, next);
                      }}
                      style={{
                        flex: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        height: 24,
                        padding: "0 8px",
                        border: "1px solid #e3e5e9",
                        borderRadius: 6,
                        background: "#fff",
                        color: "#5a5e66",
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      <Ico d={ICON.undo} size={12} sw={2} color="#7a7e86" />
                      {zh ? "回队" : "戻す"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}
