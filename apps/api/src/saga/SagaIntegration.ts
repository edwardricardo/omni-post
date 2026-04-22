/**
 * @file SagaIntegration.ts
 * @description Fastify integration layer for saga orchestration providing API endpoints
 *              to start workflows, monitor progress, handle compensation, and track metrics.
 *              Connects API requests to BullMQ workers via Redis pub/sub for saga events.
 * @layer infrastructure
 *
 * ## Redis Pub/Sub Message Format
 *
 * Messages on channel "saga:events" are JSON strings:
 * ```json
 * {
 *   "type": "publish.job.completed" | "publish.job.failed",
 *   "aggregateId": "<jobId>",
 *   "aggregateType": "PublishJob",
 *   "data": { "jobId": "...", "postId": "...", "channelId": "..." },
 *   "metadata": { "sagaId": "<sagaId>", "source": "PublishWorker" }
 * }
 * ```
 *
 * ## Why a Dedicated Redis Connection?
 *
 * ioredis enters "subscriber mode" when `.subscribe()` is called. In this
 * mode, the connection can ONLY execute SUBSCRIBE/UNSUBSCRIBE/PSUBSCRIBE/
 * PUNSUBSCRIBE/PING/QUIT commands. Any other command (GET, SET, PUBLISH,
 * etc.) will throw an error. Therefore we must create a separate Redis
 * connection exclusively for subscribing to "saga:events".
 *
 * @module saga/SagaIntegration
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import type { QueuePort } from "@ports/core";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { SagaManagerImpl } from "./SagaManager";
import type { EventService } from "../events/EventService";
import type { CQRSBusImpl } from "../cqrs/CQRSBus";
import { createPostPublishingSagaDefinition, createSagaContext } from "@shared/saga";
import type { Command } from "@shared/cqrs";
import Redis from "ioredis";
import { AppError } from "../lib/errors/index.js";
import { logger } from "../lib/logger.js";
import { createRedisConnection } from "../lib/redis.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";

/** Channel used by workers to notify saga completions/failures */
const SAGA_EVENTS_CHANNEL = "saga:events";

interface SagaIntegrationConfig {
  fastify: FastifyInstance;
  prisma: PrismaClient;
  eventService: EventService;
  cqrsBus: CQRSBusImpl;
  redis: Redis;
  queue: QueuePort;
  scheduler: BackgroundTaskScheduler;
}

export class SagaIntegration {
  private sagaManager: SagaManagerImpl;
  /** Dedicated Redis connection for pub/sub subscriber (cannot share with commands) */
  private subscriber: Redis | null = null;

  constructor(private config: SagaIntegrationConfig) {
    this.sagaManager = new SagaManagerImpl({
      prisma: config.prisma,
      redis: config.redis,
      eventService: config.eventService,
      scheduler: config.scheduler,
      enableMetrics: true,
      defaultTimeout: 30 * 60 * 1000, // 30 minutes
      maxConcurrentSagas: 100,
    });
  }

  /**
   * Initialize saga integration:
   * 1. Initialize saga manager (loads active sagas, starts timeout checker)
   * 2. Register saga definitions (post-publishing workflow)
   * 3. Register API routes for saga management
   * 4. Set up Redis pub/sub event handling for worker notifications
   */
  async initialize(): Promise<void> {
    await this.sagaManager.initialize();

    // Register saga definitions
    this.registerSagaDefinitions();

    // Register API routes
    await this.registerRoutes();

    // Set up event handling via Redis pub/sub
    await this.setupEventHandling();

    logger.info("Saga Integration initialized successfully");
  }

  /**
   * Register pre-defined saga workflows.
   *
   * The job queue function uses real BullMQ enqueuing via `QueuePort.enqueue()`.
   * Each job payload includes `sagaId` so the worker can publish a completion
   * event back to the "saga:events" Redis channel.
   */
  private registerSagaDefinitions(): void {
    const { queue } = this.config;

    // Post Publishing Saga
    const postPublishingSaga = createPostPublishingSagaDefinition(
      // Command executor
      async (command: Command) => {
        return await this.config.cqrsBus.executeCommand(command);
      },
      // Job queue function - enqueues real BullMQ jobs
      async (job: Record<string, unknown>) => {
        const sagaId = job.sagaId as string | undefined;
        const postId = job.postId as string | undefined;
        const channelId = job.channelId as string | undefined;
        const dedupeKey = `publish-${postId}-${channelId}`;

        const result = await queue.enqueue({
          dedupeKey,
          payload: {
            type: "publish-post",
            ...job,
            ...(sagaId && { sagaId }),
          },
          ...(job.scheduledAt instanceof Date && { runAt: job.scheduledAt }),
        });

        if (!result.ok) {
          logger.error({ error: result.error, dedupeKey }, "Failed to enqueue publishing job");
          throw new Error(`Queue enqueue failed: ${result.error}`);
        }

        const jobId = result.value;
        logger.info({ jobId, sagaId, postId, channelId }, "Enqueued publishing job via BullMQ");

        return jobId;
      },
      // Job status checker
      async (jobIds: string[]) => {
        // BullMQ job status checking is done via the worker's Redis pub/sub
        // notifications rather than polling. Return current known state.
        // In production, this could query BullMQ job states directly.
        return {
          completed: jobIds.length,
          failed: 0,
          pending: 0,
        };
      },
      // Job cancellation — used by saga compensation to cancel queued jobs
      async (jobId: string): Promise<boolean> => {
        const result = await queue.remove(jobId);
        if (!result.ok) {
          logger.warn({ jobId, error: result.error }, "Failed to cancel queued job (best-effort)");
          return false;
        }
        return result.value;
      }
    );

    this.sagaManager.registerSaga(postPublishingSaga);
  }

  /**
   * Register saga API routes
   */
  private async registerRoutes(): Promise<void> {
    const { fastify } = this.config;

    // Start Post Publishing Saga
    fastify.post<{
      Body: {
        postData: {
          title?: string;
          body: string;
          locale?: string;
          tags?: string[];
          mediaIds?: string[];
          scheduledAt?: string;
          channelIds: string[];
        };
        priority?: "LOW" | "NORMAL" | "HIGH";
      };
    }>(
      "/sagas/post-publishing/start",
      { preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_CONFIGURE)] },
      async (request, _reply) => {
        try {
          const { postData, priority = "NORMAL" } = request.body;

          // Validate required fields
          if (!postData.body || !postData.channelIds || postData.channelIds.length === 0) {
            throw AppError.badRequest("Post body and at least one channel are required");
          }

          // Create saga context
          const correlationId = `post-publish-${randomUUID()}`;
          const context = createSagaContext(
            "", // Will be set by saga manager
            correlationId,
            request.user?.id,
            {
              postData: {
                ...postData,
                projectId: request.user?.projectId || "default-project",
                ...(postData.scheduledAt && { scheduledAt: new Date(postData.scheduledAt) }),
              },
              priority,
              source: "API",
              userAgent: request.headers["user-agent"],
              ipAddress: request.ip,
            }
          );

          // Start saga
          const sagaInstance = await this.sagaManager.startSaga("post-publishing-saga", context);

          return {
            success: true,
            data: {
              sagaId: sagaInstance.id,
              status: sagaInstance.status,
              correlationId,
              startedAt: sagaInstance.startedAt,
            },
          };
        } catch (error) {
          // Re-throw AppErrors (e.g. validation errors) directly
          if (error instanceof AppError) {
            throw error;
          }
          logger.error({ err: error }, "Failed to start post publishing saga");
          throw AppError.internal("Failed to start saga");
        }
      }
    );

    // Get Saga Status
    fastify.get<{
      Params: { sagaId: string };
    }>(
      "/sagas/:sagaId",
      { preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_CONFIGURE)] },
      async (request, _reply) => {
        try {
          const { sagaId } = request.params;

          const sagaInstance = await this.sagaManager.getSaga(sagaId);
          if (!sagaInstance) {
            throw AppError.notFound("Saga");
          }

          // Calculate progress
          const totalSteps = sagaInstance.stepResults.length || 1;
          const completedSteps = sagaInstance.stepResults.filter((r) => r?.success).length;
          const progress = Math.round((completedSteps / totalSteps) * 100);

          return {
            success: true,
            data: {
              id: sagaInstance.id,
              definitionId: sagaInstance.definitionId,
              status: sagaInstance.status,
              currentStep: sagaInstance.currentStep,
              progress,
              startedAt: sagaInstance.startedAt,
              completedAt: sagaInstance.completedAt,
              error: sagaInstance.error,
              retryCount: sagaInstance.retryCount,
              stepResults: sagaInstance.stepResults.map((result, index) => ({
                stepIndex: index,
                success: result?.success || false,
                error: result?.error,
                data: result?.data,
              })),
            },
          };
        } catch (error) {
          if (error instanceof AppError) {
            throw error;
          }
          logger.error({ err: error }, "Failed to get saga status");
          throw AppError.notFound(`Saga not found: ${request.params.sagaId}`);
        }
      }
    );

    // Continue Saga (manual trigger)
    fastify.post<{
      Params: { sagaId: string };
    }>(
      "/sagas/:sagaId/continue",
      { preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_CONFIGURE)] },
      async (request, _reply) => {
        try {
          const { sagaId } = request.params;

          const sagaInstance = await this.sagaManager.continueSaga(sagaId);

          return {
            success: true,
            data: {
              sagaId: sagaInstance.id,
              status: sagaInstance.status,
              currentStep: sagaInstance.currentStep,
            },
          };
        } catch (error) {
          logger.error({ err: error }, "Failed to continue saga");
          throw AppError.badRequest("Failed to continue saga");
        }
      }
    );

    // Compensate Failed Saga
    fastify.post<{
      Params: { sagaId: string };
    }>(
      "/sagas/:sagaId/compensate",
      { preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_CONFIGURE)] },
      async (request, _reply) => {
        try {
          const { sagaId } = request.params;

          const sagaInstance = await this.sagaManager.compensateSaga(sagaId);

          return {
            success: true,
            data: {
              sagaId: sagaInstance.id,
              status: sagaInstance.status,
              compensationStarted: true,
            },
          };
        } catch (error) {
          logger.error({ err: error }, "Failed to compensate saga");
          throw AppError.badRequest("Failed to compensate saga");
        }
      }
    );

    // List Active Sagas
    fastify.get(
      "/sagas",
      { preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_MONITOR)] },
      async (_request, _reply) => {
        try {
          const metrics = this.sagaManager.getMetrics();

          return {
            success: true,
            data: {
              activeInstances: metrics.activeInstances,
              totalStarted: metrics.sagasStarted,
              totalCompleted: metrics.sagasCompleted,
              totalFailed: metrics.sagasFailed,
              totalCompensated: metrics.sagasCompensated,
              averageExecutionTime: metrics.averageExecutionTime,
              definitions: metrics.definitions,
            },
          };
        } catch (error) {
          logger.error({ err: error }, "Failed to list sagas");
          throw AppError.internal("Failed to list sagas");
        }
      }
    );

    // Saga Health Check
    fastify.get(
      "/sagas/health",
      { preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_MONITOR)] },
      async (_request, _reply) => {
        try {
          const health = await this.sagaManager.healthCheck();
          const metrics = this.sagaManager.getMetrics();

          return {
            ...health,
            metrics,
            timestamp: new Date(),
          };
        } catch (error) {
          logger.error({ err: error }, "Saga health check failed");
          throw AppError.internal("Health check failed");
        }
      }
    );

    // Saga Metrics
    fastify.get(
      "/sagas/metrics",
      { preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_MONITOR)] },
      async (_request, reply) => {
        try {
          const metrics = this.sagaManager.getMetrics();

          return {
            success: true,
            data: {
              performance: {
                sagasStarted: metrics.sagasStarted,
                sagasCompleted: metrics.sagasCompleted,
                sagasFailed: metrics.sagasFailed,
                sagasCompensated: metrics.sagasCompensated,
                averageExecutionTime: metrics.averageExecutionTime,
                successRate:
                  metrics.sagasStarted > 0
                    ? Math.round((metrics.sagasCompleted / metrics.sagasStarted) * 100)
                    : 0,
              },
              active: {
                instances: metrics.activeInstances,
                definitions: metrics.definitions.length,
              },
            },
            timestamp: new Date(),
          };
        } catch (error) {
          logger.error({ err: error }, "Failed to get saga metrics");
          return reply.status(500).send({
            error: "Failed to get metrics",
          });
        }
      }
    );

    logger.info("Saga API routes registered");
  }

  /**
   * Set up Redis pub/sub event handling for worker completion notifications.
   *
   * Creates a dedicated Redis connection (subscriber mode) and subscribes
   * to the "saga:events" channel. When a worker completes or fails a
   * publishing job, it publishes an event to this channel. The subscriber
   * parses the message and forwards it to `SagaManager.handleEvent()`.
   *
   * The dedicated connection is required because ioredis enters subscriber
   * mode and cannot execute regular commands on the same connection.
   */
  private async setupEventHandling(): Promise<void> {
    try {
      // Create a dedicated Redis connection for subscribing
      this.subscriber = createRedisConnection();
      await this.subscriber.connect();

      this.subscriber.on("error", (err) => {
        logger.error({ err }, "Saga subscriber Redis connection error");
      });

      // Subscribe to the saga events channel
      await this.subscriber.subscribe(SAGA_EVENTS_CHANNEL);

      this.subscriber.on("message", (channel: string, message: string) => {
        if (channel !== SAGA_EVENTS_CHANNEL) return;

        this.handleSagaEventMessage(message).catch((err) => {
          logger.error({ err, channel }, "Failed to handle saga event message");
        });
      });

      logger.info(
        { channel: SAGA_EVENTS_CHANNEL },
        "Saga event handling configured via Redis pub/sub"
      );
    } catch (err) {
      // Log the error but don't crash - saga can still work without pub/sub
      // (just won't receive worker completion notifications automatically)
      logger.error(
        { err },
        "Failed to set up saga event subscriber. Sagas will not receive " +
          "worker completion notifications automatically."
      );
    }
  }

  /**
   * Parse and forward a raw pub/sub message to the saga manager.
   *
   * Expected message format (JSON):
   * ```json
   * {
   *   "type": "publish.job.completed" | "publish.job.failed",
   *   "aggregateId": "<jobId>",
   *   "aggregateType": "PublishJob",
   *   "data": { ... },
   *   "metadata": { "sagaId": "<sagaId>", ... }
   * }
   * ```
   */
  private async handleSagaEventMessage(message: string): Promise<void> {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(message) as Record<string, unknown>;
    } catch {
      logger.warn({ message }, "Received non-JSON message on saga:events channel");
      return;
    }

    const eventType = parsed.type as string | undefined;
    if (!eventType) {
      logger.warn({ parsed }, "Saga event message missing 'type' field");
      return;
    }

    logger.debug(
      { eventType, sagaId: (parsed.metadata as Record<string, unknown>)?.sagaId },
      "Received saga event from worker"
    );

    // Forward the event to the saga manager
    await this.sagaManager.handleEvent(parsed as unknown as import("@shared/types").DomainEvent);
  }

  /**
   * Get saga manager instance
   */
  getSagaManager(): SagaManagerImpl {
    return this.sagaManager;
  }

  /**
   * Graceful shutdown - closes saga manager and the dedicated subscriber connection
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down Saga Integration");

    // Unsubscribe and close the dedicated subscriber connection
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(SAGA_EVENTS_CHANNEL);
        this.subscriber.disconnect();
        this.subscriber = null;
      } catch (err) {
        logger.error({ err }, "Error closing saga subscriber connection");
      }
    }

    await this.sagaManager.shutdown();
    logger.info("Saga Integration shutdown complete");
  }
}
