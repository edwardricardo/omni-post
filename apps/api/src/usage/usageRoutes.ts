/**
 * @file usageRoutes.ts
 * @description REST API routes for usage metering per account per period: the customer usage
 *   page's read of its own account's counters, plan limits, trial and billing dates.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { GetUsageUseCase } from "@core/usage/GetUsageUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { requireCallerOwnsAccountParam } from "../auth/requireCallerOwnsAccountParam.js";

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

  /**
   * @method getUsage
   * @description Returns the usage of the caller's own account for a period, the current UTC month
   *   by default (GET /accounts/:accountId/usage; `requireCallerOwnsAccountParam` has admitted the
   *   path's account). Any authenticated member of the account may read it. An account the use case
   *   cannot find answers the account gate's own 404 body, so the caller's soft-deleted account and
   *   another tenant's account get the same bytes.
   * @param request - The request, carrying the account id in its path and the period in its query.
   * @param reply - The reply the usage or the refusal is sent on.
   */
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
      // NOT_FOUND covers "no such account" and "already soft-deleted". Its message names the id,
      // so the refusal sends the account gate's body instead, which names none.
      if (result.error.code === USE_CASE_ERRORS.NOT_FOUND) {
        return this.sendError(ctx, 404, "Account not found");
      }
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }
}

// ============================================================================
// Plugin
// ============================================================================

/**
 * @description Registers the usage routes. Resolves the usage read use case from the DI container.
 * @param app - The Fastify instance the routes are registered on.
 */
export const usageRoutes: FastifyPluginAsync = async (app) => {
  const handler = new UsageRouteHandler(
    app.container.resolve<GetUsageUseCase>(TOKENS.GetUsageUseCase)
  );

  // Read my account's usage: any authenticated member of it. The account gate runs before the use
  // case, so another tenant's account answers 404 before its plan or billing context is read.
  app.get(
    "/accounts/:accountId/usage",
    {
      preHandler: [requireClientAuth, requireCallerOwnsAccountParam("usage")],
      schema: { tags: ["Usage"], summary: "Get usage metering for an account" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getUsage(request, reply)
  );
};
