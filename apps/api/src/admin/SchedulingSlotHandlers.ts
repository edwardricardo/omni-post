/**
 * @file SchedulingSlotHandlers.ts
 * @description Route handler for scheduling slot management including available slot queries,
 *              optimal posting time analysis, and engagement-based time recommendations.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { PrismaClient, Prisma, SchedulingRule } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
import {
  SchedulingSlotsQuerySchema,
  OptimalTimesQuerySchema,
  SchedulingRulesQuerySchema,
  CreateScheduleSlotBodySchema,
  BulkCreateScheduleSlotsBodySchema,
} from "./schedulingSchemas.js";

/** Minimal post shape returned by the scheduled-posts query (select: id, scheduledAt) */
interface ScheduledPostSlot {
  id: string;
  scheduledAt: Date | null;
}

/** Analytics row with its associated post (include: { post: { select: { id, publishedAt } } }) */
interface AnalyticsWithPost {
  id: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  post: { id: string; publishedAt: Date | null } | null;
}

/**
 * Scheduling Slot Route Handler
 * Manages scheduling slots, optimal times, and scheduling rule queries
 */
export class SchedulingSlotRouteHandler extends BaseRouteHandler {
  protected routeName = "scheduling-slots";

  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  /**
   * GET /api/scheduling/slots
   * Get available scheduling slots for a project within a date range
   */
  async getSchedulingSlots(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Fetching scheduling slots");

    // Validate query parameters
    const validated = await this.validateQuery(ctx, SchedulingSlotsQuerySchema);
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { projectId, startDate, endDate, provider, timezone } = validated.value;

    try {
      // Verify project exists
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        return this.sendError(ctx, 404, "Project not found");
      }

      // Get scheduling rules for the project
      const rules = await this.prisma.schedulingRule.findMany({
        where: {
          projectId,
          isActive: true,
          ...(provider && {
            platforms: {
              has: provider as ProviderName,
            },
          }),
        },
      });

      // Get existing scheduled posts in the date range
      const scheduledPosts = await this.prisma.post.findMany({
        where: {
          projectId,
          status: "SCHEDULED",
          scheduledAt: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
        select: {
          id: true,
          scheduledAt: true,
        },
      });

      // Calculate available slots based on rules
      const slots = this.calculateAvailableSlots(
        rules,
        scheduledPosts,
        new Date(startDate),
        new Date(endDate),
        timezone ?? "UTC"
      );

      this.logInfo(ctx, "Scheduling slots calculated", {
        projectId,
        totalSlots: slots.length,
        rulesApplied: rules.length,
        existingPosts: scheduledPosts.length,
      });

      this.sendSuccess(ctx, {
        projectId,
        timezone,
        dateRange: {
          start: startDate,
          end: endDate,
        },
        slots,
        rules: rules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          platforms: rule.platforms,
          maxPostsPerDay: rule.maxPostsPerDay,
          maxPostsPerHour: rule.maxPostsPerHour,
          minIntervalMinutes: rule.minIntervalMinutes,
        })),
      });
    } catch (error) {
      this.logError(ctx, "Failed to fetch scheduling slots", { error });
      return this.sendError(ctx, 500, "Failed to fetch scheduling slots");
    }
  }

  /**
   * GET /api/analytics/optimal-times
   * Get optimal posting times based on historical analytics
   */
  async getOptimalPostingTimes(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Fetching optimal posting times");

    // Validate query parameters
    const validated = await this.validateQuery(ctx, OptimalTimesQuerySchema);
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { projectId, provider, lookbackDays, timezone } = validated.value;

    try {
      // Verify project exists
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        return this.sendError(ctx, 404, "Project not found");
      }

      // Calculate lookback date
      const lookbackDaysValue = lookbackDays ?? 30;
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - lookbackDaysValue);

      // Fetch analytics for published posts
      const analytics = await this.prisma.analytics.findMany({
        where: {
          post: {
            projectId,
            status: "PUBLISHED",
            publishedAt: {
              gte: lookbackDate,
            },
          },
          ...(provider && { provider: provider as ProviderName }),
        },
        include: {
          post: {
            select: {
              id: true,
              publishedAt: true,
            },
          },
        },
      });

      // Calculate optimal times based on engagement
      const optimalTimes = this.calculateOptimalTimes(analytics, timezone ?? "UTC");

      this.logInfo(ctx, "Optimal posting times calculated", {
        projectId,
        lookbackDays,
        analyticsCount: analytics.length,
        optimalTimesFound: optimalTimes.length,
      });

      this.sendSuccess(ctx, {
        projectId,
        provider,
        timezone,
        lookbackDays,
        analysisDate: new Date(),
        dataPoints: analytics.length,
        optimalTimes,
      });
    } catch (error) {
      this.logError(ctx, "Failed to calculate optimal posting times", { error });
      return this.sendError(ctx, 500, "Failed to calculate optimal posting times");
    }
  }

  /**
   * GET /api/scheduling/rules
   * Get scheduling rules and constraints for a project
   */
  async getSchedulingRules(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Fetching scheduling rules");

    // Validate query parameters
    const validated = await this.validateQuery(ctx, SchedulingRulesQuerySchema);
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { projectId, provider, isActive } = validated.value;

    try {
      // Verify project exists
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        return this.sendError(ctx, 404, "Project not found");
      }

      // Build where clause
      const whereClause: Prisma.SchedulingRuleWhereInput = { projectId };

      if (provider) {
        whereClause.platforms = {
          has: provider as ProviderName,
        };
      }

      if (isActive !== undefined) {
        whereClause.isActive = isActive;
      }

      // Fetch scheduling rules
      const rules = await this.prisma.schedulingRule.findMany({
        where: whereClause,
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      });

      this.logInfo(ctx, "Scheduling rules fetched", {
        projectId,
        rulesCount: rules.length,
      });

      this.sendSuccess(ctx, {
        projectId,
        total: rules.length,
        rules: rules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          description: rule.description,
          isActive: rule.isActive,
          contentTypes: rule.contentTypes,
          platforms: rule.platforms,
          timezone: rule.timezone,
          optimalTimes: rule.optimalTimes,
          blackoutPeriods: rule.blackoutPeriods,
          maxPostsPerDay: rule.maxPostsPerDay,
          maxPostsPerHour: rule.maxPostsPerHour,
          minIntervalMinutes: rule.minIntervalMinutes,
          priorityBoost: rule.priorityBoost,
          hashtagRules: rule.hashtagRules,
          timesApplied: rule.timesApplied,
          successRate: rule.successRate,
          avgPerformance: rule.avgPerformance,
          createdAt: rule.createdAt,
          updatedAt: rule.updatedAt,
        })),
      });
    } catch (error) {
      this.logError(ctx, "Failed to fetch scheduling rules", { error });
      return this.sendError(ctx, 500, "Failed to fetch scheduling rules");
    }
  }

  /**
   * POST /api/scheduling/slots
   * Create a new schedule slot for a project
   */
  async createScheduleSlot(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Creating schedule slot");

    // Validate body
    const validated = await this.validateBody(ctx, CreateScheduleSlotBodySchema);
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { projectId, dayOfWeek, hour, minute, timezone, providers, isActive } = validated.value;

    try {
      // Verify project exists
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        return this.sendError(ctx, 404, "Project not found");
      }

      // Create scheduling rule for this slot
      const rule = await this.prisma.schedulingRule.create({
        data: {
          projectId,
          accountId: project.accountId,
          name: `Auto-generated slot: ${this.formatSlotName(dayOfWeek, hour, minute ?? 0)}`,
          description: `Scheduled slot for ${providers.join(", ")}`,
          isActive: isActive ?? true,
          contentTypes: [],
          platforms: providers as ProviderName[],
          timezone: timezone ?? "UTC",
          optimalTimes: [
            {
              dayOfWeek,
              hour,
              minute: minute ?? 0,
            },
          ],
          blackoutPeriods: [],
        },
      });

      this.logInfo(ctx, "Schedule slot created", {
        ruleId: rule.id,
        projectId,
        dayOfWeek,
        hour,
        minute,
      });

      this.sendSuccess(
        ctx,
        {
          id: rule.id,
          projectId: rule.projectId,
          name: rule.name,
          isActive: rule.isActive,
          platforms: rule.platforms,
          timezone: rule.timezone,
          slot: {
            dayOfWeek,
            hour,
            minute,
          },
          createdAt: rule.createdAt,
        },
        201
      );
    } catch (error) {
      this.logError(ctx, "Failed to create schedule slot", { error });
      return this.sendError(ctx, 500, "Failed to create schedule slot");
    }
  }

  /**
   * POST /api/scheduling/slots/bulk
   * Bulk create schedule slots for a project
   */
  async bulkCreateScheduleSlots(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Bulk creating schedule slots");

    // Validate body
    const validated = await this.validateBody(ctx, BulkCreateScheduleSlotsBodySchema);
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { projectId, slots, timezone, isActive } = validated.value;

    try {
      // Verify project exists
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        return this.sendError(ctx, 404, "Project not found");
      }

      // Create all scheduling rules in a transaction
      const createdRules = await this.prisma.$transaction(
        slots.map((slot) =>
          this.prisma.schedulingRule.create({
            data: {
              projectId,
              accountId: project.accountId,
              name: `Auto-generated slot: ${this.formatSlotName(slot.dayOfWeek, slot.hour, slot.minute ?? 0)}`,
              description: `Scheduled slot for ${slot.providers.join(", ")}`,
              isActive: isActive ?? true,
              contentTypes: [],
              platforms: slot.providers as ProviderName[],
              timezone: timezone ?? "UTC",
              optimalTimes: [
                {
                  dayOfWeek: slot.dayOfWeek,
                  hour: slot.hour,
                  minute: slot.minute ?? 0,
                },
              ],
              blackoutPeriods: [],
            },
          })
        )
      );

      this.logInfo(ctx, "Schedule slots created in bulk", {
        projectId,
        slotsCreated: createdRules.length,
      });

      this.sendSuccess(
        ctx,
        {
          projectId,
          timezone: timezone ?? "UTC",
          total: createdRules.length,
          slots: createdRules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            platforms: rule.platforms,
            timezone: rule.timezone,
            slot:
              Array.isArray(rule.optimalTimes) && rule.optimalTimes.length > 0
                ? rule.optimalTimes[0]
                : null,
            createdAt: rule.createdAt,
          })),
        },
        201
      );
    } catch (error) {
      this.logError(ctx, "Failed to bulk create schedule slots", { error });
      return this.sendError(ctx, 500, "Failed to bulk create schedule slots");
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Calculate available scheduling slots based on rules and existing posts
   */
  private calculateAvailableSlots(
    rules: SchedulingRule[],
    scheduledPosts: ScheduledPostSlot[],
    startDate: Date,
    endDate: Date,
    _timezone: string
  ): Array<{
    datetime: string;
    dayOfWeek: number;
    hour: number;
    minute: number;
    available: boolean;
    reason?: string;
  }> {
    const slots: Array<{
      datetime: string;
      dayOfWeek: number;
      hour: number;
      minute: number;
      available: boolean;
      reason?: string;
    }> = [];

    // Extract optimal times from rules
    const optimalTimes: Array<{ dayOfWeek: number; hour: number; minute: number }> = [];
    for (const rule of rules) {
      if (rule.optimalTimes && Array.isArray(rule.optimalTimes)) {
        for (const item of rule.optimalTimes) {
          if (
            item &&
            typeof item === "object" &&
            "dayOfWeek" in item &&
            "hour" in item &&
            "minute" in item &&
            typeof (item as Record<string, unknown>).dayOfWeek === "number" &&
            typeof (item as Record<string, unknown>).hour === "number" &&
            typeof (item as Record<string, unknown>).minute === "number"
          ) {
            optimalTimes.push(item as { dayOfWeek: number; hour: number; minute: number });
          }
        }
      }
    }

    // If no optimal times defined, return empty slots
    if (optimalTimes.length === 0) {
      return slots;
    }

    // Generate slots for each day in the date range
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();

      // Check each optimal time for this day
      for (const time of optimalTimes) {
        if (time.dayOfWeek === dayOfWeek) {
          const slotDate = new Date(currentDate);
          slotDate.setHours(time.hour, time.minute, 0, 0);

          // Skip if slot is in the past
          if (slotDate <= new Date()) {
            continue;
          }

          // Check if slot is already taken
          const isTaken = scheduledPosts.some((post) => {
            if (!post.scheduledAt) return false;
            const postDate = new Date(post.scheduledAt);
            return (
              postDate.getTime() >= slotDate.getTime() - 30 * 60 * 1000 && // 30 min before
              postDate.getTime() <= slotDate.getTime() + 30 * 60 * 1000 // 30 min after
            );
          });

          slots.push({
            datetime: slotDate.toISOString(),
            dayOfWeek: time.dayOfWeek,
            hour: time.hour,
            minute: time.minute,
            available: !isTaken,
            ...(isTaken && { reason: "Slot already occupied" }),
          });
        }
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return slots;
  }

  /**
   * Calculate optimal posting times based on analytics engagement data
   */
  private calculateOptimalTimes(
    analytics: AnalyticsWithPost[],
    _timezone: string
  ): Array<{
    dayOfWeek: number;
    hour: number;
    avgEngagement: number;
    sampleSize: number;
    confidence: number;
  }> {
    // Group analytics by day of week and hour
    const groupedData: Map<
      string,
      {
        totalEngagement: number;
        count: number;
        dayOfWeek: number;
        hour: number;
      }
    > = new Map();

    for (const analytic of analytics) {
      if (!analytic.post?.publishedAt) continue;

      const publishedDate = new Date(analytic.post.publishedAt);
      const dayOfWeek = publishedDate.getDay();
      const hour = publishedDate.getHours();

      // Calculate engagement score
      const engagement =
        (analytic.likes || 0) +
        (analytic.comments || 0) * 2 + // Comments weighted higher
        (analytic.shares || 0) * 3 + // Shares weighted highest
        (analytic.views || 0) * 0.1; // Views weighted lower

      const key = `${dayOfWeek}-${hour}`;
      const existing = groupedData.get(key);

      if (existing) {
        existing.totalEngagement += engagement;
        existing.count += 1;
      } else {
        groupedData.set(key, {
          totalEngagement: engagement,
          count: 1,
          dayOfWeek,
          hour,
        });
      }
    }

    // Calculate average engagement and sort by performance
    const optimalTimes = Array.from(groupedData.values())
      .map((data) => ({
        dayOfWeek: data.dayOfWeek,
        hour: data.hour,
        avgEngagement: data.totalEngagement / data.count,
        sampleSize: data.count,
        confidence: Math.min(data.count / 10, 1), // Max confidence at 10+ samples
      }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement)
      .slice(0, 10); // Return top 10 optimal times

    return optimalTimes;
  }

  /**
   * Format slot name for display
   */
  private formatSlotName(dayOfWeek: number, hour: number, minute: number): string {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = days[dayOfWeek];
    const time = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    return `${dayName} ${time}`;
  }
}
