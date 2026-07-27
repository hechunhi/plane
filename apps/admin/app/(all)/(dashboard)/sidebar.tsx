/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { observer } from "mobx-react";
// plane helpers
import { useOutsideClickDetector } from "@plane/hooks";
// hooks
import { useTheme } from "@/hooks/store";
// components
import { AdminSidebarDropdown } from "./sidebar-dropdown";
import { AdminSidebarHelpSection } from "./sidebar-help-section";
import { AdminSidebarMenu } from "./sidebar-menu";

export const AdminSidebar = observer(function AdminSidebar() {
  // store
  const { isSidebarCollapsed, toggleSidebar } = useTheme();

  const ref = useRef<HTMLDivElement>(null);

  useOutsideClickDetector(ref, () => {
    if (isSidebarCollapsed === false) {
      if (window.innerWidth < 768) {
        toggleSidebar(!isSidebarCollapsed);
      }
    }
  });

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        toggleSidebar(true);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [toggleSidebar]);

  return (
    <div
      /* BARSOUL(2026-07-27): 断点排他。素の `fixed` + `md:relative` は危険 —
         拡張機能が挿す CSS(origin: injected)の `.fixed{position:fixed}` は
         ページ側の @layer utilities より強く、PC でも fixed のまま残って
         脇板が本体に重なる。`.fixed` 自体を出さない書き方にする。 */
      className={`relative z-20 flex h-full flex-shrink-0 flex-grow-0 flex-col border-r border-subtle bg-surface-1 duration-300 max-md:fixed max-md:inset-y-0 ${isSidebarCollapsed ? "-ml-[290px]" : ""} sm:${isSidebarCollapsed ? "-ml-[290px]" : ""} md:ml-0 ${isSidebarCollapsed ? "w-[70px]" : "w-[290px]"} lg:ml-0 ${isSidebarCollapsed ? "w-[70px]" : "w-[290px]"} `}
    >
      <div ref={ref} className="flex h-full w-full flex-1 flex-col">
        <AdminSidebarDropdown />
        <AdminSidebarMenu />
        <AdminSidebarHelpSection />
      </div>
    </div>
  );
});
