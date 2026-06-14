/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Extension } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

export const EnterKeyExtension = (onEnterKeyPress?: () => boolean | void) =>
  Extension.create({
    name: CORE_EXTENSIONS.ENTER_KEY,

    addKeyboardShortcuts(this) {
      return {
        Enter: () => {
          const { activeDropbarExtensions } = this.editor.storage.utility;

          if (activeDropbarExtensions.length === 0) {
            // BARSOUL B-8: onEnterKeyPress 返回 false = 不提交, 让 Enter 走默认换行
            // (评论框全屏撰写多行用)。返回 undefined/true = 原行为(拦截并提交)。
            const handled = onEnterKeyPress?.();
            return handled !== false;
          }

          return false;
        },
        "Shift-Enter": ({ editor }) =>
          editor.commands.first(({ commands }) => [
            () => commands.newlineInCode(),
            () => commands.splitListItem(CORE_EXTENSIONS.LIST_ITEM),
            () => commands.splitListItem(CORE_EXTENSIONS.TASK_ITEM),
            () => commands.createParagraphNear(),
            () => commands.liftEmptyBlock(),
            () => commands.splitBlock(),
          ]),
      };
    },
  });
