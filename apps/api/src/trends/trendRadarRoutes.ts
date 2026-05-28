/**
 * @file trendRadarRoutes.ts
 * @description Client-facing REST route for the AI trend radar.
 *
 *   GET /trends/radar -> GetTrendRadarQuery (account-scoped, non-expired
 *        scored trends ordered by relevance, populated by the TREND_RADAR
 *        worker).
 *
 *   The account is taken from the customer JWT (`request.customerUser`).
 *   When the optional `accountId` query param is supplied, it MUST match
 *   the authenticated account — second barrier against IDOR even though
 *   `requireClientAuth` has already gated the request.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import type { GetTrendRadarQuery } from "@core/trends/GetTrendRadarQuery.js";

const RadarQuerySchema = z.object({
  accountId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

class TrendRadarRouteHandler extends BaseRouteHandler {
  protected routeName = "trends-radar";

  constructor(private readonly query: GetTrendRadarQuery) {
    super();
  }

  private getAccountId(request: FastifyRequest): string | undefined {
    return request.customerUser?.accountId;
  }

  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const authedAccountId = this.getAccountId(request);
    if (!authedAccountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validation = await this.validateQuery(ctx, RadarQuerySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }
    const { accountId: queryAccountId, limit } = validation.value;

    if (queryAccountId !== undefined && queryAccountId !== authedAccountId) {
      return this.sendError(ctx, 403, "Forbidden");
    }

    const result = await this.query.execute({ accountId: authedAccountId, limit });
    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }
}

export const trendRadarRoutes: FastifyPluginAsync = async (app) => {
  const handler = new TrendRadarRouteHandler(
    app.container.resolve<GetTrendRadarQuery>(TOKENS.GetTrendRadarQuery)
  );

  app.get(
    "/trends/radar",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["AI", "Trends"],
        summary: "List the account's AI-scored trending topics",
      },
    },
    (req: FastifyRequest, reply: FastifyReply) => handler.get(req, reply)
  );
};
