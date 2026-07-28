/**
 * @file mentionIngestMetrics.ts
 * @description Prometheus counters for the mention-ingest worker. Unlike the
 *              publish worker, mention ingest has no injected registry (it is a
 *              standalone BullMQ worker with no composition-root handle), so
 *              these register on prom-client's default registry — which
 *              `bootstrap.ts` merges into the unified `/metrics` endpoint
 *              alongside the publish worker's own registry.
 * @layer infrastructure
 */
import client from "prom-client";

/** Why a mention job could not turn its `channelId` into a usable adapter. */
export const MENTION_CHANNEL_UNRESOLVED_REASONS = {
  /** The tenant-scoped lookup matched no row: wrong tenant, or channel deleted. */
  notFoundInScope: "not_found_in_scope",
  /** The channel resolved but its provider has no ingest adapter. */
  noAdapter: "no_adapter",
  /** The job payload carried no usable tenant scope — malformed, never retryable. */
  invalidScope: "invalid_scope",
} as const;

/**
 * Counts mention jobs that ended without ingesting anything because the channel
 * could not be resolved. The job SUCCEEDS in all these cases (nothing retries,
 * nothing alerts), so without this counter a systematic scope mismatch is
 * indistinguishable from normal churn of deleted channels.
 */
export const mentionChannelUnresolved = new client.Counter({
  name: "worker_mention_channel_unresolved_total",
  help: "Mention jobs skipped because the channel could not be resolved, by reason",
  labelNames: ["reason"],
});
