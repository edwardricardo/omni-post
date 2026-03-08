import { randomUUID } from "node:crypto";
import { ok, err, type Result } from "@shared/types";
import type { StoragePort, UploadSignature, MediaMetadata } from "@ports/core";
import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:storage-s3");
import {
  S3Client,
  GetObjectCommand as _GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as _getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import * as client from "prom-client";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const PRESIGNED_URL_EXPIRY = 15 * 60; // 15 minutes in seconds

export interface S3Config {
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string; // For LocalStack or MinIO
}

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry);

export function createS3StorageAdapter(config: S3Config): StoragePort & {
  getSignedUploadUrl(input: {
    path: string;
    contentType: string;
    sizeBytes?: number;
  }): Promise<Result<UploadSignature, "INVALID_TYPE" | "SERVICE_ERROR">>;
  getMetadata(input: {
    url: string;
  }): Promise<Result<MediaMetadata, "NOT_FOUND" | "SERVICE_ERROR">>;
  getCircuitBreakerStatus(): Record<string, any>;
  getMetricsRegistry(): client.Registry;
} {
  const s3Client = new S3Client({
    region: config.region,
    ...(config.accessKeyId && config.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }
      : {}),
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: !!config.endpoint, // Required for LocalStack/MinIO
  });

  const generateUniqueKey = (filename: string): string => {
    const ext = filename.split(".").pop();
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    return `uploads/${randomUUID()}-${nameWithoutExt}.${ext}`;
  };

  return {
    async generateUploadSignature(
      filename: string,
      contentType: string,
      sizeBytes?: number
    ): Promise<Result<UploadSignature, "INVALID_TYPE" | "SERVICE_ERROR">> {
      if (!ALLOWED_TYPES.includes(contentType)) {
        return err("INVALID_TYPE");
      }

      if (sizeBytes && sizeBytes > MAX_FILE_SIZE) {
        return err("INVALID_TYPE");
      }

      const operation = async (): Promise<UploadSignature> => {
        const key = generateUniqueKey(filename);

        const { url, fields } = await createPresignedPost(s3Client, {
          Bucket: config.bucket,
          Key: key,
          Fields: {
            "Content-Type": contentType,
            "x-amz-meta-original-name": filename,
          },
          Expires: PRESIGNED_URL_EXPIRY,
          Conditions: [
            ["content-length-range", 0, sizeBytes || MAX_FILE_SIZE],
            ["eq", "$Content-Type", contentType],
          ],
        });

        return {
          url,
          fields: {
            ...fields,
            key,
            "Content-Type": contentType,
            "x-amz-meta-original-name": filename,
          },
          expiresAt: new Date(Date.now() + PRESIGNED_URL_EXPIRY * 1000),
        };
      };

      try {
        const result = await circuitBreaker.call(
          "s3-storage",
          "generate-upload-signature",
          operation,
          [],
          {
            timeout: 10000, // 10 seconds
            errorThresholdPercentage: 50,
            resetTimeout: 30000, // 30 seconds
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 10000,
            jitterEnabled: true,
            cacheEnabled: false, // Don't cache upload signatures
          }
        );

        return ok(result);
      } catch (error: unknown) {
        logger.error({ err: error }, "S3 upload signature generation failed");
        return err("SERVICE_ERROR");
      }
    },

    async getMediaMetadata(
      url: string
    ): Promise<Result<MediaMetadata, "NOT_FOUND" | "SERVICE_ERROR">> {
      // Extract S3 key from URL
      const urlObj = new URL(url);
      const key = urlObj.pathname.startsWith("/") ? urlObj.pathname.slice(1) : urlObj.pathname;

      if (!key) {
        return err("NOT_FOUND");
      }

      const operation = async (): Promise<MediaMetadata> => {
        const command = new HeadObjectCommand({
          Bucket: config.bucket,
          Key: key,
        });

        const response = await s3Client.send(command);

        if (!response.ContentLength) {
          throw new Error("Object not found or metadata unavailable");
        }

        const width = response.Metadata?.width ? parseInt(response.Metadata.width) : undefined;
        const height = response.Metadata?.height ? parseInt(response.Metadata.height) : undefined;

        return {
          filename: response.Metadata?.["original-name"] || key.split("/").pop() || "unknown",
          contentType: response.ContentType || "application/octet-stream",
          size: response.ContentLength,
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
        };
      };

      try {
        const result = await circuitBreaker.call("s3-storage", "get-metadata", operation, [], {
          timeout: 8000, // 8 seconds
          errorThresholdPercentage: 50,
          resetTimeout: 30000,
          maxRetries: 2,
          baseDelay: 1000,
          maxDelay: 5000,
          jitterEnabled: true,
          cacheEnabled: true, // Cache metadata for 5 minutes
          cacheTtl: 300000,
        });

        return ok(result);
      } catch (error: unknown) {
        logger.error({ err: error }, "S3 metadata fetch failed");

        if (error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound")) {
          return err("NOT_FOUND");
        }

        return err("SERVICE_ERROR");
      }
    },

    // API compatibility methods
    async getSignedUploadUrl(input: { path: string; contentType: string; sizeBytes?: number }) {
      return await this.generateUploadSignature(input.path, input.contentType);
    },

    async getMetadata(input: { url: string }) {
      return await this.getMediaMetadata(input.url);
    },

    // Circuit breaker management
    getCircuitBreakerStatus(): Record<string, any> {
      return circuitBreaker.getAllStatuses();
    },

    getMetricsRegistry(): client.Registry {
      return registry;
    },
  };
}
