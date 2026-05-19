/**
 * @file metricRegistry.test.ts
 * @description Unit tests for the governed metric registry: each formula
 *              over fixture rows (incl. ratio ÷0 guard and distinct-post
 *              aggregation), catalog shape, and the drift-guard parity
 *              assertion against ReportSchema.AVAILABLE_METRICS.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { metricRegistry } from "../../../src/domain/analytics/MetricRegistry.js";
import { AVAILABLE_METRICS } from "../../../src/domain/analytics/ReportSchema.js";
import type { AnalyticsSummaryRow } from "../../../src/domain/repositories/AnalyticsAggregationQueryPort.js";

const row = (over: Partial<AnalyticsSummaryRow> = {}): AnalyticsSummaryRow => ({
  date: new Date("2026-03-01"),
  provider: "X",
  channelId: "ch-1",
  postId: "p-1",
  views: 100,
  likes: 10,
  comments: 5,
  shares: 3,
  records: 1,
  ...over,
});

const agg = (key: string, rows: AnalyticsSummaryRow[]): number => {
  const def = metricRegistry.get(key);
  assert.ok(def, `metric ${key} must be governed`);
  return def.aggregate(rows);
};

describe("metricRegistry — formulas", () => {
  const rows = [
    row({ postId: "p-1", views: 100, likes: 10, comments: 5, shares: 3, records: 1 }),
    row({ postId: "p-2", views: 300, likes: 20, comments: 5, shares: 5, records: 2 }),
  ];

  it("sums additive metrics", () => {
    assert.strictEqual(agg("impressions", rows), 400);
    assert.strictEqual(agg("likes", rows), 30);
    assert.strictEqual(agg("comments", rows), 10);
    assert.strictEqual(agg("shares", rows), 8);
    assert.strictEqual(agg("engagement", rows), 30 + 10 + 8);
    assert.strictEqual(agg("records", rows), 3);
  });

  it("computes engagement_rate as a ratio over the bucket", () => {
    // (48 engagement / 400 views) * 100
    assert.strictEqual(agg("engagement_rate", rows), 12);
  });

  it("guards engagement_rate against division by zero", () => {
    assert.strictEqual(agg("engagement_rate", [row({ views: 0, likes: 5 })]), 0);
  });

  it("counts distinct posts and per-post averages", () => {
    const dup = [
      row({ postId: "p-1", views: 100 }),
      row({ postId: "p-1", views: 50 }),
      row({ postId: "p-2", views: 90 }),
    ];
    assert.strictEqual(agg("post_count", dup), 2);
    assert.strictEqual(agg("avg_views_per_post", dup), (100 + 50 + 90) / 2);
  });

  it("ignores null postId in distinct post count", () => {
    assert.strictEqual(agg("post_count", [row({ postId: null }), row({ postId: null })]), 0);
    assert.strictEqual(agg("avg_views_per_post", [row({ postId: null, views: 100 })]), 0);
  });

  it("exposes at least 10 governed metrics with stable keys/labels/types", () => {
    expect(metricRegistry.list().length).toBeGreaterThanOrEqual(10);
    for (const def of metricRegistry.list()) {
      assert.ok(def.key.length > 0);
      assert.ok(def.label.length > 0);
      assert.ok(def.type === "number" || def.type === "percentage");
    }
  });
});

describe("metricRegistry — drift guard", () => {
  it("catalog parity: ReportSchema.AVAILABLE_METRICS keys === registry keys", () => {
    const schemaKeys = Object.keys(AVAILABLE_METRICS).sort();
    const registryKeys = metricRegistry
      .list()
      .map((m) => m.key)
      .sort();
    assert.deepStrictEqual(schemaKeys, registryKeys);
  });

  it("catalog() mirrors the schema label/type shape", () => {
    assert.deepStrictEqual(metricRegistry.catalog(), AVAILABLE_METRICS);
  });
});
