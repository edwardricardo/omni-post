/**
 * @file postRoutes.ts
 * @description REST API endpoints for post CRUD and scheduling, delegating all operations
 *              to DDD use cases resolved from the DI container.
 * @layer infrastructure
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { IdSchema } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import { SecureSchemas } from "../security/inputValidation.js";
import type { GetPostWithThreadQuery } from "../application/posts/GetPostWithThreadQuery.js";
import type { UpdatePostUseCase } from "../application/posts/UpdatePostUseCase.js";
import type { ListPostsUseCase } from "../application/posts/ListPostsUseCase.js";
import type { ListPostsGlobalQuery } from "../application/posts/ListPostsGlobalQuery.js";
import type { DeletePostUseCase } from "../application/posts/DeletePostUseCase.js";
import type { ArchivePostsBatchUseCase } from "../application/posts/ArchivePostsBatchUseCase.js";
import type { HardDeletePostsBatchUseCase } from "../application/posts/HardDeletePostsBatchUseCase.js";
import type { DuplicatePostsBatchUseCase } from "../application/posts/DuplicatePostsBatchUseCase.js";
import { USE_CASE_ERRORS } from "../application/UseCase.js";
import type { PublishStatusValue } from "../domain/value-objects/PublishStatus.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";

// ---------------------------------------------------------------------------
// Zod Schemas for Validation with security enhancement
// ---------------------------------------------------------------------------

const PostParamsSchema = z.object({
  id: IdSchema,
});

const BatchPostsBodySchema = z.object({
  postIds: z.array(z.string().uuid()).min(1).max(100),
});

const UpdatePostBodySchema = z.object({
  body: SecureSchemas.postBody.optional(),
  title: SecureSchemas.userName.optional(),
  summary: z.string().max(500).optional(),
  tags: z.array(z.string()).optional(),
});

const PublishStatusEnum = z.enum([
  "DRAFT",
  "PENDING_REVIEW",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
]);

const csvTransform = (v: string | undefined): string[] | undefined =>
  v
    ? v
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

const ListPostsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  /** Single value (`?status=DRAFT`) or CSV multi (`?status=DRAFT,SCHEDULED`). */
  status: z
    .string()
    .optional()
    .transform((v, ctx) => {
      const arr = csvTransform(v);
      if (!arr) return undefined;
      for (const s of arr) {
        if (!PublishStatusEnum.safeParse(s).success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid status: ${s}`,
          });
          return z.NEVER;
        }
      }
      return arr.length === 1 ? arr[0] : arr;
    }),
  tags: z.string().optional().transform(csvTransform),
  hasMedia: z.coerce.boolean().optional(),
  /** ISO 8601 datetime range bounds. */
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  scheduledFrom: z.string().datetime().optional(),
  scheduledTo: z.string().datetime().optional(),
  searchText: z.string().min(1).max(200).optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "scheduledAt", "publishedAt", "status"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  /** Set to "true" to include archived posts in the result set. */
  includeArchived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

/**
 * Post Route Handler. Exposes list, get, update, soft-delete, and batch
 * operations on existing posts. Post creation, scheduling, and publish-now
 * are driven by `POST /sagas/post-publishing/start`.
 */
class PostRouteHandler extends BaseRouteHandler {
  protected routeName = "posts";

  constructor(
    private readonly getPostWithThreadQuery: GetPostWithThreadQuery,
    private readonly updatePostUseCase: UpdatePostUseCase,
    private readonly listPostsUseCase: ListPostsUseCase,
    private readonly listPostsGlobalQuery: ListPostsGlobalQuery,
    private readonly deletePostUseCase: DeletePostUseCase,
    private readonly archivePostsBatchUseCase: ArchivePostsBatchUseCase,
    private readonly hardDeletePostsBatchUseCase: HardDeletePostsBatchUseCase,
    private readonly duplicatePostsBatchUseCase: DuplicatePostsBatchUseCase
  ) {
    super();
  }

  // -----------------------------------------------------------------------
  // GET /posts — List Posts
  // -----------------------------------------------------------------------

  async listPosts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Listing posts");

    const validation = await this.validateQuery(ctx, ListPostsQuerySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const {
      projectId,
      status,
      tags,
      hasMedia,
      createdFrom,
      createdTo,
      scheduledFrom,
      scheduledTo,
      searchText,
      sortBy,
      sortDirection,
      includeArchived,
      limit,
      offset,
    } = validation.value;

    try {
      // When projectId is provided, delegate to the project-scoped use case
      if (projectId) {
        const page = Math.max(1, Math.floor(offset / limit) + 1);
        const result = await this.listPostsUseCase.execute({
          projectId,
          page,
          limit,
          ...(status !== undefined && {
            status: status as PublishStatusValue | PublishStatusValue[],
          }),
          ...(tags !== undefined && { tags }),
          ...(hasMedia !== undefined && { hasMedia }),
          ...(createdFrom !== undefined && { createdFrom }),
          ...(createdTo !== undefined && { createdTo }),
          ...(scheduledFrom !== undefined && { scheduledFrom }),
          ...(scheduledTo !== undefined && { scheduledTo }),
          ...(searchText !== undefined && { searchText }),
          ...(sortBy !== undefined && { sortBy }),
          ...(sortDirection !== undefined && { sortDirection }),
          ...(includeArchived === true && { includeArchived: true }),
        });

        if (!result.ok) {
          return this.mapUseCaseError(ctx, result.error);
        }

        const output = result.value;
        return this.sendSuccess(ctx, {
          data: output.items,
          total: output.total,
          limit: output.limit,
          offset,
        });
      }

      // No projectId — delegate to global listing query
      const page = Math.max(1, Math.floor(offset / limit) + 1);
      const result = await this.listPostsGlobalQuery.execute({
        ...(status !== undefined && { status: status as PublishStatusValue }),
        page,
        limit,
      });

      if (!result.ok) {
        return this.mapUseCaseError(ctx, result.error);
      }

      const output = result.value;
      this.sendSuccess(ctx, {
        data: output.items,
        total: output.total,
        limit: output.limit,
        offset,
      });
    } catch (error) {
      this.logError(ctx, "Failed to list posts", { error });
      return this.sendError(ctx, 500, "Failed to list posts");
    }
  }

  // -----------------------------------------------------------------------
  // GET /posts/:id — Get Post by ID (with thread enrichment)
  // -----------------------------------------------------------------------

  async getPost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Getting post");

    const validation = await this.validateParams(ctx, PostParamsSchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const { id } = validation.value;

    try {
      // Delegate to query that includes thread data
      const result = await this.getPostWithThreadQuery.execute({ postId: id });

      if (!result.ok) {
        return this.mapUseCaseError(ctx, result.error);
      }

      const post = result.value;
      this.logInfo(ctx, "Post retrieved successfully", { postId: id });

      this.sendSuccess(ctx, {
        id: post.id,
        projectId: post.projectId,
        locale: post.locale,
        body: post.body,
        ...(post.title && { title: post.title }),
        tags: post.tags,
        status: post.status,
        createdAt: post.createdAt,
        ...(post.thread && { thread: post.thread }),
      });
    } catch (error) {
      this.logError(ctx, "Failed to get post", { error });
      return this.sendError(ctx, 500, "Failed to get post");
    }
  }

  // -----------------------------------------------------------------------
  // PATCH /posts/:id — Update Post (via UpdatePostUseCase)
  // -----------------------------------------------------------------------

  /**
   * Update an existing post's content.
   *
   * @description Delegates to UpdatePostUseCase which validates that the post
   * exists and is in an editable status (DRAFT or FAILED). Only provided
   * fields are updated; omitted fields remain unchanged.
   *
   * @param request - Fastify request with post ID in params and update fields in body
   * @param reply - Fastify reply
   * @returns Updated post DTO on success, or an error response
   * @throws 400 if validation fails (invalid ID or body content)
   * @throws 403 if the post is not in an editable status
   * @throws 404 if the post does not exist
   */
  async updatePost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Updating post");

    const paramValidation = await this.validateParams(ctx, PostParamsSchema);
    if (!paramValidation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const bodyValidation = await this.validateBody(ctx, UpdatePostBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid update data");
    }

    const { id } = paramValidation.value;
    const { body, title, summary, tags } = bodyValidation.value;

    // Ensure at least one field is being updated
    if (!body && !title && !summary && !tags) {
      return this.sendError(ctx, 400, "At least one field must be provided for update");
    }

    try {
      const result = await this.updatePostUseCase.execute({
        postId: id,
        ...(body && { body }),
        ...(title && { title }),
        ...(summary && { summary }),
        ...(tags && { tags }),
      });

      if (!result.ok) {
        return this.mapUseCaseError(ctx, result.error);
      }

      const output = result.value;
      this.logInfo(ctx, "Post updated successfully", { postId: id });

      this.sendSuccess(ctx, {
        id: output.id,
        projectId: output.projectId,
        locale: output.locale,
        body: output.body,
        ...(output.title && { title: output.title }),
        ...(output.summary && { summary: output.summary }),
        tags: output.tags,
        status: output.status,
        mediaCount: output.mediaCount,
        createdAt: output.createdAt,
        updatedAt: output.updatedAt,
      });
    } catch (error) {
      this.logError(ctx, "Failed to update post", { error });
      return this.sendError(ctx, 500, "Failed to update post");
    }
  }

  // -----------------------------------------------------------------------
  // DELETE /posts/:id — Delete Post (soft-delete via use case)
  // -----------------------------------------------------------------------

  async deletePost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Deleting post");

    const validation = await this.validateParams(ctx, PostParamsSchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const { id } = validation.value;

    try {
      const result = await this.deletePostUseCase.execute({ postId: id });

      if (!result.ok) {
        return this.mapUseCaseError(ctx, result.error);
      }

      this.logInfo(ctx, "Post deleted successfully", { postId: id });
      this.sendSuccess(ctx, { deleted: true });
    } catch (error) {
      this.logError(ctx, "Failed to delete post", { error });
      return this.sendError(ctx, 500, "Failed to delete post");
    }
  }

  // -----------------------------------------------------------------------
  // PATCH /posts/batch/archive — Bulk archive
  // -----------------------------------------------------------------------

  async archivePostsBatch(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Archiving posts batch");

    const validation = await this.validateBody(ctx, BatchPostsBodySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    try {
      const result = await this.archivePostsBatchUseCase.execute({
        postIds: validation.value.postIds,
      });

      if (!result.ok) {
        return this.mapUseCaseError(ctx, result.error);
      }

      this.logInfo(ctx, "Posts archived", {
        archived: result.value.archived,
        invalidCount: result.value.invalidIds.length,
      });
      this.sendSuccess(ctx, result.value);
    } catch (error) {
      this.logError(ctx, "Failed to archive posts batch", { error });
      return this.sendError(ctx, 500, "Failed to archive posts");
    }
  }

  // -----------------------------------------------------------------------
  // DELETE /posts/batch — Bulk hard-delete (irreversible)
  // -----------------------------------------------------------------------

  async hardDeletePostsBatch(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Hard-deleting posts batch");

    const validation = await this.validateBody(ctx, BatchPostsBodySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    try {
      const result = await this.hardDeletePostsBatchUseCase.execute({
        postIds: validation.value.postIds,
      });

      if (!result.ok) {
        return this.mapUseCaseError(ctx, result.error);
      }

      this.logInfo(ctx, "Posts hard-deleted", {
        deleted: result.value.deleted,
        invalidCount: result.value.invalidIds.length,
      });
      this.sendSuccess(ctx, result.value);
    } catch (error) {
      this.logError(ctx, "Failed to hard-delete posts batch", { error });
      return this.sendError(ctx, 500, "Failed to delete posts");
    }
  }

  // -----------------------------------------------------------------------
  // POST /posts/batch/duplicate — Bulk duplicate (clone to DRAFT)
  // -----------------------------------------------------------------------

  async duplicatePostsBatch(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Duplicating posts batch");

    const validation = await this.validateBody(ctx, BatchPostsBodySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    try {
      const result = await this.duplicatePostsBatchUseCase.execute({
        postIds: validation.value.postIds,
      });

      if (!result.ok) {
        return this.mapUseCaseError(ctx, result.error);
      }

      this.logInfo(ctx, "Posts duplicated", {
        duplicated: result.value.duplicates.length,
        invalidCount: result.value.invalidIds.length,
        notFoundCount: result.value.notFoundIds.length,
      });
      this.sendSuccess(ctx, result.value);
    } catch (error) {
      this.logError(ctx, "Failed to duplicate posts batch", { error });
      return this.sendError(ctx, 500, "Failed to duplicate posts");
    }
  }

  // -----------------------------------------------------------------------
  // Error mapping helper
  // -----------------------------------------------------------------------

  /**
   * Map UseCaseError to HTTP response based on its error code.
   */
  private mapUseCaseError(ctx: RouteContext, error: { code: string; message: string }): void {
    const statusMap: Record<string, number> = {
      [USE_CASE_ERRORS.NOT_FOUND]: 404,
      [USE_CASE_ERRORS.VALIDATION_FAILED]: 400,
      [USE_CASE_ERRORS.UNAUTHORIZED]: 401,
      [USE_CASE_ERRORS.FORBIDDEN]: 403,
      [USE_CASE_ERRORS.CONFLICT]: 409,
      [USE_CASE_ERRORS.INTERNAL_ERROR]: 500,
    };

    const statusCode = statusMap[error.code] ?? 500;

    // Use human-friendly messages for common errors
    const messageMap: Record<string, string> = {
      [USE_CASE_ERRORS.NOT_FOUND]: "Post not found",
      [USE_CASE_ERRORS.VALIDATION_FAILED]: "Validation failed",
      [USE_CASE_ERRORS.FORBIDDEN]: "Operation not allowed",
    };

    const message = messageMap[error.code] ?? error.message;
    this.sendError(ctx, statusCode, message);
  }
}

// ---------------------------------------------------------------------------
// Fastify Plugin
// ---------------------------------------------------------------------------

/**
 * Post Routes Plugin
 *
 * Resolves all use cases and repository ports from the DI container.
 * No direct Prisma dependency. All data access goes through use cases
 * and repository ports following hexagonal architecture.
 *
 * Routes:
 * - GET    /posts                — List posts (project-scoped or global)
 * - GET    /posts/:id            — Get post with thread (GetPostWithThreadQuery)
 * - PATCH  /posts/:id            — Update post content (UpdatePostUseCase)
 * - DELETE /posts/:id            — Soft-delete post (DeletePostUseCase)
 * - PATCH  /posts/batch/archive  — Bulk archive (ArchivePostsBatchUseCase)
 * - DELETE /posts/batch          — Bulk hard-delete (HardDeletePostsBatchUseCase)
 * - POST   /posts/batch/duplicate — Bulk duplicate (DuplicatePostsBatchUseCase)
 *
 * Post creation, scheduling, and publish-now: see `POST /sagas/post-publishing/start`.
 */
export const postRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container!;

  const handler = new PostRouteHandler(
    container.resolve<GetPostWithThreadQuery>(TOKENS.GetPostWithThreadQuery),
    container.resolve<UpdatePostUseCase>(TOKENS.UpdatePostUseCase),
    container.resolve<ListPostsUseCase>(TOKENS.ListPostsUseCase),
    container.resolve<ListPostsGlobalQuery>(TOKENS.ListPostsGlobalQuery),
    container.resolve<DeletePostUseCase>(TOKENS.DeletePostUseCase),
    container.resolve<ArchivePostsBatchUseCase>(TOKENS.ArchivePostsBatchUseCase),
    container.resolve<HardDeletePostsBatchUseCase>(TOKENS.HardDeletePostsBatchUseCase),
    container.resolve<DuplicatePostsBatchUseCase>(TOKENS.DuplicatePostsBatchUseCase)
  );

  // List posts
  fastify.get(
    "/posts",
    { preHandler: [requireClientAuth], schema: { tags: ["Posts"], summary: "List posts" } },
    async (request, reply) => handler.listPosts(request, reply)
  );

  // Get post by ID
  fastify.get(
    "/posts/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Posts"], summary: "Get post by ID" },
    },
    async (request, reply) => handler.getPost(request, reply)
  );

  // Update post
  fastify.patch(
    "/posts/:id",
    { preHandler: [requireClientAuth], schema: { tags: ["Posts"], summary: "Update post" } },
    async (request, reply) => handler.updatePost(request, reply)
  );

  // Delete post
  fastify.delete(
    "/posts/:id",
    { preHandler: [requireClientAuth], schema: { tags: ["Posts"], summary: "Delete post" } },
    async (request, reply) => handler.deletePost(request, reply)
  );

  // Bulk archive
  fastify.patch(
    "/posts/batch/archive",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Posts"], summary: "Bulk archive posts" },
    },
    async (request, reply) => handler.archivePostsBatch(request, reply)
  );

  // Bulk hard-delete (irreversible)
  fastify.delete(
    "/posts/batch",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Posts"], summary: "Bulk hard-delete posts (irreversible)" },
    },
    async (request, reply) => handler.hardDeletePostsBatch(request, reply)
  );

  // Bulk duplicate
  fastify.post(
    "/posts/batch/duplicate",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Posts"], summary: "Bulk duplicate posts as DRAFT" },
    },
    async (request, reply) => handler.duplicatePostsBatch(request, reply)
  );
};
