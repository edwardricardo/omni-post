/**
 * @file trendRoutes.ts
 * @description REST API endpoints for trend analysis, viral content analysis, content
 *              opportunity discovery, predictions, and comprehensive trend reports.
 * @layer infrastructure
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { PrismaClient } from "@infra/prisma";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TrendAnalysisService } from "./trendAnalysisService.js";
import {
  categorizeTrendingContent,
  getTopCategory,
  calculateAverageLifespan,
  identifyPatterns,
  identifyShifts,
  identifyAnomalies,
  identifyCrossTrends,
  generateContentRecommendations,
  generateTimingRecommendations,
  generateHashtagRecommendations,
  generateSoundRecommendations,
  generateStrategyRecommendations,
} from "./TrendReportBuilder.js";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

/**
 * Query parameters for GET /trends/analysis
 */
const TrendAnalysisQuerySchema = z.object({
  type: z.enum(["video", "hashtag", "sound", "challenge"]).optional(),
  category: z.string().optional(),
  region: z.string().optional(),
  timeframe: z.enum(["1d", "7d", "30d"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * Query parameters for GET /trends/viral
 */
const ViralAnalysisQuerySchema = z.object({
  contentId: z.string().min(1, "contentId is required"),
});

/**
 * Query parameters for GET /trends/opportunities
 */
const OpportunitiesQuerySchema = z.object({
  category: z.string().optional(),
  region: z.string().optional(),
  // boolean flag from query string — kept as string, converted in handler
  competitorAnalysis: z.string().optional(),
});

/**
 * Query parameters for GET /trends/predictions
 */
const PredictionsQuerySchema = z.object({
  category: z.string().optional(),
  region: z.string().optional(),
  timeHorizon: z.enum(["short", "medium", "long"]).optional(),
});

/**
 * Query parameters for GET /trends/report
 */
const TrendReportQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD")
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD")
    .optional(),
  region: z.string().optional(),
  category: z.string().optional(),
  // boolean flag from query string — kept as string, converted in handler
  includeCompetitors: z.string().optional(),
});

// ============================================================================
// Route Handler Implementation
// ============================================================================

class TrendRouteHandler extends BaseRouteHandler {
  protected routeName = "trends";

  constructor(private readonly trendService: TrendAnalysisService) {
    super();
  }

  /**
   * Retrieve trending content with optional filters.
   * GET /trends/analysis
   */
  async getTrendingContent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const queryResult = await this.validateQuery(ctx, TrendAnalysisQuerySchema);
      if (!queryResult.ok) {
        return this.sendError(ctx, 400, "Invalid query parameters");
      }

      const { type, category, region, timeframe, limit } = queryResult.value;

      const result = await this.trendService.getTrendingContent({
        ...(type !== undefined && { type }),
        ...(category !== undefined && { category }),
        ...(region !== undefined && { region }),
        ...(timeframe !== undefined && { timeframe }),
        ...(limit !== undefined && { limit }),
      });

      if (!result.ok) {
        return this.sendError(ctx, 502, result.error);
      }

      this.sendSuccess(ctx, result.value, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }

  /**
   * Analyze viral content patterns and DNA for a specific content item.
   * GET /trends/viral
   */
  async analyzeViralContent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const queryResult = await this.validateQuery(ctx, ViralAnalysisQuerySchema);
      if (!queryResult.ok) {
        return this.sendError(ctx, 400, "contentId query parameter is required");
      }

      const result = await this.trendService.analyzeViralContent(queryResult.value.contentId);

      if (!result.ok) {
        return this.sendError(ctx, 502, result.error);
      }

      this.sendSuccess(ctx, result.value, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }

  /**
   * Discover content opportunity gaps and emerging trends.
   * GET /trends/opportunities
   */
  async discoverOpportunities(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const queryResult = await this.validateQuery(ctx, OpportunitiesQuerySchema);
      if (!queryResult.ok) {
        return this.sendError(ctx, 400, "Invalid query parameters");
      }

      const { category, region, competitorAnalysis } = queryResult.value;
      const competitorAnalysisBool = competitorAnalysis === "true";

      const result = await this.trendService.discoverContentOpportunities({
        ...(category !== undefined && { category }),
        ...(region !== undefined && { region }),
        ...(competitorAnalysis !== undefined && { competitorAnalysis: competitorAnalysisBool }),
      });

      if (!result.ok) {
        return this.sendError(ctx, 502, result.error);
      }

      this.sendSuccess(ctx, result.value, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }

  /**
   * Generate trend predictions using rule-based heuristics.
   * GET /trends/predictions
   *
   * NOTE: No ML models are used. Predictions are derived from static
   * scoring rules and mock data.
   */
  async generatePredictions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const queryResult = await this.validateQuery(ctx, PredictionsQuerySchema);
      if (!queryResult.ok) {
        return this.sendError(ctx, 400, "Invalid query parameters");
      }

      const { category, region, timeHorizon } = queryResult.value;

      const result = await this.trendService.generateTrendPredictions({
        ...(category !== undefined && { category }),
        ...(region !== undefined && { region }),
        ...(timeHorizon !== undefined && { timeHorizon }),
      });

      if (!result.ok) {
        return this.sendError(ctx, 502, result.error);
      }

      this.sendSuccess(ctx, result.value, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }

  /**
   * Generate a comprehensive trend report for a time period.
   * GET /trends/report
   *
   * Uses TrendAnalysisService to aggregate trending content, predictions,
   * and opportunity data; then applies TrendReportBuilder helpers to produce
   * extended insights, patterns, and strategic recommendations.
   */
  async generateTrendReport(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const queryResult = await this.validateQuery(ctx, TrendReportQuerySchema);
      if (!queryResult.ok) {
        return this.sendError(ctx, 400, "Invalid query parameters");
      }

      const { startDate, endDate, region, category, includeCompetitors } = queryResult.value;
      const includeCompetitorsBool = includeCompetitors === "true";

      const now = new Date();
      const periodStart = startDate
        ? new Date(startDate)
        : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const periodEnd = endDate ? new Date(endDate) : now;

      const result = await this.trendService.generateTrendReport({
        period: { start: periodStart, end: periodEnd },
        ...(region !== undefined && { region }),
        ...(category !== undefined && { category }),
        ...(includeCompetitors !== undefined && { includeCompetitors: includeCompetitorsBool }),
      });

      if (!result.ok) {
        return this.sendError(ctx, 502, result.error);
      }

      const report = result.value;

      // Flatten all trending content for TrendReportBuilder helper calls
      const allTrending = [
        ...report.trending.videos,
        ...report.trending.hashtags,
        ...report.trending.sounds,
        ...report.trending.challenges,
      ];

      // Build a minimal ContentDiscoveryInsight for generateContentRecommendations
      const opportunityInsight = {
        category: category ?? "all",
        region: region ?? "global",
        timeframe: "30d",
        gaps: report.opportunities.immediate.map((o) => ({
          contentType: o.type,
          audience: "general",
          competitionLevel: o.difficulty,
          opportunitySize: o.potential,
          barriers: [] as string[],
          suggestedApproach: [] as string[],
        })),
        emerging: [] as {
          topic: string;
          signals: string[];
          strength: number;
          timeToMainstream: number;
          firstMoverAdvantage: number;
        }[],
        saturated: [] as {
          topic: string;
          saturationLevel: number;
          alternatives: string[];
          revitalizationOpportunities: string[];
        }[],
        seasonal: [] as {
          topic: string;
          pattern: string;
          nextPeak: Date;
          preparationTime: number;
          expectedImpact: number;
        }[],
      };

      // Augment the core report with additional TrendReportBuilder insights
      const augmented = {
        ...report,
        builderMeta: {
          categorized: categorizeTrendingContent(allTrending),
          topCategory: allTrending.length > 0 ? getTopCategory(allTrending) : "none",
          averageLifespan: allTrending.length > 0 ? calculateAverageLifespan(allTrending) : 0,
        },
        extendedInsights: {
          patterns: identifyPatterns(allTrending),
          shifts: identifyShifts(allTrending),
          anomalies: identifyAnomalies(allTrending),
          crossTrends: identifyCrossTrends(allTrending),
        },
        extendedRecommendations: {
          content:
            allTrending.length > 0
              ? generateContentRecommendations(allTrending, opportunityInsight)
              : [],
          timing: generateTimingRecommendations(allTrending),
          hashtags: generateHashtagRecommendations(allTrending),
          sounds: generateSoundRecommendations(allTrending),
          strategy: generateStrategyRecommendations(allTrending, report.predictions),
        },
      };

      this.sendSuccess(ctx, augmented, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }
}

// ============================================================================
// Fastify Plugin Export
// ============================================================================

export const trendRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);

  // TrendAnalysisService requires prisma and a Fastify-compatible logger.
  // fastify.log is the built-in pino logger which satisfies FastifyLoggerInstance.
  const trendService = new TrendAnalysisService(prisma, fastify.log);

  const handler = new TrendRouteHandler(trendService);

  // GET /trends/analysis — retrieve trending content with optional filters
  fastify.get(
    "/trends/analysis",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Trends"], summary: "Retrieve trending content with optional filters" },
    },
    async (request, reply) => handler.getTrendingContent(request, reply)
  );

  // GET /trends/viral — analyze viral DNA of a content item
  fastify.get(
    "/trends/viral",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Trends"], summary: "Analyze viral DNA of a content item" },
    },
    async (request, reply) => handler.analyzeViralContent(request, reply)
  );

  // GET /trends/opportunities — discover content gap opportunities
  fastify.get(
    "/trends/opportunities",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Trends"], summary: "Discover content opportunity gaps" },
    },
    async (request, reply) => handler.discoverOpportunities(request, reply)
  );

  // GET /trends/predictions — generate trend predictions
  fastify.get(
    "/trends/predictions",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Trends"], summary: "Generate trend predictions" },
    },
    async (request, reply) => handler.generatePredictions(request, reply)
  );

  // GET /trends/report — generate a comprehensive trend report
  fastify.get(
    "/trends/report",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Trends"], summary: "Generate a comprehensive trend report" },
    },
    async (request, reply) => handler.generateTrendReport(request, reply)
  );
};
