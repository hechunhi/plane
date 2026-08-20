/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";

/**
 * BARSOUL 2026-08 — 「狭い画面か?」を JS 側でも判定するための唯一の窓口.
 *
 * Tailwind の `md` (768px) と同じ境界を matchMedia で見る。CSS 側の `max-md:` と
 * 必ず同じタイミングで切り替わるので、「CSS では隠れているのに JS 側はまだ広い画面
 * だと思っている」というズレが起きない。
 *
 * usePlatformOS().isMobile は UA 判定なので「iPhone かどうか」しか分からず、
 * PC でウィンドウを細くした場合に効かない。レイアウトの分岐にはこちらを使う。
 */
const COMPACT_QUERY = "(max-width: 767px)";

export const useCompactViewport = (): boolean => {
  const [isCompact, setIsCompact] = useState<boolean>(() =>
    typeof window === "undefined" ? false : window.matchMedia(COMPACT_QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(COMPACT_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsCompact(event.matches);
    setIsCompact(mql.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return isCompact;
};
