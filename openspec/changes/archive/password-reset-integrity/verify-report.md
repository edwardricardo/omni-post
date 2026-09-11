# Verify Report — password-reset-integrity

```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:83b488bfab794ac5e5f7620180009ac3fa65e73bf871237be64a528396864fe9
verdict: pass
blockers: 0
critical_findings: 0
requirements: 12/12
scenarios: 41/41
test_command: cd apps/api && TIER=pr-integration bash ./scripts/run-tests.sh
test_exit_code: 0
build_command: NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @apps/api exec tsc -b
build_exit_code: 0
```

## Verification — the three-link chain, per-link fresh gates plus the chain exit

**Scope**: the change shipped as a three-link stacked chain, each link adversarially
gate-verified pre-commit and RDD-reviewed (4R panel, burned), with the chain-level exit
criteria closed at 58/58 tasks. This report consolidates the three per-link verifications
(their full records live in Engram under `sdd/password-reset-integrity/verify-report`,
written by the gates themselves) and the shipped state.

| Link                                     | Commit                                                            | Fresh gate                     | RDD lineage (burned)                                     | CODE (gate-measured)                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| PR-1 reachability + atomic claim         | `f992a1fb` (merged as **#242**, `56034845`)                       | PASS-with-warnings, 0 CRITICAL | `review-cf7272b7d8717ef4` (10 advisories)                | 510 — **Edward's ruling 2026-09-12: ACCEPTED** (167 canon-mandated JSDoc; ~343 non-comment, inside forecast) |
| PR-2a intent writes + credential callers | `d38be4cf` (merged as **#243**, `8442f99b`)                       | PASS-with-warnings, 0 CRITICAL | `review-b5f4d1e36e8317e6` (6 advisories)                 | 290 (+241/−49)                                                                                               |
| PR-2b snapshot-writer deletion           | `5744f606` (merged as **#244**, `190625ec` — main's tip at close) | PASS, 0 CRITICAL               | `review-3cfc033c364c4f78` (8 advisories, all SUGGESTION) | 187 (+65/−122)                                                                                               |

## What the chain proves, per defect

- **D0 (four dead pre-identity endpoints)**: alive behind whole-handler `withSystemContext`
  seams named by exported constants (`customerAuthSystemReasons.ts`); the four death shapes
  (500/401/500/token-shaped 400) captured verbatim as integration reds pre-fix.
- **D1 (the silent revert)**: killed by the single count-gated claim
  (`claimPasswordReset`: token + expiry + `deletedAt: null` in the predicate). The
  "green-looking red" — `ok` result with the OLD hash stored — observed pre-fix through the
  real adapter over a stateful Prisma-client fake; post-fix asserted with
  `argon2.verify` against the STORED row, both directions.
- **D2-customer (TOCTOU)**: two CONCURRENT confirms → exactly one `ok` against real
  Postgres (the atomicity proof lives in the integration tier; the unit race decides
  count-gating logic only — the fake is event-loop-atomic, stated in the design).
- **D3 (one token, N accounts)**: one token PER USER ROW, one email listing all matching
  accounts with per-account links (Edward's D3 decision); N distinct tokens, zero P2002.
- **The class (snapshot writes)**: `save()`/`updatePasswordHash` DELETED tree-wide; seven
  intention-named commands each authoritative for its columns (completeness, exclusivity,
  no side channel — the invariant suite diffs the STORED row per command); omitting a
  required hash is a COMPILE error, demonstrated (TS2554, restore byte-exact,
  sha256-corroborated) and pinned permanently
  (`customerCredentialWriteContract.type-test.ts`, with its own self-red TS2578 ×2).
- **The rehash revert (dormant, armed by any `ARGON2_PARAMS` bump)**: disarmed — measured
  end-to-end via HTTP pre-fix (200 + stale hash byte-identical, `needsRehash` forced by
  FIXTURE with `passwordHashing.ts` byte-untouched), green post-fix with the UPGRADED hash
  stored.

## Chain exit (the four Success criteria, closed with evidence)

All six acceptance criteria green with the previously-red tests as the oracle; the
integration file collected by `run_batch "integration:customer-auth"` with fitness #30
held at its ratchet; the snapshot writers absent from the tree (the only textual survivors
are the type-test pin's own `@ts-expect-error` lines, which exist to keep the deletion
pinned); the two residuals FILED with owners — **SMELL-96** (LIVE: the client portal's
reset flow posts routes that do not exist — the last dead segment of the recovery path)
and **SMELL-97** (the admin `PasswordService` TOCTOU — the identical defect this change
fixed customer-side; Edward paired the class fitness function with that slice).

## Final numbers (re-run at each link's gate, reproduced independently)

`TIER=pr-integration` **497/497, 0 cancelled, 0 skipped** (`integration:customer-auth`
13/13; `integration:tenant-isolation` 246/246) · vitest **565 files / 8,796 tests** ·
`@core/team` 19/19 · `@core/customer-auth` 35/35 · tsc + typecheck + eslint + prettier 0 ·
fitness spot-sets 0 with #30 = 21 and #38 db-prisma = 11 unchanged · database as found by
out-of-band reads (two byte-identical censuses at the closer's gate).

## Post-close corroboration

The design-phase SQL capture of the successor MFA change (2026-09-12, zero-mutation probe,
two independent capture layers) settled the one open question this chain's racer test
could corroborate but not decide: Prisma emits the plain `UPDATE ... WHERE (<qual>)` form,
so EvalPlanQual re-evaluation is guaranteed and **`claimPasswordReset`'s atomicity is now
settled by capture, not only by the two-racer outcome**.
