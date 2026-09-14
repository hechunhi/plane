/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosRequestConfig } from "axios";
import axios from "axios";
// plane imports
import type { TFileUploadPayload } from "@plane/types";
// services
import { APIService } from "@/services/api.service";

export class FileUploadService extends APIService {
  private cancelSource: any;

  constructor() {
    super("");
  }

  async uploadFile(
    url: string,
    data: TFileUploadPayload,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<void> {
    this.cancelSource = axios.CancelToken.source();
    // Presigned PUT (Cloudflare R2): the signature covers Content-Type, so send the
    // raw body with exactly the type the API signed (mirrored in `file.type` by the
    // caller via getFileMetaDataForUpload). FormData => presigned POST (MinIO/AWS).
    const request =
      data instanceof FormData
        ? this.post(url, data, {
            headers: { "Content-Type": "multipart/form-data" },
            cancelToken: this.cancelSource.token,
            withCredentials: false,
            onUploadProgress: uploadProgressHandler,
          })
        : this.put(url, data, {
            headers: { "Content-Type": data.type || "application/octet-stream" },
            cancelToken: this.cancelSource.token,
            withCredentials: false,
            onUploadProgress: uploadProgressHandler,
          });
    return request
      .then((response) => response?.data)
      .catch((error) => {
        if (axios.isCancel(error)) {
          console.log(error.message);
        } else {
          throw error?.response?.data;
        }
      });
  }

  cancelUpload() {
    this.cancelSource.cancel("Upload canceled");
  }
}
