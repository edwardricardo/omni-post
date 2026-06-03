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

// Zod Schemas for Validation
const CreateProjectBodySchema = z.object({
  name: SecureSchemas.userName,
  locale: z.string().min(2).max(5).default("en"),
});

const AccountParamsSchema = z.object({
  accountId: IdSchema,
});

type _CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

/**
 * Project Route Handler
 * Provides database-backed project management endpoints.
 * Receives PrismaClient via constructor injection from the route plugin.
 */
class ProjectRouteHandler extends BaseRouteHandler {
  protected routeName = "projects";

  constructor(private readonly prisma: PrismaClient) {
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

    const ProjectIdParamsSchema = z.object({
      projectId: IdSchema,
    });

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

    const ProjectIdParamsSchema = z.object({
      projectId: IdSchema,
    });

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
    const ProjectIdParamsSchema = z.object({
      projectId: IdSchema,
    });

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

      // Hard-delete all child records that lack onDelete: Cascade in the schema.
      // Order matters: leaf FK references must be removed before their parents.

      // 1. PostContent and PostMedia reference Post without onDelete: Cascade
      await this.prisma.postContent.deleteMany({
        where: { post: { projectId } },
      });
      await this.prisma.postMedia.deleteMany({
        where: { post: { projectId } },
      });

      // 2. Posts reference Project without onDelete: Cascade
      //    (Thread, ContentVersion, Analytics cascade; PublishLog, WebhookEvent set null)
      await this.prisma.post.deleteMany({
        where: { projectId },
      });

      // 3. Channels reference Project without onDelete: Cascade
      await this.prisma.channel.deleteMany({
        where: { projectId },
      });

      // 4. Delete the project itself (remaining relations cascade or set null)
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
}

/**
 * Project Routes Plugin
 * Registers project management endpoints.
 * Resolves PrismaClient from the DI container.
 */
export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  const prisma = fastify.container.resolve<PrismaClient>(TOKENS.PrismaClient);

  const handler = new ProjectRouteHandler(prisma);

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
};
