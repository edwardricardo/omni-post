# EXPLORE — password-reset-integrity (re-verification against main @ 1b498fbb)

> Materialized by the orchestrator from Engram `sdd/password-reset-integrity/explore`
> (obs 648) — the explore executor had no Write tool and reported blocked rather than
> faking the artifact. Prior-art resolution (the §0 blocker): the complete 2026-08-15
> exploration that lived at `openspec/changes/customer-credential-write-integrity/`
> is ABSORBED into this change as `explore-prior-2026-08-15.md` (moved with provenance,
> folder retired) — this document supersedes it; every claim below was re-verified
> against today's tree, and three of the prior art's claims are corrected herein.

## 1. Per-defect verdicts (evidence from TODAY's tree)

| ID                                                   | Verdict                                                | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Reachability today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Severity            |
| ---------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **D0** missing tenant binding on pre-identity routes | **ALIVE, unchanged in mechanism, WIDER than recorded** | `customerAuthRoutes.ts` — `login` wraps at `:164` (`withSystemContext("customer-login")`), `completeMfaLogin` at `:241`. `register` `:117`, `refresh` `:354`, `requestPasswordReset` `:413`, `resetPassword` `:442` wrap **nothing**. `customerUser` is enrolled at `tenantGuard.ts:114`; `findFirst`/`findMany`/`upsert`/`update` are all in `WHERE_OPERATIONS`/`CREATE_OPERATIONS` (`:155-173`); no context ⇒ `throw new TenantContextMissingError` at `:209`. `TOKENS.PrismaClient` IS the guarded client (`setup.ts:74-77`).                                                                                                                                                                                                                                                                                                  | **Dead, 4 endpoints.** `reset-password` → adapter catch `PrismaCustomerUserRepository.ts:161-168` swallows the throw into `EntityNotFoundError` → `ResetPasswordUseCase.ts:51-53` → `err("INVALID_TOKEN")` → **HTTP 400 "Invalid or expired reset token"**, indistinguishable from a genuinely bad token. `request-password-reset` → `findByEmailAcrossAccounts` (`:102-108`) has **no** try/catch → propagates to `RequestPasswordResetUseCase.ts:90` → **500**. `register` → **500**. `refresh` → **401 USER_NOT_FOUND** (`RefreshCustomerTokenUseCase.ts:63-66`). | **BLOCKER**         |
| **D1** the revert                                    | **ALIVE, line-shifted only**                           | `ResetPasswordUseCase.ts:67` `updatePasswordHash(user.id, newHash)` → `:73` `user.clearResetToken()` (touches `_resetToken`/`_resetTokenExpiry`/`_updatedAt` only, `CustomerUser.ts:488`) → `:74` `save(user)` **one arg** → `PrismaCustomerUserRepository.ts:173` `const hash = passwordHash ?? user.passwordHash` → `:182` into `baseData` → `:207-211` `upsert({update: baseData})`. Entity's `_passwordHash` assigned only at ctor `:133` and `acceptInvitation` `:466`; getter `:234` read-only; **no `changePassword`**. `save`'s Result is **discarded** at `:74` while `updatePasswordHash`'s is checked at `:68`.                                                                                                                                                                                                        | Latent behind D0. **First live behaviour of a D0-only fix is the silent revert.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | HIGH                |
| **D2** token never claimed                           | **ALIVE on both sides; one prior claim corrected**     | Admin (live, `adminUser` NOT tenant-enrolled): `PasswordService.ts:229-233` `findFirst({passwordResetToken, passwordResetExpires:{gt:now}})` → `:275-289` `update({where:{id}})` nulling the token at `:282-283`. Token absent from the predicate ⇒ TOCTOU, not reuse (a _sequential_ replay correctly fails). Gap contains 1–6 argon2id ops (`passwordHistory` defaults `[]`). Customer: `PrismaCustomerUserRepository.ts:153-156` → `:207-211`, **and expiry is not in the predicate** (checked in the entity at `ResetPasswordUseCase.ts:58`). **Correction:** the API confirm endpoints take the token in the **body** (`adminAuthRoutes.ts:301` `resetPasswordConfirmSchema.safeParse(request.body)`); the query-string exposure is in the **emailed link** (`adminAuthRoutes.ts:264`, `RequestPasswordResetUseCase.ts:79`). | Admin: **live end-to-end**. Customer: behind D0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | MEDIUM-HIGH (admin) |
| **D3** one token, N accounts                         | **ALIVE, same outcome by a different mechanism**       | `RequestPasswordResetUseCase.ts:54` generates ONE token outside the loop; `:58-61` assigns it to every row from `findByEmailAcrossAccounts`; `resetToken String? @unique` (`schema.prisma:354`) while `@@unique([accountId, email])` (`:393`) permits the same email in N accounts. Results discarded at `:60`; email sent unconditionally `:81-87`. **Shape change:** the loop IS now inside `executeInTransaction` (`:67`) — but the repository never resolves the tx client, so each `save` escapes and autocommits anyway (§3). Row 1 wins, rows 2..N take P2002 silently. `findMany` has **no `orderBy`** (`:103-106`) ⇒ arbitrary winner.                                                                                                                                                                                   | Behind D0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | MEDIUM              |

**New, not in either prior art:** `baseData` now carries `deletedAt`
(`PrismaCustomerUserRepository.ts:204`), added by the soft-delete sweep. A stale `save()`
therefore reverts **soft-delete state** — it can resurrect a soft-deleted customer user or
re-delete a restored one. That intersects the just-landed `project-deletion-integrity`
workstream and fitness #38's surface.

## 2. The `save()` class, re-measured

### 2a. Call sites — 8, unchanged, all re-verified

| #   | Site                                                        | Intends                                | Also writes                             | Class                      |
| --- | ----------------------------------------------------------- | -------------------------------------- | --------------------------------------- | -------------------------- |
| 1   | `ResetPasswordUseCase.ts:74`                                | resetToken(+expiry)                    | **passwordHash (stale)** +16            | **BROKEN**                 |
| 2   | `LoginCustomerUseCase.ts:253`                               | lastLoginAt                            | **passwordHash (stale)** +17            | **BROKEN-DORMANT**         |
| 3   | `CompleteCustomerMfaLoginUseCase.ts:205`                    | lastLoginAt                            | 18 incl. mfaEnabled/mfaSecret/deletedAt | LOST-UPDATE-RISK (widest)  |
| 4   | `RequestPasswordResetUseCase.ts:60`                         | resetToken(+expiry)                    | 18                                      | LOST-UPDATE-RISK + D3      |
| 5   | `UpdateTeamMemberRoleUseCase.ts:97`                         | roleId                                 | 18                                      | LOST-UPDATE-RISK           |
| 6   | `RemoveTeamMemberUseCase.ts:56`                             | isActive:false (`.deactivate()` `:50`) | 18                                      | LOST-UPDATE-RISK           |
| 7   | `InviteTeamMemberUseCase.ts:111`                            | creation                               | n/a                                     | SAFE                       |
| 8   | `RegisterCustomerUseCase.ts:149` `save(user, passwordHash)` | creation                               | n/a                                     | SAFE — the only 2-arg call |

**#2 is the sharpest evidence.** `LoginCustomerUseCase.ts:218-221` writes the upgraded hash
via `updatePasswordHash`; `:252-253` then `save(targetUser)` with the entity still holding the
old hash — and the comment at `:215-217` _states that precondition_ ("the in-memory entity
keeps its original `passwordHash` field (readonly)") and draws the opposite conclusion.
Dormant only because `needsRehash` → `argon2.needsRehash(hash, ARGON2_PARAMS)` is false while
params are unchanged; **arms on any `ARGON2_PARAMS` bump**, which `passwordHashing.ts:27-28`
advertises as the safe upgrade path. MFA users return at `:249` before the save, so only
non-MFA customers lose the rehash. Compounding: `passwordHashing.ts:73-77`'s canonical JSDoc
example is `user.passwordHash = ...; await repo.save(user)` — **unimplementable** against a
readonly entity, which is precisely why the author reached for the two-write workaround.

### 2b. Authority criterion (completeness · exclusivity · no side channel)

`PrismaCustomerUserRepository.save` **fails all three**: writes 19 of 27 scalars from an
entity whose row projection (`:21-51`) never reads `avatarUrl`, `mfaBackupCodes`,
`mfaBackupUsedAt`, `mfaLastUsedTotpStep`; non-exclusive — `PrismaCustomerMfaUserRepository`
writes `mfaEnabled`/`mfaSecret`/`mfaLastUsedTotpStep` on the **same row** with CAS
discipline; and the side channel is in the port signature (`CustomerUserRepository.ts:69`
`passwordHash?` + `:75` `updatePasswordHash`). The port JSDoc at `:66-68` — _"otherwise the
existing hash is preserved on update"_ — is **false**; it is overwritten with the in-memory
snapshot.

### 2c. Transaction-accessor count — re-measured, and the canon verdict

Same scope as the prior art (`apps/api/src/infrastructure`):

- Files containing a Prisma-model write verb: **85** (prior art measured 86 — population
  essentially unchanged).
- Files resolving `getTransactionClient`: **16**, minus 2 that own the mechanism
  (`PrismaUnitOfWork.ts`, `tenantTransaction.ts`) ⇒ **14 consumers** (prior art: 10).
- The +4 are `PrismaProjectRepository`, `PrismaAccountRepository`,
  `PrismaCrisisProjectRepository`, `PrismaTrackedLinkRepository` — all touched by
  tenant-isolation fase 0.

**14 of 85 (16.5%), up from 10 of 86 (11.6%). 71 writing files still do not resolve it.**

**Canon verdict on `ARCHITECTURE_CANON.md:149`** (_"repositories auto-detect the active
transaction via `PrismaUnitOfWork.getTransactionClient()`"_, wording **unchanged**):
**STILL FALSE — partially repaired, and now materially more dangerous.**
`getTransactionClient` appears in neither `CLAUDE.md` nor `.github/workflows/fitness.yml`
(0 matches). Fitness **#40** gates `.$transaction(` openers (Part A) and seam scope
derivation (Part B, 15 call sites vs a floor of 10) — it does **not** catch "repository
silently escapes the ambient UoW transaction".

**The escalation fase 0 introduced.** `PrismaUnitOfWork.executeInTransaction` now holds the
ownership marker (`:94` `runWithBoundGuc(scope, () => txStorage.run(tx, fn))`). A repository
that uses `this.prisma` inside that transaction therefore hits `bindGucForOperation`'s
**first** branch (`tenantGucBinding.ts:104-106` `if (isGucBound()) return query(args)`) and
passes through **unwrapped** — running on the pooled connection, committing independently of
the enclosing rollback. That is verbatim the escape `tenantGuc.ts:16-19` calls _"measured,
not theoretical"_. Before fase 0 the 71 non-tx-aware writers merely missed the transaction;
now they are in the exact failure mode the marker was built to prevent, and it is documented
in-tree as a known hazard.

Guard ordering is unchanged and correct: `tenantGuardCheck` wraps `bindGucForOperation`
(`tenantGucBinding.ts:147-168`), so a context-less call on an enrolled model throws
**before** any transaction opens. **Fase 0 did not change D0's mechanism or failure codes.**

## 3. Quality judgment (BIEN / ARREGLABLE / MAL HECHO)

| Unit                                                  | Verdict                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResetPasswordUseCase`                                | **MAL HECHO**               | Two writes for one logical change (`:67`,`:74`), the second reverting the first; `save`'s Result unchecked at `:74` while `updatePasswordHash`'s is checked at `:68`; wrapped in a UoW (`:79-85`) the repository ignores.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `RequestPasswordResetUseCase`                         | **MAL HECHO**               | One token across tenant boundaries against a `@unique` column; Results discarded in the loop (`:60`); `findMany` with no `orderBy`; the "always return ok" enumeration defence is currently a uniform 500.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `CustomerUserRepository` port                         | **MAL HECHO**               | Two ways to write one column, neither authoritative; JSDoc `:66-68` states behaviour the adapter does not have.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `PrismaCustomerUserRepository`                        | **MAL HECHO**               | 19-column snapshot upsert incl. `passwordHash`, `mfaEnabled`, `mfaSecret`, `deletedAt`; `this.prisma` at all 10 query sites, no `getClient()`; the tenant-guard throw swallowed into `EntityNotFoundError` (`:161-168`) — a security control degraded into "not found".                                                                                                                                                                                                                                                                                                                                                                                                 |
| `LoginCustomerUseCase` rehash block                   | **MAL HECHO**               | `:211-221` + `:253`; the comment documents the defect as the design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `customerAuthRoutes` wrapping                         | **ARREGLABLE**              | Two routes wrapped correctly with an explicit rationale (`:158-163`); four bare. The right pattern is in the same file. Inert `config: { rateLimit }` survives on the reset routes (`:580`, `:592`) while `:520-524` documents that inertness for login — a false assurance the file itself refutes eight lines away.                                                                                                                                                                                                                                                                                                                                                   |
| `PasswordService.confirmPasswordReset`                | **ARREGLABLE**              | `:275-289` is one statement (structurally immune to D1) and does more than the customer path attempts. Defects: missing CAS predicate; `passwordHistory` read-modify-write across `:236`/`:265`/`:270`. Two non-consuming exits (`PASSWORD_TOO_WEAK` `:247`, `PASSWORD_REUSED` `:257`) correctly leave the token usable — a naive up-front claim regresses that.                                                                                                                                                                                                                                                                                                        |
| `PrismaCustomerMfaUserRepository`                     | **BIEN — the fix template** | `getClient()` at `:39-42` resolving the UoW tx on the **same table**; `claimTotpStep` is a count-gated `updateMany` naming its claim. One directory from the defect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `PrismaUnitOfWork` / `tenantGuc` / `tenantGucBinding` | **BIEN**                    | Three branches each with a measured rationale; ownership marker held in every branch including the unbound one. The engine is correct; the opt-in rate is the problem.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Test estate                                           | **MAL HECHO**               | `customerAuthUseCases.test.ts:489-502` asserts `updatePasswordHash` called once **and** `save` called once against a stateless mock (`:56-66`) — it **certifies the bug** and stays green after any fix; constructed with no UoW (`:458`). `PrismaCustomerUserRepository.save.test.ts:26-35` is a **capture-only** fake (`calls.push(args)`) that cannot observe a clobber. `apps/client/tests/e2e/tests/auth.spec.ts:186-196` navigates to a fabricated token and asserts a banner. `security/tests/auth-security.test.ts:263-269` posts an invalid token and expects rejection — passes while the flow is dead. **Zero tests reach the guarded client on this path.** |

## 4. Scope recommendation for propose

### Ordering is the whole design (non-negotiable)

A D0-only fix makes the endpoint reachable **and its first live behaviour is the silent
revert**. The write fix must land **with** the route binding, never after.

### Options

|       | Approach                                                                                                                                                                                                                                                                                                                                            | Pros                                                                                                                                                                                       | Cons                                                                                                                                                            | Effort     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **A** | **Minimal-correct chain**: `withSystemContext` on the 4 bare handlers + collapse the customer reset to one count-gated `updateMany` claim (`where: {resetToken, resetTokenExpiry:{gt:now}, deletedAt:null}`, `data:{passwordHash, resetToken:null, resetTokenExpiry:null}`) + one token per user in D3 + `getClient()` on the adapter + 4 red tests | Closes D0/D1/D2-customer/D3 and the expiry-outside-predicate gap. Single statement ⇒ atomic without a transaction. App-layer only, **no schema, no migration, no token gate**. Reviewable. | Leaves `save()` alive for callers 2–6, so `LoginCustomerUseCase` stays armed.                                                                                   | **Medium** |
| **B** | **A + port surgery**: delete `save()`/`updatePasswordHash`, add `create(user,hash)` / `claimPasswordReset(token,hash)` / `issueResetToken(...)` / `recordLogin` / `changeRole` / `deactivate`                                                                                                                                                       | Retires the class for this table. Compiler finds all 8 sites. Omitting the hash becomes a compile error, not a silent revert.                                                              | Touches team + MFA-login use cases; `InviteTeamMemberUseCase` relies on the upsert's `create` branch; error contracts shift under 3 callers. Crosses 400 lines. | **High**   |
| **C** | **A + a fitness gate for transaction-accessor resolution** (ratchet at 71, may only fall)                                                                                                                                                                                                                                                           | Makes the canon sentence enforceable instead of aspirational; catches the fase-0 connection escape as a class.                                                                             | Needs a baseline, an ADR, and a red-path demonstration; importing an 85-file problem into a credential PR.                                                      | **High**   |

### Recommendation: **A now, B chained immediately, C filed separately**

- **A** is the smallest change that is _provable_: the endpoint becomes reachable and the
  outcome assertable in the same PR. Its correctness needs no concurrency argument — a
  single conditional statement is atomic by construction, the same reasoning that made shape
  (A) win in the MFA exploration.
- **B as PR #2 on the chain, not a backlog item.** Leaving `save()` alive keeps the footgun
  loaded and re-arms `LoginCustomerUseCase.ts:253` on the next `ARGON2_PARAMS` bump — a
  security-parameter upgrade that silently reverts itself.
- **C separately**, with its own ADR and baseline. Fase 0 raised its severity (the escape is
  now onto a second connection, not merely outside a transaction) but a 71-file ratchet does
  not belong in a credential fix.

### Does NOT enter, and why

- **MFA backup-code race** — Edward's signed order puts this change first; that one is its
  own change with its own schema decision.
- **Admin `PasswordService` CAS + `passwordHistory` race + `passwordResetToken` index** —
  different table, not tenant-guarded, zero existing tests, needs a migration. Its own slice
  immediately after.
- **Hashing reset tokens at rest / moving the token out of the emailed URL** — schema + both
  portals.
- **Rate-limit rules for the three uncovered routes** — security-config change; but
  **delete the inert `config.rateLimit` blocks in the same PR as the rule**, never before.
- **Schema** — nothing in A or B requires it. Re-verification found no schema-forcing
  defect: `resetToken @unique` already makes the claim index-backed, and the D3 fix is one
  token per user in application code.
- **SMELL-75 wiring** — except the one new integration file, which MUST be named in a
  `run_batch`.

### ADR-0020 clears the route wrapping

ADR-0020 rejects `withSystemContext` **patched per call-site** and sanctions it **declared
at a boundary** (`:63`, `:65`). A public pre-identity auth route IS a boundary, and
`customerAuthRoutes.ts:164` is the in-tree precedent. `:114` goes further and prefers a
**route-group `preHandler` seam** over N inline wraps — worth naming as a design option for
the four bare handlers.

**Design point neither prior art raised:** wrapping the _whole_ handler in
`withSystemContext` disables both tenant layers for the **write** as well as the resolving
read. The token→tenant lookup genuinely cannot be pre-scoped; the write that follows can.
Propose should decide between (i) system scope for the whole handler (simplest, matches
login) and (ii) system scope for the resolution, then re-enter `withTenantContext` for the
write. Under the single-statement claim, (i) is defensible because the predicate itself
names a globally-unique token — but that must be stated, not assumed.

## 5. Risks / unknowns for propose

1. **Sensitive paths: NONE required.** Every fix path in A and B is app-layer
   (`apps/api/src/auth/**`, `apps/api/src/infrastructure/repositories/**`,
   `packages/core/**`). No `schema.prisma`, no `infra/prisma/migrations/**`, no
   `.github/workflows/**` ⇒ **no `omnipost-allow sensitive-edit` token needed**. The
   pre-edit tripwire blocker still applies to `apps/api/src/auth/**` as a credential
   surface, and tripwire #7 (Plan Mode on `workstream/*`) applies at apply time.
2. **Duplicate change folder** — RESOLVED by the orchestrator: the 2026-08-15 exploration
   absorbed as `explore-prior-2026-08-15.md`, old folder retired.
3. **`enterWith` leakage across keep-alive requests** (`tenantContext.ts:87-89`,
   "irreversible within the current async frame", nothing clears it at response end)
   remains **unresolved by reading source**. If it leaks, some resets today run under a
   _foreign tenant's_ accountId — worse than the 400, not better. Only the integration test
   against the guarded client settles it. Carry this forward.
4. **Test doubles that mask the fix.** The stateless repo mock and the capture-only Prisma
   fake both stay green under any fix. New unit tests must fake the **Prisma client**, not
   the repository, so the real 19-column `baseData` construction runs; assert the persisted
   outcome (`verify(stored.passwordHash, newPassword) === true`), never call shape.
5. **Unnamed integration test = zero.** `tests/integration/**` is collected by nobody; the
   new file must be named in a `run_batch` in `apps/api/scripts/run-tests.sh` (fitness #30
   ratchet is 21 and may only fall; `--conditions development` comes free from `run_batch`,
   fitness #27 Part A).
6. **`txStorage` is module-level** (`PrismaUnitOfWork.ts:34`). Two module copies (the
   `dist` vs `src` resolution split fitness #27 exists to prevent) make
   `getTransactionClient()` return `undefined` silently — a green test proving nothing.
7. **Contract change:** the claim predicate cannot distinguish `TOKEN_EXPIRED` from
   `INVALID_TOKEN` without a second query, and distinguishing them is a validity oracle
   (`customerAuthRoutes.ts:449-450` surfaces two different 400s today). Collapsing is the
   security-correct answer; `apps/client` dependency is an open product question.
8. **D3 product question:** one token per account + N emails, one email listing accounts,
   or account chosen at request time? The mechanical fix is unambiguous; the UX is not.
9. **Review budget:** A alone plausibly lands under 400 authored lines; B does not.
   Forecast the chain at `sdd-tasks` under the two-tier rule (CODE 400 hard / EVIDENCE
   pre-approved per change).
