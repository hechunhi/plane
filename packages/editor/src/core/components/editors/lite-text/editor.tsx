/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { forwardRef, useMemo } from "react";
// components
import { EditorWrapper } from "@/components/editors/editor-wrapper";
// extensions
import { EnterKeyExtension } from "@/extensions";
import { SlashCommands } from "@/extensions/slash-commands/root";
// types
import type { EditorRefApi, ILiteTextEditorProps } from "@/types";

function LiteTextEditor(props: ILiteTextEditorProps) {
  // BARSOUL(2026-06-14 用户拍板): 评论框**不挂 bubble menu** — 改为底部常驻工具条丰富
  // 功能(含颜色)。bubble menu 浮层挂 body 与详情面板 outside-click/定位溢出连环踩坑;
  // 常驻条在面板 DOM 内、无浮层,稳定得多。回原版(无 children)。
  const {
    onEnterKeyPress,
    disabledExtensions,
    flaggedExtensions,
    commentCommands,
    editable,
    extensions: externalExtensions = [],
  } = props;

  const extensions = useMemo(() => {
    const resolvedExtensions = [...externalExtensions];

    if (!disabledExtensions?.includes("enter-key")) {
      resolvedExtensions.push(EnterKeyExtension(onEnterKeyPress));
    }

    // BARSOUL(2026-07-25 hechun「審査を一等市民に」): コメント欄のスラッシュ命令。
    // アプリ側が項目を渡したときだけ生える。allowedCommandKeys で **渡した項目だけ** に
    // 絞るので、本文用の見出し/表/画像がコメント欄に紛れ込むことはない。
    if (editable && commentCommands?.length && !disabledExtensions?.includes("slash-commands")) {
      resolvedExtensions.push(
        SlashCommands({
          disabledExtensions: disabledExtensions ?? [],
          flaggedExtensions: flaggedExtensions ?? [],
          additionalOptions: commentCommands,
          allowedCommandKeys: commentCommands.map((o) => o.commandKey),
        })
      );
    }

    return resolvedExtensions;
  }, [externalExtensions, disabledExtensions, flaggedExtensions, commentCommands, editable, onEnterKeyPress]);

  return <EditorWrapper {...props} extensions={extensions} />;
}

const LiteTextEditorWithRef = forwardRef(function LiteTextEditorWithRef(
  props: ILiteTextEditorProps,
  ref: React.ForwardedRef<EditorRefApi>
) {
  return <LiteTextEditor {...props} forwardedRef={ref as React.MutableRefObject<EditorRefApi | null>} />;
});

LiteTextEditorWithRef.displayName = "LiteTextEditorWithRef";

export { LiteTextEditorWithRef };
