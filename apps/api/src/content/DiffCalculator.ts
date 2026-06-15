/**
 * @file DiffCalculator.ts
 * @description Detailed difference calculation between content versions including
 *              content comparison and adaptation tracking.
 * @layer infrastructure
 */

import { ContentVersion, VersionDiff } from "@shared/types/orchestration.js";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface.js";

export class DiffCalculator {
  /**
   * Generate detailed diff between two versions
   */
  generateDiff(fromVersion: ContentVersion, toVersion: ContentVersion): VersionDiff[] {
    const diffs: VersionDiff[] = [];

    // Compare main content
    const contentDiffs = this.compareContent(fromVersion.content, toVersion.content);
    diffs.push(...contentDiffs);

    // Compare adaptations
    const adaptationDiffs = this.compareAdaptations(fromVersion.adaptations, toVersion.adaptations);
    diffs.push(...adaptationDiffs);

    return diffs;
  }

  /**
   * Compare main content between versions
   */
  private compareContent(fromContent: CanonicalPost, toContent: CanonicalPost): VersionDiff[] {
    return this.compareObjects(fromContent, toContent, "content");
  }

  /**
   * Compare adaptations between versions
   */
  private compareAdaptations(
    fromAdaptations: Record<ProviderId, CanonicalPost>,
    toAdaptations: Record<ProviderId, CanonicalPost>
  ): VersionDiff[] {
    const diffs: VersionDiff[] = [];

    const allProviders = new Set([...Object.keys(fromAdaptations), ...Object.keys(toAdaptations)]);

    for (const providerId of allProviders) {
      const fromAdaptation = fromAdaptations[providerId as ProviderId];
      const toAdaptation = toAdaptations[providerId as ProviderId];

      if (!fromAdaptation && toAdaptation) {
        diffs.push({
          field: `adaptations.${providerId}`,
          oldValue: undefined,
          newValue: toAdaptation,
          changeType: "added",
        });
      } else if (fromAdaptation && !toAdaptation) {
        diffs.push({
          field: `adaptations.${providerId}`,
          oldValue: fromAdaptation,
          newValue: undefined,
          changeType: "removed",
        });
      } else if (fromAdaptation && toAdaptation) {
        const adaptationDiffs = this.compareObjects(
          fromAdaptation,
          toAdaptation,
          `adaptations.${providerId}`
        );
        diffs.push(...adaptationDiffs);
      }
    }

    return diffs;
  }

  /**
   * Compare two objects recursively
   */
  private compareObjects(
    obj1: Record<string, unknown>,
    obj2: Record<string, unknown>,
    prefix: string
  ): VersionDiff[] {
    const diffs: VersionDiff[] = [];
    const allKeys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);

    for (const key of allKeys) {
      const field = prefix ? `${prefix}.${key}` : key;
      const val1 = obj1?.[key];
      const val2 = obj2?.[key];

      if (val1 === undefined && val2 !== undefined) {
        diffs.push({
          field,
          oldValue: undefined,
          newValue: val2,
          changeType: "added",
        });
      } else if (val1 !== undefined && val2 === undefined) {
        diffs.push({
          field,
          oldValue: val1,
          newValue: undefined,
          changeType: "removed",
        });
      } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        diffs.push({
          field,
          oldValue: val1,
          newValue: val2,
          changeType: "modified",
        });
      }
    }

    return diffs;
  }

  /**
   * Calculate similarity score between two versions (0-100)
   */
  calculateSimilarity(fromVersion: ContentVersion, toVersion: ContentVersion): number {
    const diffs = this.generateDiff(fromVersion, toVersion);

    if (diffs.length === 0) {
      return 100; // Identical
    }

    // Count total fields in both versions
    const fromFields = this.countFields(fromVersion.content);
    const toFields = this.countFields(toVersion.content);
    const totalFields = Math.max(fromFields, toFields);

    if (totalFields === 0) {
      return 100;
    }

    // Calculate similarity based on unchanged fields
    const changedFields = diffs.length;
    const unchangedFields = totalFields - changedFields;
    const similarity = (unchangedFields / totalFields) * 100;

    return Math.max(0, Math.min(100, similarity));
  }

  /**
   * Count fields in an object recursively
   */
  private countFields(obj: Record<string, unknown>): number {
    let count = 0;
    for (const value of Object.values(obj || {})) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        count += this.countFields(value as Record<string, unknown>);
      } else {
        count++;
      }
    }
    return count;
  }

  /**
   * Get summary of changes
   */
  getSummary(diffs: VersionDiff[]): {
    totalChanges: number;
    additions: number;
    modifications: number;
    deletions: number;
    criticalChanges: string[];
  } {
    const criticalFields = ["title", "body", "content.title", "content.body"];

    return {
      totalChanges: diffs.length,
      additions: diffs.filter((d) => d.changeType === "added").length,
      modifications: diffs.filter((d) => d.changeType === "modified").length,
      deletions: diffs.filter((d) => d.changeType === "removed").length,
      criticalChanges: diffs
        .filter((d) => criticalFields.includes(d.field) && d.changeType !== "added")
        .map((d) => d.field),
    };
  }
}
