/**
 * BARSOUL ADR-029 続: pending_approver の卡片タイトルを
 * 「原題 ⇄ 🔔 待你审批 / あなたの審査待ち」で穏やかに交互フェード.
 *
 * 設計原則(top-tier UX team):
 * - frequency 抑制: 10s 周期(注意疲労の閾値 ~5-6s より長く取り「偶然見える」程度).
 * - layout 不変: 両 span を absolute 同位置 stacking → 高さ/幅変動なし.
 * - SR 配慮: 原題のみが SR 可読; 提醒は aria-hidden.
 * - prefers-reduced-motion: 完全停止. 動画 off では提醒を隠し既存
 *   赤左バー(list/kanban block) + 詳細 frozen-banner で代替提示.
 * - 非該当時(queued/initiator/bystander)は wrapper 自体不挿入 → DOM 不変.
 *
 * CSS keyframes は globals.css (.barsoul-approver-title__*).
 * 利用箇所: list/block.tsx, kanban/block.tsx の <span>{issue.name}</span> 位置.
 */
import { memo } from "react";

type Props = {
  title: string;
  /** pending_approver 視点で true にする(他の役割は false → 静的). */
  active: boolean;
};

export const ApproverTitle = memo(function ApproverTitle({ title, active }: Props) {
  if (!active) return <>{title}</>;
  return (
    <span className="relative inline-block w-full min-w-0 align-baseline">
      <span className="barsoul-approver-title__orig block truncate">{title}</span>
      <span
        className="barsoul-approver-title__remind absolute inset-0 block truncate text-danger-primary"
        aria-hidden="true"
      >
        🔔 待你审批 / あなたの審査待ち
      </span>
    </span>
  );
});
