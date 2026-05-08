/**
 * @file SubscriptionPlanHandler.ts
 * @description Route handler for subscription plan retrieval and tier-specific plan details.
 * @layer infrastructure
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../../lib/route-handler/index.js";
import type { SubscriptionService } from "../subscription/index.js";
import { ParamsWithTierSchema } from "../subscriptionSchemas.js";

export class SubscriptionPlanHandler extends BaseRouteHandler {
  protected routeName = "subscription-plan";

  constructor(private readonly subscriptionService: SubscriptionService) {
    super();
  }

  async getAllPlans(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const plans = await this.subscriptionService.getAllPlansFromDB();

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
    const plans = await this.subscriptionService.getAllPlansFromDB();
    const plan = plans.find((p) => p.slug === tier);

    if (!plan) {
      return this.sendError(ctx, 404, `Subscription plan '${tier}' not found`);
    }

    this.logInfo(ctx, "Retrieved subscription plan", { tier });
    return this.sendSuccess(ctx, {
      plan,
      timestamp: new Date().toISOString(),
    });
  }
}
