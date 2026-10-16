/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { SearchIcon } from "@plane/propel/icons";
// hooks
import { usePowerK } from "@/hooks/store/use-power-k";

// BARSOUL 2026-10-08 (hechun「搜索功能好好做 / 全屏浮层」): 顶栏不再内嵌命令下拉,
// 只是一个「看起来像输入框」的按钮, 点了打开全屏搜索浮层(与 ⌘K 同一个;
// 原命令面板在浮层里输入 `>` 进入)。旧实现备份见 git 历史。
export const TopNavPowerK = observer(() => {
  const { toggleSearchOverlay } = usePowerK();
  const { t } = useTranslation();

  return (
    // BARSOUL 2026-08: md 未満では縮められるように(右のアクション群を画面外に押し出さない)。
    <div className="relative min-w-0 flex-1 md:flex-none">
      <button
        type="button"
        onClick={() => toggleSearchOverlay(true)}
        className="flex h-7 w-full items-center rounded-lg border border-subtle-1 bg-layer-2 p-2 text-left transition-colors duration-200 hover:bg-layer-1 md:w-[364px]"
      >
        <SearchIcon className="mr-2 size-3.5 shrink-0 text-placeholder" />
        <span className="min-w-0 flex-1 truncate text-13 text-placeholder">{t("search_overlay.top_placeholder")}</span>
      </button>
    </div>
  );
});
