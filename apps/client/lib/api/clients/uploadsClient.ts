/**
 * @file uploadsClient.ts
 * @description Uploads domain client. Sends multipart files (images, video,
 *              documents) through the proxy. The browser sets the
 *              `Content-Type` boundary automatically.
 * @layer infrastructure
 */

import type { ApiResponse } from "../types.js";
import { uploadRequest } from "./request.js";

export type UploadType = "image" | "video" | "document";

export interface UploadResult {
  url: string;
  metadata?: unknown;
}

/**
 * @class UploadsClient
 * @description Client for `/upload` multipart endpoint.
 */
export class UploadsClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * @method uploadFile
   * @description Uploads a file via multipart form data through the proxy.
   * @param file - Browser File object
   * @param type - Upload classification (default `image`)
   * @returns Stored URL and any associated metadata
   */
  async uploadFile(file: File, type: UploadType = "image"): Promise<ApiResponse<UploadResult>> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);

    return uploadRequest<ApiResponse<UploadResult>>(this.baseUrl, "/upload", formData);
  }
}
