/**
 * @file SubscriptionAnalyticsHandler.ts
 * @description Route handler for subscription analytics, statistics, and CSV export endpoints.
 * @layer infrastructure
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { exportToCSV, generateCSVFilename, type ColumnDefinition } from "@packages/api-common";
import { BaseRouteHandler, type RouteContext } from "../../lib/route-handler/index.js";
import type { SubscriptionService } from "../subscription/index.js";
import { ExportQuerySchema } from "../subscriptionSchemas.js";

export class SubscriptionAnalyticsHandler extends BaseRouteHandler {
  protected routeName = "subscription-analytics";

  constructor(private readonly subscriptionService: SubscriptionService) {
    super();
  }

  async getSubscriptionStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const result = await this.subscriptionService.getSubscriptionStats();

    if (!result.ok) {
      return this.sendError(ctx, 500, "Internal server error");
    }

    this.logInfo(ctx, "Retrieved subscription statistics");
    return this.sendSuccess(ctx, {
      stats: result.value,
      timestamp: new Date().toISOString(),
    });
  }

  // Future: Revenue Analytics
  // Track real revenue by integrating with a payment provider (Stripe, Paddle)
  // and querying actual transaction/invoice data per period. Requires: Payment
  // provider webhook integration, transaction storage, RevenueQuerySchema.

  async getSubscriptionHealth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const statsResult = await this.subscriptionService.getSubscriptionStats();

    if (!statsResult.ok) {
      return this.sendError(ctx, 500, "Failed to get subscription stats");
    }

    const stats = statsResult.value;
    const healthScore = Math.min(
      100,
      Math.max(
        0,
        stats.conversionRates.overallUpgrade * 0.4 +
          stats.growthMetrics.monthlyGrowthRate * 2 +
          (100 - stats.churnRisk.highRisk) * 0.3
      )
    );

    const healthStatus =
      healthScore >= 80
        ? "excellent"
        : healthScore >= 60
          ? "good"
          : healthScore >= 40
            ? "warning"
            : "critical";

    this.logInfo(ctx, "Calculated subscription health", { healthScore, healthStatus });
    return this.sendSuccess(ctx, {
      health: {
        score: Math.round(healthScore),
        status: healthStatus,
        metrics: {
          totalSubscriptions: stats.totalSubscriptions,
          conversionRate: stats.conversionRates.overallUpgrade,
          churnRisk: stats.churnRisk.highRisk,
          growthRate: stats.growthMetrics.monthlyGrowthRate,
          revenue: stats.totalRevenue.total,
        },
        recommendations:
          healthStatus === "critical"
            ? [
                "High churn risk detected - review customer satisfaction",
                "Low conversion rates - consider pricing optimization",
                "Implement retention strategies for at-risk customers",
              ]
            : healthStatus === "warning"
              ? [
                  "Monitor churn rates closely",
                  "Consider customer feedback initiatives",
                  "Optimize onboarding experience",
                ]
              : [
                  "Maintain current growth trajectory",
                  "Consider expansion into new markets",
                  "Explore premium feature development",
                ],
      },
      timestamp: new Date().toISOString(),
    });
  }

  async exportSubscriptions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{
      query: z.infer<typeof ExportQuerySchema>;
    }>(ctx, {
      query: ExportQuerySchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { format, status, startDate, endDate } = validated.value.query;

    const filters: { status?: string } = {};
    if (status) filters.status = status;

    const { subscriptions } = await this.subscriptionService.listProviderSubscriptions(
      filters,
      1,
      1000 // Large limit for export
    );

    let filteredData = subscriptions;

    // Apply date filters
    if (startDate) {
      filteredData = filteredData.filter((sub) => sub.createdAt >= startDate);
    }
    if (endDate) {
      filteredData = filteredData.filter((sub) => sub.createdAt <= endDate);
    }

    if (format === "csv") {
      const columns: ColumnDefinition<(typeof filteredData)[0]>[] = [
        { key: "id", header: "ID" },
        { key: "accountId", header: "Account ID" },
        { key: "status", header: "Status" },
        { key: "pricePerMonth", header: "Price/Month", format: (val) => String(Number(val)) },
        { key: "maxProjects", header: "Max Projects", format: (val) => String(val) },
        {
          key: "providers",
          header: "Providers",
          format: (val) => (Array.isArray(val) ? val.join(", ") : String(val)),
        },
        {
          key: "createdAt",
          header: "Created At",
          format: (date) => (date instanceof Date ? date.toISOString() : String(date)),
        },
        {
          key: "updatedAt",
          header: "Updated At",
          format: (date) => (date instanceof Date ? date.toISOString() : String(date)),
        },
      ];

      const csv = exportToCSV(filteredData, columns, {
        preventInjection: true,
        lineEnding: "CRLF",
      });

      const filename = generateCSVFilename("subscriptions");

      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);

      this.logInfo(ctx, "Exported subscriptions as CSV", {
        count: filteredData.length,
        filters: { status, startDate, endDate },
      });
      return reply.send(csv);
    }

    // JSON format
    this.logInfo(ctx, "Exported subscriptions as JSON", {
      count: filteredData.length,
      filters: { status, startDate, endDate },
    });
    return this.sendSuccess(ctx, {
      data: filteredData,
      count: filteredData.length,
      filters: { format, status, startDate, endDate },
      exportedAt: new Date().toISOString(),
    });
  }
}
