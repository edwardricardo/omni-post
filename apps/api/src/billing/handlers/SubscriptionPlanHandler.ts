/**
 * Subscription Plan Handler
 *
 * Handles subscription plan-related routes.
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { SubscriptionService } from "../subscription/index.js";
import { ParamsWithTierSchema } from "../subscriptionSchemas.js";

export class SubscriptionPlanHandler extends BaseRouteHandler {
  protected routeName = "subscription-plan";

  constructor(private readonly subscriptionService: SubscriptionService) {
    super();
  }

  async getAllPlans(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const plans = this.subscriptionService.getAllPlans();

    this.logInfo(ctx, "Retrieved all subscription plans", { count: plans.length });
    return this.sendSuccess(ctx, {
      plans,
      count: plans.length,
      timestamp: new Date().toISOString(),
    });
  }

  async getSpecificPlan(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{ params: z.infer<typeof ParamsWithTierSchema> }>(
      ctx,
      {
        params: ParamsWithTierSchema,
      }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid tier parameter");
    }

    const { tier } = validated.value.params;
    const plan = this.subscriptionService.getSubscriptionPlan(tier);

    this.logInfo(ctx, "Retrieved subscription plan", { tier });
    return this.sendSuccess(ctx, {
      plan,
      timestamp: new Date().toISOString(),
    });
  }
}
