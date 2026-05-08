/**
 * @file pricingRoutes.ts
 * @description Admin CRUD endpoints for managing pricing tiers, account tiers,
 *              and provider bundles. Protected by admin authentication.
 * @layer infrastructure (routes)
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { prisma } from "@infra/prisma";

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

  async getTiers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const providerTiers = await prisma.providerPricingTier.findMany({
        orderBy: { minProviders: "asc" },
      });
      const accountTiers = await prisma.accountPricingTier.findMany({
        orderBy: { minAccounts: "asc" },
      });
      const bundles = await prisma.providerBundle.findMany({
        orderBy: { sortOrder: "asc" },
      });

      return this.sendSuccess(ctx, { providerTiers, accountTiers, bundles });
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
    if (!paramsResult.success) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const bodyResult = UpdateProviderTierSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsResult.data;

    const b = bodyResult.data;
    try {
      const updated = await prisma.providerPricingTier.update({
        where: { id },
        data: {
          ...(b.minProviders !== undefined && { minProviders: b.minProviders }),
          ...(b.maxProviders !== undefined && { maxProviders: b.maxProviders }),
          ...(b.pricePerProviderMonth !== undefined && {
            pricePerProviderMonth: b.pricePerProviderMonth,
          }),
        },
      });
      return this.sendSuccess(ctx, { tier: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Record to update not found")) {
        return this.sendError(ctx, 404, "Provider pricing tier not found");
      }
      this.logError(ctx, "Failed to update provider tier", { error: msg });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  async updateAccountTier(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const bodyResult = UpdateAccountTierSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsResult.data;
    const ab = bodyResult.data;

    try {
      const updated = await prisma.accountPricingTier.update({
        where: { id },
        data: {
          ...(ab.minAccounts !== undefined && { minAccounts: ab.minAccounts }),
          ...(ab.maxAccounts !== undefined && { maxAccounts: ab.maxAccounts }),
          ...(ab.multiplier !== undefined && { multiplier: ab.multiplier }),
        },
      });
      return this.sendSuccess(ctx, { tier: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Record to update not found")) {
        return this.sendError(ctx, 404, "Account pricing tier not found");
      }
      this.logError(ctx, "Failed to update account tier", { error: msg });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  async updateBundle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const bodyResult = UpdateBundleSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsResult.data;
    const bb = bodyResult.data;

    try {
      const updated = await prisma.providerBundle.update({
        where: { id },
        data: {
          ...(bb.name !== undefined && { name: bb.name }),
          ...(bb.description !== undefined && { description: bb.description }),
          ...(bb.pricePerAccountMonth !== undefined && {
            pricePerAccountMonth: bb.pricePerAccountMonth,
          }),
          ...(bb.providers !== undefined && {
            providers: { set: bb.providers as import("@infra/prisma").Provider[] },
          }),
        },
      });
      return this.sendSuccess(ctx, { bundle: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Record to update not found")) {
        return this.sendError(ctx, 404, "Provider bundle not found");
      }
      this.logError(ctx, "Failed to update bundle", { error: msg });
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
    if (!bodyResult.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { slug, name, description, providers, pricePerAccountMonth, isActive, sortOrder } =
      bodyResult.data;

    try {
      const existing = await prisma.providerBundle.findUnique({ where: { slug } });
      if (existing) {
        return this.sendError(ctx, 409, "Bundle slug already exists");
      }

      const created = await prisma.providerBundle.create({
        data: {
          name,
          slug,
          description,
          providers: { set: providers as import("@infra/prisma").Provider[] },
          pricePerAccountMonth,
          isActive,
          sortOrder,
        },
      });

      return this.sendSuccess(ctx, { bundle: created });
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
    if (!paramsResult.success) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const { id } = paramsResult.data;

    try {
      const count = await prisma.accountSubscription.count({ where: { bundleId: id } });
      if (count > 0) {
        return this.sendError(ctx, 400, "Cannot delete bundle with active subscriptions");
      }

      await prisma.providerBundle.delete({ where: { id } });
      return this.sendSuccess(ctx, { message: "Bundle deleted" });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Record to delete does not exist")) {
        return this.sendError(ctx, 404, "Provider bundle not found");
      }
      this.logError(ctx, "Failed to delete bundle", { error: msg });
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
    if (!bodyResult.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { minProviders, maxProviders, pricePerProviderMonth } = bodyResult.data;

    try {
      const created = await prisma.providerPricingTier.create({
        data: {
          minProviders,
          ...(maxProviders !== undefined && { maxProviders }),
          pricePerProviderMonth,
        },
      });
      return this.sendSuccess(ctx, { tier: created }, 201);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Unique constraint")) {
        return this.sendError(ctx, 409, "A provider tier with this minProviders already exists");
      }
      this.logError(ctx, "Failed to create provider tier", { error: msg });
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
    if (!bodyResult.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { minAccounts, maxAccounts, multiplier } = bodyResult.data;

    try {
      const created = await prisma.accountPricingTier.create({
        data: {
          minAccounts,
          ...(maxAccounts !== undefined && { maxAccounts }),
          multiplier,
        },
      });
      return this.sendSuccess(ctx, { tier: created }, 201);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Unique constraint")) {
        return this.sendError(ctx, 409, "An account tier with this minAccounts already exists");
      }
      this.logError(ctx, "Failed to create account tier", { error: msg });
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
    if (!paramsResult.success) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const bodyResult = ToggleStatusSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsResult.data;
    const { isActive } = bodyResult.data;

    try {
      const updated = await prisma.providerPricingTier.update({
        where: { id },
        data: { isActive },
      });
      return this.sendSuccess(ctx, { tier: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Record to update not found")) {
        return this.sendError(ctx, 404, "Provider pricing tier not found");
      }
      this.logError(ctx, "Failed to toggle provider tier status", { error: msg });
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
    if (!paramsResult.success) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const bodyResult = ToggleStatusSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsResult.data;
    const { isActive } = bodyResult.data;

    try {
      const updated = await prisma.accountPricingTier.update({
        where: { id },
        data: { isActive },
      });
      return this.sendSuccess(ctx, { tier: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Record to update not found")) {
        return this.sendError(ctx, 404, "Account pricing tier not found");
      }
      this.logError(ctx, "Failed to toggle account tier status", { error: msg });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }
}

// --- Plugin ---

const pricingRoutes: FastifyPluginAsync = async (fastify) => {
  const handler = new PricingHandler();

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
