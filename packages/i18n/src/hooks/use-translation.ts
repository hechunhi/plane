/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useContext, useMemo } from "react";
// context
import { TranslationContext } from "../context";
// types
import type { ILanguageOption, TLanguage } from "../types";

export type TTranslationStore = {
  t: (key: string, params?: Record<string, unknown>) => string;
  currentLocale: TLanguage;
  changeLanguage: (lng: TLanguage) => void;
  languages: ILanguageOption[];
};

/**
 * Provides the translation store to the application
 * @returns {TTranslationStore}
 * @returns {(key: string, params?: Record<string, any>) => string} t: method to translate the key with params
 * @returns {TLanguage} currentLocale - current locale language
 * @returns {(lng: TLanguage) => void} changeLanguage - method to change the language
 * @returns {ILanguageOption[]} languages - available languages
 * @throws {Error} if the TranslationProvider is not used
 */
export function useTranslation(): TTranslationStore {
  const store = useContext(TranslationContext);
  if (!store) {
    throw new Error("useTranslation must be used within a TranslationProvider");
  }

  // BARSOUL: 素の `store.t.bind(store)` は **毎 render 新しい関数**を返していた。
  // `useCallback(fn, [..., t])` / `useEffect(..., [t])` に t を入れた側は依存が
  // 毎フレーム変わり、fetch を撃つ effect だと**無限ループ**になる
  // (実害: /approvals が ai-approvals を撃ち続けた)。
  // store は Provider 内で 1 度だけ生成される安定インスタンスなので、
  // 「表示文言が変わり得るタイミング」= locale 切替 と 翻訳の遅延ロード完了
  // だけで作り直す。t の中身は毎回 store を読むため、identity を固定しても
  // 返る文字列は常に最新。
  const { currentLocale, isLoading } = store;
  return useMemo(
    () => ({
      t: store.t.bind(store),
      currentLocale: store.currentLocale,
      changeLanguage: (lng: TLanguage) => store.setLanguage(lng),
      languages: store.availableLanguages,
    }),
    [store, currentLocale, isLoading]
  );
}
