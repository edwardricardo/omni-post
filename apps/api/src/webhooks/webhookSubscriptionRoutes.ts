/**
 * @file webhookSubscriptionRoutes.ts
 * @description Client-facing CRUD for webhook subscriptions: register a provider
 *   webhook (provider + signing secret + event types), list, update, and delete.
 *   Account-scoped from the authenticated customer token. Creating a subscription
 *   is what lets the inbound `/webhooks/:provider` route resolve a secret and
 *   verify signatures. Delegates to WebhookManager resolved from DI.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { ZodError } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { WebhookManager } from "./webhookManager.js";

const CreateSubscriptionBodySchema = z.object({
  provider: z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK", "TELEGRAM", "THREADS"]),
  projectId: z.string().uuid().optional(),
  secretKey: z.string().min(1).optional(),
  eventTypes: z.array(z.string().min(1)).min(1),
  webhookUrl: z.string().url().optional(),
  verifyToken: z.string().optional(),
});

const UpdateSubscriptionBodySchema = z.object({
  isActive: z.boolean().optional(),
  eventTypes: z.array(z.string().min(1)).optional(),
  verifyToken: z.string().optional(),
});

const SubscriptionParamsSchema = z.object({ id: z.string().uuid() });
const ListQuerySchema = z.object({ provider: z.string().optional() });

/** Map a thrown error to an HTTP status: ZodError → 400, AppError.statusCode, else 500. */
function statusForError(error: unknown): number {
  if (error instanceof ZodError) {
    return 400;
  }
  const code = (error as { statusCode?: number }).statusCode;
  return typeof code === "number" ? code : 500;
}

class WebhookSubscriptionRouteHandler extends BaseRouteHandler {
  protected routeName = "webhook-subscriptions";

  constructor(private readonly manager: WebhookManager) {
    super();
  }

  private accountId(ctx: RouteContext): string | undefined {
    return ctx.request.customerUser?.accountId;
  }

  /**
   * @method create
   * @description POST /webhooks/subscriptions — register a provider webhook.
   */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateBody(ctx, CreateSubscriptionBodySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }
    const accountId = this.accountId(ctx);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }
    try {
      // The manager re-validates with its own Zod schema (the runtime guard);
      // bridge the wider eventTypes string[] to its enum-typed parameter.
      const result = await this.manager.createSubscription(
        accountId,
        validation.value as Parameters<WebhookManager["createSubscription"]>[1]
      );
      this.sendSuccess(ctx, result, 201);
    } catch (error: unknown) {
      this.sendError(ctx, statusForError(error), "Failed to create webhook subscription");
    }
  }

  /**
   * @method list
   * @description GET /webhooks/subscriptions — list the account's subscriptions.
   */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateQuery(ctx, ListQuerySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }
    const accountId = this.accountId(ctx);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }
    try {
      const result = await this.manager.getSubscriptions(
        accountId,
        validation.value.provider as Parameters<WebhookManager["getSubscriptions"]>[1]
      );
      this.sendSuccess(ctx, result);
    } catch (error: unknown) {
      this.sendError(ctx, statusForError(error), "Failed to list webhook subscriptions");
    }
  }

  /**
   * @method update
   * @description PATCH /webhooks/subscriptions/:id — update event types / status.
   */
  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const params = await this.validateParams(ctx, SubscriptionParamsSchema);
    if (!params.ok) {
      return this.sendError(ctx, 400, "Invalid subscription id");
    }
    const validation = await this.validateBody(ctx, UpdateSubscriptionBodySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }
    const accountId = this.accountId(ctx);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }
    try {
      await this.manager.updateSubscription(
        params.value.id,
        accountId,
        validation.value as Parameters<WebhookManager["updateSubscription"]>[2]
      );
      this.sendSuccess(ctx, { updated: true });
    } catch (error: unknown) {
      this.sendError(ctx, statusForError(error), "Failed to update webhook subscription");
    }
  }

  /**
   * @method remove
   * @description DELETE /webhooks/subscriptions/:id — delete a subscription.
   */
  async remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const params = await this.validateParams(ctx, SubscriptionParamsSchema);
    if (!params.ok) {
      return this.sendError(ctx, 400, "Invalid subscription id");
    }
    const accountId = this.accountId(ctx);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }
    try {
      await this.manager.deleteSubscription(params.value.id, accountId);
      this.sendSuccess(ctx, { deleted: true });
    } catch (error: unknown) {
      this.sendError(ctx, statusForError(error), "Failed to delete webhook subscription");
    }
  }
}

/**
 * Fastify plugin registering webhook-subscription CRUD under /api/webhooks/subscriptions.
 */
const webhookSubscriptionRoutes: FastifyPluginAsync = async (app) => {
  const manager = app.container.resolve<WebhookManager>(TOKENS.WebhookManager);
  const handler = new WebhookSubscriptionRouteHandler(manager);

  app.post(
    "/webhooks/subscriptions",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Webhooks"], summary: "Register a provider webhook subscription" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.create(request, reply)
  );
  app.get(
    "/webhooks/subscriptions",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Webhooks"], summary: "List webhook subscriptions" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.list(request, reply)
  );
  app.patch(
    "/webhooks/subscriptions/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Webhooks"], summary: "Update a webhook subscription" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.update(request, reply)
  );
  app.delete(
    "/webhooks/subscriptions/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Webhooks"], summary: "Delete a webhook subscription" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.remove(request, reply)
  );
};

export { webhookSubscriptionRoutes };
