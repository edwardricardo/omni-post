/**
 * @file apiKeyAdminRoutes.ts
 * @description Admin route plugin exposing the cross-tenant ApiKey rotation
 *              endpoint. Wraps the existing RotateApiKeyUseCase with admin
 *              auth + APIKEYS_ADMIN_ROTATE permission + audit log emission.
 *              The new raw key is returned ONCE in the response and never
 *              recoverable later (same model as customer-level rotation).
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { RotateApiKeyUseCase } from "../application/apiKeys/ApiKeyUseCases.js";
import { auditService } from "../audit/auditService.js";

const ParamsSchema = z.object({ id: z.string().min(1) });

class ApiKeyAdminRouteHandler extends BaseRouteHandler {
  protected routeName = "apikey-admin";

  constructor(private readonly useCase: RotateApiKeyUseCase) {
    super();
  }

  async rotate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) {
      return this.sendError(ctx, 400, "Invalid api key id");
    }

    const result = await this.useCase.execute(params.data.id);

    const adminUserId =
      (request as FastifyRequest & { adminUser?: { id: string } }).adminUser?.id ?? null;

    if (!result.ok) {
      const code = (result.error as { code?: string }).code;
      const status = code === "VALIDATION_FAILED" ? 400 : code === "NOT_FOUND" ? 404 : 500;
      await auditService.log({
        action: "APIKEY_ADMIN_ROTATED",
        resource: "ApiKey",
        resourceId: params.data.id,
        ...(adminUserId && { userId: adminUserId }),
        success: false,
        error: result.error.message,
      });
      return this.sendError(ctx, status, result.error.message);
    }

    const accountId = (result.value.key as { accountId?: string }).accountId ?? null;

    await auditService.log({
      action: "APIKEY_ADMIN_ROTATED",
      resource: "ApiKey",
      resourceId: params.data.id,
      ...(adminUserId && { userId: adminUserId }),
      success: true,
      ...(accountId && { details: { accountId } }),
    });

    return this.sendSuccess(ctx, {
      rotation: {
        apiKeyId: params.data.id,
        rawKey: result.value.rawKey,
        ...(accountId && { accountId }),
      },
    });
  }
}

const apiKeyAdminRoutes: FastifyPluginAsync = async (fastify) => {
  const useCase = fastify.container!.resolve<RotateApiKeyUseCase>(TOKENS.RotateApiKeyUseCase);
  const handler = new ApiKeyAdminRouteHandler(useCase);

  fastify.post(
    "/admin/api-keys/:id/rotate",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.APIKEYS_ADMIN_ROTATE)],
      schema: {
        tags: ["Admin API Keys"],
        summary: "Rotate any tenant's ApiKey (cross-tenant admin override)",
      },
    },
    async (request, reply) => handler.rotate(request, reply)
  );
};

export { apiKeyAdminRoutes };
