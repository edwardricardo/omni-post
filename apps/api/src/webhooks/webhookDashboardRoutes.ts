/**
 * @file webhookDashboardRoutes.ts
 * @description Fastify route plugin for the webhook admin dashboard providing metrics,
 *              event search, DLQ management, and real-time WebSocket upgrades.
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { WebhookDashboardService } from "./webhookDashboardService.js";
import type { RealtimeWebhookBroadcaster } from "./realtimeWebhookBroadcaster.js";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";

// Dashboard query schemas
const DashboardQuerySchema = z.object({
  timeRange: z.enum(["1h", "6h", "24h", "7d", "30d"]).optional().default("24h"),
  provider: z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"]).optional(),
  projectId: z.string().uuid().optional(),
  status: z.enum(["PROCESSING", "COMPLETED", "FAILED", "RETRYING", "DEAD_LETTER"]).optional(),
});

const EventsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  provider: z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"]).optional(),
  status: z.enum(["PROCESSING", "COMPLETED", "FAILED", "RETRYING", "DEAD_LETTER"]).optional(),
  search: z.string().optional(),
});

const EventIdParamsSchema = z.object({
  eventId: z.string().uuid(),
});

/**
 * Webhook Dashboard Route Handler
 * Service is injected via constructor (resolved from DI container in registerWebhookDashboardRoutes).
 */
class WebhookDashboardRouteHandler extends BaseRouteHandler {
  protected routeName = "webhook-dashboard";

  constructor(
    private readonly service: WebhookDashboardService,
    private readonly broadcaster: RealtimeWebhookBroadcaster,
    private readonly scheduler: BackgroundTaskScheduler
  ) {
    super();
  }

  async getDashboardMetrics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<{ query: z.infer<typeof DashboardQuerySchema> }>(
      ctx,
      {
        query: DashboardQuerySchema,
      }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const metrics = await this.service.getDashboardMetrics(accountId, validated.value.query);
    return this.sendSuccess(ctx, metrics);
  }

  async getRecentEvents(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<{ query: z.infer<typeof EventsQuerySchema> }>(
      ctx,
      {
        query: EventsQuerySchema,
      }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const result = await this.service.getRecentEvents(accountId, validated.value.query);
    return this.sendSuccess(ctx, result);
  }

  async getEventDetails(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<{ params: z.infer<typeof EventIdParamsSchema> }>(
      ctx,
      {
        params: EventIdParamsSchema,
      }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid event ID");
    }

    const event = await this.service.getEventDetails(accountId, validated.value.params.eventId);
    return this.sendSuccess(ctx, event);
  }

  async getSubscriptions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const subscriptionsWithStats = await this.service.getSubscriptions(accountId);
    return this.sendSuccess(ctx, subscriptionsWithStats);
  }

  async getDeadLetterQueue(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<{ query: z.infer<typeof EventsQuerySchema> }>(
      ctx,
      {
        query: EventsQuerySchema,
      }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const result = await this.service.getDeadLetterQueue(accountId, validated.value.query);
    return this.sendSuccess(ctx, result);
  }

  async retryDeadLetterEvent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<{ params: z.infer<typeof EventIdParamsSchema> }>(
      ctx,
      {
        params: EventIdParamsSchema,
      }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid event ID");
    }

    const result = await this.service.retryDeadLetterEvent(
      accountId,
      validated.value.params.eventId,
      request.auth?.user?.id
    );
    return this.sendSuccess(ctx, result);
  }

  async retryAllDeadLetterEvents(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const userId = request.auth?.user?.id;

    if (!userId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.service.retryAllDeadLetterEvents(userId);
    return this.sendSuccess(ctx, result);
  }

  async streamWebhookEvents(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    });

    // Send initial connection message
    reply.raw.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date() })}\n\n`);

    this.logInfo(ctx, "SSE connection established for webhook monitoring", {
      accountId,
    });

    // Subscribe to real-time webhook events from the broadcaster
    const unsubscribe = this.broadcaster.subscribeSSE(accountId, (event) => {
      try {
        if (!reply.raw.destroyed) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } catch (error) {
        this.logError(ctx, "Error writing SSE event to stream", { error });
      }
    });

    // Keep connection alive with heartbeats. Task ID is unique per SSE connection.
    const keepAliveTaskId = `webhook-dashboard-heartbeat-${randomUUID()}`;
    this.scheduler.register(
      keepAliveTaskId,
      () => {
        if (!reply.raw.destroyed) {
          reply.raw.write(
            `data: ${JSON.stringify({ type: "heartbeat", timestamp: new Date() })}\n\n`
          );
        }
      },
      30000
    );

    // Cleanup on connection close
    request.raw.on("close", () => {
      this.scheduler.unregister(keepAliveTaskId);
      unsubscribe();
      this.logInfo(ctx, "SSE connection closed for webhook monitoring", {
        accountId,
      });
    });
  }

  async exportWebhookEvents(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<{ query: z.infer<typeof DashboardQuerySchema> }>(
      ctx,
      {
        query: DashboardQuerySchema,
      }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const result = await this.service.exportWebhookEvents(accountId, validated.value.query);

    reply.header("Content-Type", "text/csv");
    reply.header(
      "Content-Disposition",
      `attachment; filename="webhook-events-${result.timeRange}.csv"`
    );

    return reply.send(result.csv);
  }
}

/**
 * Register webhook dashboard routes
 * Resolves WebhookDashboardService from the DI container (registered in setup.ts).
 */
export async function registerWebhookDashboardRoutes(fastify: FastifyInstance) {
  const service = fastify.container!.resolve<WebhookDashboardService>(
    TOKENS.WebhookDashboardService
  );
  const broadcaster = fastify.container!.resolve<RealtimeWebhookBroadcaster>(
    TOKENS.RealtimeWebhookBroadcaster
  );
  const scheduler = fastify.container!.resolve<BackgroundTaskScheduler>(
    TOKENS.BackgroundTaskScheduler
  );
  const handler = new WebhookDashboardRouteHandler(service, broadcaster, scheduler);

  // Dashboard overview metrics
  fastify.get(
    "/webhooks/dashboard/metrics",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)],
      schema: { tags: ["Webhooks"], summary: "Get webhook dashboard metrics" },
    },
    handler.getDashboardMetrics.bind(handler)
  );

  // Recent webhook events with pagination
  fastify.get(
    "/webhooks/dashboard/events",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)],
      schema: { tags: ["Webhooks"], summary: "Get recent webhook events with pagination" },
    },
    handler.getRecentEvents.bind(handler)
  );

  // Webhook event details
  fastify.get(
    "/webhooks/dashboard/events/:eventId",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)],
      schema: { tags: ["Webhooks"], summary: "Get webhook event details" },
    },
    handler.getEventDetails.bind(handler)
  );

  // Webhook subscriptions overview
  fastify.get(
    "/webhooks/dashboard/subscriptions",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)],
      schema: { tags: ["Webhooks"], summary: "Get webhook subscriptions overview" },
    },
    handler.getSubscriptions.bind(handler)
  );

  // Dead letter queue events
  fastify.get(
    "/webhooks/dashboard/dead-letter",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)],
      schema: { tags: ["Webhooks"], summary: "Get dead letter queue events" },
    },
    handler.getDeadLetterQueue.bind(handler)
  );

  // DLQ metrics
  fastify.get(
    "/webhooks/dashboard/dead-letter/metrics",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)],
      schema: { tags: ["Webhooks"], summary: "Get DLQ metrics and trends" },
    },
    async (_request, reply) => {
      const metrics = await service.getDlqMetrics();
      return reply.send({ ok: true, data: metrics });
    }
  );

  // Retry ALL dead letter events (bulk)
  fastify.post(
    "/webhooks/dashboard/dead-letter/retry-all",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)],
      schema: { tags: ["Webhooks"], summary: "Retry all unresolved dead letter events" },
    },
    handler.retryAllDeadLetterEvents.bind(handler)
  );

  // Retry single dead letter event
  fastify.post(
    "/webhooks/dashboard/dead-letter/:eventId/retry",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)],
      schema: { tags: ["Webhooks"], summary: "Retry a dead letter event" },
    },
    handler.retryDeadLetterEvent.bind(handler)
  );

  // Real-time webhook monitoring endpoint (Server-Sent Events)
  fastify.get(
    "/webhooks/dashboard/stream",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)],
      schema: { tags: ["Webhooks"], summary: "Stream real-time webhook events via SSE" },
    },
    handler.streamWebhookEvents.bind(handler)
  );

  // Export webhook events for analysis
  fastify.get(
    "/webhooks/dashboard/export",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)],
      schema: { tags: ["Webhooks"], summary: "Export webhook events as CSV" },
    },
    handler.exportWebhookEvents.bind(handler)
  );
}
