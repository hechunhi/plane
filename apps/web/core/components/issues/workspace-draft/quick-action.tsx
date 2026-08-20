/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
// ui
import type { TContextMenuItem } from "@plane/ui";
import { ContextMenu, CustomMenu } from "@plane/ui";
// helpers
import { cn } from "@plane/utils";

export interface Props {
  parentRef: React.RefObject<HTMLElement>;
  MENU_ITEMS: TContextMenuItem[];
}

export const WorkspaceDraftIssueQuickActions = observer(function WorkspaceDraftIssueQuickActions(props: Props) {
  const { parentRef, MENU_ITEMS } = props;

  const { t } = useTranslation();

  // ContextMenu(右クリック側)は title をそのまま出す。ここが鍵のままだと
  // 右クリックの時だけ `make_a_copy` のような生の文字列が並ぶ。訳を先に当てて、
  // 両方の menu に同じ文言を渡す。
  // shouldRender は ContextMenu 側だけが見ている。ここで先に落としておかないと、
  // 「…」の方にだけ出るはずの無い項目が並ぶ。
  const translatedItems = MENU_ITEMS.filter((item) => item.shouldRender !== false).map((item) => ({
    ...item,
    title: t(item.title || ""),
  }));

  return (
    <>
      <ContextMenu parentRef={parentRef} items={translatedItems} />
      <CustomMenu
        ellipsis
        placement="bottom-end"
        menuItemsClassName="z-[14]"
        maxHeight="lg"
        useCaptureForOutsideClick
        closeOnSelect
      >
        {translatedItems.map((item) => (
          <CustomMenu.MenuItem
            key={item.key}
            onClick={() => {
              item.action();
            }}
            className={cn(
              "flex items-center gap-2",
              {
                "text-placeholder": item.disabled,
              },
              item.className
            )}
            disabled={item.disabled}
          >
            {item.icon && <item.icon className={cn("h-3 w-3", item.iconClassName)} />}
            <div>
              <h5>{item.title}</h5>
              {item.description && (
                <p
                  className={cn("whitespace-pre-line text-tertiary", {
                    "text-placeholder": item.disabled,
                  })}
                >
                  {item.description}
                </p>
              )}
            </div>
          </CustomMenu.MenuItem>
        ))}
      </CustomMenu>
    </>
  );
});
