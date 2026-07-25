/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type IEditorExtensionOptions = unknown;

export type IEditorPropsExtended = unknown;

export type ICollaborativeDocumentEditorPropsExtended = unknown;

/**
 * BARSOUL(2026-07-25 hechun「審査を一等市民に」): コメント欄のスラッシュ命令。
 * 本体の書式命令ではなく **意図の発火** —— エディタは意図を bubbling
 * CustomEvent で投げるだけで、実処理(承認モーダル / 愛ちゃん私聊)はアプリ側。
 * `@plane/editor` がアプリのコードを知らない状態を保つための薄い縫い目。
 */
export type TExtendedEditorCommands = "barsoul-approval" | "barsoul-aichan";

export type TExtendedCommandExtraProps = unknown;

export type TExtendedEditorRefApi = unknown;
