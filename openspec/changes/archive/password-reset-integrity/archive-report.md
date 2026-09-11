# Archive Report — password-reset-integrity

> Closure record for the SDD change (branch `workstream/password-reset-close`, off main @
> `190625ec`; 58/58 tasks; verify-report verdict `pass`, 0 blockers, 0 critical, 12/12
> requirements, 41/41 scenarios). Semantic content authored by the archive executor
> (Engram `sdd/password-reset-integrity/archive-report`, obs 667); the mechanical steps
> its toolset could not perform (the two NEW-capability spec copies, this folder's move,
> prettier) were completed by the orchestrator with `cp`/`mv` + diff verification —
> copies byte-identical, move verified.

## Shipped — three-link stacked chain, each fresh-gated + RDD-reviewed

| Link                                     | Commit     | Merged PR                              | Fresh gate                     | RDD (burned)                                             | CODE (gate-measured)                                                                                         |
| ---------------------------------------- | ---------- | -------------------------------------- | ------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| PR-1 reachability + atomic claim         | `f992a1fb` | #242 (`56034845`)                      | PASS-with-warnings, 0 CRITICAL | `review-cf7272b7d8717ef4` (10 advisories)                | 510 — **Edward's ruling 2026-09-12: ACCEPTED** (167 canon-mandated JSDoc; ~343 non-comment, inside forecast) |
| PR-2a intent writes + credential callers | `d38be4cf` | #243 (`8442f99b`)                      | PASS-with-warnings, 0 CRITICAL | `review-b5f4d1e36e8317e6` (6 advisories)                 | 290 (+241/−49)                                                                                               |
| PR-2b snapshot-writer deletion (closer)  | `5744f606` | #244 (`190625ec`, main's tip at close) | PASS, 0 CRITICAL               | `review-3cfc033c364c4f78` (8 advisories, all SUGGESTION) | 187 (+65/−122)                                                                                               |

## Four-defect disposition

- **D0** (4 dead pre-identity endpoints — register/refresh/request-password-reset/
  reset-password all threw or degraded on the guarded client): fixed by 4 declared
  `withSystemContext` seams named by exported constants (`customerAuthSystemReasons.ts`).
  The 4 death shapes (500/401/500/token-shaped-400) captured verbatim as integration reds
  pre-fix.
- **D1** (silent revert — the claim wrote the new hash, then a stale 19-column `save()`
  snapshot reverted it while reporting success): killed by ONE count-gated atomic claim
  (`claimPasswordReset`: token + expiry + `deletedAt: null` in the predicate). Pre-fix the
  "green-looking red" was observed (result `ok`, stored hash still old) through the REAL
  adapter over a stateful Prisma-client fake — never a repository mock, which stays green
  under the bug.
- **D2-customer** (TOCTOU): two concurrent confirms → exactly one `ok` against real
  Postgres (the atomicity proof lives in the integration tier; the unit race decides
  count-gating logic only — the fake is event-loop-atomic).
- **D3** (one token shared across N account rows on a `@unique` column, arbitrary P2002
  winner): one token PER user row, one e-mail listing all matching accounts with
  per-account labelled links (Edward's binding decision). N distinct tokens, zero P2002.

## The class retirement (PR-2, the actual point of the chain)

`save(user, passwordHash?)` and `updatePasswordHash(...)` DELETED tree-wide (port +
adapter + all 8 original call sites) — `rg` returns zero hits except the type-test pin's
own `@ts-expect-error` lines, which exist to keep the deletion pinned. Replaced by seven
intent-named commands: `claimPasswordReset`, `issueResetToken` (PR-1, final form);
`create`, `recordLogin`, `changeRole`, `deactivate`, `upgradePasswordHash` (PR-2).
`upgradePasswordHash` is a gate-ACCEPTED divergence from the proposal's "delete
`updatePasswordHash`" — it survives as the login-rehash's only sanctioned writer
(JSDoc-named), because deleting both writers would silently un-persist the transparent
argon2 rehash upgrade. Omitting a required credential value is now a COMPILE error:
demonstrated live (TS2554, restore byte-exact, sha256-corroborated) and permanently
pinned in `customerCredentialWriteContract.type-test.ts` (itself self-red-demonstrated
via TS2578 ×2). The dormant rehash-revert trap — armed by any `ARGON2_PARAMS` bump — is
disarmed, measured end-to-end pre-fix (200 with the stale hash byte-identical) and green
post-fix with the upgraded hash stored.

## Honest numbers, not smoothed

- CODE: PR-1 measured 510 vs its 250–280 forecast — accepted by Edward's ruling; the gap
  was almost entirely canon-mandated JSDoc, and the forecast lesson is folded into the
  two-tier review-budget rule (the CODE forecast must count mandatory JSDoc). PR-2a 290
  (writer self-accounted 324 — git diff governs). PR-2b 187 (writer said 199 — safe
  direction).
- Batch at close: `TIER=pr-integration` 497/497, 0 cancelled, 0 skipped
  (`integration:customer-auth` 13/13, `integration:tenant-isolation` 246/246). Vitest 565
  files / 8,796 tests. tsc + typecheck + eslint + prettier all 0. Fitness ratchets
  unchanged (#30 = 21, #38 db-prisma = 11).

## Residuals carried forward (filed with owners, not absorbed)

- **SMELL-96 (LIVE)**: the client portal's reset flow posts routes that do not exist and
  links a nonexistent forgot-password page — backend acceptance was proven via
  `app.inject`, independent of the broken portal wiring.
- **SMELL-97**: the admin `PasswordService` TOCTOU — the identical defect class this
  change fixed customer-side; Edward paired the class fitness function with that slice.
- **PG-cascade latent finding** (Engram 660): the request-reset loop `continue`s past a
  per-row failure inside one UoW transaction, but PostgreSQL aborts the whole transaction
  on a failed statement — proven fake-deep only; spec obligations hold either way.
- **Fitness #30 baseline literal** stays 21 (the measured count did not rise; tightening
  travels with the next fitness.yml-touching slice).

## Spec merges (the living-spec state after this archive)

- `openspec/specs/tenant-context-boundaries/spec.md` — MODIFIED merge, verified: the A9
  row (six `/auth/customer/*` pre-identity handlers) in the Class A table; the
  `system:customer-*` constants in the declared reason set with the pre-existing ad-hoc
  literals carried as a recorded residual; and the new MERGE-BLOCKING terminal rule —
  **a pre-identity seam never degrades a context failure into a credential failure** —
  closing exactly the failure mode that let the reset outage read as a bad token.
- `openspec/specs/customer-password-reset/spec.md` — NEW capability, byte-identical copy
  of the delta (diff-verified).
- `openspec/specs/customer-credential-write-api/spec.md` — NEW capability, byte-identical
  copy (diff-verified): seven intent commands, the authority criterion, the compile-time
  inexpressibility pin.

## Post-close corroboration

The successor MFA change's design-phase SQL capture (2026-09-12, zero-mutation probe, two
independent layers) settled the one question the racer test could corroborate but not
decide: Prisma emits the plain `UPDATE ... WHERE (<qual>)` form, guaranteeing
EvalPlanQual re-evaluation — `claimPasswordReset`'s atomicity is settled by capture.
