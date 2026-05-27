/**
 * @file healthRoutes.ts
 * @description Health check REST endpoints for monitoring and Kubernetes probes including
 *              simple, detailed, liveness, readiness, and per-dependency health checks.
 * @layer infrastructure
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  createHealthCheckManager,
  DatabaseHealthChecker,
  RedisHealthChecker,
  CacheHealthChecker,
  QueueHealthChecker,
  StorageHealthChecker,
  ProviderHealthChecker,
} from "@monitoring/health-checks";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import type { QueuePortRegistry } from "@ports/core";
import { createS3StorageAdapter } from "@adapters/storage-s3";
import { providerRegistry } from "../providers/providerRegistry.js";
import type Redis from "ioredis";
import type { RedisCacheManager } from "@adapters/cache-redis";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { TOKENS } from "../infrastructure/container/types.js";
import { env } from "../config/env.js";

/**
 * Health check routes for monitoring and Kubernetes probes
 *
 * Endpoints:
 * - GET /health - Simple health check
 * - GET /health/detailed - Comprehensive health status
 * - GET /health/live - Kubernetes liveness probe
 * - GET /health/ready - Kubernetes readiness probe
 * - GET /health/dependency/:name - Individual dependency health
 */
export async function healthRoutes(
  fastify: FastifyInstance,
  options: {
    redis: Redis;
    cacheManager: RedisCacheManager;
  }
) {
  const { redis, cacheManager } = options;
  const scheduler = fastify.container!.resolve<BackgroundTaskScheduler>(
    TOKENS.BackgroundTaskScheduler
  );

  // Initialize health check manager
  const healthManager = createHealthCheckManager(
    {
      timeout: 5000,
      interval: 30000,
      retries: 3,
      alertThresholds: {
        degradedLatency: 1000,
        unhealthyLatency: 5000,
        criticalFailureCount: 3,
      },
    },
    scheduler
  );

  // Initialize adapters
  const repoAdapter = createPrismaRepoAdapter({ scheduler });
  const queueAdapter = fastify
    .container!.resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
    .forQueue(QUEUE_NAMES.PUBLISH);
  const storageAdapter = createS3StorageAdapter({
    bucket: env.S3_BUCKET || "omni-post-media",
    region: env.S3_REGION || "us-east-1",
    accessKeyId: env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
  });

  // Register health checkers
  healthManager.register("database", new DatabaseHealthChecker(repoAdapter), {
    type: "database",
    critical: true,
  });

  healthManager.register("redis", new RedisHealthChecker(redis), {
    type: "cache",
    critical: true,
  });

  healthManager.register("cache", new CacheHealthChecker(cacheManager), {
    type: "cache",
    critical: false,
  });

  healthManager.register("queue", new QueueHealthChecker(queueAdapter), {
    type: "queue",
    critical: true,
  });

  healthManager.register("storage", new StorageHealthChecker(storageAdapter), {
    type: "storage",
    critical: false,
  });

  healthManager.register("providers", new ProviderHealthChecker(providerRegistry), {
    type: "external_api",
    critical: false,
  });

  /**
   * Simple health check
   * Returns 200 if system is healthy, 503 if unhealthy
   *
   * This is the fastest health check endpoint.
   *
   * §3.1 Normalization Roadmap — response schema Zod migrado (Phase A1).
   */
  const healthResponseSchema = z.object({
    status: z.enum(["healthy", "degraded", "unhealthy"]),
    timestamp: z.string(),
    uptime: z.number().optional(),
  });
  fastify.get(
    "/health",
    {
      schema: {
        tags: ["Health"],
        summary: "Simple health check",
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const status = healthManager.getCurrentStatus();

      if (!status) {
        // Health checks not yet initialized, perform quick check
        const quickCheck = await healthManager.checkAll();
        const isHealthy = quickCheck.overall === "healthy";

        return reply.status(isHealthy ? 200 : 503).send({
          status: quickCheck.overall,
          timestamp: new Date().toISOString(),
        });
      }

      const isHealthy = status.overall === "healthy";

      return reply.status(isHealthy ? 200 : 503).send({
        status: status.overall,
        timestamp: status.timestamp.toISOString(),
        uptime: status.uptime,
      });
    }
  );

  /**
   * Detailed health check
   * Returns comprehensive health information including all dependencies
   */
  fastify.get(
    "/health/detailed",
    { schema: { tags: ["Health"], summary: "Detailed health check with all dependencies" } },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const report = await healthManager.checkAll();

      const statusCode =
        report.overall === "healthy" ? 200 : report.overall === "degraded" ? 200 : 503;

      return reply.status(statusCode).send({
        ok: report.overall !== "unhealthy",
        status: report.overall,
        score: report.score,
        timestamp: report.timestamp.toISOString(),
        uptime: report.uptime,
        dependencies: report.dependencies.map((dep) => ({
          name: dep.name,
          type: dep.type,
          status: dep.status,
          latency: dep.latency,
          message: dep.message,
          critical: dep.critical,
          lastChecked: dep.lastChecked.toISOString(),
          ...(dep.details && { details: dep.details }),
        })),
        metrics: {
          memory: {
            heapUsed: report.metrics.memory.heapUsed,
            heapTotal: report.metrics.memory.heapTotal,
            external: report.metrics.memory.external,
            rss: report.metrics.memory.rss,
          },
          cpu: report.metrics.cpu,
        },
        alerts: report.alerts.map((alert) => ({
          id: alert.id,
          level: alert.level,
          message: alert.message,
          dependency: alert.dependency,
          timestamp: alert.timestamp.toISOString(),
          acknowledged: alert.acknowledged,
        })),
      });
    }
  );

  /**
   * Kubernetes liveness probe
   * Returns 200 if the application is alive (can serve traffic)
   *
   * This probe should only fail if the application is completely broken.
   * Kubernetes will restart the pod if this fails.
   *
   * §3.1 Normalization Roadmap — response schema Zod migrado (Phase A1).
   */
  const liveResponseSchema = z.object({
    status: z.literal("alive"),
    timestamp: z.string(),
    uptime: z.number(),
  });
  fastify.get(
    "/health/live",
    {
      schema: {
        tags: ["Health"],
        summary: "Kubernetes liveness probe",
        response: { 200: liveResponseSchema },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      // Liveness check is very simple - just verify the process is responsive
      return reply.send({
        status: "alive",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    }
  );

  /**
   * Kubernetes readiness probe
   * Returns 200 if the application is ready to serve traffic
   *
   * This probe checks critical dependencies. If it fails, Kubernetes
   * will stop routing traffic to this pod but won't restart it.
   *
   * §3.1 Normalization Roadmap — response schema Zod migrado (Phase A1).
   */
  const readyOkSchema = z.object({
    status: z.literal("ready"),
    timestamp: z.string(),
  });
  const readyFailSchema = z.object({
    status: z.literal("not ready"),
    timestamp: z.string(),
    message: z.string(),
    unhealthyDependencies: z.array(z.string()),
  });
  fastify.get(
    "/health/ready",
    {
      schema: {
        tags: ["Health"],
        summary: "Kubernetes readiness probe",
        response: { 200: readyOkSchema, 503: readyFailSchema },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      // Check only critical dependencies for readiness
      const criticalChecks = ["database", "redis", "queue"];

      const results = await Promise.all(
        criticalChecks.map((name) => healthManager.checkDependency(name))
      );

      const allHealthy = results.every((result) => result.ok && result.value.status === "healthy");

      if (!allHealthy) {
        const unhealthyDeps = results
          .filter((result) => !result.ok || result.value.status !== "healthy")
          .map((result, idx) => criticalChecks[idx]);

        return reply.status(503).send({
          status: "not ready",
          timestamp: new Date().toISOString(),
          message: "Critical dependencies unhealthy",
          unhealthyDependencies: unhealthyDeps,
        });
      }

      return reply.send({
        status: "ready",
        timestamp: new Date().toISOString(),
      });
    }
  );

  /**
   * Individual dependency health check
   * Returns health status of a specific dependency
   */
  fastify.get(
    "/health/dependency/:name",
    { schema: { tags: ["Health"], summary: "Individual dependency health check" } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsSchema = z.object({ name: z.string() });

      try {
        const { name } = paramsSchema.parse(request.params);
        const result = await healthManager.checkDependency(name);

        if (!result.ok) {
          return reply.status(404).send({
            error: `Dependency '${name}' not found`,
            availableDependencies: Array.from(healthManager["checkers"].keys()),
          });
        }

        const dependency = result.value;
        const isHealthy = dependency.status === "healthy";

        return reply.status(isHealthy ? 200 : 503).send({
          ok: isHealthy,
          dependency: name,
          status: dependency.status,
          latency: dependency.latency,
          message: dependency.message,
          critical: dependency.critical,
          lastChecked: dependency.lastChecked.toISOString(),
          ...(dependency.details && { details: dependency.details }),
        });
      } catch {
        return reply.status(400).send({
          error: "Invalid dependency name",
        });
      }
    }
  );

  // Start periodic health checks
  healthManager.start();

  // Stop health checks on server shutdown
  fastify.addHook("onClose", async () => {
    healthManager.stop();
  });
}
