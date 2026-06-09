/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

"use client";

/* eslint-disable jsx-a11y/no-autofocus -- 表情弹层由用户主动点开,自动聚焦搜索框是预期 UX(非页面加载 autofocus) */
import Picker from "@emoji-mart/react";
import { detectEmojiTheme, getEmojiMartI18n } from "./emoji-i18n";

type EmojiRootProps = {
  onChange: (value: string) => void;
  searchPlaceholder?: string;
  searchDisabled?: boolean;
  /** BARSOUL: 显式主题上书き(未指定なら data-theme から実行時探知)。 */
  theme?: "light" | "dark";
};

/**
 * BARSOUL 2026-06-07 (hechun): 全站统一 emoji 选择器**内核**。frimousse → emoji-mart。
 *
 * 一处改、13 处全升级(reaction picker + icon/logo picker 都渲染本组件)。内置:
 * 最近使用 / 底部分类导航 / 搜索 / 肤色 / 暗色 / 多语言 chrome —— 成熟、不自维护数据集。
 *
 * 关键约束(全部保持):
 *  - `onChange(emojiChar)` 契约不变(`emoji.native` = 字符)→ 下游 `emojiToString` 管线
 *    与全部 caller **零改动**。
 *  - 数据集 `data={async () => import(...)}` **懒加载** → 独立 async chunk(~1.6MB JSON
 *    不进主包),只在首次打开时拉取。
 *  - `i18n` **完整自带**(en/ja/zh)→ 绝不触发 emoji-mart 的 CDN(jsdelivr)拉取,纯本地。
 *  - 主题/语言运行时探知(data-theme / userLanguage),caller 不必逐个传。
 */
export function EmojiRoot(props: EmojiRootProps) {
  const { onChange, searchPlaceholder, searchDisabled = false, theme } = props;

  return (
    <Picker
      data={async () => (await import("@emoji-mart/data")).default}
      onEmojiSelect={(emoji: { native?: string }) => {
        if (emoji?.native) onChange(emoji.native);
      }}
      theme={detectEmojiTheme(theme)}
      i18n={getEmojiMartI18n(searchPlaceholder)}
      set="native"
      navPosition="bottom"
      previewPosition="none"
      skinTonePosition="search"
      searchPosition={searchDisabled ? "none" : "sticky"}
      maxFrequentRows={2}
      dynamicWidth
      autoFocus
    />
  );
}
