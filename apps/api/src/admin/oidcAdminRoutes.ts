/**
 * @file oidcAdminRoutes.ts
 * @description Admin route plugin exposing the OIDC client secret atomic
 *              replace endpoint. Performs IdP handshake validation BEFORE
 *              committing the new secret to DB. Audit-logged.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { ReplaceOidcClientSecretUseCase } from "@core/application/auth/ReplaceOidcClientSecretUseCase.js";
import type { AuditService } from "../audit/auditService.js";

const ParamsSchema = z.object({ accountId: z.string().min(1) });
const BodySchema = z.object({
  newClientSecret: z.string().min(1),
});

class OidcAdminRouteHandler extends BaseRouteHandler {
  protected routeName = "oidc-admin";

  constructor(
    private readonly useCase: ReplaceOidcClientSecretUseCase,
    private readonly auditService: AuditService
  ) {
    super();
  }

  async replaceClientSecret(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) {
      return this.sendError(ctx, 400, "Invalid accountId");
    }
    const body = BodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const result = await this.useCase.execute({
      accountId: params.data.accountId,
      newClientSecret: body.data.newClientSecret,
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
        action: "OIDC_CLIENT_SECRET_REPLACED",
        resource: "OidcConfiguration",
        resourceId: params.data.accountId,
        ...(adminUserId && { userId: adminUserId }),
        success: false,
        error: result.error.message,
      });
      return this.sendError(ctx, status, result.error.message);
    }

    await this.auditService.log({
      action: "OIDC_CLIENT_SECRET_REPLACED",
      resource: "OidcConfiguration",
      resourceId: result.value.accountId,
      ...(adminUserId && { userId: adminUserId }),
      success: true,
      details: {
        issuerUrl: result.value.issuerUrl,
        updatedAt: result.value.updatedAt,
      },
    });

    return this.sendSuccess(ctx, { rotation: result.value });
  }
}

const oidcAdminRoutes: FastifyPluginAsync = async (fastify) => {
  const useCase = fastify.container!.resolve<ReplaceOidcClientSecretUseCase>(
    TOKENS.ReplaceOidcClientSecretUseCase
  );
  const auditService = fastify.container!.resolve<AuditService>(TOKENS.AuditService);
  const handler = new OidcAdminRouteHandler(useCase, auditService);

  fastify.post(
    "/admin/oidc/configurations/:accountId/replace-client-secret",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.OIDC_REPLACE_SECRET)],
      schema: {
        tags: ["Admin OIDC"],
        summary: "Replace OIDC clientSecret atomically (handshake test before commit)",
      },
    },
    async (request, reply) => handler.replaceClientSecret(request, reply)
  );
};

export { oidcAdminRoutes };
