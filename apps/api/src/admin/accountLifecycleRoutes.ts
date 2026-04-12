/**
 * @file accountLifecycleRoutes.ts
 * @description Fastify route definitions for admin account lifecycle operations
 *              (create, update, suspend, delete) using BaseRouteHandler pattern.
 * @layer infrastructure
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext, IdSchema } from "@packages/api-common";
import type {
  AccountLifecycleService,
  CreateAccountRequest,
  UpdateAccountRequest,
  ResetPasswordRequest,
  AccountFilters,
} from "./accountLifecycleService.js";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { removeUndefinedProperties } from "../utils/typeUtils.js";
import { SecureSchemas } from "../security/inputValidation.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { prisma } from "@infra/prisma";
import {
  PricingCalculator,
  type ProviderTier,
  type AccountTier,
  type BundleDef,
} from "../domain/billing/PricingCalculator.js";

// ✅ Zod schemas for validation with security enhancement
const AdminRoleSchema = z.string().min(1);

const CreateAccountSchema = z.object({
  body: z.object({
    email: SecureSchemas.userEmail,
    password: z.string().min(8),
    name: SecureSchemas.userName,
    role: AdminRoleSchema.optional(),
    sendWelcomeEmail: z.boolean().optional(),
  }),
});

const UpdateAccountSchema = z.object({
  params: z.object({ accountId: IdSchema }),
  body: z.object({
    name: SecureSchemas.userName.optional(),
    role: AdminRoleSchema.optional(),
    isActive: z.boolean().optional(),
    emailVerified: z.boolean().optional(),
  }),
});

const ResetPasswordSchema = z.object({
  params: z.object({ accountId: IdSchema }),
  body: z.object({
    newPassword: z.string().min(8),
    requirePasswordChange: z.boolean().optional(),
  }),
});

const SuspendAccountSchema = z.object({
  params: z.object({ accountId: IdSchema }),
  body: z.object({
    reason: SecureSchemas.userName, // Using userName for reason text validation
  }),
});

const UpdateAccountStatusSchema = z.object({
  params: z.object({ accountId: IdSchema }),
  body: z.object({
    isActive: z.boolean().optional(),
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(1).optional(),
  }),
});

const AccountParamsSchema = z.object({
  params: z.object({
    accountId: IdSchema,
  }),
});

const UpdateGrandfatheringSchema = z.object({
  params: z.object({ accountId: IdSchema }),
  body: z.object({ effectiveAt: z.string().datetime() }),
});

const queryBoolean = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.boolean()
);

const AccountFiltersSchema = z.object({
  query: z.object({
    role: AdminRoleSchema.optional(),
    isActive: queryBoolean.optional(),
    emailVerified: queryBoolean.optional(),
    mfaEnabled: queryBoolean.optional(),
    lastLoginAfter: z.string().datetime().optional(),
    lastLoginBefore: z.string().datetime().optional(),
    createdAfter: z.string().datetime().optional(),
    createdBefore: z.string().datetime().optional(),
    search: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(50),
  }),
});

const BulkSuspendSchema = z.object({
  body: z.object({
    accountIds: z.array(IdSchema),
    reason: z.string().min(1),
  }),
});

const BulkReactivateSchema = z.object({
  body: z.object({
    accountIds: z.array(IdSchema),
  }),
});

// ✅ BaseRouteHandler implementation
class AccountLifecycleHandler extends BaseRouteHandler {
  protected routeName = "account-lifecycle";

  constructor(private readonly accountLifecycleService: AccountLifecycleService) {
    super();
  }

  async createAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof CreateAccountSchema>>(ctx, {
      body: CreateAccountSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const createdByUserId = request.auth?.user?.id;
    const result = await this.accountLifecycleService.createAccount(
      removeUndefinedProperties(validated.value.body) as CreateAccountRequest,
      createdByUserId
    );

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        EMAIL_EXISTS: { status: 409, message: "Email already exists" },
        VALIDATION_ERROR: { status: 400, message: "Invalid input data" },
        DATABASE_ERROR: { status: 500, message: "Internal server error" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Internal server error" };
      return this.sendError(ctx, error.status, error.message);
    }

    return this.sendSuccess(ctx, { account: result.value }, 201);
  }

  async getAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof AccountParamsSchema>>(ctx, {
      params: AccountParamsSchema.shape.params,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const result = await this.accountLifecycleService.getAccount(validated.value.params.accountId);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Account not found" },
        DATABASE_ERROR: { status: 500, message: "Internal server error" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Internal server error" };
      return this.sendError(ctx, error.status, error.message);
    }

    return this.sendSuccess(ctx, { account: result.value });
  }

  async updateAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof UpdateAccountSchema>>(ctx, {
      params: UpdateAccountSchema.shape.params,
      body: UpdateAccountSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request data");
    }

    // Role changes require Super Admin
    if (validated.value.body.role && request.auth?.user?.role !== "SUPER_ADMIN") {
      return this.sendError(ctx, 403, "Insufficient permissions to change roles");
    }

    const updatedByUserId = request.auth?.user?.id;
    const result = await this.accountLifecycleService.updateAccount(
      validated.value.params.accountId,
      removeUndefinedProperties(validated.value.body) as UpdateAccountRequest,
      updatedByUserId
    );

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Account not found" },
        DATABASE_ERROR: { status: 500, message: "Internal server error" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Internal server error" };
      return this.sendError(ctx, error.status, error.message);
    }

    return this.sendSuccess(ctx, { account: result.value });
  }

  async suspendAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof SuspendAccountSchema>>(ctx, {
      params: SuspendAccountSchema.shape.params,
      body: SuspendAccountSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request data");
    }

    const suspendedByUserId = request.auth?.user?.id;
    const result = await this.accountLifecycleService.suspendAccount(
      validated.value.params.accountId,
      validated.value.body.reason,
      suspendedByUserId
    );

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Account not found" },
        ALREADY_SUSPENDED: { status: 409, message: "Account is already suspended" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Internal server error" };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Account suspended", { accountId: validated.value.params.accountId });
    return this.sendSuccess(ctx, { message: "Account suspended successfully" });
  }

  async reactivateAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof AccountParamsSchema>>(ctx, {
      params: AccountParamsSchema.shape.params,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const reactivatedByUserId = request.auth?.user?.id;
    const result = await this.accountLifecycleService.reactivateAccount(
      validated.value.params.accountId,
      reactivatedByUserId
    );

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Account not found" },
        ALREADY_ACTIVE: { status: 409, message: "Account is already active" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Internal server error" };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Account reactivated", { accountId: validated.value.params.accountId });
    return this.sendSuccess(ctx, { message: "Account reactivated successfully" });
  }

  async resetPassword(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof ResetPasswordSchema>>(ctx, {
      params: ResetPasswordSchema.shape.params,
      body: ResetPasswordSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request data");
    }

    const resetByUserId = request.auth?.user?.id;
    const result = await this.accountLifecycleService.resetPassword(
      validated.value.params.accountId,
      removeUndefinedProperties(validated.value.body) as ResetPasswordRequest,
      resetByUserId
    );

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Account not found" },
        VALIDATION_ERROR: { status: 400, message: "Invalid password" },
        DATABASE_ERROR: { status: 500, message: "Internal server error" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Internal server error" };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Password reset", { accountId: validated.value.params.accountId });
    return this.sendSuccess(ctx, {
      message: "Password reset successfully",
      requirePasswordChange: validated.value.body.requirePasswordChange,
    });
  }

  async deleteAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof AccountParamsSchema>>(ctx, {
      params: AccountParamsSchema.shape.params,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const deletedByUserId = request.auth?.user?.id;
    const result = await this.accountLifecycleService.deleteAccount(
      validated.value.params.accountId,
      deletedByUserId
    );

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Account not found" },
        CANNOT_DELETE_SELF: { status: 409, message: "Cannot delete your own account" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Internal server error" };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Account deleted", { accountId: validated.value.params.accountId });
    return this.sendSuccess(ctx, { message: "Account deleted successfully" });
  }

  async listAccounts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof AccountFiltersSchema>>(ctx, {
      query: AccountFiltersSchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { page, limit, ...filters } = validated.value.query;

    // Convert date strings to Date objects
    const processedFilters = {
      ...filters,
      ...(filters.lastLoginAfter && { lastLoginAfter: new Date(filters.lastLoginAfter) }),
      ...(filters.lastLoginBefore && { lastLoginBefore: new Date(filters.lastLoginBefore) }),
      ...(filters.createdAfter && { createdAfter: new Date(filters.createdAfter) }),
      ...(filters.createdBefore && { createdBefore: new Date(filters.createdBefore) }),
    };

    const result = await this.accountLifecycleService.listAccounts(
      removeUndefinedProperties(processedFilters) as AccountFilters,
      page,
      limit
    );

    if (!result.ok) {
      return this.sendError(ctx, 500, "Internal server error");
    }

    const { accounts, total } = result.value;
    const totalPages = Math.ceil(total / limit);

    return this.sendSuccess(ctx, {
      accounts,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  }

  async getAccountStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const result = await this.accountLifecycleService.getAccountStats();

    if (!result.ok) {
      return this.sendError(ctx, 500, "Internal server error");
    }

    return this.sendSuccess(ctx, { stats: result.value });
  }

  async getAccountSessions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof AccountParamsSchema>>(ctx, {
      params: AccountParamsSchema.shape.params,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const result = await this.accountLifecycleService.getAccountSessions(
      validated.value.params.accountId
    );

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Account not found" },
        DATABASE_ERROR: { status: 500, message: "Internal server error" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Internal server error" };
      return this.sendError(ctx, error.status, error.message);
    }

    // Remove sensitive data from sessions
    const sessions = result.value.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      isActive: session.isActive,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
    }));

    return this.sendSuccess(ctx, {
      sessions,
      count: sessions.length,
    });
  }

  async revokeAllSessions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof AccountParamsSchema>>(ctx, {
      params: AccountParamsSchema.shape.params,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const revokedByUserId = request.auth?.user?.id;
    const result = await this.accountLifecycleService.revokeAllSessions(
      validated.value.params.accountId,
      revokedByUserId
    );

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Account not found" },
        DATABASE_ERROR: { status: 500, message: "Internal server error" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Internal server error" };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "All sessions revoked", {
      accountId: validated.value.params.accountId,
      count: result.value,
    });
    return this.sendSuccess(ctx, {
      message: "All sessions revoked successfully",
      revokedCount: result.value,
    });
  }

  async bulkSuspend(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof BulkSuspendSchema>>(ctx, {
      body: BulkSuspendSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const suspendedByUserId = request.auth?.user?.id;
    const results = await Promise.allSettled(
      validated.value.body.accountIds.map((accountId) =>
        this.accountLifecycleService.suspendAccount(
          accountId,
          validated.value.body.reason,
          suspendedByUserId
        )
      )
    );

    const successful = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    const failed = results.length - successful;

    this.logInfo(ctx, "Bulk suspension completed", {
      successful,
      failed,
      total: validated.value.body.accountIds.length,
    });

    return this.sendSuccess(ctx, {
      message: "Bulk suspension completed",
      successful,
      failed,
      total: validated.value.body.accountIds.length,
    });
  }

  async bulkReactivate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof BulkReactivateSchema>>(ctx, {
      body: BulkReactivateSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const reactivatedByUserId = request.auth?.user?.id;
    const results = await Promise.allSettled(
      validated.value.body.accountIds.map((accountId) =>
        this.accountLifecycleService.reactivateAccount(accountId, reactivatedByUserId)
      )
    );

    const successful = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    const failed = results.length - successful;

    this.logInfo(ctx, "Bulk reactivation completed", {
      successful,
      failed,
      total: validated.value.body.accountIds.length,
    });

    return this.sendSuccess(ctx, {
      message: "Bulk reactivation completed",
      successful,
      failed,
      total: validated.value.body.accountIds.length,
    });
  }

  async updateAccountStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof UpdateAccountStatusSchema>>(ctx, {
      params: UpdateAccountStatusSchema.shape.params,
      body: UpdateAccountStatusSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request data");
    }

    const { accountId } = validated.value.params;
    const body = validated.value.body;

    try {
      const account = await prisma.account.findUnique({ where: { id: accountId } });

      if (!account) {
        return this.sendError(ctx, 404, "Account not found");
      }

      const updatedAccount = await prisma.account.update({
        where: { id: accountId },
        data: {
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          ...(body.name !== undefined && { name: body.name }),
          ...(body.email !== undefined && { email: body.email }),
          ...(body.phone !== undefined && { phone: body.phone }),
        },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          isActive: true,
          updatedAt: true,
        },
      });

      // Create audit log with resource: "Account"
      const adminUserId = request.auth?.user?.id;
      if (adminUserId) {
        await prisma.auditLog.create({
          data: {
            action: "ACCOUNT_UPDATE",
            resource: "Account",
            resourceId: accountId,
            userId: adminUserId,
            details: {
              changes: {
                ...(body.isActive !== undefined && {
                  isActive: { from: account.isActive, to: body.isActive },
                }),
                ...(body.name !== undefined && { name: { from: account.name, to: body.name } }),
              },
              updatedBy: adminUserId,
            },
          },
        });
      }

      this.logInfo(ctx, "Account updated", { accountId, changes: body });
      return this.sendSuccess(ctx, { account: updatedAccount });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to update account status", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  async getAccountBilling(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof AccountParamsSchema>>(ctx, {
      params: AccountParamsSchema.shape.params,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const { accountId } = validated.value.params;

    try {
      // 1. Load account
      const account = await prisma.account.findUnique({ where: { id: accountId } });
      if (!account) {
        return this.sendError(ctx, 404, "Account not found");
      }

      // 1b. Load account subscription with bundle info and price history
      const subscription = await prisma.accountSubscription.findUnique({
        where: { accountId },
        include: {
          bundle: true,
          history: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });

      // 2. Build provider list from subscription only (no client channel data)
      const subscriptionProviders = subscription?.providers?.map(String) ?? [];
      const providerCounts = new Map<string, number>();
      for (const p of subscriptionProviders) {
        providerCounts.set(p, 1);
      }

      // 3. Load active pricing tiers
      const rawProviderTiers = await prisma.providerPricingTier.findMany({
        where: { isActive: true },
        orderBy: { minProviders: "asc" },
      });
      const rawAccountTiers = await prisma.accountPricingTier.findMany({
        where: { isActive: true },
        orderBy: { minAccounts: "asc" },
      });
      const rawBundles = await prisma.providerBundle.findMany({
        where: { isActive: true },
      });

      // 4. Map Prisma models to PricingCalculator interfaces
      const providerTiers: ProviderTier[] = rawProviderTiers.map((t) => ({
        minProviders: t.minProviders,
        maxProviders: t.maxProviders,
        pricePerProviderMonth: Number(t.pricePerProviderMonth),
        isActive: t.isActive,
      }));
      const accountTiers: AccountTier[] = rawAccountTiers.map((t) => ({
        minAccounts: t.minAccounts,
        maxAccounts: t.maxAccounts,
        multiplier: Number(t.multiplier),
        isActive: t.isActive,
      }));
      const bundles: BundleDef[] = rawBundles.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        providers: b.providers.map(String),
        pricePerAccountMonth: Number(b.pricePerAccountMonth),
        isActive: b.isActive,
      }));

      const providerCount = providerCounts.size;

      // If no pricing tiers exist, return zero-cost breakdown
      const hasTiers = providerTiers.length > 0;
      let total = 0;
      let breakdown = {
        pricePerProvider: 0,
        basePricePerAccount: 0,
        accountLines: [] as Array<{ accountNumber: number; multiplier: number; price: number }>,
        subtotal: 0,
        savings: 0,
      };
      let cheaperBundle: {
        bundle: { name: string; slug: string };
        bundleTotal: number;
        customTotal: number;
        savings: number;
      } | null = null;

      if (hasTiers && providerCount > 0) {
        const result = PricingCalculator.calculateCustomPrice(
          providerCount,
          1,
          providerTiers,
          accountTiers
        );
        total = result.total;
        breakdown = result.breakdown;

        const selectedProviders = Array.from(providerCounts.keys());
        const cheaperBundleResult = PricingCalculator.findCheaperBundle(
          selectedProviders,
          total,
          bundles,
          1,
          accountTiers
        );
        if (cheaperBundleResult) {
          cheaperBundle = {
            bundle: {
              name: cheaperBundleResult.bundle.name,
              slug: cheaperBundleResult.bundle.slug,
            },
            bundleTotal: cheaperBundleResult.total,
            customTotal: total,
            savings: cheaperBundleResult.savings,
          };
        }
      }

      const providers = Array.from(providerCounts.keys()).map((platform) => ({
        platform,
        pricePerProvider: breakdown.pricePerProvider,
      }));

      // Determine plan type and grandfathering
      let planType: "custom" | "bundle" | "none" = "none";
      let bundleInfo: { name: string; slug: string } | null = null;
      let isGrandfathered = false;
      let grandfathering: {
        lockedPrice: number;
        currentListPrice: number;
        savingsFromGrandfathering: number;
        expiresAt: string | null;
      } | null = null;

      if (subscription) {
        if (subscription.bundleId && subscription.bundle) {
          planType = "bundle";
          bundleInfo = {
            name: subscription.bundle.name,
            slug: subscription.bundle.slug,
          };
        } else if (subscription.providers.length > 0) {
          planType = "custom";
        }

        if (subscription.status === "GRANDFATHERED") {
          isGrandfathered = true;
          const lockedPrice = Number(subscription.pricePerMonth);
          const currentListPrice = total;
          const lastHistory = subscription.history[0];

          grandfathering = {
            lockedPrice,
            currentListPrice,
            savingsFromGrandfathering: Math.round((currentListPrice - lockedPrice) * 100) / 100,
            ...(lastHistory?.effectiveAt
              ? { expiresAt: lastHistory.effectiveAt.toISOString() }
              : { expiresAt: null }),
          };
        }
      }

      return this.sendSuccess(ctx, {
        accountId: account.id,
        accountName: account.name,
        planType,
        bundleInfo,
        isGrandfathered,
        grandfathering,
        providers,
        calculation: {
          providerCount,
          accountCount: 1,
          basePrice: breakdown.basePricePerAccount,
          totalMonthly: isGrandfathered ? Number(subscription!.pricePerMonth) : total,
          listPrice: total,
          savings: breakdown.savings,
        },
        cheaperBundle,
        ...(account.isOnTrial &&
          account.trialEndDate && {
            trial: {
              isOnTrial: true,
              trialEndDate: account.trialEndDate.toISOString(),
              daysRemaining: Math.max(
                0,
                Math.ceil((account.trialEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              ),
            },
          }),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : "";
      this.logError(ctx, "Failed to get account billing", { error: msg, stack });
      return this.sendError(ctx, 500, `Billing error: ${msg}`);
    }
  }
  /** @method updateGrandfathering — Adjusts the grandfathering expiry date */
  async updateGrandfathering(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validated = await this.validateRequest<z.infer<typeof UpdateGrandfatheringSchema>>(ctx, {
      params: UpdateGrandfatheringSchema.shape.params,
      body: UpdateGrandfatheringSchema.shape.body,
    });
    if (!validated.ok) return this.sendError(ctx, 400, "Invalid request data");

    const { accountId } = validated.value.params;
    const newDate = new Date(validated.value.body.effectiveAt);
    if (newDate <= new Date()) return this.sendError(ctx, 400, "Date must be in the future");

    try {
      const sub = await prisma.accountSubscription.findUnique({
        where: { accountId },
        include: { history: { orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (!sub || sub.status !== "GRANDFATHERED") {
        return this.sendError(ctx, 404, "No grandfathered subscription found");
      }

      const history = sub.history[0];
      if (history) {
        await prisma.subscriptionPriceHistory.update({
          where: { id: history.id },
          data: { effectiveAt: newDate },
        });
      } else {
        await prisma.subscriptionPriceHistory.create({
          data: {
            subscriptionId: sub.id,
            previousPrice: sub.pricePerMonth,
            newPrice: sub.pricePerMonth,
            reason: "Grandfathering window adjusted",
            effectiveAt: newDate,
          },
        });
      }

      return this.sendSuccess(ctx, { effectiveAt: newDate.toISOString() });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to update grandfathering", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }
}

// ✅ PROPER Fastify v5.6.1 Plugin Implementation
const accountLifecycleRoutes: FastifyPluginAsync = async (fastify) => {
  const accountLifecycleService = fastify.container!.resolve<AccountLifecycleService>(
    TOKENS.AccountLifecycleService
  );
  const handler = new AccountLifecycleHandler(accountLifecycleService);

  // ✅ Create new admin account (Super Admin only)
  fastify.post(
    "/admin/accounts",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Admin"], summary: "Create admin account" },
    },
    async (request, reply) => handler.createAccount(request, reply)
  );

  // ✅ List accounts with filtering and pagination
  fastify.get(
    "/admin/accounts",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_READ)],
      schema: { tags: ["Admin"], summary: "List accounts with filters" },
    },
    async (request, reply) => handler.listAccounts(request, reply)
  );

  // ✅ Get account statistics (must be before /:accountId to avoid route collision)
  fastify.get(
    "/admin/accounts/stats",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_READ)],
      schema: { tags: ["Admin"], summary: "Get account statistics" },
    },
    async (request, reply) => handler.getAccountStats(request, reply)
  );

  // ✅ Get account by ID
  fastify.get(
    "/admin/accounts/:accountId",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_READ)],
      schema: { tags: ["Admin"], summary: "Get account by ID" },
    },
    async (request, reply) => handler.getAccount(request, reply)
  );

  // ✅ Update account
  fastify.put(
    "/admin/accounts/:accountId",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Admin"], summary: "Update account" },
    },
    async (request, reply) => handler.updateAccount(request, reply)
  );

  // ✅ Update account active status (operates on Account model, not AdminUser)
  fastify.put(
    "/admin/accounts/:accountId/status",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Admin"], summary: "Update account active status" },
    },
    async (request, reply) => handler.updateAccountStatus(request, reply)
  );

  // ✅ Get account billing breakdown
  fastify.get(
    "/admin/accounts/:accountId/billing",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.BILLING_READ)],
      schema: { tags: ["Admin"], summary: "Get account billing breakdown" },
    },
    async (request, reply) => handler.getAccountBilling(request, reply)
  );

  // ✅ Suspend account
  fastify.post(
    "/admin/accounts/:accountId/suspend",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Admin"], summary: "Suspend account" },
    },
    async (request, reply) => handler.suspendAccount(request, reply)
  );

  // ✅ Reactivate account
  fastify.post(
    "/admin/accounts/:accountId/reactivate",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Admin"], summary: "Reactivate account" },
    },
    async (request, reply) => handler.reactivateAccount(request, reply)
  );

  // ✅ Reset account password (Admin action)
  fastify.post(
    "/admin/accounts/:accountId/reset-password",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Admin"], summary: "Reset account password" },
    },
    async (request, reply) => handler.resetPassword(request, reply)
  );

  // ✅ Delete account (Super Admin only)
  fastify.delete(
    "/admin/accounts/:accountId",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Admin"], summary: "Delete account" },
    },
    async (request, reply) => handler.deleteAccount(request, reply)
  );

  // ✅ Get account sessions
  fastify.get(
    "/admin/accounts/:accountId/sessions",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_READ)],
      schema: { tags: ["Admin"], summary: "Get account sessions" },
    },
    async (request, reply) => handler.getAccountSessions(request, reply)
  );

  // ✅ Revoke all sessions for an account
  fastify.post(
    "/admin/accounts/:accountId/revoke-sessions",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Admin"], summary: "Revoke all account sessions" },
    },
    async (request, reply) => handler.revokeAllSessions(request, reply)
  );

  // ✅ Update grandfathering expiry
  fastify.patch(
    "/admin/accounts/:accountId/grandfathering",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.BILLING_MANAGE)],
      schema: { tags: ["Admin"], summary: "Adjust grandfathering expiry date" },
    },
    async (request, reply) => handler.updateGrandfathering(request, reply)
  );

  // ✅ Bulk suspend accounts
  fastify.post(
    "/admin/accounts/bulk/suspend",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Admin"], summary: "Bulk suspend accounts" },
    },
    async (request, reply) => handler.bulkSuspend(request, reply)
  );

  // ✅ Bulk reactivate accounts
  fastify.post(
    "/admin/accounts/bulk/reactivate",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Admin"], summary: "Bulk reactivate accounts" },
    },
    async (request, reply) => handler.bulkReactivate(request, reply)
  );
};

export { accountLifecycleRoutes };
