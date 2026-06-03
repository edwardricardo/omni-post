/**
 * @file campaignRoutes.ts
 * @description Fastify plugin registering Campaign management endpoints.
 *   Resolves use cases and queries from DI and delegates to CampaignRouteHandler
 *   methods. Supports CRUD operations, post tagging/untagging, archival,
 *   and aggregated campaign analytics.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";

// Use case / query types (type-only imports)
import type { CreateCampaignUseCase } from "@core/campaigns/CreateCampaignUseCase.js";
import type { UpdateCampaignUseCase } from "@core/campaigns/UpdateCampaignUseCase.js";
import type { ArchiveCampaignUseCase } from "@core/campaigns/ArchiveCampaignUseCase.js";
import type { TagPostWithCampaignUseCase } from "@core/campaigns/TagPostWithCampaignUseCase.js";
import type { UntagPostFromCampaignUseCase } from "@core/campaigns/UntagPostFromCampaignUseCase.js";
import type { GetCampaignAnalyticsUseCase } from "@core/campaigns/GetCampaignAnalyticsUseCase.js";
import type { ListCampaignsQuery } from "@core/campaigns/ListCampaignsQuery.js";
import type { GetCampaignQuery } from "@core/campaigns/GetCampaignQuery.js";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const UuidParamsSchema = z.object({
  id: z.string().uuid(),
});

const CampaignPostParamsSchema = z.object({
  id: z.string().uuid(),
  postId: z.string().uuid(),
});

const CreateCampaignBodySchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1, { message: "Campaign name must not be empty" }).max(200),
  description: z.string().max(2000).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
});

const UpdateCampaignBodySchema = z.object({
  name: z.string().min(1, { message: "Campaign name must not be empty" }).max(200).optional(),
  description: z.string().max(2000).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
});

const ListCampaignsQuerySchema = z.object({
  projectId: z.string().uuid(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ============================================================================
// Route Handler Implementation
// ============================================================================

/**
 * @class CampaignRouteHandler
 * @description Handles all Campaign HTTP endpoints, delegating business
 *   logic to the respective use cases and queries resolved from DI.
 */
class CampaignRouteHandler extends BaseRouteHandler {
  protected routeName = "campaigns";

  constructor(
    private readonly createCampaignUseCase: CreateCampaignUseCase,
    private readonly updateCampaignUseCase: UpdateCampaignUseCase,
    private readonly archiveCampaignUseCase: ArchiveCampaignUseCase,
    private readonly tagPostWithCampaignUseCase: TagPostWithCampaignUseCase,
    private readonly untagPostFromCampaignUseCase: UntagPostFromCampaignUseCase,
    private readonly getCampaignAnalyticsUseCase: GetCampaignAnalyticsUseCase,
    private readonly listCampaignsQuery: ListCampaignsQuery,
    private readonly getCampaignQuery: GetCampaignQuery
  ) {
    super();
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * @method mapErrorCode
   * @description Maps UseCaseError.code to an HTTP status code.
   * @param code - The UseCaseError code string
   * @returns The corresponding HTTP status code
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

  // --------------------------------------------------------------------------
  // Command endpoints
  // --------------------------------------------------------------------------

  /**
   * @method createCampaign
   * @description POST /api/campaigns -- Creates a new campaign for a project.
   */
  async createCampaign(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const bodyValidation = await this.validateBody(ctx, CreateCampaignBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const body = bodyValidation.value;

    const result = await this.createCampaignUseCase.execute({
      projectId: body.projectId,
      name: body.name,
      ...(body.description !== undefined && { description: body.description }),
      ...(body.startDate !== undefined && { startDate: new Date(body.startDate) }),
      ...(body.endDate !== undefined && { endDate: new Date(body.endDate) }),
      ...(body.utmSource !== undefined && { utmSource: body.utmSource }),
      ...(body.utmMedium !== undefined && { utmMedium: body.utmMedium }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method updateCampaign
   * @description PATCH /api/campaigns/:id -- Updates an existing campaign's details.
   */
  async updateCampaign(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid campaign ID format");
    }

    const bodyValidation = await this.validateBody(ctx, UpdateCampaignBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const body = bodyValidation.value;

    const result = await this.updateCampaignUseCase.execute({
      campaignId: paramsValidation.value.id,
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.startDate !== undefined && { startDate: new Date(body.startDate) }),
      ...(body.endDate !== undefined && { endDate: new Date(body.endDate) }),
      ...(body.utmSource !== undefined && { utmSource: body.utmSource }),
      ...(body.utmMedium !== undefined && { utmMedium: body.utmMedium }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, { campaignId: paramsValidation.value.id, status: "updated" });
  }

  /**
   * @method archiveCampaign
   * @description POST /api/campaigns/:id/archive -- Archives a campaign.
   */
  async archiveCampaign(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid campaign ID format");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.archiveCampaignUseCase.execute({
      campaignId: paramsValidation.value.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, { campaignId: paramsValidation.value.id, status: "archived" });
  }

  /**
   * @method tagPost
   * @description POST /api/campaigns/:id/posts/:postId -- Tags a post with a campaign.
   */
  async tagPost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, CampaignPostParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid campaign ID or post ID format");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.tagPostWithCampaignUseCase.execute({
      campaignId: paramsValidation.value.id,
      postId: paramsValidation.value.postId,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, {
      campaignId: paramsValidation.value.id,
      postId: paramsValidation.value.postId,
      status: "tagged",
    });
  }

  /**
   * @method untagPost
   * @description DELETE /api/campaigns/:id/posts/:postId -- Removes a post from a campaign.
   */
  async untagPost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, CampaignPostParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid campaign ID or post ID format");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.untagPostFromCampaignUseCase.execute({
      campaignId: paramsValidation.value.id,
      postId: paramsValidation.value.postId,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, {
      campaignId: paramsValidation.value.id,
      postId: paramsValidation.value.postId,
      status: "untagged",
    });
  }

  // --------------------------------------------------------------------------
  // Query endpoints
  // --------------------------------------------------------------------------

  /**
   * @method listCampaigns
   * @description GET /api/campaigns -- Lists campaigns for a project with optional filters.
   */
  async listCampaigns(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const queryValidation = await this.validateQuery(ctx, ListCampaignsQuerySchema);
    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const q = queryValidation.value;

    const result = await this.listCampaignsQuery.execute({
      projectId: q.projectId,
      ...(q.status !== undefined && { status: q.status }),
      ...(q.limit !== undefined && { limit: q.limit }),
      ...(q.offset !== undefined && { offset: q.offset }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method getCampaign
   * @description GET /api/campaigns/:id -- Fetches a single campaign with stats.
   */
  async getCampaign(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid campaign ID format");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.getCampaignQuery.execute({
      campaignId: paramsValidation.value.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    if (!result.value) {
      return this.sendError(ctx, 404, "Campaign not found");
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method getCampaignAnalytics
   * @description GET /api/campaigns/:id/analytics -- Returns aggregated analytics
   *   for all posts tagged with the specified campaign.
   */
  async getCampaignAnalytics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid campaign ID format");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.getCampaignAnalyticsUseCase.execute({
      campaignId: paramsValidation.value.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }
}

// ============================================================================
// Fastify Plugin Export
// ============================================================================

/**
 * Fastify plugin that registers Campaign routes under /api/campaigns.
 */
const campaignRoutes: FastifyPluginAsync = async (app) => {
  // Resolve use cases and queries from DI container
  const createCampaignUseCase = app.container.resolve<CreateCampaignUseCase>(
    TOKENS.CreateCampaignUseCase
  );
  const updateCampaignUseCase = app.container.resolve<UpdateCampaignUseCase>(
    TOKENS.UpdateCampaignUseCase
  );
  const archiveCampaignUseCase = app.container.resolve<ArchiveCampaignUseCase>(
    TOKENS.ArchiveCampaignUseCase
  );
  const tagPostWithCampaignUseCase = app.container.resolve<TagPostWithCampaignUseCase>(
    TOKENS.TagPostWithCampaignUseCase
  );
  const untagPostFromCampaignUseCase = app.container.resolve<UntagPostFromCampaignUseCase>(
    TOKENS.UntagPostFromCampaignUseCase
  );
  const getCampaignAnalyticsUseCase = app.container.resolve<GetCampaignAnalyticsUseCase>(
    TOKENS.GetCampaignAnalyticsUseCase
  );
  const listCampaignsQuery = app.container.resolve<ListCampaignsQuery>(TOKENS.ListCampaignsQuery);
  const getCampaignQuery = app.container.resolve<GetCampaignQuery>(TOKENS.GetCampaignQuery);

  const handler = new CampaignRouteHandler(
    createCampaignUseCase,
    updateCampaignUseCase,
    archiveCampaignUseCase,
    tagPostWithCampaignUseCase,
    untagPostFromCampaignUseCase,
    getCampaignAnalyticsUseCase,
    listCampaignsQuery,
    getCampaignQuery
  );

  // -- Command routes --

  app.post(
    "/campaigns",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Campaigns"], summary: "Create campaign" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.createCampaign(request, reply)
  );

  app.patch(
    "/campaigns/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Campaigns"], summary: "Update campaign" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.updateCampaign(request, reply)
  );

  app.post(
    "/campaigns/:id/archive",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Campaigns"], summary: "Archive campaign" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.archiveCampaign(request, reply)
  );

  app.post(
    "/campaigns/:id/posts/:postId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Campaigns"], summary: "Tag post with campaign" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.tagPost(request, reply)
  );

  app.delete(
    "/campaigns/:id/posts/:postId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Campaigns"], summary: "Remove post from campaign" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.untagPost(request, reply)
  );

  // -- Query routes --

  app.get(
    "/campaigns",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Campaigns"], summary: "List campaigns" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listCampaigns(request, reply)
  );

  app.get(
    "/campaigns/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Campaigns"], summary: "Get campaign by ID" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getCampaign(request, reply)
  );

  app.get(
    "/campaigns/:id/analytics",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Campaigns"], summary: "Get campaign analytics" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getCampaignAnalytics(request, reply)
  );
};

export { campaignRoutes };
