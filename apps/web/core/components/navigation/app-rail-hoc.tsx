/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// hoc/withDockItems.tsx
import React from "react";
import { observer } from "mobx-react";
import { useParams, usePathname } from "next/navigation";
import { Bell, CalendarDays, House, ListChecks } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { PlaneNewIcon } from "@plane/propel/icons";
import type { AppSidebarItemData } from "@/components/sidebar/sidebar-item";
import { useWorkspacePaths } from "@/hooks/use-workspace-paths";

const RAIL_LABELS = {
  ja: { home: "ホーム", myWork: "マイワーク", inbox: "通知", weekly: "週会", projects: "プロジェクト" },
  zh: { home: "首页", myWork: "我的工作", inbox: "通知", weekly: "周会", projects: "项目" },
  en: { home: "Home", myWork: "My work", inbox: "Inbox", weekly: "Weekly", projects: "Projects" },
} as const;

type WithDockItemsProps = {
  dockItems: (AppSidebarItemData & { shouldRender: boolean })[];
};

export function withDockItems<P extends WithDockItemsProps>(WrappedComponent: React.ComponentType<P>) {
  const ComponentWithDockItems = observer(function ComponentWithDockItems(props: Omit<P, keyof WithDockItemsProps>) {
    const { workspaceSlug } = useParams();
    const pathname = usePathname();
    const { currentLocale } = useTranslation();
    // レール幅に収まる短い名前(サイドバー/ページ見出しは従来の正式名のまま)。
    const lang = (currentLocale || "").toLowerCase().startsWith("zh")
      ? "zh"
      : (currentLocale || "").toLowerCase().startsWith("ja")
        ? "ja"
        : "en";
    const L = RAIL_LABELS[lang];
    const { isNotificationsPath } = useWorkspacePaths();
    // BARSOUL 2026-10: 毎日の入口をレールに集約(サイドバーは「プロジェクトの中身」専用に)。
    const base = `/${workspaceSlug}`;
    const isHome = pathname === `${base}/` || pathname === base;
    const isMyWork = pathname.includes(`${base}/my-work`);
    const isWeekly = pathname.includes(`${base}/weekly`);
    const isProjects = pathname.includes(`${base}/projects`);

    const dockItems: (AppSidebarItemData & { shouldRender: boolean })[] = [
      {
        label: L.home,
        icon: <House className="size-5" />,
        href: `${base}/`,
        isActive: isHome,
        shouldRender: true,
      },
      {
        label: L.myWork,
        icon: <ListChecks className="size-5" />,
        href: `${base}/my-work/`,
        isActive: isMyWork,
        shouldRender: true,
      },
      {
        label: L.inbox,
        icon: <Bell className="size-5" />,
        href: `${base}/notifications/`,
        isActive: isNotificationsPath,
        shouldRender: true,
      },
      {
        label: L.weekly,
        icon: <CalendarDays className="size-5" />,
        href: `${base}/weekly/`,
        isActive: isWeekly,
        shouldRender: true,
      },
      {
        label: L.projects,
        icon: <PlaneNewIcon className="size-5" />,
        href: `${base}/projects/`,
        isActive: isProjects,
        shouldRender: true,
      },
    ];

    return <WrappedComponent {...(props as P)} dockItems={dockItems} />;
  });

  return ComponentWithDockItems;
}
