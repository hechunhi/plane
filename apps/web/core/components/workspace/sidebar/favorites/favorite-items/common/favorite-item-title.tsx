/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Tooltip } from "@plane/propel/tooltip";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { useCloseSidebarOnNavigate } from "@/hooks/use-sidebar-navigation-close";

type Props = {
  href: string;
  title: string;
  icon: React.ReactNode;
};

export const FavoriteItemTitle = observer(function FavoriteItemTitle(props: Props) {
  const { href, title, icon } = props;
  // store hooks
  const { isMobile } = usePlatformOS();
  // BARSOUL 2026-08: 以前は UA ベースの isMobile で判定していたため、
  // デスクトップの狭幅表示ではメニューが残っていた。ビューポート幅で統一する。
  const handleOnClick = useCloseSidebarOnNavigate();

  return (
    <Tooltip tooltipContent={title} isMobile={isMobile} position="right" className="ml-8">
      <Link href={href} className="flex w-full items-center gap-1.5 truncate" draggable onClick={handleOnClick}>
        <span className="flex size-5 items-center justify-center">{icon}</span>
        <span className="flex-1 truncate text-13 leading-5 font-medium">{title}</span>
      </Link>
    </Tooltip>
  );
});
