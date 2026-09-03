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
import { toAdminActorId } from "@core/domain/value-objects/AdminActorId.js";
import type { HardDeleteAccountUseCase } from "@core/accounts/index.js";
import { mapHardDeleteError } from "../lib/hardDeleteErrorMapping.js";
import { AuditActions, AuditResources, type AuditService } from "../audit/auditService.js";

/**
 * The customer-side grant required to destroy an account. Seeded to the OWNER
 * role and to no other (`infra/prisma/seed.ts`, where MANAGER is defined as
 * "everything except billing, account deletion, and role assignment").
 *
 * Gating on this string rather than on `roleName === "OWNER"` is deliberate: a
 * role-name comparison re-derives authority from a denormalised label, and a
 * wildcard "OWNER can do anything" bypass would implicitly grant every
 * permission added in the future.
 */
const ACCOUNT_DELETE_PERMISSION = "account:delete";

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
 * Receives PrismaClient and the admin-only hard-delete use case via constructor
 * injection from the route plugin.
 */
class AccountRouteHandler extends BaseRouteHandler {
  protected routeName = "accounts";

  constructor(
    private readonly prisma: PrismaClient,
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
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
        include: {
          projects: true,
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
        orderBy: { createdAt: "desc" },
        include: {
          projects: true,
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
      // Check if account exists
      const existingAccount = await this.prisma.account.findUnique({
        where: { id: accountId },
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
   * Delete Account
   * DELETE /accounts/:accountId
   */
  async deleteAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Deleting account");

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

    // Fail closed on the principal. `requireClientAuth` is the ONLY preHandler on
    // this route, so `request.customerUser` is the sole authority over whose
    // account this is; with no principal we do not know who is asking and we
    // destroy nothing. No `?? ""` softening — an empty string would then match an
    // account whose id is empty rather than refusing.
    const principal = request.customerUser;
    if (!principal) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    // The ownership comparison, and why it lives HERE rather than in a lower
    // layer: `Account` IS the tenant. Its key is `id`, not `accountId`, so it is
    // structurally absent from the Prisma tenant guard's `TENANT_SCOPED_MODELS`
    // and the guard passes every `account` query through untouched — as do
    // `post`, `postContent` and `postMedia`, which the cascade below reaches
    // first. Nothing under this line can refuse a foreign id.
    //
    // The refusal is a 404, identical to the not-found answer a few lines down:
    // a 403 would confirm to any authenticated customer that the id names a real
    // tenant, turning the endpoint into an account-enumeration oracle.
    if (accountId !== principal.accountId) {
      this.logError(ctx, "Cross-tenant account delete refused", {
        principalAccountId: principal.accountId,
        requestedAccountId: accountId,
      });
      return this.sendError(ctx, 404, "Account not found");
    }

    // Ownership is not authorization. The comparison above only establishes
    // that the caller belongs to THIS tenant — every member passes it, VIEWER
    // included. What follows destroys the tenant, so the destructive grant is
    // asserted separately.
    //
    // Why this became urgent without the authorization changing: under the ON
    // DELETE convention this branch carries, `Invoice.accountId` and
    // `Referral.referralCodeId` no longer hold RESTRICT. Before, the database
    // refused this statement outright for any account that had ever been billed
    // or referred, so an under-privileged caller got a 500 and destroyed
    // nothing. Now the same call completes and cascades. The gate below is what
    // replaces the protection the constraints used to provide by accident.
    //
    // Fail closed on the claim itself. `verifyCustomerToken` casts its payload
    // with `as CustomerJwtPayload` and validates nothing at runtime, so a token
    // minted without a `permissions` claim arrives here as `undefined` — a real
    // path, not a hypothetical one. No `?? []` softening: that would turn "this
    // token carries no permissions" into "there is nothing to check".
    const { permissions } = principal;
    if (!Array.isArray(permissions) || !permissions.includes(ACCOUNT_DELETE_PERMISSION)) {
      // 403 here, where the ownership refusal above is 404, and the difference
      // is intentional — do NOT "align" them for consistency. The 404 exists so
      // a FOREIGN account id looks indistinguishable from a missing one; it is
      // an anti-enumeration answer. This caller owns the account and already
      // knows it exists, so naming the real reason leaks nothing they did not
      // already supply, and a 404 here would instead tell an owner their own
      // account had vanished.
      this.logError(ctx, "Account delete refused: missing destructive permission", {
        accountId,
        principalId: principal.id,
        roleName: principal.roleName,
      });
      return this.sendError(ctx, 403, "Insufficient permissions to delete this account");
    }

    try {
      // Check if account exists
      const existingAccount = await this.prisma.account.findUnique({
        where: { id: accountId },
        include: { projects: { select: { id: true } } },
      });

      if (!existingAccount) {
        return this.sendError(ctx, 404, "Account not found");
      }

      // Explicit leaf-first deletes. Since the ON DELETE convention landed these
      // are REDUNDANT — Account cascades to Project, Project to Post and Channel,
      // Post to PostContent and PostMedia — so the final `account.delete` alone
      // would remove all of it. They are kept because they bound the work into
      // named statements instead of one opaque server-side cascade, and because
      // deleting them is a behaviour change this slice has no test for. What they
      // are NOT any more is load-bearing.
      const projectIds = existingAccount.projects.map((p: { id: string }) => p.id);
      if (projectIds.length > 0) {
        await this.prisma.postContent.deleteMany({
          where: { post: { projectId: { in: projectIds } } },
        });
        await this.prisma.postMedia.deleteMany({
          where: { post: { projectId: { in: projectIds } } },
        });

        await this.prisma.post.deleteMany({
          where: { projectId: { in: projectIds } },
        });

        await this.prisma.channel.deleteMany({
          where: { projectId: { in: projectIds } },
        });
      }

      // Deleting the account cascades to everything beneath it. Invoice,
      // BillingEvent, DsarRequest and WebhookEvent SURVIVE with `accountId`
      // nulled, and Referral survives its ReferralCode unattributed — before the
      // convention, Invoice and Referral held ON DELETE RESTRICT and BLOCKED this
      // statement outright for any account that had ever been billed or referred.
      await this.prisma.account.delete({
        where: { id: accountId },
      });

      this.logInfo(ctx, "Account deleted successfully", { accountId });

      this.sendSuccess(ctx, { message: "Account deleted successfully" });
    } catch (error) {
      this.logError(ctx, "Failed to delete account", { error });
      return this.sendError(ctx, 500, "Failed to delete account");
    }
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
  const hardDeleteAccountUseCase = fastify.container.resolve<HardDeleteAccountUseCase>(
    TOKENS.HardDeleteAccountUseCase
  );
  const auditService = fastify.container.resolve<AuditService>(TOKENS.AuditService);

  const handler = new AccountRouteHandler(prisma, hardDeleteAccountUseCase, auditService);

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

  // Delete account
  fastify.delete(
    "/accounts/:accountId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Accounts"], summary: "Delete account" },
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
