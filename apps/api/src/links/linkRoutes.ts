/**
 * Link Tracking Routes
 *
 * Part of Sprint 19: Link Tracking Feature
 * Provides API endpoints for tracked link management.
 *
 * Use cases are resolved from the DI container at plugin registration time.
 */

import { type FastifyPluginAsync, type FastifyRequest, type FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext, IdSchema } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import type { CreateTrackedLinkUseCase } from "../application/links/CreateTrackedLinkUseCase.js";
import type { GetTrackedLinkUseCase } from "../application/links/GetTrackedLinkUseCase.js";
import type { RedirectAndTrackClickUseCase } from "../application/links/RedirectAndTrackClickUseCase.js";
import type { GetLinkStatsUseCase } from "../application/links/GetLinkStatsUseCase.js";
import type { DeleteTrackedLinkUseCase } from "../application/links/DeleteTrackedLinkUseCase.js";

// Zod Schemas
const CreateLinkBodySchema = z.object({
  projectId: IdSchema,
  originalUrl: z.string().url(),
  vanitySlug: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9-_]+$/)
    .optional(),
});

const LinkParamsSchema = z.object({
  id: IdSchema,
});

const ShortCodeParamsSchema = z.object({
  shortCode: z.string().min(3).max(50),
});

/**
 * Link Route Handler
 *
 * Delegates all operations to application-layer use cases resolved from
 * the DI container. No direct repository or Prisma access.
 */
class LinkRouteHandler extends BaseRouteHandler {
  protected routeName = "links";

  constructor(
    private readonly createTrackedLinkUseCase: CreateTrackedLinkUseCase,
    private readonly getTrackedLinkUseCase: GetTrackedLinkUseCase,
    private readonly getLinkStatsUseCase: GetLinkStatsUseCase,
    private readonly deleteTrackedLinkUseCase: DeleteTrackedLinkUseCase,
    private readonly redirectAndTrackClickUseCase: RedirectAndTrackClickUseCase
  ) {
    super();
  }

  /**
   * Create tracked link
   * POST /links
   */
  async createLink(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Creating tracked link");

    const validated = await this.validateRequest<{ body: z.infer<typeof CreateLinkBodySchema> }>(
      ctx,
      { body: CreateLinkBodySchema }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = validated.value.body;
    const result = await this.createTrackedLinkUseCase.execute({
      projectId: body.projectId,
      originalUrl: body.originalUrl,
      ...(body.vanitySlug && { vanitySlug: body.vanitySlug }),
    });

    if (!result.ok) {
      const statusCode =
        result.error.code === "NOT_FOUND" ? 404 : result.error.code === "CONFLICT" ? 409 : 400;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    return this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * Get tracked link by ID
   * GET /links/:id
   */
  async getLink(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{ params: z.infer<typeof LinkParamsSchema> }>(
      ctx,
      { params: LinkParamsSchema }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid link ID");
    }

    const result = await this.getTrackedLinkUseCase.execute({ linkId: validated.value.params.id });

    if (!result.ok) {
      return this.sendError(ctx, 404, result.error.message);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * Get link statistics
   * GET /links/:id/stats
   */
  async getLinkStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{ params: z.infer<typeof LinkParamsSchema> }>(
      ctx,
      { params: LinkParamsSchema }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid link ID");
    }

    const result = await this.getLinkStatsUseCase.execute({ linkId: validated.value.params.id });

    if (!result.ok) {
      return this.sendError(ctx, 404, result.error.message);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * Delete tracked link
   * DELETE /links/:id
   */
  async deleteLink(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{ params: z.infer<typeof LinkParamsSchema> }>(
      ctx,
      { params: LinkParamsSchema }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid link ID");
    }

    const result = await this.deleteTrackedLinkUseCase.execute({
      linkId: validated.value.params.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, 404, result.error.message);
    }

    return this.sendSuccess(ctx, { deleted: true }, 200);
  }

  /**
   * Redirect and track click
   * GET /r/:shortCode (public endpoint)
   */
  async redirect(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{ params: z.infer<typeof ShortCodeParamsSchema> }>(
      ctx,
      { params: ShortCodeParamsSchema }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid short code");
    }

    // Normalize headers (can be string | string[] | undefined)
    const referer = Array.isArray(request.headers.referer)
      ? request.headers.referer[0]
      : request.headers.referer;
    const userAgent = Array.isArray(request.headers["user-agent"])
      ? request.headers["user-agent"][0]
      : request.headers["user-agent"];

    const result = await this.redirectAndTrackClickUseCase.execute({
      shortCode: validated.value.params.shortCode,
      ...(referer && { referrer: referer }),
      ...(userAgent && { userAgent: userAgent }),
      ...(request.ip && { ipAddress: request.ip }),
      // Geo data would be added by middleware in production
    });

    if (!result.ok) {
      const statusCode =
        result.error.code === "NOT_FOUND" ? 404 : result.error.code === "FORBIDDEN" ? 410 : 400;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    // Redirect to original URL (Fastify 5: code first via .code())
    return reply.code(302).redirect(result.value.originalUrl);
  }
}

/**
 * Link tracking routes plugin
 *
 * Resolves use cases from the DI container at plugin registration time.
 */
export const linkRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }

  const handler = new LinkRouteHandler(
    container.resolve<CreateTrackedLinkUseCase>(TOKENS.CreateTrackedLinkUseCase),
    container.resolve<GetTrackedLinkUseCase>(TOKENS.GetTrackedLinkUseCase),
    container.resolve<GetLinkStatsUseCase>(TOKENS.GetLinkStatsUseCase),
    container.resolve<DeleteTrackedLinkUseCase>(TOKENS.DeleteTrackedLinkUseCase),
    container.resolve<RedirectAndTrackClickUseCase>(TOKENS.RedirectAndTrackClickUseCase)
  );

  // Protected endpoints (require auth)
  fastify.post("/links", handler.createLink.bind(handler));
  fastify.get("/links/:id", handler.getLink.bind(handler));
  fastify.get("/links/:id/stats", handler.getLinkStats.bind(handler));
  fastify.delete("/links/:id", handler.deleteLink.bind(handler));

  // Public redirect endpoint
  fastify.get("/r/:shortCode", handler.redirect.bind(handler));
};
