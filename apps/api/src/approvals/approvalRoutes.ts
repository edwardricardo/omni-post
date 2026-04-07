/**
 * @file approvalRoutes.ts
 * @description Fastify plugin registering content approval workflow endpoints.
 *   Resolves use cases from DI and delegates to handler methods.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { SubmitForReviewUseCase } from "../application/approvals/SubmitForReviewUseCase.js";
import type { ApprovePostUseCase } from "../application/approvals/ApprovePostUseCase.js";
import type { RejectPostUseCase } from "../application/approvals/RejectPostUseCase.js";
import type { GetApprovalHistoryQuery } from "../application/approvals/GetApprovalHistoryQuery.js";
import type { GetPendingApprovalsQuery } from "../application/approvals/GetPendingApprovalsQuery.js";

// --- Zod Schemas ---

const PostIdParamsSchema = z.object({
  postId: z.string().uuid(),
});

const ApprovalIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const SubmitForReviewBodySchema = z.object({
  submitterId: z.string().uuid(),
  accountId: z.string().min(1).optional(),
  comment: z.string().max(2000).optional(),
  workflowId: z.string().min(1).optional(),
});

const ApproveBodySchema = z.object({
  reviewerId: z.string().uuid(),
  comment: z.string().max(2000).optional(),
});

const RejectBodySchema = z.object({
  reviewerId: z.string().uuid(),
  comment: z.string().max(2000).optional(),
});

const PendingQuerySchema = z.object({
  reviewerId: z.string().uuid(),
});

/**
 * @class ApprovalRouteHandler
 * @description Route handler for content approval workflow endpoints.
 *   All operations delegate to application-layer use cases.
 */
class ApprovalRouteHandler extends BaseRouteHandler {
  protected routeName = "approvals";

  constructor(
    private readonly submitUseCase: SubmitForReviewUseCase,
    private readonly approveUseCase: ApprovePostUseCase,
    private readonly rejectUseCase: RejectPostUseCase,
    private readonly historyQuery: GetApprovalHistoryQuery,
    private readonly pendingQuery: GetPendingApprovalsQuery
  ) {
    super();
  }

  /**
   * @method submitForReview
   * @description POST /posts/:postId/submit-for-review -- Submits a post for content review
   */
  async submitForReview(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof PostIdParamsSchema>;
    }>(ctx, { params: PostIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof SubmitForReviewBodySchema>;
    }>(ctx, { body: SubmitForReviewBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { postId } = paramsValidation.value.params;
    const body = bodyValidation.value.body;

    const result = await this.submitUseCase.execute({
      postId,
      submitterId: body.submitterId,
      ...(body.accountId !== undefined && { accountId: body.accountId }),
      ...(body.comment !== undefined && { comment: body.comment }),
      ...(body.workflowId !== undefined && { workflowId: body.workflowId }),
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        VALIDATION_FAILED: 400,
        CONFLICT: 409,
      };
      const statusCode = statusMap[result.error.code] ?? 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method approve
   * @description POST /approvals/:id/approve -- Approves an approval request
   */
  async approve(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof ApprovalIdParamsSchema>;
    }>(ctx, { params: ApprovalIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid approval request ID");
    }

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof ApproveBodySchema>;
    }>(ctx, { body: ApproveBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsValidation.value.params;
    const body = bodyValidation.value.body;

    const result = await this.approveUseCase.execute({
      requestId: id,
      reviewerId: body.reviewerId,
      ...(body.comment !== undefined && { comment: body.comment }),
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        VALIDATION_FAILED: 400,
      };
      const statusCode = statusMap[result.error.code] ?? 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { approved: true });
  }

  /**
   * @method reject
   * @description POST /approvals/:id/reject -- Rejects an approval request
   */
  async reject(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof ApprovalIdParamsSchema>;
    }>(ctx, { params: ApprovalIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid approval request ID");
    }

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof RejectBodySchema>;
    }>(ctx, { body: RejectBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsValidation.value.params;
    const body = bodyValidation.value.body;

    const result = await this.rejectUseCase.execute({
      requestId: id,
      reviewerId: body.reviewerId,
      ...(body.comment !== undefined && { comment: body.comment }),
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        VALIDATION_FAILED: 400,
      };
      const statusCode = statusMap[result.error.code] ?? 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { rejected: true });
  }

  /**
   * @method getHistory
   * @description GET /posts/:postId/approvals -- Returns approval history for a post
   */
  async getHistory(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateRequest<{
      params: z.infer<typeof PostIdParamsSchema>;
    }>(ctx, { params: PostIdParamsSchema });

    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const result = await this.historyQuery.execute({
      postId: validation.value.params.postId,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, { approvals: result.value });
  }

  /**
   * @method getPending
   * @description GET /approvals/pending -- Returns pending approvals for a reviewer
   */
  async getPending(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateRequest<{
      query: z.infer<typeof PendingQuerySchema>;
    }>(ctx, { query: PendingQuerySchema });

    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters (reviewerId required)");
    }

    const result = await this.pendingQuery.execute({
      reviewerId: validation.value.query.reviewerId,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, { approvals: result.value });
  }
}

/**
 * Fastify plugin that registers content approval workflow routes
 */
export const approvalRoutes: FastifyPluginAsync = async (app) => {
  const submitUseCase = app.container.resolve<SubmitForReviewUseCase>(
    TOKENS.SubmitForReviewUseCase
  );
  const approveUseCase = app.container.resolve<ApprovePostUseCase>(TOKENS.ApprovePostUseCase);
  const rejectUseCase = app.container.resolve<RejectPostUseCase>(TOKENS.RejectPostUseCase);
  const historyQuery = app.container.resolve<GetApprovalHistoryQuery>(
    TOKENS.GetApprovalHistoryQuery
  );
  const pendingQuery = app.container.resolve<GetPendingApprovalsQuery>(
    TOKENS.GetPendingApprovalsQuery
  );

  const handler = new ApprovalRouteHandler(
    submitUseCase,
    approveUseCase,
    rejectUseCase,
    historyQuery,
    pendingQuery
  );

  // Submit a post for content review
  app.post(
    "/posts/:postId/submit-for-review",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Approvals"], summary: "Submit post for review" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.submitForReview(request, reply)
  );

  // Approve an approval request
  app.post(
    "/approvals/:id/approve",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Approvals"], summary: "Approve an approval request" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.approve(request, reply)
  );

  // Reject an approval request
  app.post(
    "/approvals/:id/reject",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Approvals"], summary: "Reject an approval request" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.reject(request, reply)
  );

  // Get approval history for a post
  app.get(
    "/posts/:postId/approvals",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Approvals"], summary: "Get approval history for a post" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getHistory(request, reply)
  );

  // Get pending approvals for a reviewer
  app.get(
    "/approvals/pending",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Approvals"], summary: "Get pending approvals" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getPending(request, reply)
  );
};
