/**
 * @file repurposeRoutes.ts
 * @description Client-facing REST routes for the AI repurpose pipeline.
 *
 *   GET  /repurpose/proposals -> ListRepurposeProposalsQuery (paginated,
 *        account-scoped to the caller's JWT, optional status filter)
 *   POST /repurpose/detect    -> DetectRepurposeCandidatesUseCase for the
 *        caller's account (scans high performers, creates proposals,
 *        enqueues GENERATE_REPURPOSE — idempotent at proposal level)
 *
 *   Both endpoints are scoped to `request.customerUser.accountId`; the
 *   account is never taken from the request body (tenant isolation).
 *   The daily batch detection runs via DispatchDetectRepurposeUseCase;
 *   POST /repurpose/detect is the on-demand override for one account.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import type { ListRepurposeProposalsQuery } from "../application/ai/ListRepurposeProposalsQuery.js";
import type { DetectRepurposeCandidatesUseCase } from "../application/ai/DetectRepurposeCandidatesUseCase.js";

// ============================================================================
// Schemas
// ============================================================================

const ListQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "PUBLISHED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ============================================================================
// Handler
// ============================================================================

class RepurposeRouteHandler extends BaseRouteHandler {
  protected routeName = "repurpose";

  constructor(
    private readonly listQuery: ListRepurposeProposalsQuery,
    private readonly detectUseCase: DetectRepurposeCandidatesUseCase
  ) {
    super();
  }

  /**
   * Resolves the caller's account from the customer JWT attached by
   * `requireClientAuth`. Returns undefined when absent (defence in depth —
   * the preHandler already rejects unauthenticated requests).
   */
  private getAccountId(request: FastifyRequest): string | undefined {
    return request.customerUser?.accountId;
  }

  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validation = await this.validateQuery(ctx, ListQuerySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }
    const { status, limit, offset } = validation.value;

    const result = await this.listQuery.execute({
      accountId,
      ...(status !== undefined && { status }),
      limit,
      offset,
    });
    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async triggerDetect(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.detectUseCase.execute({ accountId });
    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }
}

// ============================================================================
// Plugin
// ============================================================================

export const repurposeRoutes: FastifyPluginAsync = async (app) => {
  const handler = new RepurposeRouteHandler(
    app.container.resolve<ListRepurposeProposalsQuery>(TOKENS.ListRepurposeProposalsQuery),
    app.container.resolve<DetectRepurposeCandidatesUseCase>(TOKENS.DetectRepurposeCandidatesUseCase)
  );

  app.get(
    "/repurpose/proposals",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["AI", "Repurpose"],
        summary: "List the account's AI-detected repurpose proposals",
      },
    },
    (req: FastifyRequest, reply: FastifyReply) => handler.list(req, reply)
  );

  app.post(
    "/repurpose/detect",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["AI", "Repurpose"],
        summary: "Run repurpose detection on demand for the caller's account",
      },
    },
    (req: FastifyRequest, reply: FastifyReply) => handler.triggerDetect(req, reply)
  );
};
