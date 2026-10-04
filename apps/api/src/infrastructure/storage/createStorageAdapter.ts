/**
 * @file createStorageAdapter.ts
 * @description Factory that selects the StoragePort adapter from STORAGE_PROVIDER. `do-spaces`
 *              goes through the DigitalOcean Spaces package; `s3` requires its bucket and region
 *              and honours S3_ENDPOINT for S3-compatible backends (MinIO, LocalStack); the
 *              default `local` builds the S3 adapter with no storage variable set. On both S3
 *              paths the static key pair is both-or-neither. A missing required variable throws
 *              at construction, naming it, so a misconfigured deployment refuses to boot.
 * @layer infrastructure
 */

import { createDigitalOceanSpacesAdapter } from "@adapters/storage-do-spaces";
import { createS3StorageAdapter, type S3Config } from "@adapters/storage-s3";
import type { StoragePort } from "@ports/core";
import { env } from "../../config/env.js";

// The names the local stack uses: docker-compose's minio-init creates this bucket, and the
// MinIO service there configures no site region. Neither value is a secret.
const LOCAL_BUCKET = "omni-post-media";
const LOCAL_REGION = "us-east-1";

function requireEnv(key: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${key} (STORAGE_PROVIDER=${env.STORAGE_PROVIDER})`);
  }
  return value;
}

// An endpoint switches the S3 adapter to path-style addressing, which S3-compatible backends
// such as MinIO require; AWS S3 takes none.
function s3Endpoint(): Pick<S3Config, "endpoint"> {
  return env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {};
}

// With neither half set the S3 adapter passes no credentials and the AWS SDK default chain
// resolves them: an instance role or OIDC in a deployment, and nothing at all for a dev or test
// boot with no storage variable. Half a pair is a misconfiguration the adapter would otherwise
// drop in silence.
function optionalS3Credentials(): Pick<S3Config, "accessKeyId" | "secretAccessKey"> {
  if (!env.S3_ACCESS_KEY_ID && !env.S3_SECRET_ACCESS_KEY) return {};
  return {
    accessKeyId: requireEnv("S3_ACCESS_KEY_ID", env.S3_ACCESS_KEY_ID),
    secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY", env.S3_SECRET_ACCESS_KEY),
  };
}

/**
 * @method createStorageAdapter
 * @description Builds the StoragePort adapter for the configured STORAGE_PROVIDER.
 * @returns StoragePort instance for the active provider
 * @throws Error naming the first required variable the selected provider is missing
 */
export function createStorageAdapter(): StoragePort {
  switch (env.STORAGE_PROVIDER) {
    case "do-spaces":
      return createDigitalOceanSpacesAdapter({
        bucket: requireEnv("DO_SPACES_BUCKET", env.DO_SPACES_BUCKET),
        region: requireEnv("DO_SPACES_REGION", env.DO_SPACES_REGION),
        key: requireEnv("DO_SPACES_KEY", env.DO_SPACES_KEY),
        secret: requireEnv("DO_SPACES_SECRET", env.DO_SPACES_SECRET),
        endpoint: requireEnv("DO_SPACES_ENDPOINT", env.DO_SPACES_ENDPOINT),
      });

    case "s3":
      return createS3StorageAdapter({
        bucket: requireEnv("S3_BUCKET", env.S3_BUCKET),
        region: requireEnv("S3_REGION", env.S3_REGION),
        ...optionalS3Credentials(),
        ...s3Endpoint(),
      });

    case "local":
      return createS3StorageAdapter({
        bucket: env.S3_BUCKET ?? LOCAL_BUCKET,
        region: env.S3_REGION ?? LOCAL_REGION,
        ...optionalS3Credentials(),
        ...s3Endpoint(),
      });
  }
}
