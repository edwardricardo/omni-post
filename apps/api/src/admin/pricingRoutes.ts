/**
 * @file pricingRoutes.ts
 * @description Admin CRUD endpoints for managing pricing tiers, account tiers,
 *              and provider bundles. Protected by admin authentication.
 *              Persistence goes through PricingAdminService (DI), never Prisma.
 * @layer infrastructure
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { PricingAdminService } from "./PricingAdminService.js";

// --- Zod Schemas ---

const IdParamsSchema = z.object({
  id: z.string().min(1),
});

const UpdateProviderTierSchema = z.object({
  minProviders: z.number().int().min(1).optional(),
  maxProviders: z.number().int().min(1).nullable().optional(),
  pricePerProviderMonth: z.number().positive().optional(),
});

const UpdateAccountTierSchema = z.object({
  minAccounts: z.number().int().min(1).optional(),
  maxAccounts: z.number().int().min(1).nullable().optional(),
  multiplier: z.number().positive().optional(),
});

const UpdateBundleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  pricePerAccountMonth: z.number().positive().optional(),
  providers: z.array(z.string()).optional(),
});

const CreateProviderTierSchema = z.object({
  minProviders: z.number().int().min(1),
  maxProviders: z.number().int().min(1).nullable().optional(),
  pricePerProviderMonth: z.number().positive(),
});

const CreateAccountTierSchema = z.object({
  minAccounts: z.number().int().min(1),
  maxAccounts: z.number().int().min(1).nullable().optional(),
  multiplier: z.number().positive(),
});

const ToggleStatusSchema = z.object({
  isActive: z.boolean(),
});

const CreateBundleSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  providers: z.array(z.string()).min(1),
  pricePerAccountMonth: z.number().positive(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

// --- Handler ---

class PricingHandler extends BaseRouteHandler {
  protected routeName = "pricing";

  constructor(private readonly pricing: PricingAdminService) {
    super();
  }

  async getTiers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    try {
      const tiers = await this.pricing.getTiers();
      return this.sendSuccess(ctx, tiers);
    } catch (error: unknown) {
      this.logError(ctx, "Failed to fetch pricing tiers", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  async updateProviderTier(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) return this.sendError(ctx, 400, "Invalid parameters");
    const bodyResult = UpdateProviderTierSchema.safeParse(request.body);
    if (!bodyResult.success) return this.sendError(ctx, 400, "Invalid request body");

    const b = bodyResult.data;
    try {
      const result = await this.pricing.updateProviderTier(paramsResult.data.id, {
        ...(b.minProviders !== undefined && { minProviders: b.minProviders }),
        ...(b.maxProviders !== undefined && { maxProviders: b.maxProviders }),
        ...(b.pricePerProviderMonth !== undefined && {
          pricePerProviderMonth: b.pricePerProviderMonth,
        }),
      });
      if (!result.ok) return this.sendError(ctx, 404, "Provider pricing tier not found");
      return this.sendSuccess(ctx, { tier: result.value });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to update provider tier", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  async updateAccountTier(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) return this.sendError(ctx, 400, "Invalid parameters");
    const bodyResult = UpdateAccountTierSchema.safeParse(request.body);
    if (!bodyResult.success) return this.sendError(ctx, 400, "Invalid request body");

    const ab = bodyResult.data;
    try {
      const result = await this.pricing.updateAccountTier(paramsResult.data.id, {
        ...(ab.minAccounts !== undefined && { minAccounts: ab.minAccounts }),
        ...(ab.maxAccounts !== undefined && { maxAccounts: ab.maxAccounts }),
        ...(ab.multiplier !== undefined && { multiplier: ab.multiplier }),
      });
      if (!result.ok) return this.sendError(ctx, 404, "Account pricing tier not found");
      return this.sendSuccess(ctx, { tier: result.value });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to update account tier", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  async updateBundle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) return this.sendError(ctx, 400, "Invalid parameters");
    const bodyResult = UpdateBundleSchema.safeParse(request.body);
    if (!bodyResult.success) return this.sendError(ctx, 400, "Invalid request body");

    const bb = bodyResult.data;
    try {
      const result = await this.pricing.updateBundle(paramsResult.data.id, {
        ...(bb.name !== undefined && { name: bb.name }),
        ...(bb.description !== undefined && { description: bb.description }),
        ...(bb.pricePerAccountMonth !== undefined && {
          pricePerAccountMonth: bb.pricePerAccountMonth,
        }),
        ...(bb.providers !== undefined && { providers: bb.providers }),
      });
      if (!result.ok) return this.sendError(ctx, 404, "Provider bundle not found");
      return this.sendSuccess(ctx, { bundle: result.value });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to update bundle", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method createBundle
   * @description Creates a new provider bundle with slug uniqueness check.
   * @param request - Fastify request with CreateBundleSchema body
   * @param reply - Fastify reply
   */
  async createBundle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const bodyResult = CreateBundleSchema.safeParse(request.body);
    if (!bodyResult.success) return this.sendError(ctx, 400, "Invalid request body");

    try {
      const result = await this.pricing.createBundle(bodyResult.data);
      if (!result.ok) return this.sendError(ctx, 409, "Bundle slug already exists");
      return this.sendSuccess(ctx, { bundle: result.value });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to create bundle", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method deleteBundle
   * @description Deletes a provider bundle after checking for active subscriptions.
   * @param request - Fastify request with id param
   * @param reply - Fastify reply
   */
  async deleteBundle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) return this.sendError(ctx, 400, "Invalid parameters");

    try {
      const result = await this.pricing.deleteBundle(paramsResult.data.id);
      if (!result.ok) {
        return result.error === "HAS_SUBSCRIPTIONS"
          ? this.sendError(ctx, 400, "Cannot delete bundle with active subscriptions")
          : this.sendError(ctx, 404, "Provider bundle not found");
      }
      return this.sendSuccess(ctx, { message: "Bundle deleted" });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to delete bundle", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method createProviderTier
   * @description Creates a new provider pricing tier.
   * @param request - Fastify request with CreateProviderTierSchema body
   * @param reply - Fastify reply
   */
  async createProviderTier(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const bodyResult = CreateProviderTierSchema.safeParse(request.body);
    if (!bodyResult.success) return this.sendError(ctx, 400, "Invalid request body");

    const d = bodyResult.data;
    try {
      const result = await this.pricing.createProviderTier({
        minProviders: d.minProviders,
        ...(d.maxProviders !== undefined && { maxProviders: d.maxProviders }),
        pricePerProviderMonth: d.pricePerProviderMonth,
      });
      if (!result.ok) {
        return this.sendError(ctx, 409, "A provider tier with this minProviders already exists");
      }
      return this.sendSuccess(ctx, { tier: result.value }, 201);
    } catch (error: unknown) {
      this.logError(ctx, "Failed to create provider tier", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method createAccountTier
   * @description Creates a new account pricing tier.
   * @param request - Fastify request with CreateAccountTierSchema body
   * @param reply - Fastify reply
   */
  async createAccountTier(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const bodyResult = CreateAccountTierSchema.safeParse(request.body);
    if (!bodyResult.success) return this.sendError(ctx, 400, "Invalid request body");

    const d = bodyResult.data;
    try {
      const result = await this.pricing.createAccountTier({
        minAccounts: d.minAccounts,
        ...(d.maxAccounts !== undefined && { maxAccounts: d.maxAccounts }),
        multiplier: d.multiplier,
      });
      if (!result.ok) {
        return this.sendError(ctx, 409, "An account tier with this minAccounts already exists");
      }
      return this.sendSuccess(ctx, { tier: result.value }, 201);
    } catch (error: unknown) {
      this.logError(ctx, "Failed to create account tier", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method toggleProviderTierStatus
   * @description Toggles the isActive field of a provider pricing tier.
   * @param request - Fastify request with id param and ToggleStatusSchema body
   * @param reply - Fastify reply
   */
  async toggleProviderTierStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) return this.sendError(ctx, 400, "Invalid parameters");
    const bodyResult = ToggleStatusSchema.safeParse(request.body);
    if (!bodyResult.success) return this.sendError(ctx, 400, "Invalid request body");

    try {
      const result = await this.pricing.toggleProviderTierStatus(
        paramsResult.data.id,
        bodyResult.data.isActive
      );
      if (!result.ok) return this.sendError(ctx, 404, "Provider pricing tier not found");
      return this.sendSuccess(ctx, { tier: result.value });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to toggle provider tier status", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method toggleAccountTierStatus
   * @description Toggles the isActive field of an account pricing tier.
   * @param request - Fastify request with id param and ToggleStatusSchema body
   * @param reply - Fastify reply
   */
  async toggleAccountTierStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) return this.sendError(ctx, 400, "Invalid parameters");
    const bodyResult = ToggleStatusSchema.safeParse(request.body);
    if (!bodyResult.success) return this.sendError(ctx, 400, "Invalid request body");

    try {
      const result = await this.pricing.toggleAccountTierStatus(
        paramsResult.data.id,
        bodyResult.data.isActive
      );
      if (!result.ok) return this.sendError(ctx, 404, "Account pricing tier not found");
      return this.sendSuccess(ctx, { tier: result.value });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to toggle account tier status", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }
}

// --- Plugin ---

const pricingRoutes: FastifyPluginAsync = async (fastify) => {
  const handler = new PricingHandler(
    fastify.container!.resolve<PricingAdminService>(TOKENS.PricingAdminService)
  );

  fastify.get(
    "/admin/pricing/tiers",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.BILLING_READ)],
      schema: { tags: ["Admin"], summary: "Get all pricing tiers and bundles" },
    },
    async (request, reply) => handler.getTiers(request, reply)
  );

  fastify.put(
    "/admin/pricing/provider-tiers/:id",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.PRICING_MANAGE)],
      schema: { tags: ["Admin"], summary: "Update provider pricing tier" },
    },
    async (request, reply) => handler.updateProviderTier(request, reply)
  );

  fastify.put(
    "/admin/pricing/account-tiers/:id",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.PRICING_MANAGE)],
      schema: { tags: ["Admin"], summary: "Update account pricing tier" },
    },
    async (request, reply) => handler.updateAccountTier(request, reply)
  );

  fastify.put(
    "/admin/pricing/bundles/:id",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.PRICING_MANAGE)],
      schema: { tags: ["Admin"], summary: "Update provider bundle" },
    },
    async (request, reply) => handler.updateBundle(request, reply)
  );

  fastify.post(
    "/admin/pricing/bundles",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.PRICING_MANAGE)],
      schema: { tags: ["Admin Pricing"], summary: "Create provider bundle" },
    },
    async (request, reply) => handler.createBundle(request, reply)
  );

  fastify.delete(
    "/admin/pricing/bundles/:id",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.PRICING_MANAGE)],
      schema: { tags: ["Admin Pricing"], summary: "Delete provider bundle" },
    },
    async (request, reply) => handler.deleteBundle(request, reply)
  );

  fastify.post(
    "/admin/pricing/provider-tiers",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.PRICING_MANAGE)],
      schema: { tags: ["Admin Pricing"], summary: "Create provider pricing tier" },
    },
    async (request, reply) => handler.createProviderTier(request, reply)
  );

  fastify.post(
    "/admin/pricing/account-tiers",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.PRICING_MANAGE)],
      schema: { tags: ["Admin Pricing"], summary: "Create account pricing tier" },
    },
    async (request, reply) => handler.createAccountTier(request, reply)
  );

  fastify.patch(
    "/admin/pricing/provider-tiers/:id/status",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.PRICING_MANAGE)],
      schema: { tags: ["Admin Pricing"], summary: "Toggle provider tier active status" },
    },
    async (request, reply) => handler.toggleProviderTierStatus(request, reply)
  );

  fastify.patch(
    "/admin/pricing/account-tiers/:id/status",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.PRICING_MANAGE)],
      schema: { tags: ["Admin Pricing"], summary: "Toggle account tier active status" },
    },
    async (request, reply) => handler.toggleAccountTierStatus(request, reply)
  );
};

export { pricingRoutes };
