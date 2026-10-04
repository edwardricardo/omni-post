/**
 * @file index.ts
 * @description DigitalOcean Spaces adapter. Spaces speaks the S3 API, so this maps the Spaces
 *              configuration onto the S3 adapter rather than reimplementing it.
 * @layer infrastructure
 */

import { createS3StorageAdapter } from "@adapters/storage-s3";
import type { StoragePort } from "@ports/core";

export interface DOSpacesConfig {
  /** Spaces access key id. */
  key: string;
  /** Spaces secret key. */
  secret: string;
  /** Bare Spaces host, without a scheme (e.g. `fra1.digitaloceanspaces.com`). */
  endpoint: string;
  bucket: string;
  region: string;
}

/**
 * @method createDigitalOceanSpacesAdapter
 * @description Builds a StoragePort backed by DigitalOcean Spaces through the S3 adapter.
 * @param config - Spaces credentials, bucket, region and bare endpoint host
 * @returns StoragePort that signs uploads and reads metadata against the Spaces endpoint
 */
export function createDigitalOceanSpacesAdapter(config: DOSpacesConfig): StoragePort {
  return createS3StorageAdapter({
    accessKeyId: config.key,
    secretAccessKey: config.secret,
    bucket: config.bucket,
    region: config.region,
    endpoint: `https://${config.endpoint}`,
  });
}
