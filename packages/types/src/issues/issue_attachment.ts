/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TFileSignedURLResponse } from "../file";

export type TIssueAttachment = {
  id: string;
  attributes: {
    name: string;
    size: number;
    type?: string; // BARSOUL: mime 类型(运行时后端返回, 上游类型漏声明)→ 附件预览判定用
  };
  asset_url: string;
  issue_id: string;
  // required
  updated_at: string;
  updated_by: string;
  created_by: string;
};

export type TIssueAttachmentUploadResponse = TFileSignedURLResponse & {
  attachment: TIssueAttachment;
};

export type TIssueAttachmentMap = {
  [issue_id: string]: TIssueAttachment;
};

export type TIssueAttachmentIdMap = {
  [issue_id: string]: string[];
};
