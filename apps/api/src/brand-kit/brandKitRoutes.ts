/**
 * @file brandKitRoutes.ts
 * @description REST API routes for Brand Kit management.
 *
 *   GET    /api/brand-kit/:accountId  -> GetBrandKitQuery
 *   PUT    /api/brand-kit/:accountId  -> UpsertBrandKitUseCase
 *   DELETE /api/brand-kit/:accountId  -> DeleteBrandKitUseCase
 *
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import type { GetBrandKitQuery } from "../application/brand-kit/GetBrandKitQuery.js";
import type { UpsertBrandKitUseCase } from "../application/brand-kit/UpsertBrandKitUseCase.js";
import type { DeleteBrandKitUseCase } from "../application/brand-kit/DeleteBrandKitUseCase.js";

// ============================================================================
// Schemas
// ============================================================================

const AccountIdParamSchema = z.object({
  accountId: z.string().uuid(),
});

const UpsertBodySchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be #RRGGBB format")
    .nullish(),
  secondaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be #RRGGBB format")
    .nullish(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be #RRGGBB format")
    .nullish(),
  logoUrl: z.string().url().nullish(),
  logoStorageKey: z.string().max(500).nullish(),
  fontPrimary: z.string().max(100).nullish(),
  fontSecondary: z.string().max(100).nullish(),
});

// ============================================================================
// Handler
// ============================================================================

class BrandKitRouteHandler extends BaseRouteHandler {
  protected routeName = "brand-kit";

  constructor(
    private readonly getQuery: GetBrandKitQuery,
    private readonly upsertUseCase: UpsertBrandKitUseCase,
    private readonly deleteUseCase: DeleteBrandKitUseCase
  ) {
    super();
  }

  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, AccountIdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid accountId format");
    }

    const result = await this.getQuery.execute({
      accountId: paramsValidation.value.accountId,
    });
    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async upsert(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, AccountIdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid accountId format");
    }

    const bodyValidation = await this.validateBody(ctx, UpsertBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.upsertUseCase.execute({
      accountId: paramsValidation.value.accountId,
      ...(body.primaryColor !== undefined && { primaryColor: body.primaryColor }),
      ...(body.secondaryColor !== undefined && { secondaryColor: body.secondaryColor }),
      ...(body.accentColor !== undefined && { accentColor: body.accentColor }),
      ...(body.logoUrl !== undefined && { logoUrl: body.logoUrl }),
      ...(body.logoStorageKey !== undefined && { logoStorageKey: body.logoStorageKey }),
      ...(body.fontPrimary !== undefined && { fontPrimary: body.fontPrimary }),
      ...(body.fontSecondary !== undefined && { fontSecondary: body.fontSecondary }),
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

export const brandKitRoutes: FastifyPluginAsync = async (app) => {
  const handler = new BrandKitRouteHandler(
    app.container.resolve<GetBrandKitQuery>(TOKENS.GetBrandKitQuery),
    app.container.resolve<UpsertBrandKitUseCase>(TOKENS.UpsertBrandKitUseCase),
    app.container.resolve<DeleteBrandKitUseCase>(TOKENS.DeleteBrandKitUseCase)
  );

  app.get(
    "/brand-kit/:accountId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Brand Kit"], summary: "Get brand kit for account" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.get(request, reply)
  );

  app.put(
    "/brand-kit/:accountId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Brand Kit"], summary: "Upsert brand kit for account" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.upsert(request, reply)
  );

  app.delete(
    "/brand-kit/:accountId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Brand Kit"], summary: "Delete brand kit for account" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.delete(request, reply)
  );
};
