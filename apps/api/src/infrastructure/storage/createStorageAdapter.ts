/**
 * @file createStorageAdapter.ts
 * @description Factory that selects storage adapter based on STORAGE_PROVIDER env var.
 *              Defaults to S3. DO Spaces reuses S3 adapter with custom endpoint.
 *              Azure and GCS adapters exist as separate packages.
 * @layer infrastructure
 */

import { createS3StorageAdapter } from "@adapters/storage-s3";
import type { StoragePort } from "@ports/core";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export function createStorageAdapter(): StoragePort {
  const provider = process.env.STORAGE_PROVIDER ?? "s3";

  switch (provider) {
    case "do-spaces":
      return createS3StorageAdapter({
        bucket: requireEnv("DO_SPACES_BUCKET"),
        region: requireEnv("DO_SPACES_REGION"),
        accessKeyId: requireEnv("DO_SPACES_KEY"),
        secretAccessKey: requireEnv("DO_SPACES_SECRET"),
        endpoint: `https://${requireEnv("DO_SPACES_ENDPOINT")}`,
      });

    case "s3":
    default:
      return createS3StorageAdapter({
        bucket: process.env.S3_BUCKET ?? "omni-post-media",
        region: process.env.S3_REGION ?? "us-east-1",
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      });
  }
}
