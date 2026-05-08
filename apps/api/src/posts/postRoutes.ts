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
import type { CreatePostUseCase } from "../application/posts/CreatePostUseCase.js";
import type { GetPostWithThreadQuery } from "../application/posts/GetPostWithThreadQuery.js";
import type { UpdatePostUseCase } from "../application/posts/UpdatePostUseCase.js";
import type { ListPostsUseCase } from "../application/posts/ListPostsUseCase.js";
import type { ListPostsGlobalQuery } from "../application/posts/ListPostsGlobalQuery.js";
import type { DeletePostUseCase } from "../application/posts/DeletePostUseCase.js";
import type { SchedulePostUseCase } from "../application/posts/SchedulePostUseCase.js";
import { USE_CASE_ERRORS } from "../application/UseCase.js";
import { ProjectId, type ContentLocale, type ProjectRepository } from "../domain/index.js";
import type { PublishStatusValue } from "../domain/value-objects/PublishStatus.js";
import type { IncrementUsageUseCase } from "../application/usage/IncrementUsageUseCase.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";

// ---------------------------------------------------------------------------
// Zod Schemas for Validation with security enhancement
// ---------------------------------------------------------------------------

const CreatePostBodySchema = z.object({
  projectId: z.string().uuid(),
  /** Optional — when provided, usage counter is incremented for this account */
  accountId: z.string().uuid().optional(),
  locale: z.string().min(2).max(5),
  body: SecureSchemas.postBody,
  title: SecureSchemas.userName.optional(), // userName has max 256 chars built-in
  tags: z.array(z.string()).default([]),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"]).default("DRAFT"),
});

const SchedulePostBodySchema = z.object({
  channelIds: z.array(z.string().uuid()),
  scheduledFor: z.string().datetime(),
});

const PostParamsSchema = z.object({
  id: IdSchema,
});

const UpdatePostBodySchema = z.object({
  body: SecureSchemas.postBody.optional(),
  title: SecureSchemas.userName.optional(),
  summary: z.string().max(500).optional(),
  tags: z.array(z.string()).optional(),
});

const ListPostsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"]).optional(),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined
    ),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

/**
 * Post Route Handler
 *
 * Delegates all operations to application-layer use cases resolved from the
 * DI container. No direct Prisma dependency remains.
 *
 * Use cases used:
 * - CreatePostUseCase: Creates a post in the domain aggregate.
 * - GetPostWithThreadQuery: Reads a post with optional thread enrichment.
 * - ListPostsUseCase: Lists posts within a project (CQRS read side).
 * - ListPostsGlobalQuery: Lists posts across all projects.
 * - UpdatePostUseCase: Updates post content.
 * - DeletePostUseCase: Soft-deletes a post.
 * - SchedulePostUseCase: Transitions a post to SCHEDULED status.
 * - ProjectRepository: Verifies project existence before creating posts.
 */
class PostRouteHandler extends BaseRouteHandler {
  protected routeName = "posts";

  constructor(
    private readonly createPostUseCase: CreatePostUseCase,
    private readonly getPostWithThreadQuery: GetPostWithThreadQuery,
    private readonly updatePostUseCase: UpdatePostUseCase,
    private readonly listPostsUseCase: ListPostsUseCase,
    private readonly listPostsGlobalQuery: ListPostsGlobalQuery,
    private readonly deletePostUseCase: DeletePostUseCase,
    private readonly schedulePostUseCase: SchedulePostUseCase,
    private readonly projectRepository: ProjectRepository,
    private readonly incrementUsageUseCase: IncrementUsageUseCase
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

    const { projectId, status, limit, offset } = validation.value;

    try {
      // When projectId is provided, delegate to the project-scoped use case
      if (projectId) {
        const page = Math.max(1, Math.floor(offset / limit) + 1);
        const result = await this.listPostsUseCase.execute({
          projectId,
          page,
          limit,
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
  // POST /posts — Create Post
  // -----------------------------------------------------------------------

  async createPost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Creating post");

    const validated = await this.validateRequest<{ body: z.infer<typeof CreatePostBodySchema> }>(
      ctx,
      { body: CreatePostBodySchema }
    );
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { projectId, accountId, locale, body, title, tags } = validated.value.body as {
      projectId: string;
      accountId?: string;
      locale: string;
      body: string;
      title?: string;
      tags: string[];
    };

    try {
      // Verify project exists via repository port
      const projectIdResult = ProjectId.fromString(projectId);
      if (!projectIdResult.ok) {
        return this.sendError(ctx, 400, "Invalid project ID");
      }
      const projectExists = await this.projectRepository.exists(projectIdResult.value);
      if (!projectExists) {
        return this.sendError(ctx, 404, "Project not found");
      }

      // Delegate to application use case
      const result = await this.createPostUseCase.execute({
        projectId,
        body,
        ...(title && { title }),
        ...(tags.length > 0 && { tags }),
        locale: locale as ContentLocale,
      });

      if (!result.ok) {
        return this.mapUseCaseError(ctx, result.error);
      }

      const output = result.value;
      this.logInfo(ctx, "Post created successfully", { postId: output.id });

      // Increment usage counter — best-effort, does not fail the request
      if (accountId) {
        void this.incrementUsageUseCase
          .execute({ accountId, field: "postsPublished" })
          .catch(() => void 0);
      }

      this.sendSuccess(
        ctx,
        {
          id: output.id,
          projectId: output.projectId,
          locale: output.locale,
          body: output.body,
          ...(output.title && { title: output.title }),
          tags: output.tags,
          status: output.status,
          createdAt: output.createdAt,
        },
        201
      );
    } catch (error) {
      this.logError(ctx, "Failed to create post", { error });
      return this.sendError(ctx, 500, "Failed to create post");
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
  // POST /posts/:id/schedule — Schedule Post (via SchedulePostUseCase)
  // -----------------------------------------------------------------------

  async schedulePost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Scheduling post");

    const paramValidation = await this.validateParams(ctx, PostParamsSchema);
    if (!paramValidation.ok) {
      return this.sendError(ctx, 400, "Invalid post ID");
    }

    const bodyValidation = await this.validateBody(ctx, SchedulePostBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid schedule data");
    }

    const { id } = paramValidation.value;
    const { channelIds, scheduledFor } = bodyValidation.value;

    try {
      const result = await this.schedulePostUseCase.execute({
        postId: id,
        channelIds,
        scheduledFor,
      });

      if (!result.ok) {
        return this.mapUseCaseError(ctx, result.error);
      }

      const output = result.value;
      this.logInfo(ctx, "Post scheduled successfully", {
        postId: id,
        channelCount: channelIds.length,
      });

      this.sendSuccess(ctx, {
        id: output.id,
        status: output.status,
        scheduledFor: output.scheduledFor,
        channelIds: output.channelIds,
      });
    } catch (error) {
      this.logError(ctx, "Failed to schedule post", { error });
      return this.sendError(ctx, 500, "Failed to schedule post");
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
 * - GET    /posts              — List posts (project-scoped or global)
 * - POST   /posts              — Create post (CreatePostUseCase)
 * - GET    /posts/:id          — Get post with thread (GetPostWithThreadQuery)
 * - PATCH  /posts/:id          — Update post content (UpdatePostUseCase)
 * - POST   /posts/:id/schedule — Schedule post (SchedulePostUseCase)
 * - DELETE /posts/:id          — Soft-delete post (DeletePostUseCase)
 */
export const postRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container!;

  const handler = new PostRouteHandler(
    container.resolve<CreatePostUseCase>(TOKENS.CreatePostUseCase),
    container.resolve<GetPostWithThreadQuery>(TOKENS.GetPostWithThreadQuery),
    container.resolve<UpdatePostUseCase>(TOKENS.UpdatePostUseCase),
    container.resolve<ListPostsUseCase>(TOKENS.ListPostsUseCase),
    container.resolve<ListPostsGlobalQuery>(TOKENS.ListPostsGlobalQuery),
    container.resolve<DeletePostUseCase>(TOKENS.DeletePostUseCase),
    container.resolve<SchedulePostUseCase>(TOKENS.SchedulePostUseCase),
    container.resolve<ProjectRepository>(TOKENS.ProjectRepository),
    container.resolve<IncrementUsageUseCase>(TOKENS.IncrementUsageUseCase)
  );

  // List posts
  fastify.get(
    "/posts",
    { preHandler: [requireClientAuth], schema: { tags: ["Posts"], summary: "List posts" } },
    async (request, reply) => handler.listPosts(request, reply)
  );

  // Create post
  fastify.post(
    "/posts",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Posts"], summary: "Create a new post" },
    },
    async (request, reply) => handler.createPost(request, reply)
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

  // Schedule post
  fastify.post(
    "/posts/:id/schedule",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Posts"], summary: "Schedule post for publishing" },
    },
    async (request, reply) => handler.schedulePost(request, reply)
  );

  // Delete post
  fastify.delete(
    "/posts/:id",
    { preHandler: [requireClientAuth], schema: { tags: ["Posts"], summary: "Delete post" } },
    async (request, reply) => handler.deletePost(request, reply)
  );
};
