# Proposal: Password Reset Integrity (customer credential write path)

> Basis: `explore.md` (re-verified 2026-09-11, authoritative) absorbing `explore-prior-2026-08-15.md`.
> Edward's signed order (2026-08-15): this cluster ships SEPARATELY and FIRST, ahead of the MFA backup-code change.

## Intent

Four public customer-auth endpoints are dead today against the guarded Prisma client: `register` → 500, `request-password-reset` → 500, `reset-password` → 400 ("Invalid or expired reset token"), `refresh` → 401 — no tenant/system context bound, guard throw swallowed. Behind the outage sit four latent defects that a reachability-only fix would put live:

- **D1** — the reset writes the new hash, then `save(user)` reverts it from a stale 19-column snapshot and reports success. **A D0-only fix makes the silent revert the endpoint's first live behavior** — the ordering constraint is the whole design.
- **D2** — the token is never atomically claimed (TOCTOU double-consume; customer expiry is not even in the predicate).
- **D3** — ONE token issued across N tenant rows against a `@unique` column: arbitrary winner, silent P2002 for the rest.
- **New stakes since prior art**: `baseData` now carries `deletedAt` — a stale `save()` resurrects a soft-deleted customer or re-deletes a restored one (intersects `project-deletion-integrity` / fitness #38). `LoginCustomerUseCase`'s rehash-then-`save` revert **arms on any `ARGON2_PARAMS` bump** — the advertised safe upgrade path. And fase-0's ownership marker means a base-client write inside a UoW passes `isGucBound()` unwrapped and **commits on a second pooled connection**, independent of the enclosing rollback.

## Scope

### In scope (PR chain, auto-chain, stacked-to-main)

**PR-1 = Option A, minimal-correct chain:**

1. `withSystemContext` on the 4 bare pre-identity handlers — ADR-0020 sanctions it declared at a boundary; these ARE Class A boundaries under the `tenant-context-boundaries` spec (its MERGE-BLOCKING requirement is violated today). Own commit, landing WITH (never before) items 2–3.
2. Collapse the customer reset to ONE count-gated `updateMany` claim: `where: {resetToken, resetTokenExpiry: {gt: now}, deletedAt: null}`, `data: {passwordHash, resetToken: null, resetTokenExpiry: null}`; `count !== 1` → `INVALID_TOKEN`. Closes D1 + D2-customer + the expiry gap in one atomic statement — no transaction argument needed.
3. D3 mechanical fix: one token per user row.
4. `getClient()` on `PrismaCustomerUserRepository` (all 10 sites), copying `PrismaPostRepository`.
5. 4 red tests (below) + rewrite of the bug-certifying `customerAuthUseCases.test.ts:489-502`.

**PR-2 = Option B, chained immediately (not backlogged):** port surgery — delete `save()`/`updatePasswordHash`, add intent-named writes (`create(user,hash)`, `claimPasswordReset(token,hash)`, `issueResetToken(...)`, `recordLogin`, `changeRole`, `deactivate`). The compiler finds all 8 call sites. Retires the snapshot-revert class (disarms `LoginCustomerUseCase` and the `deletedAt` resurrection for callers 2–6). Omitting the hash becomes a compile error, not a silent revert.

**Ordering rationale:** D0's fix must land WITH the write fix — never before (revert-goes-live). PR-2 chains immediately because leaving `save()` alive keeps the `ARGON2_PARAMS` trap armed on a security-parameter upgrade.

### Out of scope (explore's list, carried)

- MFA backup-code race — own signed change, after this one.
- Admin `PasswordService` CAS + `passwordHistory` race + token index — **named successor slice**, immediately after (different table, not tenant-guarded, zero tests, needs a migration).
- Token-at-rest hashing / moving the token out of the emailed URL.
- Rate-limit rules for the uncovered routes — but the inert `config.rateLimit` deletion rides WITH any future rule, never alone.
- Schema — nothing in A or B requires it (`resetToken @unique` already backs the claim).
- The 71-file transaction-accessor ratchet + `ARCHITECTURE_CANON:149` wording — option C, separate ADR (fase 0 raised its severity; still doesn't belong in a credential PR).
- SMELL-75 wiring — except the ONE new integration file, which MUST be named in a `run_batch`.
- **Discovered during propose:** the client-side reset flow is dead at the HTTP layer independently of D0 — `apps/client/lib/auth/authApi.ts` posts `/reset-password` (request) and `/reset-password/confirm` (confirm) through a verbatim-forwarding proxy while the backend exposes `/request-password-reset` and `/reset-password`; the login page links `/forgot-password`, a page that does not exist. Backend acceptance is assertable via `app.inject`; the frontend repair is filed with the admin successor slice, not absorbed here.

## Capabilities

### New Capabilities

- `customer-password-reset`: behavioral contract of request/confirm — reachability under the guarded client, atomic single-use claim (expiry + `deletedAt` in the predicate), one token per user row, collapsed error contract.
- `customer-credential-write-api` (PR-2): intent-named repository commands replace the snapshot `save()`; no method writes a column its name does not claim.

### Modified Capabilities

- `tenant-context-boundaries`: the four pre-identity customer-auth handlers enter the Class A boundary map as declared `withSystemContext` seams.

## Decisions surfaced (NOT decided here — Edward decides)

| #   | Decision                                                                        | Findings (verified today)                                                                                                                                                                                                                                                                             | Recommendation                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Collapse `TOKEN_EXPIRED` → `INVALID_TOKEN`                                      | `apps/client` source has ZERO references to either code (matches only in stale `.next` artifacts); `authApi.ts` surfaces `body.error ?? body.message` generically, no branching; and no live UI reaches these endpoints anyway (path mismatch above). Distinguishing them is a token-validity oracle. | **Collapse.** Security-correct, provably no consumer. User-visible delta is one message string.                                                                                                        |
| 2   | D3 email UX (mechanical per-user-token fix is unambiguous and lands regardless) | Options: (a) N emails, one per account; (b) ONE email listing accounts, one link each; (c) account chosen at request time. This decision gates only PR-1's email composition.                                                                                                                         | **(b)** — single send preserves today's one-email silhouette (anti-enumeration), no API/client contract change, disambiguation happens in the inbox. (c) rejected: heaviest, changes request contract. |

Design-phase point (named, not decided): whole-handler system scope vs system-scope-for-resolution + `withTenantContext` re-entry for the write; and ADR-0020's preferred route-group `preHandler` seam vs 4 inline wraps. Under the single-statement claim, whole-handler is defensible because the predicate names a globally-unique token — to be stated in design, not assumed.

## Acceptance criteria (behavioral, assertable)

- **D0**: under the real guarded client (integration, `app.inject`), all 4 endpoints reach their use cases — no `TenantContextMissingError`-derived 400/500/401.
- **D1**: after a reset with a live token, `argon2.verify(STORED hash, newPassword) === true` AND `verify(STORED hash, oldPassword) === false` AND stored `resetToken IS NULL` — asserted against the persisted row, never call shape.
- **D2**: two CONCURRENT confirms of one token → exactly one `ok`, one `INVALID_TOKEN`; sequential replay fails; expired token rejected by the predicate.
- **D3**: request for an email in N accounts → N distinct tokens, one per row, zero P2002; each token claims only its own row.
- **Soft-delete**: a soft-deleted user's token does not claim (`deletedAt: null` in predicate).
- **PR-2**: `save()`/`updatePasswordHash` no longer exist; each intent method writes only its named columns (table-driven invariant test).

## Test strategy (honors explore risk 4)

- **Fake the Prisma CLIENT, never the repository** — stateful Map-backed fake with real upsert/update merge semantics (the stateless repo mock certifies the bug; a repository fake cannot observe the clobber). Gotcha: fake returns `customerRole: null`.
- Unit (vitest, tree-collected): D1 outcome test, D2 concurrency test (both writers race past the first await), repository column-invariant test.
- Integration (node:test, DB): new `customerPasswordReset.integration.test.ts` against the real `$extends` guarded client — **MUST be named in a `run_batch`** (`integration:customer-auth` or the tenant-isolation batch; fitness #30 ratchet only falls). This test also settles the `enterWith` keep-alive leakage unknown.
- Rewrite `customerAuthUseCases.test.ts:489-502` (PR-1); migrate `PrismaCustomerUserRepository.save.test.ts` invariants to the intent methods (PR-2). The fabricated-token e2e is flagged for the client-flow slice.

## Review budget (two-tier, declared per signed rule 2026-09-10)

- **CODE**: 400 hard per PR. PR-1 forecast under it (route wraps + one use-case rewrite + adapter accessor). PR-2's 8-site surgery is WHY the chain exists.
- **EVIDENCE** (tests, fakes, fixtures; empirical 2.5–3× multiplier): **pre-approved for the whole change by accepting this proposal** — the one Edward decision; the split travels in each PR body.

## Affected areas

| Area                                                                             | PR  | Impact                                                |
| -------------------------------------------------------------------------------- | --- | ----------------------------------------------------- |
| `apps/api/src/auth/customerAuthRoutes.ts`                                        | 1   | Context binding on 4 handlers; error-map collapse     |
| `packages/core/customer-auth/src/{ResetPassword,RequestPasswordReset}UseCase.ts` | 1   | Single-claim rewrite; per-user tokens                 |
| `apps/api/src/infrastructure/repositories/PrismaCustomerUserRepository.ts`       | 1+2 | `getClient()`; then intent methods                    |
| `packages/core/domain/src/repositories/CustomerUserRepository.ts`                | 2   | Port surgery (delete 2, add 6)                        |
| `Login/CompleteMfaLogin/3 team use cases + RegisterCustomerUseCase`              | 2   | Migrate to intent writes                              |
| `apps/api/tests/**` + `scripts/run-tests.sh`                                     | 1+2 | 4 red tests; rewrite 2 false certifiers; 1 batch line |

## Risks

| Risk                                                                                                        | L   | Mitigation                                                            |
| ----------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------- |
| `enterWith` leaks tenant ctx across keep-alive → some resets run under a FOREIGN tenant                     | Med | The integration test settles it; if it leaks, fix rides in PR-1       |
| Dual `txStorage` module copies → `getClient()` silently returns base                                        | Low | Fitness #27 already gates; integration test runs via `run_batch`      |
| PR-2 error-contract shifts under 3 callers; `InviteTeamMemberUseCase` needs a genuine `create` (not upsert) | Med | Compiler-checked; typed Results preserved; invariant tests per method |
| Admin D2 stays LIVE until the successor slice                                                               | Med | Successor named and sequenced immediately after                       |
| D3 email decision unanswered blocks PR-1 email composition                                                  | Med | Decision 2 above, before sdd-spec                                     |

## Rollback

No schema, no migration, app-layer only. Each stacked PR is one clean `git revert`: reverting PR-1 restores today's dead endpoints (fail-closed, no data to unwind — unclaimed tokens are inert); reverting PR-2 restores `save()` compiler-checked. No sensitive-edit token required (verified: no schema/migrations/workflows paths). Tripwire #7 (Plan Mode) applies at apply time.

## Dependencies

- Decisions 1 and 2 answered before `sdd-spec`.
- None external; DB+Redis via `pnpm db:up` for the integration tier.

## Success criteria

- [ ] All 6 acceptance criteria green, with the 4 previously-red tests as the oracle.
- [ ] New integration file named in a `run_batch` (fitness #30 count does not rise).
- [ ] `save()`/`updatePasswordHash` absent from the tree after PR-2; 0 fitness regressions; lint/tsc 0/0.
- [ ] Admin `PasswordService` successor slice + client reset-flow repair filed with owners.
