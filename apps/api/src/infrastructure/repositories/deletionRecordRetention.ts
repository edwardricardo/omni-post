/**
 * @file deletionRecordRetention.ts
 * @description Retention policy for the plaintext `name` a tombstone carries:
 *              the lawful basis it is kept under, and the clamped computation of
 *              `retainUntil`. Shared by both hard-delete repositories so the
 *              one-year floor has exactly one implementation.
 * @layer infrastructure
 */

/**
 * Lower bound of the retention window, in years. This is an INVARIANT, not a
 * setting: it is the shortest window the tombstone's lawful basis is written to
 * justify, and every layer that can influence `retainUntil` is bounded by it.
 */
export const RETENTION_FLOOR_YEARS = 1;

/**
 * Upper bound of the retention window, in years. Unlike the floor this is
 * POLICY: keeping readable PII beyond the window its own lawful basis covers is
 * the failure this ceiling prevents.
 */
export const RETENTION_CEILING_YEARS = 7;

/**
 * Legal ground recorded on every tombstone for keeping the plaintext name until
 * `retainUntil`. GDPR art. 17(3)(b) carves the erasure right back where
 * processing is necessary for compliance with a legal obligation — here, the
 * obligation to be able to evidence who the controller's clients were.
 */
export const DELETION_RECORD_LAWFUL_BASIS = "GDPR art. 17(3)(b) - legal obligation";

/**
 * @method computeRetainUntil
 * @description Compute the end of the plaintext retention window, clamped into
 * `[RETENTION_FLOOR_YEARS, RETENTION_CEILING_YEARS]`.
 *
 * The clamp is the SECOND of three layers guarding the floor, and it exists
 * precisely because the first one can be bypassed. Layer one is the Zod bound on
 * `DELETION_RECORD_RETENTION_YEARS`, which only sees values that arrive through
 * the environment; anything reaching this function by another route — a caller
 * passing a literal, a value read from a row, a number that arithmetic turned
 * into `NaN` — has never met that bound. A corrupted input therefore resolves to
 * the floor rather than to a shorter window or an `Invalid Date`, because a
 * tombstone whose clock is unreadable is a tombstone with no clock. Layer three
 * is the `DeletionRecord_retainUntil_floor_check` CHECK constraint, which is
 * what still holds when a write path is added that forgets to call this at all.
 *
 * Calendar note: year arithmetic is done with `setUTCFullYear`, which resolves
 * 29 February onto 1 March. PostgreSQL's `+ INTERVAL '1 year'` resolves the same
 * date onto 28 February instead, so this function's result is never EARLIER than
 * the database's floor for the same input, and the CHECK constraint cannot
 * reject a value this function produced.
 *
 * @param clientUntil - Moment of the hard delete; the window is measured from here.
 * @param configuredYears - Requested window length in years, from configuration.
 * @returns The retention deadline, never earlier than `clientUntil` + 1 year.
 */
export function computeRetainUntil(clientUntil: Date, configuredYears: number): Date {
  // NaN alone is special-cased (it poisons min/max), and it maps to the FLOOR:
  // an unreadable retention config must never silently extend how long plaintext
  // PII is held — the shortest lawful window is the only safe guess. The two
  // infinities need no branch: Math.floor preserves them and the clamp below
  // sends +Infinity to the ceiling and -Infinity to the floor, which is exactly
  // what an out-of-range finite value gets.
  const requested = Number.isNaN(configuredYears)
    ? RETENTION_FLOOR_YEARS
    : Math.floor(configuredYears);
  const years = Math.min(RETENTION_CEILING_YEARS, Math.max(RETENTION_FLOOR_YEARS, requested));

  const retainUntil = new Date(clientUntil.getTime());
  retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + years);
  return retainUntil;
}
