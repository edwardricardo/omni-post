/**
 * @file dashboardRoutes.ts
 * @description Fastify route definitions for the admin dashboard using BaseRouteHandler pattern.
 *              Resolves DashboardService from DI container.
 * @layer infrastructure
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import type { DashboardService } from "./dashboardService.js";
import { TOKENS } from "../infrastructure/container/types.js";

// ✅ Zod schemas for validation (planned for future time-range filtering)
const _TimeRangeQuerySchema = z.object({
  query: z.object({
    timeRange: z.enum(["7d", "30d", "90d"]).default("30d").optional(),
  }),
});

// ✅ BaseRouteHandler implementation
class DashboardRouteHandler extends BaseRouteHandler {
  protected routeName = "dashboard";

  constructor(private readonly dashboardService: DashboardService) {
    super();
  }

  async getStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const result = await this.dashboardService.getStats();
    return this.sendSuccess(ctx, { stats: result });
  }

  async getAccountsSummary(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const result = await this.dashboardService.getAccountsSummary();
    return this.sendSuccess(ctx, result);
  }

  async getSubscriptionsSummary(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const result = await this.dashboardService.getSubscriptionsSummary();
    return this.sendSuccess(ctx, result);
  }

  async getAnalyticsOverview(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const result = await this.dashboardService.getAnalyticsOverview();
    return this.sendSuccess(ctx, { data: result });
  }
}

// ✅ PROPER Fastify v5.6.1 Plugin Implementation
const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const dashboardService = fastify.container!.resolve<DashboardService>(TOKENS.DashboardService);
  const handler = new DashboardRouteHandler(dashboardService);

  // ✅ Get dashboard statistics
  fastify.get(
    "/admin/dashboard/stats",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.DASHBOARD_VIEW)],
      schema: { tags: ["Admin Dashboard"], summary: "Get dashboard statistics" },
    },
    async (request, reply) => handler.getStats(request, reply)
  );

  // ✅ Get account statistics for account management page
  fastify.get(
    "/admin/accounts/summary",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.DASHBOARD_VIEW)],
      schema: { tags: ["Admin Dashboard"], summary: "Get accounts summary" },
    },
    async (request, reply) => handler.getAccountsSummary(request, reply)
  );

  // ✅ Get subscription statistics for subscription management page
  fastify.get(
    "/admin/subscriptions/summary",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.DASHBOARD_VIEW)],
      schema: { tags: ["Admin Dashboard"], summary: "Get subscriptions summary" },
    },
    async (request, reply) => handler.getSubscriptionsSummary(request, reply)
  );

  // ✅ Get analytics overview data
  fastify.get(
    "/admin/analytics/overview",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.DASHBOARD_VIEW)],
      schema: { tags: ["Admin Dashboard"], summary: "Get analytics overview" },
    },
    async (request, reply) => handler.getAnalyticsOverview(request, reply)
  );
};

export { dashboardRoutes };
