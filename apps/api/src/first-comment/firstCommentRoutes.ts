/**
 * @file firstCommentRoutes.ts
 * @description Fastify plugin registering first comment scheduling endpoints.
 *   Resolves use cases from DI and delegates to handler methods.
 *   Supports setting, getting, and removing a first comment for a post.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { SetFirstCommentUseCase } from "../application/first-comment/SetFirstCommentUseCase.js";
import type { RemoveFirstCommentUseCase } from "../application/first-comment/RemoveFirstCommentUseCase.js";
import type { GetFirstCommentQuery } from "../application/first-comment/GetFirstCommentQuery.js";

// --- Zod Schemas ---

const PostIdParamsSchema = z.object({
  postId: z.string().uuid(),
});

const SetFirstCommentBodySchema = z.object({
  body: z.string().min(1).max(2000),
});

/**
 * @class FirstCommentRouteHandler
 * @description Route handler for first comment scheduling endpoints.
 *   All operations delegate to application-layer use cases resolved from DI.
 */
class FirstCommentRouteHandler extends BaseRouteHandler {
  protected routeName = "first-comment";

  constructor(
    private readonly setUseCase: SetFirstCommentUseCase,
    private readonly removeUseCase: RemoveFirstCommentUseCase,
    private readonly getQuery: GetFirstCommentQuery
  ) {
    super();
  }

  /**
   * @method setFirstComment
   * @description PUT /posts/:postId/first-comment -- Set or update the first comment
   */
  async setFirstComment(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof PostIdParamsSchema>;
    }>(ctx, { params: PostIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof SetFirstCommentBodySchema>;
    }>(ctx, { body: SetFirstCommentBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.setUseCase.execute({
      postId: paramsValidation.value.params.postId,
      body: bodyValidation.value.body.body,
    });

    if (!result.ok) {
      const statusCode = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, result.value, 200);
  }

  /**
   * @method getFirstComment
   * @description GET /posts/:postId/first-comment -- Get the first comment for a post
   */
  async getFirstComment(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof PostIdParamsSchema>;
    }>(ctx, { params: PostIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.getQuery.execute({
      postId: paramsValidation.value.params.postId,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    if (!result.value) {
      return this.sendError(ctx, 404, "No first comment found for this post");
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method removeFirstComment
   * @description DELETE /posts/:postId/first-comment -- Remove the first comment
   */
  async removeFirstComment(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof PostIdParamsSchema>;
    }>(ctx, { params: PostIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.removeUseCase.execute({
      postId: paramsValidation.value.params.postId,
    });

    if (!result.ok) {
      const statusCode = result.error.code === "NOT_FOUND" ? 404 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { deleted: true });
  }
}

/**
 * Fastify plugin that registers first comment scheduling routes
 */
export const firstCommentRoutes: FastifyPluginAsync = async (app) => {
  const setUseCase = app.container.resolve<SetFirstCommentUseCase>(TOKENS.SetFirstCommentUseCase);
  const removeUseCase = app.container.resolve<RemoveFirstCommentUseCase>(
    TOKENS.RemoveFirstCommentUseCase
  );
  const getQuery = app.container.resolve<GetFirstCommentQuery>(TOKENS.GetFirstCommentQuery);

  const handler = new FirstCommentRouteHandler(setUseCase, removeUseCase, getQuery);

  // Set or update the first comment for a post
  app.put(
    "/posts/:postId/first-comment",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["First Comment"], summary: "Set or update first comment for a post" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.setFirstComment(request, reply)
  );

  // Get the first comment for a post
  app.get(
    "/posts/:postId/first-comment",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["First Comment"], summary: "Get first comment for a post" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getFirstComment(request, reply)
  );

  // Remove the first comment for a post
  app.delete(
    "/posts/:postId/first-comment",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["First Comment"], summary: "Remove first comment for a post" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.removeFirstComment(request, reply)
  );
};
