/**
 * BARSOUL(2026-07-07) BS-216 ②時効染色: 收件箱通知卡「時効脚注」。
 *
 * 目的（inbox-redesign ②）: 在通知卡底部暴露卡点的「時間信号」——
 *   - 逾期 / 高停滞 … 赤 (--over 系, StallChip 赤トーンと同一)
 *   - 中停滞 … 琥珀 (行動信号)
 *   - 球在対方(待ち) … slate (BALL_META.OTHER と同一)。任意で「已等 N 天」。
 *
 * 設計方針:
 *   - 取数/派生は看板 DIS と**完全に同一関数**を再利用 (useIssueAIState /
 *     topAlert / ballView)。色は看板の inline-hex パレットに合わせ、
 *     視覚言語を通知中心⇔看板で統一（issue-unread-badge の方針を踏襲）。
 *   - 失敗安全: DIS 無し(未算出/取得失敗) → 何も描画しない＝レイアウト無影響。
 *   - SoR は一切触らない（DIS は派生表 issue_ai_states の読取専用）。
 */
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import {
  useIssueAIState,
  useZh,
  topAlert,
  ballView,
} from "@/components/issues/issue-layouts/kanban/ai-state-line";

type TNotificationTimeFooter = {
  workspaceSlug: string;
  projectId: string;
  issueId: string | undefined;
};

// 看板 StallChip / BALL_META と同一パレット（トークン化 Tailwind では生成
// されない生 hex なので inline style で確実に着色）。
const TONE = {
  red: { bg: "#fdeaea", bd: "#f3c4c4", tx: "#c0392b" },
  amber: { bg: "#fdf3e2", bd: "#f0d9a8", tx: "#b06d09" },
  slate: { bg: "#eef2f6", bd: "#dbe3ea", tx: "#4d6076" },
};

function Pill({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  const c = TONE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        background: c.bg,
        border: "1px solid " + c.bd,
        color: c.tx,
        borderRadius: 4,
        padding: "0px 5px",
        flex: "none",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </span>
  );
}

export const NotificationTimeFooter = observer(function NotificationTimeFooter(props: TNotificationTimeFooter) {
  const { workspaceSlug, projectId, issueId } = props;
  const zh = useZh();
  const s = useIssueAIState(workspaceSlug, projectId, issueId);
  if (!s) return null;

  const alert = topAlert(s, zh); // 逾期/停滞（赤 or 琥珀）— 看板と同口径
  const waiting = s.ball === "OTHER";
  const wv = waiting ? ballView(s, zh) : null; // 球在対方 → slate ラベル

  if (!alert && !wv) return null;

  // 「已等 N 天」は alert(=停滞 N 天)と重複表示しない。alert 無し・待ち・停滞日>0 の時だけ付す。
  const waitDays = !alert && wv && s.stale_days > 0 ? s.stale_days : 0;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {alert && <Pill tone={alert.tone}>{alert.text}</Pill>}
      {wv && (
        <Pill tone="slate">
          {wv.label}
          {waitDays > 0 && (zh ? ` · 已等 ${waitDays} 天` : ` · ${waitDays}日待ち`)}
        </Pill>
      )}
    </div>
  );
});
