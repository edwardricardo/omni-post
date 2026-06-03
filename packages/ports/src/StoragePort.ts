/**
 * @file StoragePort.ts
 * @description Storage port (interface) defining upload-signature generation and media metadata
 *              retrieval contracts for media file handling.
 * @layer domain
 */
import type { Result } from "@shared/types";

export type UploadSignature = {
  url: string;
  fields: Record<string, string>;
  expiresAt: Date;
};

export type MediaMetadata = {
  filename: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
};

export interface StoragePort {
  /**
   * Produce a presigned upload signature so the client can PUT/POST the media
   * directly to the storage backend without proxying bytes through the API.
   * Rejects unsupported `contentType` with `INVALID_TYPE`; the returned
   * signature carries the destination `url`, required form `fields`, and an
   * absolute `expiresAt`.
   */
  generateUploadSignature(
    filename: string,
    contentType: string
  ): Promise<Result<UploadSignature, "INVALID_TYPE" | "SERVICE_ERROR">>;

  /**
   * Read media metadata (size, mime type, dimensions, duration) from the
   * storage backend. `NOT_FOUND` when the URL does not resolve to an object
   * in the bucket; `SERVICE_ERROR` for transport/auth failures.
   */
  getMediaMetadata(url: string): Promise<Result<MediaMetadata, "NOT_FOUND" | "SERVICE_ERROR">>;
}
