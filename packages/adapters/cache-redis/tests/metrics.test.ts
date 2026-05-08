/**
 * Cache metrics tests
 * Tests the prom-client metric objects exported from metrics.ts.
 * Each file runs in its own process (node --test), so no double-registration.
 * Tier 0: no Redis, no network.
 *
 * @file metrics.test.ts
 * @description Tests for Cache metrics — exports
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import assert from "node:assert/strict";
import client from "prom-client";

// Import after clearing registry to avoid test-runner pollution
let cacheHits: (typeof import("../src/metrics.js"))["cacheHits"];
let cacheMisses: (typeof import("../src/metrics.js"))["cacheMisses"];
let cacheOperationDuration: (typeof import("../src/metrics.js"))["cacheOperationDuration"];
let cacheSize: (typeof import("../src/metrics.js"))["cacheSize"];

beforeAll(async () => {
  // Each test file is a fresh process so the default registry is empty.
  // Import the metrics module — this registers all metrics on the default registry.
  const mod = await import("../src/metrics.js");
  cacheHits = mod.cacheHits;
  cacheMisses = mod.cacheMisses;
  cacheOperationDuration = mod.cacheOperationDuration;
  cacheSize = mod.cacheSize;
});

afterAll(() => {
  // Clear the registry so any other processes that share this module don't error.
  client.register.clear();
});

describe("Cache metrics — exports", { concurrency: 1 }, () => {
  it("cacheHits is a Counter instance", () => {
    expect(cacheHits instanceof client.Counter).toBe(true);
  });

  it("cacheMisses is a Counter instance", () => {
    expect(cacheMisses instanceof client.Counter).toBe(true);
  });

  it("cacheOperationDuration is a Histogram instance", () => {
    expect(cacheOperationDuration instanceof client.Histogram).toBe(true);
  });

  it("cacheSize is a Gauge instance", () => {
    expect(cacheSize instanceof client.Gauge).toBe(true);
  });
});

describe("Cache metrics — Counter behaviour", { concurrency: 1 }, () => {
  it("cacheHits increments with labels", async () => {
    const before = await getCounterValue("cache_hits_total");
    cacheHits.inc({ operation: "get", key_pattern: "user:*" });
    const after = await getCounterValue("cache_hits_total");
    expect(after).toBeGreaterThan(before);
  });

  it("cacheMisses increments with labels", async () => {
    const before = await getCounterValue("cache_misses_total");
    cacheMisses.inc({ operation: "get", key_pattern: "post:*" });
    const after = await getCounterValue("cache_misses_total");
    expect(after).toBeGreaterThan(before);
  });

  it("cacheHits and cacheMisses are registered in the default registry", async () => {
    const metricsOutput = await client.register.metrics();
    expect(metricsOutput.includes("cache_hits_total")).toBe(true);
    expect(metricsOutput.includes("cache_misses_total")).toBe(true);
  });
});

describe("Cache metrics — Histogram behaviour", { concurrency: 1 }, () => {
  it("startTimer returns a callable that ends the timer", () => {
    const endTimer = cacheOperationDuration.startTimer({ operation: "get", status: "pending" });
    expect(typeof endTimer).toBe("function");
    // Calling endTimer should not throw
    assert.doesNotThrow(() => endTimer({ operation: "get", status: "hit" }));
  });

  it("cacheOperationDuration appears in registry output", async () => {
    const metricsOutput = await client.register.metrics();
    expect(metricsOutput.includes("cache_operation_duration_seconds")).toBe(true);
  });
});

describe("Cache metrics — Gauge behaviour", { concurrency: 1 }, () => {
  it("cacheSize.set() does not throw", () => {
    assert.doesNotThrow(() => cacheSize.set({ instance: "test" }, 1024));
  });

  it("cacheSize appears in registry output", async () => {
    const metricsOutput = await client.register.metrics();
    expect(metricsOutput.includes("cache_size_bytes")).toBe(true);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCounterValue(metricName: string): Promise<number> {
  const metrics = await client.register.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === metricName);
  if (!metric || !("values" in metric)) return 0;
  return (metric as any).values.reduce((sum: number, v: any) => sum + (v.value ?? 0), 0);
}
