/**
 * @file types.ts
 * @description Shape of an uploaded media file as tracked by the upload
 *              zone state hook. `url` is a blob URL (revoked on remove);
 *              `thumbnail` is a data URL produced by canvas (NOT a blob,
 *              so callers must not pass it to `URL.revokeObjectURL`).
 * @layer infrastructure
 */

export type MediaFileType = "image" | "video" | "gif";
export type MediaFileStatus = "uploading" | "processing" | "ready" | "error";

export interface MediaFile {
  id: string;
  file: File;
  url: string;
  type: MediaFileType;
  thumbnail?: string;
  duration?: number;
  size: number;
  status: MediaFileStatus;
  progress?: number;
  error?: string;
  metadata?: {
    width?: number;
    height?: number;
    aspectRatio?: number;
  };
}
