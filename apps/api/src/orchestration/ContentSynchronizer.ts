/**
 * Phase 3A Week 5: Content Synchronizer (Facade)
 *
 * Facade that coordinates real-time content synchronization across multiple providers.
 * Delegates to focused modules in the sync/ subdirectory:
 *   - SyncCoordinator  — job lifecycle, validation, execution flow
 *   - VersionManager   — versioning, diffs, history
 *   - ConflictResolver — conflict detection and resolution
 *   - TransformationEngine — content transformations
 *   - StreamProcessor  — Redis streams, event handlers, scheduled sync
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import type {
  SyncConflictResolution,
  ContentVersion,
  VersionDiff,
  SyncContentRequest,
  SyncResponse,
  OrchestrationResult,
  SyncTransformation,
} from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface";
import { EventService } from "../events/EventService";
import { createLogger } from "../lib/logger.js";
import { SyncCoordinator } from "./sync/SyncCoordinator.js";

const log = createLogger("orchestration");
import { VersionManager } from "./sync/VersionManager.js";
import { ConflictResolver } from "./sync/ConflictResolver.js";
import { TransformationEngine } from "./sync/TransformationEngine.js";
import { StreamProcessor } from "./sync/StreamProcessor.js";
import type { ContentConflict } from "./sync/types.js";

interface SyncDependencies {
  prisma: PrismaClient;
  redis: Redis;
  eventService: EventService;
}

export class ContentSynchronizer {
  private isInitialized = false;
  private eventService: EventService;

  private coordinator: SyncCoordinator;
  private versionManager: VersionManager;
  private conflictResolver: ConflictResolver;
  private transformationEngine: TransformationEngine;
  private streamProcessor: StreamProcessor;

  constructor(dependencies: SyncDependencies) {
    const { prisma, redis, eventService } = dependencies;
    this.eventService = eventService;

    this.coordinator = new SyncCoordinator(prisma, redis);
    this.versionManager = new VersionManager(prisma, redis);
    this.conflictResolver = new ConflictResolver(eventService);
    this.transformationEngine = new TransformationEngine();
    this.streamProcessor = new StreamProcessor(redis, eventService, (postId, changes) =>
      this.realTimeSync(postId, changes)
    );
  }

  /**
   * Initialize the content synchronizer
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.setupRedisSyncStreams();
      this.registerContentChangeHandlers();
      this.startScheduledSyncProcessor();

      this.isInitialized = true;
      log.info("Content Synchronizer initialized successfully");

      await this.eventService.publishEvent({
        id: this.generateId(),
        type: "SYNC_STARTED",
        aggregateId: "system",
        aggregateType: "ContentSynchronizer",
        version: 1,
        data: {
          component: "ContentSynchronizer",
          status: "initialized",
        },
        metadata: {
          source: "ContentSynchronizer",
        },
        timestamp: new Date(),
      });
    } catch (error: unknown) {
      log.error({ err: error }, "Failed to initialize Content Synchronizer");
      throw error;
    }
  }

  /**
   * Synchronize content across providers
   */
  async syncContent(request: SyncContentRequest): Promise<OrchestrationResult<SyncResponse>> {
    return this.coordinator.syncContent(request);
  }

  /**
   * Get content version history
   */
  async getVersionHistory(postId: string): Promise<ContentVersion[]> {
    return this.versionManager.getVersionHistory(postId);
  }

  /**
   * Create a new content version
   */
  async createVersion(
    postId: string,
    content: CanonicalPost,
    adaptations: Record<ProviderId, CanonicalPost>,
    createdBy: string,
    changelog?: string
  ): Promise<ContentVersion> {
    return this.versionManager.createVersion(postId, content, adaptations, createdBy, changelog);
  }

  /**
   * Compare content versions and generate diff
   */
  async compareVersions(
    postId: string,
    fromVersion: number,
    toVersion: number
  ): Promise<VersionDiff[]> {
    return this.versionManager.compareVersions(postId, fromVersion, toVersion);
  }

  /**
   * Real-time sync for immediate content changes
   */
  async realTimeSync(postId: string, changes: VersionDiff[]): Promise<void> {
    try {
      const syncConfigs = await this.coordinator.getActiveSyncConfigurations(postId);

      for (const config of syncConfigs) {
        if (config.mode === "REAL_TIME") {
          await this.coordinator.executeRealTimeSync(postId, changes, config);
        }
      }
    } catch (error: unknown) {
      log.error({ err: error, postId }, "Real-time sync failed");
    }
  }

  /**
   * Detect and resolve content conflicts
   */
  async detectAndResolveConflicts(
    postId: string,
    sourceContent: CanonicalPost,
    targetContent: CanonicalPost,
    resolutionStrategy: SyncConflictResolution
  ): Promise<{
    conflicts: ContentConflict[];
    resolvedContent: CanonicalPost;
  }> {
    return this.conflictResolver.detectAndResolveConflicts(
      postId,
      sourceContent,
      targetContent,
      resolutionStrategy
    );
  }

  /**
   * Apply content transformations based on sync rules
   */
  async applyTransformations(
    content: CanonicalPost,
    transformations: SyncTransformation[]
  ): Promise<CanonicalPost> {
    return this.transformationEngine.applyTransformations(content, transformations);
  }

  /**
   * Private delegation methods — kept as named methods so tests can patch them
   * via prototype monkey-patching (ContentSynchronizer.test-helpers.ts).
   */

  private async setupRedisSyncStreams(): Promise<void> {
    return this.streamProcessor.setupRedisSyncStreams();
  }

  private registerContentChangeHandlers(): void {
    this.streamProcessor.registerContentChangeHandlers();
  }

  private startScheduledSyncProcessor(): void {
    this.streamProcessor.startScheduledSyncProcessor(() =>
      this.coordinator.processScheduledSyncs()
    );
  }

  private async startStreamConsumer(): Promise<void> {
    // Intentionally empty — stream consumer is managed internally by StreamProcessor.
    // This method exists only so test helpers can patch it via prototype.
  }

  private generateId(): string {
    return `sync_${randomUUID()}`;
  }
}
