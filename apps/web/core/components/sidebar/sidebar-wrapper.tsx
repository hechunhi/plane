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

  // BARSOUL 2026-08: 引数なしの toggleSidebar() は「反転」なので、意図が
  // 「閉じる」なら常に true を渡す(条件が増えた時に裏返るのを防ぐ)。
  useOutsideClickDetector(ref, () => {
    if (sidebarCollapsed === false && window.innerWidth < 768) {
      toggleSidebar(true);
    }
  });

  // BARSOUL 2026-08: 以前は windowSize(= [幅, 高さ])の変化そのものを依存にしていた。
  // iOS Safari / Android Chrome はスクロールで URL バーが出入りするだけで高さが変わり
  // resize が飛ぶため、「メニューを開いた直後に勝手に閉じる」状態になっていた。
  // 見るべきはブレークポイントを跨いだかどうかだけなので、真偽値を依存にする。
  const isMobileViewport = windowSize[0] < 768;
  useEffect(() => {
    if (isMobileViewport && !sidebarCollapsed) toggleSidebar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileViewport]);

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
        {/* BARSOUL 2026-08: iPhone のホームインジケータ帯でフッターが切れるのを防ぐ。 */}
        <div className="flex h-12 items-center justify-between border-t border-subtle bg-surface-1 p-3 max-md:h-auto max-md:min-h-12 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
