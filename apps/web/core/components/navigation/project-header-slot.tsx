/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createContext, useContext } from "react";

/**
 * BARSOUL 2026-09 — 縦が足りない画面(`short:` = 高さ 879px 以下)でのヘッダ 2 段 → 1 段.
 *
 * プロジェクト配下は「プロジェクトタブ行(工作项 / 视图 …)」の下に、各ページの AppHeader 行
 * (Work Items 88 / 看板 / 表示 / 追加 …)がもう 1 段積まれる。タブ行の右側は常に空いているので、
 * 低い画面では AppHeader の中身をここへ portal して 1 行に収める(≈ 35px を本文へ返す)。
 *
 *   提供側: app/.../projects/(detail)/[projectId]/layout.tsx(タブ行の右端に空の器を置く)
 *   利用側: components/core/app-header.tsx(short かつ器があれば portal、なければ従来どおり)
 *
 * 器が無い画面(ワークスペース直下・ACCORDION ナビ等)や高さ 880px 以上では何も変わらない。
 */
export const ProjectHeaderSlotContext = createContext<HTMLDivElement | null>(null);

export const useProjectHeaderSlot = (): HTMLDivElement | null => useContext(ProjectHeaderSlotContext);
