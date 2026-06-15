/**
 * @file MergeManager.ts
 * @description Merge-request lifecycle management: creation, conflict detection,
 *              conflict resolution, and merge execution between content version branches.
 * @layer infrastructure
 */

import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { ContentVersion, OrchestrationResult } from "@shared/types/orchestration.js";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface.js";
import { EventService } from "../events/EventService.js";
import { MergeRequest, VersionConflict, ConflictResolution } from "./contentVersionTypes.js";
import { logger } from "../lib/logger.js";

export class MergeManager {
  private redis: Redis;
  private eventService: EventService;

  constructor(dependencies: { redis: Redis; eventService: EventService }) {
    this.redis = dependencies.redis;
    this.eventService = dependencies.eventService;
  }

  /**
   * Create a merge request between two branches.
   * Conflict detection is performed automatically at creation time.
   */
  async createMergeRequest(
    postId: string,
    sourceBranch: string,
    targetBranch: string,
    sourceHeadVersionId: string,
    targetHeadVersionId: string,
    requestedBy: string
  ): Promise<OrchestrationResult<MergeRequest>> {
    try {
      // Detect conflicts between the two branch heads
      const conflicts = await this.detectMergeConflicts(sourceHeadVersionId, targetHeadVersionId);

      const mergeRequest: MergeRequest = {
        id: this.generateId(),
        sourceBranch,
        targetBranch,
        postId,
        status: conflicts.length > 0 ? "conflicted" : "pending",
        conflicts,
        resolutions: [],
        requestedBy,
        requestedAt: new Date(),
      };

      await this.storeMergeRequest(mergeRequest);
      await this.emitMergeEvent("MERGE_REQUEST_CREATED", mergeRequest);

      return { ok: true, value: mergeRequest };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to create merge request: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Apply conflict resolutions to a pending merge request.
   * All conflicts must be resolved before the request can be approved.
   */
  async resolveMergeConflicts(
    mergeRequestId: string,
    resolutions: ConflictResolution[]
  ): Promise<OrchestrationResult<MergeRequest>> {
    try {
      const mergeRequest = await this.getMergeRequest(mergeRequestId);
      if (!mergeRequest) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Merge request not found: ${mergeRequestId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // All conflicts must have a matching resolution
      const unresolvedConflicts = mergeRequest.conflicts.filter(
        (conflict) => !resolutions.some((r) => r.conflictId === conflict.id)
      );

      if (unresolvedConflicts.length > 0) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `${unresolvedConflicts.length} conflicts remain unresolved`,
            retryable: false,
            occurredAt: new Date(),
            context: {
              unresolvedConflicts: unresolvedConflicts.map((c) => c.id),
            },
          },
        };
      }

      mergeRequest.resolutions = resolutions;
      mergeRequest.status = "pending";

      await this.updateMergeRequest(mergeRequest);

      return { ok: true, value: mergeRequest };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to resolve conflicts: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Build the merged content object from source/target versions and resolutions.
   * Returns the merged canonical post and its per-provider adaptations.
   */
  performMerge(
    sourceVersion: ContentVersion,
    targetVersion: ContentVersion,
    resolutions: ConflictResolution[]
  ): { content: CanonicalPost; adaptations: Record<ProviderId, CanonicalPost> } {
    const mergedContent = { ...targetVersion.content };
    const mergedAdaptations = { ...targetVersion.adaptations };

    for (const resolution of resolutions) {
      const field = resolution.conflictId; // Simplified mapping of conflict ID → field

      switch (resolution.strategy) {
        case "use_source":
          this.applyValueToMerged(mergedContent, mergedAdaptations, field, sourceVersion);
          break;
        case "use_target":
          // Target values are already in mergedContent / mergedAdaptations
          break;
        case "merge":
        case "custom":
          this.applyValueToMerged(mergedContent, mergedAdaptations, field, {
            content: { ...mergedContent, [field]: resolution.resolvedValue },
            adaptations: mergedAdaptations,
          });
          break;
      }
    }

    return { content: mergedContent, adaptations: mergedAdaptations };
  }

  /**
   * Fetch a stored merge request by ID
   */
  async getMergeRequest(mergeRequestId: string): Promise<MergeRequest | null> {
    const cached = await this.redis.get(`merge:${mergeRequestId}`);
    return cached ? (JSON.parse(cached) as MergeRequest) : null;
  }

  /**
   * Emit the MERGE_COMPLETED domain event after a successful merge
   */
  async emitMergeCompleted(mergeRequest: MergeRequest): Promise<void> {
    await this.emitMergeEvent("MERGE_COMPLETED", mergeRequest);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async storeMergeRequest(mergeRequest: MergeRequest): Promise<void> {
    await this.redis.setex(`merge:${mergeRequest.id}`, 86400, JSON.stringify(mergeRequest));
  }

  private async updateMergeRequest(mergeRequest: MergeRequest): Promise<void> {
    await this.storeMergeRequest(mergeRequest);
  }

  private async detectMergeConflicts(
    sourceVersionId: string,
    targetVersionId: string
  ): Promise<VersionConflict[]> {
    const conflicts: VersionConflict[] = [];

    try {
      const [sourceRaw, targetRaw] = await Promise.all([
        this.redis.get(`version:${sourceVersionId}`),
        this.redis.get(`version:${targetVersionId}`),
      ]);

      if (!sourceRaw || !targetRaw) {
        return conflicts;
      }

      const sourceVersion = JSON.parse(sourceRaw) as ContentVersion;
      const targetVersion = JSON.parse(targetRaw) as ContentVersion;

      conflicts.push(...this.detectContentConflicts(sourceVersion.content, targetVersion.content));
      conflicts.push(
        ...this.detectAdaptationConflicts(sourceVersion.adaptations, targetVersion.adaptations)
      );

      return conflicts;
    } catch (error) {
      logger.error({ err: error }, "Error detecting merge conflicts");
      return conflicts;
    }
  }

  private detectContentConflicts(
    sourceContent: CanonicalPost,
    targetContent: CanonicalPost
  ): VersionConflict[] {
    const conflicts: VersionConflict[] = [];
    const fieldsToCheck = ["title", "body", "tags", "media"];

    for (const field of fieldsToCheck) {
      const sourceValue = (sourceContent as Record<string, unknown>)[field];
      const targetValue = (targetContent as Record<string, unknown>)[field];

      if (JSON.stringify(sourceValue) !== JSON.stringify(targetValue)) {
        conflicts.push({
          id: this.generateId(),
          field,
          baseValue: null, // Would need base version to determine
          sourceValue,
          targetValue,
          conflictType: "content",
          severity: this.determineSeverity(field),
          autoResolvable: this.isAutoResolvable(field, sourceValue, targetValue),
        });
      }
    }

    return conflicts;
  }

  private detectAdaptationConflicts(
    sourceAdaptations: Record<ProviderId, CanonicalPost>,
    targetAdaptations: Record<ProviderId, CanonicalPost>
  ): VersionConflict[] {
    const conflicts: VersionConflict[] = [];

    const allProviders = new Set([
      ...Object.keys(sourceAdaptations),
      ...Object.keys(targetAdaptations),
    ]);

    for (const providerId of allProviders) {
      const sourceAdaptation = sourceAdaptations[providerId as ProviderId];
      const targetAdaptation = targetAdaptations[providerId as ProviderId];

      if (
        sourceAdaptation &&
        targetAdaptation &&
        JSON.stringify(sourceAdaptation) !== JSON.stringify(targetAdaptation)
      ) {
        conflicts.push({
          id: this.generateId(),
          field: `adaptations.${providerId}`,
          baseValue: null,
          sourceValue: sourceAdaptation,
          targetValue: targetAdaptation,
          conflictType: "adaptation",
          severity: "medium",
          autoResolvable: false,
        });
      }
    }

    return conflicts;
  }

  private determineSeverity(field: string): VersionConflict["severity"] {
    if (field === "body" || field === "title") return "high";
    if (field === "media") return "medium";
    return "low";
  }

  private isAutoResolvable(field: string, sourceValue: unknown, targetValue: unknown): boolean {
    // Arrays of tags can usually be merged automatically
    if (field === "tags" && Array.isArray(sourceValue) && Array.isArray(targetValue)) {
      return true;
    }
    return false;
  }

  private applyValueToMerged(
    mergedContent: CanonicalPost,
    mergedAdaptations: Record<ProviderId, CanonicalPost>,
    field: string,
    sourceVersion: { content: CanonicalPost; adaptations: Record<ProviderId, CanonicalPost> }
  ): void {
    if (field.startsWith("adaptations.")) {
      const providerId = field.split(".")[1] as ProviderId;
      mergedAdaptations[providerId] = sourceVersion.adaptations[providerId];
    } else {
      (mergedContent as Record<string, unknown>)[field] = (
        sourceVersion.content as Record<string, unknown>
      )[field];
    }
  }

  private async emitMergeEvent(eventType: string, mergeRequest: MergeRequest): Promise<void> {
    await this.eventService.publishEvent({
      id: this.generateId(),
      type: eventType,
      aggregateId: mergeRequest.postId,
      aggregateType: "MergeRequest",
      version: 1,
      data: { mergeRequest },
      metadata: { source: "MergeManager" },
      timestamp: new Date(),
    });
  }

  private generateId(): string {
    return `version_${randomUUID()}`;
  }
}
