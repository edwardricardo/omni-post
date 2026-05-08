/**
 * @file massReauthRoutes.ts
 * @description Admin route plugin exposing the cross-tenant mass force-reauth
 *              endpoint. Resolves MassForceReauthByProviderUseCase from DI,
 *              gates access behind admin auth + PROVIDERS_MASS_FORCE_REAUTH,
 *              and emits an aggregated audit log entry post-commit.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { MassForceReauthByProviderUseCase } from "../application/providers/MassForceReauthByProviderUseCase.js";
import { auditService } from "../audit/auditService.js";

const ParamsSchema = z.object({ provider: z.string().min(1) });
// `flagChannels` covers the disable-style intent (sets needsReauth) and
// `softDeleteChannels` covers the destructive variant. Channels are the
// single source of truth for tenant connection state.
const BodySchema = z.object({
  reason: z.string().min(1).max(500),
  flagChannels: z.boolean().optional(),
  softDeleteChannels: z.boolean().optional(),
});

class MassReauthRouteHandler extends BaseRouteHandler {
  protected routeName = "provider-mass-reauth";

  constructor(private readonly useCase: MassForceReauthByProviderUseCase) {
    super();
  }

  async forceMassReauth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) {
      return this.sendError(ctx, 400, "Invalid provider");
    }
    const body = BodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const result = await this.useCase.execute({
      provider: params.data.provider,
      reason: body.data.reason,
      ...(body.data.flagChannels !== undefined && {
        flagChannels: body.data.flagChannels,
      }),
      ...(body.data.softDeleteChannels !== undefined && {
        softDeleteChannels: body.data.softDeleteChannels,
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
        action: "PROVIDER_MASS_FORCE_REAUTH",
        resource: "Provider",
        resourceId: params.data.provider,
        ...(adminUserId && { userId: adminUserId }),
        success: false,
        error: result.error.message,
      });
      return this.sendError(ctx, status, result.error.message);
    }

    await auditService.log({
      action: "PROVIDER_MASS_FORCE_REAUTH",
      resource: "Provider",
      resourceId: result.value.provider,
      ...(adminUserId && { userId: adminUserId }),
      success: true,
      details: {
        tiers: result.value.tiers,
        channelsFlagged: result.value.channelsFlagged,
        channelsSoftDeleted: result.value.channelsSoftDeleted,
        channelIds: result.value.channelIds,
        reason: body.data.reason,
      },
    });

    return this.sendSuccess(ctx, { rotation: result.value });
  }
}

const massReauthRoutes: FastifyPluginAsync = async (fastify) => {
  const useCase = fastify.container!.resolve<MassForceReauthByProviderUseCase>(
    TOKENS.MassForceReauthByProviderUseCase
  );
  const handler = new MassReauthRouteHandler(useCase);

  fastify.post(
    "/admin/providers/:provider/force-mass-reauth",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.PROVIDERS_MASS_FORCE_REAUTH)],
      schema: {
        tags: ["Admin Provider Mass"],
        summary: "Cross-tenant mass force-reauth for a provider (post platform-secret rotation)",
      },
    },
    async (request, reply) => handler.forceMassReauth(request, reply)
  );
};

export { massReauthRoutes };
