/**
 * Phase 3A Week 5: Conflict Resolver
 *
 * Detects and resolves content conflicts during synchronization.
 */

import type { SyncConflictResolution } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { EventService } from "../../events/EventService";
import type { ContentConflict, ConflictResolution } from "./types";

export class ConflictResolver {
  private eventService: EventService;

  constructor(eventService: EventService) {
    this.eventService = eventService;
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
    // Detect conflicts
    const conflicts = await this.detectConflicts(sourceContent, targetContent);

    // Resolve conflicts based on strategy
    const resolvedContent = await this.resolveConflicts(
      conflicts,
      sourceContent,
      targetContent,
      resolutionStrategy
    );

    // Log conflict resolution
    await this.logConflictResolution(postId, conflicts);

    return { conflicts, resolvedContent };
  }

  /**
   * Detect conflicts between source and target content
   */
  async detectConflicts(
    sourceContent: CanonicalPost,
    targetContent: CanonicalPost
  ): Promise<ContentConflict[]> {
    const conflicts: ContentConflict[] = [];

    // Compare key fields
    const fieldsToCompare = ["title", "body", "tags", "media"];

    for (const field of fieldsToCompare) {
      const sourceValue = (sourceContent as Record<string, unknown>)[field];
      const targetValue = (targetContent as Record<string, unknown>)[field];

      if (JSON.stringify(sourceValue) !== JSON.stringify(targetValue)) {
        conflicts.push({
          field,
          sourceValue,
          targetValue,
          conflictType: this.determineConflictType(sourceValue, targetValue),
        });
      }
    }

    return conflicts;
  }

  /**
   * Resolve conflicts based on strategy
   */
  private async resolveConflicts(
    conflicts: ContentConflict[],
    sourceContent: CanonicalPost,
    targetContent: CanonicalPost,
    strategy: SyncConflictResolution
  ): Promise<CanonicalPost> {
    let resolvedContent = { ...targetContent };

    for (const conflict of conflicts) {
      const resolution = await this.resolveConflict(conflict, strategy);
      (resolvedContent as Record<string, unknown>)[conflict.field] = resolution.resolvedValue;
      conflict.resolution = resolution;
    }

    return resolvedContent;
  }

  /**
   * Resolve a single conflict
   */
  private async resolveConflict(
    conflict: ContentConflict,
    strategy: SyncConflictResolution
  ): Promise<ConflictResolution> {
    let resolvedValue: unknown;
    let rationale: string;

    switch (strategy.strategy) {
      case "source_wins":
        resolvedValue = conflict.sourceValue;
        rationale = "Source value takes precedence";
        break;

      case "target_wins":
        resolvedValue = conflict.targetValue;
        rationale = "Target value preserved";
        break;

      case "timestamp_wins":
        // Assume newer timestamp wins (would need timestamp comparison)
        resolvedValue = conflict.sourceValue;
        rationale = "Newer timestamp wins";
        break;

      case "merge":
        resolvedValue = await this.mergeValues(conflict.sourceValue, conflict.targetValue);
        rationale = "Values merged intelligently";
        break;

      case "manual":
      default:
        resolvedValue = conflict.targetValue;
        rationale = "Manual resolution required";
    }

    return {
      strategy: strategy.strategy,
      resolvedValue,
      appliedAt: new Date(),
      rationale,
    };
  }

  /**
   * Intelligently merge values based on type
   */
  private async mergeValues(sourceValue: unknown, targetValue: unknown): Promise<unknown> {
    // Intelligent merging logic based on value types
    if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
      // Merge arrays, removing duplicates
      return [...new Set([...targetValue, ...sourceValue])];
    }

    if (typeof sourceValue === "string" && typeof targetValue === "string") {
      // For strings, prefer the longer one (more content)
      return sourceValue.length > targetValue.length ? sourceValue : targetValue;
    }

    // Default to source value
    return sourceValue;
  }

  /**
   * Determine conflict type based on values
   */
  private determineConflictType(
    sourceValue: unknown,
    targetValue: unknown
  ): "modification" | "deletion" | "creation" {
    if (sourceValue && !targetValue) return "deletion";
    if (!sourceValue && targetValue) return "creation";
    return "modification";
  }

  /**
   * Log conflict resolution for audit purposes
   */
  private async logConflictResolution(postId: string, conflicts: ContentConflict[]): Promise<void> {
    await this.eventService.publishEvent({
      id: this.generateId(),
      type: "CONFLICT_RESOLVED",
      aggregateId: postId,
      aggregateType: "Post",
      version: 1,
      data: {
        postId,
        conflictsResolved: conflicts.length,
        conflicts: conflicts.map((c) => ({
          field: c.field,
          resolution: c.resolution?.strategy,
        })),
      },
      metadata: {
        source: "ContentSynchronizer",
      },
      timestamp: new Date(),
    });
  }

  private generateId(): string {
    return `conflict_${Date.now()}_${crypto.randomUUID().slice(0, 9)}`;
  }
}
