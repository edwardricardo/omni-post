/**
 * @file VersionController.ts
 * @description CRUD operations for content versions including creation, retrieval,
 *              history tracking, and version restoration.
 * @layer infrastructure
 */

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@infra/prisma";
import { Redis } from "ioredis";
import type { CachePort } from "@ports/core";
import {
  ContentVersion,
  OrchestrationResult,
  PlatformAdaptation as _PlatformAdaptation,
} from "@shared/types/orchestration.js";
import type { CanonicalPost, Media as _Media } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface.js";
import { EventService } from "../events/EventService.js";
import type { VersionSnapshot } from "./contentVersionTypes.js";
import { logger } from "../lib/logger.js";

interface CreateVersionParams {
  postId: string;
  content: CanonicalPost;
  adaptations: Record<ProviderId, CanonicalPost>;
  metadata: {
    createdBy: string;
    changelog?: string;
    branchName?: string;
    parentVersionId?: string;
    tags?: string[];
    category?: string;
  };
}

export class VersionController {
  private prisma: PrismaClient;
  private redis: Redis;
  private eventService: EventService;
  private cache: CachePort;
  private static readonly VERSION_TTL_SECONDS = 86_400;

  constructor(dependencies: {
    prisma: PrismaClient;
    redis: Redis;
    eventService: EventService;
    cache: CachePort;
  }) {
    this.prisma = dependencies.prisma;
    this.redis = dependencies.redis;
    this.eventService = dependencies.eventService;
    this.cache = dependencies.cache;
  }

  /**
   * Create a new content version
   */
  async createVersion(params: CreateVersionParams): Promise<OrchestrationResult<ContentVersion>> {
    try {
      const { postId, content, adaptations, metadata } = params;

      // Generate version number
      const versionNumber = await this.getNextVersionNumber(postId, metadata.branchName);

      // Create content snapshot
      const snapshot = await this.createSnapshot(content, adaptations, metadata);

      // Create version record
      const version: ContentVersion = {
        id: this.generateId(),
        postId,
        version: versionNumber,
        content,
        adaptations,
        createdAt: new Date(),
        createdBy: metadata.createdBy,
        ...(metadata.changelog !== undefined && { changelog: metadata.changelog }),
        isActive: !metadata.branchName, // Main branch versions are active by default
      };

      // Store in database
      await this.storeVersion(version, snapshot);

      // Update branch if specified
      if (metadata.branchName) {
        await this.updateBranchHead(postId, metadata.branchName, version.id);
      } else {
        // Deactivate previous versions on main branch
        await this.deactivatePreviousVersions(postId);
      }

      await this.cache.set(`version:${version.id}`, version, {
        ttlSeconds: VersionController.VERSION_TTL_SECONDS,
      });

      // Emit version created event
      await this.emitVersionEvent("VERSION_CREATED", version, {
        ...(metadata.branchName !== undefined && { branchName: metadata.branchName }),
        ...(metadata.parentVersionId !== undefined && {
          parentVersionId: metadata.parentVersionId,
        }),
      });

      return { ok: true, value: version };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to create version: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
          context: { postId: params.postId, createdBy: params.metadata.createdBy },
        },
      };
    }
  }

  /**
   * Get version by ID
   */
  async getVersion(versionId: string): Promise<ContentVersion | null> {
    const cached = await this.cache.get<ContentVersion>(`version:${versionId}`);
    if (cached) return cached;
    return null;
  }

  /**
   * Get version history for a post
   */
  async getVersionHistory(
    postId: string,
    branchName?: string,
    limit?: number
  ): Promise<ContentVersion[]> {
    try {
      // Get from cache first
      const cacheKey = `versions:${postId}:${branchName || "main"}`;
      const cached = await this.redis.lrange(cacheKey, 0, (limit || 50) - 1);

      if (cached.length > 0) {
        return cached.map((v) => JSON.parse(v));
      }

      // Fallback to database query
      return await this.getVersionHistoryFromDatabase(postId, branchName, limit);
    } catch (error) {
      logger.error({ err: error, postId }, "Error getting version history for post");
      return [];
    }
  }

  /**
   * Restore content to a specific version
   */
  async restoreVersion(
    versionId: string,
    restoredBy: string
  ): Promise<OrchestrationResult<ContentVersion>> {
    try {
      const version = await this.getVersion(versionId);
      if (!version) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Version not found: ${versionId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Create new version with restored content
      const restoredVersion = await this.createVersion({
        postId: version.postId,
        content: version.content,
        adaptations: version.adaptations,
        metadata: {
          createdBy: restoredBy,
          changelog: `Restored from version ${version.version}`,
        },
      });

      if (restoredVersion.ok) {
        await this.emitVersionEvent("VERSION_RESTORED", restoredVersion.value, {
          restoredFromVersionId: versionId,
        });
      }

      return restoredVersion;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Version restoration failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Deactivate a specific version
   */
  async deactivateVersion(versionId: string): Promise<OrchestrationResult<void>> {
    try {
      const version = await this.getVersion(versionId);
      if (!version) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Version not found: ${versionId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Update version active status
      version.isActive = false;
      await this.storeVersion(version, null); // Snapshot not needed for deactivation

      await this.cache.delete(`version:${versionId}`);

      return { ok: true, value: undefined };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to deactivate version: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Private helper methods
   */

  private async getNextVersionNumber(postId: string, branchName?: string): Promise<number> {
    const history = await this.getVersionHistory(postId, branchName, 1);
    const latestVersion = history[0];
    return latestVersion ? latestVersion.version + 1 : 1;
  }

  private async createSnapshot(
    content: CanonicalPost,
    adaptations: Record<ProviderId, CanonicalPost>,
    metadata: Record<string, unknown>
  ): Promise<VersionSnapshot> {
    const snapshotData = { content, adaptations, metadata };
    const serialized = JSON.stringify(snapshotData);

    return {
      id: this.generateId(),
      versionId: "", // Will be set when version is created
      content,
      adaptations,
      metadata: {
        tags: (Array.isArray(metadata.tags) ? metadata.tags : []) as string[],
        category: typeof metadata.category === "string" ? metadata.category : "general",
        priority: typeof metadata.priority === "number" ? metadata.priority : 1,
        approvalStatus: "draft",
        reviewComments: [],
      },
      checksum: this.calculateChecksum(serialized),
      size: serialized.length,
      createdAt: new Date(),
    };
  }

  private calculateChecksum(data: string): string {
    // Simple checksum calculation (in production, use proper hashing)
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  private async storeVersion(
    version: ContentVersion,
    _snapshot: VersionSnapshot | null = null
  ): Promise<void> {
    // Store in database (implementation depends on schema)
    // Cache version
    await this.redis.lpush(`versions:${version.postId}:main`, JSON.stringify(version));
    await this.redis.setex(`version:${version.id}`, 86400, JSON.stringify(version));
  }

  private async deactivatePreviousVersions(_postId: string): Promise<void> {
    // Implementation would update database to mark previous versions as inactive
  }

  private async updateBranchHead(
    postId: string,
    branchName: string,
    versionId: string
  ): Promise<void> {
    const branchId = await this.redis.hget(`branches:${postId}`, branchName);
    if (branchId) {
      const cached = await this.redis.get(`branch:${branchId}`);
      if (cached) {
        const branch = JSON.parse(cached);
        branch.headVersionId = versionId;
        await this.redis.setex(`branch:${branchId}`, 86400, JSON.stringify(branch));
      }
    }
  }

  private async getVersionHistoryFromDatabase(
    _postId: string,
    _branchName?: string,
    _limit?: number
  ): Promise<ContentVersion[]> {
    // Database query implementation
    return [];
  }

  private async emitVersionEvent(
    eventType: string,
    version: ContentVersion,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.eventService.publishEvent({
      id: this.generateId(),
      type: eventType,
      aggregateId: version.postId,
      aggregateType: "ContentVersion",
      version: 1,
      data: { version, ...metadata },
      metadata: { source: "VersionController" },
      timestamp: new Date(),
    });
  }

  private generateId(): string {
    return `version_${randomUUID()}`;
  }
}
