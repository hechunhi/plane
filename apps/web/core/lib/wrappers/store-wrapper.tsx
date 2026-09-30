/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useTheme } from "next-themes";
import type { TLanguage } from "@plane/i18n";
import { useTranslation } from "@plane/i18n";
// helpers
import { applyCustomTheme, clearCustomTheme } from "@plane/utils";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useRouterParams } from "@/hooks/store/use-router-params";
import { useUserProfile } from "@/hooks/store/user";
import { isLaptopViewport, useLaptopViewport } from "@/hooks/use-tight-viewport";
import { SIDEBAR_COLLAPSED_KEY, SIDEBAR_COLLAPSED_LAPTOP_KEY } from "@/store/theme.store";

type TStoreWrapper = {
  children: ReactNode;
};

function StoreWrapper(props: TStoreWrapper) {
  const { children } = props;
  // theme
  const { setTheme } = useTheme();
  // router
  const params = useParams();
  // store hooks
  const { setQuery } = useRouterParams();
  const { sidebarCollapsed, toggleSidebar } = useAppTheme();
  const isLaptop = useLaptopViewport();
  const prevIsLaptopRef = useRef<boolean | null>(null);
  const { data: userProfile } = useUserProfile();
  const { changeLanguage } = useTranslation();

  // Track if we've initialized theme from server (one-time only)
  const hasInitializedThemeRef = useRef(false);
  // Track current user to reset on logout/login
  const currentUserIdRef = useRef<string | undefined>(undefined);
  // Track previous theme to detect transitions from custom theme
  const previousThemeRef = useRef<string | undefined>(undefined);

  /**
   * Sidebar collapsed fetching from local storage
   */
  useEffect(() => {
    // BARSOUL 2026-09: ノート PC 幅(768〜1599px)は別キーで覚え、未設定なら畳む。
    // hook の値は「区分が変わったら再実行する」ためだけに deps に入れ、判定は実際の
    // matchMedia で行う(hydration 直後の 1 回目は hook が false を返すため)。
    const laptopNow = isLaptopViewport();
    const prev = prevIsLaptopRef.current;
    prevIsLaptopRef.current = laptopNow;
    if (laptopNow) {
      if (prev === true) return; // 同じ区分の中での開閉はユーザ操作 = 触らない
      const laptopValue = localStorage && localStorage.getItem(SIDEBAR_COLLAPSED_LAPTOP_KEY);
      const want = laptopValue === null ? true : laptopValue === "true";
      if (sidebarCollapsed !== want) toggleSidebar(want);
      return;
    }
    if (prev === true) {
      // ノート PC 幅 → 広い画面へ戻った(ウィンドウを広げた等): 広い画面側の保存値に戻す
      const want = localStorage && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
      if (sidebarCollapsed !== want) toggleSidebar(want);
      return;
    }
    // 以下は従来どおり(大画面・モバイル)
    const localValue = localStorage && localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    const localBoolValue = localValue ? (localValue === "true" ? true : false) : false;
    if (localValue && sidebarCollapsed === undefined) toggleSidebar(localBoolValue);
  }, [isLaptop, sidebarCollapsed, setTheme, toggleSidebar]);

  /**
   * Effect 1: Initial theme sync from server (one-time only)
   *
   * This effect runs ONCE per user session to load theme from server.
   * After initial load, all theme changes are localStorage-driven (next-themes).
   * This prevents a feedback loop where server updates trigger UI updates in a cycle.
   */
  useEffect(() => {
    const userId = userProfile?.id;

    // Reset initialization flag when user changes (logout/login)
    // This handles both logout (userId becomes undefined) and login (userId changes)
    if (userId !== currentUserIdRef.current) {
      hasInitializedThemeRef.current = false;
      previousThemeRef.current = undefined;
      currentUserIdRef.current = userId;
    }

    // Only initialize theme from server on FIRST load for this user
    if (!userProfile?.theme?.theme || hasInitializedThemeRef.current) {
      return; // Skip if already initialized or no profile data
    }

    // Apply theme from server profile (one-time only)
    setTheme(userProfile?.theme?.theme || "system");

    // Mark as initialized - prevents future syncs from server
    hasInitializedThemeRef.current = true;
  }, [userProfile?.theme?.theme, setTheme]);

  /**
   * Effect 2: Custom theme CSS application (runs on every change)
   *
   * This effect applies or clears custom theme CSS variables whenever
   * the theme changes. It runs independently of the initial sync effect.
   */
  useEffect(() => {
    if (!userProfile?.theme?.theme) return;

    const currentTheme = userProfile?.theme?.theme;
    const previousTheme = previousThemeRef.current;
    const themeData = userProfile?.theme;

    // Apply custom theme if current theme is custom
    if (currentTheme === "custom" && themeData.primary && themeData.background && themeData.darkPalette !== undefined) {
      applyCustomTheme(themeData.primary, themeData.background, themeData.darkPalette ? "dark" : "light");
    }
    // Clear custom theme CSS when switching away from custom
    else if (previousTheme === "custom" && currentTheme !== "custom") {
      clearCustomTheme();
      // No reload needed - let CSS cascade handle it naturally
    }

    // Update previous theme for next comparison
    previousThemeRef.current = currentTheme;
  }, [userProfile?.theme]);

  useEffect(() => {
    if (!userProfile?.language) return;
    changeLanguage(userProfile?.language as TLanguage);
  }, [userProfile?.language, changeLanguage]);

  useEffect(() => {
    if (!params) return;
    setQuery(params);
  }, [params, setQuery]);

  return <>{children}</>;
}

export default observer(StoreWrapper);
