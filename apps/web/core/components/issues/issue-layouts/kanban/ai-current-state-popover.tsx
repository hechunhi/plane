/**
 * BARSOUL DIS v3: 全局单浮层(整卡 hover 触发,智能翻转,来源高亮+箭头,可操作)。
 * 在 ProjectLayoutRoot 挂载一份。读 aiPopover 控制器的 active + 缓存的派生态。
 * 浮层 pointer-events 开 → 可点「打开卡片」「跳到来源评论」;移到浮层上不消失。
 */
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import {
  useActivePopover, aiPopover, getCachedAIState, useZh, pick, BALL_META,
  AvatarBadge, dueInfo, StallChip, Ico, ICON,
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

export function GlobalAICurrentStatePopover() {
  const active = useActivePopover();
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() || "";
  const zh = useZh();
  const { setPeekIssue } = useIssueDetail();
  const [, tick] = useState(0);

  // 视口/滚动变化时重定位
  useEffect(() => {
    if (!active) return;
    const on = () => tick((x) => x + 1);
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, [active]);

  if (!active) return null;
  const s = getCachedAIState(active.issueId);
  if (!s || s.state === "UNKNOWN" || !s.ball) return null;

  const rect = active.el.getBoundingClientRect();
  const W = 320, GAP = 12, M = 10;
  let side: "right" | "left" | "below" = "right";
  let left = rect.right + GAP;
  if (left + W > window.innerWidth - M) { left = rect.left - W - GAP; side = "left"; }
  if (left < M) { side = "below"; left = Math.min(Math.max(M, rect.left), window.innerWidth - W - M); }
  let top = side === "below" ? rect.bottom + GAP : rect.top;
  top = Math.max(M, Math.min(top, window.innerHeight - 160 - M));

  const ball = BALL_META[s.ball];
  const di = dueInfo(s.due_date, zh);
  const reason = pick(s.reasoning, zh);
  const lowConf = s.confidence < LOW_CONF;
  const conf = s.confidence >= 0.75 ? { t: "高", c: "#16a34a" } : s.confidence >= LOW_CONF ? { t: "中", c: "#b45309" } : { t: "低", c: "#c0392b" };
  const openCard = () => { setPeekIssue({ workspaceSlug: slug, projectId: active.projectId, issueId: active.issueId }); aiPopover.hide(); };

  // 指向来源卡的小箭头
  const arrow = (
    <span style={{
      position: "absolute", width: 10, height: 10, background: "#fff",
      borderLeft: "1px solid #e3e5e9", borderTop: "1px solid #e3e5e9",
      ...(side === "right" ? { left: -6, top: 18, transform: "rotate(-45deg)" }
        : side === "left" ? { right: -6, top: 18, transform: "rotate(135deg)" }
        : { top: -6, left: 24, transform: "rotate(45deg)" }),
    }} />
  );

  return (
    <div
      onMouseEnter={() => aiPopover.keep()}
      onMouseLeave={() => aiPopover.hide()}
      style={{ position: "fixed", left, top, width: W, zIndex: 95, pointerEvents: "auto",
        background: "#fff", border: "1px solid #e3e5e9", borderRadius: 10, maxHeight: "min(80vh, 440px)", overflow: "hidden",
        boxShadow: "0 14px 36px -8px rgba(16,24,40,0.24)", textAlign: "left", display: "flex", flexDirection: "column" }}
    >
      {arrow}
      {/* header: 卡号 · 标题 + 置信度弱化灰点 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 11px", borderBottom: "1px solid #f0f1f3", background: "#fbfbfc" }}>
        <Ico d={ICON.sparkle} size={13} color="#7c5cff" sw={1.8} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#71757c", flex: "none" }}>{active.meta.identifier && active.meta.seq != null ? `${active.meta.identifier}-${active.meta.seq}` : ""}</span>
        <span style={{ fontSize: 12, color: "#3a3d42", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{active.meta.name}</span>
        <span title={(zh ? "置信度 " : "確度 ") + conf.t} style={{ marginLeft: "auto", flex: "none", width: 8, height: 8, borderRadius: 99, background: conf.c, opacity: 0.55 }} />
      </div>

      <div style={{ padding: "10px 11px", display: "flex", flexDirection: "column", gap: 9, overflow: "auto" }}>
        {/* 低置信度 → 黄底告警(item 7) */}
        {lowConf && (
          <div style={{ fontSize: 11, fontWeight: 600, color: "#92700a", background: "#fdf6dd", border: "1px solid #ecd98a", borderRadius: 6, padding: "5px 8px", display: "flex", alignItems: "center", gap: 5 }}>
            <Ico d={ICON.alert} size={12} sw={2} color="#b8860b" />{zh ? "AI 推断不确定,建议人工确认" : "AI の推定が不確実です。確認を推奨"}
          </div>
        )}
        {/* 球 + 告警行 */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, background: ball.bg, border: "1px solid " + ball.border, color: ball.text, borderRadius: 4, padding: "1px 7px" }}>
            <Ico d={s.ball === "SELF" ? ICON.inbox : ICON.send} size={11} sw={1.8} color={ball.text} />{pick(ball.label, zh)}
          </span>
          <StallChip days={s.stale_days} zh={zh} />
          {di && (
            <span style={{ fontSize: 11, color: di.tone === "overdue" ? "#c0392b" : "#6b7280", display: "inline-flex", alignItems: "center", gap: 3, border: "1px solid #eceef1", borderRadius: 4, padding: "0 6px" }}>
              <Ico d={ICON.calendar} size={10} />{di.label}
            </span>
          )}
        </div>
        <Field label={zh ? "下一步" : "次アクション"} icon={ICON.arrowRight}>{pick(s.next_action, zh) || "—"}</Field>
        <Field label={zh ? "当前行动人" : "対応者"} icon={s.actor_kind === "person" ? ICON.user : ICON.building}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            {s.actor_kind === "person" && s.actor_name && <AvatarBadge name={s.actor_name} size={16} />}
            {s.actor_name || "—"}{s.unassigned && <span style={{ color: "#b45309", fontWeight: 600 }}>（{zh ? "待指派" : "担当未定"}）</span>}
          </span>
        </Field>
        {s.ball === "OTHER" && pick(s.waiting_on, zh) && (
          <Field label={zh ? "在等" : "待ち"} icon={ICON.clock}>{pick(s.waiting_on, zh)}</Field>
        )}
        {/* 推断依据: 源评论引用(点击打开卡片定位)+ reason */}
        {(s.source.quote || reason) && (
          <div style={{ borderTop: "1px dashed #ebedf0", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 10, color: "#9ca3af", letterSpacing: ".05em" }}>{zh ? "推断依据" : "推定根拠"}</div>
            {s.source.quote && (
              <div style={{ display: "flex", gap: 7, cursor: "pointer" }} onClick={openCard} title={zh ? "打开卡片查看原评论" : "カードを開いて元コメントへ"}>
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
      {/* 快捷操作(item 8): 打开卡片处理 —— 消除"看完还得手动去卡片"的断点 */}
      <div style={{ display: "flex", gap: 6, padding: "8px 11px", borderTop: "1px solid #f0f1f3", background: "#fbfbfc" }}>
        <button type="button" onClick={openCard} style={{ flex: 1, height: 28, border: "1px solid #e3e5e9", borderRadius: 6, background: "#fff", color: "#33363c", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
          <Ico d={ICON.external} size={13} color="#7c5cff" />{zh ? "打开卡片处理" : "カードを開いて対応"}
        </button>
      </div>
    </div>
  );
}
