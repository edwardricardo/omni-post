/**
 * @file index.ts
 * @description Azure Blob Storage adapter implementing StoragePort.
 * @layer infrastructure
 */

import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { ok, err, type Result } from "@shared/types";
import type { StoragePort, UploadSignature, MediaMetadata } from "@ports/core";

export interface AzureStorageConfig {
  accountName: string;
  accountKey: string;
  containerName: string;
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

export function createAzureBlobStorageAdapter(config: AzureStorageConfig): StoragePort {
  const credential = new StorageSharedKeyCredential(config.accountName, config.accountKey);
  const client = new BlobServiceClient(
    `https://${config.accountName}.blob.core.windows.net`,
    credential
  );
  const containerClient = client.getContainerClient(config.containerName);

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
        const blobClient = containerClient.getBlockBlobClient(blobName);

        const expiresOn = new Date(Date.now() + SIGNATURE_EXPIRY_MS);
        const permissions = new BlobSASPermissions();
        permissions.create = true;
        permissions.write = true;

        const sasToken = generateBlobSASQueryParameters(
          {
            containerName: config.containerName,
            blobName,
            permissions,
            expiresOn,
            contentType,
          },
          credential
        ).toString();

        const url = `${blobClient.url}?${sasToken}`;

        return ok({
          url,
          fields: { "x-ms-blob-type": "BlockBlob", "content-type": contentType },
          expiresAt: expiresOn,
        });
      } catch {
        return err("SERVICE_ERROR");
      }
    },

    async getMediaMetadata(
      url: string
    ): Promise<Result<MediaMetadata, "NOT_FOUND" | "SERVICE_ERROR">> {
      try {
        const blobUrl = new URL(url);
        const pathParts = blobUrl.pathname.split("/").filter(Boolean);
        const blobName = pathParts.slice(1).join("/");

        const blobClient = containerClient.getBlockBlobClient(blobName);
        const properties = await blobClient.getProperties();

        return ok({
          filename: blobName.split("/").pop() ?? blobName,
          contentType: properties.contentType ?? "application/octet-stream",
          size: properties.contentLength ?? 0,
        });
      } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404) return err("NOT_FOUND");
        return err("SERVICE_ERROR");
      }
    },
  };
}
