/**
 * @file accountRoutes.ts
 * @description REST API endpoints for the account lifecycle: a customer reads and renames their
 *              own account and soft-deletes or restores it; an admin restores or erases any.
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
import { requireCallerOwnsAccountParam } from "../auth/requireCallerOwnsAccountParam.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requireCustomerOrAdminAuth } from "../auth/customerOrAdminAuth.js";
import { CustomerPermission, requireCustomerPermission } from "../auth/customerRbacMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import type { RbacService } from "../auth/rbacService.js";
import { adminHoldsPermission } from "../auth/adminHoldsPermission.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { withSystemContext } from "../security/tenantContext.js";
import { toAdminActorId } from "@core/domain/value-objects/AdminActorId.js";
import type {
  DeleteAccountUseCase,
  HardDeleteAccountUseCase,
  RestoreAccountUseCase,
} from "@core/accounts/index.js";
import { USE_CASE_ERRORS, type UseCaseError } from "@core/application/UseCase.js";
import type { Result } from "@shared/types";
import { mapHardDeleteError } from "../lib/hardDeleteErrorMapping.js";
import { AuditActions, AuditResources, type AuditService } from "../audit/auditService.js";

/**
 * Body of `PUT /accounts/:accountId`: the account's name, and nothing else. The project quota
 * `maxProjects` is a billing field only an admin writes (`PUT /admin/accounts/:id/settings`); a
 * customer raising their own would bypass their plan's limit. A body carrying it, or any other
 * key, is refused whole with 400 rather than stripped, so a client that sent it is told the field
 * was not written instead of reading a 200 as a change.
 */
const UpdateAccountBodySchema = z.strictObject({
  name: SecureSchemas.userName,
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

type _UpdateAccountBody = z.infer<typeof UpdateAccountBodySchema>;

/**
 * Account Route Handler
 * Provides database-backed account management endpoints.
 * Receives PrismaClient, the account lifecycle use cases (soft delete, its
 * reversal, and the admin-only irreversible erasure), the RBAC service and the
 * audit service via constructor injection from the route plugin.
 */
class AccountRouteHandler extends BaseRouteHandler {
  protected routeName = "accounts";

  constructor(
    private readonly prisma: PrismaClient,
    private readonly deleteAccountUseCase: DeleteAccountUseCase,
    private readonly restoreAccountUseCase: RestoreAccountUseCase,
    private readonly hardDeleteAccountUseCase: HardDeleteAccountUseCase,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService
  ) {
    super();
  }

  /**
   * @method getAccount
   * @description Returns the caller's own live account with its live projects (GET
   *   /accounts/:accountId; `requireCallerOwnsAccountParam` has admitted the path's account).
   *   Any authenticated member of the account may read it; a soft-deleted account answers 404.
   * @param request - The request, carrying the account id in its path.
   * @param reply - The reply the account or the refusal is sent on.
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
   * @method updateAccount
   * @description Renames the caller's own live account (PUT /accounts/:accountId;
   *   `requireCallerOwnsAccountParam` has admitted the path's account and
   *   `requireCustomerPermission` the caller's `account:manage`). The name is the only field
   *   written; a soft-deleted account answers 404.
   * @param request - The request, carrying the account id in its path and the new name in its body.
   * @param reply - The reply the renamed account or the refusal is sent on.
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
    const { name } = validated.value.body;

    try {
      // Check if account exists. A soft-deleted account is gone as far as every
      // other route is concerned, so it must not be updatable either.
      const existingAccount = await this.prisma.account.findFirst({
        where: { id: accountId, deletedAt: null },
      });

      if (!existingAccount) {
        return this.sendError(ctx, 404, "Account not found");
      }

      const account = await this.prisma.account.update({
        where: { id: accountId },
        data: { name },
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
   * @method deleteAccount
   * @description Soft-deletes the caller's own account, the normal and reversible path (DELETE
   *   /accounts/:accountId). The row keeps its data and gains `deletedAt`, so the account
   *   disappears from every read while its projects, channels, posts, invoices and audit trail
   *   survive — which is what billing and legal retention require. The irreversible variant is
   *   `DELETE /accounts/:accountId/hard` and is admin-only.
   * @param request - The request, carrying the account id in its path and the customer principal.
   * @param reply - The reply the confirmation or the refusal is sent on.
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

    // Ownership is not authorization, and the two gates now live in different
    // places on purpose. CAPABILITY — the OWNER-only `account:delete` grant that
    // this action needs because a soft delete still shuts the tenant down (every
    // read stops serving it, its users stop logging in, its publishing halts) —
    // is asserted by the `requireCustomerPermission` preHandler, which the
    // project delete route shares, so both surfaces enforce it through ONE code
    // path instead of two hand-written membership tests that can disagree.
    // OWNERSHIP stays here, because only this handler knows which account the
    // path names.
    //
    // Their statuses differ, and that is deliberate — do NOT "align" them. The
    // preHandler's 403 is keyed on the CALLER alone and says nothing about which
    // accounts exist. The 404 above exists so a FOREIGN account id looks
    // indistinguishable from a missing one. An owner who lacks the grant is told
    // the truth about their own capability; an outsider is told nothing at all.

    // The use case owns the tenant gate (CWE-639, re-checked below the route
    // gate on purpose) and the transaction; this handler translates its typed
    // error code to a status and writes the audit record. NOTHING destructive
    // remains on this path: no leaf-first deleteMany, no `account.delete` —
    // the repository's `delete` sets `deletedAt` and stops.
    const result = await this.deleteAccountUseCase.execute({
      accountId,
      caller: { type: "customer", accountId: principal.accountId },
    });

    if (!result.ok) {
      // NOT_FOUND covers "no such account" and "already soft-deleted" — from
      // the caller's point of view both are gone.
      if (result.error.code === USE_CASE_ERRORS.NOT_FOUND) {
        return this.sendError(ctx, 404, "Account not found");
      }
      if (result.error.code === USE_CASE_ERRORS.VALIDATION_FAILED) {
        return this.sendError(ctx, 400, "Invalid account ID");
      }
      this.logError(ctx, "Failed to delete account", { error: result.error });
      await this.auditService.log({
        action: AuditActions.ACCOUNT_DELETED,
        resource: AuditResources.ACCOUNT,
        resourceId: accountId,
        customerUserId: principal.id,
        accountId,
        success: false,
        error: result.error.message,
        details: { mode: "soft" },
      });
      return this.sendError(ctx, 500, "Failed to delete account");
    }

    // Soft deletes write no tombstone (the row IS the record), so the audit
    // log is the only durable answer to "who deleted this" — attributed to the
    // CUSTOMER principal via its own FK, mirroring the hard path's admin entry.
    await this.auditService.log({
      action: AuditActions.ACCOUNT_DELETED,
      resource: AuditResources.ACCOUNT,
      resourceId: accountId,
      customerUserId: principal.id,
      accountId,
      success: true,
      details: { mode: "soft" },
    });

    this.logInfo(ctx, "Account soft-deleted", { accountId });

    this.sendSuccess(ctx, { message: "Account deleted successfully" });
  }

  /**
   * @method restoreAccount
   * @description Reverses the soft delete (POST /accounts/:accountId/restore): clears `deletedAt`
   *   so a soft-deleted account is live again — the act that makes the soft delete genuinely
   *   reversible rather than merely invisible. Reachable by the OWNER (self-service undo) or by an
   *   admin (support recovery) through the composed `requireCustomerOrAdminAuth`, so exactly one
   *   of `request.customerUser` / `request.auth` is set when the handler runs:
   *     - customer: must hold the OWNER-only `account:delete` — the same grant as the delete this
   *       reverses, because a capability to undo a tenant-wide action is the same grade of
   *       authority as the action; the use case then refuses any account but the caller's own.
   *     - admin: must hold `account:manage`, then runs under `withSystemContext` because the
   *       restore touches tenant-guarded reads and admin auth binds no tenant scope.
   *   NOT_FOUND covers "no such account", "not yours" and "hard-deleted" — the use case makes them
   *   indistinguishable (anti-enumeration), mirroring the delete.
   * @param request - The request, carrying the account id in its path and either principal.
   * @param reply - The reply the confirmation or the refusal is sent on.
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

    let result: Result<void, UseCaseError>;

    if (customer) {
      // Fail closed on the claim itself. `verifyCustomerToken` casts its payload
      // and validates nothing at runtime, so `permissions` can arrive undefined —
      // a real path, not a hypothetical one. `Array.isArray` first means an absent
      // claim is "holds nothing", never "nothing to check".
      const { permissions } = customer;
      if (!Array.isArray(permissions) || !permissions.includes(CustomerPermission.ACCOUNT_DELETE)) {
        return this.sendError(ctx, 403, "Insufficient permissions to restore this account");
      }
      result = await this.restoreAccountUseCase.execute({
        accountId,
        caller: { type: "customer", accountId: customer.accountId },
      });
    } else if (admin) {
      // The admin grant, asserted BEFORE anything else on this arm. An admin
      // token alone only proves the holder is staff; this endpoint reaches across
      // every tenant, so without the capability check any staff role — SUPPORT
      // included — could bring back any tenant the business had removed.
      if (!(await adminHoldsPermission(this.rbacService, request, Permission.ACCOUNT_MANAGE))) {
        return this.sendError(ctx, 403, "Insufficient permissions to restore this account");
      }

      // Fail closed on attribution, exactly as the hard-delete path does: an id
      // that survived validation is the proof a real principal authenticated, and
      // a privileged cross-tenant restore performed by nobody is not a restore we
      // are willing to run.
      const actor = toAdminActorId(admin.user?.id);
      if (!actor.ok) {
        this.logError(
          ctx,
          "Restore rejected: the admin branch was reached with no principal on request.auth"
        );
        return this.sendError(ctx, 500, "Failed to restore account");
      }

      // Admin auth binds no tenant scope, and the restore reads and writes
      // through tenant-guarded paths, so it runs under the sanctioned bypass
      // (mirrors the hard-delete path).
      result = await withSystemContext(`system:account-restore:${accountId}`, async () =>
        this.restoreAccountUseCase.execute({
          accountId,
          caller: { type: "admin", adminUserId: actor.value },
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
      if (result.error.code === USE_CASE_ERRORS.CONFLICT) {
        // The use-case message NAMES the blocker — the active account holding the
        // e-mail address, or the fact that this one is already live. Surfacing it
        // verbatim is what makes the 409 actionable: only a human can decide
        // which of two accounts keeps a contested address, and they cannot decide
        // it without being told which account is in the way.
        return this.sendError(ctx, 409, result.error.message);
      }
      if (result.error.code === USE_CASE_ERRORS.FORBIDDEN) {
        return this.sendError(ctx, 403, "Restore refused");
      }
      this.logError(ctx, "Failed to restore account", { error: result.error });
      return this.sendError(ctx, 500, "Failed to restore account");
    }

    this.logInfo(ctx, "Account restored", { accountId });

    this.sendSuccess(ctx, { restored: true });
  }

  /**
   * @method hardDeleteAccount
   * @description Erases an account, the exceptional and irreversible path (DELETE
   *   /accounts/:accountId/hard): destroys the account and every project, channel and post
   *   beneath it. Guard rails, all of them load-bearing: admin authentication plus
   *   `account:manage`, a mandatory written reason, one transaction for the whole cascade
   *   (repository), an audit record on both success and failure, and the sanctioned
   *   `withSystemContext` bypass rather than an ambient tenant context.
   * @param request - The request, carrying the account id in its path, the reason in its body and
   *   the admin principal.
   * @param reply - The reply the confirmation or the refusal is sent on.
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
 * @description Registers the account routes. Resolves the Prisma client, the account lifecycle
 *   use cases, the RBAC service and the audit service from the DI container.
 * @param fastify - The Fastify instance the routes are registered on.
 */
export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  const prisma = fastify.container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const deleteAccountUseCase = fastify.container.resolve<DeleteAccountUseCase>(
    TOKENS.DeleteAccountUseCase
  );
  const restoreAccountUseCase = fastify.container.resolve<RestoreAccountUseCase>(
    TOKENS.RestoreAccountUseCase
  );
  const hardDeleteAccountUseCase = fastify.container.resolve<HardDeleteAccountUseCase>(
    TOKENS.HardDeleteAccountUseCase
  );
  const rbacService = fastify.container.resolve<RbacService>(TOKENS.RbacService);
  const auditService = fastify.container.resolve<AuditService>(TOKENS.AuditService);

  const handler = new AccountRouteHandler(
    prisma,
    deleteAccountUseCase,
    restoreAccountUseCase,
    hardDeleteAccountUseCase,
    rbacService,
    auditService
  );

  // The own-account routes admit only the caller's own account, before any database access and
  // before any grant check: `Account` is the tenant itself, so the tenant guard never refuses it.
  const requireCallerAccount = requireCallerOwnsAccountParam("accounts");

  // Read my account: any authenticated member of it.
  fastify.get(
    "/accounts/:accountId",
    {
      preHandler: [requireClientAuth, requireCallerAccount],
      schema: { tags: ["Accounts"], summary: "Get account by ID" },
    },
    async (request, reply) => handler.getAccount(request, reply)
  );

  // Rename my account: `account:manage`, which the seed grants to OWNER alone. The account gate
  // runs first, so a foreign id answers 404 whatever the caller holds and the 403 of a missing
  // grant is only ever told to a member of the account it names.
  fastify.put(
    "/accounts/:accountId",
    {
      preHandler: [
        requireClientAuth,
        requireCallerAccount,
        requireCustomerPermission(CustomerPermission.ACCOUNT_MANAGE),
      ],
      schema: { tags: ["Accounts"], summary: "Update account" },
    },
    async (request, reply) => handler.updateAccount(request, reply)
  );

  // Delete account (soft, reversible). The OWNER-only `account:delete` grant
  // moved out of the handler and into this preHandler, which the project delete
  // route shares: two hand-written membership tests over the same permission
  // string are two chances to drift, and the one that drifts is the one nobody
  // is looking at. Ownership stays in the handler, where the path's account id
  // is known, and keeps its anti-enumeration 404.
  fastify.delete(
    "/accounts/:accountId",
    {
      preHandler: [requireClientAuth, requireCustomerPermission(CustomerPermission.ACCOUNT_DELETE)],
      schema: { tags: ["Accounts"], summary: "Delete account" },
    },
    async (request, reply) => handler.deleteAccount(request, reply)
  );

  // Restore a soft-deleted account (admin-or-owner). One composed authn accepts
  // either token kind; the handler asserts the grant appropriate to whichever
  // one arrived, because a preHandler cannot branch on the principal kind.
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
