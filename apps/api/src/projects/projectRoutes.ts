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
import type { HardDeleteProjectUseCase } from "@core/projects/index.js";
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
 * Receives PrismaClient and the admin-only hard-delete use case via constructor
 * injection from the route plugin.
 */
class ProjectRouteHandler extends BaseRouteHandler {
  protected routeName = "projects";

  constructor(
    private readonly prisma: PrismaClient,
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
      // Verify account exists and get current project count
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
        include: {
          _count: {
            select: { projects: true },
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

      // Check if project with same name exists for this account
      const existingProject = await this.prisma.project.findUnique({
        where: {
          accountId_name: {
            accountId,
            name,
          },
        },
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
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        return this.sendError(ctx, 404, "Account not found");
      }

      // Get projects
      const projects = await this.prisma.project.findMany({
        where: { accountId },
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
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
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
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });

      if (!project) {
        return this.sendError(ctx, 404, "Project not found");
      }

      const publishLogs = await this.prisma.publishLog.findMany({
        where: { post: { projectId } },
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
   * Delete Project
   * DELETE /projects/:projectId
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

    try {
      // Verify project exists
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        return this.sendError(ctx, 404, "Project not found");
      }

      // Explicit leaf-first deletes. Since the ON DELETE convention landed these
      // are REDUNDANT — `Post.projectId` and `Channel.projectId` are ON DELETE
      // CASCADE, and `PostContent.postId` / `PostMedia.postId` cascade from Post —
      // so the final `project.delete` alone would remove all four. They are kept
      // because they bound the work into named statements instead of one opaque
      // server-side cascade, and because deleting them is a behaviour change this
      // slice has no test for. What they are NOT any more is load-bearing.
      await this.prisma.postContent.deleteMany({
        where: { post: { projectId } },
      });
      await this.prisma.postMedia.deleteMany({
        where: { post: { projectId } },
      });

      await this.prisma.post.deleteMany({
        where: { projectId },
      });

      await this.prisma.channel.deleteMany({
        where: { projectId },
      });

      // Deleting the project cascades to Post and Channel and everything under
      // them; ContentTemplate, WebhookEvent, MediaAsset, Task and CustomReport
      // survive with `projectId` nulled. Analytics survive too, detached from the
      // posts that went with it.
      await this.prisma.project.delete({
        where: { id: projectId },
      });

      this.logInfo(ctx, "Project deleted successfully", { projectId });

      this.sendSuccess(ctx, { message: "Project deleted successfully" });
    } catch (error) {
      this.logError(ctx, "Failed to delete project", { error });
      return this.sendError(ctx, 500, "Failed to delete project");
    }
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
  const hardDeleteProjectUseCase = fastify.container.resolve<HardDeleteProjectUseCase>(
    TOKENS.HardDeleteProjectUseCase
  );
  const auditService = fastify.container.resolve<AuditService>(TOKENS.AuditService);

  const handler = new ProjectRouteHandler(prisma, hardDeleteProjectUseCase, auditService);

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
