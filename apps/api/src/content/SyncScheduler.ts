/**
 * SyncScheduler - Sync scheduling and real-time monitoring
 *
 * Manages sync scheduling, real-time content change monitoring,
 * Redis stream processing, and metrics collection.
 */

import Redis from "ioredis";
import type { VersionDiff } from "@shared/orchestration";
import type { ProviderId } from "../providers/providerAdapter.interface";
import { EventService } from "../events/EventService";
import { logger } from "../lib/logger.js";

export interface RealtimeSyncEvent {
  id: string;
  type: "content_changed" | "sync_started" | "sync_completed" | "conflict_detected" | "sync_failed";
  postId: string;
  providerId: ProviderId;
  timestamp: Date;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SyncMetrics {
  totalTransactions: number;
  successfulSyncs: number;
  failedSyncs: number;
  conflictsDetected: number;
  conflictsResolved: number;
  averageSyncTime: number;
  dataTransferred: number; // bytes
  lastSyncDuration: number;
}

export class SyncScheduler {
  private redis: Redis;
  private eventService: EventService;

  private realtimeSubscriptions = new Map<string, Set<string>>(); // postId -> channelIds
  private channelMetrics = new Map<string, SyncMetrics>();
  private metricsCollectionInterval: NodeJS.Timeout | undefined;
  private processorRunning = false;

  constructor(dependencies: { redis: Redis; eventService: EventService }) {
    this.redis = dependencies.redis;
    this.eventService = dependencies.eventService;
  }

  /**
   * Setup Redis streams for real-time sync
   */
  async setupRealtimeStreams(): Promise<void> {
    const streams = ["sync:content:changes", "sync:transactions", "sync:conflicts", "sync:metrics"];

    for (const stream of streams) {
      try {
        await this.redis.xgroup("CREATE", stream, "sync-engine", "$", "MKSTREAM");
      } catch {
        // Group might already exist
      }
    }
  }

  /**
   * Register event handlers for content changes and provider status
   */
  registerEventHandlers(
    onContentChange: (
      postId: string,
      changes: VersionDiff[],
      providerId: ProviderId
    ) => Promise<void>,
    onProviderStatusChange: (providerId: ProviderId, status: string) => Promise<void>
  ): void {
    // Listen for content change events
    this.eventService.registerHandler("POST_UPDATED", {
      eventType: "POST_UPDATED",
      handle: async (event) => {
        const data = event.data as { postId: string; changes?: VersionDiff[]; providerId: string };
        const { postId, changes, providerId } = data;
        await onContentChange(postId, changes || [], providerId as ProviderId);
      },
    });

    // Listen for provider status changes
    this.eventService.registerHandler("PROVIDER_STATUS_CHANGED", {
      eventType: "PROVIDER_STATUS_CHANGED",
      handle: async (event) => {
        const data = event.data as { providerId: string; status: string };
        const { providerId, status } = data;
        await onProviderStatusChange(providerId as ProviderId, status);
      },
    });
  }

  /**
   * Start real-time processors
   */
  startRealtimeProcessors(
    onContentChangeMessage: (
      postId: string,
      changes: VersionDiff[],
      providerId: ProviderId
    ) => Promise<void>
  ): void {
    if (this.processorRunning) {
      return;
    }

    this.processorRunning = true;
    this.startContentChangeProcessor(onContentChangeMessage);
    this.startTransactionProcessor();
    this.startConflictProcessor();
  }

  /**
   * Stop all real-time processors
   */
  stopRealtimeProcessors(): void {
    this.processorRunning = false;
    logger.info("Real-time processors stopped");
  }

  /**
   * Start metrics collection
   */
  startMetricsCollection(): void {
    this.metricsCollectionInterval = setInterval(async () => {
      try {
        await this.collectAndStoreMetrics();
      } catch (error) {
        logger.error({ err: error }, "Metrics collection error");
      }
    }, 60000); // Every minute
    this.metricsCollectionInterval.unref();
  }

  /**
   * Stop metrics collection
   */
  stopMetricsCollection(): void {
    if (this.metricsCollectionInterval) {
      clearInterval(this.metricsCollectionInterval);
      this.metricsCollectionInterval = undefined;
    }
  }

  /**
   * Register a post for real-time sync on specific channels
   */
  registerRealtimeSync(postId: string, channelIds: string[]): void {
    if (!this.realtimeSubscriptions.has(postId)) {
      this.realtimeSubscriptions.set(postId, new Set());
    }

    const subscriptions = this.realtimeSubscriptions.get(postId)!;
    channelIds.forEach((id) => subscriptions.add(id));
  }

  /**
   * Unregister a post from real-time sync
   */
  unregisterRealtimeSync(postId: string): void {
    this.realtimeSubscriptions.delete(postId);
  }

  /**
   * Get subscribed channels for a post
   */
  getSubscribedChannels(postId: string): Set<string> | undefined {
    return this.realtimeSubscriptions.get(postId);
  }

  /**
   * Update channel metrics after sync operation
   */
  async updateChannelMetrics(
    channelId: string,
    success: boolean,
    duration?: number,
    conflictsDetected?: number,
    conflictsResolved?: number
  ): Promise<void> {
    const metrics = this.channelMetrics.get(channelId) || this.getDefaultMetrics();

    metrics.totalTransactions++;
    if (success) {
      metrics.successfulSyncs++;
    } else {
      metrics.failedSyncs++;
    }

    if (duration !== undefined) {
      metrics.lastSyncDuration = duration;
      const totalSyncs = metrics.successfulSyncs + metrics.failedSyncs;
      metrics.averageSyncTime =
        (metrics.averageSyncTime * (totalSyncs - 1) + duration) / totalSyncs;
    }

    if (conflictsDetected !== undefined) {
      metrics.conflictsDetected += conflictsDetected;
    }

    if (conflictsResolved !== undefined) {
      metrics.conflictsResolved += conflictsResolved;
    }

    this.channelMetrics.set(channelId, metrics);
  }

  /**
   * Get metrics for a specific channel
   */
  async getChannelMetrics(channelId: string): Promise<SyncMetrics> {
    return this.channelMetrics.get(channelId) || this.getDefaultMetrics();
  }

  /**
   * Get global metrics across all channels
   */
  async getGlobalMetrics(): Promise<SyncMetrics> {
    const allMetrics = Array.from(this.channelMetrics.values());

    if (allMetrics.length === 0) {
      return this.getDefaultMetrics();
    }

    return allMetrics.reduce(
      (acc, metrics) => ({
        totalTransactions: acc.totalTransactions + metrics.totalTransactions,
        successfulSyncs: acc.successfulSyncs + metrics.successfulSyncs,
        failedSyncs: acc.failedSyncs + metrics.failedSyncs,
        conflictsDetected: acc.conflictsDetected + metrics.conflictsDetected,
        conflictsResolved: acc.conflictsResolved + metrics.conflictsResolved,
        averageSyncTime: (acc.averageSyncTime + metrics.averageSyncTime) / 2,
        dataTransferred: acc.dataTransferred + metrics.dataTransferred,
        lastSyncDuration: Math.max(acc.lastSyncDuration, metrics.lastSyncDuration),
      }),
      this.getDefaultMetrics()
    );
  }

  /**
   * Emit sync event
   */
  async emitSyncEvent(event: RealtimeSyncEvent): Promise<void> {
    await this.eventService.publishEvent({
      id: event.id,
      type: event.type,
      aggregateId: event.postId,
      aggregateType: "SyncEngine",
      version: 1,
      data: event.data,
      metadata: {
        source: "SyncEngine",
        providerId: event.providerId,
        ...(event.metadata && event.metadata),
      },
      timestamp: event.timestamp,
    });
  }

  /**
   * Private helper methods
   */

  private async startContentChangeProcessor(
    onMessage: (postId: string, changes: VersionDiff[], providerId: ProviderId) => Promise<void>
  ): Promise<void> {
    const processor = async () => {
      if (!this.processorRunning) {
        return;
      }

      try {
        const messages = await this.redis.xreadgroup(
          "GROUP",
          "sync-engine",
          `processor-${process.pid}`,
          "COUNT",
          10,
          "BLOCK",
          1000,
          "STREAMS",
          "sync:content:changes",
          ">"
        );

        if (messages && messages.length > 0) {
          for (const [_stream, streamMessages] of messages as unknown as Array<
            [string, Array<[string, string[]]>]
          >) {
            for (const [messageId, fields] of streamMessages) {
              await this.processContentChangeMessage(fields, onMessage);
              await this.redis.xack("sync:content:changes", "sync-engine", messageId);
            }
          }
        }
      } catch (error) {
        logger.error({ err: error }, "Content change processor error");
      }

      // Continue processing
      setImmediate(processor);
    };

    processor();
  }

  private async startTransactionProcessor(): Promise<void> {
    logger.debug("Transaction processor started");
  }

  private async startConflictProcessor(): Promise<void> {
    logger.debug("Conflict processor started");
  }

  private async processContentChangeMessage(
    fields: string[],
    onMessage: (postId: string, changes: VersionDiff[], providerId: ProviderId) => Promise<void>
  ): Promise<void> {
    try {
      const data = this.parseRedisFields(fields);
      const { postId, changes, providerId } = data;

      if (postId && changes && providerId) {
        await onMessage(postId, JSON.parse(changes), providerId as ProviderId);
      }
    } catch (error) {
      logger.error({ err: error }, "Error processing content change message");
    }
  }

  private parseRedisFields(fields: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      const key = fields[i];
      const value = fields[i + 1];
      if (key !== undefined && value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  private async collectAndStoreMetrics(): Promise<void> {
    const metrics = await this.getGlobalMetrics();
    await this.redis.setex("sync:metrics:global", 300, JSON.stringify(metrics));
  }

  private getDefaultMetrics(): SyncMetrics {
    return {
      totalTransactions: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      conflictsDetected: 0,
      conflictsResolved: 0,
      averageSyncTime: 0,
      dataTransferred: 0,
      lastSyncDuration: 0,
    };
  }
}
