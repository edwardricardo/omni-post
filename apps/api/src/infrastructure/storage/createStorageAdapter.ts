/**
 * @file createStorageAdapter.ts
 * @description Factory that selects storage adapter based on STORAGE_PROVIDER env var.
 *              Defaults to S3. DO Spaces reuses the S3 adapter with a custom
 *              endpoint; the S3 path honours S3_ENDPOINT for S3-compatible
 *              backends (MinIO, LocalStack). Azure and GCS adapters exist as
 *              separate packages.
 * @layer infrastructure
 */

import { createS3StorageAdapter } from "@adapters/storage-s3";
import type { StoragePort } from "@ports/core";
import { env } from "../../config/env.js";

function require<T extends string | undefined>(value: T, key: string): NonNullable<T> {
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value as NonNullable<T>;
}

/**
 * @function createStorageAdapter
 * @description Builds the configured StoragePort adapter (DigitalOcean Spaces, R2, MinIO, etc.)
 *              based on the STORAGE_PROVIDER env variable.
 * @returns StoragePort instance for the active provider
 */
export function createStorageAdapter(): StoragePort {
  switch (env.STORAGE_PROVIDER) {
    case "do-spaces":
      return createS3StorageAdapter({
        bucket: require(env.DO_SPACES_BUCKET, "DO_SPACES_BUCKET"),
        region: require(env.DO_SPACES_REGION, "DO_SPACES_REGION"),
        accessKeyId: require(env.DO_SPACES_KEY, "DO_SPACES_KEY"),
        secretAccessKey: require(env.DO_SPACES_SECRET, "DO_SPACES_SECRET"),
        endpoint: `https://${require(env.DO_SPACES_ENDPOINT, "DO_SPACES_ENDPOINT")}`,
      });

    case "s3":
    case "local":
      return createS3StorageAdapter({
        bucket: env.S3_BUCKET ?? "omni-post-media",
        region: env.S3_REGION ?? "us-east-1",
        accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
        // Presence of an endpoint switches the adapter to path-style
        // addressing, required by S3-compatible backends (MinIO).
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      });
  }
}
