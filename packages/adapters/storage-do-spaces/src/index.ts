/**
 * @file index.ts
 * @description DigitalOcean Spaces adapter. Reuses S3 adapter since
 *              DO Spaces is S3-compatible — only changes the endpoint.
 * @layer infrastructure
 */

import { createS3StorageAdapter } from "@adapters/storage-s3";
import type { StoragePort } from "@ports/core";

export interface DOSpacesConfig {
  key: string;
  secret: string;
  endpoint: string;
  bucket: string;
  region: string;
  cdnUrl?: string;
}

export function createDigitalOceanSpacesAdapter(config: DOSpacesConfig): StoragePort {
  return createS3StorageAdapter({
    accessKeyId: config.key,
    secretAccessKey: config.secret,
    bucket: config.bucket,
    region: config.region,
    endpoint: `https://${config.endpoint}`,
  });
}
