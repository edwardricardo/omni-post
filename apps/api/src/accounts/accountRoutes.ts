/**
 * @file accountRoutes.ts
 * @description REST API endpoints for multi-project account management including
 *              CRUD operations, slug handling, and account settings.
 * @layer infrastructure
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { IdSchema } from "@packages/api-common";
import type { PrismaClient } from "@infra/prisma";
import { TOKENS } from "../infrastructure/container/types.js";
import { SecureSchemas } from "../security/inputValidation.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { withSystemContext } from "../security/tenantContext.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { DeleteAccountUseCase, HardDeleteAccountUseCase } from "@core/accounts/index.js";
import { AuditActions, AuditResources, type AuditService } from "../audit/auditService.js";

// Zod Schemas for Validation with security enhancement
const SlugSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slug must be lowercase letters, numbers, and hyphens");

const CreateAccountBodySchema = z.object({
  email: SecureSchemas.userEmail,
  name: SecureSchemas.userName,
  maxProjects: z.number().int().min(1).optional(),
  timezone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(10).optional(),
  slug: SlugSchema.optional(),
  phone: z.string().min(5).max(20).optional(),
});

const UpdateAccountBodySchema = z.object({
  name: SecureSchemas.userName.optional(),
  maxProjects: z.number().int().min(1).optional(),
  timezone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(10).optional(),
  slug: SlugSchema.optional(),
  phone: z.string().min(5).max(20).optional(),
});

const AccountParamsSchema = z.object({
  accountId: IdSchema,
});

/**
 * Body for the irreversible hard-delete endpoint. The reason is REQUIRED: it is
 * the only durable explanation of why a tenant's data was destroyed, and it is
 * written to the audit log alongside the acting admin.
 */
const HardDeleteAccountBodySchema = z.object({
  reason: z.string().min(8).max(500),
});

type _CreateAccountBody = z.infer<typeof CreateAccountBodySchema>;
type _UpdateAccountBody = z.infer<typeof UpdateAccountBodySchema>;

/**
 * Account Route Handler
 * Provides database-backed account management endpoints.
 * Receives PrismaClient and the account lifecycle use cases via constructor
 * injection from the route plugin.
 */
class AccountRouteHandler extends BaseRouteHandler {
  protected routeName = "accounts";

  constructor(
    private readonly prisma: PrismaClient,
    private readonly deleteAccountUseCase: DeleteAccountUseCase,
    private readonly hardDeleteAccountUseCase: HardDeleteAccountUseCase,
    private readonly auditService: AuditService
  ) {
    super();
  }

  /**
   * Create Account
   * POST /accounts
   */
  async createAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Creating account");

    // Validate request body
    const validated = await this.validateRequest<{ body: z.infer<typeof CreateAccountBodySchema> }>(
      ctx,
      {
        body: CreateAccountBodySchema,
      }
    );
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { email, name, maxProjects } = validated.value.body;

    try {
      // Check if email already exists
      const existingAccount = await this.prisma.account.findUnique({
        where: { email },
      });

      if (existingAccount) {
        return this.sendError(ctx, 409, "EMAIL_TAKEN", { error: "EMAIL_TAKEN" });
      }

      const finalMaxProjects = maxProjects ?? 1;

      // Create account
      const account = await this.prisma.account.create({
        data: {
          email,
          name,
          maxProjects: finalMaxProjects,
          isOnTrial: true,
          trialStartDate: new Date(),
          trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days trial
        },
      });

      this.logInfo(ctx, "Account created successfully", { accountId: account.id });

      this.sendSuccess(
        ctx,
        {
          id: account.id,
          email: account.email,
          name: account.name,
          maxProjects: account.maxProjects,
          isOnTrial: account.isOnTrial,
          createdAt: account.createdAt,
        },
        200
      );
    } catch (error) {
      this.logError(ctx, "Failed to create account", { error });
      return this.sendError(ctx, 500, "Failed to create account");
    }
  }

  /**
   * Get Account
   * GET /accounts/:accountId
   */
  async getAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Getting account");

    // Validate params
    const validated = await this.validateRequest<{ params: z.infer<typeof AccountParamsSchema> }>(
      ctx,
      {
        params: AccountParamsSchema,
      }
    );
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid account ID");
    }

    const { accountId } = validated.value.params;

    try {
      // `deletedAt: null` is what makes the soft delete a delete from the
      // caller's point of view — without it this route would keep serving an
      // account the tenant has already removed.
      const account = await this.prisma.account.findFirst({
        where: { id: accountId, deletedAt: null },
        include: {
          projects: { where: { deletedAt: null } },
        },
      });

      if (!account) {
        return this.sendError(ctx, 404, "Account not found");
      }

      this.logInfo(ctx, "Account retrieved successfully", { accountId });

      this.sendSuccess(ctx, {
        id: account.id,
        email: account.email,
        name: account.name,
        maxProjects: account.maxProjects,
        isOnTrial: account.isOnTrial,
        createdAt: account.createdAt,
        projects: account.projects,
      });
    } catch (error) {
      this.logError(ctx, "Failed to get account", { error });
      return this.sendError(ctx, 500, "Failed to get account");
    }
  }

  /**
   * List Accounts
   * GET /accounts
   */
  async listAccounts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Listing accounts");

    try {
      const accounts = await this.prisma.account.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          projects: { where: { deletedAt: null } },
        },
      });

      this.logInfo(ctx, "Accounts retrieved successfully", { count: accounts.length });

      this.sendSuccess(
        ctx,
        accounts.map((account) => ({
          id: account.id,
          email: account.email,
          name: account.name,
          maxProjects: account.maxProjects,
          isOnTrial: account.isOnTrial,
          createdAt: account.createdAt,
          projectCount: account.projects.length,
        }))
      );
    } catch (error) {
      this.logError(ctx, "Failed to list accounts", { error });
      return this.sendError(ctx, 500, "Failed to list accounts");
    }
  }

  /**
   * Update Account
   * PUT /accounts/:accountId
   */
  async updateAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Updating account");

    // Validate params and body
    const validated = await this.validateRequest<{
      params: z.infer<typeof AccountParamsSchema>;
      body: z.infer<typeof UpdateAccountBodySchema>;
    }>(ctx, {
      params: AccountParamsSchema,
      body: UpdateAccountBodySchema,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request data");
    }

    const { accountId } = validated.value.params;
    const updates = validated.value.body;

    try {
      // Check if account exists. A soft-deleted account is gone as far as every
      // other route is concerned, so it must not be updatable either.
      const existingAccount = await this.prisma.account.findFirst({
        where: { id: accountId, deletedAt: null },
      });

      if (!existingAccount) {
        return this.sendError(ctx, 404, "Account not found");
      }

      // Build update data
      const updateData: { name?: string; maxProjects?: number } = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.maxProjects !== undefined) {
        updateData.maxProjects = updates.maxProjects;
      }

      // Update account
      const account = await this.prisma.account.update({
        where: { id: accountId },
        data: updateData,
      });

      this.logInfo(ctx, "Account updated successfully", { accountId });

      this.sendSuccess(ctx, {
        id: account.id,
        email: account.email,
        name: account.name,
        maxProjects: account.maxProjects,
        isOnTrial: account.isOnTrial,
        updatedAt: account.updatedAt,
      });
    } catch (error) {
      this.logError(ctx, "Failed to update account", { error });
      return this.sendError(ctx, 500, "Failed to update account");
    }
  }

  /**
   * Delete Account (NORMAL path — reversible)
   * DELETE /accounts/:accountId
   *
   * Soft-deletes: the row keeps its data and gains `deletedAt`, so the account
   * disappears from every read while its projects, channels, posts, invoices and
   * audit trail survive — which is what billing and legal retention require.
   * This is H12 (Soft Delete Universal). The irreversible variant is
   * `DELETE /accounts/:accountId/hard` and is admin-only.
   */
  async deleteAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Deleting account");

    // Validate params
    const validated = await this.validateRequest<{ params: z.infer<typeof AccountParamsSchema> }>(
      ctx,
      {
        params: AccountParamsSchema,
      }
    );
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid account ID");
    }

    const { accountId } = validated.value.params;

    const customer = request.customerUser;
    if (!customer) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    // The use case owns the tenant gate (CWE-639) and the transaction; this
    // handler only translates its typed error code to a status. An Account IS
    // the tenant root and is NOT tenant-guard enrolled, so before this gate
    // existed nothing stopped one tenant from deleting another's account.
    const result = await this.deleteAccountUseCase.execute({
      accountId,
      caller: { type: "customer", accountId: customer.accountId },
    });

    if (!result.ok) {
      // NOT_FOUND covers "no such account", "already deleted" and "not yours" —
      // the use case deliberately makes them indistinguishable (anti-enumeration).
      if (result.error.code === USE_CASE_ERRORS.NOT_FOUND) {
        return this.sendError(ctx, 404, "Account not found");
      }
      if (result.error.code === USE_CASE_ERRORS.VALIDATION_FAILED) {
        return this.sendError(ctx, 400, "Invalid account ID");
      }
      this.logError(ctx, "Failed to delete account", { error: result.error });
      return this.sendError(ctx, 500, "Failed to delete account");
    }

    this.logInfo(ctx, "Account soft-deleted", { accountId });

    this.sendSuccess(ctx, { message: "Account deleted successfully" });
  }

  /**
   * Hard Delete Account (EXCEPTIONAL path — irreversible)
   * DELETE /accounts/:accountId/hard
   *
   * Destroys the account and every project, channel and post beneath it. Guard
   * rails, all of them load-bearing: admin authentication plus `account:manage`,
   * a mandatory written reason, one transaction for the whole cascade
   * (repository), an audit record on both success and failure, and the
   * sanctioned `withSystemContext` bypass rather than an ambient tenant context.
   */
  async hardDeleteAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Hard deleting account");

    const params = AccountParamsSchema.safeParse(request.params);
    if (!params.success) {
      return this.sendError(ctx, 400, "Invalid account ID");
    }
    const body = HardDeleteAccountBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return this.sendError(ctx, 400, "A reason of at least 8 characters is required");
    }

    const { accountId } = params.data;
    const { reason } = body.data;
    const adminUserId =
      (request as FastifyRequest & { adminUser?: { id: string } }).adminUser?.id ?? null;

    // Admin auth binds NO tenant context, but the cascade writes to
    // tenant-guard-enrolled tables (`project`, `channel`, `apiKey`, `template`,
    // ...), which would throw TenantContextMissingError. This is a legitimate
    // cross-tenant admin operation, so run it under the sanctioned
    // `withSystemContext` bypass (mirrors the channel hard-delete path).
    const result = await withSystemContext(`system:account-hard-delete:${accountId}`, async () =>
      this.hardDeleteAccountUseCase.execute({
        accountId,
        caller: {
          type: "admin",
          adminUserId: adminUserId ?? "unknown",
          reason,
        },
      })
    );

    if (!result.ok) {
      await this.auditService.log({
        action: AuditActions.ACCOUNT_DELETED,
        resource: AuditResources.ACCOUNT,
        resourceId: accountId,
        ...(adminUserId && { userId: adminUserId }),
        success: false,
        error: result.error.message,
        details: { mode: "hard", reason },
      });
      const status =
        result.error.code === USE_CASE_ERRORS.NOT_FOUND
          ? 404
          : result.error.code === USE_CASE_ERRORS.VALIDATION_FAILED
            ? 400
            : 500;
      return this.sendError(
        ctx,
        status,
        status === 404 ? "Account not found" : "Failed to hard delete account"
      );
    }

    await this.auditService.log({
      action: AuditActions.ACCOUNT_DELETED,
      resource: AuditResources.ACCOUNT,
      resourceId: accountId,
      ...(adminUserId && { userId: adminUserId }),
      success: true,
      details: { mode: "hard", reason },
    });

    this.logInfo(ctx, "Account hard-deleted", { accountId });

    this.sendSuccess(ctx, { deleted: true });
  }
}

/**
 * Account Routes Plugin
 * Registers account management endpoints.
 * Resolves PrismaClient from the DI container.
 */
export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  const prisma = fastify.container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const deleteAccountUseCase = fastify.container.resolve<DeleteAccountUseCase>(
    TOKENS.DeleteAccountUseCase
  );
  const hardDeleteAccountUseCase = fastify.container.resolve<HardDeleteAccountUseCase>(
    TOKENS.HardDeleteAccountUseCase
  );
  const auditService = fastify.container.resolve<AuditService>(TOKENS.AuditService);

  const handler = new AccountRouteHandler(
    prisma,
    deleteAccountUseCase,
    hardDeleteAccountUseCase,
    auditService
  );

  // Create account
  fastify.post(
    "/accounts",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Accounts"], summary: "Create a new account" },
    },
    async (request, reply) => handler.createAccount(request, reply)
  );

  // Get account by ID
  fastify.get(
    "/accounts/:accountId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Accounts"], summary: "Get account by ID" },
    },
    async (request, reply) => handler.getAccount(request, reply)
  );

  // List all accounts
  fastify.get(
    "/accounts",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Accounts"], summary: "List all accounts" },
    },
    async (request, reply) => handler.listAccounts(request, reply)
  );

  // Update account
  fastify.put(
    "/accounts/:accountId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Accounts"], summary: "Update account" },
    },
    async (request, reply) => handler.updateAccount(request, reply)
  );

  // Soft-delete account (normal path)
  fastify.delete(
    "/accounts/:accountId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Accounts"], summary: "Soft-delete an account" },
    },
    async (request, reply) => handler.deleteAccount(request, reply)
  );

  // Hard-delete account (irreversible, admin only)
  fastify.delete(
    "/accounts/:accountId/hard",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Accounts"], summary: "Hard-delete an account permanently" },
    },
    async (request, reply) => handler.hardDeleteAccount(request, reply)
  );
};
