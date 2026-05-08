/**
 * @file notificationRoutes.ts
 * @description Fastify plugin registering notification management endpoints.
 *   Resolves use cases from DI and delegates to handler methods.
 *   Includes SSE streaming for real-time notification delivery.
 * @layer infrastructure
 */

import { randomUUID } from "crypto";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { CreateNotificationUseCase } from "../application/notifications/CreateNotificationUseCase.js";
import type { GetNotificationsQuery } from "../application/notifications/GetNotificationsQuery.js";
import type {
  MarkNotificationReadUseCase,
  MarkAllNotificationsReadUseCase,
} from "../application/notifications/MarkNotificationReadUseCase.js";
import type { GetUnreadCountQuery } from "../application/notifications/GetUnreadCountQuery.js";
import type { NotificationBroadcaster } from "../services/NotificationBroadcaster.js";
import type { NotificationPreferenceRepository } from "../domain/repositories/NotificationRepository.js";
import { NOTIFICATION_TYPES } from "../domain/value-objects/NotificationType.js";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";

// --- Zod Schemas ---

const ListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  unreadOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

const NotificationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const notificationTypeValues = Object.values(NOTIFICATION_TYPES) as [string, ...string[]];

const CreateNotificationBodySchema = z.object({
  recipientId: z.string().uuid(),
  type: z.enum(notificationTypeValues as [string, ...string[]]),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  resourceType: z.string().max(100).optional(),
  resourceId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  actorName: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdatePreferenceBodySchema = z.object({
  preferences: z.array(
    z.object({
      type: z.enum(notificationTypeValues),
      enabled: z.boolean(),
    })
  ),
});

/**
 * @class NotificationRouteHandler
 * @description Route handler for notification management endpoints.
 *   All operations delegate to application-layer use cases.
 */
class NotificationRouteHandler extends BaseRouteHandler {
  protected routeName = "notifications";

  constructor(
    private readonly createUseCase: CreateNotificationUseCase,
    private readonly getQuery: GetNotificationsQuery,
    private readonly markReadUseCase: MarkNotificationReadUseCase,
    private readonly markAllReadUseCase: MarkAllNotificationsReadUseCase,
    private readonly unreadCountQuery: GetUnreadCountQuery,
    private readonly preferenceRepo: NotificationPreferenceRepository,
    private readonly broadcaster: NotificationBroadcaster,
    private readonly scheduler: BackgroundTaskScheduler
  ) {
    super();
  }

  /**
   * @method listNotifications
   * @description GET /notifications -- Lists notifications with cursor pagination
   */
  async listNotifications(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateRequest<{
      query: z.infer<typeof ListQuerySchema>;
    }>(ctx, { query: ListQuerySchema });

    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.getQuery.execute({
      recipientId: user.id,
      ...(validation.value.query.cursor !== undefined && {
        cursor: validation.value.query.cursor,
      }),
      ...(validation.value.query.limit !== undefined && {
        limit: validation.value.query.limit,
      }),
      ...(validation.value.query.unreadOnly !== undefined && {
        unreadOnly: validation.value.query.unreadOnly,
      }),
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method getUnreadCount
   * @description GET /notifications/unread-count -- Returns unread notification count
   */
  async getUnreadCount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.unreadCountQuery.execute({
      recipientId: user.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method markAsRead
   * @description PATCH /notifications/:id/read -- Marks a single notification as read
   */
  async markAsRead(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateRequest<{
      params: z.infer<typeof NotificationIdParamsSchema>;
    }>(ctx, { params: NotificationIdParamsSchema });

    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid notification ID");
    }

    const result = await this.markReadUseCase.execute({
      notificationId: validation.value.params.id,
    });

    if (!result.ok) {
      const statusCode = result.error.code === "NOT_FOUND" ? 404 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { read: true });
  }

  /**
   * @method markAllAsRead
   * @description POST /notifications/mark-all-read -- Marks all notifications as read
   */
  async markAllAsRead(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.markAllReadUseCase.execute({
      recipientId: user.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method createNotification
   * @description POST /notifications -- Creates a new notification (internal/admin use)
   */
  async createNotification(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateRequest<{
      body: z.infer<typeof CreateNotificationBodySchema>;
    }>(ctx, { body: CreateNotificationBodySchema });

    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = validation.value.body;
    const result = await this.createUseCase.execute({
      recipientId: body.recipientId,
      type: body.type as import("../domain/value-objects/NotificationType.js").NotificationTypeValue,
      title: body.title,
      body: body.body,
      ...(body.resourceType !== undefined && { resourceType: body.resourceType }),
      ...(body.resourceId !== undefined && { resourceId: body.resourceId }),
      ...(body.actorId !== undefined && { actorId: body.actorId }),
      ...(body.actorName !== undefined && { actorName: body.actorName }),
      ...(body.metadata !== undefined && { metadata: body.metadata }),
    });

    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    // Broadcast to SSE clients if the notification was actually created
    if (result.value.id) {
      await this.broadcaster.broadcast(
        {
          id: result.value.id,
          type: body.type,
          title: body.title,
          body: body.body,
          ...(body.resourceType !== undefined && { resourceType: body.resourceType }),
          ...(body.resourceId !== undefined && { resourceId: body.resourceId }),
          ...(body.actorName !== undefined && { actorName: body.actorName }),
          createdAt: new Date().toISOString(),
        },
        body.recipientId
      );
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method getPreferences
   * @description GET /notifications/preferences -- Returns notification preferences
   */
  async getPreferences(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const preferences = await this.preferenceRepo.findByMember(user.id);
    this.sendSuccess(ctx, { preferences });
  }

  /**
   * @method updatePreferences
   * @description PUT /notifications/preferences -- Updates notification preferences
   */
  async updatePreferences(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateRequest<{
      body: z.infer<typeof UpdatePreferenceBodySchema>;
    }>(ctx, { body: UpdatePreferenceBodySchema });

    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const { preferences } = validation.value.body;

    for (const pref of preferences) {
      await this.preferenceRepo.upsert(user.id, pref.type, pref.enabled);
    }

    // Return updated preferences
    const updated = await this.preferenceRepo.findByMember(user.id);
    this.sendSuccess(ctx, { preferences: updated });
  }

  /**
   * @method streamNotifications
   * @description GET /notifications/stream -- SSE endpoint for real-time notifications
   */
  async streamNotifications(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = request.user;
    if (!user) {
      return reply.code(401).send({ ok: false, error: "Authentication required" });
    }

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial connection event
    reply.raw.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    // Subscribe to broadcaster
    const subId = randomUUID();
    this.broadcaster.subscribe(subId, user.id, (event) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Connection closed
        this.broadcaster.unsubscribe(subId);
      }
    });

    // Send heartbeat every 30 seconds. Task ID is unique per SSE connection via subId.
    const heartbeatTaskId = `notification-stream-heartbeat-${subId}`;
    this.scheduler.register(
      heartbeatTaskId,
      () => {
        try {
          reply.raw.write(": heartbeat\n\n");
        } catch {
          this.scheduler.unregister(heartbeatTaskId);
          this.broadcaster.unsubscribe(subId);
        }
      },
      30_000
    );

    // Cleanup on client disconnect
    request.raw.on("close", () => {
      this.scheduler.unregister(heartbeatTaskId);
      this.broadcaster.unsubscribe(subId);
    });
  }
}

/**
 * Fastify plugin that registers notification management routes under /notifications
 */
export const notificationRoutes: FastifyPluginAsync = async (app) => {
  const createUseCase = app.container.resolve<CreateNotificationUseCase>(
    TOKENS.CreateNotificationUseCase
  );
  const getQuery = app.container.resolve<GetNotificationsQuery>(TOKENS.GetNotificationsQuery);
  const markReadUseCase = app.container.resolve<MarkNotificationReadUseCase>(
    TOKENS.MarkNotificationReadUseCase
  );
  const markAllReadUseCase = app.container.resolve<MarkAllNotificationsReadUseCase>(
    TOKENS.MarkAllNotificationsReadUseCase
  );
  const unreadCountQuery = app.container.resolve<GetUnreadCountQuery>(TOKENS.GetUnreadCountQuery);
  const preferenceRepo = app.container.resolve<NotificationPreferenceRepository>(
    TOKENS.NotificationPreferenceRepository
  );
  const broadcaster = app.container.resolve<NotificationBroadcaster>(
    TOKENS.NotificationBroadcaster
  );
  const scheduler = app.container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler);

  const handler = new NotificationRouteHandler(
    createUseCase,
    getQuery,
    markReadUseCase,
    markAllReadUseCase,
    unreadCountQuery,
    preferenceRepo,
    broadcaster,
    scheduler
  );

  // List notifications with cursor pagination
  app.get(
    "/notifications",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Notifications"], summary: "List notifications with cursor pagination" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listNotifications(request, reply)
  );

  // Get unread count
  app.get(
    "/notifications/unread-count",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Notifications"], summary: "Get unread notification count" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getUnreadCount(request, reply)
  );

  // Mark single notification as read
  app.patch(
    "/notifications/:id/read",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Notifications"], summary: "Mark a single notification as read" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.markAsRead(request, reply)
  );

  // Mark all notifications as read
  app.post(
    "/notifications/mark-all-read",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Notifications"], summary: "Mark all notifications as read" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.markAllAsRead(request, reply)
  );

  // Create notification (internal/admin)
  app.post(
    "/notifications",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Notifications"], summary: "Create a new notification" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.createNotification(request, reply)
  );

  // Get preferences
  app.get(
    "/notifications/preferences",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Notifications"], summary: "Get notification preferences" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getPreferences(request, reply)
  );

  // Update preferences
  app.put(
    "/notifications/preferences",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Notifications"], summary: "Update notification preferences" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.updatePreferences(request, reply)
  );

  // SSE stream for real-time notifications
  app.get(
    "/notifications/stream",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Notifications"], summary: "Stream real-time notifications via SSE" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.streamNotifications(request, reply)
  );
};
