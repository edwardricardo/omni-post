/**
 * @file AnalyticsDashboardHandlers.ts
 * @description Handles analytics dashboard KPI and compliance metrics endpoints.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import type { PrismaClient } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
import { AnalyticsMetricsQuerySchema } from "./analyticsSchemas.js";
import type { ComplianceService } from "@core/compliance/ComplianceService.js";

/**
 * Analytics Dashboard Route Handler
 * Provides analytics dashboard KPI and compliance status endpoints
 */
export class AnalyticsDashboardHandler extends BaseRouteHandler {
  protected routeName = "analytics-dashboard";

  constructor(
    private readonly prisma: PrismaClient,
    private readonly complianceService?: ComplianceService
  ) {
    super();
  }

  /**
   * GET /api/admin/analytics/metrics
   * Analytics dashboard KPIs (total posts, channels, engagement rates, etc.)
   */
  async getAnalyticsMetrics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Fetching analytics dashboard metrics");

    // Validate query parameters
    const validated = await this.validateQuery(ctx, AnalyticsMetricsQuerySchema);
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { startDate, endDate, provider } = validated.value;

    try {
      // Build date range filter
      const dateFilter =
        startDate && endDate
          ? {
              gte: new Date(startDate),
              lte: new Date(endDate),
            }
          : undefined;

      // Fetch aggregate metrics in parallel
      const [
        totalAccounts,
        activeAccounts,
        totalProjects,
        totalPosts,
        publishedPosts,
        scheduledPosts,
        totalChannels,
        totalAnalytics,
      ] = await Promise.all([
        this.prisma.account.count(),
        this.prisma.account.count({
          where: {
            OR: [{ isOnTrial: true, trialEndDate: { gte: new Date() } }],
          },
        }),
        this.prisma.project.count({
          ...(dateFilter && { where: { createdAt: dateFilter } }),
        }),
        this.prisma.post.count({
          ...(dateFilter && { where: { createdAt: dateFilter } }),
        }),
        this.prisma.post.count({
          where: {
            status: "PUBLISHED",
            ...(dateFilter && { publishedAt: dateFilter }),
          },
        }),
        this.prisma.post.count({
          where: {
            status: "SCHEDULED",
            ...(dateFilter && { scheduledAt: dateFilter }),
          },
        }),
        this.prisma.channel.groupBy({
          by: ["provider"],
          _count: { id: true },
          ...(provider && {
            where: { provider: provider as ProviderName },
          }),
        }),
        this.prisma.analytics.aggregate({
          _sum: { views: true, likes: true, comments: true, shares: true },
          _avg: { views: true, likes: true, comments: true, shares: true },
          ...(dateFilter && {
            where: {
              capturedAt: dateFilter,
              ...(provider && { provider: provider as ProviderName }),
            },
          }),
        }),
      ]);

      // Calculate engagement metrics
      const totalEngagement =
        (totalAnalytics._sum.likes ?? 0) +
        (totalAnalytics._sum.comments ?? 0) +
        (totalAnalytics._sum.shares ?? 0);

      const totalViews = totalAnalytics._sum.views ?? 0;
      const engagementRate = totalViews > 0 ? (totalEngagement / totalViews) * 100 : 0;

      // Format channel counts by provider
      const channelsByProvider = totalChannels.reduce(
        (acc, item) => {
          acc[item.provider] = item._count.id;
          return acc;
        },
        {} as Record<string, number>
      );

      const successRate = totalPosts > 0 ? (publishedPosts / totalPosts) * 100 : 0;

      this.logInfo(ctx, "Analytics metrics fetched successfully", {
        totalAccounts,
        totalPosts,
        publishedPosts,
      });

      return this.sendSuccess(ctx, {
        period: {
          startDate: startDate ?? null,
          endDate: endDate ?? null,
        },
        accounts: {
          total: totalAccounts,
          active: activeAccounts,
          trialRatio: totalAccounts > 0 ? (activeAccounts / totalAccounts) * 100 : 0,
        },
        projects: { total: totalProjects },
        posts: {
          total: totalPosts,
          published: publishedPosts,
          scheduled: scheduledPosts,
          draft: totalPosts - publishedPosts - scheduledPosts,
          successRate: Number(successRate.toFixed(2)),
        },
        channels: {
          total: totalChannels.reduce((sum, item) => sum + item._count.id, 0),
          byProvider: channelsByProvider,
        },
        engagement: {
          totalViews: totalViews,
          totalLikes: totalAnalytics._sum.likes ?? 0,
          totalComments: totalAnalytics._sum.comments ?? 0,
          totalShares: totalAnalytics._sum.shares ?? 0,
          totalEngagement,
          engagementRate: Number(engagementRate.toFixed(2)),
          averageViews: Math.round(totalAnalytics._avg.views ?? 0),
          averageLikes: Math.round(totalAnalytics._avg.likes ?? 0),
          averageComments: Math.round(totalAnalytics._avg.comments ?? 0),
          averageShares: Math.round(totalAnalytics._avg.shares ?? 0),
        },
        generatedAt: new Date(),
      });
    } catch (error) {
      this.logError(ctx, "Failed to fetch analytics metrics", { error });
      return this.sendError(ctx, 500, "Failed to fetch analytics metrics");
    }
  }

  /**
   * GET /api/admin/compliance/metrics
   * Compliance status overview
   */
  async getComplianceMetrics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Fetching compliance metrics");

    try {
      const now = new Date();
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [
        totalAuditLogs,
        auditLogsLast30Days,
        auditLogsLast7Days,
        failedActionsLast30Days,
        uniqueUsersLast30Days,
        topActions,
        topResources,
        accountsWithGdprRequests,
      ] = await Promise.all([
        this.prisma.auditLog.count(),
        this.prisma.auditLog.count({
          where: { createdAt: { gte: last30Days } },
        }),
        this.prisma.auditLog.count({
          where: { createdAt: { gte: last7Days } },
        }),
        this.prisma.auditLog.count({
          where: { success: false, createdAt: { gte: last30Days } },
        }),
        this.prisma.auditLog.findMany({
          where: { createdAt: { gte: last30Days } },
          select: { userId: true },
          distinct: ["userId"],
        }),
        this.prisma.auditLog.groupBy({
          by: ["action"],
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 5,
        }),
        this.prisma.auditLog.groupBy({
          by: ["resource"],
          _count: { id: true },
          where: { resource: { not: null } },
          orderBy: { _count: { id: "desc" } },
          take: 5,
        }),
        this.prisma.account.count(),
      ]);

      const successRate =
        auditLogsLast30Days > 0
          ? ((auditLogsLast30Days - failedActionsLast30Days) / auditLogsLast30Days) * 100
          : 100;

      // Compliance score from injected ComplianceService
      let complianceScore = 0;
      if (this.complianceService) {
        const scoreResult = await this.complianceService.getComplianceScore();
        complianceScore = scoreResult.score;
      } else {
        complianceScore = Math.round(
          successRate * 0.6 +
            (uniqueUsersLast30Days.length > 0 ? 100 : 0) * 0.2 +
            (totalAuditLogs > 0 ? 100 : 0) * 0.2
        );
      }

      this.logInfo(ctx, "Compliance metrics fetched successfully", {
        totalAuditLogs,
        complianceScore,
      });

      return this.sendSuccess(ctx, {
        summary: {
          complianceScore,
          totalAuditLogs,
          auditLogsLast30Days,
          auditLogsLast7Days,
          failedActionsLast30Days,
          successRate: Number(successRate.toFixed(2)),
        },
        userActivity: {
          uniqueUsersLast30Days: uniqueUsersLast30Days.length,
        },
        topActions: topActions.map((item) => ({
          action: item.action,
          count: item._count.id,
        })),
        topResources: topResources.map((item) => ({
          resource: item.resource ?? "Unknown",
          count: item._count.id,
        })),
        gdpr: {
          totalDataSubjects: accountsWithGdprRequests,
          exportRequests: 0,
          deletionRequests: 0,
        },
        generatedAt: new Date(),
      });
    } catch (error) {
      this.logError(ctx, "Failed to fetch compliance metrics", { error });
      return this.sendError(ctx, 500, "Failed to fetch compliance metrics");
    }
  }
}
