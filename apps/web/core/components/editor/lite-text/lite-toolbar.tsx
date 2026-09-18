/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { ArrowUp, Paperclip } from "lucide-react";
// constants
import type { ToolbarMenuItem } from "@/constants/editor";
import { IMAGE_ITEM } from "@/constants/editor";

type LiteToolbarProps = {
  onSubmit: (e: React.KeyboardEvent<HTMLDivElement> | React.MouseEvent<HTMLButtonElement>) => void;
  isSubmitting: boolean;
  isEmpty: boolean;
  executeCommand: (item: ToolbarMenuItem) => void;
  sendLabel?: string;
  sendHint?: string;
  attachLabel?: string;
};

export function LiteToolbar({
  onSubmit,
  isSubmitting,
  isEmpty,
  executeCommand,
  sendLabel,
  sendHint,
  attachLabel,
}: LiteToolbarProps) {
  const sendTitle = [sendLabel, sendHint].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-2 pb-1">
      <button
        onClick={() => executeCommand(IMAGE_ITEM)}
        type="button"
        title={attachLabel}
        aria-label={attachLabel}
        className="p-1 text-tertiary transition-colors hover:text-secondary"
      >
        <Paperclip className="size-3" />
      </button>
      <button
        type="button"
        onClick={(e) => onSubmit(e)}
        disabled={isEmpty || isSubmitting}
        title={sendTitle || undefined}
        aria-label={sendLabel}
        className="rounded-sm bg-accent-primary p-1 text-primary transition-colors hover:bg-accent-primary/80 disabled:bg-layer-1 disabled:text-secondary"
      >
        <ArrowUp className="size-3" />
      </button>
    </div>
  );
}

export type { LiteToolbarProps };
