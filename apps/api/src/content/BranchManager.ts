/**
 * @file BranchManager.ts
 * @description Handles content version branch lifecycle: creation, head updates,
 *              existence checks, and branch retrieval from the Redis store.
 * @layer infrastructure
 */

import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import type { CachePort } from "@ports/core";
import { OrchestrationResult, ContentVersion } from "@shared/orchestration";
import { EventService } from "../events/EventService";
import { VersionBranch } from "./contentVersionTypes";

// `branchCache` is preserved as a write-only path: the original
// `Map<string, VersionBranch>` was set on creation but never read. Migrating
// to the port preserves that exact pattern (set-only) instead of introducing
// new read paths during a cache-consolidation refactor. The dead-read
// investigation is tracked separately as PR-30 in the backlog.
export class BranchManager {
  private redis: Redis;
  private eventService: EventService;
  private cache: CachePort | undefined;

  constructor(dependencies: { redis: Redis; eventService: EventService; cache?: CachePort }) {
    this.redis = dependencies.redis;
    this.eventService = dependencies.eventService;
    this.cache = dependencies.cache;
  }

  /**
   * Create a new content branch
   */
  async createBranch(
    postId: string,
    branchName: string,
    baseVersion: ContentVersion,
    createdBy: string,
    description?: string
  ): Promise<OrchestrationResult<VersionBranch>> {
    try {
      // Validate branch does not already exist
      if (await this.branchExists(postId, branchName)) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Branch already exists: ${branchName}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Build the branch record
      const branch: VersionBranch = {
        id: this.generateId(),
        name: branchName,
        postId,
        baseVersionId: baseVersion.id,
        headVersionId: baseVersion.id, // Initially points to base
        isActive: true,
        createdAt: new Date(),
        createdBy,
        ...(description !== undefined && { description }),
        mergeable: true,
        conflictsWith: [],
      };

      // Persist branch
      await this.storeBranch(branch);

      if (this.cache) {
        await this.cache.set(`branch:${branch.id}`, branch, { ttlSeconds: 86_400 });
      }

      // Emit event
      await this.emitBranchEvent("BRANCH_CREATED", branch);

      return { ok: true, value: branch };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to create branch: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Get a branch by its name within a post
   */
  async getBranchByName(postId: string, branchName: string): Promise<VersionBranch | null> {
    const branchId = await this.redis.hget(`branches:${postId}`, branchName);
    if (!branchId) return null;

    const cached = await this.redis.get(`branch:${branchId}`);
    return cached ? (JSON.parse(cached) as VersionBranch) : null;
  }

  /**
   * Check whether a named branch exists for a post
   */
  async branchExists(postId: string, branchName: string): Promise<boolean> {
    const exists = await this.redis.hexists(`branches:${postId}`, branchName);
    return exists === 1;
  }

  /**
   * Advance the head pointer of a branch to a new version
   */
  async updateBranchHead(postId: string, branchName: string, versionId: string): Promise<void> {
    const branch = await this.getBranchByName(postId, branchName);
    if (branch) {
      branch.headVersionId = versionId;
      await this.storeBranch(branch);
    }
  }

  /**
   * Persist a branch record to Redis
   */
  async storeBranch(branch: VersionBranch): Promise<void> {
    await this.redis.setex(`branch:${branch.id}`, 86400, JSON.stringify(branch));
    await this.redis.hset(`branches:${branch.postId}`, branch.name, branch.id);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async emitBranchEvent(eventType: string, branch: VersionBranch): Promise<void> {
    await this.eventService.publishEvent({
      id: this.generateId(),
      type: eventType,
      aggregateId: branch.postId,
      aggregateType: "VersionBranch",
      version: 1,
      data: { branch },
      metadata: { source: "BranchManager" },
      timestamp: new Date(),
    });
  }

  private generateId(): string {
    return `version_${randomUUID()}`;
  }
}
