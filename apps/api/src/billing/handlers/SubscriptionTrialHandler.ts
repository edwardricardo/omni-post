/**
 * @file SubscriptionTrialHandler.ts
 * @description Route handler for trial lifecycle operations including start, end,
 *              convert to paid, and expiring trial queries.
 * @layer infrastructure
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../../lib/route-handler/index.js";
import type { SubscriptionService } from "@core/billing/index.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
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
    const startedByUserId = request.auth?.user?.id;

    const result = await this.subscriptionService.startTrial(
      {
        accountId,
        ...trialRequest,
      },
      startedByUserId
    );

    if (!result.ok) {
      if (result.error.code === USE_CASE_ERRORS.NOT_FOUND) {
        return this.sendError(ctx, 404, "Account not found");
      }
      if (result.error.code === USE_CASE_ERRORS.CONFLICT) {
        return this.sendError(ctx, 409, "Account is already on trial");
      }
      if (result.error.code === USE_CASE_ERRORS.VALIDATION_FAILED) {
        return this.sendError(ctx, 409, "Trial cannot be started for this account");
      }
      return this.sendError(ctx, 500, "Internal server error");
    }

    this.logInfo(ctx, "Started trial", {
      accountId,
      trialDays: trialRequest.trialDays,
    });
    return this.sendSuccess(ctx, {
      subscription: result.value,
      message: `${trialRequest.trialDays}-day trial started successfully`,
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
    const endedByUserId = request.auth?.user?.id;

    const result = await this.subscriptionService.endTrial(accountId, reason, endedByUserId);

    if (!result.ok) {
      if (result.error.code === USE_CASE_ERRORS.NOT_FOUND) {
        return this.sendError(ctx, 404, "Account not found");
      }
      if (result.error.code === USE_CASE_ERRORS.VALIDATION_FAILED) {
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
    const convertedByUserId = request.auth?.user?.id;

    const result = await this.subscriptionService.convertTrialToPaid(
      accountId,
      billingCycle,
      convertedByUserId
    );

    if (!result.ok) {
      if (result.error.code === USE_CASE_ERRORS.NOT_FOUND) {
        return this.sendError(ctx, 404, "Account not found");
      }
      if (result.error.code === USE_CASE_ERRORS.VALIDATION_FAILED) {
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

    try {
      const result = await this.subscriptionService.processAutoRenewals(
        request.auth?.user?.id ?? null
      );

      if (!result.ok) {
        return this.sendError(ctx, 500, "Failed to process auto-renewals");
      }

      const { processed, failed, details } = result.value;

      this.logInfo(ctx, "Processed auto-renewals", { processed, failed });
      return this.sendSuccess(ctx, {
        processed,
        failed,
        details,
        message: "Auto-renewals processed",
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      this.logError(ctx, "Auto-renewal processing error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Failed to process auto-renewals");
    }
  }

  async getTrialStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const stats = await this.subscriptionService.getTrialStats();

    this.logInfo(ctx, "Retrieved trial statistics", {
      totalTrials: stats.totalTrials,
      activeTrials: stats.activeTrials,
      conversionRate: stats.conversionRate,
    });

    return this.sendSuccess(ctx, {
      stats,
      timestamp: new Date().toISOString(),
    });
  }
}
