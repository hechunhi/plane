/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * BARSOUL 2026-06-07 (hechun): emoji-mart の chrome 多言語文字列 + 実行時 locale/theme 探知。
 *
 * - **完全な i18n オブジェクトを渡す**ことで emoji-mart の CDN(jsdelivr)i18n フェッチを抑止
 *   → 社内自前運用・オフライン前提、外部依存ゼロ。
 * - 訳すのは **chrome のみ**(分類名 /「最近使用」/ 肌色ラベル / プレースホルダ)。
 *   絵文字の **検索キーワードは英語のまま**(@emoji-mart/data 由来、旧 frimousse と同制約)。
 * - locale は Plane i18n store が持続する `localStorage["userLanguage"]`(+ `<html lang>`)から探知。
 * - theme は Plane CSS と同源の `data-theme`(含 "dark")属性から探知。
 */

export type EmojiMartI18n = {
  search: string;
  search_no_results_1: string;
  search_no_results_2: string;
  pick: string;
  add_custom: string;
  categories: Record<string, string>;
  skins: Record<string, string>;
};

const EN: EmojiMartI18n = {
  search: "Search",
  search_no_results_1: "Oh no!",
  search_no_results_2: "That emoji couldn’t be found",
  pick: "Pick an emoji…",
  add_custom: "Add custom emoji",
  categories: {
    activity: "Activity",
    custom: "Custom",
    flags: "Flags",
    foods: "Food & Drink",
    frequent: "Frequently used",
    nature: "Animals & Nature",
    objects: "Objects",
    people: "Smileys & People",
    places: "Travel & Places",
    search: "Search Results",
    symbols: "Symbols",
  },
  skins: { 1: "Default", 2: "Light", 3: "Medium-Light", 4: "Medium", 5: "Medium-Dark", 6: "Dark", choose: "Choose default skin tone" },
};

const JA: EmojiMartI18n = {
  search: "検索",
  search_no_results_1: "見つかりません",
  search_no_results_2: "その絵文字は見つかりませんでした",
  pick: "絵文字を選択…",
  add_custom: "カスタム絵文字を追加",
  categories: {
    activity: "アクティビティ",
    custom: "カスタム",
    flags: "旗",
    foods: "食べ物・飲み物",
    frequent: "よく使う",
    nature: "動物・自然",
    objects: "物",
    people: "スマイリー・人",
    places: "旅行・場所",
    search: "検索結果",
    symbols: "記号",
  },
  skins: { 1: "デフォルト", 2: "明るい", 3: "やや明るい", 4: "中間", 5: "やや暗い", 6: "暗い", choose: "デフォルトの肌の色を選択" },
};

const ZH: EmojiMartI18n = {
  search: "搜索",
  search_no_results_1: "哎呀!",
  search_no_results_2: "找不到这个表情",
  pick: "选择一个表情…",
  add_custom: "添加自定义表情",
  categories: {
    activity: "活动",
    custom: "自定义",
    flags: "旗帜",
    foods: "食物与饮料",
    frequent: "最近使用",
    nature: "动物与自然",
    objects: "物品",
    people: "笑脸与人物",
    places: "旅行与地点",
    search: "搜索结果",
    symbols: "符号",
  },
  skins: { 1: "默认", 2: "浅", 3: "中浅", 4: "中等", 5: "中深", 6: "深", choose: "选择默认肤色" },
};

function detectPlaneLocale(): "en" | "ja" | "zh" {
  if (typeof window === "undefined") return "en";
  const raw = (window.localStorage.getItem("userLanguage") || document.documentElement.lang || "en").toLowerCase();
  if (raw.startsWith("ja")) return "ja";
  if (raw.startsWith("zh")) return "zh"; // zh-CN / zh-TW → 简体 zh(emoji-mart 无繁体；chrome 简体可接受)
  return "en";
}

/** 当前语言的 emoji-mart i18n(完整对象 → 不触发 CDN)。search 用 caller 已本地化的占位符覆盖。 */
export function getEmojiMartI18n(searchPlaceholder?: string): EmojiMartI18n {
  const base = { en: EN, ja: JA, zh: ZH }[detectPlaneLocale()];
  return searchPlaceholder ? { ...base, search: searchPlaceholder } : base;
}

/** 主题探知:显式 prop 优先,否则读 Plane 的 data-theme(含 "dark")。 */
export function detectEmojiTheme(explicit?: "light" | "dark"): "light" | "dark" {
  if (explicit) return explicit;
  if (typeof document !== "undefined") {
    const dt = document.documentElement.getAttribute("data-theme") ?? "";
    if (dt.includes("dark")) return "dark";
  }
  return "light";
}
