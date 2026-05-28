/**
 * @file commentRoutes.ts
 * @description Fastify plugin registering in-context comment endpoints.
 *   Resolves use cases from DI and delegates to handler methods.
 *   Supports threaded comments with cursor-based pagination.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { CreateCommentUseCase } from "@core/comments/CreateCommentUseCase.js";
import type { EditCommentUseCase } from "@core/comments/EditCommentUseCase.js";
import type { DeleteCommentUseCase } from "@core/comments/DeleteCommentUseCase.js";
import type { GetPostCommentsQuery } from "@core/comments/GetPostCommentsQuery.js";

// --- Zod Schemas ---

const PostIdParamsSchema = z.object({
  postId: z.string().uuid(),
});

const CommentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const CreateCommentBodySchema = z.object({
  authorId: z.string().uuid(),
  body: z.string().min(1).max(2000),
  parentId: z.string().uuid().optional(),
});

const EditCommentBodySchema = z.object({
  editorId: z.string().uuid(),
  body: z.string().min(1).max(2000),
});

const ListCommentsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  parentOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

/**
 * @class CommentRouteHandler
 * @description Route handler for in-context comment endpoints.
 *   All operations delegate to application-layer use cases.
 */
class CommentRouteHandler extends BaseRouteHandler {
  protected routeName = "comments";

  constructor(
    private readonly createUseCase: CreateCommentUseCase,
    private readonly editUseCase: EditCommentUseCase,
    private readonly deleteUseCase: DeleteCommentUseCase,
    private readonly getCommentsQuery: GetPostCommentsQuery
  ) {
    super();
  }

  /**
   * @method createComment
   * @description POST /posts/:postId/comments -- Creates a new comment on a post
   */
  async createComment(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof PostIdParamsSchema>;
    }>(ctx, { params: PostIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof CreateCommentBodySchema>;
    }>(ctx, { body: CreateCommentBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const body = bodyValidation.value.body;
    const result = await this.createUseCase.execute({
      postId: paramsValidation.value.params.postId,
      authorId: body.authorId,
      body: body.body,
      ...(body.parentId !== undefined && { parentId: body.parentId }),
    });

    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method listComments
   * @description GET /posts/:postId/comments -- Lists comments with threaded pagination
   */
  async listComments(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof PostIdParamsSchema>;
    }>(ctx, { params: PostIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const queryValidation = await this.validateRequest<{
      query: z.infer<typeof ListCommentsQuerySchema>;
    }>(ctx, { query: ListCommentsQuerySchema });

    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const query = queryValidation.value.query;
    const result = await this.getCommentsQuery.execute({
      postId: paramsValidation.value.params.postId,
      ...(query.cursor !== undefined && { cursor: query.cursor }),
      ...(query.limit !== undefined && { limit: query.limit }),
      ...(query.parentOnly !== undefined && { parentOnly: query.parentOnly }),
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method editComment
   * @description PATCH /comments/:id -- Edits a comment body
   */
  async editComment(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof CommentIdParamsSchema>;
    }>(ctx, { params: CommentIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid comment ID");
    }

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof EditCommentBodySchema>;
    }>(ctx, { body: EditCommentBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const editBody = bodyValidation.value.body;
    const result = await this.editUseCase.execute({
      commentId: paramsValidation.value.params.id,
      editorId: editBody.editorId,
      body: editBody.body,
    });

    if (!result.ok) {
      const statusCode = result.error.code === "NOT_FOUND" ? 404 : 400;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { updated: true });
  }

  /**
   * @method deleteComment
   * @description DELETE /comments/:id -- Soft-deletes a comment
   */
  async deleteComment(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof CommentIdParamsSchema>;
    }>(ctx, { params: CommentIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid comment ID");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.deleteUseCase.execute({
      commentId: paramsValidation.value.params.id,
      deleterId: user.id,
      isAdmin: false,
    });

    if (!result.ok) {
      const statusCode =
        result.error.code === "NOT_FOUND" ? 404 : result.error.code === "FORBIDDEN" ? 403 : 400;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { deleted: true });
  }
}

/**
 * Fastify plugin that registers in-context comment routes
 */
export const commentRoutes: FastifyPluginAsync = async (app) => {
  const createUseCase = app.container.resolve<CreateCommentUseCase>(TOKENS.CreateCommentUseCase);
  const editUseCase = app.container.resolve<EditCommentUseCase>(TOKENS.EditCommentUseCase);
  const deleteUseCase = app.container.resolve<DeleteCommentUseCase>(TOKENS.DeleteCommentUseCase);
  const getCommentsQuery = app.container.resolve<GetPostCommentsQuery>(TOKENS.GetPostCommentsQuery);

  const handler = new CommentRouteHandler(
    createUseCase,
    editUseCase,
    deleteUseCase,
    getCommentsQuery
  );

  // Create a comment on a post
  app.post(
    "/posts/:postId/comments",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Comments"], summary: "Create a comment on a post" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.createComment(request, reply)
  );

  // List comments for a post (threaded, paginated)
  app.get(
    "/posts/:postId/comments",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Comments"], summary: "List comments for a post" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listComments(request, reply)
  );

  // Edit a comment
  app.patch(
    "/comments/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Comments"], summary: "Edit a comment" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.editComment(request, reply)
  );

  // Soft-delete a comment
  app.delete(
    "/comments/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Comments"], summary: "Soft-delete a comment" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.deleteComment(request, reply)
  );
};
