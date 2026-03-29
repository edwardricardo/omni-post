/**
 * @file brandVoiceRoutes.ts
 * @description REST API routes for Brand Voice Profiles.
 *
 *   GET    /api/ai/brand-voice?accountId=X  → GetBrandVoiceQuery
 *   POST   /api/ai/brand-voice              → UpsertBrandVoiceUseCase (create)
 *   PUT    /api/ai/brand-voice/:id          → UpsertBrandVoiceUseCase (update)
 *   DELETE /api/ai/brand-voice/:accountId   → DeleteBrandVoiceUseCase
 *
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import { authenticateMiddleware } from "../auth/authMiddleware.js";
import type { GetBrandVoiceQuery } from "../application/brand-voice/GetBrandVoiceQuery.js";
import type { UpsertBrandVoiceUseCase } from "../application/brand-voice/UpsertBrandVoiceUseCase.js";
import type { DeleteBrandVoiceUseCase } from "../application/brand-voice/DeleteBrandVoiceUseCase.js";

// ============================================================================
// Schemas
// ============================================================================

const GetQuerySchema = z.object({
  accountId: z.string().uuid(),
});

const AccountIdParamSchema = z.object({
  accountId: z.string().uuid(),
});

const UpsertBodySchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().min(1).max(100),
  systemPrompt: z.string().min(1).max(2000),
  tone: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

// ============================================================================
// Handler
// ============================================================================

class BrandVoiceRouteHandler extends BaseRouteHandler {
  protected routeName = "brand-voice";

  constructor(
    private readonly getQuery: GetBrandVoiceQuery,
    private readonly upsertUseCase: UpsertBrandVoiceUseCase,
    private readonly deleteUseCase: DeleteBrandVoiceUseCase
  ) {
    super();
  }

  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const queryValidation = await this.validateQuery(ctx, GetQuerySchema);
    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "accountId query param is required and must be a UUID");
    }

    const result = await this.getQuery.execute({ accountId: queryValidation.value.accountId });
    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async upsert(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const bodyValidation = await this.validateBody(ctx, UpsertBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { accountId, name, systemPrompt, tone, examples, isActive } = bodyValidation.value;
    const result = await this.upsertUseCase.execute({
      accountId,
      name,
      systemPrompt,
      ...(tone !== undefined && { tone }),
      ...(examples !== undefined && { examples }),
      ...(isActive !== undefined && { isActive }),
    });
    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async delete(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, AccountIdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid accountId format");
    }

    const result = await this.deleteUseCase.execute({
      accountId: paramsValidation.value.accountId,
    });
    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, { deleted: true });
  }
}

// ============================================================================
// Plugin
// ============================================================================

export const brandVoiceRoutes: FastifyPluginAsync = async (app) => {
  const handler = new BrandVoiceRouteHandler(
    app.container.resolve<GetBrandVoiceQuery>(TOKENS.GetBrandVoiceQuery),
    app.container.resolve<UpsertBrandVoiceUseCase>(TOKENS.UpsertBrandVoiceUseCase),
    app.container.resolve<DeleteBrandVoiceUseCase>(TOKENS.DeleteBrandVoiceUseCase)
  );

  app.get(
    "/api/ai/brand-voice",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Brand Voice"], summary: "Get brand voice profiles" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.get(request, reply)
  );

  app.post(
    "/api/ai/brand-voice",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Brand Voice"], summary: "Create brand voice profile" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.upsert(request, reply)
  );

  app.put(
    "/api/ai/brand-voice/:accountId",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Brand Voice"], summary: "Update brand voice profile" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.upsert(request, reply)
  );

  app.delete(
    "/api/ai/brand-voice/:accountId",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Brand Voice"], summary: "Delete brand voice profile" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.delete(request, reply)
  );
};
