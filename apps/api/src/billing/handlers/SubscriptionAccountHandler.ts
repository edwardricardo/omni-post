/**
 * Subscription Account Handler
 *
 * Handles account subscription management routes.
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { SubscriptionService } from "../subscription/index.js";
import type { ChangeAccountSubscriptionUseCase } from "../../application/billing/ChangeAccountSubscriptionUseCase.js";
import { removeUndefinedProperties } from "../../utils/typeUtils.js";
import {
  ParamsWithAccountIdSchema,
  ChangeSubscriptionSchema,
  SubscriptionFiltersSchema,
  ValidateLimitsSchema,
  SuspendSubscriptionSchema,
  BulkUpgradeSchema,
} from "../subscriptionSchemas.js";

export class SubscriptionAccountHandler extends BaseRouteHandler {
  protected routeName = "subscription-account";

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly changeSubscriptionUseCase: ChangeAccountSubscriptionUseCase
  ) {
    super();
  }

  async getAccountSubscription(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      params: z.infer<typeof ParamsWithAccountIdSchema>;
    }>(ctx, {
      params: ParamsWithAccountIdSchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid account ID");
    }

    const { accountId } = validated.value.params;
    const result = await this.subscriptionService.getAccountSubscription(accountId);

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return this.sendError(ctx, 404, "Account not found");
      }
      return this.sendError(ctx, 500, "Internal server error");
    }

    this.logInfo(ctx, "Retrieved account subscription", { accountId });
    return this.sendSuccess(ctx, {
      subscription: result.value,
      timestamp: new Date().toISOString(),
    });
  }

  async updateAccountSubscription(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      params: z.infer<typeof ParamsWithAccountIdSchema>;
      body: z.infer<typeof ChangeSubscriptionSchema>;
    }>(ctx, {
      params: ParamsWithAccountIdSchema,
      body: ChangeSubscriptionSchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request parameters");
    }

    const { accountId } = validated.value.params;
    const changeRequest = validated.value.body;

    const result = await this.changeSubscriptionUseCase.execute({
      accountId,
      ...(changeRequest.bundleId !== undefined && { bundleId: changeRequest.bundleId }),
      ...(changeRequest.providers !== undefined && { providers: changeRequest.providers }),
      ...(changeRequest.cancelAtPeriodEnd !== undefined && {
        cancelAtPeriodEnd: changeRequest.cancelAtPeriodEnd,
      }),
    });

    if (!result.ok) {
      const error = result.error;
      if (error.code === "NOT_FOUND") {
        return this.sendError(ctx, 404, error.message);
      }
      return this.sendError(ctx, 400, error.message);
    }

    this.logInfo(ctx, "Updated account subscription", { accountId });
    return this.sendSuccess(ctx, {
      subscription: result.value,
      timestamp: new Date().toISOString(),
    });
  }

  async listSubscriptions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      query: z.infer<typeof SubscriptionFiltersSchema>;
    }>(ctx, {
      query: SubscriptionFiltersSchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const query = validated.value.query;
    const { page, limit, ...filters } = query;

    const result = await this.subscriptionService.listAccountSubscriptions(
      removeUndefinedProperties(filters) as Parameters<
        SubscriptionService["listAccountSubscriptions"]
      >[0],
      page,
      limit
    );

    if (!result.ok) {
      return this.sendError(ctx, 500, "Internal server error");
    }

    const { subscriptions, total } = result.value;
    const totalPages = Math.ceil(total / limit);

    this.logInfo(ctx, "Listed subscriptions", { count: subscriptions.length, total });
    return this.sendSuccess(ctx, {
      subscriptions,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      timestamp: new Date().toISOString(),
    });
  }

  async validateLimits(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      params: z.infer<typeof ParamsWithAccountIdSchema>;
      body: z.infer<typeof ValidateLimitsSchema>;
    }>(ctx, {
      params: ParamsWithAccountIdSchema,
      body: ValidateLimitsSchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request parameters");
    }

    const { accountId } = validated.value.params;
    const { operation, amount } = validated.value.body;

    const result = await this.subscriptionService.validateSubscriptionLimits(
      accountId,
      operation,
      amount
    );

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return this.sendError(ctx, 404, "Account not found");
      }
      return this.sendError(ctx, 500, "Internal server error");
    }

    this.logInfo(ctx, "Validated subscription limits", { accountId, operation, amount });
    return this.sendSuccess(ctx, {
      validation: result.value,
      operation,
      amount,
      timestamp: new Date().toISOString(),
    });
  }

  async suspendSubscription(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      params: z.infer<typeof ParamsWithAccountIdSchema>;
      body: z.infer<typeof SuspendSubscriptionSchema>;
    }>(ctx, {
      params: ParamsWithAccountIdSchema,
      body: SuspendSubscriptionSchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request parameters");
    }

    const { accountId } = validated.value.params;
    const { reason } = validated.value.body;
    const suspendedByUserId = request.user?.id;

    const result = await this.subscriptionService.suspendSubscription(
      accountId,
      reason,
      suspendedByUserId
    );

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return this.sendError(ctx, 404, "Account not found");
      }
      return this.sendError(ctx, 500, "Internal server error");
    }

    this.logInfo(ctx, "Suspended subscription", { accountId, reason });
    return this.sendSuccess(ctx, {
      message: "Subscription suspended successfully",
      timestamp: new Date().toISOString(),
    });
  }

  async bulkUpgrade(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      body: z.infer<typeof BulkUpgradeSchema>;
    }>(ctx, {
      body: BulkUpgradeSchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request parameters");
    }

    const { accountIds, newTier, billingCycle, reason } = validated.value.body;
    const upgradedByUserId = request.user?.id;

    const results = await Promise.allSettled(
      accountIds.map((accountId) =>
        this.subscriptionService.updateSubscription(
          accountId,
          { newTier, billingCycle, ...(reason !== undefined && { reason }) },
          upgradedByUserId
        )
      )
    );

    const successful = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    const failed = results.length - successful;

    this.logInfo(ctx, "Bulk upgrade completed", {
      total: accountIds.length,
      successful,
      failed,
      newTier,
    });

    return this.sendSuccess(ctx, {
      total: accountIds.length,
      successful,
      failed,
      newTier,
      timestamp: new Date().toISOString(),
    });
  }
}
