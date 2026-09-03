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
 * `retainUntil`.
 *
 * ADJUDICATED. This constant said art. 17(3)(b) (compliance with a legal
 * obligation) while the migration that created the column backfilled every
 * pre-existing row with art. 17(3)(e) (establishment, exercise or defence of
 * legal claims). Two grounds in one column, with nothing recording that they
 * differed, so an erasure audit reading the table would get a different answer
 * depending on which row it opened.
 *
 * (e) is the correct one and (b) was the mistake. 17(3)(b) requires naming the
 * Union or Member State law that obliges the retention, and there is none here:
 * the previous text argued from "the obligation to be able to evidence who the
 * controller's clients were", which is a defensive interest, not a statutory
 * duty. Being able to answer "who was your customer on this date, and on whose
 * authority were they erased" when a claim is brought is squarely 17(3)(e). The
 * constant is therefore aligned DOWN to the migration's wording rather than the
 * migration being contradicted — new rows and backfilled rows now agree.
 */
export const DELETION_RECORD_LAWFUL_BASIS =
  "GDPR art. 17(3)(e) - establishment, exercise or defence of legal claims";

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
 * is the `DeletionRecord_retainUntil_floor` CHECK constraint, which is what
 * still holds when a write path is added that forgets to call this at all.
 *
 * Calendar note, and the PRECONDITION it rests on. Year arithmetic here uses
 * `setUTCFullYear`, which resolves 29 February onto 1 March; PostgreSQL's
 * `+ INTERVAL '1 year'` resolves the same date onto 28 February. That leap-day
 * comparison is only the visible half. The whole comparison is
 * time-zone-dependent, because PostgreSQL evaluates the interval addition in
 * the SESSION time zone while this function is unconditionally UTC: on a
 * session set to `America/New_York`, 144 of the 8760 hourly instants in 2026
 * make the database's floor LATER than this function's result at a one-year
 * window, and the CHECK rejects a deadline computed correctly here.
 *
 * So "this function's result is never earlier than the database's floor" is
 * TRUE ONLY WHILE THE WRITING SESSION IS UTC. That is not an accident of the
 * deployment any more: `PG_SESSION_OPTIONS` in `infra/prisma/src/client.ts`
 * pins `timezone=UTC` in the connection startup packet, at both the production
 * and the test client. Remove that pin and this note becomes false again on a
 * subset of dates.
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
