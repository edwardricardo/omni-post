/**
 * @file analyticsRoutes.ts
 * @description Fastify route definitions for analytics endpoints with real service integration.
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  IdSchema,
  exportToCSV,
  generateCSVFilename,
  type ColumnDefinition,
} from "@packages/api-common";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import type { AuthenticatedUser } from "../auth/authService.js";
import type { PrismaClient } from "@infra/prisma";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { ThreadAnalytics } from "./threadAnalytics.js";
import type { RealtimeAnalyticsService } from "./realtimeAnalytics.js";
import type { AnalyticsStreamBroadcaster } from "../services/AnalyticsStreamBroadcaster.js";
import type { StreamConnectionTracker } from "../services/StreamConnectionTracker.js";
import type { ProjectQueryRepositoryPort } from "@core/domain/repositories/ProjectQueryRepository.js";
import type {
  CalculateROIUseCase,
  GetCrossPlatformAnalyticsUseCase,
} from "@core/analytics/index.js";
// Future: GeoAnalyticsService — deleted (100% fake geographic distribution)
import { TOKENS } from "../infrastructure/container/types.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

// ✅ Zod schemas for validation
const ThreadPerformanceParamsSchema = z.object({
  params: z.object({
    threadId: z.string().min(1),
  }),
});

const ThreadCompareQuerySchema = z.object({
  query: z.object({
    postId: IdSchema,
    provider: z.string().optional(),
    timeRange: z.enum(["7d", "30d", "90d"]).default("30d"),
  }),
});

const EngagementTrendsQuerySchema = z.object({
  query: z.object({
    projectId: IdSchema,
    provider: z.string().optional(),
    timeRange: z.enum(["7d", "30d", "90d"]).default("30d"),
    granularity: z.enum(["hour", "day", "week"]).default("day"),
  }),
});

const BestTimesQuerySchema = z.object({
  query: z.object({
    projectId: IdSchema,
    provider: z.string().optional(),
    timezone: z.string().default("UTC"),
    lookbackDays: z.coerce.number().min(7).max(365).default(30),
  }),
});

const GeographicAnalyticsQuerySchema = z.object({
  query: z.object({
    projectId: IdSchema,
    provider: z.string().optional(),
    timeRange: z.enum(["7d", "30d", "90d"]).default("30d"),
  }),
});

const MediaPerformanceQuerySchema = z.object({
  query: z.object({
    projectId: IdSchema,
    provider: z.string().optional(),
    timeRange: z.enum(["7d", "30d", "90d"]).default("30d"),
  }),
});

// ROI + cross-platform: `accountId` is intentionally NOT in the schema — it is
// taken authoritatively from the auth token, never the client query (tenancy).
// Zod strips the client-supplied `accountId` param. `projectId` (optional) is
// ownership-checked in the handler.
const ROIQuerySchema = z.object({
  query: z.object({
    projectId: IdSchema.optional(),
    timeRange: z.enum(["7d", "30d", "90d", "1y", "custom"]).default("30d"),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    byChannel: z.coerce.boolean().optional(),
  }),
});

const CrossPlatformQuerySchema = z.object({
  query: z.object({
    projectId: IdSchema.optional(),
    timeRange: z.enum(["7d", "30d", "90d", "1y", "custom"]).default("30d"),
    includeCompetitive: z.coerce.boolean().optional(),
  }),
});

const DashboardQuerySchema = z.object({
  query: z.object({
    projectId: IdSchema,
    timeRange: z.enum(["7d", "30d", "90d"]).default("30d"),
  }),
});

const ExportQuerySchema = z.object({
  query: z.object({
    projectId: IdSchema,
    timeRange: z.enum(["7d", "30d", "90d"]).default("30d"),
    format: z.enum(["json", "csv"]).default("json"),
    includeThreads: z.coerce.boolean().default(true),
    includePosts: z.coerce.boolean().default(true),
    includeAnalytics: z.coerce.boolean().default(true),
  }),
});

// ✅ BaseRouteHandler implementation with real service integration
class AnalyticsRouteHandler extends BaseRouteHandler {
  protected routeName = "analytics";

  constructor(
    private readonly prisma: PrismaClient,
    private readonly threadAnalytics: ThreadAnalytics,
    private readonly projectRepository: ProjectQueryRepositoryPort,
    private readonly broadcaster: AnalyticsStreamBroadcaster,
    private readonly scheduler: BackgroundTaskScheduler,
    private readonly realtimeService: RealtimeAnalyticsService,
    private readonly calculateROIUseCase: CalculateROIUseCase,
    private readonly getCrossPlatformAnalyticsUseCase: GetCrossPlatformAnalyticsUseCase,
    private readonly streamTracker: StreamConnectionTracker
  ) {
    super();
  }

  /** Map a UseCaseError code to an HTTP status. */
  private mapErrorCode(code: string): number {
    const mapping: Record<string, number> = {
      VALIDATION_FAILED: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      CONFLICT: 409,
      NOT_IMPLEMENTED: 501,
      INTERNAL_ERROR: 500,
    };
    return mapping[code] ?? 500;
  }

  /**
   * @method getROI
   * @description GET /analytics/roi — ROI for the authenticated account over a
   *   time range. accountId comes from the token (never the client query). If a
   *   projectId is supplied it is ownership-checked.
   */
  async getROI(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<z.infer<typeof ROIQuerySchema>>(ctx, {
      query: ROIQuerySchema.shape.query,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }
    const { projectId, timeRange, startDate, endDate, byChannel } = validated.value.query;

    if (projectId) {
      const hasAccess = await this.projectRepository.getProjectAccess(user.accountId, projectId);
      if (!hasAccess) {
        return this.sendError(ctx, 403, "Access denied to project");
      }
    }

    const result = await this.calculateROIUseCase.execute({
      accountId: user.accountId,
      ...(projectId !== undefined && { projectId }),
      timeRange,
      ...(startDate !== undefined && { startDate }),
      ...(endDate !== undefined && { endDate }),
      ...(byChannel !== undefined && { byChannel }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }
    return this.sendSuccess(ctx, result.value);
  }

  /**
   * @method getCrossPlatform
   * @description GET /analytics/cross-platform — cross-platform (optionally
   *   competitive) analytics for the authenticated account. Same tenancy rules
   *   as getROI.
   */
  async getCrossPlatform(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<z.infer<typeof CrossPlatformQuerySchema>>(ctx, {
      query: CrossPlatformQuerySchema.shape.query,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }
    const { projectId, timeRange, includeCompetitive } = validated.value.query;

    if (projectId) {
      const hasAccess = await this.projectRepository.getProjectAccess(user.accountId, projectId);
      if (!hasAccess) {
        return this.sendError(ctx, 403, "Access denied to project");
      }
    }

    const result = await this.getCrossPlatformAnalyticsUseCase.execute({
      accountId: user.accountId,
      ...(projectId !== undefined && { projectId }),
      timeRange,
      ...(includeCompetitive !== undefined && { includeCompetitive }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }
    return this.sendSuccess(ctx, result.value);
  }

  /**
   * @method streamRealtime
   * @description GET /analytics/stream — SSE endpoint that pushes live metric
   *   updates (every 30s, with per-cycle deltas) for the posts in scope. Scope is
   *   fixed at connect time via `projectId` (and optional `postIds`); SSE is
   *   unidirectional so there is no mid-connection re-subscribe. Tenant-safe: the
   *   account must own the project, and `postIds` are intersected with the project's
   *   posts so a connection can only ever watch authorized posts.
   * @param request - Fastify request (customerUser set by requireClientAuth)
   * @param reply - Fastify reply (raw stream is written directly for SSE)
   */
  async streamRealtime(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = request.customerUser;
    if (!user) {
      return reply.code(401).send({ ok: false, error: "Authentication required" });
    }

    const query = request.query as { projectId?: string; postIds?: string };
    const projectId = typeof query.projectId === "string" ? query.projectId : undefined;

    // Resolve the (tenant-safe) set of posts this connection will watch.
    let postSet: string[];
    if (projectId) {
      const hasAccess = await this.projectRepository.getProjectAccess(user.accountId, projectId);
      if (!hasAccess) {
        return reply.code(403).send({ ok: false, error: "Access denied to project" });
      }
      const projectPostIds = await this.projectRepository.getPostIds(projectId);
      if (typeof query.postIds === "string" && query.postIds.length > 0) {
        const requested = new Set(
          query.postIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        );
        // Intersect with the project's posts — never trust client-supplied ids.
        postSet = projectPostIds.filter((id) => requested.has(id));
      } else {
        postSet = projectPostIds;
      }
    } else {
      const projects = await this.projectRepository.getByAccountId(user.accountId);
      const postIdArrays = await Promise.all(
        projects.map((p) => this.projectRepository.getPostIds(p.id))
      );
      postSet = postIdArrays.flat();
    }

    // Reserve a per-account stream slot before allocating any per-connection state
    // (subscription, heartbeat). Rejects when the cap is reached — DoS protection.
    const subId = randomUUID();
    if (!this.streamTracker.tryReserve(user.accountId, subId)) {
      return reply.code(429).send({
        ok: false,
        error: "Too many concurrent streams for account",
        maxConcurrent: this.streamTracker.getMaxPerAccount(),
      });
    }

    // SSE headers (mirror notifications stream).
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    reply.raw.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    // Initial snapshot so the dashboard shows live values without waiting a cycle.
    for (const postId of postSet) {
      const metrics = await this.realtimeService.getCurrentMetrics(postId);
      if (metrics) {
        reply.raw.write(`data: ${JSON.stringify(metrics)}\n\n`);
      }
    }

    // Subscribe to per-post broadcasts.
    this.broadcaster.subscribe(subId, postSet, (event) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        this.broadcaster.unsubscribe(subId);
      }
    });

    // Per-connection heartbeat keeps the SSE connection alive through proxies.
    const heartbeatTaskId = `analytics-stream-heartbeat-${subId}`;
    this.scheduler.register(
      heartbeatTaskId,
      () => {
        try {
          reply.raw.write(": heartbeat\n\n");
        } catch {
          this.scheduler.unregister(heartbeatTaskId);
          this.broadcaster.unsubscribe(subId);
          this.streamTracker.release(user.accountId, subId);
        }
      },
      30_000
    );

    // Cleanup on client disconnect.
    request.raw.on("close", () => {
      this.scheduler.unregister(heartbeatTaskId);
      this.broadcaster.unsubscribe(subId);
      this.streamTracker.release(user.accountId, subId);
    });
  }

  async getThreadPerformance(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof ThreadPerformanceParamsSchema>>(
      ctx,
      {
        params: ThreadPerformanceParamsSchema.shape.params,
      }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const { threadId } = validated.value.params;

    try {
      const metrics = await this.threadAnalytics.getThreadMetrics(threadId);

      if (!metrics) {
        return this.sendError(ctx, 404, "Thread not found", { threadId });
      }

      return this.sendSuccess(ctx, metrics);
    } catch (error) {
      return this.sendError(ctx, 500, "Failed to get thread performance", {
        threadId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async compareThreads(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof ThreadCompareQuerySchema>>(ctx, {
      query: ThreadCompareQuerySchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { postId, provider: _provider, timeRange: _timeRange } = validated.value.query;

    try {
      // compareStrategies takes (projectId?, accountId?)
      // For now, we'll return a placeholder since the signature doesn't match
      const comparison = await this.threadAnalytics.compareStrategies(postId);

      return this.sendSuccess(ctx, comparison);
    } catch (error) {
      return this.sendError(ctx, 500, "Failed to compare threads", {
        postId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async getEngagementTrends(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<z.infer<typeof EngagementTrendsQuerySchema>>(ctx, {
      query: EngagementTrendsQuerySchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const {
      projectId,
      provider: _provider2,
      timeRange: _timeRange2,
      granularity: _granularity,
    } = validated.value.query;

    const hasAccess = await this.projectRepository.getProjectAccess(user.accountId, projectId);
    if (!hasAccess) {
      return this.sendError(ctx, 403, "Access denied to project");
    }

    try {
      // getEngagementTrends takes threadId, not projectId — needs project-level aggregation
      return this.sendError(ctx, 501, "Project-level engagement trends not yet implemented", {
        projectId,
        note: "Use /threads/:threadId/performance for thread-specific trends",
      });
    } catch (error) {
      return this.sendError(ctx, 500, "Failed to get engagement trends", {
        projectId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async getBestPostingTimes(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<z.infer<typeof BestTimesQuerySchema>>(ctx, {
      query: BestTimesQuerySchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { projectId, provider, timezone, lookbackDays } = validated.value.query;

    const hasAccess = await this.projectRepository.getProjectAccess(user.accountId, projectId);
    if (!hasAccess) {
      return this.sendError(ctx, 403, "Access denied to project");
    }

    return this.sendError(ctx, 501, "Analytics service not yet implemented", {
      feature: "best-posting-times",
      projectId,
      provider,
      timezone,
      lookbackDays,
    });
  }

  async getGeographicAnalytics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<z.infer<typeof GeographicAnalyticsQuerySchema>>(
      ctx,
      {
        query: GeographicAnalyticsQuerySchema.shape.query,
      }
    );

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { projectId, provider, timeRange } = validated.value.query;

    const hasAccess = await this.projectRepository.getProjectAccess(user.accountId, projectId);
    if (!hasAccess) {
      return this.sendError(ctx, 403, "Access denied to project");
    }

    // Future: Geographic analytics requires real provider API location data
    return this.sendError(ctx, 501, "Geographic analytics not yet implemented", {
      feature: "geographic-analytics",
      projectId,
      provider,
      timeRange,
    });
  }

  async getMediaPerformance(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<z.infer<typeof MediaPerformanceQuerySchema>>(ctx, {
      query: MediaPerformanceQuerySchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { projectId, provider, timeRange } = validated.value.query;

    const hasAccess = await this.projectRepository.getProjectAccess(user.accountId, projectId);
    if (!hasAccess) {
      return this.sendError(ctx, 403, "Access denied to project");
    }

    return this.sendError(ctx, 501, "Analytics service not yet implemented", {
      feature: "media-performance",
      projectId,
      provider,
      timeRange,
    });
  }

  async getDashboard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<z.infer<typeof DashboardQuerySchema>>(ctx, {
      query: DashboardQuerySchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { projectId, timeRange } = validated.value.query;

    const hasAccess = await this.projectRepository.getProjectAccess(user.accountId, projectId);
    if (!hasAccess) {
      return this.sendError(ctx, 403, "Access denied to project");
    }

    try {
      const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Fetch posts, channels, and analytics in parallel
      const [postCount, channels, analytics] = await Promise.all([
        this.prisma.post.count({ where: { projectId, deletedAt: null } }),
        this.prisma.channel.findMany({
          where: { projectId, deletedAt: null },
          select: { id: true, provider: true, handle: true },
        }),
        this.prisma.analytics.findMany({
          where: {
            post: { projectId },
            capturedAt: { gte: startDate },
          },
          include: {
            post: { select: { id: true } },
          },
          orderBy: { capturedAt: "desc" },
          take: 500,
        }),
      ]);

      // Aggregate totals
      const totalViews = analytics.reduce((s, a) => s + (a.views ?? 0), 0);
      const totalLikes = analytics.reduce((s, a) => s + (a.likes ?? 0), 0);
      const totalComments = analytics.reduce((s, a) => s + (a.comments ?? 0), 0);
      const totalShares = analytics.reduce((s, a) => s + (a.shares ?? 0), 0);
      const totalEngagement = totalLikes + totalComments + totalShares;

      // Group analytics by provider
      const providerGroups: Record<string, typeof analytics> = {};
      for (const entry of analytics) {
        const provider = entry.provider.toString();
        if (!providerGroups[provider]) {
          providerGroups[provider] = [];
        }
        providerGroups[provider]!.push(entry);
      }

      // Build per-platform metrics
      const platformMetrics = channels.map((channel) => {
        const provider = channel.provider.toString();
        const entries = providerGroups[provider] ?? [];
        const likes = entries.reduce((s, a) => s + (a.likes ?? 0), 0);
        const comments = entries.reduce((s, a) => s + (a.comments ?? 0), 0);
        const shares = entries.reduce((s, a) => s + (a.shares ?? 0), 0);
        const views = entries.reduce((s, a) => s + (a.views ?? 0), 0);
        const engagement = likes + comments + shares;
        const engagementRate = views > 0 ? Number(((engagement / views) * 100).toFixed(2)) : 0;

        // Count unique posts for this provider
        const uniquePostIds = new Set(entries.map((e) => e.postId).filter(Boolean));

        return {
          platformId: channel.id,
          platformName: provider,
          handle: channel.handle,
          totalPosts: uniquePostIds.size,
          totalEngagement: engagement,
          totalReach: views,
          totalImpressions: views,
          totalClicks: 0,
          followerCount: 0,
          growthRate: 0,
          engagementRate,
        };
      });

      // Determine top platform
      const topPlatform =
        platformMetrics.length > 0
          ? platformMetrics.reduce((best, p) =>
              p.totalEngagement > best.totalEngagement ? p : best
            ).platformName
          : "N/A";

      // Calculate average engagement rate
      const avgEngagementRate =
        totalViews > 0 ? Number(((totalEngagement / totalViews) * 100).toFixed(2)) : 0;

      const overview = {
        totalPosts: postCount,
        totalEngagement,
        totalReach: totalViews,
        totalImpressions: totalViews,
        avgEngagementRate,
        topPlatform,
        growthThisWeek: 0,
        performanceScore: Math.min(100, Math.round(avgEngagementRate * 10)),
      };

      return this.sendSuccess(ctx, {
        overview,
        platformMetrics,
        timeRange,
        dataPoints: analytics.length,
      });
    } catch (error) {
      return this.sendError(ctx, 500, "Failed to get analytics dashboard", {
        projectId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async exportAnalytics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validated = await this.validateRequest<z.infer<typeof ExportQuerySchema>>(ctx, {
      query: ExportQuerySchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { projectId, timeRange, format, includeThreads, includePosts, includeAnalytics } =
      validated.value.query;

    const hasAccess = await this.projectRepository.getProjectAccess(user.accountId, projectId);
    if (!hasAccess) {
      return this.sendError(ctx, 403, "Access denied to project");
    }

    try {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });

      if (!project) {
        return this.sendError(ctx, 404, "Project not found");
      }

      const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Fetch data sections in parallel based on include flags
      const [posts, channels, analytics, threads] = await Promise.all([
        includePosts
          ? this.prisma.post.findMany({
              where: { projectId, deletedAt: null },
              select: {
                id: true,
                status: true,
                scheduledAt: true,
                publishedAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 1000,
            })
          : Promise.resolve([]),
        this.prisma.channel.findMany({
          where: { projectId, deletedAt: null },
          select: { id: true, provider: true, handle: true },
        }),
        includeAnalytics
          ? this.prisma.analytics.findMany({
              where: {
                post: { projectId },
                capturedAt: { gte: startDate },
              },
              select: {
                id: true,
                postId: true,
                channelId: true,
                provider: true,
                views: true,
                likes: true,
                comments: true,
                shares: true,
                capturedAt: true,
              },
              orderBy: { capturedAt: "desc" },
              take: 5000,
            })
          : Promise.resolve([]),
        includeThreads
          ? this.prisma.thread.findMany({
              where: { post: { projectId, deletedAt: null } },
              select: {
                id: true,
                postId: true,
                strategy: true,
                createdAt: true,
              },
              take: 1000,
            })
          : Promise.resolve([]),
      ]);

      // Build export payload
      const exportData = {
        projectId,
        projectName: project.name,
        timeRange,
        exportedAt: new Date().toISOString(),
        ...(includePosts && { posts }),
        ...(includeAnalytics && {
          analytics: analytics.map((a) => ({
            ...a,
            provider: a.provider.toString(),
            capturedAt: a.capturedAt.toISOString(),
          })),
        }),
        ...(includeThreads && { threads }),
        channels: channels.map((c) => ({
          ...c,
          provider: c.provider.toString(),
        })),
        summary: {
          totalPosts: posts.length,
          totalAnalyticsRecords: analytics.length,
          totalThreads: threads.length,
          totalChannels: channels.length,
          totalViews: analytics.reduce((s, a) => s + (a.views ?? 0), 0),
          totalLikes: analytics.reduce((s, a) => s + (a.likes ?? 0), 0),
          totalComments: analytics.reduce((s, a) => s + (a.comments ?? 0), 0),
          totalShares: analytics.reduce((s, a) => s + (a.shares ?? 0), 0),
        },
      };

      // JSON format — return directly
      if (format === "json") {
        return this.sendSuccess(ctx, exportData);
      }

      // CSV format — build CSV from analytics rows (primary export data)
      const csvRows = this.buildCsvRows(analytics, posts, channels);

      type CsvRow = (typeof csvRows)[number];
      const columns: ColumnDefinition<CsvRow>[] = [
        { key: "postId", header: "Post ID" },
        { key: "postStatus", header: "Post Status" },
        { key: "channelId", header: "Channel ID" },
        { key: "provider", header: "Provider" },
        { key: "channelHandle", header: "Channel Handle" },
        { key: "views", header: "Views" },
        { key: "likes", header: "Likes" },
        { key: "comments", header: "Comments" },
        { key: "shares", header: "Shares" },
        { key: "engagement", header: "Total Engagement" },
        {
          key: "engagementRate",
          header: "Engagement Rate (%)",
          format: (val: unknown) => String(val),
        },
        { key: "capturedAt", header: "Captured At" },
        { key: "publishedAt", header: "Published At" },
      ];

      const csvContent = exportToCSV(csvRows, columns);
      const filename = generateCSVFilename(`analytics-${projectId}-${timeRange}`);

      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(csvContent);
    } catch (error) {
      return this.sendError(ctx, 500, "Failed to export analytics", {
        projectId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * @method buildCsvRows
   * @description Joins analytics records with post and channel data into flat CSV rows.
   */
  private buildCsvRows(
    analytics: ReadonlyArray<{
      id: string;
      postId: string | null;
      channelId: string;
      provider: { toString(): string };
      views: number | null;
      likes: number | null;
      comments: number | null;
      shares: number | null;
      capturedAt: Date;
    }>,
    posts: ReadonlyArray<{
      id: string;
      status: string;
      publishedAt: Date | null;
    }>,
    channels: ReadonlyArray<{
      id: string;
      provider: { toString(): string };
      handle: string;
    }>
  ): Array<{
    postId: string;
    postStatus: string;
    channelId: string;
    provider: string;
    channelHandle: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagement: number;
    engagementRate: string;
    capturedAt: string;
    publishedAt: string;
  }> {
    const postMap = new Map(posts.map((p) => [p.id, p]));
    const channelMap = new Map(channels.map((c) => [c.id, c]));

    return analytics.map((a) => {
      const post = a.postId ? postMap.get(a.postId) : undefined;
      const channel = channelMap.get(a.channelId);
      const views = a.views ?? 0;
      const likes = a.likes ?? 0;
      const comments = a.comments ?? 0;
      const shares = a.shares ?? 0;
      const engagement = likes + comments + shares;
      const engagementRate = views > 0 ? ((engagement / views) * 100).toFixed(2) : "0.00";

      return {
        postId: a.postId ?? "",
        postStatus: post?.status ?? "",
        channelId: a.channelId,
        provider: a.provider.toString(),
        channelHandle: channel?.handle ?? "",
        views,
        likes,
        comments,
        shares,
        engagement,
        engagementRate,
        capturedAt: a.capturedAt.toISOString(),
        publishedAt: post?.publishedAt?.toISOString() ?? "",
      };
    });
  }

  /**
   * Get analytics summary for a project
   * GET /analytics/project/:projectId
   */
  async getProjectAnalytics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const ProjectParamsSchema = z.object({ projectId: IdSchema });
    const validated = await this.validateParams(ctx, ProjectParamsSchema);

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid project ID");
    }

    const { projectId } = validated.value;

    const hasAccess = await this.projectRepository.getProjectAccess(user.accountId, projectId);
    if (!hasAccess) {
      return this.sendError(ctx, 403, "Access denied to project");
    }

    try {
      const [postCount, analytics] = await Promise.all([
        this.prisma.post.count({ where: { projectId, deletedAt: null } }),
        this.prisma.analytics.findMany({
          where: { post: { projectId } },
          orderBy: { capturedAt: "desc" },
          take: 100,
        }),
      ]);

      const totalViews = analytics.reduce((s, a) => s + (a.views ?? 0), 0);
      const totalLikes = analytics.reduce((s, a) => s + (a.likes ?? 0), 0);
      const totalComments = analytics.reduce((s, a) => s + (a.comments ?? 0), 0);
      const totalShares = analytics.reduce((s, a) => s + (a.shares ?? 0), 0);

      return this.sendSuccess(ctx, {
        projectId,
        postCount,
        views: totalViews,
        likes: totalLikes,
        comments: totalComments,
        shares: totalShares,
        dataPoints: analytics.length,
      });
    } catch (error) {
      return this.sendError(ctx, 500, "Failed to get project analytics", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

/**
 * Analytics Routes Plugin
 * Resolves ThreadAnalytics, GeoAnalyticsService and PrismaClient from the DI container
 * when available, falling back to constructed singletons for backward compatibility
 * during migration. The module-level Redis connection is only created in the fallback path.
 */
const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  const prisma = fastify.container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const threadAnalytics = fastify.container.resolve<ThreadAnalytics>(TOKENS.ThreadAnalytics);
  const projectQueryRepository = fastify.container.resolve<ProjectQueryRepositoryPort>(
    TOKENS.ProjectQueryRepository
  );
  const broadcaster = fastify.container.resolve<AnalyticsStreamBroadcaster>(
    TOKENS.AnalyticsStreamBroadcaster
  );
  const scheduler = fastify.container.resolve<BackgroundTaskScheduler>(
    TOKENS.BackgroundTaskScheduler
  );
  // Resolving the service forces construction → starts the 30s metrics poll.
  const realtimeService = fastify.container.resolve<RealtimeAnalyticsService>(
    TOKENS.RealtimeAnalyticsService
  );
  const calculateROIUseCase = fastify.container.resolve<CalculateROIUseCase>(
    TOKENS.CalculateROIUseCase
  );
  const getCrossPlatformAnalyticsUseCase =
    fastify.container.resolve<GetCrossPlatformAnalyticsUseCase>(
      TOKENS.GetCrossPlatformAnalyticsUseCase
    );
  const streamTracker = fastify.container.resolve<StreamConnectionTracker>(
    TOKENS.StreamConnectionTracker
  );

  const handler = new AnalyticsRouteHandler(
    prisma,
    threadAnalytics,
    projectQueryRepository,
    broadcaster,
    scheduler,
    realtimeService,
    calculateROIUseCase,
    getCrossPlatformAnalyticsUseCase,
    streamTracker
  );

  // Real-time analytics metrics stream (Server-Sent Events)
  fastify.get(
    "/analytics/stream",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "Stream real-time analytics metrics via SSE" },
    },
    async (request, reply) => handler.streamRealtime(request, reply)
  );

  // Get project-level analytics summary (tenant-safe: requireClientAuth + ownership check)
  fastify.get(
    "/analytics/project/:projectId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "Get project analytics summary" },
    },
    async (request, reply) => handler.getProjectAnalytics(request, reply)
  );

  // Get detailed performance metrics for a specific thread
  fastify.get(
    "/threads/:threadId/performance",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "Get thread performance metrics" },
    },
    async (request, reply) => handler.getThreadPerformance(request, reply)
  );

  // Compare thread performance vs single posts
  fastify.get(
    "/threads/compare",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "Compare thread performance" },
    },
    async (request, reply) => handler.compareThreads(request, reply)
  );

  // Get engagement trends over time
  fastify.get(
    "/engagement/trends",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "Get engagement trends" },
    },
    async (request, reply) => handler.getEngagementTrends(request, reply)
  );

  // Get optimal posting times based on historical data
  fastify.get(
    "/posts/best-times",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "Get best posting times" },
    },
    async (request, reply) => handler.getBestPostingTimes(request, reply)
  );

  // Get geographic distribution of engagement
  fastify.get(
    "/engagement/geographic",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "Get geographic analytics" },
    },
    async (request, reply) => handler.getGeographicAnalytics(request, reply)
  );

  // Compare performance of media vs text-only content
  fastify.get(
    "/content/media-performance",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "Get media performance analytics" },
    },
    async (request, reply) => handler.getMediaPerformance(request, reply)
  );

  // Get comprehensive analytics dashboard data
  fastify.get(
    "/analytics/dashboard",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "Get analytics dashboard" },
    },
    async (request, reply) => handler.getDashboard(request, reply)
  );

  // Export analytics data in various formats
  fastify.get(
    "/export",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "Export analytics data" },
    },
    async (request, reply) => handler.exportAnalytics(request, reply)
  );

  // ─── Premium analytics (ROI + cross-platform) ──────────────────────────────
  // Account-scoped, tenant-safe (accountId from the token). Consumed by the
  // client predictive-analytics dashboard (ROI + Competitive tabs).

  fastify.get(
    "/analytics/roi",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "ROI for the account over a time range" },
    },
    async (request, reply) => handler.getROI(request, reply)
  );

  fastify.get(
    "/analytics/cross-platform",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Analytics"], summary: "Cross-platform (optionally competitive) analytics" },
    },
    async (request, reply) => handler.getCrossPlatform(request, reply)
  );
};

export { analyticsRoutes };
