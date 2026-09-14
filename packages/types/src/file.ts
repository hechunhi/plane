/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { EFileAssetType } from "./enums";

export type TFileMetaDataLite = {
  name: string;
  // file size in bytes
  size: number;
  type: string;
};

export type TFileEntityInfo = {
  entity_identifier: string;
  entity_type: EFileAssetType;
};

export type TFileMetaData = TFileMetaDataLite & TFileEntityInfo;

export type TFileSignedURLResponse = {
  asset_id: string;
  asset_url: string;
  upload_data: {
    url: string;
    // POST (default, MinIO/AWS): multipart form with every field + the file.
    // PUT (Cloudflare R2 — no PostObject): raw file body, only `fields["Content-Type"]`
    // is sent as a header; the other policy fields are absent.
    method?: "POST" | "PUT";
    fields: {
      "Content-Type": string;
      key: string;
      "x-amz-algorithm"?: string;
      "x-amz-credential"?: string;
      "x-amz-date"?: string;
      policy?: string;
      "x-amz-signature"?: string;
    };
  };
};

/** Body handed to FileUploadService.uploadFile — FormData for presigned POST, the bare File for presigned PUT. */
export type TFileUploadPayload = FormData | File;

export type TDuplicateAssetData = {
  entity_id: string;
  entity_type: EFileAssetType;
  project_id?: string;
  asset_ids: string[];
};

export type TDuplicateAssetResponse = Record<string, string>; // asset_id -> new_asset_id
