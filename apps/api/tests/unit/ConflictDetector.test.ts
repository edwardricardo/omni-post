/**
 * @file ConflictDetector.test.ts
 * @description Mutation-killing tests for ConflictDetector — covers change detection,
 * conflict detection, resolution application, history management.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import {
  ConflictDetector,
  type SyncChannel,
  type SyncConflict,
} from "../../src/content/ConflictDetector.js";

// ============================================================================
// Helpers
// ============================================================================

function makeChannel(overrides: Partial<SyncChannel> = {}): SyncChannel {
  return {
    id: "ch-1",
    name: "Test Channel",
    sourceProvider: "x" as any,
    targetProvider: "instagram" as any,
    bidirectional: false,
    enabled: true,
    configuration: {} as any,
    healthStatus: "healthy",
    errorCount: 0,
    successRate: 100,
    ...overrides,
  };
}

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    projectId: "proj-1",
    locale: "en" as const,
    body: "Test content",
    ...overrides,
  };
}

// ============================================================================
// Suite
// ============================================================================

describe("ConflictDetector", () => {
  let detector: ConflictDetector;
  const channel = makeChannel();

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new ConflictDetector();
  });

  // =========================================================================
  // detectChanges
  // =========================================================================

  describe("detectChanges", () => {
    it("returns create operations when target is null", async () => {
      const source = makePost({ body: "Hello" });
      const changes = await detector.detectChanges(source, null, channel);
      assert.ok(changes.length > 0);
      for (const change of changes) {
        assert.equal(change.operation, "create");
      }
    });

    it("returns update operations for modified fields", async () => {
      const source = makePost({ body: "New text" });
      const target = makePost({ body: "Old text" });
      const changes = await detector.detectChanges(source, target, channel);
      const bodyChange = changes.find((c) => c.field === "body");
      assert.ok(bodyChange);
      assert.equal(bodyChange.operation, "update");
      assert.equal(bodyChange.oldValue, "Old text");
      assert.equal(bodyChange.newValue, "New text");
    });

    it("returns empty array when contents are identical", async () => {
      const post = makePost({ body: "Same" });
      const changes = await detector.detectChanges(post, post, channel);
      assert.equal(changes.length, 0);
    });

    it("excludes id, createdAt, updatedAt, metadata from comparison", async () => {
      const source = makePost({ body: "text" });
      const target = makePost({ body: "text" });
      const changes = await detector.detectChanges(source, target, channel);
      const idChange = changes.find((c) => c.field === "id");
      assert.equal(idChange, undefined);
    });

    it("includes providerId from channel in changes", async () => {
      const ch = makeChannel({ sourceProvider: "facebook" as any });
      const changes = await detector.detectChanges(
        makePost({ body: "A" }),
        makePost({ body: "B" }),
        ch
      );
      assert.ok(changes[0]?.providerId === "facebook");
    });

    it("includes checksum for each change", async () => {
      const changes = await detector.detectChanges(
        makePost({ body: "New" }),
        makePost({ body: "Old" }),
        channel
      );
      assert.ok(changes[0]?.checksum);
      assert.ok(changes[0].checksum.length > 0);
    });

    it("detects changes in nested objects via JSON comparison", async () => {
      const source = makePost({ tags: ["a", "b"] });
      const target = makePost({ tags: ["a", "c"] });
      const changes = await detector.detectChanges(source, target, channel);
      const tagsChange = changes.find((c) => c.field === "tags");
      assert.ok(tagsChange);
    });
  });

  // =========================================================================
  // detectConflicts
  // =========================================================================

  describe("detectConflicts", () => {
    it("detects schema mismatch when update sets value to null", async () => {
      const changes = [
        {
          id: "ch-1",
          field: "body",
          operation: "update" as const,
          oldValue: "text",
          newValue: null,
          providerId: "x" as any,
          timestamp: new Date(),
          checksum: "abc",
        },
      ];
      const conflicts = await detector.detectConflicts(changes, channel);
      const schemaMismatch = conflicts.find((c) => c.type === "schema_mismatch");
      assert.ok(schemaMismatch);
      assert.equal(schemaMismatch.severity, "medium");
    });

    it("detects validation failure when content field is empty string", async () => {
      const changes = [
        {
          id: "ch-2",
          field: "content",
          operation: "update" as const,
          oldValue: "text",
          newValue: "",
          providerId: "x" as any,
          timestamp: new Date(),
          checksum: "def",
        },
      ];
      const conflicts = await detector.detectConflicts(changes, channel);
      const validationFailure = conflicts.find((c) => c.type === "validation_failure");
      assert.ok(validationFailure);
      assert.equal(validationFailure.severity, "critical");
    });

    it("returns empty array when no conflicts detected", async () => {
      const changes = [
        {
          id: "ch-3",
          field: "body",
          operation: "update" as const,
          oldValue: "old",
          newValue: "new",
          providerId: "x" as any,
          timestamp: new Date(),
          checksum: "ghi",
        },
      ];
      const conflicts = await detector.detectConflicts(changes, channel);
      // body update with non-null value: no schema mismatch, no validation failure
      const schemaOrValidation = conflicts.filter(
        (c) => c.type === "schema_mismatch" || c.type === "validation_failure"
      );
      // May or may not have concurrent_modification depending on history
      assert.ok(schemaOrValidation.length === 0);
    });

    it("stores conflicts in history", async () => {
      const changes = [
        {
          id: "ch-4",
          field: "body",
          operation: "update" as const,
          oldValue: "text",
          newValue: null,
          providerId: "x" as any,
          timestamp: new Date(),
          checksum: "jkl",
        },
      ];
      await detector.detectConflicts(changes, channel);
      const history = detector.getConflictHistory(channel.id);
      assert.ok(history.length > 0);
    });
  });

  // =========================================================================
  // applyResolutions
  // =========================================================================

  describe("applyResolutions", () => {
    const makeConflict = (id: string): SyncConflict => ({
      id,
      type: "concurrent_modification",
      field: "body",
      sourceValue: "source text",
      targetValue: "target text",
      severity: "high",
    });

    it("resolves with source value when source_wins", async () => {
      const conflicts = [makeConflict("c1")];
      const result = await detector.applyResolutions(conflicts, [
        { conflictId: "c1", resolution: "source_wins" },
      ]);
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value[0]?.resolvedValue, "source text");
        assert.equal(result.value[0]?.resolution, "source_wins");
      }
    });

    it("resolves with target value when target_wins", async () => {
      const conflicts = [makeConflict("c2")];
      const result = await detector.applyResolutions(conflicts, [
        { conflictId: "c2", resolution: "target_wins" },
      ]);
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value[0]?.resolvedValue, "target text");
      }
    });

    it("uses manual resolvedValue when resolution is manual", async () => {
      const conflicts = [makeConflict("c3")];
      const result = await detector.applyResolutions(conflicts, [
        { conflictId: "c3", resolution: "manual", resolvedValue: "custom text" },
      ]);
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value[0]?.resolvedValue, "custom text");
      }
    });

    it("merges objects when resolution is merge", async () => {
      const conflict: SyncConflict = {
        id: "c4",
        type: "concurrent_modification",
        field: "meta",
        sourceValue: { a: 1, b: 2 },
        targetValue: { b: 3, c: 4 },
        severity: "high",
      };
      const result = await detector.applyResolutions(
        [conflict],
        [{ conflictId: "c4", resolution: "merge" }]
      );
      assert.ok(result.ok);
      if (result.ok) {
        const merged = result.value[0]?.resolvedValue as Record<string, number>;
        assert.equal(merged.a, 1); // from source
        assert.equal(merged.b, 2); // source wins
        assert.equal(merged.c, 4); // from target
      }
    });

    it("returns error when conflict not found", async () => {
      const result = await detector.applyResolutions(
        [],
        [{ conflictId: "nonexistent", resolution: "source_wins" }]
      );
      assert.ok(!result.ok);
    });
  });

  // =========================================================================
  // areAllConflictsResolved / getUnresolvedConflicts
  // =========================================================================

  describe("areAllConflictsResolved", () => {
    it("returns true when all conflicts have resolution", () => {
      const conflicts: SyncConflict[] = [
        {
          id: "1",
          type: "concurrent_modification",
          field: "f",
          sourceValue: "s",
          targetValue: "t",
          severity: "high",
          resolution: "source_wins",
        },
      ];
      assert.equal(detector.areAllConflictsResolved(conflicts), true);
    });

    it("returns false when some conflicts lack resolution", () => {
      const conflicts: SyncConflict[] = [
        {
          id: "1",
          type: "concurrent_modification",
          field: "f",
          sourceValue: "s",
          targetValue: "t",
          severity: "high",
          resolution: "source_wins",
        },
        {
          id: "2",
          type: "schema_mismatch",
          field: "g",
          sourceValue: "s",
          targetValue: "t",
          severity: "medium",
        },
      ];
      assert.equal(detector.areAllConflictsResolved(conflicts), false);
    });

    it("returns true for empty array", () => {
      assert.equal(detector.areAllConflictsResolved([]), true);
    });
  });

  describe("getUnresolvedConflicts", () => {
    it("returns only unresolved conflicts", () => {
      const conflicts: SyncConflict[] = [
        {
          id: "1",
          type: "concurrent_modification",
          field: "f",
          sourceValue: "s",
          targetValue: "t",
          severity: "high",
          resolution: "source_wins",
        },
        {
          id: "2",
          type: "schema_mismatch",
          field: "g",
          sourceValue: "s",
          targetValue: "t",
          severity: "medium",
        },
      ];
      const unresolved = detector.getUnresolvedConflicts(conflicts);
      assert.equal(unresolved.length, 1);
      assert.equal(unresolved[0]?.id, "2");
    });

    it("returns empty array when all resolved", () => {
      const conflicts: SyncConflict[] = [
        {
          id: "1",
          type: "concurrent_modification",
          field: "f",
          sourceValue: "s",
          targetValue: "t",
          severity: "high",
          resolution: "source_wins",
        },
      ];
      assert.equal(detector.getUnresolvedConflicts(conflicts).length, 0);
    });
  });

  // =========================================================================
  // Conflict history
  // =========================================================================

  describe("conflict history", () => {
    it("returns empty array for unknown channel", () => {
      assert.deepEqual(detector.getConflictHistory("unknown"), []);
    });

    it("clears history for a channel", async () => {
      // Generate some conflicts
      const changes = [
        {
          id: "ch-5",
          field: "body",
          operation: "update" as const,
          oldValue: "x",
          newValue: null,
          providerId: "x" as any,
          timestamp: new Date(),
          checksum: "z",
        },
      ];
      await detector.detectConflicts(changes, channel);
      assert.ok(detector.getConflictHistory(channel.id).length > 0);

      detector.clearConflictHistory(channel.id);
      assert.equal(detector.getConflictHistory(channel.id).length, 0);
    });
  });
});
