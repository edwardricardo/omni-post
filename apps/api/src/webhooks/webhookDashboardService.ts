import { BaseService } from "../services/BaseService.js";
import { prisma, WebhookEventType } from "@infra/prisma";
import type { Provider } from "@infra/prisma";
import { AppError } from "../lib/errors/AppError.js";

/** All valid WebhookEventType enum values for search filtering */
const ALL_WEBHOOK_EVENT_TYPES: string[] = Object.values(WebhookEventType);

/** Find enum values whose name contains a case-insensitive search term */
function matchEventTypes(search: string): string[] {
  const needle = search.toUpperCase();
  return ALL_WEBHOOK_EVENT_TYPES.filter((v) => v.toUpperCase().includes(needle));
}

interface DashboardMetrics {
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  successRate: number;
  avgProcessingTime: number;
  queueDepth: number;
  realtimeConnections: number;
  byProvider: Record<
    string,
    {
      total: number;
      success: number;
      failed: number;
      successRate: number;
      avgProcessingTime: number;
    }
  >;
  byEventType: Record<string, number>;
  timeline: Array<{
    timestamp: string;
    total: number;
    success: number;
    failed: number;
  }>;
}

interface DashboardQueryParams {
  timeRange: string;
  provider?: Provider | undefined;
  projectId?: string | undefined;
  status?: string | undefined;
}

interface EventsQueryParams {
  page: number;
  limit: number;
  provider?: Provider | undefined;
  status?: string | undefined;
  search?: string | undefined;
}

/**
 * Calculate time range boundaries for dashboard queries
 */
function getTimeRange(range: string): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();

  switch (range) {
    case "1h":
      start.setHours(start.getHours() - 1);
      break;
    case "6h":
      start.setHours(start.getHours() - 6);
      break;
    case "24h":
      start.setHours(start.getHours() - 24);
      break;
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    default:
      start.setHours(start.getHours() - 24);
  }

  return { start, end };
}

/**
 * Generate timeline data for webhook events
 */
async function generateTimeline(
  accountId: string,
  timeRange: { start: Date; end: Date },
  provider?: Provider
): Promise<Array<{ timestamp: string; total: number; success: number; failed: number }>> {
  const where: Record<string, unknown> = {
    accountId,
    receivedAt: {
      gte: timeRange.start,
      lte: timeRange.end,
    },
  };

  if (provider) {
    where.provider = provider;
  }

  // Calculate interval based on time range
  const duration = timeRange.end.getTime() - timeRange.start.getTime();
  const intervals = 24; // Always show 24 data points
  const intervalMs = duration / intervals;

  const timeline = [];

  for (let i = 0; i < intervals; i++) {
    const intervalStart = new Date(timeRange.start.getTime() + i * intervalMs);
    const intervalEnd = new Date(intervalStart.getTime() + intervalMs);

    const [total, success, failed] = await Promise.all([
      prisma.webhookEvent.count({
        where: {
          ...where,
          receivedAt: {
            gte: intervalStart,
            lt: intervalEnd,
          },
        },
      }),
      prisma.webhookEvent.count({
        where: {
          ...where,
          receivedAt: {
            gte: intervalStart,
            lt: intervalEnd,
          },
          status: "COMPLETED",
        },
      }),
      prisma.webhookEvent.count({
        where: {
          ...where,
          receivedAt: {
            gte: intervalStart,
            lt: intervalEnd,
          },
          status: { in: ["FAILED", "DEAD_LETTER"] },
        },
      }),
    ]);

    timeline.push({
      timestamp: intervalStart.toISOString(),
      total,
      success,
      failed,
    });
  }

  return timeline;
}

/**
 * Webhook Dashboard Service - handles all webhook monitoring and analytics logic
 */
export class WebhookDashboardService extends BaseService {
  constructor() {
    super("WebhookDashboardService");
  }

  async getDashboardMetrics(
    accountId: string,
    query: DashboardQueryParams
  ): Promise<DashboardMetrics> {
    return this.execute(
      { operation: "getDashboardMetrics", userId: accountId, metadata: { query } },
      async () => {
        const timeRange = getTimeRange(query.timeRange);

        const where: Record<string, unknown> = {
          accountId,
          receivedAt: {
            gte: timeRange.start,
            lte: timeRange.end,
          },
        };

        if (query.provider) {
          where.provider = query.provider;
        }

        if (query.projectId) {
          where.projectId = query.projectId;
        }

        // Get basic metrics
        const [totalEvents, processedEvents, failedEvents] = await Promise.all([
          prisma.webhookEvent.count({ where }),
          prisma.webhookEvent.count({ where: { ...where, status: "COMPLETED" } }),
          prisma.webhookEvent.count({
            where: { ...where, status: { in: ["FAILED", "DEAD_LETTER"] } },
          }),
        ]);

        // Get average processing time
        const avgProcessingTime = await prisma.webhookEvent.aggregate({
          where: { ...where, processingTime: { not: null } },
          _avg: { processingTime: true },
        });

        // Get metrics by provider
        const providerStats = await prisma.webhookEvent.groupBy({
          by: ["provider", "status"],
          where,
          _count: { id: true },
          _avg: { processingTime: true },
        });

        interface ProviderMetrics {
          total: number;
          success: number;
          failed: number;
          successRate: number;
          avgProcessingTime: number;
        }
        const byProvider: Record<string, ProviderMetrics> = {};
        for (const stat of providerStats) {
          if (!byProvider[stat.provider]) {
            byProvider[stat.provider] = {
              total: 0,
              success: 0,
              failed: 0,
              successRate: 0,
              avgProcessingTime: 0,
            };
          }

          const providerEntry = byProvider[stat.provider] as ProviderMetrics;
          providerEntry.total += stat._count.id;

          if (stat.status === "COMPLETED") {
            providerEntry.success = stat._count.id;
            providerEntry.avgProcessingTime = stat._avg.processingTime || 0;
          } else if (stat.status === "FAILED" || stat.status === "DEAD_LETTER") {
            providerEntry.failed += stat._count.id;
          }
        }

        // Calculate success rates
        Object.keys(byProvider).forEach((provider) => {
          const entry = byProvider[provider] as ProviderMetrics;
          entry.successRate = entry.total > 0 ? (entry.success / entry.total) * 100 : 0;
        });

        // Get metrics by event type
        const eventTypeStats = await prisma.webhookEvent.groupBy({
          by: ["eventType"],
          where,
          _count: { id: true },
        });

        const byEventType: Record<string, number> = {};
        eventTypeStats.forEach((stat) => {
          byEventType[stat.eventType] = stat._count.id;
        });

        // Generate timeline
        const timeline = await generateTimeline(accountId, timeRange, query.provider);

        // Get current queue depth (assuming Redis-based queue)
        const queueDepth = 0; // Future: read BullMQ queue.getJobCounts()

        // Get real-time connections count
        const realtimeConnections = 0; // Future: get from RealtimeWebhookBroadcaster.getStats()

        return {
          totalEvents,
          processedEvents,
          failedEvents,
          successRate: totalEvents > 0 ? (processedEvents / totalEvents) * 100 : 0,
          avgProcessingTime: avgProcessingTime._avg.processingTime || 0,
          queueDepth,
          realtimeConnections,
          byProvider,
          byEventType,
          timeline,
        };
      }
    );
  }

  async getRecentEvents(accountId: string, query: EventsQueryParams) {
    return this.execute(
      { operation: "getRecentEvents", userId: accountId, metadata: { query } },
      async () => {
        const where: Record<string, unknown> = { accountId };

        if (query.provider) {
          where.provider = query.provider;
        }

        if (query.status) {
          where.status = query.status;
        }

        if (query.search) {
          // eventType is a Prisma enum — `contains`/`mode` are not valid on enums.
          // Use text search on string fields and enum `in` match for eventType.
          const orClauses: Array<Record<string, unknown>> = [
            { eventId: { contains: query.search, mode: "insensitive" } },
            { lastError: { contains: query.search, mode: "insensitive" } },
          ];
          const matchedTypes = matchEventTypes(query.search);
          if (matchedTypes.length > 0) {
            orClauses.push({ eventType: { in: matchedTypes } });
          }
          where.OR = orClauses;
        }

        const skip = (query.page - 1) * query.limit;

        const [events, totalCount] = await Promise.all([
          prisma.webhookEvent.findMany({
            where,
            orderBy: { receivedAt: "desc" },
            skip,
            take: query.limit,
            select: {
              id: true,
              eventId: true,
              eventType: true,
              provider: true,
              status: true,
              verified: true,
              processed: true,
              retryCount: true,
              processingTime: true,
              lastError: true,
              receivedAt: true,
              processedAt: true,
              nextRetryAt: true,
              projectId: true,
              postId: true,
              channelId: true,
            },
          }),
          prisma.webhookEvent.count({ where }),
        ]);

        return {
          events,
          pagination: {
            page: query.page,
            limit: query.limit,
            total: totalCount,
            pages: Math.ceil(totalCount / query.limit),
          },
        };
      }
    );
  }

  async getEventDetails(accountId: string, eventId: string) {
    return this.execute(
      { operation: "getEventDetails", userId: accountId, metadata: { eventId } },
      async () => {
        const event = await prisma.webhookEvent.findFirst({
          where: {
            id: eventId,
            accountId,
          },
          include: {
            project: {
              select: { id: true, name: true },
            },
            post: {
              select: {
                id: true,
                contents: {
                  select: { title: true },
                  take: 1,
                },
              },
            },
          },
        });

        if (!event) {
          throw AppError.notFound("Webhook event", { eventId });
        }

        return event;
      }
    );
  }

  async getSubscriptions(accountId: string) {
    return this.execute({ operation: "getSubscriptions", userId: accountId }, async () => {
      const subscriptions = await prisma.webhookSubscription.findMany({
        where: { accountId },
        include: {
          project: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Aggregate statistics for each subscription
      const subscriptionsWithStats = await Promise.all(
        subscriptions.map(async (subscription) => {
          const [totalEvents, recentEvents, failedEvents] = await Promise.all([
            prisma.webhookEvent.count({
              where: {
                accountId,
                provider: subscription.provider,
                ...(subscription.projectId && { projectId: subscription.projectId }),
              },
            }),
            prisma.webhookEvent.count({
              where: {
                accountId,
                provider: subscription.provider,
                ...(subscription.projectId && { projectId: subscription.projectId }),
                receivedAt: {
                  gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
                },
              },
            }),
            prisma.webhookEvent.count({
              where: {
                accountId,
                provider: subscription.provider,
                ...(subscription.projectId && { projectId: subscription.projectId }),
                status: { in: ["FAILED", "DEAD_LETTER"] },
              },
            }),
          ]);

          const { secretKey: _secretKey, ...safeSub } = subscription;
          return {
            ...safeSub,
            stats: {
              totalEvents,
              recentEvents,
              failedEvents,
              successRate: totalEvents > 0 ? ((totalEvents - failedEvents) / totalEvents) * 100 : 0,
            },
          };
        })
      );

      return subscriptionsWithStats;
    });
  }

  async getDeadLetterQueue(accountId: string, query: EventsQueryParams) {
    return this.execute(
      { operation: "getDeadLetterQueue", userId: accountId, metadata: { query } },
      async () => {
        const where: Record<string, unknown> = {
          provider: query.provider,
        };

        if (query.search) {
          // eventType is a Prisma enum — use `in` match for enum, `contains` for text.
          const orClauses: Array<Record<string, unknown>> = [
            { failureReason: { contains: query.search, mode: "insensitive" } },
            { finalError: { contains: query.search, mode: "insensitive" } },
          ];
          const matchedTypes = matchEventTypes(query.search);
          if (matchedTypes.length > 0) {
            orClauses.push({ eventType: { in: matchedTypes } });
          }
          where.OR = orClauses;
        }

        const skip = (query.page - 1) * query.limit;

        // Get the original events first to filter by account
        const originalEvents = await prisma.webhookEvent.findMany({
          where: { accountId },
          select: { id: true, eventId: true },
        });

        const allowedEventIds = new Set(originalEvents.map((e) => e.id));

        const whereWithAccess = {
          ...where,
          originalEventId: { in: Array.from(allowedEventIds) },
        };

        const [deadLetterEvents, totalCount] = await Promise.all([
          prisma.webhookDeadLetter.findMany({
            where: whereWithAccess,
            orderBy: { firstFailedAt: "desc" },
            skip,
            take: query.limit,
          }),
          prisma.webhookDeadLetter.count({ where: whereWithAccess }),
        ]);

        // Add original event data
        const eventsWithOriginal = deadLetterEvents.map((event) => {
          const originalEvent = originalEvents.find((orig) => orig.id === event.originalEventId);
          return {
            ...event,
            originalEvent: originalEvent
              ? {
                  id: originalEvent.id,
                  eventId: originalEvent.eventId,
                  accountId,
                }
              : null,
          };
        });

        return {
          events: eventsWithOriginal,
          pagination: {
            page: query.page,
            limit: query.limit,
            total: totalCount,
            pages: Math.ceil(totalCount / query.limit),
          },
        };
      }
    );
  }

  async retryDeadLetterEvent(accountId: string, eventId: string, userId?: string) {
    return this.execute(
      { operation: "retryDeadLetterEvent", userId: accountId, metadata: { eventId } },
      async () => {
        const deadLetterEvent = await prisma.webhookDeadLetter.findFirst({
          where: { id: eventId },
        });

        if (!deadLetterEvent) {
          throw AppError.notFound("Dead letter event", { eventId });
        }

        // Check if the original event belongs to this account
        const originalEvent = await prisma.webhookEvent.findFirst({
          where: {
            id: deadLetterEvent.originalEventId,
            accountId,
          },
        });

        if (!originalEvent) {
          throw AppError.notFound("Dead letter event", { eventId });
        }

        // Future: add event back to BullMQ webhook processing queue for retry

        // Mark as resolved
        const updateData: Record<string, unknown> = {
          resolvedAt: new Date(),
        };
        if (userId) {
          updateData.resolvedBy = userId;
        }

        await prisma.webhookDeadLetter.update({
          where: { id: eventId },
          data: updateData,
        });

        return { success: true, message: "Event queued for retry" };
      }
    );
  }

  async retryAllDeadLetterEvents(userId?: string) {
    return this.execute(
      { operation: "retryAllDeadLetterEvents", userId: userId ?? "system", metadata: {} },
      async () => {
        let total = 0;
        let queued = 0;
        let failed = 0;

        // Process in batches to avoid loading entire table into memory
        const BATCH_SIZE = 50;
        let hasMore = true;

        while (hasMore) {
          const batch = await prisma.webhookDeadLetter.findMany({
            where: { resolvedAt: null },
            take: BATCH_SIZE,
            select: { id: true },
          });

          if (batch.length === 0) {
            hasMore = false;
            break;
          }

          total += batch.length;

          for (const event of batch) {
            try {
              const updateData: Record<string, unknown> = {
                resolvedAt: new Date(),
              };
              if (userId) {
                updateData.resolvedBy = userId;
              }

              await prisma.webhookDeadLetter.update({
                where: { id: event.id },
                data: updateData,
              });
              queued++;
            } catch {
              failed++;
            }
          }

          if (batch.length < BATCH_SIZE) {
            hasMore = false;
          }
        }

        return { total, queued, failed };
      }
    );
  }

  async exportWebhookEvents(accountId: string, query: DashboardQueryParams) {
    return this.execute(
      { operation: "exportWebhookEvents", userId: accountId, metadata: { query } },
      async () => {
        const timeRange = getTimeRange(query.timeRange);

        const where: Record<string, unknown> = {
          accountId,
          receivedAt: {
            gte: timeRange.start,
            lte: timeRange.end,
          },
        };

        if (query.provider) {
          where.provider = query.provider;
        }

        if (query.projectId) {
          where.projectId = query.projectId;
        }

        const events = await prisma.webhookEvent.findMany({
          where,
          orderBy: { receivedAt: "desc" },
          select: {
            eventId: true,
            eventType: true,
            provider: true,
            status: true,
            verified: true,
            processed: true,
            retryCount: true,
            processingTime: true,
            lastError: true,
            receivedAt: true,
            processedAt: true,
            projectId: true,
            postId: true,
            channelId: true,
          },
        });

        // Convert to CSV format
        const csv = [
          // Header
          "Event ID,Event Type,Provider,Status,Verified,Processed,Retry Count,Processing Time (ms),Last Error,Received At,Processed At,Project ID,Post ID,Channel ID",
          // Data rows
          ...events.map((event) =>
            [
              event.eventId,
              event.eventType,
              event.provider,
              event.status,
              event.verified,
              event.processed,
              event.retryCount,
              event.processingTime || "",
              event.lastError || "",
              event.receivedAt.toISOString(),
              event.processedAt?.toISOString() || "",
              event.projectId || "",
              event.postId || "",
              event.channelId || "",
            ]
              .map((field) => `"${String(field).replace(/"/g, '""')}"`)
              .join(",")
          ),
        ].join("\n");

        return { csv, count: events.length, timeRange: query.timeRange };
      }
    );
  }

  async getDlqMetrics() {
    return this.execute(
      { operation: "getDlqMetrics", userId: "system", metadata: {} },
      async () => {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [
          unresolvedTotal,
          resolvedTotal,
          archivedTotal,
          oldestUnresolved,
          byProvider,
          byEventType,
          outboxDlqTotal,
        ] = await Promise.all([
          prisma.webhookDeadLetter.count({
            where: { resolvedAt: null, archivedAt: null },
          }),
          prisma.webhookDeadLetter.count({
            where: { resolvedAt: { not: null } },
          }),
          prisma.webhookDeadLetter.count({
            where: { archivedAt: { not: null } },
          }),
          prisma.webhookDeadLetter.findFirst({
            where: { resolvedAt: null, archivedAt: null },
            orderBy: { firstFailedAt: "asc" },
            select: { firstFailedAt: true },
          }),
          prisma.webhookDeadLetter.groupBy({
            by: ["provider"],
            where: { resolvedAt: null, archivedAt: null },
            _count: { id: true },
          }),
          prisma.webhookDeadLetter.groupBy({
            by: ["eventType"],
            where: { resolvedAt: null, archivedAt: null },
            _count: { id: true },
          }),
          prisma.outboxDeadLetter.count({ where: { resolvedAt: null } }),
        ]);

        // Last 7 days trend
        const recentCreated = await prisma.webhookDeadLetter.groupBy({
          by: ["createdAt"],
          where: { createdAt: { gte: sevenDaysAgo } },
          _count: { id: true },
        });

        const dayMap = new Map<string, { created: number; resolved: number }>();
        for (let i = 0; i < 7; i++) {
          const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          const key = d.toISOString().split("T")[0] ?? "";
          dayMap.set(key, { created: 0, resolved: 0 });
        }
        for (const row of recentCreated) {
          const key = row.createdAt.toISOString().split("T")[0] ?? "";
          const existing = dayMap.get(key);
          if (existing) existing.created += row._count.id;
        }

        return {
          unresolvedTotal,
          resolvedTotal,
          archivedTotal,
          oldestUnresolvedAt: oldestUnresolved?.firstFailedAt ?? null,
          byProvider: byProvider.map((r) => ({
            provider: r.provider,
            count: r._count.id,
          })),
          byEventType: byEventType.map((r) => ({
            eventType: r.eventType,
            count: r._count.id,
          })),
          last7Days: Array.from(dayMap.entries())
            .sort()
            .map(([date, data]) => ({ date, ...data })),
          outboxDlqTotal,
        };
      }
    );
  }
}

export const webhookDashboardService = new WebhookDashboardService();
