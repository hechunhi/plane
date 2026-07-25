/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
// plane helpers
import { useOutsideClickDetector } from "@plane/hooks";
import { PreferencesIcon } from "@plane/propel/icons";
import { ScrollArea } from "@plane/propel/scrollarea";
// components
import { CustomizeNavigationDialog } from "@/components/navigation/customize-navigation-dialog";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import useSize from "@/hooks/use-window-size";
// plane web components
import { WorkspaceEditionBadge } from "@/plane-web/components/workspace/edition-badge";
import { AppSidebarToggleButton } from "./sidebar-toggle-button";
import { IconButton } from "@plane/propel/icon-button";

type TSidebarWrapperProps = {
  title: string;
  children: React.ReactNode;
  quickActions?: React.ReactNode;
};

export const SidebarWrapper = observer(function SidebarWrapper(props: TSidebarWrapperProps) {
  const { title, children, quickActions } = props;
  // state
  const [isCustomizeNavDialogOpen, setIsCustomizeNavDialogOpen] = useState(false);
  // store hooks
  const { toggleSidebar, sidebarCollapsed } = useAppTheme();
  const windowSize = useSize();
  // refs
  const ref = useRef<HTMLDivElement>(null);

  useOutsideClickDetector(ref, () => {
    if (sidebarCollapsed === false && window.innerWidth < 768) {
      toggleSidebar();
    }
  });

  useEffect(() => {
    if (windowSize[0] < 768 && !sidebarCollapsed) toggleSidebar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowSize]);

  return (
    <>
      <CustomizeNavigationDialog isOpen={isCustomizeNavDialogOpen} onClose={() => setIsCustomizeNavDialogOpen(false)} />
      <div ref={ref} className="flex h-full w-full animate-fade-in flex-col">
        <div className="flex flex-col gap-3 px-3">
          {/* Workspace switcher and settings */}

          <div className="flex items-center justify-between gap-2 px-2">
            <span className="pt-1 text-16 font-medium text-primary">{title}</span>
            <div className="flex items-center gap-2">
              {title === "Projects" && (
                <IconButton
                  size="base"
                  variant="ghost"
                  icon={PreferencesIcon}
                  onClick={() => setIsCustomizeNavDialogOpen(true)}
                />
              )}
              <AppSidebarToggleButton />
            </div>
          </div>
          {/* Quick actions */}
          {quickActions}
        </div>

        {/* この列は flex-col。ここに h-full(size-full)を置くと flex item の既定 min-height:auto と
            組み合わさって「中身より縮めない」ブロックになり、列が親を溢れて下の h-12 フッターを押し出し、
            スクローラー自身も高さが決まらないので伸び続ける(= サイドバーが他の UI に浮いて見える)。
            overflow-y-auto を足しても直らない。効くのは min-h-0 + flex-1 の方。
            実際のスクロールは base-ui の Viewport が持つので、Root に overflow は不要。 */}
        <ScrollArea
          orientation="vertical"
          scrollType="hover"
          size="sm"
          rootClassName="min-h-0 w-full flex-1 overflow-hidden"
          viewportClassName="flex flex-col gap-3 overflow-x-hidden px-3 pt-3 pb-0.5"
        >
          {children}
        </ScrollArea>
        {/* Help Section */}
        <div className="flex h-12 items-center justify-between border-t border-subtle bg-surface-1 p-3">
          <WorkspaceEditionBadge />
          {/* TODO: To be checked if we need this */}
          {/* <div className="flex items-center gap-2">
          {!shouldRenderAppRail && <HelpMenu />}
          {!isAppRailEnabled && <AppSidebarToggleButton />}
        </div> */}
        </div>
      </div>
    </>
  );
});
