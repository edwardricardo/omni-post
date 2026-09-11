# Tasks: Password Reset Integrity (customer credential write path)

> Sources: **`design.md`** (gate-PASSED, mechanism) + the **three delta specs** (requirements) +
> `proposal.md` (scope/decisions). `explore.md` is the evidence base for every line reference
> below; every span was re-verified against the working tree while writing this file.
>
> Branch `workstream/password-reset-integrity`. Delivery: **auto-chain**, **stacked-to-main**.
> **Strict TDD** — every behavioral task is authored RED and observed red before its GREEN
> counterpart. Writers never run git; the orchestrator owns branch/commit/push/PR and the RDD
> lifecycle per link.
>
> **NO SENSITIVE PATHS.** The design confirms it and it was re-verified: nothing here touches
> `infra/prisma/schema.prisma`, `infra/prisma/migrations/**`, or `.github/workflows/**`. No
> `omnipost-allow sensitive-edit` token is required and **no task carries a `[SENSITIVE]` tag**.
> Tripwire #7 (Plan Mode on `workstream/*`) still applies at apply time.
>
> **The ordering constraint IS the design.** A D0-only fix makes the silent revert the
> endpoint's first live behaviour. The four `withSystemContext` wraps (Phase 6) land in the
> SAME PR as the single-claim rewrite (Phase 5) — never before it, never in a separate link.
>
> **The batch line is not bookkeeping.** Task 4.6 (`run-tests.sh`) lands in the SAME commit as
> the integration file it names. A `tests/integration/**` file no `run_batch` names never
> executes while still reading as coverage (fitness #30 — the ratchet may fall, never rise).

## Tag legend

`[RED]` author + observe a real failure first · `[GREEN]` production change that turns a named
red green · `[evidence]` harness/fixture/test-estate work carrying no product behaviour ·
`[integration]` real DB through the **guarded** client · `[static]` source/config inspection ·
`[compile-time]` proven by `tsc` REJECTING a program · `[deploy-time]` **unused in this change**
— Migration/Rollout is _None_ (app-layer only: no schema, no migration, no env, no workflow).

## Command legend (LXC-safe, single-file — heap 3072, never the full local suite)

- **DBUP**: `pnpm db:up` (before every integration run)
- **VITEST `<file>`**: `NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @apps/api exec vitest run <file>`
- **INT `<file>`** (from `apps/api`, DBUP first): `NODE_OPTIONS=--max-old-space-size=3072 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test <file>`
- **BATCH**: `pnpm --filter @apps/api test:integration` (runs `scripts/run-tests.sh`; the new
  batch is `integration:customer-auth`)
- **TSC**: `pnpm --filter @apps/api exec tsc -b` · **LINT**: `pnpm lint --max-warnings 0`

---

## Review Workload Forecast

| Field                    | Value                                                                      |
| ------------------------ | -------------------------------------------------------------------------- |
| Estimated changed lines  | **CODE**: PR-1 ~250–280 · PR-2a ~190–230 · PR-2b ~140–190 · total ~580–700 |
| Evidence (separate tier) | PR-1 ~830 · PR-2a ~310 · PR-2b ~200 · total ~1,340 (≈2.3× CODE)            |
| 400-line budget risk     | Medium (per-link Low; the un-split PR-2 was the risk, and it is now split) |
| Chained PRs recommended  | Yes                                                                        |
| Suggested split          | **PR-1 → PR-2a → PR-2b** (stacked to main, in order)                       |
| Delivery strategy        | auto-chain                                                                 |
| Chain strategy           | stacked-to-main                                                            |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### PR-2 re-forecast → **SPLIT**, exactly as the design pre-committed

The design forecast PR-2 at **350–400 CODE** and called the headroom "THIN, not comfortable",
instructing `sdd-tasks` to re-forecast and, if it crosses, **split at the callers seam rather
than take an exception**. Re-measured against the working tree, it crosses:

| Span                                            | Measured                                                                                               | Changed      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------ |
| Port deletions                                  | `save` `:64-69` + `updatePasswordHash` `:71-75` + `findByResetToken` `:58-62`                          | −16          |
| Port additions                                  | 5 declarations with JSDoc (~6–7 lines each)                                                            | +33          |
| Adapter deletions                               | `save` `:171-222` (52) + `updatePasswordHash` `:224-242` (19) + **`findByResetToken` `:151-169` (19)** | −90          |
| Adapter additions                               | 5 impls (4 count-gated `updateMany` ~18 each + `create` with P2002 ~25)                                | +97          |
| Six callers                                     | Login (2 sites + comment), CompleteMfa, Register, Invite, UpdateRole, Remove                           | ~85–120      |
| `InviteTeamMemberUseCase` `EMAIL_EXISTS` ripple | new typed branch + possible route error-map row                                                        | ~10–20       |
|                                                 | **TOTAL**                                                                                              | **~331–426** |

**The correction that moves it.** The design's CODE breakdown gave adapter deletions as −71
(`save` + `updatePasswordHash`) while its own File-Changes table assigns the **`findByResetToken`
adapter deletion (`:151-169`, 19 lines) to PR-2**. Adding the 19 it already owned, plus the
`EMAIL_EXISTS` ripple the design itself named as the margin-eater, puts the central estimate at
or over 400 with **zero reliable margin**. A budget met only by hoping the ripple stays small is
not met.

**Split at the callers seam, sequenced so the tree compiles at every merge** (no compatibility
shim — the design forbids them):

- **PR-2a** — ADD the 5 intent methods (port + adapter), DELETE the PR-1-orphaned
  `findByResetToken`, migrate the three **credential** callers (Register, Login, CompleteMfa).
  `save()`/`updatePasswordHash` survive this link with **zero credential callers** and their
  sharpest trap (the login rehash revert) already disarmed. ≈**190–230 CODE**.
- **PR-2b** — migrate the three **team** callers (Invite, UpdateRole, Remove), then DELETE
  `save()`/`updatePasswordHash` from port and adapter and retire `save.test.ts`. This link is
  what closes the `customer-credential-write-api` capability. ≈**140–190 CODE**.

`Decision needed before apply: No` — auto-chain starts at PR-1, which is inside budget, and every
link below is inside budget. **No `size:exception` is requested anywhere in this chain.**

### EVIDENCE tier — ONE decision, to be confirmed by Edward

Per the signed two-tier rule (2026-09-10), the **EVIDENCE** tier (stateful fake ~150, unit suites
~330, integration file ~350, rewrites ~80, invariant table ~150, caller/contract units ~200,
`run-tests.sh` +5, `save.test.ts` −100) is **pre-approved for the whole change by proposal
acceptance** — one decision, not one per PR. The CODE/EVIDENCE split is declared in each PR body.
CODE stays a hard 400 per link and is never met by deleting tests, docs, or comments.

### Suggested Work Units

| Unit | Goal                                                                                                               | Likely PR | Focused test command                                                                | Runtime harness                                                                                                                    | Rollback boundary                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | Reachability + one atomic claim + per-user tokens + tx-aware adapter; endpoints alive and provably outcome-correct | PR-1      | VITEST `tests/unit/customerPasswordResetClaim.test.ts`                              | DBUP + INT `tests/integration/customerPasswordReset.integration.test.ts` (D0 ×4, concurrent confirms, leak-immunity, UoW rollback) | one `git revert`: endpoints return to today's fail-closed dead state; unclaimed tokens are inert, nothing to unwind          |
| 2    | Intent writes exist; credential callers migrated; the login-rehash revert disarmed                                 | PR-2a     | VITEST `tests/unit/infrastructure/repositories/customerUserWriteInvariants.test.ts` | DBUP + INT the rehashing-login scenario (forced `needsRehash`)                                                                     | revert the 5 additions + 3 caller edits; `save()` is still present, so callers compile on revert                             |
| 3    | Team callers migrated; `save()`/`updatePasswordHash` deleted from the tree                                         | PR-2b     | VITEST the invariant suite + `tsc` rejection proof                                  | DBUP + BATCH (`integration:customer-auth` + `integration:tenant-isolation`)                                                        | revert restores the two port methods and their adapter impls together with the 3 caller edits — one commit, compiler-checked |

---

# PR-1 — reachability, one atomic claim, per-user tokens, tx-aware adapter

## Phase 1: Evidence harness — the stateful Prisma-client fake (blocks every red)

- [x] 1.1 [evidence] Create `apps/api/tests/unit/helpers/statefulCustomerUserPrismaFake.ts`: a Map-backed fake of the `customerUser` delegate implementing `findFirst` / `findMany` / `update` / `updateMany` / `upsert` / `create` with **real merge semantics** (`update`/`upsert.update` merge `data` onto the stored row; `updateMany` evaluates the predicate — including `resetTokenExpiry: { gt }` and `deletedAt: null` — and returns `{ count }`). Rows carry `customerRole: null` (the documented gotcha). Acceptance: injected into the **REAL** `PrismaCustomerUserRepository`, the pre-fix `save()` path executes the actual 19-column `baseData` upsert (`:175-211`) and the stored hash REVERTS — a repository fake or a capture-only fake cannot observe that and is therefore not acceptable evidence (`customer-password-reset` spec, "The proof cannot be satisfied by a double that masks the defect").

**Evidence** — 1.1: 470-line fake, guard-wired (`tenantGuardCheck` + real ambient provider), unique
indexes enforced on UPDATES as well as inserts so the D3 token collision is reproducible; injected
into the real adapter it executed the pre-fix 19-column `baseData` upsert and the stored hash
reverted (see 2.1's red).

## Phase 2: Unit REDs — must fire on the UNMODIFIED tree

- [x] 2.1 [RED] New `apps/api/tests/unit/customerPasswordResetClaim.test.ts`: real adapter over the 1.1 fake, use case run to completion. Assert the fake's **FINAL** stored hash verifies against `newPassword` and NOT against the old one, and stored `resetToken`/`resetTokenExpiry` are null. Acceptance: RED today as a **green-looking red** — the response is `ok` while the stored hash is the OLD one.
- [x] 2.2 [RED] Same file: two concurrent `execute()` calls on one token (both started before either completes) → exactly one `ok`, one `INVALID_TOKEN`. Acceptance: this decides **count-gating logic only** — a Map-backed fake is event-loop-atomic; the atomicity proof is 4.2.
- [x] 2.3 [RED] Same file: an expired token and a soft-deleted owner each → `INVALID_TOKEN`, stored hash unchanged, expired token columns **NOT** nulled by the failed attempt, `deletedAt` unchanged.
- [x] 2.4 [RED] Same file: induced context failure is not a token verdict (`tenant-context-boundaries`) — with the seam's declaration removed in the harness and a **VALID** token, the surfaced failure is a context/internal failure, **never** `INVALID_TOKEN` and never a 400 a caller could read as a bad token.
- [x] 2.5 [RED] New `apps/api/tests/unit/customerPasswordResetRequest.test.ts`: an address matching 3 accounts → the e-mail port receives **exactly ONE** send whose body carries 3 links with 3 **distinct** tokens, each labelled with the account it resets; no match → no send and the uniform body; a fake in which one row's write fails → the failure is **surfaced (returned or logged, not discarded)** and the e-mail carries no link for that row.

**Evidence** — `customerPasswordResetClaim.test.ts` + `customerPasswordResetRequest.test.ts`, RED on
the unmodified tree at **4/5 and 5/6**: 2.1 the green-looking red (`result.ok` PASSED, stored hash
failed `argon2.verify(stored, NEW)`); 2.2 `2 !== 1` successes; 2.3 `TOKEN_EXPIRED` where
`INVALID_TOKEN` is required (the soft-deleted half already passed pre-fix and is kept as a
regression guard); 2.4 `INVALID_TOKEN` surfaced for a missing context; 2.5 rows 2–3 carried no
token at all (the collision) and `unpersistedCount` did not exist. All GREEN after Phases 4–6.

## Phase 3: Integration REDs — the four documented shapes (dep: nothing; run pre-fix)

- [x] 3.1 [RED][integration] New `apps/api/tests/integration/customerPasswordReset.integration.test.ts` against the REAL guarded client (`base.$extends(tenantGuardExtension(...))`, the `projectMemberTenantIsolation.test.ts:100-118` construction) driven by `app.inject`. **D0 reachability ×4**: `register`, `refresh`, `request-password-reset`, `reset-password` each answer their contract response and raise no `TenantContextMissingError` (nor anything derived from it). Acceptance: RED today in **four distinct shapes — 500, 401, 500, 400** — and the 400 is the one that reads as normal behaviour, which is why 2.4 and 6.3 exist beside it.
- [x] 3.2 [RED][integration] Same file: **D1 persisted row** — after a successful confirm, read the row back through the guarded client and assert `argon2.verify(stored, newPassword) === true` **and** `argon2.verify(stored, oldPassword) === false` **and** stored `resetToken IS NULL`. Never a call-shape assertion.
- [x] 3.3 [RED][integration] Same file: **D2 atomicity** — two CONCURRENT confirms of one token submitting DIFFERENT new passwords → exactly one `ok`, one `INVALID_TOKEN`; the stored hash verifies against the winner's password and no other; token columns null. Plus sequential replay → `INVALID_TOKEN` with the stored hash **byte-identical** to the first confirm's.
- [x] 3.4 [RED][integration] Same file: **one failure code** — four confirms carrying an unknown, an expired, an already-claimed, and a live-token-with-soft-deleted-owner are **identical in status, code and message**.
- [x] 3.5 [RED][integration] Same file: **D3** — one address in 3 accounts → all 3 rows carry non-null, pairwise-distinct `resetToken`s with zero unique-constraint failures; confirming account 2's token changes only that row's hash and clears only its token columns, the other two keep their hash and their still-live tokens.
- [x] 3.6 [RED][integration] Same file: **leak-IMMUNITY probe — NOT leak-existence.** Keep-alive agent: authenticate as tenant A, then confirm a tenant-**B** reset on the SAME socket → succeeds with row B mutated; a subsequent tenant-A request still enforces A-scope (no forward system leak). Acceptance: the test's own comment states that under the wrap leak and no-leak are **observationally identical** (system wins over tenant in both layers — `tenantGuard.ts:202-205`, `tenantGuc.ts:119-124`), so this probe is a **regression oracle** for the wrap and for system-before-tenant precedence, and claims nothing about whether `enterWith` leaks.
- [x] 3.7 [RED][integration] Same file: a customer-user write performed inside a `UnitOfWork` transaction that then **rolls back** leaves NO row behind when read through the guarded client (closes the second-pooled-connection escape `tenantGucBinding.ts:104-106`).
- [x] 3.8 `apps/api/scripts/run-tests.sh`: add, in the DB-only tier beside `integration:tenant-isolation` (~`:273`), `CONCURRENCY=1 run_batch "integration:customer-auth" \` naming `tests/integration/customerPasswordReset.integration.test.ts`. **Lands in the same commit as 3.1.** Acceptance: fitness #30's unreached count does NOT rise (ratchet 21); `--conditions development` comes free from `run_batch` (fitness #27 Part A); #31's zero-collection guards apply to the new batch.

**Evidence** — `customerPasswordReset.integration.test.ts`, **11/11 RED** pre-fix. 3.1's four shapes
landed exactly as documented: register `500 TENANT_CONTEXT_MISSING` (the throw escapes the use
case's own try/catch, which starts after the cross-account lookup), refresh `401 "User not found"`,
request `500`, confirm `400 "Invalid or expired reset token"`. 3.7's red printed both hashes — the
base-client write survived the rollback, the second-pooled-connection escape, measured. 3.8 landed
in the same edit; fitness #30 re-measured at **21, unchanged**. All GREEN after Phases 4–6: 12/12,
0 cancelled, 0 skipped, under `run_batch "integration:customer-auth"`.

## Phase 4: GREEN — port + adapter (D-2, D-3)

- [x] 4.1 [GREEN] `packages/core/domain/src/repositories/CustomerUserRepository.ts`: add the **two** PR-1 methods in FINAL form with JSDoc — `claimPasswordReset(token, newPasswordHash) → Result<void, "INVALID_TOKEN" | "INTERNAL_ERROR">` and `issueResetToken(userId, token, expiresAt) → Result<void, "USER_NOT_FOUND" | "INTERNAL_ERROR">`. Acceptance: port-first is forced by layering (the use case imports only the domain port), and these seams are **final** — PR-2 deletes, never reworks them.
- [x] 4.2 [GREEN] `apps/api/src/infrastructure/repositories/PrismaCustomerUserRepository.ts`: implement `claimPasswordReset` as **ONE** `updateMany({ where: { resetToken, resetTokenExpiry: { gt: now }, deletedAt: null }, data: { passwordHash, resetToken: null, resetTokenExpiry: null } })`. Acceptance: `INVALID_TOKEN` is returned **ONLY** from `count !== 1`; a tenant-guard throw surfaces as `INTERNAL_ERROR` and is **never** swallowed into a token verdict (that conversion is the `:161-168` lesson and the `tenant-context-boundaries` ADDED requirement forbids it).
- [x] 4.3 [GREEN] Same file: implement `issueResetToken` as a count-gated `updateMany({ where: { id, deletedAt: null }, data: { resetToken, resetTokenExpiry } })` → `USER_NOT_FOUND` on `count !== 1`, `INTERNAL_ERROR` on throw.
- [x] 4.4 [GREEN] Same file: add `private getClient()` resolving `PrismaUnitOfWork.getTransactionClient() ?? this.prisma` (template: the same-table sibling `PrismaCustomerMfaUserRepository:39-42`) and route **all 10 existing query sites** through it — `findById` `:68`, `findByEmail` `:86`, `findByEmailAcrossAccounts` `:103`, `findByAccountId` `:111`, `findByProjectId` `:120`, `findByInviteToken` `:133`, `findByResetToken` `:153`, `save` `:207`, `updatePasswordHash` `:229`, `delete` `:246` — plus the two new impls. Acceptance: zero `this.prisma.` outside `getClient()`; 3.7 goes green.

**Evidence** — 4.1 two declarations added in FINAL form with JSDoc, nothing deleted. 4.2/4.3 both
impls are one count-gated `updateMany`; `INVALID_TOKEN` is reachable ONLY from `count !== 1`, and a
throw goes to `logWriteFailure` + `INTERNAL_ERROR` (verified by 2.4, which asserts the log call).
4.4 `getClient()` added and all **10** measured sites routed through it — `rg 'this\.prisma\.'` now
returns **0** (the one surviving `this.prisma` is inside `getClient()` itself); 3.7 GREEN.

## Phase 5: GREEN — use cases (D1 · D2 · D3 · union collapse)

- [x] 5.1 [GREEN] `packages/core/customer-auth/src/ResetPasswordUseCase.ts`: single-claim rewrite. DELETE the `findByResetToken` read (`:50`), the entity expiry check (`:58-60`), the `updatePasswordHash` write (`:67`), and the snapshot `save` (`:74`). Hash, then ONE `claimPasswordReset(input.token, newHash)` inside `executeInTransaction`. Drop `TOKEN_EXPIRED` from `ResetPasswordError` (`:13-14`). Acceptance: 2.1 / 2.2 / 2.3 GREEN; exactly one write reaches the customer-user row and **no whole-entity save follows the claim** (the prohibition is on the flow's SHAPE, not only its outcome).
- [x] 5.2 [GREEN] `packages/core/customer-auth/src/RequestPasswordResetUseCase.ts`: move token generation **inside** the loop (one distinct token per user row) and persist via `issueResetToken`; a per-row failure is surfaced, never discarded (`:60` today discards it), and **no link whose token was not persisted is e-mailed**. Acceptance: 2.5 GREEN; 3.5 GREEN; the anti-enumeration silhouette is unchanged (always one response body, always `ok`).
- [x] 5.3 [GREEN] Same file: add optional `accountQueryRepo?: AccountQueryRepositoryPort` and compose **ONE** e-mail carrying one labelled link per persisted row (`${base}/reset-password?token=${token_i}`). Acceptance: `findById → AccountDto` supplies the account name; a `NOT_FOUND` account yields a **generic label, never an error**; zero matches still send nothing.
- [x] 5.4 [GREEN] `apps/api/src/infrastructure/container/setupCustomerAuthUseCases.ts:136-145`: pass `container.resolve(TOKENS.AccountQueryRepository)` into the use case. Acceptance: the concrete is resolved in the composition root only (fitness #21); TSC 0.

**Evidence** — 5.1 the four named lines are gone (`findByResetToken` read, entity expiry check,
`updatePasswordHash`, snapshot `save`); one `claimPasswordReset` inside `executeInTransaction`;
`TOKEN_EXPIRED` dropped from the union. 5.2 token generated inside the loop, persisted via
`issueResetToken`, failures counted into `unpersistedCount` and never e-mailed. 5.3 one send with N
labelled links; a `NOT_FOUND` account degrades to `GENERIC_ACCOUNT_LABEL`; names are HTML-escaped
before interpolation (asserted). 5.4 `TOKENS.AccountQueryRepository` resolved in the composition
root only; TSC exit 0.

## Phase 6: GREEN — the four A9 seams + the error-map collapse (SAME PR as Phase 5, never before)

- [x] 6.1 [GREEN] Create `apps/api/src/auth/customerAuthSystemReasons.ts` exporting the four A9 reason constants (`customer-register`, `customer-refresh`, `customer-request-password-reset`, `customer-reset-password`, in the `system:customer-*` fixed-set form). Acceptance: the `tenant-context-boundaries` static scenario — each seam names an **exported constant** from one grep-able module, none passes an inline literal, none interpolates request data. (The design fixes the wrap SHAPE and the login-precedent naming; the spec fixes the constant FORM. Both are satisfied; the pre-existing ad-hoc literals at `customerAuthRoutes.ts:164` / `:241` are the spec's **recorded residual** and are NOT retrofitted here.)
- [x] 6.2 [GREEN] `apps/api/src/auth/customerAuthRoutes.ts`: wrap the use-case invocation of `register` (`:117`), `refresh` (`:354`), `requestPasswordReset` (`:413`) and `resetPassword` (`:442`) in `withSystemContext(<constant>, () => …)`, each carrying the login-precedent rationale comment (the `:158-163` form) which **states how far the system scope extends and why** — whole-handler, defensible because the claim predicate names a globally-`@unique` token (and, for register, because no tenant exists at the boundary yet. Acceptance: 3.1 GREEN; the authenticated routes registered in the same plugin (`GET /me`) are untouched — no route-group `preHandler` seam, which would blanket-bypass them and would need irreversible `enterWith` semantics.
- [x] 6.3 [GREEN] Same file: delete the `TOKEN_EXPIRED` row from the reset error map (`:450`). Acceptance: the static scenario — neither the use case's error union nor the route's error map mentions `TOKEN_EXPIRED`; 3.4 GREEN (all four bad-token classes identical).

**Evidence** — 6.1 `apps/api/src/auth/customerAuthSystemReasons.ts` exports the four
`system:customer-*` constants; the pre-existing login / MFA-login literals are recorded in its
header as the spec's named residual, not retrofitted. 6.2 all four handlers wrapped, each carrying a
rationale comment that states HOW FAR the system scope extends and why; `GET /me` and the other
authenticated routes untouched (no route-group `preHandler`). 6.3 the `TOKEN_EXPIRED` row is gone
from the reset error map — the only remaining mention in the flow is a NEGATIVE assertion proving
its absence. 3.1 and 3.4 GREEN, 3.4 non-vacuously (a valid token answers 200 in the same run).

## Phase 7: Test estate — retire the false certifiers (tsc-forced, same PR)

- [x] 7.1 [evidence] `apps/api/tests/unit/customerAuthUseCases.test.ts` — rewrite the **WHOLE** `ResetPasswordUseCase` describe (`:451-513`): `:461-473` re-drives "token not found" through the **claim path**; `:475-487`'s expiry test is **REWRITTEN to assert `INVALID_TOKEN` produced by the claim predicate — NEVER deleted** (it carries the proposal's expired-token acceptance criterion, and its `TOKEN_EXPIRED` assert stops type-checking under the collapsed union); `:489-502`'s `updatePasswordHash`-called-once **AND** `save`-called-once pair — the assertion that CERTIFIES the bug and stays green under any fix — is replaced by persisted-outcome assertions; the short-password test (`:504-512`) is unchanged.
- [x] 7.2 [evidence] Same file: rewrite the `save`-count assertion at `:440-448` ("sets reset token when user exists") onto per-row `issueResetToken` outcomes, and keep `:431-438`'s no-enumeration test asserting that nothing is issued and nothing is sent.
- [x] 7.3 [evidence] Same file: update the `makeCustomerUserRepo` double (`:56-66`) to the PR-1 port shape (`claimPasswordReset`, `issueResetToken`). Acceptance: this double stays a **use-case-level error-contract** double; every **outcome** assertion lives in 2.1–2.3 against the real adapter over the client fake.

**Evidence** — 7.1 the whole `ResetPasswordUseCase` describe is rewritten: the token-not-found case
re-drives through the claim path; the expiry test is **REWRITTEN, not deleted** — it now asserts
`INVALID_TOKEN` produced by the claim predicate AND explicitly asserts the absence of
`TOKEN_EXPIRED`; the `updatePasswordHash`-once + `save`-once pair that CERTIFIED the defect is
replaced by a shape assertion (one claim, and `save` / `updatePasswordHash` / `findByResetToken` all
NOT called) plus an `argon2.verify` on the hash the claim carried; the short-password test is
unchanged. 7.2 the `save`-count assertion is now per-row `issueResetToken` outcomes plus a new
unpersisted-count case; the no-enumeration test asserts nothing issued AND nothing sent. 7.3 the
double gained `claimPasswordReset` / `issueResetToken` and a header saying it is an error-contract
double whose outcome claims live in the two new stateful suites. 38/38 unit tests green.

## Phase 8: PR-1 gate

- [ ] 8.1 **0-defect gate (PR-1)** — all of: **TSC** exit 0 · **LINT** `--max-warnings 0` exit 0 · `pnpm format:check` clean · fitness **#1 #2 #3 #4 #5 #8 #9 #10 #21 #23 #27A #31 #32 #38(swept) #40(A+B)** = 0, **#30** ratchet still 21 (unchanged, not raised), **#38** db-prisma ratchet still 11 · VITEST the three unit files green · DBUP + **BATCH** `integration:customer-auth` **and** `integration:tenant-isolation` green with **0 cancelled and 0 skipped** · database **left as found**, proven by an **out-of-band read** (a separate client, not the suite's own) confirming zero `customerUser` rows and zero reset tokens survive from the run.

---

# PR-2a — intent writes exist; the credential callers migrate (dep: PR-1)

## Phase 9: REDs — the authority criterion and the rehash that reverts itself

- [ ] 9.1 [RED][evidence] New `apps/api/tests/unit/infrastructure/repositories/customerUserWriteInvariants.test.ts`: **table-driven** (command, declared column set) over the 1.1 fake — for each command, diff the stored row **before/after** and assert the changed-column set **EQUALS** the declared set. Acceptance: this is the **authority criterion** made executable — _completeness_ (the write lists every column the intent requires), _exclusivity_ (each column has exactly one writing intent; `passwordHash`'s three writers — `create`, `claimPasswordReset`, `upgradePasswordHash` — are each sanctioned by name), _no side channel_ (no optional parameter alters the projection). RED today: the five commands do not exist.
- [ ] 9.2 [RED] Same file: every command invoked in turn against a **soft-deleted** row leaves `deletedAt` unchanged — no command resurrects a deleted user and none re-deletes a restored one.
- [ ] 9.3 [RED] Same file: no command's write set names `mfaEnabled`, `mfaSecret`, `mfaBackupCodes`, `mfaBackupUsedAt`, or `mfaLastUsedTotpStep` — those columns are owned by `PrismaCustomerMfaUserRepository` under CAS discipline, which a snapshot write silently defeats.
- [ ] 9.4 [RED] Same file: `recordLogin` against an entity whose in-memory hash is **stale relative to the stored row** leaves the stored hash unchanged and writes only the login timestamp.
- [ ] 9.5 [RED][integration] Extend `apps/api/tests/integration/customerPasswordReset.integration.test.ts` (already in the batch) with the **rehashing-login** scenario: seed a stored hash under parameters that **FORCE** `argon2.needsRehash` true (the spec requires forcing the condition, not waiting for a production `ARGON2_PARAMS` bump — otherwise it proves nothing and the trap stays armed), log in end to end, then assert the stored hash is the **UPGRADED** one: `argon2.verify(stored, password)` true **AND** `stored` not byte-identical to the pre-login hash. Acceptance: RED today — `LoginCustomerUseCase.ts:253`'s snapshot `save` restores the OLD hash after `:220` wrote the upgrade.

## Phase 10: GREEN — the five intent writes (port + adapter)

- [ ] 10.1 [GREEN] `packages/core/domain/src/repositories/CustomerUserRepository.ts`: add `create(user, passwordHash)`, `recordLogin(userId, at)`, `changeRole(userId, roleId)`, `deactivate(userId)`, `upgradePasswordHash(userId, newHash)` with JSDoc. Acceptance: `upgradePasswordHash` is the **gate-ACCEPTED divergence** from the proposal's "delete `updatePasswordHash`" — its JSDoc names the login rehash as its **only sanctioned caller**; the old name and its false JSDoc (`:64-68`, "otherwise the existing hash is preserved on update") die in PR-2b. Also DELETE the now-orphaned `findByResetToken` declaration (`:58-62`) — PR-1's single-claim rewrite killed its only consumer.
- [ ] 10.2 [GREEN] `apps/api/src/infrastructure/repositories/PrismaCustomerUserRepository.ts`: implement the five through `getClient()` — `create` as a **genuine `create`** mapping P2002 → `EMAIL_EXISTS` (not an upsert); the other four as count-gated `updateMany` naming exactly their own columns and returning typed `Result`s. DELETE the orphaned `findByResetToken` impl (`:151-169`) — its `:161-168` catch is the swallowed-guard-throw lesson this change exists to retire.
- [ ] 10.3 [GREEN] Run VITEST `customerUserWriteInvariants.test.ts` → 9.1–9.4 green.

## Phase 11: GREEN — credential callers (compiler-driven)

- [ ] 11.1 [GREEN] `packages/core/customer-auth/src/LoginCustomerUseCase.ts`: `:220` `updatePasswordHash` → `upgradePasswordHash`; `:253` `save(targetUser)` → `recordLogin(targetUser.id, …)` with its `Result` **checked** (today it is discarded). Rewrite the `:211-217` comment — it currently states the stale-entity precondition correctly and then draws the opposite conclusion. Acceptance: 9.5 GREEN — the rehash persists.
- [ ] 11.2 [GREEN] `packages/core/customer-auth/src/CompleteCustomerMfaLoginUseCase.ts:205` `save(user)` → `recordLogin(user.id, …)`, keeping the existing typed failure branch distinguishable.
- [ ] 11.3 [GREEN] `packages/core/customer-auth/src/RegisterCustomerUseCase.ts:149` `save(user, passwordHash)` → `create(user, passwordHash)`; map `EMAIL_EXISTS` onto the use case's existing `EMAIL_EXISTS` code. Acceptance: no new route error-map row — `customerAuthRoutes.ts:129` already carries the 409.
- [ ] 11.4 [GREEN] Re-run VITEST `customerAuthUseCases.test.ts` and DBUP + INT the reset/login integration file → green.

## Phase 12: PR-2a gate

- [ ] 12.1 **0-defect gate (PR-2a)** — TSC 0 · LINT `--max-warnings 0` 0 · `format:check` clean · fitness **#2 #3 #4 #5 #8 #9 #10 #21 #23 #31 #32 #38(swept) #40(A+B)** = 0, **#30** ratchet 21 unchanged, **#38** db-prisma ratchet 11 unchanged · unit suites green · DBUP + BATCH `integration:customer-auth` + `integration:tenant-isolation` green, **0 cancelled, 0 skipped** · database left as found (out-of-band read).

---

# PR-2b — team callers migrate; the snapshot writers are deleted (dep: PR-2a)

## Phase 13: REDs — creation creates, and migrated callers keep their failure classes

- [ ] 13.1 [RED] Extend `customerUserWriteInvariants.test.ts`: creating a duplicate (same account + e-mail) returns a **typed conflict** and leaves the existing row unchanged in **every** column. Acceptance: the upsert semantics the current code relies on turn an invitation for an already-registered address into a silent overwrite of that user — that is the behaviour being deleted, so the test asserts the row, not the call.
- [ ] 13.2 [RED] New/extended unit coverage per migrated caller (`InviteTeamMemberUseCase`, `UpdateTeamMemberRoleUseCase`, `RemoveTeamMemberUseCase`): when the underlying write fails, each caller's own error contract still **distinguishes the failure classes it distinguished before the migration** (no collapse into one internal error).

## Phase 14: GREEN — the three team callers

- [ ] 14.1 [GREEN] `packages/core/team/src/InviteTeamMemberUseCase.ts:110-122` `save(member)` → `create(member, "")` (the `""` stub hash; the upsert reliance was always the **create** branch — a fresh `randomUUID` id — so a genuine `create` preserves behaviour and surfaces duplicates honestly). Add the typed `EMAIL_EXISTS` → conflict branch. Acceptance: **the forecast's named ripple** — check the invite route's error map and add a 409 row only if the new typed error actually reaches it; record the measured delta in the PR body either way.
- [ ] 14.2 [GREEN] `packages/core/team/src/UpdateTeamMemberRoleUseCase.ts:97` `save(member)` → `changeRole(member.id, roleId)`.
- [ ] 14.3 [GREEN] `packages/core/team/src/RemoveTeamMemberUseCase.ts:56` `save(memberResult.value)` → `deactivate(memberResult.value.id)`; the entity's `.deactivate()` (`:50`) stops being the write's source.
- [ ] 14.4 [GREEN] Run 13.1 / 13.2 → green.

## Phase 15: GREEN — the deletions (this is what closes the capability)

- [ ] 15.1 [GREEN] `packages/core/domain/src/repositories/CustomerUserRepository.ts`: delete the `save` (`:64-69`) and `updatePasswordHash` (`:71-75`) declarations **together with the false JSDoc** at `:66-68` — a contract that lies is worse than an undocumented one.
- [ ] 15.2 [GREEN] `apps/api/src/infrastructure/repositories/PrismaCustomerUserRepository.ts`: delete `save` (`:171-222`, the 19-column `baseData` upsert incl. `passwordHash`, `mfaEnabled`, `mfaSecret`, `deletedAt`) and `updatePasswordHash` (`:224-242`).
- [ ] 15.3 [evidence] Replace `apps/api/tests/unit/infrastructure/repositories/PrismaCustomerUserRepository.save.test.ts` with the invariant suite: delete the **capture-only** fake (`calls.push(args)` cannot observe a clobber) and **MIGRATE its two live invariants into the `create` row of the invariant table** — "never passes a scalar `role` argument" and `roleId: "" → NULL, never ""`. Neither invariant is dropped; they change owner, not existence.
- [ ] 15.4 [static] Confirm `rg 'customerUserRepo\.(save|updatePasswordHash)\(|findByResetToken'` returns **zero** across `apps/` and `packages/` (other repositories keep their own `save` — scope the check to the customer-user port). Acceptance: the static scenario "the snapshot writers are gone from the tree".
- [ ] 15.5 [compile-time] Prove the capability's core claim the way the spec demands: plant a call that **omits** a required credential value (e.g. `create(user)` without the hash), run **TSC**, observe a **REAL non-zero exit** — an annotation proves nothing — then restore the tree **byte-exact** (verify with `cmp`/checksum) and re-confirm TSC 0. Record the demonstration in the PR body. A runtime test cannot distinguish "inexpressible" from "nobody has written it yet"; and per repo canon every new gate ships with its red demonstrated.

## Phase 16: PR-2b gate

- [ ] 16.1 **0-defect gate (PR-2b)** — TSC 0 · LINT `--max-warnings 0` 0 · `format:check` clean · fitness **#2 #3 #4 #5 #8 #9 #10 #21 #23 #31 #32 #38(swept) #40(A+B)** = 0, **#30** ratchet 21 unchanged, **#38** db-prisma ratchet 11 unchanged · full unit set green · DBUP + BATCH `integration:customer-auth` + `integration:tenant-isolation` green, **0 cancelled, 0 skipped** · database left as found (out-of-band read) · 15.5's planted red recorded with its byte-exact restore.

---

## Success criteria (proposal, restated as the chain's exit)

- [ ] All 6 acceptance criteria green, with the previously-red tests (2.1–2.5, 3.1–3.7, 9.1–9.5) as the oracle.
- [ ] The new integration file is named in a `run_batch`; fitness #30's count does not rise.
- [ ] `save()` / `updatePasswordHash` absent from the tree after PR-2b; 0 fitness regressions; lint/tsc 0/0.
- [ ] Filed with owners, not absorbed here: the admin `PasswordService` CAS successor slice, and the client reset-flow path mismatch (`apps/client/lib/auth/authApi.ts` posts `POST /reset-password` + `POST /reset-password/confirm` against a backend exposing `POST /request-password-reset` + `POST /reset-password`; the login page links a forgot-password page that does not exist).
