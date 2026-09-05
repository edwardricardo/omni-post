/**
 * @file hardDeletePolicy.ts
 * @description The single source of truth for the hard-delete blast-radius ceiling, shared by
 *              every aggregate root that can be erased.
 * @layer application
 */

/**
 * Upper bound on the cascade a single hard-delete transaction will attempt, measured in
 * posts (the dominant per-row cascade cost). Sized to complete comfortably within the
 * dedicated hard-delete transaction budget; an aggregate above it is refused with an
 * actionable error rather than left to time out — and time out forever — inside the
 * transaction. A guardrail, tunable.
 *
 * It lives HERE, one level below the use cases, because it was previously declared twice:
 * once in `HardDeleteAccountUseCase` and once in `HardDeleteProjectUseCase`, both exported,
 * both documented as tunable, both `50_000`. Two constants that must agree and have no
 * mechanism forcing them to are one silent divergence away from a project ceiling that no
 * longer matches the account ceiling containing it — and whoever tuned one would have had no
 * reason to suspect the other existed. Tuning is now one edit, by construction.
 */
export const HARD_DELETE_MAX_POSTS = 50_000;

/**
 * Upper bound on the CHILD dimension of the same cascade: the rows in the
 * directly-countable child populations (`Task`, `WebhookEvent`) the delete would
 * destroy or detach. A second bound, not a replacement, because the two dimensions
 * fail independently — a tenant can be far under the post ceiling and still be
 * unremovable, which is exactly the hole a posts-only guard left open.
 *
 * SIZED ON MEASUREMENT, on this schema, against PostgreSQL 16 with the cascade's
 * foreign-key indexes in place:
 *   - 10 000 posts + 1 000 000 child rows: ~1.0 s to pre-delete the webhook events
 *     plus ~1.1 s for the account cascade, against the 120 000 ms transaction
 *     budget. The same shape WITHOUT those indexes took 14.3 s, and at a tenth of
 *     the child rows it took 4.5 s for a single project — the indexes are what make
 *     this ceiling meaningful, so it must not be raised on a database missing them.
 *   - The ceiling therefore sits roughly 50x below the measured budget consumption.
 *     That margin is not padding: it covers a cold production database, lock
 *     contention with live writers, and the thirteen `Post` children this probe
 *     cannot count (see `HardDeleteImpact`).
 *
 * Tunable, like the post ceiling — but re-measure before raising it, and raise it
 * only together with evidence from the same two-dimensional bench.
 */
export const HARD_DELETE_MAX_CASCADE_ROWS = 1_000_000;
