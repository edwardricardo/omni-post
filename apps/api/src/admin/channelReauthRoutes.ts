/**
 * @file channelReauthRoutes.ts
 * @description Admin route plugin exposing the force-reauth endpoint for
 *              social channels. Resolves UpdateChannelAuthStateUseCase from
 *              DI, gates access behind admin auth + CHANNELS_FORCE_REAUTH,
 *              and emits an audit log entry after the use case commits.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { UpdateChannelAuthStateUseCase } from "@core/application/channels/index.js";
import type { AuditService } from "../audit/auditService.js";

const ParamsSchema = z.object({ id: z.string().min(1) });
const BodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

const DEFAULT_REASON = "Admin force re-auth";

class ChannelReauthRouteHandler extends BaseRouteHandler {
  protected routeName = "channel-reauth";

  constructor(
    private readonly useCase: UpdateChannelAuthStateUseCase,
    private readonly auditService: AuditService
  ) {
    super();
  }

  async forceReauth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) {
      return this.sendError(ctx, 400, "Invalid channel id");
    }
    const body = BodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }
    const reason = body.data.reason?.trim() || DEFAULT_REASON;

    const result = await this.useCase.execute({
      channelId: params.data.id,
      reason,
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
      await this.auditService.log({
        action: "CHANNEL_FORCE_REAUTH",
        resource: "Channel",
        resourceId: params.data.id,
        ...(adminUserId && { userId: adminUserId }),
        success: false,
        error: result.error.message,
        details: { reason },
      });
      return this.sendError(ctx, status, result.error.message);
    }

    await this.auditService.log({
      action: "CHANNEL_FORCE_REAUTH",
      resource: "Channel",
      resourceId: result.value.channelId,
      ...(adminUserId && { userId: adminUserId }),
      success: true,
      details: {
        reason,
        projectId: result.value.projectId,
        provider: result.value.provider,
      },
    });

    return this.sendSuccess(ctx, { channel: result.value });
  }
}

const channelReauthRoutes: FastifyPluginAsync = async (fastify) => {
  const useCase = fastify.container!.resolve<UpdateChannelAuthStateUseCase>(
    TOKENS.UpdateChannelAuthStateUseCase
  );
  const auditService = fastify.container!.resolve<AuditService>(TOKENS.AuditService);
  const handler = new ChannelReauthRouteHandler(useCase, auditService);

  fastify.post(
    "/admin/channels/:id/force-reauth",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.CHANNELS_FORCE_REAUTH)],
      schema: {
        tags: ["Admin Channels"],
        summary: "Flag a channel as needing re-authorization (admin-triggered)",
      },
    },
    async (request, reply) => handler.forceReauth(request, reply)
  );
};

export { channelReauthRoutes };
