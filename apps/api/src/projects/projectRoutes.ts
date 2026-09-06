/**
 * @file projectRoutes.ts
 * @description REST API endpoints for database-backed project management including
 *              CRUD operations within accounts.
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
import { requireCustomerOrAdminAuth } from "../auth/customerOrAdminAuth.js";
import { CustomerPermission, requireCustomerPermission } from "../auth/customerRbacMiddleware.js";
import type { RbacService } from "../auth/rbacService.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { withSystemContext } from "../security/tenantContext.js";
import { toAdminActorId } from "@core/domain/value-objects/AdminActorId.js";
import type {
  DeleteProjectUseCase,
  HardDeleteProjectUseCase,
  RestoreProjectUseCase,
} from "@core/projects/index.js";
import { USE_CASE_ERRORS, type UseCaseError } from "@core/application/UseCase.js";
import type { Result } from "@shared/types";
import { mapHardDeleteError } from "../lib/hardDeleteErrorMapping.js";
import { AuditActions, AuditResources, type AuditService } from "../audit/auditService.js";

// Zod Schemas for Validation
const CreateProjectBodySchema = z.object({
  name: SecureSchemas.userName,
  locale: z.string().min(2).max(5).default("en"),
});

const AccountParamsSchema = z.object({
  accountId: IdSchema,
});

const ProjectIdParamsSchema = z.object({
  projectId: IdSchema,
});

/**
 * Body for the irreversible hard-delete endpoint. The reason is REQUIRED on both
 * arms: it is the only durable explanation of why a tenant's data was destroyed,
 * and it is written to the audit log alongside the acting principal.
 *
 * `confirmName` is optional HERE and mandatory on the customer arm, enforced in
 * the handler rather than the schema. One endpoint serves two callers with two
 * different confirmations available to them: a tenant purging its own project
 * has the project's name in front of it and must type it back, while an admin
 * erasing someone else's has no reason to know that name — demanding it would
 * only teach them to copy it off the same screen that gave them the id, which
 * confirms nothing. A schema cannot see which principal authenticated, so it
 * cannot express "required for one of them"; the handler can, and does.
 */
const HardDeleteProjectBodySchema = z.object({
  reason: z.string().min(8).max(500),
  confirmName: z.string().min(1).max(200).optional(),
});

type _CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

/**
 * Project Route Handler
 * Provides database-backed project management endpoints.
 * Receives PrismaClient, the project lifecycle use cases (soft delete, its
 * reversal, and the irreversible erasure), the RBAC service and the audit
 * service via constructor injection from the route plugin.
 */
class ProjectRouteHandler extends BaseRouteHandler {
  protected routeName = "projects";

  constructor(
    private readonly prisma: PrismaClient,
    private readonly deleteProjectUseCase: DeleteProjectUseCase,
    private readonly restoreProjectUseCase: RestoreProjectUseCase,
    private readonly hardDeleteProjectUseCase: HardDeleteProjectUseCase,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService
  ) {
    super();
  }

  /**
   * @method adminHoldsAccountManage
   * @description Answers whether the authenticated ADMIN principal on this request holds
   *   `account:manage`, using the same RbacService the `requirePermission` preHandler uses so the
   *   two cannot drift apart.
   *
   *   It exists as an in-handler check, rather than a preHandler, because the routes that need it
   *   are the "admin-or-owner" surfaces: their preHandler is the composed
   *   `requireCustomerOrAdminAuth`, and stacking `requirePermission` behind it would answer 401 to
   *   every customer — it reads `request.auth` / `request.user`, neither of which a customer token
   *   populates. So the grant is asserted inside the admin BRANCH, where the principal kind is
   *   already known.
   *
   *   Omitting it is not a smaller gate, it is no gate: an admin token by itself only proves the
   *   holder is staff, and every staff role — SUPPORT included — could otherwise reach across
   *   tenants through these endpoints.
   * @param request - The incoming request, whose `request.auth` carries the admin principal.
   * @returns True when the principal's role grants `account:manage`; false when it does not, and
   *   false when no admin principal is bound at all (fail closed).
   */
  private async adminHoldsAccountManage(request: FastifyRequest): Promise<boolean> {
    const role = request.auth?.user?.role;
    if (!role) {
      return false;
    }
    return this.rbacService.hasAnyPermission(role, [Permission.ACCOUNT_MANAGE]);
  }

  /**
   * Create Project for Account
   * POST /accounts/:accountId/projects
   */
  async createProject(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Creating project");

    // Validate params and body
    const validated = await this.validateRequest<{
      params: z.infer<typeof AccountParamsSchema>;
      body: z.infer<typeof CreateProjectBodySchema>;
    }>(ctx, {
      params: AccountParamsSchema,
      body: CreateProjectBodySchema,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request data");
    }

    const { accountId } = validated.value.params;
    const { name, locale } = validated.value.body;

    try {
      // Verify the account exists and read BOTH project populations.
      //
      // A deleted project still HOLDS its slot. That is the rule, and it is the
      // opposite of what this code used to do: quota counted only live rows, so
      // deleting a project handed the slot straight back. Since the delete is
      // soft and reversible, that made deletion a quota-farming move — delete,
      // create, restore, and a tenant on a 1-project plan ends up holding two.
      // The slot is released by the two acts that genuinely release the project:
      // restoring it (it becomes live and keeps the slot it never stopped
      // holding) or permanently erasing it (the row is gone, and so is the
      // claim).
      //
      // Two counts, because the 403 has to be actionable. The TOTAL decides, and
      // the LIVE number is what turns "quota exceeded" into "you have N slots and
      // K of them are held by projects you deleted" — without it the tenant sees
      // a limit they cannot reconcile with the list in front of them, which shows
      // only live projects.
      //
      // Prisma cannot alias two filtered `_count` selects over the same relation,
      // so the unfiltered relation count travels with the account read and the
      // live count is its own query.
      const account = await this.prisma.account.findFirst({
        where: { id: accountId, deletedAt: null },
        include: {
          _count: {
            select: { projects: true },
          },
        },
      });

      if (!account) {
        return this.sendError(ctx, 404, "Account not found");
      }

      const heldSlots = account._count.projects;
      const liveProjects = await this.prisma.project.count({
        where: { accountId, deletedAt: null },
      });
      const deletedHeld = heldSlots - liveProjects;

      if (heldSlots >= account.maxProjects) {
        return this.sendError(ctx, 403, "QUOTA_EXCEEDED", {
          error: "QUOTA_EXCEEDED",
          used: heldSlots,
          limit: account.maxProjects,
          deletedHeld,
          message:
            `${heldSlots} of ${account.maxProjects} project slots used` +
            (deletedHeld > 0
              ? `; ${deletedHeld} are held by deleted projects — restore them or ` +
                `permanently delete them to free space.`
              : "."),
        });
      }

      // Check if a LIVE project with the same name exists for this account.
      //
      // The unique behind this check is PARTIAL (`WHERE "deletedAt" IS NULL`):
      // soft-deleting "Marketing" must not confiscate the name for the rest of
      // the account's life. `findUnique` cannot express that predicate — its
      // selector is the compound key and nothing else — so it matched
      // soft-deleted rows and answered 409 for a name the database was willing
      // to accept. Once two soft-deleted rows share a name, which the schema
      // says is by design, that selector is not even unique any more, and a
      // `findUnique` whose selector matches two rows is a defect on its own.
      // `findFirst` filtered on `deletedAt: null` asks exactly the question the
      // constraint enforces, and the same one PrismaProjectRepository.findByName
      // already asks.
      //
      // `accountId` stays explicit: it comes from the path, it is the value the
      // create below writes, and the tenant guard injects only when the field is
      // ABSENT. Dropping it would silently rescope the check to the bearer's own
      // account, which is not necessarily the account being written to; keeping
      // it turns a disagreement between the two into a loud
      // TenantContextMismatchError — the same one the create already raises —
      // instead of a check that quietly asked about the wrong tenant.
      const existingProject = await this.prisma.project.findFirst({
        where: { accountId, name, deletedAt: null },
      });

      if (existingProject) {
        return this.sendError(ctx, 409, "NAME_TAKEN", { error: "NAME_TAKEN" });
      }

      // Create project
      const project = await this.prisma.project.create({
        data: {
          accountId,
          name,
          locale,
        },
      });

      this.logInfo(ctx, "Project created successfully", { projectId: project.id });

      this.sendSuccess(
        ctx,
        {
          id: project.id,
          accountId: project.accountId,
          name: project.name,
          locale: project.locale,
          createdAt: project.createdAt,
        },
        200
      );
    } catch (error) {
      this.logError(ctx, "Failed to create project", { error });
      return this.sendError(ctx, 500, "Failed to create project");
    }
  }

  /**
   * List Projects for Account
   * GET /accounts/:accountId/projects
   */
  async listProjects(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Listing projects");

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
      // Verify account exists
      const account = await this.prisma.account.findFirst({
        where: { id: accountId, deletedAt: null },
      });

      if (!account) {
        return this.sendError(ctx, 404, "Account not found");
      }

      // Live projects only — and this DELIBERATELY disagrees with the quota
      // count in `createProject`, which counts deleted rows too. Do not "unify"
      // them: the two answer different questions. The LIST shows what you HAVE,
      // so a project the tenant deleted must not reappear in it. The QUOTA counts
      // what you HOLD, so a deleted project keeps consuming its slot and deletion
      // cannot be used to farm quota. A reader who makes the list include deleted
      // rows resurrects them in the UI; one who makes the quota ignore them
      // reopens the farming path.
      const projects = await this.prisma.project.findMany({
        where: { accountId, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });

      this.logInfo(ctx, "Projects retrieved successfully", { count: projects.length });

      this.sendSuccess(ctx, projects);
    } catch (error) {
      this.logError(ctx, "Failed to list projects", { error });
      return this.sendError(ctx, 500, "Failed to list projects");
    }
  }

  /**
   * Get Project by ID
   * GET /projects/:projectId
   */
  async getProject(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Getting project");

    const validated = await this.validateRequest<{ params: z.infer<typeof ProjectIdParamsSchema> }>(
      ctx,
      { params: ProjectIdParamsSchema }
    );
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid project ID");
    }

    const { projectId } = validated.value.params;

    try {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
      });

      if (!project) {
        return this.sendError(ctx, 404, "Project not found");
      }

      this.logInfo(ctx, "Project retrieved successfully", { projectId });

      this.sendSuccess(ctx, {
        id: project.id,
        accountId: project.accountId,
        name: project.name,
        locale: project.locale,
        createdAt: project.createdAt,
      });
    } catch (error) {
      this.logError(ctx, "Failed to get project", { error });
      return this.sendError(ctx, 500, "Failed to get project");
    }
  }

  /**
   * Get Publish Logs for Project
   * GET /projects/:projectId/publish-logs
   */
  async getPublishLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Getting publish logs");

    const validated = await this.validateRequest<{ params: z.infer<typeof ProjectIdParamsSchema> }>(
      ctx,
      { params: ProjectIdParamsSchema }
    );
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid project ID");
    }

    const { projectId } = validated.value.params;

    try {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
      });

      if (!project) {
        return this.sendError(ctx, 404, "Project not found");
      }

      const publishLogs = await this.prisma.publishLog.findMany({
        where: { post: { projectId, deletedAt: null } },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      this.logInfo(ctx, "Publish logs retrieved", { count: publishLogs.length });

      this.sendSuccess(ctx, publishLogs);
    } catch (error) {
      this.logError(ctx, "Failed to get publish logs", { error });
      return this.sendError(ctx, 500, "Failed to get publish logs");
    }
  }

  /**
   * Delete Project (NORMAL path — reversible)
   * DELETE /projects/:projectId
   *
   * Soft-deletes: the row keeps its data and gains `deletedAt`, so the project
   * disappears from every read while its posts, channels and publish history
   * survive for audit. The irreversible variant is
   * `DELETE /projects/:projectId/hard` and is admin-only.
   */
  async deleteProject(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Deleting project");

    // Validate params
    const validated = await this.validateRequest<{ params: z.infer<typeof ProjectIdParamsSchema> }>(
      ctx,
      {
        params: ProjectIdParamsSchema,
      }
    );
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid project ID");
    }

    const { projectId } = validated.value.params;

    // Fail closed on the principal. `requireClientAuth` is the ONLY preHandler
    // on this route, so `request.customerUser` is the sole source of the caller
    // context the use case's ownership gate compares against; with no principal
    // we do not know who is asking and we delete nothing.
    const principal = request.customerUser;
    if (!principal) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    try {
      // Guarded existence check. `Project` IS enrolled in the Prisma tenant
      // guard, so under a customer request this read is scoped to the caller's
      // own tenant — a foreign id answers null here and 404s exactly like a
      // missing one (anti-enumeration). `deletedAt: null` keeps an already
      // soft-deleted project on the 404 arm; `findFirst` because `deletedAt` is
      // not part of any unique index.
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
      });

      if (!project) {
        return this.sendError(ctx, 404, "Project not found");
      }
    } catch (error) {
      this.logError(ctx, "Failed to delete project", { error });
      return this.sendError(ctx, 500, "Failed to delete project");
    }

    // The use case owns the ownership gate (CWE-639, re-checked against the
    // stored row below the guarded probe on purpose) and the transaction; this
    // handler translates its typed error code to a status and writes the audit
    // record. NOTHING destructive remains on this path: no leaf-first
    // deleteMany, no `project.delete` — the repository's `delete` sets
    // `deletedAt` and stops, so the project's posts and channels survive.
    const result = await this.deleteProjectUseCase.execute({
      projectId,
      caller: { type: "customer", accountId: principal.accountId },
    });

    if (!result.ok) {
      // NOT_FOUND covers "no such project", "already soft-deleted" and "not
      // yours" — the use case deliberately makes them indistinguishable
      // (anti-enumeration).
      if (result.error.code === USE_CASE_ERRORS.NOT_FOUND) {
        return this.sendError(ctx, 404, "Project not found");
      }
      if (result.error.code === USE_CASE_ERRORS.VALIDATION_FAILED) {
        return this.sendError(ctx, 400, "Invalid project ID");
      }
      this.logError(ctx, "Failed to delete project", { error: result.error });
      await this.auditService.log({
        action: AuditActions.PROJECT_DELETED,
        resource: AuditResources.PROJECT,
        resourceId: projectId,
        customerUserId: principal.id,
        accountId: principal.accountId,
        success: false,
        error: result.error.message,
        details: { mode: "soft" },
      });
      return this.sendError(ctx, 500, "Failed to delete project");
    }

    // Soft deletes write no tombstone (the row IS the record), so the audit
    // log is the only durable answer to "who deleted this" — attributed to the
    // CUSTOMER principal via its own FK, mirroring the hard path's admin entry.
    await this.auditService.log({
      action: AuditActions.PROJECT_DELETED,
      resource: AuditResources.PROJECT,
      resourceId: projectId,
      customerUserId: principal.id,
      accountId: principal.accountId,
      success: true,
      details: { mode: "soft" },
    });

    this.logInfo(ctx, "Project soft-deleted", { projectId });

    this.sendSuccess(ctx, { message: "Project deleted successfully" });
  }

  /**
   * Restore Project (reverse of the soft delete)
   * POST /projects/:projectId/restore
   *
   * Clears `deletedAt` so a soft-deleted project is visible again — the act that
   * makes the soft delete genuinely reversible rather than merely invisible.
   * Reachable by the OWNER (self-service undo) or by an admin (support
   * recovery) through the composed `requireCustomerOrAdminAuth`, so exactly one
   * of `request.customerUser` / `request.auth` is set when the handler runs:
   *   - customer: must hold the OWNER-only `account:delete` — the same grant as
   *     the delete this reverses, because a capability to undo a tenant-wide
   *     action is the same grade of authority as the action; then
   *     ownership-gated by the use case against the soft-deleted row's account.
   *   - admin: must hold `account:manage`, then runs under `withSystemContext`
   *     because `Project` is tenant-guard enrolled and admin auth binds no
   *     tenant scope.
   * NOT_FOUND covers "no such project", "not yours" and "hard-deleted" — the use
   * case makes them indistinguishable (anti-enumeration), mirroring the delete.
   */
  async restoreProject(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Restoring project");

    const params = ProjectIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return this.sendError(ctx, 400, "Invalid project ID");
    }
    const { projectId } = params.data;

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
        return this.sendError(ctx, 403, "Insufficient permissions to restore this project");
      }
      result = await this.restoreProjectUseCase.execute({
        projectId,
        caller: { type: "customer", accountId: customer.accountId },
      });
    } else if (admin) {
      // The admin grant, asserted BEFORE anything else on this arm. An admin
      // token alone only proves the holder is staff; this endpoint reaches across
      // every tenant, so without the capability check any staff role — SUPPORT
      // included — could restore any tenant's project.
      if (!(await this.adminHoldsAccountManage(request))) {
        return this.sendError(ctx, 403, "Insufficient permissions to restore this project");
      }

      // Fail closed on attribution, exactly as the hard-delete path does: the
      // branded id is the proof a real principal survived authentication, and a
      // privileged cross-tenant restore performed by nobody is not a restore we
      // are willing to run.
      const actor = toAdminActorId(admin.user?.id);
      if (!actor.ok) {
        this.logError(
          ctx,
          "Restore rejected: the admin branch was reached with no principal on request.auth"
        );
        return this.sendError(ctx, 500, "Failed to restore project");
      }

      // `Project` is tenant-guard enrolled and admin auth binds no tenant scope,
      // so the guarded reads and the restore write run under the sanctioned
      // bypass (mirrors the hard-delete path).
      result = await withSystemContext(`system:project-restore:${projectId}`, async () =>
        this.restoreProjectUseCase.execute({
          projectId,
          caller: { type: "admin", adminUserId: actor.value },
        })
      );
    } else {
      return this.sendError(ctx, 401, "Authentication required");
    }

    if (!result.ok) {
      if (result.error.code === USE_CASE_ERRORS.NOT_FOUND) {
        return this.sendError(ctx, 404, "Project not found");
      }
      if (result.error.code === USE_CASE_ERRORS.VALIDATION_FAILED) {
        return this.sendError(ctx, 400, "Invalid project ID");
      }
      if (result.error.code === USE_CASE_ERRORS.CONFLICT) {
        // The use-case message NAMES the blocker — the active project holding the
        // name, or the fact that this one is already live. Surfacing it verbatim
        // is what makes the 409 actionable: only a human can decide which of two
        // projects keeps a contested name, and they cannot decide it without
        // being told which project is in the way. It echoes the subject's own
        // account data back to a caller the use case has already gated, so it
        // discloses nothing they could not read elsewhere.
        return this.sendError(ctx, 409, result.error.message);
      }
      if (result.error.code === USE_CASE_ERRORS.FORBIDDEN) {
        return this.sendError(ctx, 403, "Restore refused");
      }
      this.logError(ctx, "Failed to restore project", { error: result.error });
      return this.sendError(ctx, 500, "Failed to restore project");
    }

    this.logInfo(ctx, "Project restored", { projectId });

    this.sendSuccess(ctx, { restored: true });
  }

  /**
   * Hard Delete Project (EXCEPTIONAL path — irreversible)
   * DELETE /projects/:projectId/hard
   *
   * Destroys the project and every row that references it. Two callers reach it
   * through the composed `requireCustomerOrAdminAuth`:
   *   - admin: `account:manage`, then the sanctioned `withSystemContext` bypass,
   *     because admin auth binds no tenant scope and the cascade writes to
   *     tenant-guard-enrolled tables.
   *   - customer self-purge: `account:delete` plus a `confirmName` that must be
   *     the project's exact name. It runs WITHOUT `withSystemContext` on
   *     purpose — the composed middleware already bound this tenant's context,
   *     and wrapping a self-purge in a cross-tenant bypass would hand it reach it
   *     has no need for, discarding the guard on the one path a non-staff caller
   *     can destroy data through.
   *
   * Guard rails shared by both: a mandatory written reason, the prior-soft-delete
   * interlock in the use case, one transaction for the whole cascade
   * (repository), and an audit record on success and failure alike.
   */
  async hardDeleteProject(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Hard deleting project");

    const params = ProjectIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return this.sendError(ctx, 400, "Invalid project ID");
    }
    const body = HardDeleteProjectBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return this.sendError(ctx, 400, "A reason of at least 8 characters is required");
    }

    const { projectId } = params.data;
    const { reason, confirmName } = body.data;

    const customer = request.customerUser;
    const admin = request.auth;

    // How the audit record names whoever destroyed this. The two FKs are
    // mutually exclusive by a database CHECK — a row may carry the admin arc or
    // the customer arc, never both — so the arm that runs the erasure also
    // decides the attribution, and the single `auditService.log` pair below
    // spreads whichever it chose. Building it here rather than duplicating the
    // audit calls per arm is what stops the two paths from drifting into
    // recording different things about the same event.
    let attribution: { userId: string } | { customerUserId: string; accountId: string };
    let result: Result<void, UseCaseError>;

    if (customer) {
      // Fail closed on the claim itself — see the identical reasoning on the
      // restore path. An absent `permissions` claim holds nothing.
      const { permissions } = customer;
      if (!Array.isArray(permissions) || !permissions.includes(CustomerPermission.ACCOUNT_DELETE)) {
        return this.sendError(ctx, 403, "Insufficient permissions to erase this project");
      }

      // The typed confirmation is what separates a self-purge from a misclick on
      // a row in a list. It is required HERE rather than in the schema because
      // only this branch knows a customer is asking; the use case then compares
      // it against the stored name, which is the only place the authoritative
      // value exists.
      if (confirmName === undefined) {
        return this.sendError(
          ctx,
          400,
          "confirmName is required: type the project's exact name to confirm an irreversible erasure"
        );
      }

      // Fail closed on attribution, as on the admin arm. The brand encodes
      // "a validated, non-empty principal"; the VALUE is the customer, so the
      // tombstone says truthfully who destroyed the data.
      const principal = toAdminActorId(customer.id);
      if (!principal.ok) {
        this.logError(
          ctx,
          "Hard delete rejected: the customer branch was reached with no principal id"
        );
        return this.sendError(ctx, 500, "Failed to hard delete project");
      }

      attribution = { customerUserId: customer.id, accountId: customer.accountId };
      // NO `withSystemContext` here, deliberately. The composed middleware
      // already bound THIS tenant's context, so every guarded read and write in
      // the cascade runs scoped to the caller's own account — which is precisely
      // the protection a self-purge should keep. Wrapping it in the cross-tenant
      // bypass would disable the tenant guard on the one destructive path a
      // non-staff caller can reach, so a defect anywhere below it would escape
      // the tenant instead of being refused.
      result = await this.hardDeleteProjectUseCase.execute({
        projectId,
        caller: {
          type: "customer",
          accountId: customer.accountId,
          customerUserId: principal.value,
          reason,
          expectedName: confirmName,
        },
      });
    } else if (admin) {
      // The admin grant, asserted before anything is read or destroyed: an admin
      // token alone only proves the holder is staff, and this arm erases across
      // every tenant.
      if (!(await this.adminHoldsAccountManage(request))) {
        return this.sendError(ctx, 403, "Insufficient permissions to erase this project");
      }

      // Fail closed on attribution. Reading `request.auth` (not the phantom
      // `request.adminUser` nobody sets) is what names the admin on the tombstone
      // and the audit record. A branded, non-empty id — no `"unknown"` fallback:
      // if no principal survived authentication we do not know who is erasing a
      // tenant's data, so we destroy nothing and surface a 500 (an
      // internal-invariant violation, not the caller's fault).
      const actor = toAdminActorId(admin.user?.id);
      if (!actor.ok) {
        this.logError(
          ctx,
          "Hard delete rejected: the admin branch was reached with no principal on request.auth"
        );
        return this.sendError(ctx, 500, "Failed to hard delete project");
      }

      attribution = { userId: actor.value };
      // Admin auth binds NO tenant context, but `Project` (and the `Channel`,
      // `Template`, `SchedulingRule`, ... rows the cascade removes) are
      // tenant-guard enrolled, so the guarded writes inside hardDelete would throw
      // TenantContextMissingError. This is a legitimate cross-tenant admin
      // operation, so run it under the sanctioned `withSystemContext` bypass
      // (mirrors the channel hard-delete path).
      result = await withSystemContext(`system:project-hard-delete:${projectId}`, async () =>
        this.hardDeleteProjectUseCase.execute({
          projectId,
          caller: {
            type: "admin",
            adminUserId: actor.value,
            reason,
          },
        })
      );
    } else {
      return this.sendError(ctx, 401, "Authentication required");
    }

    if (!result.ok) {
      await this.auditService.log({
        action: AuditActions.PROJECT_DELETED,
        resource: AuditResources.PROJECT,
        resourceId: projectId,
        ...attribution,
        success: false,
        error: result.error.message,
        details: { mode: "hard", reason },
      });
      const { status, message } = mapHardDeleteError(
        result.error.code,
        result.error.message,
        "project"
      );
      return this.sendError(ctx, status, message);
    }

    await this.auditService.log({
      action: AuditActions.PROJECT_DELETED,
      resource: AuditResources.PROJECT,
      resourceId: projectId,
      ...attribution,
      success: true,
      details: { mode: "hard", reason },
    });

    this.logInfo(ctx, "Project hard-deleted", { projectId });

    this.sendSuccess(ctx, { deleted: true });
  }
}

/**
 * Project Routes Plugin
 * Registers project management endpoints.
 * Resolves PrismaClient from the DI container.
 */
export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  const prisma = fastify.container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const deleteProjectUseCase = fastify.container.resolve<DeleteProjectUseCase>(
    TOKENS.DeleteProjectUseCase
  );
  const restoreProjectUseCase = fastify.container.resolve<RestoreProjectUseCase>(
    TOKENS.RestoreProjectUseCase
  );
  const hardDeleteProjectUseCase = fastify.container.resolve<HardDeleteProjectUseCase>(
    TOKENS.HardDeleteProjectUseCase
  );
  const rbacService = fastify.container.resolve<RbacService>(TOKENS.RbacService);
  const auditService = fastify.container.resolve<AuditService>(TOKENS.AuditService);

  const handler = new ProjectRouteHandler(
    prisma,
    deleteProjectUseCase,
    restoreProjectUseCase,
    hardDeleteProjectUseCase,
    rbacService,
    auditService
  );

  // Create project for account
  fastify.post(
    "/accounts/:accountId/projects",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Projects"], summary: "Create project for account" },
    },
    async (request, reply) => handler.createProject(request, reply)
  );

  // List projects for account
  fastify.get(
    "/accounts/:accountId/projects",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Projects"], summary: "List projects for account" },
    },
    async (request, reply) => handler.listProjects(request, reply)
  );

  // Get project by ID
  fastify.get(
    "/projects/:projectId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Projects"], summary: "Get project by ID" },
    },
    async (request, reply) => handler.getProject(request, reply)
  );

  // Get publish logs for project
  fastify.get(
    "/projects/:projectId/publish-logs",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Projects"], summary: "Get publish logs for project" },
    },
    async (request, reply) => handler.getPublishLogs(request, reply)
  );

  // Delete project (soft, reversible). The OWNER-only `account:delete` grant is
  // asserted in a preHandler rather than inside the handler, so the account and
  // project surfaces share ONE enforcement point instead of two hand-written
  // membership tests that can disagree. Ownership is still decided below it, by
  // the use case, and still answers 404 — the grant check is about capability
  // and is keyed on the CALLER alone, so its 403 reveals nothing about which
  // projects exist.
  fastify.delete(
    "/projects/:projectId",
    {
      preHandler: [requireClientAuth, requireCustomerPermission(CustomerPermission.ACCOUNT_DELETE)],
      schema: { tags: ["Projects"], summary: "Delete project" },
    },
    async (request, reply) => handler.deleteProject(request, reply)
  );

  // Restore a soft-deleted project (admin-or-owner). One composed authn accepts
  // either token kind; the handler asserts the grant appropriate to whichever
  // one arrived, because a preHandler cannot branch on the principal kind.
  fastify.post(
    "/projects/:projectId/restore",
    {
      preHandler: [requireCustomerOrAdminAuth],
      schema: { tags: ["Projects"], summary: "Restore a soft-deleted project" },
    },
    async (request, reply) => handler.restoreProject(request, reply)
  );

  // Hard-delete project (irreversible). Admin erasure OR owner self-purge — the
  // grant, the confirmation and the tenant-scope decision are all made per arm
  // inside the handler.
  fastify.delete(
    "/projects/:projectId/hard",
    {
      preHandler: [requireCustomerOrAdminAuth],
      schema: {
        tags: ["Projects"],
        summary: "Hard-delete a project permanently (admin erasure or owner self-purge)",
      },
    },
    async (request, reply) => handler.hardDeleteProject(request, reply)
  );
};
