/**
 * @file externalNotificationRoutes.ts
 * @description Fastify plugin registering REST endpoints for external
 *   notification config management (Slack/Teams webhooks).
 *   Use cases are resolved from the DI container at plugin registration time.
 * @layer infrastructure
 */

import { type FastifyPluginAsync, type FastifyRequest, type FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext, IdSchema } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import type { ConfigureExternalNotificationUseCase } from "../application/external-notifications/ConfigureExternalNotificationUseCase.js";
import type { ListExternalNotificationsQuery } from "../application/external-notifications/ListExternalNotificationsQuery.js";
import type { DeleteExternalNotificationUseCase } from "../application/external-notifications/DeleteExternalNotificationUseCase.js";
import type { TestExternalNotificationUseCase } from "../application/external-notifications/TestExternalNotificationUseCase.js";

// ---- Zod Schemas ----

const NotificationChannelSchema = z.enum(["slack", "teams"]);

const CreateExternalNotificationBodySchema = z.object({
  projectId: IdSchema,
  channel: NotificationChannelSchema,
  webhookUrl: z.string().url().startsWith("https://"),
  label: z.string().min(1).max(100),
  events: z.array(z.string().min(1).max(100)).min(1).max(50),
  isActive: z.boolean().optional(),
});

const ExternalNotificationParamsSchema = z.object({
  id: IdSchema,
});

const ListExternalNotificationsQuerySchema = z.object({
  projectId: IdSchema,
});

// ---- Route Handler ----

/**
 * @class ExternalNotificationRouteHandler
 * @description Delegates all operations to application-layer use cases
 *   resolved from the DI container. No direct Prisma access.
 */
class ExternalNotificationRouteHandler extends BaseRouteHandler {
  protected routeName = "external-notifications";

  constructor(
    private readonly configureUseCase: ConfigureExternalNotificationUseCase,
    private readonly listQuery: ListExternalNotificationsQuery,
    private readonly deleteUseCase: DeleteExternalNotificationUseCase,
    private readonly testUseCase: TestExternalNotificationUseCase
  ) {
    super();
  }

  /**
   * POST /api/external-notifications
   * Creates a new external notification config.
   */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Creating external notification config");

    const validated = await this.validateRequest<{
      body: z.infer<typeof CreateExternalNotificationBodySchema>;
    }>(ctx, { body: CreateExternalNotificationBodySchema });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = validated.value.body;
    const result = await this.configureUseCase.execute({
      projectId: body.projectId,
      channel: body.channel,
      webhookUrl: body.webhookUrl,
      label: body.label,
      events: body.events,
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    });

    if (!result.ok) {
      const statusCode = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    return this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * GET /api/external-notifications?projectId=...
   * Lists all configs for a project.
   */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      query: z.infer<typeof ListExternalNotificationsQuerySchema>;
    }>(ctx, { query: ListExternalNotificationsQuerySchema });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "projectId query parameter is required");
    }

    const result = await this.listQuery.execute({
      projectId: validated.value.query.projectId,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * DELETE /api/external-notifications/:id
   * Deletes a config by ID.
   */
  async remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      params: z.infer<typeof ExternalNotificationParamsSchema>;
    }>(ctx, { params: ExternalNotificationParamsSchema });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid notification config ID");
    }

    const result = await this.deleteUseCase.execute({
      id: validated.value.params.id,
    });

    if (!result.ok) {
      const statusCode = result.error.code === "NOT_FOUND" ? 404 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    return this.sendSuccess(ctx, { deleted: true });
  }

  /**
   * POST /api/external-notifications/:id/test
   * Sends a test notification through the configured webhook.
   */
  async test(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Sending test external notification");

    const validated = await this.validateRequest<{
      params: z.infer<typeof ExternalNotificationParamsSchema>;
    }>(ctx, { params: ExternalNotificationParamsSchema });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid notification config ID");
    }

    const result = await this.testUseCase.execute({
      id: validated.value.params.id,
    });

    if (!result.ok) {
      const statusCode = result.error.code === "NOT_FOUND" ? 404 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    return this.sendSuccess(ctx, result.value);
  }
}

// ---- Plugin Registration ----

/**
 * External notification routes plugin.
 * Resolves use cases from the DI container at plugin registration time.
 */
export const externalNotificationRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }

  const handler = new ExternalNotificationRouteHandler(
    container.resolve<ConfigureExternalNotificationUseCase>(
      TOKENS.ConfigureExternalNotificationUseCase
    ),
    container.resolve<ListExternalNotificationsQuery>(TOKENS.ListExternalNotificationsQuery),
    container.resolve<DeleteExternalNotificationUseCase>(TOKENS.DeleteExternalNotificationUseCase),
    container.resolve<TestExternalNotificationUseCase>(TOKENS.TestExternalNotificationUseCase)
  );

  fastify.post(
    "/external-notifications",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["External Notifications"], summary: "Create external notification config" },
    },
    handler.create.bind(handler)
  );
  fastify.get(
    "/external-notifications",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["External Notifications"], summary: "List external notification configs" },
    },
    handler.list.bind(handler)
  );
  fastify.delete(
    "/external-notifications/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["External Notifications"], summary: "Delete external notification config" },
    },
    handler.remove.bind(handler)
  );
  fastify.post(
    "/external-notifications/:id/test",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["External Notifications"], summary: "Send test notification" },
    },
    handler.test.bind(handler)
  );
};
