/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import { cn } from "@plane/utils";
import { AppRailRoot } from "@/components/navigation";
import { MobileBottomNav } from "@/components/navigation/mobile-bottom-nav";
import { WebPushBridge } from "@/components/web-push";
import { useAppRailVisibility } from "@/lib/app-rail";
// local imports
import { TopNavigationRoot } from "../navigations";
import { PendingApprovalsTabBadge } from "./pending-approvals-tab-badge";

export const WorkspaceContentWrapper = observer(function WorkspaceContentWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use the context to determine if app rail should render
  const { shouldRenderAppRail } = useAppRailVisibility();

  return (
    <div className="relative flex size-full flex-col overflow-hidden bg-canvas transition-all duration-300 ease-in-out">
      <TopNavigationRoot />
      <PendingApprovalsTabBadge />
      {/* BARSOUL 2026-08: Service Worker 登録 / 通知タップの遷移 / OS バッジ。描画なし */}
      <WebPushBridge />
      <div className="relative flex size-full overflow-hidden">
        {/* Conditionally render AppRailRoot based on context */}
        {shouldRenderAppRail && <AppRailRoot />}
        <div
          className={cn(
            // BARSOUL 2026-08 密度: この外枠の余白は内側の `px-page-x` に重ねて効くため、
            // 端末が狭いほど段階的に薄くする(モバイルは 0 = 画面幅を使い切る)。
            "relative size-full flex-grow overflow-hidden transition-all duration-300 ease-in-out",
            "px-0 pb-0 md:pr-1.5 md:pb-1.5 md:pl-1.5 2xl:pr-2 2xl:pb-2 2xl:pl-2",
            {
              "md:pl-0!": shouldRenderAppRail,
            }
          )}
        >
          {children}
        </div>
      </div>
      {/* BARSOUL 2026-08: スマホのみ下部タブバー(+ 作成 FAB)。フレックス列の最後の
          子として置くので position:fixed を使わず、本文を隠さない。 */}
      <MobileBottomNav />
    </div>
  );
});
