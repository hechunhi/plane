/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// editors
export {
  CollaborativeDocumentEditorWithRef,
  DocumentEditorWithRef,
  LiteTextEditorWithRef,
  RichTextEditorWithRef,
} from "@/components/editors";

// constants
export * from "@/constants/common";

// helpers
export * from "@/helpers/common";
export * from "@/helpers/yjs-utils";

export { CORE_EXTENSIONS } from "@/constants/extension";
export { ADDITIONAL_EXTENSIONS } from "@/plane-editor/constants/extensions";

// types
export * from "@/types";

// additional exports
export { TrailingNode } from "./core/extensions/trailing-node";

// BARSOUL: コメント欄スラッシュ命令(審査 / 愛ちゃん私聊)
export {
  COMMENT_INTENT_EVENT,
  buildCommentSlashOptions,
  dispatchCommentIntent,
} from "./core/extensions/barsoul-comment-commands";
export type {
  TCommentCommandLabel,
  TCommentCommandLabels,
  TCommentIntentDetail,
  TCommentIntentKind,
} from "./core/extensions/barsoul-comment-commands";
