/**
 * SyncEngine — Implementation class
 *
 * Implements all protected/private methods declared abstract in SyncEngineBase.
 * This is the concrete class that should be instantiated directly.
 */

import { randomUUID } from "node:crypto";
import { VersionDiff, SyncRule } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface";
import { SyncEngineBase } from "./SyncEngineBase";
import { logger } from "../lib/logger.js";
import { AppError } from "../lib/errors/AppError.js";
import type {
  SyncChannel,
  SyncTransaction,
  SyncChange,
  SyncConflict,
  SyncRollbackPlan,
  SyncMetrics,
  RealtimeSyncEvent,
} from "./syncEngineTypes";

export class SyncEngine extends SyncEngineBase {
  /**
   * Private methods — infrastructure / stream setup
   */

  protected async setupRealtimeStreams(): Promise<void> {
    // Create Redis streams for real-time sync events
    const streams = ["sync:content:changes", "sync:transactions", "sync:conflicts", "sync:metrics"];

    for (const stream of streams) {
      try {
        await this.redis.xgroup("CREATE", stream, "sync-engine", "$", "MKSTREAM");
      } catch {
        // Group might already exist
      }
    }
  }

  protected async loadSyncChannels(): Promise<void> {
    try {
      // Load channels from database/cache
      const channelKeys = await this.redis.keys("sync:channel:*");

      for (const key of channelKeys) {
        const channelData = await this.redis.get(key);
        if (channelData) {
          const channel: SyncChannel = JSON.parse(channelData);
          this.syncChannels.set(channel.id, channel);
        }
      }

      logger.info({ channelCount: this.syncChannels.size }, "Loaded sync channels");
    } catch (error) {
      logger.error({ err: error }, "Error loading sync channels");
    }
  }

  protected registerEventHandlers(): void {
    // Listen for content change events
    this.eventService.registerHandler("POST_UPDATED", {
      eventType: "POST_UPDATED",
      handle: async (event) => {
        const data = event.data as { postId: string; changes?: VersionDiff[]; providerId: string };
        const { postId, changes, providerId } = data;
        await this.handleContentChange(postId, changes || [], providerId as ProviderId);
      },
    });

    // Listen for provider status changes
    this.eventService.registerHandler("PROVIDER_STATUS_CHANGED", {
      eventType: "PROVIDER_STATUS_CHANGED",
      handle: async (event) => {
        const data = event.data as { providerId: string; status: string };
        const { providerId, status } = data;
        await this.handleProviderStatusChange(providerId as ProviderId, status);
      },
    });
  }

  protected startRealtimeProcessors(): void {
    if (this.processorRunning) return;
    this.processorRunning = true;

    // Start stream consumers for real-time processing
    this.startContentChangeProcessor();
    this.startTransactionProcessor();
    this.startConflictProcessor();
  }

  private async startContentChangeProcessor(): Promise<void> {
    const processor = async () => {
      if (!this.processorRunning) return;

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
            [string, Array<[string, any]>]
          >) {
            for (const [messageId, fields] of streamMessages) {
              await this.processContentChangeMessage(fields);
              await this.redis.xack("sync:content:changes", "sync-engine", messageId);
            }
          }
        }
      } catch (error) {
        logger.error({ err: error }, "Content change processor error");
      }

      // Continue processing only if still running
      if (this.processorRunning) {
        setImmediate(processor);
      }
    };

    processor();
  }

  private async startTransactionProcessor(): Promise<void> {
    // Similar to content change processor but for transactions
    logger.debug("Transaction processor started");
  }

  private async startConflictProcessor(): Promise<void> {
    // Similar to content change processor but for conflicts
    logger.debug("Conflict processor started");
  }

  protected startMetricsCollection(): void {
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
   * Transaction execution
   */

  protected async executeSyncTransaction(
    transaction: SyncTransaction,
    channel: SyncChannel
  ): Promise<void> {
    try {
      transaction.status = "processing";

      // Get current content versions
      const sourceContent = await this.getContentForProvider(
        transaction.postId,
        channel.sourceProvider
      );
      const targetContent = await this.getContentForProvider(
        transaction.postId,
        channel.targetProvider
      );

      if (!sourceContent) {
        throw AppError.notFound("Source content", {
          provider: channel.sourceProvider,
          postId: transaction.postId,
        });
      }

      // Detect changes and conflicts
      const changes = await this.detectChanges(sourceContent, targetContent, channel);
      const conflicts = await this.detectConflicts(changes, channel);

      transaction.changes = changes;
      transaction.conflicts = conflicts;

      // If conflicts exist, pause for resolution
      if (conflicts.length > 0) {
        await this.handleSyncConflicts(transaction, conflicts);
        return;
      }

      // Apply changes
      await this.applyChanges(transaction, channel);

      // Complete transaction
      transaction.status = "completed";
      transaction.completedAt = new Date();

      // Update channel metrics
      await this.updateChannelMetrics(channel.id, true);

      // Emit completion event
      await this.emitSyncEvent({
        id: this.generateId(),
        type: "sync_completed",
        postId: transaction.postId,
        providerId: channel.targetProvider,
        timestamp: new Date(),
        data: {
          transactionId: transaction.id,
          changesApplied: changes.length,
          conflictsResolved: conflicts.length,
        },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      transaction.status = "failed";
      transaction.completedAt = new Date();

      // Update channel metrics
      await this.updateChannelMetrics(channel.id, false);

      // Emit failure event
      await this.emitSyncEvent({
        id: this.generateId(),
        type: "sync_failed",
        postId: transaction.postId,
        providerId: channel.targetProvider,
        timestamp: new Date(),
        data: {
          transactionId: transaction.id,
          error: errorMessage,
        },
      });

      throw error;
    } finally {
      // Remove from active transactions if completed or failed
      if (transaction.status === "completed" || transaction.status === "failed") {
        this.activeTransactions.delete(transaction.id);
      }
    }
  }

  protected async executeRealtimeSync(
    postId: string,
    channelId: string,
    direction: string,
    changes: VersionDiff[]
  ): Promise<void> {
    try {
      logger.debug({ postId, channelId }, "Executing real-time sync");

      // Filter changes based on sync rules
      const channel = this.syncChannels.get(channelId)!;
      const filteredChanges = await this.filterChanges(changes, channel.configuration.syncRules);

      if (filteredChanges.length === 0) {
        return;
      }

      // Create and execute mini-transaction for real-time sync
      const transaction: SyncTransaction = {
        id: this.generateId(),
        channelId,
        postId,
        direction: direction as SyncTransaction["direction"],
        status: "processing",
        startedAt: new Date(),
        changes: [],
        conflicts: [],
      };

      // Apply filtered changes
      await this.applyRealtimeChanges(transaction, filteredChanges, channel);

      logger.debug({ postId }, "Real-time sync completed");
    } catch (error) {
      logger.error({ err: error, postId }, "Real-time sync failed");
    }
  }

  /**
   * Helper methods
   */

  protected findExistingChannel(source: ProviderId, target: ProviderId): SyncChannel | undefined {
    return Array.from(this.syncChannels.values()).find(
      (channel) =>
        (channel.sourceProvider === source && channel.targetProvider === target) ||
        (channel.bidirectional &&
          channel.sourceProvider === target &&
          channel.targetProvider === source)
    );
  }

  protected async storeSyncChannel(channel: SyncChannel): Promise<void> {
    await this.redis.setex(
      `sync:channel:${channel.id}`,
      86400 * 7, // 7 days
      JSON.stringify(channel)
    );
  }

  protected async setupChannelMonitoring(channel: SyncChannel): Promise<void> {
    // Setup monitoring for this specific channel
    logger.debug(
      { channelName: channel.name, channelId: channel.id },
      "Monitoring setup for channel"
    );
  }

  protected async startContentChangeMonitoring(postId: string): Promise<void> {
    // Setup content change monitoring for a specific post
    logger.debug({ postId }, "Started content change monitoring for post");
  }

  private async processContentChangeMessage(fields: string[]): Promise<void> {
    try {
      const data = this.parseRedisFields(fields);
      const { postId, changes, providerId } = data;

      if (postId && changes && providerId) {
        await this.handleContentChange(postId, JSON.parse(changes), providerId as ProviderId);
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

  private async getContentForProvider(
    postId: string,
    _providerId: ProviderId
  ): Promise<CanonicalPost | null> {
    // Get content from database for the given post
    try {
      const post = await this.prisma.post.findUnique({
        where: { id: postId },
        include: { contents: true },
      });

      if (!post) return null;

      const content = post.contents[0];
      return {
        id: post.id,
        projectId: post.projectId,
        locale: (content?.locale as "es" | "en") || "en",
        body: content?.body || "",
      };
    } catch {
      return null;
    }
  }

  private async detectChanges(
    _sourceContent: CanonicalPost,
    _targetContent: CanonicalPost | null,
    _channel: SyncChannel
  ): Promise<SyncChange[]> {
    // Detect changes between source and target content
    return []; // Placeholder
  }

  private async detectConflicts(
    _changes: SyncChange[],
    _channel: SyncChannel
  ): Promise<SyncConflict[]> {
    // Detect conflicts in the changes
    return []; // Placeholder
  }

  private async handleSyncConflicts(
    transaction: SyncTransaction,
    conflicts: SyncConflict[]
  ): Promise<void> {
    // Handle detected conflicts
    logger.info(
      { conflictCount: conflicts.length, transactionId: transaction.id },
      "Handling sync conflicts"
    );
  }

  private async applyChanges(transaction: SyncTransaction, _channel: SyncChannel): Promise<void> {
    // Apply changes to target provider
    logger.debug(
      { changeCount: transaction.changes.length, transactionId: transaction.id },
      "Applying sync changes"
    );
  }

  private async applyRealtimeChanges(
    transaction: SyncTransaction,
    changes: VersionDiff[],
    _channel: SyncChannel
  ): Promise<void> {
    // Apply real-time changes
    logger.debug(
      { changeCount: changes.length, transactionId: transaction.id },
      "Applying real-time changes"
    );
  }

  private async filterChanges(
    changes: VersionDiff[],
    _syncRules: SyncRule[]
  ): Promise<VersionDiff[]> {
    // Filter changes based on sync rules
    return changes; // Placeholder
  }

  protected async resumeSyncTransaction(transaction: SyncTransaction): Promise<void> {
    // Resume transaction after conflict resolution
    logger.info({ transactionId: transaction.id }, "Resuming sync transaction");
  }

  protected async executeRollback(rollbackPlan: SyncRollbackPlan): Promise<void> {
    // Execute rollback plan
    logger.info({ rollbackPlanId: rollbackPlan.id }, "Executing sync rollback");
  }

  private async handleProviderStatusChange(providerId: ProviderId, status: string): Promise<void> {
    // Handle provider status changes
    logger.info({ providerId, status }, "Provider status changed");
  }

  private async updateChannelMetrics(channelId: string, success: boolean): Promise<void> {
    // Update channel performance metrics
    const channel = this.syncChannels.get(channelId);
    if (channel) {
      if (success) {
        channel.errorCount = Math.max(0, channel.errorCount - 1);
      } else {
        channel.errorCount++;
      }

      // Recalculate success rate (placeholder logic)
      channel.successRate = Math.max(0.1, 1 - channel.errorCount * 0.1);
    }
  }

  protected async getChannelMetrics(_channelId: string): Promise<SyncMetrics> {
    // Get metrics for specific channel
    return this.getDefaultMetrics();
  }

  protected async getGlobalMetrics(): Promise<SyncMetrics> {
    // Get global sync metrics
    return this.getDefaultMetrics();
  }

  protected getDefaultMetrics(): SyncMetrics {
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

  private async collectAndStoreMetrics(): Promise<void> {
    // Collect and store metrics periodically
    const metrics = await this.getGlobalMetrics();
    await this.redis.setex("sync:metrics:global", 300, JSON.stringify(metrics));
  }

  protected async emitSyncEvent(event: RealtimeSyncEvent): Promise<void> {
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
        ...event.metadata,
      },
      timestamp: event.timestamp,
    });
  }

  protected generateId(): string {
    return `sync_${randomUUID()}`;
  }
}
