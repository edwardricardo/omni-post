/**
 * @file deletionMetrics.ts
 * @description Prometheus series for the two deletion facts nothing published: how close a
 *              tenant is to the hard-delete size ceiling, and how many tombstones are past
 *              their retention horizon while still holding plaintext PII.
 *
 *              Both existed as numbers the code already computed and then threw away. The
 *              size guard measures every tenant's cascade and discards the count unless it
 *              trips the ceiling, so a tenant creeping toward the wall is invisible until
 *              the day an erasure is refused. And the two-phase retention design ends at a
 *              deadline no job enforces yet, so an overdue tombstone is a GDPR exposure that
 *              no query, alert or dashboard would report.
 *
 *              Shapes follow `sagaRecoveryMetrics.ts`: a HISTOGRAM for a per-operation
 *              distribution, a GAUGE with a scrape-time `collect` for a re-observed level.
 *              Recording the overdue level as a counter would re-sum the same rows on every
 *              boot and report a backlog of two as six after three restarts.
 * @layer infrastructure
 */
import client from "prom-client";

/**
 * Returns the existing metric from the default registry, or creates it. Safe at
 * module-evaluation time even when the module is evaluated more than once (test
 * subprocesses sharing a registry) — mirrors `sagaRecoveryMetrics.ts`.
 */
function getOrCreateHistogram(
  name: string,
  help: string,
  labelNames: readonly string[],
  buckets: number[]
): client.Histogram {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as client.Histogram;
  return new client.Histogram({ name, help, labelNames, buckets });
}

function getOrCreateGauge(
  name: string,
  help: string,
  collect?: (this: client.Gauge) => void | Promise<void>
): client.Gauge {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as client.Gauge;
  return new client.Gauge({ name, help, ...(collect && { collect }) });
}

/** Which aggregate root a hard delete was rooted at. */
export type HardDeleteEntity = "account" | "project";

const hardDeleteImpactPosts = getOrCreateHistogram(
  "hard_delete_impact_posts",
  "Posts a hard delete's cascade would destroy, measured by the pre-flight size guard BEFORE " +
    "the transaction opens. Observed for every attempt, including the ones the ceiling refuses, " +
    "so the distribution shows a tenant approaching the wall instead of only the day it hits it",
  ["entity"],
  // Straddles the 50 000 ceiling deliberately: the operator question is "how close are we?",
  // and buckets that stop below the limit answer it with +Inf for every interesting case.
  [10, 100, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000]
);

const hardDeleteImpactChildRows = getOrCreateHistogram(
  "hard_delete_impact_child_rows",
  "Dependent rows (tasks, webhook events) the same cascade would destroy or detach. A SECOND " +
    "series rather than a label on the first, because the two dimensions have different " +
    "ceilings and fail independently: a tenant far under the post limit can still be " +
    "unremovable on this one, and summing them would hide exactly that case",
  ["entity"],
  // Straddles the 1 000 000 child-row ceiling, for the same reason as above.
  [1_000, 10_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000]
);

/**
 * What the pre-flight guard measured, in both dimensions.
 *
 * Structurally identical to `HardDeleteImpact` in the domain port, and deliberately NOT an
 * import of it: this module publishes Prometheus series and must not learn about the domain
 * layer. It was briefly a union with a bare `number` while the two-dimension guard was
 * landing; both adapters now return the object, which was that union's stated remove-when, so
 * the `number` arm is gone. It must not come back — an emission that accepts half the blast
 * radius will eventually be handed half the blast radius.
 */
export type HardDeleteImpactSample = { posts: number; childRows: number };

/**
 * @function recordHardDeleteImpact
 * @description Observes the cascade size the pre-flight guard measured for one hard-delete
 *   attempt. Called at the measurement site rather than at the decision site on purpose: the
 *   number that matters for capacity is every measurement, not the subset that tripped the
 *   ceiling and produced an error somebody happened to log.
 * @param entity - The aggregate root the delete was rooted at.
 * @param impact - The measured blast radius; see {@link HardDeleteImpactSample}.
 */
export function recordHardDeleteImpact(
  entity: HardDeleteEntity,
  impact: HardDeleteImpactSample
): void {
  hardDeleteImpactPosts.observe({ entity }, impact.posts);
  hardDeleteImpactChildRows.observe({ entity }, impact.childRows);
}

/**
 * Reads the overdue-tombstone level at scrape time. Installed by the composition root; this
 * file publishes series and must not learn about Prisma or tenancy.
 */
let overduePlaintextProvider: (() => Promise<number>) | undefined;

/**
 * The value the gauge carries when the level could NOT be read.
 *
 * A Prometheus gauge has no null, and publishing an unread level as `0` would assert "no
 * tombstone is overdue" on the strength of a failed query — the one reading an alert must
 * never be able to derive from a question nobody answered. A negative sentinel falls outside
 * every legitimate count, so a `> 0` alert stays silent rather than firing on ignorance, and
 * a dashboard shows an obviously impossible value instead of a reassuring one.
 */
export const DELETION_RECORD_OVERDUE_UNKNOWN = -1;

const deletionRecordOverduePlaintext = getOrCreateGauge(
  "deletion_record_overdue_plaintext",
  "Tombstones past their retainUntil horizon that still hold the plaintext name. The " +
    "two-phase retention design says these should have been degraded to a keyed digest by " +
    "now; nothing performs that degradation yet, so this level is the standing exposure. " +
    "-1 means the level could not be read — UNKNOWN, never zero",
  async function collectOverduePlaintext(this: client.Gauge): Promise<void> {
    if (!overduePlaintextProvider) return;
    try {
      this.set(await overduePlaintextProvider());
    } catch {
      // A scrape must not fail because one level could not be measured, and it must not
      // report an unanswered question as a clean zero either.
      this.set(DELETION_RECORD_OVERDUE_UNKNOWN);
    }
  }
);

/**
 * @function setDeletionRecordOverdueProvider
 * @description Installs (or removes) the scrape-time source for the overdue-plaintext level.
 *   Scrape-time rather than write-time because the population changes with the CLOCK, not
 *   with any application event: a tombstone written today becomes overdue years later with
 *   nothing running. A value published at boot would be stale within a day and latch until
 *   the next restart.
 * @param provider - Counts tombstones past `retainUntil` still holding `name`, or `undefined`
 *   to detach on shutdown. Detaching resets to UNKNOWN rather than zero, so a stopped process
 *   cannot leave a reassuring reading behind.
 */
export function setDeletionRecordOverdueProvider(
  provider: (() => Promise<number>) | undefined
): void {
  overduePlaintextProvider = provider;
  if (provider === undefined) {
    deletionRecordOverduePlaintext.set(DELETION_RECORD_OVERDUE_UNKNOWN);
  }
}
