/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";

/**
 * モバイルでサイドバーがオーバーレイ表示になる閾値。
 * `sidebar-wrapper` のリサイズ監視・外側クリック検出と同じ 768px を使う。
 */
export const MOBILE_SIDEBAR_BREAKPOINT = 768;

/**
 * BARSOUL 2026-08 — 「ナビをタップ → 画面遷移したのにメニューが残る」の統一修正.
 *
 * これまで各サイドバー部品が `if (window.innerWidth < 768) toggleSidebar()` を
 * 個別にコピーしていて、`projects-list-item`(プロジェクト → BARSOUL)だけ
 * 実装が漏れていた。個別対応ではなく、遷移を伴う入口すべてがこの 1 本を呼ぶ。
 *
 * 引数なしの `toggleSidebar()` は「反転」なので、既に閉じている時に呼ぶと
 * 逆に開いてしまう。ここでは常に `toggleSidebar(true)`(= 明示的に閉じる)。
 *
 * 返る関数は「実際に画面遷移が起きる時だけ」呼ぶこと。
 * アコーディオンの開閉のように遷移しない操作で呼ぶと、メニューが勝手に閉じる。
 */
export const useCloseSidebarOnNavigate = () => {
  const {
    toggleSidebar,
    isExtendedSidebarOpened,
    toggleExtendedSidebar,
    isExtendedProjectSidebarOpened,
    toggleExtendedProjectSidebar,
  } = useAppTheme();

  return useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < MOBILE_SIDEBAR_BREAKPOINT) {
      toggleSidebar(true);
    }
    // 拡張(2 段目)パネルはデスクトップでも遷移後は畳む — 従来挙動を踏襲。
    if (isExtendedSidebarOpened) toggleExtendedSidebar(false);
    if (isExtendedProjectSidebarOpened) toggleExtendedProjectSidebar(false);
  }, [
    toggleSidebar,
    isExtendedSidebarOpened,
    toggleExtendedSidebar,
    isExtendedProjectSidebarOpened,
    toggleExtendedProjectSidebar,
  ]);
};
