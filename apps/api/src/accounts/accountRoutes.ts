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

type _CreateAccountBody = z.infer<typeof CreateAccountBodySchema>;
type _UpdateAccountBody = z.infer<typeof UpdateAccountBodySchema>;

/**
 * Account Route Handler
 * Provides database-backed account management endpoints.
 * Receives PrismaClient via constructor injection from the route plugin.
 */
class AccountRouteHandler extends BaseRouteHandler {
  protected routeName = "accounts";

  constructor(private readonly prisma: PrismaClient) {
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
      // Check if account exists
      const existingAccount = await this.prisma.account.findUnique({
        where: { id: accountId },
        include: { projects: { select: { id: true } } },
      });

      if (!existingAccount) {
        return this.sendError(ctx, 404, "Account not found");
      }

      // Hard-delete child records that lack onDelete: Cascade in the schema.
      // Order matters: leaf FK references must be removed before their parents.
      const projectIds = existingAccount.projects.map((p: { id: string }) => p.id);
      if (projectIds.length > 0) {
        // 1. PostContent and PostMedia reference Post without onDelete: Cascade
        await this.prisma.postContent.deleteMany({
          where: { post: { projectId: { in: projectIds } } },
        });
        await this.prisma.postMedia.deleteMany({
          where: { post: { projectId: { in: projectIds } } },
        });

        // 2. Posts reference Project without onDelete: Cascade
        await this.prisma.post.deleteMany({
          where: { projectId: { in: projectIds } },
        });

        // 3. Channels reference Project without onDelete: Cascade
        await this.prisma.channel.deleteMany({
          where: { projectId: { in: projectIds } },
        });
      }

      // Delete account (remaining relations cascade from Account)
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
}

/**
 * Account Routes Plugin
 * Registers account management endpoints.
 * Resolves PrismaClient from the DI container.
 */
export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  const prisma = fastify.container.resolve<PrismaClient>(TOKENS.PrismaClient);

  const handler = new AccountRouteHandler(prisma);

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
};
