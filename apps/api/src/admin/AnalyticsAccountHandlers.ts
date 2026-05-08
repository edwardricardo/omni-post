/**
 * @file AnalyticsAccountHandlers.ts
 * @description Handles account management endpoints for administrators.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import type { PrismaClient } from "@infra/prisma";
import type { AuthenticatedUser } from "../auth/authService.js";
import { AccountIdParamsSchema, UpdateAccountBodySchema } from "./analyticsSchemas.js";

// Extend Fastify request type to include user
declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * Analytics Account Route Handler
 * Provides account update and management endpoints for administrators
 */
export class AnalyticsAccountHandler extends BaseRouteHandler {
  protected routeName = "analytics-account";

  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  /**
   * PUT /admin/accounts/:id
   * Update account settings
   */
  async updateAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Updating account settings");

    const paramsValidation = await this.validateParams(ctx, AccountIdParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid account ID");
    }

    const bodyValidation = await this.validateBody(ctx, UpdateAccountBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsValidation.value;
    const updates = bodyValidation.value;

    try {
      const existingAccount = await this.prisma.account.findUnique({
        where: { id },
      });

      if (!existingAccount) {
        return this.sendError(ctx, 404, "Account not found");
      }

      if (updates.email && updates.email !== existingAccount.email) {
        const emailExists = await this.prisma.account.findUnique({
          where: { email: updates.email },
        });

        if (emailExists) {
          return this.sendError(ctx, 409, "Email already in use");
        }
      }

      // Build update data with conditional spreading for optional fields
      const updateData: Record<string, unknown> = {};

      if (updates.name !== undefined) {
        updateData.name = updates.name;
      }

      if (updates.email !== undefined) {
        updateData.email = updates.email;
      }

      if (updates.maxProjects !== undefined) {
        updateData.maxProjects = updates.maxProjects;
      }

      if (updates.isOnTrial !== undefined) {
        updateData.isOnTrial = updates.isOnTrial;
      }

      if (updates.trialEndDate !== undefined) {
        updateData.trialEndDate = new Date(updates.trialEndDate);
      }

      if (updates.autoRenewal !== undefined) {
        updateData.autoRenewal = updates.autoRenewal;
      }

      if (updates.billingCycle !== undefined) {
        updateData.billingCycle = updates.billingCycle;
      }

      if (updates.stripeCustomerId !== undefined) {
        updateData.stripeCustomerId = updates.stripeCustomerId;
      }

      if (updates.stripeSubscriptionId !== undefined) {
        updateData.stripeSubscriptionId = updates.stripeSubscriptionId;
      }

      const updatedAccount = await this.prisma.account.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          maxProjects: true,
          isOnTrial: true,
          trialStartDate: true,
          trialEndDate: true,
          autoRenewal: true,
          billingCycle: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          projects: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Create audit log for account update
      if (request.auth?.user?.id) {
        await this.prisma.auditLog.create({
          data: {
            userId: request.auth.user.id,
            action: "UPDATE_ACCOUNT",
            resource: "Account",
            resourceId: id,
            details: {
              updatedFields: Object.keys(updateData),
              previousEmail: existingAccount.email,
              newEmail: updatedAccount.email,
            },
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
            success: true,
          },
        });
      }

      this.logInfo(ctx, "Account updated successfully", {
        accountId: id,
        updatedFields: Object.keys(updateData),
      });

      return this.sendSuccess(ctx, {
        id: updatedAccount.id,
        email: updatedAccount.email,
        name: updatedAccount.name,
        maxProjects: updatedAccount.maxProjects,
        isOnTrial: updatedAccount.isOnTrial,
        trialStartDate: updatedAccount.trialStartDate,
        trialEndDate: updatedAccount.trialEndDate,
        autoRenewal: updatedAccount.autoRenewal,
        billingCycle: updatedAccount.billingCycle,
        stripeCustomerId: updatedAccount.stripeCustomerId,
        stripeSubscriptionId: updatedAccount.stripeSubscriptionId,
        createdAt: updatedAccount.createdAt,
        updatedAt: updatedAccount.updatedAt,
        projects: updatedAccount.projects,
        message: "Account updated successfully",
      });
    } catch (error) {
      this.logError(ctx, "Failed to update account", { error });
      return this.sendError(ctx, 500, "Failed to update account");
    }
  }
}
