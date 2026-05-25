/**
 * @file secretsRotationRoutes.ts
 * @description Fastify route plugin exposing the read-only secret-rotation
 *              status dashboard endpoint. Resolves the read query from DI and
 *              gates access behind admin auth + SECRETS_VIEW permission.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { GetSecretRotationStatusQuery } from "@core/application/security/GetSecretRotationStatusQuery.js";

class SecretsRotationRouteHandler extends BaseRouteHandler {
  protected routeName = "secrets-rotation";

  constructor(private readonly query: GetSecretRotationStatusQuery) {
    super();
  }

  async getRotationStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const result = await this.query.execute();
    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }
    return this.sendSuccess(ctx, { secrets: result.value });
  }
}

const secretsRotationRoutes: FastifyPluginAsync = async (fastify) => {
  const query = fastify.container!.resolve<GetSecretRotationStatusQuery>(
    TOKENS.GetSecretRotationStatusQuery
  );
  const handler = new SecretsRotationRouteHandler(query);

  fastify.get(
    "/admin/security/secrets/rotation-status",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.SECRETS_VIEW)],
      schema: {
        tags: ["Admin Security"],
        summary: "List rotation status for every tracked secret",
      },
    },
    async (request, reply) => handler.getRotationStatus(request, reply)
  );
};

export { secretsRotationRoutes };
