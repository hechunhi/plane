/**
 * BARSOUL(2026-07-26 hechun): 優先度の生値 → 表示ラベル。
 *
 * 活動系の文面は DB の生値（none/urgent/high/medium/low）をそのまま出していたので、
 * UI が中文/日本語でも値だけ英語（"将优先级设置为 medium"）になっていた。
 * 共通キーは 4 ロケール全部に既にあるので、載せ替えるだけで良い。
 *
 * ここに置く理由: 通知カードと活動フィードの両方から使うが、通知カード側は
 * エディタまで引き込む重いモジュールなので、そちらから import させたくない。
 */
import type { TTranslationStore } from "@plane/i18n";

const PRIORITY_KEYS = ["none", "urgent", "high", "medium", "low"];

export const translatePriority = (value: string | undefined, t: TTranslationStore["t"]) =>
  value && PRIORITY_KEYS.includes(value) ? t(value) : value;
