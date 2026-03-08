/**
 * Cache Metrics
 * Prometheus metrics for monitoring cache performance
 */

import client from "prom-client";

export const cacheHits = new client.Counter({
  name: "cache_hits_total",
  help: "Total number of cache hits",
  labelNames: ["operation", "key_pattern"],
});

export const cacheMisses = new client.Counter({
  name: "cache_misses_total",
  help: "Total number of cache misses",
  labelNames: ["operation", "key_pattern"],
});

export const cacheOperationDuration = new client.Histogram({
  name: "cache_operation_duration_seconds",
  help: "Duration of cache operations",
  labelNames: ["operation", "status"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const cacheSize = new client.Gauge({
  name: "cache_size_bytes",
  help: "Current cache size in bytes",
  labelNames: ["instance"],
});

// ---------------------------------------------------------------------------
// Business SLO cache counters (L1 vs L2 breakdown)
// Same Prometheus names as apps/api/src/metrics/businessMetrics.ts — in the
// same process they share the default registry, so counters are deduplicated.
// ---------------------------------------------------------------------------

function getOrCreateCounter(name: string, help: string): client.Counter {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as client.Counter;
  return new client.Counter({ name, help });
}

const cacheL1HitsTotal = getOrCreateCounter(
  "omnipost_cache_l1_hits_total",
  "Total L1 (in-memory) cache hits"
);

const cacheL1MissesTotal = getOrCreateCounter(
  "omnipost_cache_l1_misses_total",
  "Total L1 (in-memory) cache misses"
);

const cacheL2HitsTotal = getOrCreateCounter(
  "omnipost_cache_l2_hits_total",
  "Total L2 (Redis) cache hits"
);

const cacheL2MissesTotal = getOrCreateCounter(
  "omnipost_cache_l2_misses_total",
  "Total L2 (Redis) cache misses"
);

/** Increment L1 cache hit counter. */
export function incrementCacheL1Hit(): void {
  cacheL1HitsTotal.inc();
}

/** Increment L1 cache miss counter (fell through to L2). */
export function incrementCacheL1Miss(): void {
  cacheL1MissesTotal.inc();
}

/** Increment L2 cache hit counter (served from Redis). */
export function incrementCacheL2Hit(): void {
  cacheL2HitsTotal.inc();
}

/** Increment L2 cache miss counter (not in Redis). */
export function incrementCacheL2Miss(): void {
  cacheL2MissesTotal.inc();
}
