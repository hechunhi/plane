/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { CalendarDays, ListChecks, ListTodo } from "lucide-react";
import {
  AnalyticsIcon,
  ArchiveIcon,
  CycleIcon,
  HomeIcon,
  InboxIcon,
  MultipleStickyIcon,
  ProjectIcon,
  ViewsIcon,
  YourWorkIcon,
} from "@plane/propel/icons";
import { cn } from "@plane/utils";

export const getSidebarNavigationItemIcon = (key: string, className: string = "") => {
  switch (key) {
    case "home":
      return <HomeIcon className={cn("size-4 flex-shrink-0", className)} />;
    case "inbox":
      return <InboxIcon className={cn("size-4 flex-shrink-0", className)} />;
    case "projects":
      return <ProjectIcon className={cn("size-4 flex-shrink-0", className)} />;
    case "views":
      return <ViewsIcon className={cn("size-4 flex-shrink-0", className)} />;
    case "active_cycles":
      return <CycleIcon className={cn("size-4 flex-shrink-0", className)} />;
    case "analytics":
      return <AnalyticsIcon className={cn("size-4 flex-shrink-0", className)} />;
    case "your_work":
      return <YourWorkIcon className={cn("size-4 flex-shrink-0", className)} />;
    // BARSOUL 2026-08: 下書き一覧は「個人の ToDo」になったので、
    // 鉛筆(下書き)ではなくチェックリストの絵にする。
    // my-work の ListChecks とは別の字形(ListTodo)を選び、下部タブで並んでも見分けが付くようにする。
    case "drafts":
      return <ListTodo className={cn("size-4 flex-shrink-0", className)} />;
    case "archives":
      return <ArchiveIcon className={cn("size-4 flex-shrink-0", className)} />;
    case "stickies":
      return <MultipleStickyIcon className={cn("size-4 flex-shrink-0", className)} />;
    // BARSOUL BS-216 Path A:「我的工作」= 跨项目 DIS 决策队列(每日打开的个人工作入口)
    case "my-work":
      return <ListChecks className={cn("size-4 flex-shrink-0", className)} />;
    // BARSOUL 週次ミーティング支援:会期ごとの週報 + 出処 + 確定版
    case "weekly":
      return <CalendarDays className={cn("size-4 flex-shrink-0", className)} />;
  }
};
