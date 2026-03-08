/**
 * Cache metrics tests
 * Tests the prom-client metric objects exported from metrics.ts.
 * Each file runs in its own process (node --test), so no double-registration.
 * Tier 0: no Redis, no network.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import client from "prom-client";

// Import after clearing registry to avoid test-runner pollution
let cacheHits: (typeof import("../src/metrics.js"))["cacheHits"];
let cacheMisses: (typeof import("../src/metrics.js"))["cacheMisses"];
let cacheOperationDuration: (typeof import("../src/metrics.js"))["cacheOperationDuration"];
let cacheSize: (typeof import("../src/metrics.js"))["cacheSize"];

before(async () => {
  // Each test file is a fresh process so the default registry is empty.
  // Import the metrics module — this registers all metrics on the default registry.
  const mod = await import("../src/metrics.js");
  cacheHits = mod.cacheHits;
  cacheMisses = mod.cacheMisses;
  cacheOperationDuration = mod.cacheOperationDuration;
  cacheSize = mod.cacheSize;
});

after(() => {
  // Clear the registry so any other processes that share this module don't error.
  client.register.clear();
});

describe("Cache metrics — exports", { concurrency: 1 }, () => {
  it("cacheHits is a Counter instance", () => {
    assert.ok(cacheHits instanceof client.Counter, "cacheHits should be a Counter");
  });

  it("cacheMisses is a Counter instance", () => {
    assert.ok(cacheMisses instanceof client.Counter, "cacheMisses should be a Counter");
  });

  it("cacheOperationDuration is a Histogram instance", () => {
    assert.ok(
      cacheOperationDuration instanceof client.Histogram,
      "cacheOperationDuration should be a Histogram"
    );
  });

  it("cacheSize is a Gauge instance", () => {
    assert.ok(cacheSize instanceof client.Gauge, "cacheSize should be a Gauge");
  });
});

describe("Cache metrics — Counter behaviour", { concurrency: 1 }, () => {
  it("cacheHits increments with labels", async () => {
    const before = await getCounterValue("cache_hits_total");
    cacheHits.inc({ operation: "get", key_pattern: "user:*" });
    const after = await getCounterValue("cache_hits_total");
    assert.ok(after > before, "counter should increase after inc()");
  });

  it("cacheMisses increments with labels", async () => {
    const before = await getCounterValue("cache_misses_total");
    cacheMisses.inc({ operation: "get", key_pattern: "post:*" });
    const after = await getCounterValue("cache_misses_total");
    assert.ok(after > before, "counter should increase after inc()");
  });

  it("cacheHits and cacheMisses are registered in the default registry", async () => {
    const metricsOutput = await client.register.metrics();
    assert.ok(metricsOutput.includes("cache_hits_total"), "hits metric should appear in output");
    assert.ok(
      metricsOutput.includes("cache_misses_total"),
      "misses metric should appear in output"
    );
  });
});

describe("Cache metrics — Histogram behaviour", { concurrency: 1 }, () => {
  it("startTimer returns a callable that ends the timer", () => {
    const endTimer = cacheOperationDuration.startTimer({ operation: "get", status: "pending" });
    assert.strictEqual(typeof endTimer, "function");
    // Calling endTimer should not throw
    assert.doesNotThrow(() => endTimer({ operation: "get", status: "hit" }));
  });

  it("cacheOperationDuration appears in registry output", async () => {
    const metricsOutput = await client.register.metrics();
    assert.ok(
      metricsOutput.includes("cache_operation_duration_seconds"),
      "duration histogram should appear in output"
    );
  });
});

describe("Cache metrics — Gauge behaviour", { concurrency: 1 }, () => {
  it("cacheSize.set() does not throw", () => {
    assert.doesNotThrow(() => cacheSize.set({ instance: "test" }, 1024));
  });

  it("cacheSize appears in registry output", async () => {
    const metricsOutput = await client.register.metrics();
    assert.ok(metricsOutput.includes("cache_size_bytes"), "size gauge should appear in output");
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCounterValue(metricName: string): Promise<number> {
  const metrics = await client.register.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === metricName);
  if (!metric || !("values" in metric)) return 0;
  return (metric as any).values.reduce((sum: number, v: any) => sum + (v.value ?? 0), 0);
}
