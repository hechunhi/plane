/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Outlet } from "react-router";
// plane imports
import { Header, Row } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { TabNavigationRoot } from "@/components/navigation/tab-navigation-root";
import { MOBILE_CHROME_CLASS, useMobileChromeRef } from "@/components/navigation/mobile-chrome";
import { ProjectHeaderSlotContext } from "@/components/navigation/project-header-slot";
import { AppSidebarToggleButton } from "@/components/sidebar/sidebar-toggle-button";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useProjectNavigationPreferences } from "@/hooks/use-navigation-preferences";
// layouts
import { ProjectAuthWrapper } from "@/layouts/auth-layout/project-wrapper";
// local imports
import type { Route } from "./+types/layout";

function ProjectLayout({ params }: Route.ComponentProps) {
  // router
  const { workspaceSlug, projectId } = params;
  // store hooks
  const { sidebarCollapsed } = useAppTheme();
  // preferences
  const { preferences: projectPreferences } = useProjectNavigationPreferences();
  // BARSOUL 2026-09: スマホでは下スクロールで畳まれる(mobile-chrome.tsx)
  const chromeRef = useMobileChromeRef<HTMLDivElement>();
  // BARSOUL 2026-09: 低い画面ではページ側の AppHeader 行をタブ行の右端へ portal して 1 段にする
  // (project-header-slot.tsx)。器は常に置くが、`short:` 以外では display:none。
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);

  return (
    <>
      {projectPreferences.navigationMode === "TABBED" && (
        <div ref={chromeRef} data-edge="top" className={cn(MOBILE_CHROME_CLASS, "z-20")}>
          <Row className="flex h-header w-full items-center gap-2 border-b border-subtle bg-surface-1">
            <div className="flex h-full w-full items-center gap-2 divide-x divide-subtle">
              <div className="flex size-full flex-1 items-center gap-2 short:min-w-0">
                {sidebarCollapsed && (
                  <div className="shrink-0">
                    <AppSidebarToggleButton />
                  </div>
                )}
                <Header className={cn("h-full", { "pl-1.5": !sidebarCollapsed })}>
                  <Header.LeftItem className="flex h-full max-w-full items-center gap-2">
                    <TabNavigationRoot workspaceSlug={workspaceSlug} projectId={projectId} />
                  </Header.LeftItem>
                </Header>
              </div>
              <div
                ref={setHeaderSlot}
                data-project-header-slot=""
                className="hidden h-full flex-none items-center pl-2 short:flex"
              />
            </div>
          </Row>
        </div>
      )}
      <ProjectHeaderSlotContext.Provider value={projectPreferences.navigationMode === "TABBED" ? headerSlot : null}>
        <ProjectAuthWrapper workspaceSlug={workspaceSlug} projectId={projectId}>
          <Outlet />
        </ProjectAuthWrapper>
      </ProjectHeaderSlotContext.Provider>
    </>
  );
}

export default observer(ProjectLayout);
