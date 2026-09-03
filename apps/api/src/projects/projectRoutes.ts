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
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { requireCustomerPermission, CustomerPermission } from "../auth/customerRbacMiddleware.js";
import { requireCustomerOrAdminAuth } from "../auth/customerOrAdminAuth.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { withSystemContext } from "../security/tenantContext.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { toAdminActorId } from "@core/domain/value-objects/AdminActorId.js";
import type {
  DeleteProjectUseCase,
  HardDeleteProjectUseCase,
  RestoreProjectUseCase,
} from "@core/projects/index.js";
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
 * Body for the irreversible hard-delete endpoint. The reason is REQUIRED: it is
 * the only durable explanation of why a tenant's data was destroyed, and it is
 * written to the audit log alongside the acting admin.
 */
const HardDeleteProjectBodySchema = z.object({
  reason: z.string().min(8).max(500),
});

type _CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

/**
 * Project Route Handler
 * Provides database-backed project management endpoints.
 * Receives PrismaClient and the project lifecycle use cases via constructor
 * injection from the route plugin.
 */
class ProjectRouteHandler extends BaseRouteHandler {
  protected routeName = "projects";

  constructor(
    private readonly prisma: PrismaClient,
    private readonly deleteProjectUseCase: DeleteProjectUseCase,
    private readonly hardDeleteProjectUseCase: HardDeleteProjectUseCase,
    private readonly restoreProjectUseCase: RestoreProjectUseCase,
    private readonly auditService: AuditService
  ) {
    super();
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
      // Verify account exists and get current project count. Soft-deleted
      // projects do NOT consume quota — they are invisible to every read, so
      // counting them would strand the tenant below its own limit forever.
      const account = await this.prisma.account.findFirst({
        where: { id: accountId, deletedAt: null },
        include: {
          _count: {
            select: { projects: { where: { deletedAt: null } } },
          },
        },
      });

      if (!account) {
        return this.sendError(ctx, 404, "Account not found");
      }

      // Check quota limits
      if (account._count.projects >= account.maxProjects) {
        return this.sendError(ctx, 403, "QUOTA_EXCEEDED", { error: "QUOTA_EXCEEDED" });
      }

      // Check if an ACTIVE project with the same name exists for this account.
      // `findFirst` with the `deletedAt` filter, never `findUnique` on the
      // compound key: that key is unique only WHERE `deletedAt IS NULL`, so a
      // lookup ignoring the filter answers for rows this product cannot show and
      // would refuse the name on behalf of a project the user already deleted.
      const existingProject = await this.prisma.project.findFirst({
        where: { accountId, name, deletedAt: null },
        select: { id: true },
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

      // Get projects. `deletedAt: null` is what makes the soft delete a delete
      // from the caller's point of view — without it the route would keep
      // serving rows the tenant has already removed.
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
   * disappears from every read while posts, channels and their publish history
   * survive for audit. This is H12 (Soft Delete Universal). The irreversible
   * variant is `DELETE /projects/:projectId/hard` and is admin-only.
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

    const customer = request.customerUser;
    if (!customer) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    // The use case owns the ownership gate (CWE-639) and the transaction; this
    // handler only translates its typed error code to a status.
    const result = await this.deleteProjectUseCase.execute({
      projectId,
      caller: { type: "customer", accountId: customer.accountId },
    });

    if (!result.ok) {
      // NOT_FOUND covers both "no such project" and "not yours" — the use case
      // deliberately makes them indistinguishable (anti-enumeration).
      if (result.error.code === USE_CASE_ERRORS.NOT_FOUND) {
        return this.sendError(ctx, 404, "Project not found");
      }
      if (result.error.code === USE_CASE_ERRORS.VALIDATION_FAILED) {
        return this.sendError(ctx, 400, "Invalid project ID");
      }
      this.logError(ctx, "Failed to delete project", { error: result.error });
      return this.sendError(ctx, 500, "Failed to delete project");
    }

    this.logInfo(ctx, "Project soft-deleted", { projectId });

    this.sendSuccess(ctx, { message: "Project deleted successfully" });
  }

  /**
   * Restore Project (reverse of the soft delete)
   * POST /projects/:projectId/restore
   *
   * Clears `deletedAt` so a soft-deleted project is visible again. Reachable by
   * the OWNER (self-service undo) OR by an admin (support recovery) — the
   * "admin-or-owner" surface via the composed `requireCustomerOrAdminAuth`, so
   * exactly one of `request.customerUser` / `request.auth` is set here:
   *   - customer: must hold the OWNER-only `account:delete` permission (same gate
   *     as the delete it reverses); ownership-gated by the use case against the
   *     soft-deleted row's stored account.
   *   - admin: runs under `withSystemContext`, because `Project` is tenant-guard
   *     enrolled and admin auth binds no tenant scope; skips the ownership gate.
   * NOT_FOUND covers "no such project", "already active" and "not yours" — the
   * use case makes them indistinguishable (anti-enumeration), mirroring delete.
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

    let result;
    if (customer) {
      // The owner-level gate, same permission as the delete this reverses.
      if (!customer.permissions.includes(CustomerPermission.ACCOUNT_DELETE)) {
        return this.sendError(ctx, 403, "PERMISSION_DENIED", {
          error: { code: "PERMISSION_DENIED", message: "Required permission: account:delete" },
        });
      }
      result = await this.restoreProjectUseCase.execute({
        projectId,
        caller: { type: "customer", accountId: customer.accountId },
      });
    } else if (admin) {
      // Project IS tenant-guard enrolled; admin auth binds no tenant context, so
      // the guarded findByIdIncludingDeleted / restore run under the sanctioned
      // withSystemContext bypass (mirrors the hard-delete path).
      result = await withSystemContext(`system:project-restore:${projectId}`, async () =>
        this.restoreProjectUseCase.execute({
          projectId,
          caller: { type: "admin", adminUserId: admin.user.id },
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
   * Destroys the project and every row that references it. Guard rails, all of
   * them load-bearing: admin authentication plus `account:manage`, a mandatory
   * written reason, one transaction for the whole cascade (repository), an audit
   * record on both success and failure, and the sanctioned `withSystemContext`
   * bypass rather than an ambient tenant context.
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
      return this.sendError(ctx, 500, "Failed to hard delete project");
    }
    const adminUserId = actor.value;

    // Admin auth binds NO tenant context, but `Project` (and the `Channel`,
    // `Template`, `SchedulingRule`, ... rows the cascade removes) are
    // tenant-guard enrolled, so the guarded writes inside hardDelete would throw
    // TenantContextMissingError. This is a legitimate cross-tenant admin
    // operation, so run it under the sanctioned `withSystemContext` bypass
    // (mirrors the channel hard-delete path).
    const result = await withSystemContext(`system:project-hard-delete:${projectId}`, async () =>
      this.hardDeleteProjectUseCase.execute({
        projectId,
        caller: {
          type: "admin",
          adminUserId,
          reason,
        },
      })
    );

    if (!result.ok) {
      await this.auditService.log({
        action: AuditActions.PROJECT_DELETED,
        resource: AuditResources.PROJECT,
        resourceId: projectId,
        userId: adminUserId,
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
      userId: adminUserId,
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
  const hardDeleteProjectUseCase = fastify.container.resolve<HardDeleteProjectUseCase>(
    TOKENS.HardDeleteProjectUseCase
  );
  const restoreProjectUseCase = fastify.container.resolve<RestoreProjectUseCase>(
    TOKENS.RestoreProjectUseCase
  );
  const auditService = fastify.container.resolve<AuditService>(TOKENS.AuditService);

  const handler = new ProjectRouteHandler(
    prisma,
    deleteProjectUseCase,
    hardDeleteProjectUseCase,
    restoreProjectUseCase,
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

  // Soft-delete project (normal path). Gated on the OWNER-only `account:delete`
  // permission (D-RESTORE / F5): before this gate, ANY authenticated customer —
  // MEMBER, VIEWER — could soft-delete an account-owned project.
  fastify.delete(
    "/projects/:projectId",
    {
      preHandler: [requireClientAuth, requireCustomerPermission(CustomerPermission.ACCOUNT_DELETE)],
      schema: { tags: ["Projects"], summary: "Soft-delete a project" },
    },
    async (request, reply) => handler.deleteProject(request, reply)
  );

  // Restore a soft-deleted project (admin-or-owner). One composed authn accepts
  // either a customer (owner) token or an admin token.
  fastify.post(
    "/projects/:projectId/restore",
    {
      preHandler: [requireCustomerOrAdminAuth],
      schema: { tags: ["Projects"], summary: "Restore a soft-deleted project" },
    },
    async (request, reply) => handler.restoreProject(request, reply)
  );

  // Hard-delete project (irreversible, admin only)
  fastify.delete(
    "/projects/:projectId/hard",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Projects"], summary: "Hard-delete a project permanently" },
    },
    async (request, reply) => handler.hardDeleteProject(request, reply)
  );
};
