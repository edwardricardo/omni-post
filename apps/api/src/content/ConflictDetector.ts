/**
 * @file ConflictDetector.ts
 * @description Sync conflict detection and resolution: intelligent conflict detection
 *              between source and target content with automated resolution strategies.
 * @layer infrastructure
 */

import { randomUUID } from "node:crypto";
import type { SyncConfiguration, OrchestrationResult } from "@shared/types/orchestration.js";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface.js";

export interface SyncChange {
  id: string;
  field: string;
  operation: "create" | "update" | "delete";
  oldValue: unknown;
  newValue: unknown;
  providerId: ProviderId;
  timestamp: Date;
  checksum: string;
}

export interface SyncConflict {
  id: string;
  type:
    | "concurrent_modification"
    | "schema_mismatch"
    | "validation_failure"
    | "dependency_violation";
  field: string;
  sourceValue: unknown;
  targetValue: unknown;
  resolution?: "source_wins" | "target_wins" | "merge" | "manual";
  resolvedValue?: unknown;
  severity: "low" | "medium" | "high" | "critical";
}

export interface ConflictResolution {
  conflictId: string;
  resolution: "source_wins" | "target_wins" | "merge" | "manual";
  resolvedValue?: unknown;
}

export interface SyncChannel {
  id: string;
  name: string;
  sourceProvider: ProviderId;
  targetProvider: ProviderId;
  bidirectional: boolean;
  enabled: boolean;
  lastSyncAt?: Date;
  configuration: SyncConfiguration;
  healthStatus: "healthy" | "degraded" | "failed";
  errorCount: number;
  successRate: number;
}

export class ConflictDetector {
  private conflictHistory = new Map<string, SyncConflict[]>();

  /**
   * Detect changes between source and target content
   */
  async detectChanges(
    sourceContent: CanonicalPost,
    targetContent: CanonicalPost | null,
    channel: SyncChannel
  ): Promise<SyncChange[]> {
    const changes: SyncChange[] = [];

    // If no target content, all source fields are create operations
    if (!targetContent) {
      return this.detectCreateChanges(sourceContent, channel);
    }

    // Compare content fields
    const fields = this.getComparableFields(sourceContent);

    for (const field of fields) {
      const sourceValue = (sourceContent as Record<string, unknown>)[field];
      const targetValue = (targetContent as Record<string, unknown>)[field];

      if (this.hasChanged(sourceValue, targetValue)) {
        changes.push({
          id: this.generateId(),
          field,
          operation: "update",
          oldValue: targetValue,
          newValue: sourceValue,
          providerId: channel.sourceProvider,
          timestamp: new Date(),
          checksum: this.calculateChecksum(sourceValue),
        });
      }
    }

    return changes;
  }

  /**
   * Detect conflicts in the changes
   */
  async detectConflicts(changes: SyncChange[], channel: SyncChannel): Promise<SyncConflict[]> {
    const conflicts: SyncConflict[] = [];

    for (const change of changes) {
      // Check for concurrent modifications
      const concurrentConflict = await this.detectConcurrentModification(change, channel);
      if (concurrentConflict) {
        conflicts.push(concurrentConflict);
      }

      // Check for schema mismatches
      const schemaConflict = this.detectSchemaMismatch(change, channel);
      if (schemaConflict) {
        conflicts.push(schemaConflict);
      }

      // Check for validation failures
      const validationConflict = this.detectValidationFailure(change, channel);
      if (validationConflict) {
        conflicts.push(validationConflict);
      }
    }

    // Store conflict history
    if (conflicts.length > 0) {
      this.conflictHistory.set(channel.id, [
        ...(this.conflictHistory.get(channel.id) || []),
        ...conflicts,
      ]);
    }

    return conflicts;
  }

  /**
   * Apply conflict resolutions to a set of conflicts
   */
  async applyResolutions(
    conflicts: SyncConflict[],
    resolutions: ConflictResolution[]
  ): Promise<OrchestrationResult<SyncConflict[]>> {
    try {
      const resolvedConflicts: SyncConflict[] = [];

      for (const resolution of resolutions) {
        const conflict = conflicts.find((c) => c.id === resolution.conflictId);
        if (!conflict) {
          return {
            ok: false,
            error: {
              id: this.generateId(),
              type: "validation",
              message: `Conflict not found: ${resolution.conflictId}`,
              retryable: false,
              occurredAt: new Date(),
            },
          };
        }

        // Apply resolution strategy
        const resolvedValue = this.resolveConflictValue(conflict, resolution);

        resolvedConflicts.push({
          ...conflict,
          resolution: resolution.resolution,
          resolvedValue,
        });
      }

      return { ok: true, value: resolvedConflicts };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to apply resolutions: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Check if all conflicts in a list are resolved
   */
  areAllConflictsResolved(conflicts: SyncConflict[]): boolean {
    return conflicts.every((c) => c.resolution !== undefined);
  }

  /**
   * Get unresolved conflicts from a list
   */
  getUnresolvedConflicts(conflicts: SyncConflict[]): SyncConflict[] {
    return conflicts.filter((c) => !c.resolution);
  }

  /**
   * Get conflict history for a channel
   */
  getConflictHistory(channelId: string): SyncConflict[] {
    return this.conflictHistory.get(channelId) || [];
  }

  /**
   * Clear conflict history for a channel
   */
  clearConflictHistory(channelId: string): void {
    this.conflictHistory.delete(channelId);
  }

  /**
   * Private helper methods
   */

  private detectCreateChanges(sourceContent: CanonicalPost, channel: SyncChannel): SyncChange[] {
    const changes: SyncChange[] = [];
    const fields = this.getComparableFields(sourceContent);

    for (const field of fields) {
      const value = (sourceContent as Record<string, unknown>)[field];
      changes.push({
        id: this.generateId(),
        field,
        operation: "create",
        oldValue: null,
        newValue: value,
        providerId: channel.sourceProvider,
        timestamp: new Date(),
        checksum: this.calculateChecksum(value),
      });
    }

    return changes;
  }

  private getComparableFields(content: CanonicalPost): string[] {
    // Get fields that should be compared for changes
    return Object.keys(content).filter((key) => {
      // Exclude certain fields from comparison
      return !["id", "createdAt", "updatedAt", "metadata"].includes(key);
    });
  }

  private hasChanged(sourceValue: unknown, targetValue: unknown): boolean {
    // Deep comparison for objects and arrays
    if (typeof sourceValue === "object" && typeof targetValue === "object") {
      return JSON.stringify(sourceValue) !== JSON.stringify(targetValue);
    }
    return sourceValue !== targetValue;
  }

  private calculateChecksum(value: unknown): string {
    // Simple checksum based on JSON stringification
    const str = JSON.stringify(value);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private async detectConcurrentModification(
    change: SyncChange,
    channel: SyncChannel
  ): Promise<SyncConflict | null> {
    // Check if the same field was modified concurrently
    const recentHistory = this.conflictHistory.get(channel.id) || [];
    const recentChange = recentHistory.find(
      (c) =>
        c.field === change.field &&
        c.type === "concurrent_modification" &&
        new Date().getTime() - new Date(change.timestamp).getTime() < 60000 // Within 1 minute
    );

    if (recentChange) {
      return {
        id: this.generateId(),
        type: "concurrent_modification",
        field: change.field,
        sourceValue: change.newValue,
        targetValue: change.oldValue,
        severity: "high",
      };
    }

    return null;
  }

  private detectSchemaMismatch(change: SyncChange, _channel: SyncChannel): SyncConflict | null {
    // Check if the new value matches expected schema
    if (change.newValue === null && change.operation === "update") {
      return {
        id: this.generateId(),
        type: "schema_mismatch",
        field: change.field,
        sourceValue: change.newValue,
        targetValue: change.oldValue,
        severity: "medium",
      };
    }

    return null;
  }

  private detectValidationFailure(change: SyncChange, _channel: SyncChannel): SyncConflict | null {
    // Validate the new value meets requirements
    if (change.field === "content" && typeof change.newValue === "string") {
      if (change.newValue.length === 0) {
        return {
          id: this.generateId(),
          type: "validation_failure",
          field: change.field,
          sourceValue: change.newValue,
          targetValue: change.oldValue,
          severity: "critical",
        };
      }
    }

    return null;
  }

  private resolveConflictValue(conflict: SyncConflict, resolution: ConflictResolution): unknown {
    switch (resolution.resolution) {
      case "source_wins":
        return conflict.sourceValue;
      case "target_wins":
        return conflict.targetValue;
      case "merge":
        return this.mergeValues(conflict.sourceValue, conflict.targetValue);
      case "manual":
        return resolution.resolvedValue;
      default:
        return conflict.sourceValue;
    }
  }

  private mergeValues(sourceValue: unknown, targetValue: unknown): unknown {
    // Simple merge strategy - prefer source for primitives
    if (typeof sourceValue === "object" && typeof targetValue === "object") {
      return { ...targetValue, ...sourceValue };
    }
    return sourceValue;
  }

  private generateId(): string {
    return `conflict_${randomUUID()}`;
  }
}
