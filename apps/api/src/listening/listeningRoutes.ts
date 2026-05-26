/**
 * @file listeningRoutes.ts
 * @description Fastify plugin registering brand-listening read endpoints: the
 *   Share-of-Voice aggregation and the cursor-paginated mention feed. Resolves
 *   query use cases from DI and delegates to ListeningRouteHandler. All queries
 *   are account-scoped from the authenticated customer token (multi-tenant safe).
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { GetShareOfVoiceQuery } from "@core/application/listening/GetShareOfVoiceQuery.js";
import type { ListMentionsQuery } from "@core/application/listening/ListMentionsQuery.js";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const ShareOfVoiceQuerySchema = z.object({
  projectId: z.string().uuid(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
});

const MentionsQuerySchema = z.object({
  projectId: z.string().uuid(),
  provider: z.string().optional(),
  kind: z.enum(["BRAND", "MARKET"]).optional(),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ============================================================================
// Route handler
// ============================================================================

class ListeningRouteHandler extends BaseRouteHandler {
  protected routeName = "listening";

  constructor(
    private readonly getShareOfVoiceQuery: GetShareOfVoiceQuery,
    private readonly listMentionsQuery: ListMentionsQuery
  ) {
    super();
  }

  private mapErrorCode(code: string): number {
    const mapping: Record<string, number> = {
      VALIDATION_FAILED: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      CONFLICT: 409,
      INTERNAL_ERROR: 500,
    };
    return mapping[code] ?? 500;
  }

  /**
   * @method getShareOfVoice
   * @description GET /listening/share-of-voice — Share of Voice for a project
   *   over an optional window (defaults to the trailing 30 days).
   */
  async getShareOfVoice(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateQuery(ctx, ShareOfVoiceQuerySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const accountId = request.customerUser?.accountId;
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const q = validation.value;
    const result = await this.getShareOfVoiceQuery.execute({
      accountId,
      projectId: q.projectId,
      ...(q.since !== undefined && { since: q.since }),
      ...(q.until !== undefined && { until: q.until }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method listMentions
   * @description GET /listening/mentions — cursor-paginated mention feed with
   *   optional provider / kind / sentiment / date-range filters.
   */
  async listMentions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateQuery(ctx, MentionsQuerySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const accountId = request.customerUser?.accountId;
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const q = validation.value;
    const result = await this.listMentionsQuery.execute({
      accountId,
      projectId: q.projectId,
      ...(q.provider !== undefined && { provider: q.provider }),
      ...(q.kind !== undefined && { kind: q.kind }),
      ...(q.sentiment !== undefined && { sentiment: q.sentiment }),
      ...(q.since !== undefined && { since: q.since }),
      ...(q.until !== undefined && { until: q.until }),
      ...(q.cursor !== undefined && { cursor: q.cursor }),
      ...(q.limit !== undefined && { limit: q.limit }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }
}

// ============================================================================
// Plugin
// ============================================================================

/**
 * Fastify plugin that registers brand-listening read routes under /api/listening.
 */
const listeningRoutes: FastifyPluginAsync = async (app) => {
  const getShareOfVoiceQuery = app.container.resolve<GetShareOfVoiceQuery>(
    TOKENS.GetShareOfVoiceQuery
  );
  const listMentionsQuery = app.container.resolve<ListMentionsQuery>(TOKENS.ListMentionsQuery);

  const handler = new ListeningRouteHandler(getShareOfVoiceQuery, listMentionsQuery);

  app.get(
    "/listening/share-of-voice",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Listening"], summary: "Share of Voice for a project" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getShareOfVoice(request, reply)
  );

  app.get(
    "/listening/mentions",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Listening"], summary: "List brand mentions" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listMentions(request, reply)
  );
};

export { listeningRoutes };
