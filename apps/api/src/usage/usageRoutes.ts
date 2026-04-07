/**
 * @file usageRoutes.ts
 * @description REST API routes for usage metering per account per period.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import type { GetUsageUseCase } from "../application/usage/GetUsageUseCase.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";

// ============================================================================
// Schemas
// ============================================================================

const UsageParamsSchema = z.object({ accountId: z.string().uuid() });

const UsageQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2099).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

// ============================================================================
// Handler
// ============================================================================

class UsageRouteHandler extends BaseRouteHandler {
  protected routeName = "usage";

  constructor(private readonly getUsageUseCase: GetUsageUseCase) {
    super();
  }

  async getUsage(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UsageParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid accountId format");
    }

    const queryValidation = await this.validateQuery(ctx, UsageQuerySchema);
    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const now = new Date();
    const year = queryValidation.value.year ?? now.getUTCFullYear();
    const month = queryValidation.value.month ?? now.getUTCMonth() + 1;

    const result = await this.getUsageUseCase.execute({
      accountId: paramsValidation.value.accountId,
      year,
      month,
    });

    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }
}

// ============================================================================
// Plugin
// ============================================================================

export const usageRoutes: FastifyPluginAsync = async (app) => {
  const handler = new UsageRouteHandler(
    app.container.resolve<GetUsageUseCase>(TOKENS.GetUsageUseCase)
  );

  app.get(
    "/api/accounts/:accountId/usage",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Usage"], summary: "Get usage metering for an account" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getUsage(request, reply)
  );
};
