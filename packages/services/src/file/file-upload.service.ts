/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import axios from "axios";
// plane imports
import type { TFileUploadPayload } from "@plane/types";
// api service
import { APIService } from "../api.service";

/**
 * Service class for handling file upload operations
 * Handles file uploads
 * @extends {APIService}
 */
export class FileUploadService extends APIService {
  private cancelSource: any;

  constructor() {
    super("");
  }

  /**
   * Uploads a file to the specified signed URL
   * @param {string} url - The URL to upload the file to
   * @param {TFileUploadPayload} data - FormData (presigned POST) or the bare File (presigned PUT)
   * @returns {Promise<void>} Promise resolving to void
   * @throws {Error} If the request fails
   */
  async uploadFile(url: string, data: TFileUploadPayload): Promise<void> {
    this.cancelSource = axios.CancelToken.source();
    // FormData => presigned POST (MinIO/AWS); bare File => presigned PUT (Cloudflare
    // R2 has no PostObject). The PUT signature covers Content-Type, so send exactly
    // the type the API signed.
    const request =
      data instanceof FormData
        ? this.post(url, data, {
            headers: { "Content-Type": "multipart/form-data" },
            cancelToken: this.cancelSource.token,
            withCredentials: false,
          })
        : this.put(url, data, {
            headers: { "Content-Type": data.type || "application/octet-stream" },
            cancelToken: this.cancelSource.token,
            withCredentials: false,
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

  /**
   * Cancels the upload
   */
  cancelUpload() {
    this.cancelSource.cancel("Upload canceled");
  }
}
