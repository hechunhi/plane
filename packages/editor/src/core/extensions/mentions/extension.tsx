/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
// types
import type { TMentionHandler } from "@/types";
// extension config
import { CustomMentionExtensionConfig } from "./extension-config";
// node view
import type { MentionNodeViewProps } from "./mention-node-view";
import { MentionNodeView } from "./mention-node-view";
// utils
import { renderMentionsDropdown } from "./utils";

// BARSOUL(ADR-026 易用性): 日文 IME は ＠(全角 U+FF20)を出力するが
// Plane の mention picker は @(半角 U+0040)でしか起動しない。日本語
// ユーザは毎回英数モードに切替えてやっと @人 できる、毎日数十回の摩擦。
// 修: editor の textInput を捕捉し ＠ を入力された瞬間 @ に置換(透明)
// → mention picker は半角しか知らないまま起動、ユーザは IME を切り替え
// なくて済む。全 @ トリガー機能(mention/コマンド等)が同時に恩恵。
const fullWidthAtNormalizer = new Plugin({
  key: new PluginKey("barsoul-fullwidth-at-normalizer"),
  props: {
    handleTextInput(view, from, to, text) {
      if (text === "＠") {
        view.dispatch(view.state.tr.insertText("@", from, to));
        return true;
      }
      return false;
    },
  },
});

export function CustomMentionExtension(props: TMentionHandler) {
  const { searchCallback, renderComponent, getMentionedEntityDetails } = props;
  return CustomMentionExtensionConfig.extend({
    addOptions(this) {
      return {
        ...this.parent?.(),
        renderComponent,
        getMentionedEntityDetails,
      };
    },

    addNodeView() {
      return ReactNodeViewRenderer((props) => (
        <MentionNodeView {...props} node={props.node as MentionNodeViewProps["node"]} />
      ));
    },

    addProseMirrorPlugins() {
      const parent = this.parent?.() ?? [];
      return [...parent, fullWidthAtNormalizer];
    },
  }).configure({
    suggestion: {
      render: renderMentionsDropdown({
        searchCallback,
      }),
      allowSpaces: true,
    },
  });
}
