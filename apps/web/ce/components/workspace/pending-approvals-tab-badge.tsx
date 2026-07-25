/**
 * BARSOUL ADR-029 続: 提案 D — ブラウザタブの title prefix と favicon に
 * 待批件数バッジ. Plane を裏タブで開いてる時でも気づける(顶栏 + banner は
 * 当該タブを見ないと無効, 提案 A の盲点を埋める).
 *
 * 2026-07-25: title/favicon への **書き込みは lib/tab-badge に一本化** した.
 *   会議チャットの未読も同じ面を使うため, 各々が MutationObserver で自分の
 *   prefix を守ると互いの prefix を積み続けて壊れる. ここは件数を register
 *   するだけ — 表示順(priority)は「対応必須の審批が左」の意図.
 * - 唯一マウント箇所: WorkspaceContentWrapper.
 */
"use client";
import { useEffect } from "react";
import { observer } from "mobx-react";
import { useMyPendingApprovals } from "@/hooks/use-my-pending-approvals";
import { registerTabBadge, unregisterTabBadge } from "@/lib/tab-badge";

const BADGE_KEY = "pending-approvals";

export const PendingApprovalsTabBadge = observer(function PendingApprovalsTabBadge() {
  const { pendingCount } = useMyPendingApprovals();

  useEffect(() => {
    registerTabBadge(BADGE_KEY, { priority: 10, glyph: "⚖️", count: pendingCount });
  }, [pendingCount]);

  useEffect(() => () => unregisterTabBadge(BADGE_KEY), []);

  return null;
});
