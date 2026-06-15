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
import { z } from "zod";
import type { PrismaClient } from "@infra/prisma";
import type { QueuePort } from "@ports/core";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { SagaManagerImpl } from "./SagaManager.js";
import type { EventService } from "../events/EventService.js";
import type { CQRSBusImpl } from "../cqrs/CQRSBus.js";
import { createPostPublishingSagaDefinition, createSagaContext } from "@shared/types/saga.js";
import type { Command } from "@shared/types/cqrs.js";
import type { Redis } from "ioredis";
import { AppError } from "../lib/errors/index.js";
import { logger } from "../lib/logger.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { SecureSchemas } from "../security/inputValidation.js";
import { ProjectId, AccountId, PostId } from "@core/domain/value-objects/EntityId.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { PostRepository } from "@core/domain/repositories/PostRepository.js";
import type { SemanticLockPort } from "@ports/core";

/** Channel used by workers to notify saga completions/failures */
const SAGA_EVENTS_CHANNEL = "saga:events";

interface SagaIntegrationConfig {
  fastify: FastifyInstance;
  prisma: PrismaClient;
  /** Required for full operation; omitted when schemaOnly=true (routes register
   *  but no saga steps can execute). */
  eventService?: EventService;
  /** Required for full operation; omitted when schemaOnly=true. */
  cqrsBus?: CQRSBusImpl;
  redis: Redis;
  /**
   * Dedicated pub/sub (subscriber-mode) Redis connection for the "saga:events"
   * channel. MUST be constructed with `maxRetriesPerRequest: null` (long-lived
   * blocking subscribe) and is distinct from `redis` (regular-command) because
   * ioredis enters subscriber mode and cannot run regular commands on the same
   * socket. Owned by the composition root (TOKENS.SagaSubscriberConnection);
   * this integration disconnects it on shutdown but never self-constructs it.
   */
  sagaSubscriber: Redis;
  queue: QueuePort;
  scheduler: BackgroundTaskScheduler;
  /** Required for the customer-facing /start endpoint to verify project ownership */
  projectRepository: ProjectRepositoryPort;
  /** Required for the customer-facing /start endpoint to verify channel ownership */
  channelRepository: ChannelRepository;
  /** Required for the customer-facing /start endpoint to verify ownership +
   * status of the existing post when `postId` is provided in the body. */
  postRepository: PostRepository;
  /** Optional semantic-lock backend for concurrency control (Azure §15-20).
   * When provided, sagas with `semanticLock` countermeasures gate their
   * execution through this store. Omit in tests that do not exercise the
   * concurrency check. */
  lockStore?: SemanticLockPort;
  /** When true: only register API routes (for OpenAPI schema generation) without
   *  starting background services (EventService, Redis pub/sub, BullMQ). This
   *  keeps all saga paths present in the generated OpenAPI schema while avoiding
   *  long-lived connections that prevent process exit during schema dumps. */
  schemaOnly?: boolean;
}

/**
 * Required everywhere: project context.
 */
const SagaPostBaseSchema = {
  projectId: z.string().uuid(),
} as const;

/**
 * Content fields used when the saga creates a NEW post. For schedule and
 * publish-now modes these are mutually exclusive with `postId` — the schema
 * refinement below enforces XOR.
 */
const PostContentFieldsSchema = {
  locale: z.string().min(2).max(5).optional(),
  body: SecureSchemas.postBody.optional(),
  title: SecureSchemas.userName.optional(),
  tags: z.array(z.string()).default([]),
  mediaIds: z.array(z.string().uuid()).default([]),
} as const;

/**
 * Refinement applied to schedule/publish-now schemas: caller MUST provide
 * either `postId` (operate on existing draft) OR content (`locale` + `body`
 * for a new post) — not both, and not neither.
 */
function refineExistingOrNew<
  T extends {
    postId?: string | undefined;
    locale?: string | undefined;
    body?: string | undefined;
  },
>(data: T, ctx: z.RefinementCtx): void {
  const hasPostId = typeof data.postId === "string" && data.postId.length > 0;
  const hasContent =
    typeof data.locale === "string" &&
    data.locale.length > 0 &&
    typeof data.body === "string" &&
    data.body.length > 0;

  if (hasPostId && hasContent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either postId (existing draft) or content (locale + body), not both",
    });
  }
  if (!hasPostId && !hasContent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either postId (existing draft) or content (locale + body) is required",
    });
  }
}

const StartPostPublishingSagaBodySchema = z.discriminatedUnion("mode", [
  // Draft: only the create-from-scratch path makes sense (cannot "draft" an
  // already-existing post). Body + locale required.
  z.object({
    mode: z.literal("draft"),
    ...SagaPostBaseSchema,
    locale: z.string().min(2).max(5),
    body: SecureSchemas.postBody,
    title: SecureSchemas.userName.optional(),
    tags: z.array(z.string()).default([]),
    mediaIds: z.array(z.string().uuid()).default([]),
  }),
  z
    .object({
      mode: z.literal("schedule"),
      ...SagaPostBaseSchema,
      postId: z.string().uuid().optional(),
      ...PostContentFieldsSchema,
      channelIds: z.array(z.string().uuid()).min(1, "At least one channel is required"),
      scheduledAt: z.string().datetime(),
    })
    .superRefine(refineExistingOrNew),
  z
    .object({
      mode: z.literal("publish-now"),
      ...SagaPostBaseSchema,
      postId: z.string().uuid().optional(),
      ...PostContentFieldsSchema,
      channelIds: z.array(z.string().uuid()).min(1, "At least one channel is required"),
    })
    .superRefine(refineExistingOrNew),
]);

type StartPostPublishingSagaBody = z.infer<typeof StartPostPublishingSagaBodySchema>;

export class SagaIntegration {
  private sagaManager: SagaManagerImpl;
  /** Dedicated Redis connection for pub/sub subscriber (cannot share with commands) */
  private subscriber: Redis | null = null;

  constructor(private config: SagaIntegrationConfig) {
    // SagaManagerImpl is constructed unconditionally so route handlers can
    // reference it at registration time. Under schemaOnly=true the manager
    // is never initialized (initialize() skips sagaManager.initialize() +
    // service startup), so no DB/Redis connections are opened. Route handler
    // closures that call sagaManager methods are only invoked at request-time
    // (never during route registration), so SCHEMA_ONLY dumps work correctly.
    this.sagaManager = new SagaManagerImpl({
      prisma: config.prisma,
      redis: config.redis,
      // eventService is omitted in schemaOnly mode; SagaManagerImpl accepts
      // it as optional for the same reason — no steps execute without it.
      ...(config.eventService && { eventService: config.eventService }),
      scheduler: config.scheduler,
      enableMetrics: true,
      defaultTimeout: 30 * 60 * 1000, // 30 minutes
      maxConcurrentSagas: 100,
      ...(config.lockStore && { lockStore: config.lockStore }),
    });
  }

  /**
   * Initialize saga integration.
   *
   * When `schemaOnly=true` (SCHEMA_ONLY OpenAPI dump mode):
   *   - Only registers API routes so all saga paths appear in the OpenAPI schema.
   *   - Skips sagaManager.initialize(), saga definitions, and Redis pub/sub setup
   *     so no long-lived connections are opened and `process.exit(0)` can fire.
   *
   * When `schemaOnly=false` (normal operation):
   *   1. Initialize saga manager (loads active sagas, starts timeout checker)
   *   2. Register saga definitions (post-publishing workflow)
   *   3. Register API routes for saga management
   *   4. Set up Redis pub/sub event handling for worker notifications
   */
  async initialize(): Promise<void> {
    // Routes always register — required for a complete OpenAPI schema regardless
    // of SCHEMA_ONLY mode.
    await this.registerRoutes();

    if (this.config.schemaOnly) {
      logger.info("Saga Integration: routes registered (schema-only mode, services skipped)");
      return;
    }

    // Full startup path (normal operation only).
    await this.sagaManager.initialize();

    // Register saga definitions
    this.registerSagaDefinitions();

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
      // Command executor — cqrsBus is guaranteed present in full (non-schemaOnly)
      // operation; registerSagaDefinitions() is only called when schemaOnly=false.
      async (command: Command) => {
        return await this.config.cqrsBus!.executeCommand(command);
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
      // Job status checker — reads real BullMQ state via the QueuePort. The
      // event-driven flow (worker emits publish.job.completed/failed via
      // Redis pub/sub) is the primary path; this poll is the fallback when
      // the saga is resumed by the recovery scheduler instead of by an
      // event. Without it, a worker crash between publish and event emit
      // would silently mark posts as PUBLISHED that never published.
      async (jobIds: string[]) => {
        const result = await queue.getJobStates(jobIds);
        if (!result.ok) {
          // CONNECTION_ERROR — surface as all-pending so the step retries
          // (canon retryable behavior) instead of fabricating success.
          return { completed: 0, failed: 0, pending: jobIds.length };
        }
        return result.value;
      },
      // Reread implementation for the pivot step's RereadCheck countermeasure.
      // Confirms Post.status is still DRAFT immediately before enqueueing
      // jobs — prevents the dirty-read window where a manual Update or a
      // concurrent saga changed the status between Create and Schedule.
      async (postIdRaw: string): Promise<string | null> => {
        const idResult = PostId.fromString(postIdRaw);
        if (!idResult.ok) return null;
        const post = await this.config.postRepository.findById(idResult.value);
        if (!post.ok) return null;
        return post.value.status.value;
      }
      // No cancelJob: SchedulePublishingJobsStep is a PivotStep (point of
      // no return per Azure §5). Once jobs are accepted by BullMQ, workers
      // may dispatch to the provider before any saga-side cancel could
      // fire — compensation has no canonically valid semantics here.
    );

    this.sagaManager.registerSaga(postPublishingSaga);
  }

  /**
   * Register saga API routes
   */
  private async registerRoutes(): Promise<void> {
    const { fastify } = this.config;

    fastify.post<{ Body: StartPostPublishingSagaBody }>(
      "/sagas/post-publishing/start",
      { preHandler: [requireClientAuth] },
      async (request, _reply) => {
        const parsed = StartPostPublishingSagaBodySchema.safeParse(request.body);
        if (!parsed.success) {
          throw AppError.badRequest("Invalid saga start body", {
            issues: parsed.error.issues,
          });
        }
        const body = parsed.data;

        const customer = request.customerUser;
        if (!customer) {
          throw AppError.unauthorized("Customer authentication required");
        }

        try {
          const projectIdResult = ProjectId.fromString(body.projectId);
          if (!projectIdResult.ok) {
            throw AppError.badRequest("Invalid project ID");
          }
          const projectResult = await this.config.projectRepository.findById(projectIdResult.value);
          if (!projectResult.ok) {
            throw AppError.notFound("Project");
          }
          const project = projectResult.value;
          const customerAccountIdResult = AccountId.fromString(customer.accountId);
          if (!customerAccountIdResult.ok) {
            throw AppError.unauthorized("Invalid account identifier in token");
          }
          if (project.accountId.toString() !== customerAccountIdResult.value.toString()) {
            // Return 404 (not 403) to prevent project-id enumeration across tenants.
            throw AppError.notFound("Project");
          }

          if (body.mode !== "draft") {
            // Ownership-only lookup — bypasses credential decryption.
            const projectChannelIds = new Set(
              (await this.config.channelRepository.findIdsByProjectId(projectIdResult.value)).map(
                (id) => id.toString()
              )
            );
            for (const channelId of body.channelIds) {
              if (!projectChannelIds.has(channelId)) {
                // Return 404 (not 403) to prevent channel-id enumeration across tenants.
                throw AppError.notFound(`Channel ${channelId}`);
              }
            }
          }

          // Existing-draft path (schedule/publish-now with postId): verify the
          // post exists, belongs to this project, and is still in DRAFT status.
          // Re-publishing a post already in PUBLISHED/SCHEDULED would create
          // a duplicate publish job — surface as a client error instead.
          const providedPostId =
            body.mode !== "draft" && typeof body.postId === "string" ? body.postId : null;
          if (providedPostId !== null) {
            const postIdResult = PostId.fromString(providedPostId);
            if (!postIdResult.ok) {
              throw AppError.badRequest("Invalid post ID");
            }
            const postLookup = await this.config.postRepository.findById(postIdResult.value);
            if (!postLookup.ok) {
              throw AppError.notFound("Post");
            }
            const post = postLookup.value;
            if (post.projectId.toString() !== projectIdResult.value.toString()) {
              // Post belongs to another project — return 404 to prevent
              // post-id enumeration across projects.
              throw AppError.notFound("Post");
            }
            if (post.status.value !== "DRAFT") {
              throw AppError.badRequest(
                `Post is in ${post.status.value} status; only DRAFT posts can be scheduled or published via this saga`
              );
            }
          }

          const correlationId = `post-publish-${randomUUID()}`;
          const postData: Record<string, unknown> = {
            projectId: body.projectId,
            ...(body.mode === "draft" && {
              locale: body.locale,
              body: body.body,
              tags: body.tags,
              mediaIds: body.mediaIds,
              ...(body.title !== undefined && { title: body.title }),
            }),
            ...(body.mode !== "draft" &&
              providedPostId === null && {
                ...(body.locale !== undefined && { locale: body.locale }),
                ...(body.body !== undefined && { body: body.body }),
                tags: body.tags,
                mediaIds: body.mediaIds,
                ...(body.title !== undefined && { title: body.title }),
              }),
            ...(providedPostId !== null && { postId: providedPostId }),
            ...("channelIds" in body && { channelIds: body.channelIds }),
            ...(body.mode === "schedule" && { scheduledAt: new Date(body.scheduledAt) }),
          };

          const context = createSagaContext("", correlationId, customer.id, {
            mode: body.mode,
            postData,
            accountId: customer.accountId,
            source: "customer-api",
            userAgent: request.headers["user-agent"],
            ipAddress: request.ip,
          });

          const sagaInstance = await this.sagaManager.startSaga("post-publishing-saga", context);

          return {
            success: true,
            data: {
              sagaId: sagaInstance.id,
              status: sagaInstance.status,
              mode: body.mode,
              correlationId,
              startedAt: sagaInstance.startedAt,
            },
          };
        } catch (error) {
          if (error instanceof AppError) {
            throw error;
          }
          logger.error(
            { err: error, customerId: customer.id, mode: body.mode },
            "Failed to start post publishing saga"
          );
          throw AppError.internal("Failed to start saga");
        }
      }
    );

    fastify.get<{
      Params: { sagaId: string };
    }>("/sagas/:sagaId", { preHandler: [requireClientAuth] }, async (request, _reply) => {
      const customer = request.customerUser;
      if (!customer) {
        throw AppError.unauthorized("Customer authentication required");
      }

      try {
        const { sagaId } = request.params;

        const sagaInstance = await this.sagaManager.getSaga(sagaId);
        if (!sagaInstance) {
          throw AppError.notFound("Saga");
        }

        if (sagaInstance.context.userId !== customer.id) {
          // Return 404 (not 403) to prevent saga-id enumeration across tenants.
          throw AppError.notFound("Saga");
        }

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
    });

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
      // Dedicated subscriber-mode Redis connection, injected by the composition
      // root (TOKENS.SagaSubscriberConnection, built with
      // `maxRetriesPerRequest: null` — a long-lived blocking connection; the
      // factory omits commandTimeout for these since subscribe() blocks waiting
      // for messages). The integration never self-constructs this socket.
      this.subscriber = this.config.sagaSubscriber;
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
    await this.sagaManager.handleEvent(
      parsed as unknown as import("@shared/types").EventStoreEvent
    );
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
