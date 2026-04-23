/**
 * @file index.ts
 * @description Cloudinary storage adapter implementing StoragePort — generates signed upload
 *              parameters and retrieves media metadata via the Cloudinary SDK.
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import { ok, err, type Result } from "@shared/types";
import type { StoragePort, UploadSignature, MediaMetadata } from "@ports/core";
import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { v2 as cloudinary } from "cloudinary";
import client from "prom-client";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:storage-cloudinary");

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/mov",
];

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const UPLOAD_SIGNATURE_EXPIRY = 60 * 60; // 1 hour in seconds

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder?: string;
  resourceType?: "image" | "video" | "raw" | "auto";
}

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry);

export function createCloudinaryStorageAdapter(config: CloudinaryConfig): StoragePort & {
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
  // Configure Cloudinary
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
  });

  const getResourceType = (contentType: string): "image" | "video" | "raw" => {
    if (contentType.startsWith("image/")) return "image";
    if (contentType.startsWith("video/")) return "video";
    return "raw";
  };

  const generatePublicId = (filename: string): string => {
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    const folder = config.folder ? `${config.folder}/` : "";
    return `${folder}${randomUUID()}-${nameWithoutExt}`;
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
        const publicId = generatePublicId(filename);
        const resourceType = config.resourceType || getResourceType(contentType);
        const timestamp = Math.round(Date.now() / 1000);

        // Generate upload parameters
        const uploadParams = {
          timestamp,
          public_id: publicId,
          resource_type: resourceType,
          ...(config.folder && { folder: config.folder }),
        };

        // Generate signature
        const signature = cloudinary.utils.api_sign_request(uploadParams, config.apiSecret);

        // Cloudinary upload URL
        const uploadUrl = `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`;

        return {
          url: uploadUrl,
          fields: {
            ...uploadParams,
            signature,
            api_key: config.apiKey,
          },
          expiresAt: new Date(Date.now() + UPLOAD_SIGNATURE_EXPIRY * 1000),
        };
      };

      try {
        const result = await circuitBreaker.call(
          "cloudinary-storage",
          "generate-upload-signature",
          operation,
          [],
          {
            timeout: 8000, // 8 seconds
            errorThresholdPercentage: 50,
            resetTimeout: 30000, // 30 seconds
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 8000,
            jitterEnabled: true,
            cacheEnabled: false, // Don't cache upload signatures
          }
        );

        return ok(result);
      } catch (error: unknown) {
        logger.error({ err: error }, "Cloudinary upload signature generation failed");
        return err("SERVICE_ERROR");
      }
    },

    async getMediaMetadata(
      url: string
    ): Promise<Result<MediaMetadata, "NOT_FOUND" | "SERVICE_ERROR">> {
      // Extract public ID from Cloudinary URL
      const urlMatch = url.match(/\/v\d+\/(.+?)(?:\.[^.]+)?$/);
      if (!urlMatch) {
        return err("NOT_FOUND");
      }

      const publicId = urlMatch[1];

      const operation = async (): Promise<MediaMetadata> => {
        // Try to get resource info from Cloudinary API
        const resourceInfo = await cloudinary.api.resource(publicId, {
          resource_type: "auto", // Auto-detect resource type
        });

        if (!resourceInfo) {
          throw new Error("Resource not found");
        }

        return {
          filename: resourceInfo.original_filename || publicId.split("/").pop() || "unknown",
          contentType: resourceInfo.format
            ? `image/${resourceInfo.format}`
            : "application/octet-stream",
          size: resourceInfo.bytes || 0,
          width: resourceInfo.width,
          height: resourceInfo.height,
        };
      };

      try {
        const result = await circuitBreaker.call(
          "cloudinary-storage",
          "get-metadata",
          operation,
          [],
          {
            timeout: 10000, // 10 seconds
            errorThresholdPercentage: 50,
            resetTimeout: 30000,
            maxRetries: 2,
            baseDelay: 1000,
            maxDelay: 5000,
            jitterEnabled: true,
            cacheEnabled: true, // Cache metadata for 10 minutes
            cacheTtl: 600000,
          }
        );

        return ok(result);
      } catch (error: unknown) {
        logger.error({ err: error }, "Cloudinary metadata fetch failed");

        if (error.error?.message?.includes("Resource not found") || error.http_code === 404) {
          return err("NOT_FOUND");
        }

        return err("SERVICE_ERROR");
      }
    },

    // API compatibility methods
    async getSignedUploadUrl(input: { path: string; contentType: string; sizeBytes?: number }) {
      return this.generateUploadSignature(input.path, input.contentType, input.sizeBytes);
    },

    async getMetadata(input: { url: string }) {
      return this.getMediaMetadata(input.url);
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
