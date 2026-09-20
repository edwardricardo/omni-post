/**
 * @file businessMetrics.ts
 * @description Prometheus counters for business-critical SLO monitoring including post creation
 *              latency, publish success rates, and cache hit rates.
 * @layer infrastructure
 */
import client from "prom-client";

// ---------------------------------------------------------------------------
// Guard helper — prevents "Duplicated metrics in registry" when multiple test
// subprocesses share the same module cache under --test-concurrency > 1.
// ---------------------------------------------------------------------------

/**
 * Returns an existing Counter from the default registry, or creates a new one.
 * This is safe to call at module-evaluation time even in concurrent test
 * environments where the module may be evaluated more than once.
 */
function getOrCreateCounter(
  name: string,
  help: string,
  labelNames: readonly string[] = []
): client.Counter {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as client.Counter;
  return new client.Counter({ name, help, labelNames });
}

// ---------------------------------------------------------------------------
// Post lifecycle counters
// ---------------------------------------------------------------------------

/**
 * Total posts created successfully.
 * Incremented after CreatePostUseCase.execute() succeeds and the aggregate
 * is persisted.
 * SLO: creation P99 < 1000ms.
 */
const postsCreatedTotal = getOrCreateCounter(
  "omnipost_posts_created_total",
  "Total number of posts successfully created"
);

/**
 * Total posts enqueued for publication (SCHEDULED status transition).
 * Incremented when a post is scheduled across one or more channels.
 * SLO: publish success rate > 99%.
 */
const postsPublishedTotal = getOrCreateCounter(
  "omnipost_posts_published_total",
  "Total number of posts successfully enqueued for publication"
);

/**
 * Total publish failures recorded from provider webhooks or job errors.
 * Incremented when a publishLog entry is created with status FAILED.
 * SLO: (postsPublishedTotal - postsPublishFailedTotal) / postsPublishedTotal > 0.99.
 */
const postsPublishFailedTotal = getOrCreateCounter(
  "omnipost_posts_publish_failed_total",
  "Total number of post publish attempts that failed"
);

/**
 * Total posts deleted (soft delete via DeletePostUseCase).
 * Incremented after successful soft-delete.
 */
const postsDeletedTotal = getOrCreateCounter(
  "omnipost_posts_deleted_total",
  "Total number of posts soft-deleted"
);

/**
 * Bulk-schedule rows the worker REFUSED because their payload named no tenant.
 *
 * A refusal is not a failure the queue can retry into success: the row is malformed and
 * will be refused again. It is counted because the state it leaves is otherwise silent —
 * a row that is never processed and, on the terminal path, never recorded as failed, so
 * its batch never settles and no log line says which batch is stuck.
 */
/**
 * The arms that can refuse a bulk-schedule row, declared BESIDE the counter that labels
 * them. The worker imports these rather than the metrics module importing the worker: the
 * label set belongs to the metric, and a counter whose label values are `string` accepts
 * any typo forever while its dashboards quietly split in two.
 */
export const BULK_SCHEDULE_REFUSAL_ARMS = {
  ROW: "row",
  TERMINAL_FAILURE: "terminal-failure",
} as const;

export type BulkScheduleRefusalArm =
  (typeof BULK_SCHEDULE_REFUSAL_ARMS)[keyof typeof BULK_SCHEDULE_REFUSAL_ARMS];

const bulkScheduleRowsRefusedTotal = getOrCreateCounter(
  "omnipost_bulk_schedule_rows_refused_total",
  "Bulk-schedule rows refused for a missing tenant, by which arm of the worker refused",
  ["reason"]
);

// ---------------------------------------------------------------------------
// Provider-level publish counters
// ---------------------------------------------------------------------------

/**
 * Publish successes broken down by provider.
 * Label: provider — e.g. "X", "INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"
 */
const providerPublishSuccessTotal = getOrCreateCounter(
  "omnipost_provider_publish_success_total",
  "Total successful publish operations per social media provider",
  ["provider"]
);

/**
 * Publish failures broken down by provider.
 * Label: provider — same values as providerPublishSuccessTotal
 */
const providerPublishFailureTotal = getOrCreateCounter(
  "omnipost_provider_publish_failure_total",
  "Total failed publish operations per social media provider",
  ["provider"]
);

// ---------------------------------------------------------------------------
// Cache layer counters (L1 vs L2)
// ---------------------------------------------------------------------------

/**
 * L1 (in-memory) cache hits.
 * SLO: l1Hits / (l1Hits + l2Hits + cacheMissesTotal) > 0.80
 */
const cacheL1HitsTotal = getOrCreateCounter(
  "omnipost_cache_l1_hits_total",
  "Total L1 (in-memory) cache hits"
);

/**
 * L1 (in-memory) cache misses — request fell through to L2 or source.
 */
const cacheL1MissesTotal = getOrCreateCounter(
  "omnipost_cache_l1_misses_total",
  "Total L1 (in-memory) cache misses"
);

/**
 * L2 (Redis) cache hits — served from Redis after L1 miss.
 */
const cacheL2HitsTotal = getOrCreateCounter(
  "omnipost_cache_l2_hits_total",
  "Total L2 (Redis) cache hits"
);

/**
 * L2 (Redis) cache misses — not found in Redis, must re-fetch from source.
 */
const cacheL2MissesTotal = getOrCreateCounter(
  "omnipost_cache_l2_misses_total",
  "Total L2 (Redis) cache misses"
);

// ---------------------------------------------------------------------------
// Increment helpers
// ---------------------------------------------------------------------------

/** Increment posts.created counter. Call after successful repo.save(). */
export function incrementPostCreated(): void {
  postsCreatedTotal.inc();
}

/** Increment posts.published counter. Call when scheduling succeeds. */
export function incrementPostPublished(): void {
  postsPublishedTotal.inc();
}

/** Increment posts.publishFailed counter. Call on publish job failure. */
export function incrementPostPublishFailed(): void {
  postsPublishFailedTotal.inc();
}

/** Increment posts.deleted counter. Call after successful soft-delete. */
export function incrementPostDeleted(): void {
  postsDeletedTotal.inc();
}

/**
 * Increment the bulk-schedule refusal counter.
 *
 * A refused row is a row that will never be processed AND never recorded as failed, so
 * without a counter its batch simply stops settling and nothing says why. The `reason`
 * label separates the two arms that can refuse — the row handler and the terminal-failure
 * callback — because they have different consequences: the first still reaches the DLQ
 * through BullMQ's retries, the second is the end of the line.
 * @param reason - Which arm refused, from {@link BULK_SCHEDULE_REFUSAL_ARMS}.
 */
export function incrementBulkScheduleRowRefused(reason: BulkScheduleRefusalArm): void {
  bulkScheduleRowsRefusedTotal.inc({ reason });
}

/**
 * Increment provider publish success counter.
 * @param provider — e.g. "X", "INSTAGRAM", "FACEBOOK"
 */
export function incrementProviderPublishSuccess(provider: string): void {
  providerPublishSuccessTotal.inc({ provider });
}

/**
 * Increment provider publish failure counter.
 * @param provider — e.g. "X", "INSTAGRAM", "FACEBOOK"
 */
export function incrementProviderPublishFailure(provider: string): void {
  providerPublishFailureTotal.inc({ provider });
}

/**
 * Increment L1 cache hit counter.
 * Call from RedisCacheManager.get() on L1 hit path.
 */
export function incrementCacheL1Hit(): void {
  cacheL1HitsTotal.inc();
}

/**
 * Increment L1 cache miss counter (fell through to L2).
 * Call from RedisCacheManager.get() when L1 entry is absent/expired.
 */
export function incrementCacheL1Miss(): void {
  cacheL1MissesTotal.inc();
}

/**
 * Increment L2 cache hit counter (served from Redis).
 * Call from RedisCacheManager.get() on L2 hit path.
 */
export function incrementCacheL2Hit(): void {
  cacheL2HitsTotal.inc();
}

/**
 * Increment L2 cache miss counter (not in Redis, source re-fetch needed).
 * Call from RedisCacheManager.get() when Redis returns null.
 */
export function incrementCacheL2Miss(): void {
  cacheL2MissesTotal.inc();
}
