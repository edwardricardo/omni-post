/**
 * @file dimensionRegistry.test.ts
 * @description Unit tests for the governed dimension registry: bucket-key
 *              derivation per dimension, default fallback for unknown
 *              dimensions, and drift-guard parity with
 *              ReportSchema.AVAILABLE_DIMENSIONS.
 * @layer infrastructure
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  DEFAULT_DIMENSION_KEY,
  dimensionRegistry,
} from "@core/domain/analytics/DimensionRegistry.js";
import { AVAILABLE_DIMENSIONS } from "@core/domain/analytics/ReportSchema.js";
import type { AnalyticsSummaryRow } from "@core/domain/repositories/AnalyticsAggregationQueryPort.js";

const sample: AnalyticsSummaryRow = {
  date: new Date("2026-03-04T12:00:00Z"),
  provider: "INSTAGRAM",
  channelId: "ch-42",
  postId: "p-1",
  views: 1,
  likes: 1,
  comments: 1,
  shares: 1,
  records: 1,
};

describe("dimensionRegistry", () => {
  it("derives the bucket key per governed dimension", () => {
    assert.strictEqual(dimensionRegistry.resolve("date").keyOf(sample), "2026-03-04");
    assert.strictEqual(dimensionRegistry.resolve("platform").keyOf(sample), "INSTAGRAM");
    assert.strictEqual(dimensionRegistry.resolve("channel").keyOf(sample), "ch-42");
  });

  it("falls back to the default dimension for an unknown key", () => {
    assert.strictEqual(dimensionRegistry.has("campaign"), false);
    assert.strictEqual(dimensionRegistry.resolve("campaign").key, DEFAULT_DIMENSION_KEY);
  });

  it("drift guard: AVAILABLE_DIMENSIONS keys === registry keys", () => {
    const schemaKeys = Object.keys(AVAILABLE_DIMENSIONS).sort();
    const registryKeys = dimensionRegistry
      .list()
      .map((d) => d.key)
      .sort();
    assert.deepStrictEqual(schemaKeys, registryKeys);
  });

  it("catalog() mirrors the schema label shape", () => {
    assert.deepStrictEqual(dimensionRegistry.catalog(), AVAILABLE_DIMENSIONS);
  });
});
