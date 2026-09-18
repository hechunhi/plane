/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Extension } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

/**
 * BARSOUL 2026-09-18 (hechun「PC ユーザーが入力途中で誤送信する。中日 IME は Enter で
 * 確定するのに、送信も Enter だから」): コメント欄の送信キーを **Mod-Enter だけ** にする。
 *
 *   Enter       … 改行(段落分割 / リスト項目分割 = 通常のエディタ挙動)。送信しない。
 *   Shift-Enter … 行内改行(<br>)。HardBreak の既定に戻す(以前は段落分割に上書きしていた)。
 *   Mod-Enter   … 送信(onEnterKeyPress)。HardBreak の Mod-Enter(<br>)より先に拾う。
 *
 * IME 確定の Enter は ProseMirror が composition 中の keydown を無視するので届かないが、
 * それ以前は React 側(comment-create / edit-form の onKeyDown)が生 keydown を拾って
 * 送信していた —— Safari は compositionend 直後に keyCode 229 の Enter を投げるので
 * そこで誤爆していた。その経路は撤去済み。送信の入口は本拡張とボタンの 2 つだけ。
 *
 * priority 1000: StarterKit(HardBreak の Mod-Enter)より確実に先に評価させる。
 */
export const EnterKeyExtension = (onEnterKeyPress?: () => boolean | void) =>
  Extension.create({
    name: CORE_EXTENSIONS.ENTER_KEY,
    priority: 1000,

    addKeyboardShortcuts(this) {
      return {
        "Mod-Enter": () => {
          const { activeDropbarExtensions } = this.editor.storage.utility;
          // スラッシュ/メンション候補が開いている間は候補側に譲る
          if (activeDropbarExtensions.length > 0) return false;
          onEnterKeyPress?.();
          return true;
        },
      };
    },
  });
