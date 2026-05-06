/**
 * @file webhookAdminRoutes.ts
 * @description Admin route plugin exposing the webhook secret rotation
 *              endpoint. Resolves RotateWebhookSecretKeyUseCase from DI,
 *              gates access behind admin auth + WEBHOOKS_ROTATE_SECRET, and
 *              emits an audit log entry after the use case completes.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { RotateWebhookSecretKeyUseCase } from "../application/webhooks/RotateWebhookSecretKeyUseCase.js";
import { auditService } from "../audit/auditService.js";

const ParamsSchema = z.object({ id: z.string().min(1) });
const BodySchema = z.object({
  graceWindowHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
});

class WebhookAdminRouteHandler extends BaseRouteHandler {
  protected routeName = "webhook-admin";

  constructor(private readonly useCase: RotateWebhookSecretKeyUseCase) {
    super();
  }

  async rotateSecret(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) {
      return this.sendError(ctx, 400, "Invalid webhook subscription id");
    }
    const body = BodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const result = await this.useCase.execute({
      webhookSubscriptionId: params.data.id,
      ...(body.data.graceWindowHours !== undefined && {
        graceWindowHours: body.data.graceWindowHours,
      }),
    });

    const adminUserId =
      (request as FastifyRequest & { adminUser?: { id: string } }).adminUser?.id ?? null;

    if (!result.ok) {
      const status =
        result.error.code === "VALIDATION_FAILED"
          ? 400
          : result.error.code === "NOT_FOUND"
            ? 404
            : 500;
      await auditService.log({
        action: "WEBHOOK_SECRET_ROTATED",
        resource: "WebhookSubscription",
        resourceId: params.data.id,
        ...(adminUserId && { userId: adminUserId }),
        success: false,
        error: result.error.message,
      });
      return this.sendError(ctx, status, result.error.message);
    }

    await auditService.log({
      action: "WEBHOOK_SECRET_ROTATED",
      resource: "WebhookSubscription",
      resourceId: result.value.webhookSubscriptionId,
      ...(adminUserId && { userId: adminUserId }),
      success: true,
      details: {
        graceWindowHours: result.value.graceWindowHours,
        previousSecretKeyExpiresAt: result.value.previousSecretKeyExpiresAt,
      },
    });

    return this.sendSuccess(ctx, { rotation: result.value });
  }
}

const webhookAdminRoutes: FastifyPluginAsync = async (fastify) => {
  const useCase = fastify.container!.resolve<RotateWebhookSecretKeyUseCase>(
    TOKENS.RotateWebhookSecretKeyUseCase
  );
  const handler = new WebhookAdminRouteHandler(useCase);

  fastify.post(
    "/admin/webhooks/:id/rotate-secret",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOKS_ROTATE_SECRET)],
      schema: {
        tags: ["Admin Webhooks"],
        summary: "Rotate WebhookSubscription.secretKey with grace-window",
      },
    },
    async (request, reply) => handler.rotateSecret(request, reply)
  );
};

export { webhookAdminRoutes };
