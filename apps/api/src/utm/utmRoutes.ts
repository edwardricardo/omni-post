/**
 * @file utmRoutes.ts
 * @description Fastify plugin registering UTM link management endpoints.
 *   Resolves use cases from DI and delegates to UTMRouteHandler methods.
 *   Supports generating UTM-tagged URLs and retrieving them.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { authenticateMiddleware } from "../auth/authMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";

import type { GenerateUTMLinksUseCase } from "../application/utm/GenerateUTMLinksUseCase.js";
import type { GetTrackedLinkUseCase } from "../application/links/GetTrackedLinkUseCase.js";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const LinkIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const GenerateUTMBodySchema = z.object({
  source: z.string().min(1, { message: "source is required" }).max(200),
  medium: z.string().min(1, { message: "medium is required" }).max(200),
  campaign: z.string().min(1, { message: "campaign is required" }).max(200),
  content: z.string().max(200).optional(),
  term: z.string().max(200).optional(),
});

// ============================================================================
// Route Handler Implementation
// ============================================================================

/**
 * @class UTMRouteHandler
 * @description Handles UTM HTTP endpoints, delegating business logic
 *   to the respective use cases resolved from DI.
 */
class UTMRouteHandler extends BaseRouteHandler {
  protected routeName = "utm";

  constructor(
    private readonly generateUTMLinksUseCase: GenerateUTMLinksUseCase,
    private readonly getTrackedLinkUseCase: GetTrackedLinkUseCase
  ) {
    super();
  }

  /**
   * @method mapErrorCode
   * @description Maps UseCaseError.code to an HTTP status code.
   */
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
   * @method generateUTM
   * @description POST /api/links/:id/utm -- Generates UTM parameters for a tracked link.
   */
  async generateUTM(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, LinkIdParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid link ID format");
    }

    const bodyValidation = await this.validateBody(ctx, GenerateUTMBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const body = bodyValidation.value;

    const result = await this.generateUTMLinksUseCase.execute({
      trackedLinkId: paramsValidation.value.id,
      source: body.source,
      medium: body.medium,
      campaign: body.campaign,
      ...(body.content !== undefined && { content: body.content }),
      ...(body.term !== undefined && { term: body.term }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method getUTMUrl
   * @description GET /api/links/:id/utm-url -- Returns the UTM URL for a tracked link.
   */
  async getUTMUrl(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, LinkIdParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid link ID format");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.getTrackedLinkUseCase.execute({
      linkId: paramsValidation.value.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    // Build UTM URL from the link data
    const link = result.value;
    const hasUTM = link.utmSource && link.utmMedium && link.utmCampaign;

    if (!hasUTM) {
      this.sendSuccess(ctx, { utmUrl: link.originalUrl, hasUTM: false });
      return;
    }

    // Reconstruct the UTM URL from link fields
    const url = new URL(link.originalUrl);
    if (link.utmSource) url.searchParams.set("utm_source", link.utmSource);
    if (link.utmMedium) url.searchParams.set("utm_medium", link.utmMedium);
    if (link.utmCampaign) url.searchParams.set("utm_campaign", link.utmCampaign);
    if (link.utmContent) url.searchParams.set("utm_content", link.utmContent);
    if (link.utmTerm) url.searchParams.set("utm_term", link.utmTerm);

    this.sendSuccess(ctx, { utmUrl: url.toString(), hasUTM: true });
  }
}

// ============================================================================
// Fastify Plugin Export
// ============================================================================

/**
 * Fastify plugin that registers UTM routes under /api/links/:id/utm.
 */
const utmRoutes: FastifyPluginAsync = async (app) => {
  const generateUTMLinksUseCase = app.container.resolve<GenerateUTMLinksUseCase>(
    TOKENS.GenerateUTMLinksUseCase
  );
  const getTrackedLinkUseCase = app.container.resolve<GetTrackedLinkUseCase>(
    TOKENS.GetTrackedLinkUseCase
  );

  const handler = new UTMRouteHandler(generateUTMLinksUseCase, getTrackedLinkUseCase);

  app.post(
    "/api/links/:id/utm",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.generateUTM(request, reply)
  );

  app.get(
    "/api/links/:id/utm-url",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.getUTMUrl(request, reply)
  );
};

export { utmRoutes };
