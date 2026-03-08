/**
 * Subscription Trial Handler
 *
 * Handles trial-related routes.
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { SubscriptionService } from "../subscription/index.js";
import {
  ParamsWithAccountIdSchema,
  StartTrialSchema,
  EndTrialSchema,
  ConvertTrialSchema,
  ExpiringTrialsQuerySchema,
} from "../subscriptionSchemas.js";

export class SubscriptionTrialHandler extends BaseRouteHandler {
  protected routeName = "subscription-trial";

  constructor(private readonly subscriptionService: SubscriptionService) {
    super();
  }

  async startTrial(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      params: z.infer<typeof ParamsWithAccountIdSchema>;
      body: z.infer<typeof StartTrialSchema>;
    }>(ctx, {
      params: ParamsWithAccountIdSchema,
      body: StartTrialSchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request parameters");
    }

    const { accountId } = validated.value.params;
    const trialRequest = validated.value.body;
    const startedByUserId = request.user?.id;

    const result = await this.subscriptionService.startTrial(
      {
        accountId,
        ...trialRequest,
      },
      startedByUserId
    );

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return this.sendError(ctx, 404, "Account not found");
      }
      if (result.error === "ALREADY_ON_TRIAL") {
        return this.sendError(ctx, 409, "Account is already on trial");
      }
      if (result.error === "TRIAL_EXPIRED") {
        return this.sendError(ctx, 409, "Trial has already expired for this account");
      }
      return this.sendError(ctx, 500, "Internal server error");
    }

    this.logInfo(ctx, "Started trial", {
      accountId,
      trialDurationDays: trialRequest.trialDurationDays,
    });
    return this.sendSuccess(ctx, {
      subscription: result.value,
      message: `${trialRequest.trialDurationDays}-day trial started successfully`,
      timestamp: new Date().toISOString(),
    });
  }

  async endTrial(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      params: z.infer<typeof ParamsWithAccountIdSchema>;
      body: z.infer<typeof EndTrialSchema>;
    }>(ctx, {
      params: ParamsWithAccountIdSchema,
      body: EndTrialSchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request parameters");
    }

    const { accountId } = validated.value.params;
    const { reason } = validated.value.body;
    const endedByUserId = request.user?.id;

    const result = await this.subscriptionService.endTrial(accountId, reason, endedByUserId);

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return this.sendError(ctx, 404, "Account not found");
      }
      if (result.error === "NOT_ON_TRIAL") {
        return this.sendError(ctx, 409, "Account is not on trial");
      }
      return this.sendError(ctx, 500, "Internal server error");
    }

    this.logInfo(ctx, "Ended trial", { accountId, reason });
    return this.sendSuccess(ctx, {
      subscription: result.value,
      message: "Trial ended successfully",
      timestamp: new Date().toISOString(),
    });
  }

  async convertTrial(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      params: z.infer<typeof ParamsWithAccountIdSchema>;
      body: z.infer<typeof ConvertTrialSchema>;
    }>(ctx, {
      params: ParamsWithAccountIdSchema,
      body: ConvertTrialSchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request parameters");
    }

    const { accountId } = validated.value.params;
    const { billingCycle } = validated.value.body;
    const convertedByUserId = request.user?.id;

    const result = await this.subscriptionService.convertTrialToPaid(
      accountId,
      billingCycle,
      convertedByUserId
    );

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return this.sendError(ctx, 404, "Account not found");
      }
      if (result.error === "NOT_ON_TRIAL") {
        return this.sendError(ctx, 409, "Account is not on trial");
      }
      return this.sendError(ctx, 500, "Internal server error");
    }

    this.logInfo(ctx, "Converted trial", { accountId, billingCycle });
    return this.sendSuccess(ctx, {
      subscription: result.value,
      message: "Trial converted to paid subscription successfully",
      timestamp: new Date().toISOString(),
    });
  }

  async getExpiringTrials(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      query: z.infer<typeof ExpiringTrialsQuerySchema>;
    }>(ctx, {
      query: ExpiringTrialsQuerySchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { days } = validated.value.query;
    const result = await this.subscriptionService.getExpiringTrials(days);

    if (!result.ok) {
      return this.sendError(ctx, 500, "Internal server error");
    }

    this.logInfo(ctx, "Retrieved expiring trials", { days, count: result.value.length });
    return this.sendSuccess(ctx, {
      trials: result.value,
      count: result.value.length,
      daysUntilExpiration: days,
      timestamp: new Date().toISOString(),
    });
  }

  async processAutoRenewals(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const result = await this.subscriptionService.processAutoRenewals();

    if (!result.ok) {
      return this.sendError(ctx, 500, "Failed to process auto-renewals");
    }

    this.logInfo(ctx, "Processed auto-renewals", {
      processed: result.value.processed,
      failed: result.value.failed,
    });
    return this.sendSuccess(ctx, {
      processed: result.value.processed,
      failed: result.value.failed,
      message: "Auto-renewals processed",
      timestamp: new Date().toISOString(),
    });
  }

  async getTrialStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const { prisma } = await import("@infra/prisma");
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalTrials, activeTrials, expiredTrials, convertedTrials, trialsStartedThisMonth] =
      await Promise.all([
        prisma.account.count({
          where: { isOnTrial: true },
        }),
        prisma.account.count({
          where: {
            isOnTrial: true,
            trialEndDate: { gte: now },
          },
        }),
        prisma.account.count({
          where: {
            isOnTrial: true,
            trialEndDate: { lt: now },
          },
        }),
        prisma.account.count({
          where: {
            isOnTrial: false,
            trialEndDate: { not: null },
          },
        }),
        prisma.account.count({
          where: {
            trialStartDate: { gte: thirtyDaysAgo },
          },
        }),
      ]);

    const conversionRate =
      totalTrials > 0 ? Math.round((convertedTrials / (totalTrials + convertedTrials)) * 100) : 0;

    this.logInfo(ctx, "Retrieved trial statistics", {
      totalTrials,
      activeTrials,
      conversionRate,
    });

    return this.sendSuccess(ctx, {
      stats: {
        totalTrials,
        activeTrials,
        expiredTrials,
        convertedTrials,
        trialsStartedThisMonth,
        conversionRate,
        expiringIn24Hours: 0,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
