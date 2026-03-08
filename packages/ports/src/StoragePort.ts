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
  generateUploadSignature(
    filename: string,
    contentType: string
  ): Promise<Result<UploadSignature, "INVALID_TYPE" | "SERVICE_ERROR">>;

  getMediaMetadata(url: string): Promise<Result<MediaMetadata, "NOT_FOUND" | "SERVICE_ERROR">>;
}
