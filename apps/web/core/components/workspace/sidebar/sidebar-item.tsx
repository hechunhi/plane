/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
// plane imports
import type { IWorkspaceSidebarNavigationItem } from "@plane/constants";
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { joinUrlPath } from "@plane/utils";
// components
import { SidebarNavItem } from "@/components/sidebar/sidebar-navigation";
import { NotificationAppSidebarOption } from "@/components/workspace-notifications/notification-app-sidebar-option";
// hooks
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useWorkspaceNavigationPreferences } from "@/hooks/use-navigation-preferences";
import { useCloseSidebarOnNavigate } from "@/hooks/use-sidebar-navigation-close";
// plane web imports
import { getSidebarNavigationItemIcon } from "@/plane-web/components/workspace/sidebar/helper";

type Props = {
  item: IWorkspaceSidebarNavigationItem;
  additionalRender?: (itemKey: string, workspaceSlug: string) => ReactNode;
  additionalStaticItems?: string[];
};

export const SidebarItemBase = observer(function SidebarItemBase({
  item,
  additionalRender,
  additionalStaticItems,
}: Props) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { workspaceSlug } = useParams();
  const { allowPermissions } = useUserPermissions();
  const { isWorkspaceItemPinned } = useWorkspaceNavigationPreferences();
  const { data } = useUser();

  // BARSOUL 2026-08: モバイルのメニュー自動クローズは全入口で同じ 1 本を使う。
  const handleLinkClick = useCloseSidebarOnNavigate();

  const staticItems = [
    "home",
    "my-work", // BARSOUL BS-216 Path A:常显个人工作入口(不走 pin/preference 门控)
    "weekly", // BARSOUL 週次ミーティング支援:同じく常显
    "pi_chat",
    "projects",
    "your_work",
    "stickies",
    "drafts",
    ...(additionalStaticItems || []),
  ];
  const slug = workspaceSlug?.toString() || "";

  if (!allowPermissions(item.access, EUserPermissionsLevel.WORKSPACE, slug)) return null;

  const isPinned = isWorkspaceItemPinned(item.key);
  if (!isPinned && !staticItems.includes(item.key)) return null;

  const itemHref =
    item.key === "your_work" && data?.id ? joinUrlPath(slug, item.href, data?.id) : joinUrlPath(slug, item.href);
  const icon = getSidebarNavigationItemIcon(item.key);

  return (
    <Link href={itemHref} onClick={handleLinkClick}>
      <SidebarNavItem isActive={item.highlight(pathname, itemHref)}>
        <div className="flex items-center gap-1.5 py-[1px]">
          {icon}
          <p className="text-13 leading-5 font-medium">{t(item.labelTranslationKey)}</p>
        </div>
        {/* BARSOUL(2026-07-26): 「我的工作」は通知センターの流し + レンズなので、
            未読はこの入口に出す。今まで未読表示はヘッダ右上の Inbox アイコンだけで、
            常時見えているサイドバーの入口側は無印 = 開くまで気付けなかった。 */}
        {item.key === "my-work" && <NotificationAppSidebarOption workspaceSlug={slug} />}
        {additionalRender?.(item.key, slug)}
      </SidebarNavItem>
    </Link>
  );
});
