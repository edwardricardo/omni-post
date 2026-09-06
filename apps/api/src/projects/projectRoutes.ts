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
import { Permission } from "@core/domain/auth/Permission.js";
import { withSystemContext } from "../security/tenantContext.js";
import { toAdminActorId } from "@core/domain/value-objects/AdminActorId.js";
import type { DeleteProjectUseCase, HardDeleteProjectUseCase } from "@core/projects/index.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
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
 * Receives PrismaClient, the customer-facing soft-delete use case and the
 * admin-only hard-delete use case via constructor injection from the route
 * plugin.
 */
class ProjectRouteHandler extends BaseRouteHandler {
  protected routeName = "projects";

  constructor(
    private readonly prisma: PrismaClient,
    private readonly deleteProjectUseCase: DeleteProjectUseCase,
    private readonly hardDeleteProjectUseCase: HardDeleteProjectUseCase,
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

      // Get projects
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
  const auditService = fastify.container.resolve<AuditService>(TOKENS.AuditService);

  const handler = new ProjectRouteHandler(
    prisma,
    deleteProjectUseCase,
    hardDeleteProjectUseCase,
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

  // Delete project
  fastify.delete(
    "/projects/:projectId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Projects"], summary: "Delete project" },
    },
    async (request, reply) => handler.deleteProject(request, reply)
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
