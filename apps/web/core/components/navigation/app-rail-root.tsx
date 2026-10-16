/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

"use client";
import { observer } from "mobx-react";
import { useParams, usePathname } from "next/navigation";
import { SettingsIcon } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { ContextMenu } from "@plane/propel/context-menu";
import { CheckIcon } from "@plane/propel/icons";
import { cn } from "@plane/utils";
// components
import { AppSidebarItem } from "@/components/sidebar/sidebar-item";
// hooks
import { useAppRailPreferences } from "@/hooks/use-navigation-preferences";
import { useAppRailVisibility } from "@/lib/app-rail/context";
// local imports
import { AppSidebarItemsRoot } from "./items-root";

export const AppRailRoot = observer(() => {
  // router
  const { workspaceSlug, projectId } = useParams();
  const pathname = usePathname();
  // preferences
  const { preferences, updateDisplayMode } = useAppRailPreferences();
  const { isCollapsed, toggleAppRail } = useAppRailVisibility();
  const { t, currentLocale } = useTranslation();
  const zh = (currentLocale || "").toLowerCase().startsWith("zh");
  const ja = (currentLocale || "").toLowerCase().startsWith("ja");
  const tx = (en: string, jaS: string, zhS: string) => (zh ? zhS : ja ? jaS : en);
  // derived values
  const isWorkspaceSettingsPath = pathname.includes(`/${workspaceSlug}/settings`) && !projectId;
  const showLabel = preferences.displayMode === "icon_with_label";
  const railWidth = showLabel ? "4.25rem" : "3rem";

  return (
    <div
      className="z-[26] h-full flex-shrink-0 bg-canvas transition-all duration-300 ease-in-out"
      style={{
        width: railWidth,
        display: "block",
      }}
    >
      <ContextMenu>
        <ContextMenu.Trigger className="h-full">
          <div className="flex h-full flex-col justify-between gap-4 px-2 py-3">
            <div
              className={cn("flex flex-col", {
                "gap-4": showLabel,
                "gap-3": !showLabel,
              })}
            >
              <AppSidebarItemsRoot showLabel={showLabel} />
              <div className="mx-2 border-t border-strong" />
              <AppSidebarItem
                item={{
                  label: t("settings"),
                  icon: <SettingsIcon className="size-5" />,
                  href: `/${workspaceSlug}/settings`,
                  isActive: isWorkspaceSettingsPath,
                  showLabel,
                }}
              />
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content positionerClassName="z-30" className="outline-none">
            <ContextMenu.Item onClick={() => updateDisplayMode("icon_only")}>
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-11">{tx("Icon only", "アイコンのみ", "仅图标")}</span>
                {preferences.displayMode === "icon_only" && <CheckIcon className="size-3.5" />}
              </div>
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => updateDisplayMode("icon_with_label")}>
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-11">{tx("Icon with name", "アイコン＋名前", "图标＋名称")}</span>
                {preferences.displayMode === "icon_with_label" && <CheckIcon className="size-3.5" />}
              </div>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={toggleAppRail}>
              <span className="text-11">
                {isCollapsed
                  ? tx("Dock App Rail", "レールを表示", "显示导航栏")
                  : tx("Undock App Rail", "レールを隠す", "隐藏导航栏")}
              </span>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    </div>
  );
});
