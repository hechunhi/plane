/**
 * BARSOUL DIS v3/v4: AI 当前态 浮层 + 共享内容体。
 * v4: ①详情/peek 面板打开时全局禁弹浮层(详情用内嵌块代替)②抽出 AICurrentStateBody
 * 给浮层与内嵌块复用 ④置信度灰点 tooltip ⑦碰撞检测右→左→下。
 */
import { useEffect, useState, type ReactNode } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUser } from "@/hooks/store/user";
import {
  useActivePopover, aiPopover, getCachedAIState, useZh, pick, ballView,
  AvatarBadge, dueInfo, Ico, ICON, POP_W, type DerivedIssueState,
} from "./ai-state-line";

const LOW_CONF = 0.45;

function Field({ label, icon, children }: { label: string; icon: string[]; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ width: 72, flex: "none", whiteSpace: "nowrap", fontSize: 11, color: "#6b7280", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Ico d={icon} size={11} color="#9ca3af" />{label}
      </span>
      <span style={{ fontSize: 12.5, color: "#1f2328", fontWeight: 500, lineHeight: 1.4, minWidth: 0 }}>{children}</span>
    </div>
  );
}

/** 浮层 与 详情内嵌块 共享的内容(球/告警/下一步/行动人/推断依据)。ball 由 caller 保证非空。 */
export function AICurrentStateBody({ s, zh, onSource }: { s: DerivedIssueState; zh: boolean; onSource?: () => void }) {
  const { data: currentUser } = useUser();
  const bv = ballView(s, zh, currentUser?.id);
  const di = dueInfo(s.due_date, zh);
  const reason = pick(s.reasoning, zh);
  const lowConf = s.confidence < LOW_CONF;
  // 视角相关球(需我处理 / 球在{同事} / {外部}待ち);外部把等待详情并入尾巴(label 已含名)
  const ext = s.ball === "OTHER" || s.actor_kind === "external";
  const waitDetail = ext ? pick(s.waiting_on, zh) : "";
  const ballTail = waitDetail ? ` · ${waitDetail}` : "";
  const stallRed = s.stale_days >= 2;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {lowConf && (
        <div style={{ fontSize: 11, fontWeight: 600, color: "#92700a", background: "#fdf6dd", border: "1px solid #ecd98a", borderRadius: 6, padding: "5px 8px", display: "flex", alignItems: "center", gap: 5 }}>
          <Ico d={ICON.alert} size={12} sw={2} color="#b8860b" />{zh ? "AI 推断不确定,建议人工确认" : "AI の推定が不確実です。確認を推奨"}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%", fontSize: 11, fontWeight: 600, background: bv.bg, border: "1px solid " + bv.border, color: bv.text, borderRadius: 4, padding: "1px 7px" }}>
          <Ico d={bv.icon} size={11} sw={1.8} color={bv.text} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bv.label}{ballTail}</span>
        </span>
        {s.stale_days >= 1 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, borderRadius: 4, padding: "0 5px",
            background: stallRed ? "#fdeaea" : "#fdf3e2", border: "1px solid " + (stallRed ? "#f3c4c4" : "#f0d9a8"), color: stallRed ? "#c0392b" : "#b06d09" }}>
            {stallRed && <Ico d={ICON.alert} size={10} sw={2} />}{zh ? `停滞 ${s.stale_days} 天` : `${s.stale_days}日停滞`}
          </span>
        )}
        {di && (
          <span style={{ fontSize: 11, fontWeight: 600, color: di.tone === "overdue" ? "#c0392b" : "#6b7280", display: "inline-flex", alignItems: "center", gap: 3,
            background: di.tone === "overdue" ? "#fdeaea" : "transparent", border: "1px solid " + (di.tone === "overdue" ? "#f3c4c4" : "#eceef1"), borderRadius: 4, padding: "0 6px" }}>
            <Ico d={ICON.calendar} size={10} />{di.label}
          </span>
        )}
      </div>
      <Field label={zh ? "下一步" : "次のアクション"} icon={ICON.arrowRight}>{pick(s.next_action, zh) || "—"}</Field>
      <Field label={zh ? "当前行动人" : "対応者"} icon={s.actor_kind === "person" ? ICON.user : ICON.building}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {s.actor_kind === "person" && s.actor_name && <AvatarBadge name={s.actor_name} size={16} />}
          {s.actor_name || "—"}{s.unassigned && <span style={{ color: "#b45309", fontWeight: 600 }}>（{zh ? "待指派" : "担当未定"}）</span>}
        </span>
      </Field>
      {(s.source.quote || reason) && (
        <div style={{ borderTop: "1px dashed #ebedf0", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, color: "#9ca3af", letterSpacing: ".05em" }}>{zh ? "AI 推断依据" : "AI推定の根拠"}</div>
          {s.source.quote && (
            <div style={{ display: "flex", gap: 7, cursor: onSource ? "pointer" : "default" }} onClick={onSource} title={onSource ? (zh ? "定位到该评论" : "コメントへ移動") : undefined}>
              {s.source.author && <AvatarBadge name={s.source.author} size={18} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "#4a4d53", lineHeight: 1.45, background: "#f6f7f9", borderRadius: 6, padding: "6px 8px", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>「{s.source.quote}」</div>
                {s.source.author && <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 3 }}>{s.source.author}{zh ? " · 最新评论" : " · 最新コメント"}</div>}
              </div>
            </div>
          )}
          {reason && <div style={{ fontSize: 11, color: "#7c8088", lineHeight: 1.5, fontStyle: "italic", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>→ {reason}</div>}
        </div>
      )}
    </div>
  );
}

export const GlobalAICurrentStatePopover = observer(function GlobalAICurrentStatePopover() {
  const active = useActivePopover();
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() || "";
  const zh = useZh();
  const issueDetail = useIssueDetail();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const on = () => tick((x) => x + 1);
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, [active]);

  // item 1: 任何详情/peek 面板打开时,全局禁弹浮层(详情用内嵌块)
  if (issueDetail.peekIssue) return null;
  if (!active) return null;
  const s = getCachedAIState(active.issueId);
  if (!s || s.state === "UNKNOWN" || !s.ball) return null;

  // item 6/7: 方位由控制器 elementFromPoint 选(不盖其他卡片);此处据 side 算坐标
  const rect = active.el.getBoundingClientRect();
  const side = active.side;
  const GAP = 12, M = 10, vw = window.innerWidth;
  let W = POP_W;
  let left: number;
  if (side === "left") left = rect.left - W - GAP;
  else if (side === "below") { W = Math.min(W, vw - 2 * M); left = Math.min(Math.max(M, rect.left), vw - W - M); }
  else left = rect.right + GAP;
  left = Math.max(M, Math.min(left, vw - W - M));
  let top = side === "below" ? rect.bottom + GAP : rect.top;
  top = Math.max(M, Math.min(top, window.innerHeight - 160 - M));

  const conf = s.confidence >= 0.75 ? { t: zh ? "高" : "高", c: "#16a34a" } : s.confidence >= LOW_CONF ? { t: zh ? "中" : "中", c: "#b45309" } : { t: zh ? "低" : "低", c: "#c0392b" };
  const openCard = () => { issueDetail.setPeekIssue({ workspaceSlug: slug, projectId: active.projectId, issueId: active.issueId }); aiPopover.hide(); };

  const arrow = (
    <span style={{ position: "absolute", width: 10, height: 10, background: "#fff", borderLeft: "1px solid #e3e5e9", borderTop: "1px solid #e3e5e9",
      ...(side === "right" ? { left: -6, top: 18, transform: "rotate(-45deg)" } : side === "left" ? { right: -6, top: 18, transform: "rotate(135deg)" } : { top: -6, left: 24, transform: "rotate(45deg)" }) }} />
  );

  return (
    <div onMouseEnter={() => aiPopover.keep()} onMouseLeave={() => aiPopover.hide()}
      style={{ position: "fixed", left, top, width: W, zIndex: 95, pointerEvents: "auto", background: "#fff", border: "1px solid #e3e5e9", borderRadius: 10,
        maxHeight: "min(80vh, 440px)", overflow: "hidden", boxShadow: "0 14px 36px -8px rgba(16,24,40,0.24)", textAlign: "left", display: "flex", flexDirection: "column" }}>
      {arrow}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 11px", borderBottom: "1px solid #f0f1f3", background: "#fbfbfc" }}>
        <Ico d={ICON.sparkle} size={13} color="#7c5cff" sw={1.8} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#71757c", flex: "none" }}>{active.meta.identifier && active.meta.seq != null ? `${active.meta.identifier}-${active.meta.seq}` : ""}</span>
        <span style={{ fontSize: 12, color: "#3a3d42", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{active.meta.name}</span>
        {s.confidence < LOW_CONF ? (
          <span title={(zh ? "AI 置信度:低" : "AI 確度:低")} style={{ marginLeft: "auto", flex: "none", fontSize: 10.5, fontWeight: 600, color: "#92700a", background: "#fdf6dd", border: "1px solid #ecd98a", borderRadius: 4, padding: "0 5px" }}>{zh ? "AI 不确定" : "AI 不確実"}</span>
        ) : (
          <span title={(zh ? "AI 置信度:" : "AI 確度:") + conf.t} style={{ marginLeft: "auto", flex: "none", fontSize: 11, fontWeight: 600, color: conf.c }}>{(zh ? "置信度 " : "確度 ") + conf.t}</span>
        )}
      </div>
      <div style={{ padding: "10px 11px", overflow: "auto" }}>
        <AICurrentStateBody s={s} zh={zh} onSource={openCard} />
      </div>
    </div>
  );
});
