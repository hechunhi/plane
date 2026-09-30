/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useSyncExternalStore } from "react";

/**
 * BARSOUL 2026-09 — ノート PC 向けの「横が足りない / 縦が足りない」判定の唯一の窓口.
 *
 * CSS 側の `laptop:` / `short:` バリアント(packages/tailwind-config/variables.css)と
 * 同じ境界を matchMedia で見る。大画面(4K@1x ≈ 2280×1750 など)はどちらにも入らない
 * ので、ここを条件にした分岐は大画面の見た目・挙動を一切変えない。
 *
 *   laptop … 768〜1599px 幅。サイドバー既定折り畳み・ラベル短縮など「横」の節約。
 *   short  … 768px 以上かつ高さ 879px 以下。ヘッダ 2 段 → 1 段など「縦」の節約。
 *
 * モバイル(< 768px)は use-compact-viewport.ts の担当で、ここでは常に false。
 */
export const LAPTOP_QUERY = "(min-width: 768px) and (max-width: 1599px)";
export const SHORT_QUERY = "(min-width: 768px) and (max-height: 879px)";

const matches = (query: string): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;

/** React 外(MobX store など)から今の状態を読むとき用。 */
export const isLaptopViewport = (): boolean => matches(LAPTOP_QUERY);

const useMediaQuery = (query: string): boolean =>
  useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => matches(query),
    () => false
  );

export const useLaptopViewport = (): boolean => useMediaQuery(LAPTOP_QUERY);
export const useShortViewport = (): boolean => useMediaQuery(SHORT_QUERY);
