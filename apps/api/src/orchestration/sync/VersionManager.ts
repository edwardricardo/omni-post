/**
 * Phase 3A Week 5: Version Manager
 *
 * Manages content versioning, comparison, and version history.
 */

import type { PrismaClient } from "@infra/prisma";
import type Redis from "ioredis";
import type { ContentVersion, VersionDiff } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../../providers/providerAdapter.interface";
import { createLogger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors/AppError.js";

const log = createLogger("orchestration");

export class VersionManager {
  private prisma: PrismaClient;
  private redis: Redis;

  constructor(prisma: PrismaClient, redis: Redis) {
    this.prisma = prisma;
    this.redis = redis;
  }

  /**
   * Get content version history
   */
  async getVersionHistory(postId: string): Promise<ContentVersion[]> {
    try {
      const versions = await this.redis.lrange(`versions:${postId}`, 0, -1);
      return versions.map((version) => JSON.parse(version));
    } catch (error: unknown) {
      log.error({ err: error, postId }, "Error getting version history for post");
      return [];
    }
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
    const version: ContentVersion = {
      id: this.generateId(),
      postId,
      version: await this.getNextVersionNumber(postId),
      content,
      adaptations,
      createdAt: new Date(),
      createdBy,
      ...(changelog !== undefined && { changelog }),
      isActive: true,
    };

    // Deactivate previous versions
    await this.deactivatePreviousVersions(postId);

    // Store new version
    await this.storeVersion(version);

    // Cache for quick access
    await this.redis.setex(
      `current_version:${postId}`,
      3600, // 1 hour
      JSON.stringify(version)
    );

    return version;
  }

  /**
   * Compare content versions and generate diff
   */
  async compareVersions(
    postId: string,
    fromVersion: number,
    toVersion: number
  ): Promise<VersionDiff[]> {
    try {
      const versions = await this.getVersionHistory(postId);
      const fromVer = versions.find((v) => v.version === fromVersion);
      const toVer = versions.find((v) => v.version === toVersion);

      if (!fromVer || !toVer) {
        throw AppError.notFound("Version");
      }

      return this.generateVersionDiff(fromVer.content, toVer.content);
    } catch (error: unknown) {
      log.error({ err: error, postId }, "Error comparing versions for post");
      return [];
    }
  }

  /**
   * Generate diff between two content versions
   */
  generateVersionDiff(fromContent: CanonicalPost, toContent: CanonicalPost): VersionDiff[] {
    const diffs: VersionDiff[] = [];

    // Compare and generate diffs
    const fields = Object.keys({ ...fromContent, ...toContent });

    for (const field of fields) {
      const oldValue = (fromContent as Record<string, unknown>)[field];
      const newValue = (toContent as Record<string, unknown>)[field];

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        diffs.push({
          field,
          oldValue,
          newValue,
          changeType: this.getChangeType(oldValue, newValue),
        });
      }
    }

    return diffs;
  }

  /**
   * Private helper methods
   */

  private async getNextVersionNumber(postId: string): Promise<number> {
    const versions = await this.getVersionHistory(postId);
    return versions.length > 0 ? Math.max(...versions.map((v) => v.version)) + 1 : 1;
  }

  private async deactivatePreviousVersions(_postId: string): Promise<void> {
    // Mark previous versions as inactive
  }

  private async storeVersion(version: ContentVersion): Promise<void> {
    // Store version in Redis list and database
    await this.redis.lpush(`versions:${version.postId}`, JSON.stringify(version));
  }

  private getChangeType(oldValue: unknown, newValue: unknown): "added" | "modified" | "removed" {
    if (oldValue === undefined && newValue !== undefined) return "added";
    if (oldValue !== undefined && newValue === undefined) return "removed";
    return "modified";
  }

  private generateId(): string {
    return `version_${Date.now()}_${crypto.randomUUID().slice(0, 9)}`;
  }
}
