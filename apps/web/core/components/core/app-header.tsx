/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
// plane imports
import { Row } from "@plane/ui";
// components
import { cn } from "@plane/utils";
import { ExtendedAppHeader } from "@/plane-web/components/common/extended-app-header";

export interface AppHeaderProps {
  header: ReactNode;
  mobileHeader?: ReactNode;
  className?: string;
  rowClassName?: string;
}

export const AppHeader = observer(function AppHeader(props: AppHeaderProps) {
  const { header, mobileHeader, className, rowClassName } = props;

  return (
    <div className={cn("z-[18]", className)}>
      <Row className={cn("flex h-11 w-full items-center gap-2 border-b border-subtle bg-surface-1", rowClassName)}>
        <ExtendedAppHeader header={header} />
        {/* BARSOUL 2026-08: モバイル専用の操作列は、以前はこの行の**下に**もう 1 本の
            バーとして積まれていた。390px では 上部だけで 4 段(グローバル 40 + プロジェクト
            タブ 44 + この行 44 + 操作列 41 = 約 170px / 844px)を食っていて、本文が
            開いた瞬間に見えない。行を増やさず**この行の右側に畳み込む**ことで 41px 戻す。
            パンくずは min-w-0 で先に縮む = 「狭い画面では説明より操作を優先する」。 */}
        {mobileHeader}
      </Row>
    </div>
  );
});

/**
 * BARSOUL 2026-08 — `mobileHeader` に渡すバーの見た目はここに集約する。
 * 以前は各ルートが `flex justify-evenly border-b … py-2` と全幅バーを自前で書いていたが、
 * 今は AppHeader の行の中に畳み込むので、全幅・境界線・縦 padding は全部不要。
 */
export const MOBILE_HEADER_INLINE_CLASS = "flex shrink-0 items-center gap-0.5 md:hidden";

/** インライン化した操作 1 つぶん。タップ幅(32px)を確保しつつ枠線は持たない。 */
export const MOBILE_HEADER_ITEM_CLASS =
  "flex h-8 items-center rounded-md px-1.5 text-13 whitespace-nowrap text-secondary";
