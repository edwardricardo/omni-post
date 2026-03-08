/**
 * SyncEngine — Base class
 *
 * Declares the shared state, constructor, and all public API methods of the
 * Sync Engine. Private/internal implementation lives in SyncEngineImpl.ts
 * which extends this class.
 */

import { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import {
  SyncConfiguration,
  VersionDiff,
  OrchestrationResult,
  ContentVersion as _ContentVersion,
} from "@shared/orchestration";
import type {
  ProviderId,
  ProviderAdapter as _ProviderAdapter,
} from "../providers/providerAdapter.interface";
import { EventService } from "../events/EventService";
import { ContentSynchronizer } from "../orchestration/ContentSynchronizer";
import { ContentVersionManager } from "./ContentVersionManager";
import { logger } from "../lib/logger.js";
import type {
  SyncChannel,
  SyncTransaction,
  SyncRollbackPlan,
  SyncMetrics,
  RealtimeSyncEvent,
} from "./syncEngineTypes";

export abstract class SyncEngineBase {
  protected prisma: PrismaClient;
  protected redis: Redis;
  protected eventService: EventService;
  protected synchronizer: ContentSynchronizer;
  protected versionManager: ContentVersionManager;

  protected syncChannels = new Map<string, SyncChannel>();
  protected activeTransactions = new Map<string, SyncTransaction>();
  protected realtimeSubscriptions = new Map<string, Set<string>>(); // postId -> channelIds

  protected isInitialized = false;
  protected processorRunning = false;
  protected metricsCollectionInterval: NodeJS.Timeout | undefined;

  constructor(dependencies: {
    prisma: PrismaClient;
    redis: Redis;
    eventService: EventService;
    synchronizer: ContentSynchronizer;
    versionManager: ContentVersionManager;
  }) {
    this.prisma = dependencies.prisma;
    this.redis = dependencies.redis;
    this.eventService = dependencies.eventService;
    this.synchronizer = dependencies.synchronizer;
    this.versionManager = dependencies.versionManager;
  }

  /**
   * Initialize the sync engine
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Setup Redis streams for real-time sync
      await this.setupRealtimeStreams();

      // Load existing sync channels
      await this.loadSyncChannels();

      // Register event handlers
      this.registerEventHandlers();

      // Start real-time processors
      this.startRealtimeProcessors();

      // Start metrics collection
      this.startMetricsCollection();

      this.isInitialized = true;
      logger.info({ channelsCount: this.syncChannels.size }, "Sync Engine initialized");

      // Emit initialization event
      await this.emitSyncEvent({
        id: this.generateId(),
        type: "sync_started",
        postId: "system",
        providerId: "system" as ProviderId,
        timestamp: new Date(),
        data: {
          component: "SyncEngine",
          status: "initialized",
          channelsCount: this.syncChannels.size,
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize Sync Engine");
      throw error;
    }
  }

  /**
   * Create a new sync channel between providers
   */
  async createSyncChannel(
    name: string,
    sourceProvider: ProviderId,
    targetProvider: ProviderId,
    configuration: SyncConfiguration,
    bidirectional: boolean = false
  ): Promise<OrchestrationResult<SyncChannel>> {
    try {
      // Validate providers
      if (sourceProvider === targetProvider) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "Source and target providers cannot be the same",
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Check if channel already exists
      const existingChannel = this.findExistingChannel(sourceProvider, targetProvider);
      if (existingChannel) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "Sync channel already exists between these providers",
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Create sync channel
      const channel: SyncChannel = {
        id: this.generateId(),
        name,
        sourceProvider,
        targetProvider,
        bidirectional,
        enabled: true,
        configuration,
        healthStatus: "healthy",
        errorCount: 0,
        successRate: 1.0,
      };

      // Store channel
      this.syncChannels.set(channel.id, channel);
      await this.storeSyncChannel(channel);

      // Setup real-time monitoring for this channel
      await this.setupChannelMonitoring(channel);

      return { ok: true, value: channel };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to create sync channel: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Start real-time synchronization for a post
   */
  async startRealtimeSync(
    postId: string,
    channelIds: string[]
  ): Promise<OrchestrationResult<void>> {
    try {
      // Validate channels
      const validChannels = channelIds.filter((id) => this.syncChannels.has(id));
      if (validChannels.length === 0) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "No valid sync channels provided",
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Register subscriptions
      if (!this.realtimeSubscriptions.has(postId)) {
        this.realtimeSubscriptions.set(postId, new Set());
      }

      const subscriptions = this.realtimeSubscriptions.get(postId)!;
      validChannels.forEach((id) => subscriptions.add(id));

      // Start monitoring content changes for this post
      await this.startContentChangeMonitoring(postId);

      logger.info(
        { postId, channelCount: validChannels.length },
        "Started real-time sync for post"
      );

      return { ok: true, value: undefined };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to start real-time sync: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Stop real-time synchronization for a post
   */
  async stopRealtimeSync(postId: string): Promise<void> {
    const subscriptions = this.realtimeSubscriptions.get(postId);
    if (subscriptions) {
      subscriptions.clear();
      this.realtimeSubscriptions.delete(postId);
    }
  }

  /**
   * Execute synchronization for a specific post
   */
  async syncPost(
    postId: string,
    channelId: string,
    direction: "source_to_target" | "target_to_source" | "bidirectional" = "source_to_target"
  ): Promise<OrchestrationResult<SyncTransaction>> {
    try {
      const channel = this.syncChannels.get(channelId);
      if (!channel) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Sync channel not found: ${channelId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      if (!channel.enabled) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "Sync channel is disabled",
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Create sync transaction
      const transaction: SyncTransaction = {
        id: this.generateId(),
        channelId,
        postId,
        direction,
        status: "pending",
        startedAt: new Date(),
        changes: [],
        conflicts: [],
      };

      this.activeTransactions.set(transaction.id, transaction);

      // Execute sync based on direction
      await this.executeSyncTransaction(transaction, channel);

      return { ok: true, value: transaction };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Post sync failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Handle real-time content changes
   */
  async handleContentChange(
    postId: string,
    changes: VersionDiff[],
    providerId: ProviderId
  ): Promise<void> {
    try {
      // Get active subscriptions for this post
      const subscriptions = this.realtimeSubscriptions.get(postId);
      if (!subscriptions) {
        return;
      }

      // Process each subscribed channel
      for (const channelId of subscriptions) {
        const channel = this.syncChannels.get(channelId);
        if (!channel || !channel.enabled) {
          continue;
        }

        // Check if this provider is involved in the channel
        if (channel.sourceProvider !== providerId && channel.targetProvider !== providerId) {
          continue;
        }

        // Determine sync direction
        const direction =
          channel.sourceProvider === providerId ? "source_to_target" : "target_to_source";

        // Execute real-time sync
        await this.executeRealtimeSync(postId, channelId, direction, changes);
      }
    } catch (error) {
      logger.error({ err: error, postId }, "Error handling content change for post");
    }
  }

  /**
   * Resolve sync conflicts
   */
  async resolveSyncConflicts(
    transactionId: string,
    resolutions: Array<{
      conflictId: string;
      resolution: "source_wins" | "target_wins" | "merge" | "manual";
      resolvedValue?: any;
    }>
  ): Promise<OrchestrationResult<SyncTransaction>> {
    try {
      const transaction = this.activeTransactions.get(transactionId);
      if (!transaction) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Transaction not found: ${transactionId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Apply conflict resolutions
      for (const resolution of resolutions) {
        const conflict = transaction.conflicts.find((c) => c.id === resolution.conflictId);
        if (conflict) {
          conflict.resolution = resolution.resolution;
          conflict.resolvedValue = resolution.resolvedValue;
        }
      }

      // Check if all conflicts are resolved
      const unresolvedConflicts = transaction.conflicts.filter((c) => !c.resolution);
      if (unresolvedConflicts.length > 0) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `${unresolvedConflicts.length} conflicts remain unresolved`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Resume transaction processing
      await this.resumeSyncTransaction(transaction);

      return { ok: true, value: transaction };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Conflict resolution failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Rollback a sync transaction
   */
  async rollbackTransaction(transactionId: string): Promise<OrchestrationResult<void>> {
    try {
      const transaction = this.activeTransactions.get(transactionId);
      if (!transaction) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Transaction not found: ${transactionId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      if (!transaction.rollbackPlan) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "No rollback plan available for transaction",
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Execute rollback
      await this.executeRollback(transaction.rollbackPlan);

      // Update transaction status
      transaction.status = "rolled_back";
      transaction.completedAt = new Date();

      // Emit rollback event
      await this.emitSyncEvent({
        id: this.generateId(),
        type: "sync_completed",
        postId: transaction.postId,
        providerId: "system" as ProviderId,
        timestamp: new Date(),
        data: {
          transactionId,
          action: "rollback",
          status: "completed",
        },
      });

      return { ok: true, value: undefined };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Transaction rollback failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Get sync metrics for monitoring
   */
  async getSyncMetrics(channelId?: string): Promise<SyncMetrics> {
    try {
      if (channelId) {
        return await this.getChannelMetrics(channelId);
      } else {
        return await this.getGlobalMetrics();
      }
    } catch (error) {
      logger.error({ err: error }, "Error getting sync metrics");
      return this.getDefaultMetrics();
    }
  }

  /**
   * Shutdown the sync engine and release resources
   */
  async shutdown(): Promise<void> {
    // Stop the real-time processor loop
    this.processorRunning = false;

    // Clear metrics collection interval
    if (this.metricsCollectionInterval) {
      clearInterval(this.metricsCollectionInterval);
      this.metricsCollectionInterval = undefined;
    }

    // Clear active state
    this.activeTransactions.clear();
    this.realtimeSubscriptions.clear();
    this.isInitialized = false;
  }

  // Abstract methods implemented by SyncEngineImpl
  protected abstract setupRealtimeStreams(): Promise<void>;
  protected abstract loadSyncChannels(): Promise<void>;
  protected abstract registerEventHandlers(): void;
  protected abstract startRealtimeProcessors(): void;
  protected abstract startMetricsCollection(): void;
  protected abstract executeSyncTransaction(
    transaction: SyncTransaction,
    channel: SyncChannel
  ): Promise<void>;
  protected abstract executeRealtimeSync(
    postId: string,
    channelId: string,
    direction: string,
    changes: VersionDiff[]
  ): Promise<void>;
  protected abstract findExistingChannel(
    source: ProviderId,
    target: ProviderId
  ): SyncChannel | undefined;
  protected abstract storeSyncChannel(channel: SyncChannel): Promise<void>;
  protected abstract setupChannelMonitoring(channel: SyncChannel): Promise<void>;
  protected abstract startContentChangeMonitoring(postId: string): Promise<void>;
  protected abstract resumeSyncTransaction(transaction: SyncTransaction): Promise<void>;
  protected abstract executeRollback(rollbackPlan: SyncRollbackPlan): Promise<void>;
  protected abstract getChannelMetrics(channelId: string): Promise<SyncMetrics>;
  protected abstract getGlobalMetrics(): Promise<SyncMetrics>;
  protected abstract getDefaultMetrics(): SyncMetrics;
  protected abstract emitSyncEvent(event: RealtimeSyncEvent): Promise<void>;
  protected abstract generateId(): string;
}
