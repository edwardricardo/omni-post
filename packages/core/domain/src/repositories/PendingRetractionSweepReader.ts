/**
 * @file PendingRetractionSweepReader.ts
 * @description Read port for the action-window sweep's DISCOVERY step: which
 *   channels still hold content the customer was asked to remove, and were asked
 *   long enough ago that the window has closed.
 *
 *   It is a port of its own rather than a method on `PostRepository` because the
 *   two answer different questions under different scopes. `PostRepository` loads
 *   ONE tenant's aggregate and every write through it is tenant-bound; this reads
 *   ACROSS accounts to find out which tenants have work at all, which is only
 *   legal inside a declared system context. Folding it into the aggregate
 *   repository would put a cross-account read behind a type whose every other
 *   method is tenant-scoped, and the next caller would inherit that reach without
 *   noticing it.
 *
 *   It returns IDENTIFIERS, never an aggregate. The sweep re-reads each row under
 *   its own tenant before touching it, so anything this port carried beyond the
 *   three ids would be state read under one scope and acted on under another.
 * @layer domain
 */

/** The cutoff and the page size one discovery pass asks for. */
export interface PendingRetractionSweepQuery {
  /**
   * Rows whose window opened at or before this moment. The caller derives it as
   * `now − window` and re-asserts the same cutoff when it acts, so a row selected
   * here is never expired on the strength of this predicate alone.
   */
  olderThan: Date;
  /** Maximum rows returned, oldest window first. */
  limit: number;
}

/** One selected row: enough to re-read it under its own tenant, and nothing more. */
export interface PendingRetractionSweepRow {
  postId: string;
  channelId: string;
  /** The tenant the caller must bind before acting on this row. */
  accountId: string;
}

/**
 * @interface PendingRetractionSweepReader
 * @description Cross-account discovery for the retraction action-window sweep.
 */
export interface PendingRetractionSweepReader {
  /**
   * @method listExpired
   * @description Lists channels that are pending retraction with a known blocked
   *   cause, not yet expired, whose window opened at or before `olderThan` —
   *   oldest first, at most `limit` rows.
   *
   *   Oldest-first is load-bearing rather than cosmetic: the page is bounded, so
   *   the order decides who waits. The row that has been stranded longest is the
   *   one whose customer has had the most time to act and the one whose alert has
   *   been open longest.
   * @param query - The cutoff and the page size
   * @returns The selected rows, oldest window first
   */
  listExpired(query: PendingRetractionSweepQuery): Promise<readonly PendingRetractionSweepRow[]>;
}
