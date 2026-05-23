/**
 * @file realtimeAnalytics.ts
 * @description Real-time analytics metrics poller. Every 30s it reads the latest
 *              analytics for the posts that currently have a live SSE subscriber
 *              (via AnalyticsStreamBroadcaster), computes per-cycle deltas against a
 *              cross-pod keyed-state buffer (CachePort), and broadcasts metric events.
 *              Transport (SSE) lives in the analytics route + the broadcaster; this
 *              service is transport-agnostic. Replaces a never-wired WebSocket service.
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import type { CachePort } from "@ports/core";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { createLogger } from "../lib/logger.js";

const analyticsLogger = createLogger("analytics");
import type { AnalyticsReadRepositoryPort } from "../domain/repositories/AnalyticsReadRepository.js";
import type { AnalyticsStreamBroadcaster } from "../services/AnalyticsStreamBroadcaster.js";
import { BaseService } from "../services/BaseService";

/**
 * A single post's metrics for one provider at a point in time, with optional
 * per-cycle deltas vs the previous poll.
 */
export interface RealtimeMetrics {
  timestamp: Date;
  postId: string;
  provider: string;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagementRate: number;
  };
  deltaMetrics?: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
  };
}

/**
 * Cross-pod last-known-value buffer key prefix. Cf. Confluent KTable / Flink
 * keyed-state idiom: this is NOT a TTL-bounded cache — it's distributed keyed
 * state used to compute metric deltas vs the previous cycle. Failover scenarios
 * (pod 1 dies → pod 2 reads previous value) require Redis backing rather than a
 * per-instance Map.
 */
const REALTIME_METRICS_KEY_PREFIX = "realtime-metrics:";

/**
 * TTL choice for the keyed-state buffer. 24h is a generous failover window for a
 * ~30s update cycle — TTL acts as orphan cleanup cap, not freshness signal.
 * Canon: AWS Flink stream-enrichment patterns ("TTL as long as the operation
 * requires"). 1h would be too short (60 missed cycles wipes state, next reading
 * shows bogus delta vs zero).
 */
const REALTIME_METRICS_TTL_SECONDS = 24 * 60 * 60;

export class RealtimeAnalyticsService extends BaseService {
  private readonly metricsTaskId = "realtime-analytics-metrics-updater";

  constructor(
    private readonly scheduler: BackgroundTaskScheduler,
    private readonly cache: CachePort,
    private readonly analyticsRepository: AnalyticsReadRepositoryPort,
    private readonly broadcaster: AnalyticsStreamBroadcaster
  ) {
    super("RealtimeAnalyticsService");
    this.startMetricsUpdater();
  }

  /**
   * Generate a unique SSE subscription id.
   */
  public generateConnectionId(): string {
    return `conn_${randomUUID()}`;
  }

  /**
   * Calculate engagement rate from analytics data: (likes + comments + shares)
   * over views, as a percentage. Returns 0 when there are no views.
   */
  public calculateEngagementRate(analytics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  }): number {
    const views = analytics.views || 0;
    if (views === 0) return 0;

    const totalEngagements =
      (analytics.likes || 0) + (analytics.comments || 0) + (analytics.shares || 0);
    return (totalEngagements / views) * 100;
  }

  /**
   * Return the current (latest) metrics for a single post, or null if the post
   * has no analytics yet. Used by the SSE route for the initial snapshot.
   */
  public async getCurrentMetrics(postId: string): Promise<RealtimeMetrics | null> {
    try {
      const [analytics] = await this.analyticsRepository.getLatestForPosts([postId]);

      if (!analytics) return null;

      return {
        timestamp: new Date(),
        postId,
        provider: analytics.provider,
        metrics: {
          views: analytics.views || 0,
          likes: analytics.likes || 0,
          comments: analytics.comments || 0,
          shares: analytics.shares || 0,
          engagementRate: this.calculateEngagementRate(analytics),
        },
      };
    } catch (error: unknown) {
      analyticsLogger.error({ err: error }, "Error getting current metrics");
      return null;
    }
  }

  /**
   * Cleanup on service shutdown — unregister the metrics poll. The previous-metrics
   * buffer is cross-pod state in CachePort and is intentionally NOT cleared (that
   * would wipe other pods' state); its 24h TTL handles orphan cleanup.
   */
  shutdown(): void {
    this.scheduler.unregister(this.metricsTaskId);
  }

  /**
   * Register the periodic metrics updater (30s) with the background scheduler.
   */
  private startMetricsUpdater(): void {
    this.scheduler.register(this.metricsTaskId, () => this.updateAllMetrics(), 30_000);
  }

  /**
   * Poll the latest analytics for every post that currently has a live SSE
   * subscriber, compute per-cycle deltas against the CachePort keyed-state
   * buffer, persist the new value as the next cycle's "previous", and broadcast.
   */
  private async updateAllMetrics(): Promise<void> {
    const watchedPostIds = this.broadcaster.getWatchedPostIds();
    if (watchedPostIds.length === 0) return;

    try {
      const analytics = await this.analyticsRepository.getByPostIds(watchedPostIds, {
        orderBy: { capturedAt: "desc" },
      });

      // Keep only the latest record per postId+provider.
      interface AnalyticsRecord {
        views: number | null;
        likes: number | null;
        comments: number | null;
        shares: number | null;
        postId: string | null;
        provider: string;
      }
      const latestMetrics = new Map<string, AnalyticsRecord>();
      analytics.forEach((a) => {
        const key = `${a.postId}:${a.provider}`;
        if (!latestMetrics.has(key)) {
          latestMetrics.set(key, a);
        }
      });

      for (const [key, analyticsRecord] of latestMetrics) {
        const splitKey = key.split(":");
        if (splitKey.length !== 2) continue;
        const [postId, provider] = splitKey;
        if (!postId || !provider) continue;

        const bufferKey = `${REALTIME_METRICS_KEY_PREFIX}${key}`;
        const previousMetrics = await this.cache.get<RealtimeMetrics>(bufferKey);

        const currentMetrics: RealtimeMetrics = {
          timestamp: new Date(),
          postId,
          provider,
          metrics: {
            views: analyticsRecord.views || 0,
            likes: analyticsRecord.likes || 0,
            comments: analyticsRecord.comments || 0,
            shares: analyticsRecord.shares || 0,
            engagementRate: this.calculateEngagementRate(analyticsRecord),
          },
        };

        // Missing key on first cycle = no delta (expected).
        if (previousMetrics) {
          currentMetrics.deltaMetrics = {
            views: currentMetrics.metrics.views - previousMetrics.metrics.views,
            likes: currentMetrics.metrics.likes - previousMetrics.metrics.likes,
            comments: currentMetrics.metrics.comments - previousMetrics.metrics.comments,
            shares: currentMetrics.metrics.shares - previousMetrics.metrics.shares,
          };
        }

        await this.cache.set(bufferKey, currentMetrics, {
          ttlSeconds: REALTIME_METRICS_TTL_SECONDS,
        });

        await this.broadcaster.broadcast(
          {
            timestamp: currentMetrics.timestamp.toISOString(),
            postId,
            provider,
            metrics: currentMetrics.metrics,
            ...(currentMetrics.deltaMetrics !== undefined && {
              deltaMetrics: currentMetrics.deltaMetrics,
            }),
          },
          postId
        );
      }
    } catch (error: unknown) {
      analyticsLogger.error({ err: error }, "Error updating metrics");
    }
  }
}
