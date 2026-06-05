/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Blockquote from "@tiptap/extension-blockquote";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

export const CustomQuoteExtension = Blockquote.extend({
  // BARSOUL(2026-05-23): 言語タグ data-lang を schema 属性として保持。
  // Plane の bilingual description (handle_delegated_to_ai 由来) で
  // JA/ZH 各 blockquote を視覚色分け(editor.css 側で配色)。
  // 既定 Tiptap Blockquote はカスタム attr を持たないため、parseHTML/renderHTML
  // 両方を実装しないと ProseMirror ラウンドトリップで剥落する。
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      "data-lang": {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-lang"),
        renderHTML: (attrs: Record<string, any>) =>
          attrs["data-lang"] ? { "data-lang": attrs["data-lang"] } : {},
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        try {
          const { $from, $to, $head } = this.editor.state.selection;
          const parent = $head.node(-1);

          if (!parent) return false;

          if (parent.type.name !== CORE_EXTENSIONS.BLOCKQUOTE) {
            return false;
          }
          if ($from.pos !== $to.pos) return false;
          // if ($head.parentOffset < $head.parent.content.size) return false;

          // this.editor.commands.insertContentAt(parent.ne);
          this.editor.chain().splitBlock().lift(this.name).run();

          return true;
        } catch (error) {
          console.error("Error handling Enter in blockquote:", error);
          return false;
        }
      },
    };
  },
});
