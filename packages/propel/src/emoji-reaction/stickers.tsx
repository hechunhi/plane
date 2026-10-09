/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * BARSOUL: 社内スタンプ(贴图)リアクション。
 *
 * - 保存値は `sticker:<id>`(comment_reactions.reaction は TextField なのでスキーマ変更なし)。
 *   絵文字の保存形式 "128077-65039" とは "-" 区切りの数値でない点で衝突しない。
 * - 縮略(チップ内)は「サムネ ⇄ 文字」を交互にクロスフェード:20px の写真だけだと潰れて
 *   読めないので、文字(実 HTML テキスト=どのサイズでも鮮明・ダーク対応)と交代で見せる。
 *   prefers-reduced-motion の人には文字だけ(動かさない)。
 * - ホバーで大図。画像は apps/web/public/stickers/(space も同一オリジンの /stickers/ を引く)。
 * - 追加 = 下の STICKERS に1行 + 画像2枚(thumb 96px 正方形 / 大図)を public/stickers に置くだけ。
 */

import * as React from "react";
import { cn } from "../utils";

export type TSticker = {
  id: string;
  label: string;
  thumb: string;
  full: string;
};

export const STICKER_PREFIX = "sticker:";

export const STICKERS: TSticker[] = [
  {
    id: "samgyetang",
    label: "参鶏湯",
    thumb: "/stickers/samgyetang-thumb.webp",
    full: "/stickers/samgyetang.webp",
  },
];

export const stickerReaction = (s: TSticker) => `${STICKER_PREFIX}${s.id}`;

export const isStickerReaction = (value: string | null | undefined): boolean =>
  !!value && value.startsWith(STICKER_PREFIX);

export const getSticker = (value: string | null | undefined): TSticker | undefined =>
  isStickerReaction(value) ? STICKERS.find((s) => stickerReaction(s) === value) : undefined;

const ROTATE_MS = 2600;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/** チップ内の縮略表示:サムネと文字を同じセルに重ね、交互にフェード(幅=広い方で固定=がたつかない) */
export function StickerInline({ sticker, className }: { sticker: TSticker; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const [showText, setShowText] = React.useState(false);
  const [imgOk, setImgOk] = React.useState(true);

  React.useEffect(() => {
    if (reduced || !imgOk) return;
    const t = window.setInterval(() => setShowText((v) => !v), ROTATE_MS);
    return () => window.clearInterval(t);
  }, [reduced, imgOk]);

  const textVisible = reduced || !imgOk || showText;

  return (
    <span className={cn("inline-grid h-[18px] place-items-center align-middle", className)} aria-label={sticker.label}>
      {imgOk && (
        <img
          src={sticker.thumb}
          alt=""
          draggable={false}
          onError={() => setImgOk(false)}
          className={cn(
            "col-start-1 row-start-1 size-[18px] rounded-[4px] object-cover transition-opacity duration-500",
            textVisible ? "opacity-0" : "opacity-100"
          )}
        />
      )}
      <span
        className={cn(
          "col-start-1 row-start-1 text-11 leading-none font-bold whitespace-nowrap text-primary transition-opacity duration-500",
          textVisible ? "opacity-100" : "opacity-0"
        )}
      >
        {sticker.label}
      </span>
    </span>
  );
}

/** ホバー浮層の大図 */
export function StickerPreview({ sticker, footer }: { sticker: TSticker; footer?: React.ReactNode }) {
  return (
    <span className="flex w-40 flex-col items-center gap-1 py-0.5">
      <img src={sticker.full} alt={sticker.label} className="w-40 rounded-md object-contain" draggable={false} />
      <span className="text-12 font-bold text-primary">{sticker.label}</span>
      {footer ? <span className="text-center text-11 text-secondary">{footer}</span> : null}
    </span>
  );
}
