/**
 * @file aiImageRoutes.ts
 * @description Fastify plugin registering AI image generation endpoints.
 *   Resolves use cases from DI and delegates to handler methods.
 *   Supports generating images from prompts and listing generated images.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { GenerateImageUseCase } from "../application/ai-image/GenerateImageUseCase.js";
import type { ListGeneratedImagesQuery } from "../application/ai-image/ListGeneratedImagesQuery.js";
import type { IncrementUsageUseCase } from "../application/usage/IncrementUsageUseCase.js";

// --- Zod Schemas ---

const GenerateImageBodySchema = z.object({
  projectId: z.string().uuid(),
  /** Optional — when provided, aiCallsMade usage counter is incremented */
  accountId: z.string().uuid().optional(),
  prompt: z.string().min(1).max(4000),
  size: z.enum(["1024x1024", "1024x1792", "1792x1024"]).optional(),
  quality: z.enum(["standard", "hd"]).optional(),
  style: z.enum(["natural", "vivid"]).optional(),
});

const ListGeneratedImagesQuerySchema = z.object({
  projectId: z.string().uuid(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .pipe(z.number().int().min(1).max(100).optional()),
});

/**
 * @class AIImageRouteHandler
 * @description Route handler for AI image generation endpoints.
 *   All operations delegate to application-layer use cases resolved from DI.
 */
class AIImageRouteHandler extends BaseRouteHandler {
  protected routeName = "ai-image";

  constructor(
    private readonly generateUseCase: GenerateImageUseCase,
    private readonly listQuery: ListGeneratedImagesQuery,
    private readonly incrementUsageUseCase: IncrementUsageUseCase
  ) {
    super();
  }

  /**
   * @method generateImage
   * @description POST /api/ai/generate-image -- Generate an AI image from a prompt
   */
  async generateImage(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof GenerateImageBodySchema>;
    }>(ctx, { body: GenerateImageBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const body = bodyValidation.value.body;
    const result = await this.generateUseCase.execute({
      projectId: body.projectId,
      prompt: body.prompt,
      ...(body.size && { size: body.size }),
      ...(body.quality && { quality: body.quality }),
      ...(body.style && { style: body.style }),
    });

    if (!result.ok) {
      const statusCode = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    // Increment AI calls usage counter — best-effort, does not fail the request
    if (body.accountId) {
      void this.incrementUsageUseCase
        .execute({ accountId: body.accountId, field: "aiCallsMade" })
        .catch(() => void 0);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method listGeneratedImages
   * @description GET /api/ai/generated-images?projectId=...&limit=... -- List generated images
   */
  async listGeneratedImages(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const queryValidation = await this.validateRequest<{
      query: z.infer<typeof ListGeneratedImagesQuerySchema>;
    }>(ctx, { query: ListGeneratedImagesQuerySchema });

    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "projectId query parameter is required");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.listQuery.execute({
      projectId: queryValidation.value.query.projectId,
      ...(queryValidation.value.query.limit !== undefined && {
        limit: queryValidation.value.query.limit,
      }),
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }
}

/**
 * Fastify plugin that registers AI image generation routes
 */
export const aiImageRoutes: FastifyPluginAsync = async (app) => {
  const generateUseCase = app.container.resolve<GenerateImageUseCase>(TOKENS.GenerateImageUseCase);
  const listQuery = app.container.resolve<ListGeneratedImagesQuery>(
    TOKENS.ListGeneratedImagesQuery_AIImage
  );

  const incrementUsageUseCase = app.container.resolve<IncrementUsageUseCase>(
    TOKENS.IncrementUsageUseCase
  );
  const handler = new AIImageRouteHandler(generateUseCase, listQuery, incrementUsageUseCase);

  // Generate an AI image from a prompt
  app.post(
    "/ai/generate-image",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["AI Images"], summary: "Generate AI image from prompt" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.generateImage(request, reply)
  );

  // List generated images for a project
  app.get(
    "/ai/generated-images",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["AI Images"], summary: "List generated images" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listGeneratedImages(request, reply)
  );
};
