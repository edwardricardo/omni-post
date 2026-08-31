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
import { requireCustomerPermission, CustomerPermission } from "../auth/customerRbacMiddleware.js";
import { requireCustomerOrAdminAuth } from "../auth/customerOrAdminAuth.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { withSystemContext } from "../security/tenantContext.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { toAdminActorId } from "@core/domain/value-objects/AdminActorId.js";
import type {
  DeleteAccountUseCase,
  HardDeleteAccountUseCase,
  RestoreAccountUseCase,
} from "@core/accounts/index.js";
import { mapHardDeleteError } from "../lib/hardDeleteErrorMapping.js";
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
    private readonly restoreAccountUseCase: RestoreAccountUseCase,
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
   * Restore Account (reverse of the soft delete)
   * POST /accounts/:accountId/restore
   *
   * Clears `deletedAt` so a soft-deleted account is visible again. Reachable by
   * the account OWNER (self-service undo) OR by an admin (support recovering a
   * mistaken deletion) — the "admin-or-owner" surface. Authentication is the
   * composed `requireCustomerOrAdminAuth`, so exactly one of
   * `request.customerUser` / `request.auth` is set here:
   *   - customer: must hold the OWNER-only `account:delete` permission (the same
   *     gate as the delete it reverses), and is tenant-gated by the use case to
   *     its own account.
   *   - admin: runs under `withSystemContext` (admin auth binds no tenant scope),
   *     skipping the ownership gate.
   * NOT_FOUND covers "no such account", "already active" and "not yours" — the
   * use case makes them indistinguishable (anti-enumeration), mirroring delete.
   */
  async restoreAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Restoring account");

    const params = AccountParamsSchema.safeParse(request.params);
    if (!params.success) {
      return this.sendError(ctx, 400, "Invalid account ID");
    }
    const { accountId } = params.data;

    const customer = request.customerUser;
    const admin = request.auth;

    let result;
    if (customer) {
      // The owner-level gate, same permission as the delete this reverses.
      if (!customer.permissions.includes(CustomerPermission.ACCOUNT_DELETE)) {
        return this.sendError(ctx, 403, "PERMISSION_DENIED", {
          error: { code: "PERMISSION_DENIED", message: "Required permission: account:delete" },
        });
      }
      result = await this.restoreAccountUseCase.execute({
        accountId,
        caller: { type: "customer", accountId: customer.accountId },
      });
    } else if (admin) {
      // Admin auth binds no tenant context; the account is not tenant-guard
      // enrolled, but run under withSystemContext for symmetry with the other
      // admin lifecycle paths and so the caller is a declared cross-tenant one.
      result = await withSystemContext(`system:account-restore:${accountId}`, async () =>
        this.restoreAccountUseCase.execute({
          accountId,
          caller: { type: "admin", adminUserId: admin.user.id },
        })
      );
    } else {
      return this.sendError(ctx, 401, "Authentication required");
    }

    if (!result.ok) {
      if (result.error.code === USE_CASE_ERRORS.NOT_FOUND) {
        return this.sendError(ctx, 404, "Account not found");
      }
      if (result.error.code === USE_CASE_ERRORS.VALIDATION_FAILED) {
        return this.sendError(ctx, 400, "Invalid account ID");
      }
      this.logError(ctx, "Failed to restore account", { error: result.error });
      return this.sendError(ctx, 500, "Failed to restore account");
    }

    this.logInfo(ctx, "Account restored", { accountId });

    this.sendSuccess(ctx, { restored: true });
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

    // Fail closed on attribution. `requireAdminAuth` binds the principal on
    // `request.auth`; reading THAT (not the phantom `request.adminUser` nobody
    // sets) is what names the admin on the tombstone and the audit record. A
    // branded, non-empty id — no `"unknown"` fallback: if no principal survived
    // authentication we do not know who is erasing a tenant's data, so we destroy
    // nothing and surface a 500 (an internal-invariant violation, not the
    // caller's fault).
    const actor = toAdminActorId(request.auth?.user?.id);
    if (!actor.ok) {
      this.logError(
        ctx,
        "Hard delete rejected: requireAdminAuth left no principal on request.auth"
      );
      return this.sendError(ctx, 500, "Failed to hard delete account");
    }
    const adminUserId = actor.value;

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
          adminUserId,
          reason,
        },
      })
    );

    if (!result.ok) {
      await this.auditService.log({
        action: AuditActions.ACCOUNT_DELETED,
        resource: AuditResources.ACCOUNT,
        resourceId: accountId,
        userId: adminUserId,
        success: false,
        error: result.error.message,
        details: { mode: "hard", reason },
      });
      const { status, message } = mapHardDeleteError(
        result.error.code,
        result.error.message,
        "account"
      );
      return this.sendError(ctx, status, message);
    }

    await this.auditService.log({
      action: AuditActions.ACCOUNT_DELETED,
      resource: AuditResources.ACCOUNT,
      resourceId: accountId,
      userId: adminUserId,
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
  const restoreAccountUseCase = fastify.container.resolve<RestoreAccountUseCase>(
    TOKENS.RestoreAccountUseCase
  );
  const auditService = fastify.container.resolve<AuditService>(TOKENS.AuditService);

  const handler = new AccountRouteHandler(
    prisma,
    deleteAccountUseCase,
    hardDeleteAccountUseCase,
    restoreAccountUseCase,
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

  // Soft-delete account (normal path). Gated on the OWNER-only `account:delete`
  // permission (D-RESTORE / F5): before this gate, ANY authenticated customer —
  // MEMBER, VIEWER — could soft-delete the tenant root.
  fastify.delete(
    "/accounts/:accountId",
    {
      preHandler: [requireClientAuth, requireCustomerPermission(CustomerPermission.ACCOUNT_DELETE)],
      schema: { tags: ["Accounts"], summary: "Soft-delete an account" },
    },
    async (request, reply) => handler.deleteAccount(request, reply)
  );

  // Restore a soft-deleted account (admin-or-owner). One composed authn accepts
  // either a customer (owner) token or an admin token.
  fastify.post(
    "/accounts/:accountId/restore",
    {
      preHandler: [requireCustomerOrAdminAuth],
      schema: { tags: ["Accounts"], summary: "Restore a soft-deleted account" },
    },
    async (request, reply) => handler.restoreAccount(request, reply)
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
