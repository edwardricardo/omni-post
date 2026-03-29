import type { HealthChecker, HealthCheckResult } from "../types.js";
import type { Result } from "@shared/types";
import type { UploadSignature } from "@ports/core";

/**
 * Storage adapter interface for health checking
 * Uses the actual StoragePort interface
 */
interface StorageAdapter {
  generateUploadSignature(
    filename: string,
    contentType: string,
    sizeBytes?: number
  ): Promise<Result<UploadSignature, "INVALID_TYPE" | "SERVICE_ERROR">>;
}

/**
 * Health checker for S3/storage service
 *
 * Verifies that the storage backend (S3 or compatible) is accessible
 * and can generate upload signatures.
 */
export class StorageHealthChecker implements HealthChecker {
  constructor(private storage: StorageAdapter) {}

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Test the storage service by generating a test upload signature
      // This verifies:
      // 1. S3 client is configured correctly
      // 2. Credentials are valid
      // 3. Service is reachable
      const testFilename = `health-check-${Date.now()}.txt`;
      const result = await this.storage.generateUploadSignature(testFilename, "text/plain", 1024);

      const latency = Date.now() - startTime;

      if (!result.ok) {
        return {
          status: "unhealthy",
          latency,
          message: "Storage service unavailable",
          error: result.error || "Failed to generate upload signature",
          details: {
            responseTime: latency,
            testOperation: "generateUploadSignature",
          },
        };
      }

      // Determine status based on latency
      let status: HealthCheckResult["status"] = "healthy";
      let message = "Storage service is healthy";

      if (latency > 5000) {
        status = "unhealthy";
        message = `Storage response time too high: ${latency}ms`;
      } else if (latency > 2000) {
        status = "degraded";
        message = `Storage response time elevated: ${latency}ms`;
      }

      return {
        status,
        latency,
        message,
        details: {
          responseTime: latency,
          testOperation: "generateUploadSignature",
          ...(result.value && { expiresAt: result.value.expiresAt }),
        },
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      return {
        status: "unhealthy",
        latency,
        message: "Storage health check failed",
        error: error instanceof Error ? error.message : String(error),
        details: {
          errorType: error instanceof Error ? error.constructor.name : "Unknown",
          code: (error as Record<string, unknown>)["code"],
          responseTime: latency,
        },
      };
    }
  }
}
