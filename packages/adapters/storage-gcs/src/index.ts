/**
 * @file index.ts
 * @description Google Cloud Storage adapter implementing StoragePort.
 * @layer infrastructure
 */

import { Storage } from "@google-cloud/storage";
import { ok, err, type Result } from "@shared/types";
import type { StoragePort, UploadSignature, MediaMetadata } from "@ports/core";

export interface GcsStorageConfig {
  projectId: string;
  bucketName: string;
  keyFilePath?: string;
  keyJson?: string;
  cdnUrl?: string;
}

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const _MAX_FILE_SIZE = 100 * 1024 * 1024;
const SIGNATURE_EXPIRY_MS = 15 * 60 * 1000;

export function createGcsStorageAdapter(config: GcsStorageConfig): StoragePort {
  const credentials = config.keyJson
    ? (JSON.parse(Buffer.from(config.keyJson, "base64").toString()) as Record<string, unknown>)
    : undefined;

  const storage = new Storage({
    projectId: config.projectId,
    ...(config.keyFilePath ? { keyFilename: config.keyFilePath } : {}),
    ...(credentials
      ? {
          credentials: credentials as import("@google-cloud/storage").StorageOptions["credentials"],
        }
      : {}),
  });

  const bucket = storage.bucket(config.bucketName);

  return {
    async generateUploadSignature(
      filename: string,
      contentType: string
    ): Promise<Result<UploadSignature, "INVALID_TYPE" | "SERVICE_ERROR">> {
      if (!ALLOWED_TYPES.has(contentType)) {
        return err("INVALID_TYPE");
      }

      try {
        const blobName = `${Date.now()}-${filename}`;
        const file = bucket.file(blobName);
        const expiresAt = new Date(Date.now() + SIGNATURE_EXPIRY_MS);

        const [signedUrl] = await file.getSignedUrl({
          version: "v4",
          action: "write",
          expires: expiresAt,
          contentType,
        });

        return ok({
          url: signedUrl,
          fields: { "content-type": contentType },
          expiresAt,
        });
      } catch {
        return err("SERVICE_ERROR");
      }
    },

    async getMediaMetadata(
      url: string
    ): Promise<Result<MediaMetadata, "NOT_FOUND" | "SERVICE_ERROR">> {
      try {
        const gcsUrl = new URL(url);
        const blobName = gcsUrl.pathname.replace(`/${config.bucketName}/`, "");

        const file = bucket.file(blobName);
        const [metadata] = await file.getMetadata();

        return ok({
          filename: blobName.split("/").pop() ?? blobName,
          contentType: (metadata.contentType as string) ?? "application/octet-stream",
          size: Number(metadata.size ?? 0),
        });
      } catch (error: unknown) {
        const code = (error as { code?: number }).code;
        if (code === 404) return err("NOT_FOUND");
        return err("SERVICE_ERROR");
      }
    },
  };
}
