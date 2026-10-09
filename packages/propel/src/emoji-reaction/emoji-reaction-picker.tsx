/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useMemo, useCallback } from "react";
import { EmojiRoot } from "../emoji-icon-picker/emoji/emoji";
import { emojiToString } from "../emoji-icon-picker/helper";
import { Popover } from "../popover";
import { Tooltip } from "../tooltip";
import { cn } from "../utils/classname";
import { convertPlacementToSideAndAlign } from "../utils/placement";
import type { TPlacement, TSide, TAlign } from "../utils/placement";
import { STICKERS, StickerPreview, stickerReaction } from "./stickers";

export interface EmojiReactionPickerProps {
  isOpen: boolean;
  handleToggle: (value: boolean) => void;
  buttonClassName?: string;
  closeOnSelect?: boolean;
  disabled?: boolean;
  dropdownClassName?: string;
  label: React.ReactNode;
  onChange: (emoji: string) => void;
  placement?: TPlacement;
  searchDisabled?: boolean;
  searchPlaceholder?: string;
  side?: TSide;
  align?: TAlign;
}

export function EmojiReactionPicker(props: EmojiReactionPickerProps) {
  const {
    isOpen,
    handleToggle,
    buttonClassName,
    closeOnSelect = true,
    disabled = false,
    dropdownClassName,
    label,
    onChange,
    placement = "bottom-start",
    searchDisabled = false,
    searchPlaceholder = "Search",
    side = "bottom",
    align = "start",
  } = props;

  // side and align calculations
  const { finalSide, finalAlign } = useMemo(() => {
    if (placement) {
      const converted = convertPlacementToSideAndAlign(placement);
      return { finalSide: converted.side, finalAlign: converted.align };
    }
    return { finalSide: side, finalAlign: align };
  }, [placement, side, align]);

  const handleEmojiChange = useCallback(
    (value: string) => {
      const emoji = emojiToString(value);
      onChange(emoji);
      if (closeOnSelect) handleToggle(false);
    },
    [onChange, closeOnSelect, handleToggle]
  );

  // BARSOUL: 社内スタンプは emojiToString を通さず "sticker:<id>" をそのまま渡す
  const handleStickerSelect = useCallback(
    (value: string) => {
      onChange(value);
      if (closeOnSelect) handleToggle(false);
    },
    [onChange, closeOnSelect, handleToggle]
  );

  return (
    <Popover open={isOpen} onOpenChange={handleToggle}>
      <Popover.Button className={cn("outline-none", buttonClassName)} disabled={disabled}>
        {label}
      </Popover.Button>
      <Popover.Panel
        positionerClassName="z-50"
        className={cn("w-80 overflow-hidden rounded-md border-[0.5px] border-strong bg-surface-1", dropdownClassName)}
        side={finalSide}
        align={finalAlign}
        sideOffset={8}
        data-prevent-outside-click="true"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // emoji-mart の検索入力キーが親(peek/エディタのショートカット)へ漏れない様に。
          // Escape はピッカーを閉じる。
          if (e.key === "Escape") {
            handleToggle(false);
            return;
          }
          e.stopPropagation();
        }}
      >
        {STICKERS.length > 0 && (
          <div className="flex items-center gap-1.5 border-b border-subtle px-2 py-1.5">
            {STICKERS.map((st) => (
              <Tooltip key={st.id} tooltipContent={<StickerPreview sticker={st} />} position="top" openDelay={150}>
                <button
                  type="button"
                  onClick={() => handleStickerSelect(stickerReaction(st))}
                  className="flex items-center gap-1.5 rounded-md border border-subtle px-1.5 py-1 hover:border-strong hover:bg-layer-transparent-hover"
                >
                  <img src={st.thumb} alt="" draggable={false} className="size-7 rounded object-cover" />
                  <span className="text-12 font-bold text-primary">{st.label}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        )}
        <EmojiRoot onChange={handleEmojiChange} searchPlaceholder={searchPlaceholder} searchDisabled={searchDisabled} />
      </Popover.Panel>
    </Popover>
  );
}
