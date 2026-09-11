# Apply progress — password-reset-integrity

> **CURRENT STATUS (link 3): PR-1 and PR-2a both IMPLEMENTED. 28 of 29 PR-1 tasks and 11 of 12
> PR-2a tasks are done; the two left (8.1 and 12.1) are the gate tasks, and both belong to the
> orchestrator.** Jump to "Link 3" at the bottom for this link. Link 2 (PR-1) is kept above it,
> and Link 1's blocker record is kept underneath that because it is the evidence for why a
> sub-agent cannot clear tripwire #7 on its own, and the next person to hit that guard needs it.

---

## Link 1 — BLOCKED (preserved verbatim; the blocker was cleared by the orchestrator)

**Status: BLOCKED before the first source write. 0 of 26 tasks complete.**
**Mode: Strict TDD (resolved active; no RED was authored, because no file could be created).**

Nothing under `apps/`, `packages/`, or `infra/` was modified. The working tree is byte-identical
to the state this batch started from. The only file written anywhere is
`/root/.claude/plans/password-reset-integrity.md` (outside the repo, not committed, written as
the tripwire's own sanctioned clearance artifact).

---

## The blocker, with its evidence

`.claude/hooks-py/pre_edit_planmode_guard.py` (tripwire #7) blocks every `Write` and every
`Edit` over 30 lines on a `workstream/*` branch unless the transcript it reads contains either
an `EnterPlanMode` tool call or a `Read`/`Edit`/`Write` whose `file_path` is under
`/root/.claude/plans/*.md`.

This apply agent did both of the things the block message asks for — it wrote
`/root/.claude/plans/password-reset-integrity.md` and read it back — and was blocked again.
The reason is that the hook receives the **parent session's** transcript, not the sub-agent's.
Replaying the hook's own predicate over both files:

```
PARENT                 plan_file_ref=False enter_plan_mode=False -> hook would BLOCK
SUBAGENT(this one)     plan_file_ref=True  enter_plan_mode=False -> hook would ALLOW
```

The parent transcript's mtime is frozen at the moment this sub-agent was launched and never
receives sub-agent tool calls, so **a sub-agent structurally cannot clear this guard itself.**
`CLAUDE.md` §Mandatory Pre-Action Triggers row 7 already states the remedy and names the owner:
"clear the guard via Plan Mode activity or a `/root/.claude/plans/*.md` Read/Edit in the
(parent) transcript — a delegating orchestrator can do the latter on behalf of a sub-agent
apply." There is no env or token bypass (verified: `_common.py` reads no environment at all,
and `omnipost-allow` is not on PATH; its `sensitive-edit` token gates the _tripwire blocker_,
which is a different hook and did not fire here — it logged
`no tripwire matches` for the same write).

### What unblocks it (one action, then relaunch)

In the **orchestrator's own** turn, before relaunching `sdd-apply`:

```
Read /root/.claude/plans/password-reset-integrity.md
```

That file already exists and already describes this link's plan. Then relaunch `sdd-apply`
with the same brief. No repo state needs repair first.

### What was NOT done, deliberately

- Source was **not** written through `Bash` heredocs. That would route around the
  `PreToolUse` chain wholesale — including `pre_edit_tripwire_blocker.py` (time-bomb /
  phase-reference comment scanning) and the `post-edit` secretlint pass — to reach a result
  the gate exists to supervise. The repo canon forbids exactly this ("NEVER bypass problems
  or create workarounds").
- The change was **not** split into sub-30-line `Edit` chunks. The five NEW files this link
  needs cannot be created by `Edit` at all, and chunking the rest would be defeating the
  threshold rather than satisfying it.
- No GREEN-only partial landing. Writing production code with none of its RED tests present
  would violate strict TDD and leave an unverifiable half-change on the branch — worse than
  stopping.

---

## Task checklist — unchanged, all pending

Every task 1.1 through 8.1 in `tasks.md` remains `- [ ]`. No checkbox was flipped.

---

## Blueprint carried forward (so the relaunch does not re-derive it)

All of the following was verified against the working tree during this batch. It is recorded
so the next launch spends its budget writing rather than re-reading.

### Confirmed facts

| Fact                                                                                                 | Evidence                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch is correct                                                                                    | `.git/HEAD` -> `refs/heads/workstream/password-reset-integrity`                                                                                                                                                                                                                                                      |
| `tenantGuardCheck` is exported standalone for unit use                                               | `infra/prisma/src/extensions/tenantGuard.ts:182`; already imported by `apps/api/tests/unit/saga/sagaPersistence.column.test.ts` via `@infra/prisma/extensions/tenantGuard.js`                                                                                                                                        |
| `updateMany` is a guarded WHERE operation                                                            | `tenantGuard.ts:155-169`                                                                                                                                                                                                                                                                                             |
| `account` is NOT tenant-enrolled (`accountCredential`/`accountOnboarding`/`accountSubscription` are) | `tenantGuard.ts:91-96`                                                                                                                                                                                                                                                                                               |
| `getClient()` template                                                                               | `apps/api/src/infrastructure/adapters/PrismaCustomerMfaUserRepository.ts:40-42` (note: `adapters/`, NOT `repositories/` — the design's path shorthand resolves here)                                                                                                                                                 |
| Vitest collects `tests/unit/**/*.test.ts` only                                                       | `apps/api/vitest.config.ts:46` — so `tests/unit/helpers/*.ts` is a helper, never collected as a suite                                                                                                                                                                                                                |
| Test files are outside `tsc -b` scope                                                                | `apps/api/tsconfig.json` includes `src` + packages only; `tsconfig.type-tests.json` covers only `*.type-test.ts`. A stale `TOKEN_EXPIRED` assertion therefore fails at RUNTIME, not at compile time — the design's "stops type-checking" wording overstates the mechanism, and the test must be rewritten regardless |
| Type-aware lint is scoped to `apps/api/src/{domain,application}`                                     | `eslint.config.ts:16-18,172-183` — test files get non-type-aware lint                                                                                                                                                                                                                                                |
| `@core/customer-auth` has NO logger dependency                                                       | its `package.json` lists only `@core/application`, `@core/domain`, `@ports/core`, `@shared/types`; `packages/core/customer-auth/node_modules/` confirms strict pnpm isolation                                                                                                                                        |
| `authLogger` is available inside `apps/api`                                                          | `apps/api/src/lib/logger.ts:98`                                                                                                                                                                                                                                                                                      |
| `sendError` already logs                                                                             | `BaseRouteHandler.ts:279` calls `this.logError(...)`                                                                                                                                                                                                                                                                 |
| Integration wiring precedent                                                                         | `tests/integration/preAuthIntegrationTenantIsolation.test.ts:94-120` (guarded client + `Container` + `app.decorate("container", …)` + `app.inject`); `projectMemberTenantIsolation.test.ts:114-118` for `base.$extends(tenantGuardExtension({getTenantContext, getSystemContext}))`                                  |
| `run_batch` insertion point                                                                          | `apps/api/scripts/run-tests.sh:273` is the `integration:tenant-isolation` line; the new batch goes beside it inside the `run_db_batches` block                                                                                                                                                                       |

### Decisions taken during this batch (carry them, do not re-litigate)

1. **Surfacing the per-row `issueResetToken` failure without a new dependency.** The spec allows
   "returned **or** logged". Logging from `packages/core/customer-auth` would require adding
   `@observability/logger` to that package plus a `pnpm install` and a lockfile change — cost the
   design never budgeted. Instead: `RequestPasswordResetUseCase` returns the diagnostic on its
   `ok` value (e.g. `{ message, unpersistedCount }`), and `customerAuthRoutes.requestPasswordReset`
   projects a CONSTANT body (`{ message }`) and emits one `authLogger.warn` when the count is
   non-zero. This is strictly stronger for anti-enumeration than today's shape, because the
   uniform silhouette becomes a property of the transport rather than a value the use case must
   remember to keep identical. It is also directly unit-observable.
2. **The adapter's `INTERNAL_ERROR` is logged, not silent.** `claimPasswordReset` /
   `issueResetToken` catch blocks call `authLogger.error(...)` before returning `INTERNAL_ERROR`,
   satisfying the `tenant-context-boundaries` ADDED requirement that a context failure "SHALL be
   observable in logs as a context failure". `authLogger` comes from `apps/api/src/lib/logger.ts`,
   so fitness #13 is satisfied and no dependency changes.
3. **The unit harness is guard-wired.** `createStatefulCustomerUserPrismaFake()` routes every
   delegate operation through the REAL `tenantGuardCheck` with the REAL
   `{ getTenantContext, getSystemContext }` provider. This is what makes task 2.4 a genuine
   proof rather than a simulation: running the confirm with a VALID token and NO context makes
   the fake throw a real `TenantContextMissingError`, and the assertion is that the surfaced
   failure is `INTERNAL_ERROR`, never `INVALID_TOKEN`.
4. **The leak-immunity probe is stronger than a keep-alive agent, and says so.** `app.inject`
   has no socket, so "same socket" is not expressible. Instead, bind tenant A with
   `enterTenantContext({accountId: A})` and issue the tenant-B confirm inside that SAME async
   frame — `enterWith` is irreversible within the frame, so the leaked tenant context is
   GUARANTEED present rather than hoped for. The assertion is that the wrap still claims B's row
   (system wins over tenant in both layers) and that a guarded read after the inject still scopes
   to A (no forward system leak). The test comment must state that under the wrap leak and
   no-leak are observationally identical, so this is a regression oracle for the wrap, not an
   answer to whether `enterWith` leaks.
5. **Register's D0 shape.** `RegisterCustomerUseCase` needs `customerRoleRepo.getSnapshotByName("OWNER")`.
   `CustomerRole.name` is `@unique` (`schema.prisma:147`) and `customerRole` is NOT tenant-enrolled,
   so the suite can `upsert` an OWNER role on the seed channel in `before()` and remove it in
   `after()` only if it created it. With that, register's D0 is the full happy path asserting 201.
   If that proves fragile, the fallback shape is a duplicate-email 409, which still forces
   `findByEmailAcrossAccounts` (the exact context-miss point) to complete — today it is a 500.

### File-by-file work remaining

| File                                                                       | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/tests/unit/helpers/statefulCustomerUserPrismaFake.ts`            | NEW. Map-backed `customerUser` delegate with real merge semantics, predicate evaluation (`gt`/`gte`/`lt`/`lte`/`in`/`not`/`equals`, `null`), `{count}` from `updateMany`, rows carrying `customerRole: null`, a `failWritesFor(userId)` switch, and every op routed through `tenantGuardCheck`. Unknown column or unsupported operator THROWS (fail closed). ~330 lines; the full text was composed this batch and is reproducible from this description. |
| `apps/api/tests/unit/customerPasswordResetClaim.test.ts`                   | NEW — tasks 2.1-2.4. Real adapter over the fake, run inside `withSystemContext` except for 2.4.                                                                                                                                                                                                                                                                                                                                                           |
| `apps/api/tests/unit/customerPasswordResetRequest.test.ts`                 | NEW — task 2.5.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/api/tests/integration/customerPasswordReset.integration.test.ts`     | NEW — tasks 3.1-3.7, node:test, guarded client, `app.inject`.                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/api/scripts/run-tests.sh`                                            | EDIT at ~`:273`: add `CONCURRENCY=1 run_batch "integration:customer-auth" \` naming the new file. Same commit as the file.                                                                                                                                                                                                                                                                                                                                |
| `packages/core/domain/src/repositories/CustomerUserRepository.ts`          | EDIT: +`claimPasswordReset(token, newPasswordHash) -> Result<void, "INVALID_TOKEN" \| "INTERNAL_ERROR">`, +`issueResetToken(userId, token, expiresAt) -> Result<void, "USER_NOT_FOUND" \| "INTERNAL_ERROR">`, with JSDoc. Delete nothing here.                                                                                                                                                                                                            |
| `apps/api/src/infrastructure/repositories/PrismaCustomerUserRepository.ts` | EDIT: import `Prisma` + `PrismaUnitOfWork` (`../unitofwork/PrismaUnitOfWork.js`); add `private getClient()`; route the 10 existing sites (`:68 :86 :103 :111 :120 :133 :153 :207 :229 :246`) through it; add the 2 impls. Keep `save` / `updatePasswordHash` / `findByResetToken` — those die in the next link.                                                                                                                                           |
| `packages/core/customer-auth/src/ResetPasswordUseCase.ts`                  | EDIT: single-claim rewrite; delete `:50`, `:58-60`, `:67`, `:74`; drop `TOKEN_EXPIRED` from the union at `:13-14`.                                                                                                                                                                                                                                                                                                                                        |
| `packages/core/customer-auth/src/RequestPasswordResetUseCase.ts`           | EDIT: token generated INSIDE the loop, persisted via `issueResetToken`, failures collected; optional 5th ctor param `accountQueryRepo?: AccountQueryRepositoryPort`; one send with N labelled links; HTML-escape the account name before interpolating it into the `html` body.                                                                                                                                                                           |
| `apps/api/src/infrastructure/container/setupCustomerAuthUseCases.ts`       | EDIT at `:136-146`: pass `container.resolve(TOKENS.AccountQueryRepository)` (token exists, `types.ts:45`).                                                                                                                                                                                                                                                                                                                                                |
| `apps/api/src/auth/customerAuthSystemReasons.ts`                           | NEW. Four exported constants in the `system:customer-*` form, modelled on `webhookJobProcessor.ts:16-23`.                                                                                                                                                                                                                                                                                                                                                 |
| `apps/api/src/auth/customerAuthRoutes.ts`                                  | EDIT: wrap `:117`, `:354`, `:413`, `:442` in `withSystemContext(<constant>, () => …)` with the `:158-163` rationale form; delete the `TOKEN_EXPIRED` row at `:450`; project a constant body in `requestPasswordReset` and warn on a non-zero unpersisted count.                                                                                                                                                                                           |
| `apps/api/tests/unit/customerAuthUseCases.test.ts`                         | EDIT: rewrite the whole `ResetPasswordUseCase` describe (`:451-513`) onto persisted outcomes; REWRITE (never delete) the expiry test at `:475-487` to assert `INVALID_TOKEN` from the claim predicate; rewrite the `save`-count assertion at `:440-448`; update `makeCustomerUserRepo` (`:56-66`) to the new port shape.                                                                                                                                  |

### Traps worth naming for whoever writes this

- `makeCustomerUserRepo()` in `customerAuthUseCases.test.ts` is a bare object literal, not
  `as unknown as CustomerUserRepository`. It compiles today only because that file is outside
  every `tsc` project. Adding port methods will NOT break it at build time; it breaks at
  runtime when the use case calls a method the double lacks.
- `packages/core/customer-auth/tests/unit/*.test.ts` doubles ARE cast
  (`as unknown as CustomerUserRepository`), so the port addition cannot break them.
- `explore.md` risk 6 is live: `txStorage` is module-level, so a `dist` vs `src` resolution
  split makes `getTransactionClient()` return `undefined` silently. Under vitest the workspace
  alias map resolves to `src`, and `run_batch` supplies `--conditions development` for node:test,
  so both tiers land on `src` — but any manual single-file run must carry
  `--conditions development` or 3.7 goes green while proving nothing.
- Comment hygiene for the tripwire blocker: no `Phase <n>`, no `§n.n`, no `Sprint`, and none of
  the 20 bilingual time-bomb words, anywhere in the new comments.

---

## Next recommended

`sdd-apply` again, after the orchestrator performs the one-line unblock above. Nothing about the
plan changed; this batch simply never reached the point of writing source.

---

# Link 2 — PR-1 IMPLEMENTED

**Status: 28 of 29 PR-1 tasks complete (1.1 → 7.3). Task 8.1 (the 0-defect gate) is deliberately
left unchecked — it belongs to the orchestrator.**
**Mode: Strict TDD (resolved active, and followed: every behavioural task was authored RED and
observed red on the unmodified tree before its GREEN counterpart).**

The blueprint link 1 carried forward was used as written. Two of its recorded facts were load-bearing
and saved a re-derivation each: the `getClient()` template really is under `adapters/` (not
`repositories/`), and a stale `TOKEN_EXPIRED` assertion fails at RUNTIME, not at compile time,
because no `tsc` project includes the test files.

**A note on the task count.** The launch brief said "26 tasks". The file holds **29** in PR-1
(1.1 · 2.1–2.5 · 3.1–3.8 · 4.1–4.4 · 5.1–5.4 · 6.1–6.3 · 7.1–7.3 · 8.1). All 28 non-gate tasks are
done; the brief's number was simply short by three.

## TDD Cycle Evidence

| Task            | RED (observed on the unmodified tree)                                                            | GREEN                                    | REFACTOR                                                     |
| --------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| 1.1             | n/a — harness                                                                                    | fake drives the real adapter             | unique indexes moved onto UPDATES too (see "Corrections")    |
| 2.1             | `result.ok` PASSED, then `argon2.verify(stored, NEW)` → `false !== true` — the green-looking red | 5.1                                      | —                                                            |
| 2.2             | `exactly ONE confirm may succeed: 2 !== 1`                                                       | 5.1 (count gate)                         | —                                                            |
| 2.3             | `+ 'TOKEN_EXPIRED' - 'INVALID_TOKEN'`                                                            | 5.1 + 4.2                                | soft-deleted half passed pre-fix; kept as a regression guard |
| 2.4             | `INVALID_TOKEN` surfaced for a MISSING CONTEXT with a valid token                                | 4.2 (`INTERNAL_ERROR` + `authLogger`)    | —                                                            |
| 2.5             | rows 2–3 carried no token (the unique collision); `unpersistedCount` absent                      | 5.2 / 5.3                                | —                                                            |
| 3.1             | **500 `TENANT_CONTEXT_MISSING` · 401 · 500 · 400** — the four documented shapes, exactly         | 6.1 / 6.2                                | —                                                            |
| 3.2             | `{"ok":false,"error":"Invalid or expired reset token"}`                                          | 5.1                                      | —                                                            |
| 3.3             | `exactly one confirm may succeed — got 400/400`                                                  | 4.2 (DB decides)                         | —                                                            |
| 3.4             | valid token also 400 — uniformity was vacuous pre-fix                                            | 6.3                                      | added the non-vacuity probe (see "Corrections")              |
| 3.5             | `{"ok":false,"error":"Internal server error"}`                                                   | 5.2                                      | —                                                            |
| 3.6             | `B's token must claim B's row ... got 400`                                                       | 6.2                                      | `enterTenantContext` contained in a `.run()` frame           |
| 3.7             | both hashes printed — the base-client write SURVIVED the rollback                                | 4.4 (`getClient()`)                      | —                                                            |
| 3.8             | n/a — batch wiring, landed in the same edit as 3.1                                               | fitness #30 re-measured at 21            | —                                                            |
| 4.x/5.x/6.x/7.x | covered by the reds above                                                                        | see the per-phase evidence in `tasks.md` | —                                                            |

## Work Unit Evidence

| Evidence          | Value                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test      | `vitest run tests/unit/customerPasswordResetClaim.test.ts tests/unit/customerPasswordResetRequest.test.ts tests/unit/customerAuthUseCases.test.ts` → **3 files, 38/38 pass**                                                                  |
| Runtime harness   | `TIER=pr-integration pnpm --filter @apps/api test:integration` → **496 tests, 496 pass, 0 fail, 0 cancel, 0 skip, exit 0**, incl. `integration:customer-auth` **12/12** and `integration:tenant-isolation` **246/246**                        |
| Database state    | Out-of-band read on a SEPARATE client (not the suite's): `{leftover_customerUser:0, leftover_account:0, leftover_resetTokens:0, leftover_roles:0}`                                                                                            |
| Rollback boundary | One revert of this link returns the four endpoints to today's fail-closed dead state. Unclaimed tokens are inert, so there is nothing to unwind. No schema, no migration, no env, no workflow was touched — Migration/Rollout stays **None**. |

## Gate readings (8.1 inputs, collected but NOT checked off)

- **TSC** `pnpm --filter @apps/api exec tsc -b` → exit **0**
- **LINT** over `apps packages infra` with `--max-warnings 0` → exit **0**
- **format:check** → clean over every tracked file
- Fitness **#1 #2 #3 #4 #5 #8 #9 #10 #21 #23 #27A #31A #32 #38(swept) #40(A+B)** → all **0**;
  **#31B** guards present (2 and 1); **#30** ratchet **21, unchanged**; **#38** db-prisma ratchet
  **11, unchanged**; **#40** floors held (seams 3, sites 13)

## Corrections made to the plan while implementing (named, not absorbed)

1. **The fake had to enforce unique indexes on UPDATES, not only on inserts.** The blueprint
   described insert-time uniqueness. But `resetToken` is globally `@unique`, and the D3 defect is a
   collision produced by an UPDATE (`save`/`issueResetToken` writing one shared token onto a second
   row). A fake that checked only inserts would have let that write succeed and would have
   CERTIFIED the collision as working. Uniqueness is now evaluated against the resulting row for
   every write path.
2. **Task 3.4's uniformity claim was vacuous as specified.** Pre-fix, _every_ confirm answers
   `400 "Invalid or expired reset token"` — including a perfectly valid token — so "all four
   unusable-token classes are identical" PASSED on the broken tree for the wrong reason. A fifth
   confirm with a LIVE token, required to answer 200 in the same run, was added to the same test.
   Without it the assertion is satisfied by a totally dead endpoint.
3. **Per-row failure surfacing took the return-not-log shape** the blueprint chose:
   `RequestPasswordResetUseCase` returns `{ message, unpersistedCount }` and the route projects a
   CONSTANT body plus one `authLogger.warn`. `packages/core/customer-auth` gains no logger
   dependency, and the anti-enumeration silhouette becomes a property of the transport rather than
   a value the use case must remember to keep identical.
4. **The leak probe binds tenant A with `enterTenantContext` INSIDE a `withTenantContext` frame.**
   `app.inject` has no socket, so "the same keep-alive connection" is not expressible; the
   irreversible primitive inside a `.run()` frame GUARANTEES the foreign context is present when
   B's confirm executes, and confines that irreversibility to the one test. The test comment states
   that under the wrap leak and no-leak are observationally identical, so the probe is a regression
   oracle for the wrap — not an answer to whether `enterTenantContext` leaks.
5. **D0 reachability is asserted directly, not only by proxy.** A context miss is recorded at the
   PROVIDER (the exact branch where `tenantGuardCheck` is about to throw) rather than by stacking a
   second Prisma extension, so extension composition order cannot silently change what the probe
   sees. Each D0 test asserts both the contract response AND `contextMisses === []`.
6. **The adapter logs write failures by NAME and CODE only.** A driver message can echo the
   offending value, and on this path the offending value is a reset token. `TENANT_CONTEXT_MISSING`
   on `code` is what keeps a fail-closed security signal distinguishable in the logs while the
   caller's response deliberately cannot distinguish it.

## Deviations from design

None. Every binding decision (D-1 whole-handler wraps, D-2 exactly two port methods in final form,
D-3 `getClient()` scoped to this adapter's 10 sites, D-4's PR-1 error contracts, D-5's one e-mail
with N labelled links) is implemented as written. The six items above are refinements INSIDE those
decisions, not departures from them.

## Findings for the orchestrator

- **`pnpm lint` fails locally on 5 `no-console` errors in `.config/opencode/plugins/*.ts`.** Those
  files are NOT part of this change and NOT part of the repo: `.gitignore:187` ignores `.config/`,
  so CI never checks them out and never sees them. `eslint.config.ts`'s `ignores` list does not
  exclude `.config/`, which is why a local full-repo lint goes red while CI is green. Linting a
  gitignored path is meaningless, so the honest fix is one line in the eslint `ignores` — but that
  is a config change with nothing to do with password reset, and slipping it into this PR would be
  scope creep. Filed here for a decision rather than acted on. Lint over `apps packages infra` is
  exit 0.
- **Four markdown artifacts under this change failed `format:check`** (`explore.md`, `proposal.md`,
  `specs/tenant-context-boundaries/spec.md`, and this file). They were the only unformatted
  markdown under `openspec/`, so the convention is clearly formatted markdown and this was the
  change's own debt. Prettier-formatted — whitespace and table padding only, no content edited.

## Files changed

| File                                                                       | Action   | What                                                                                    |
| -------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `apps/api/tests/unit/helpers/statefulCustomerUserPrismaFake.ts`            | Created  | Guard-wired Map-backed `customerUser` delegate with real merge + unique-index semantics |
| `apps/api/tests/unit/customerPasswordResetClaim.test.ts`                   | Created  | Claim outcomes over the REAL adapter; context-failure-is-not-a-token-verdict            |
| `apps/api/tests/unit/customerPasswordResetRequest.test.ts`                 | Created  | Per-row tokens, one e-mail, escaping, per-row failure surfacing                         |
| `apps/api/tests/integration/customerPasswordReset.integration.test.ts`     | Created  | D0 ×4, D1, D2, one-failure-code, D3, leak immunity, UoW rollback                        |
| `apps/api/src/auth/customerAuthSystemReasons.ts`                           | Created  | The four exported `system:customer-*` reason constants                                  |
| `apps/api/scripts/run-tests.sh`                                            | Modified | `CONCURRENCY=1 run_batch "integration:customer-auth"` naming the new file               |
| `packages/core/domain/src/repositories/CustomerUserRepository.ts`          | Modified | +`claimPasswordReset`, +`issueResetToken` (final form, JSDoc). Nothing deleted.         |
| `apps/api/src/infrastructure/repositories/PrismaCustomerUserRepository.ts` | Modified | `getClient()` + `logWriteFailure()`; 10 sites routed; the 2 impls                       |
| `packages/core/customer-auth/src/ResetPasswordUseCase.ts`                  | Modified | Single-claim rewrite; `TOKEN_EXPIRED` dropped from the union                            |
| `packages/core/customer-auth/src/RequestPasswordResetUseCase.ts`           | Modified | Per-row tokens, one labelled multi-account e-mail, `unpersistedCount`                   |
| `apps/api/src/infrastructure/container/setupCustomerAuthUseCases.ts`       | Modified | Resolves `TOKENS.AccountQueryRepository` into the request use case                      |
| `apps/api/src/auth/customerAuthRoutes.ts`                                  | Modified | 4 `withSystemContext` wraps; `TOKEN_EXPIRED` map row deleted; constant request body     |
| `apps/api/tests/unit/customerAuthUseCases.test.ts`                         | Modified | Reset describe rewritten onto persisted/shape outcomes; double updated                  |
| `openspec/changes/password-reset-integrity/tasks.md`                       | Modified | 28 boxes checked, per-phase evidence added                                              |

## Next recommended

`sdd-verify`. PR-1 is implemented and self-consistent; the 8.1 gate reading above is collected but
the checkbox is the orchestrator's to flip. PR-2a is the next apply link and is unblocked by this
one (its port methods are additive; nothing here is reworked by it).

## Orchestrator amendment — fresh-gate outcome and post-gate additions (2026-09-12 night)

The fresh gate over this candidate returned **PASS WITH WARNINGS (0 CRITICAL / 2 WARNING /
4 SUGGESTION)**, independently re-running the batch (496/496), tsc, eslint, and the fitness
spot-set, and covering 10/10 PR-1 requirements / 31/31 scenarios against the tests. Dispositions:

1. **Native `blocked(edit_authority_missing)` — RESOLVED as artifact parsing, no consent
   needed.** The blocked path was `"/"`: six backticked HTTP ROUTES in `tasks.md`
   (`/me`, the reset endpoints, the forgot-password page) parsed as absolute edit paths at
   root. Rewritten as what they are (`GET /me`, `POST /reset-password`, prose for the page);
   `sdd-status` now reads `next: apply`, 0 blocked reasons. The consent/v1 envelope died with
   the fix — nothing was granted, nothing needed granting.
2. **WARNING 1 — CODE measured 510 vs the 400 hard budget (forecast 250–280) — FLAGGED FOR
   EDWARD'S MORNING RULING, not absorbed.** Breakdown per the gate: 167 of 385 added lines
   are canon-mandated JSDoc (non-comment CODE ≈ 343); concentration in
   `RequestPasswordResetUseCase.ts` (172 vs ~90 allotted — the multi-account email
   composition). Under auto-chain the night continues to commit; Edward rules
   accept-vs-refactor BEFORE push. No `size:exception` is recorded — the ruling is his.
3. **SUGGESTION 1 — bookkeeping precision**: the integration file holds **12** tests; the
   red capture above says "11/11 RED" because the leak-immunity probe's second assertion was
   split into its own `it()` during authoring — final green is **12/12**, all within the
   batch's 496/496.
4. **SUGGESTION 2**: the deletion of `openspec/changes/customer-credential-write-integrity/`
   is a pure RENAME (byte-identical content lives at this change's
   `explore-prior-2026-08-15.md`) — named here and owed a line in the PR body.
5. **SUGGESTION 3 — latent, NAMED with an owner**: `RequestPasswordResetUseCase.doWork()`
   `continue`s past a per-row failure inside one UoW transaction, but PostgreSQL aborts the
   whole transaction on a failed statement — the unit fake has no transaction semantics, so
   the continue-path is only proven fake-deep. Spec obligations hold either way (a cascaded
   failure still emails no unpersisted link and the response stays uniform). Owner: PR-2a
   revisits the loop when it touches this use case's neighbourhood; if PR-2a does not reach
   it, it goes to the backlog with this paragraph.
6. **Post-gate addition (stop-hook)**: `apps/api/tests/unit/auth/customerAuthSystemReasons.test.ts`
   (+50 EVIDENCE, tree-collected) — pins the four constants' exact values, the bounded
   fixed-set grammar no interpolation can match, and non-duplication. 3/3 green; prettier and
   eslint clean. Landed after the gate's snapshot; trivially inspectable.

---

# Link 3 — PR-2a IMPLEMENTED

**Status: 11 of 12 PR-2a tasks complete (9.1 → 11.4). Task 12.1 (the 0-defect gate) is
deliberately left unchecked — it belongs to the orchestrator.**
**Mode: Strict TDD (resolved active, and followed: 9.1–9.5 were authored and observed RED on the
tree PR-1 left behind, before a single production line of this link was written).**

PR-1's tasks (1.1 → 7.3) stay complete and untouched; 8.1 stays the orchestrator's. Nothing in
this link reworked a PR-1 seam — it added, deleted the orphan, and migrated callers, exactly as
the design's "PR-2 deletes, never reworks" instruction requires.

## TDD Cycle Evidence

| Task | Test file                                                                    | Layer       | Safety net                          | RED (observed on the tree as PR-1 left it)                                                                                                              | GREEN       | Triangulate                                                              | Refactor                  |
| ---- | ---------------------------------------------------------------------------- | ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------ | ------------------------- |
| 9.1  | `tests/unit/infrastructure/repositories/customerUserWriteInvariants.test.ts` | Unit        | 46/46 api + 29/29 customer-auth     | `TypeError: repo.create is not a function` (and `recordLogin` / `upgradePasswordHash` / `changeRole` / `deactivate`) — **14 failed / 6 passed, exit 1** | 10.1 + 10.2 | 6 table rows × 2 fixtures (live + soft-deleted)                          | shared `updateOneLiveRow` |
| 9.2  | same                                                                         | Unit        | same                                | same five names, on the soft-deleted fixture                                                                                                            | 10.2        | every command, plus the create-over-a-deleted-pair case                  | —                         |
| 9.3  | same                                                                         | Unit        | same                                | the live half was red through the missing methods                                                                                                       | 10.2        | declared-set disjointness + observed diff                                | —                         |
| 9.4  | same                                                                         | Unit        | same                                | `TypeError: repo.recordLogin is not a function`                                                                                                         | 10.2 + 11.1 | ➖ single behaviour                                                      | —                         |
| 9.5  | `tests/integration/customerPasswordReset.integration.test.ts`                | Integration | 12/12 pre-existing in the same file | login answered **200** and the row still held `$argon2id$v=19$m=19456,t=2,p=1$…`, **byte-identical** to the pre-login hash                              | 11.1        | paired with `needsRehash(stored) === false` and a non-null `lastLoginAt` | —                         |

9.5's red is the whole reason this link exists and it was measured, not argued: a
security-parameter upgrade wrote itself and was then put back by the snapshot save, while the
endpoint reported success.

## Work Unit Evidence

| Evidence          | Value                                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test      | `vitest run tests/unit/infrastructure/repositories/customerUserWriteInvariants.test.ts` → **20/20 pass**                                                                                                                                                                                       |
| Runtime harness   | DBUP + `TIER=pr-integration pnpm --filter @apps/api test:integration` → **497 tests, 497 pass, 0 fail, 0 cancel, 0 skip**, incl. `integration:customer-auth` **13/13** and `integration:tenant-isolation` **246/246**                                                                          |
| Database state    | Out-of-band read in a SEPARATE process on its own client: `{leftover_customerUser:0, leftover_account:0, leftover_resetTokens:0, leftover_roles:0}`                                                                                                                                            |
| Rollback boundary | One revert restores the five port declarations, their adapter bodies, the orphaned `findByResetToken`, and the three caller edits together. `save()` is still present on the port, so every caller compiles on revert — which is precisely why the callers seam was chosen as the split point. |

## Gate readings (12.1 inputs, collected but NOT checked off)

- **TSC** `pnpm --filter @apps/api exec tsc -b` → exit **0**
- **LINT** `eslint apps packages infra --max-warnings 0` → exit **0**
- **format** `prettier --check` over all eleven touched files → clean
- Unit: `apps/api` **566 files / 8,795 tests, all pass**; `@core/customer-auth` 29/29;
  `@core/team` 3/3; `@core/domain` 55/55
- Fitness **#2 #3 #4 #5 #8 #9 #10 #21 #23 #31A #32 #38(swept) #40(A violations, B underived)** →
  all **0**; **#31B** guards present (2 and 1); **#30** ratchet **21, unchanged**; **#38**
  db-prisma ratchet **11, unchanged**; **#40** floors held (seams 3, sites 13)

## Measured CODE / EVIDENCE split

Measured by edit accounting (additions + deletions, git-diff semantics) — this writer never runs
git, so the numbers are derived from the exact spans replaced rather than from `git diff --stat`.
The orchestrator should confirm them against the real diff before they reach the PR body.

| Tier         | File                                            | Changed  |
| ------------ | ----------------------------------------------- | -------- |
| **CODE**     | `CustomerUserRepository.ts` (port)              | 83       |
| **CODE**     | `PrismaCustomerUserRepository.ts`               | 133      |
| **CODE**     | `LoginCustomerUseCase.ts`                       | 46       |
| **CODE**     | `CompleteCustomerMfaLoginUseCase.ts`            | 47       |
| **CODE**     | `RegisterCustomerUseCase.ts`                    | 15       |
| **CODE**     | **total**                                       | **324**  |
| **EVIDENCE** | `customerUserWriteInvariants.test.ts` (new)     | 500      |
| **EVIDENCE** | `customerPasswordReset.integration.test.ts`     | ~118     |
| **EVIDENCE** | `customerAuthUseCases.test.ts`                  | ~14      |
| **EVIDENCE** | `onboarding/onboarding.test.ts`                 | 2        |
| **EVIDENCE** | `LoginCustomerUseCase.test.ts` (pkg)            | ~8       |
| **EVIDENCE** | `CompleteCustomerMfaLoginUseCase.test.ts` (pkg) | ~8       |
| **EVIDENCE** | **total**                                       | **~650** |

**CODE is inside the 400 hard budget (324) but over its own 190–230 forecast.** The gap is
almost entirely canon-mandated JSDoc: of the 78 added port lines, **64 are comment**; of the 89
added adapter-method lines, 21 are; of the 24-line P2002 helper, 9 are. Non-comment CODE is
**≈205**, which lands inside the forecast — so the forecast was evidently a non-comment estimate
and the budget is a changed-line one. Named rather than absorbed, and **no `size:exception` is
requested**: the link is inside the hard budget either way.

**EVIDENCE measured ~650 against a ~310 forecast.** One file drives it: the invariant suite is
500 lines because the authority criterion is three separate claims (completeness, exclusivity,
no side channel) and exclusivity is only worth anything if the writer list is written down per
shared column. Flagged for Edward under the two-tier rule, which pre-approves the EVIDENCE tier
for the change as a whole.

## Decisions taken while implementing (named, not absorbed)

1. **`findByResetToken` was DELETED here, not carried to PR-2b.** The launch brief said all three
   of `save` / `updatePasswordHash` / `findByResetToken` survive this link. `tasks.md` says the
   opposite about the third one, in three places (the split description, 10.1 and 10.2), and the
   design's File-Changes row assigns the adapter deletion to PR-2 as well. The tasks artifact is
   the binding one and is self-consistent, so the orphan is gone: `rg 'findByResetToken'` returns
   **zero** across the tree. `save` and `updatePasswordHash` DO survive, with zero credential
   callers — `save` keeps exactly the three team callers PR-2b migrates.
2. **`recordLogin`'s failure is fatal to the login, not merely logged.** The task says "with its
   `Result` **checked** (today it is discarded)", and the only honest reading of a check is that
   it changes an outcome. `USER_NOT_FOUND` at that point means no LIVE row matched at the instant
   of the stamp — the account stopped existing mid-login — and minting a session afterwards would
   outlive its owner. `CompleteCustomerMfaLoginUseCase` already failed closed on exactly this
   signal before this change, so the two halves of the same login now agree rather than diverge.
3. **The rehash write itself stays best-effort.** It is the pre-existing documented decision and
   the spec's requirement is that a landed upgrade SURVIVES, not that a failed one denies the
   login. The discard is now explicit and explained at the call site instead of implicit.
4. **`create`'s P2002 mapping is narrow.** `EMAIL_EXISTS` is returned only when the collided
   constraint names the e-mail; a row-id or invite-token collision stays `INTERNAL_ERROR`. A
   blanket P2002 → `EMAIL_EXISTS` would tell a caller something false about what failed. The
   e-mail-verification token cannot be the matching constraint because it is not in the creation
   projection.
5. **`issueResetToken` was NOT refactored onto the new shared `updateOneLiveRow`,** even though
   its body is now a duplicate of it. The design states PR-1's seams are final and PR-2 deletes
   rather than reworks; collapsing a PR-1 body would put an already-reviewed line back in front
   of a reviewer for no behavioural reason. The duplication is named here so PR-2b can decide it
   deliberately rather than inherit it silently.
6. **The stale-hash fixture forces `needsRehash`, it does not change production parameters.** The
   integration seed hashes at `m=19456,t=2,p=1` so `needsRehash` against the canonical
   `ARGON2_PARAMS` is true. `apps/api/src/auth/passwordHashing.ts` is untouched; a canon-decision
   advisory fired on the parameter literal and is answered here — the literal exists only to
   build a stale fixture, which the spec explicitly requires ("the test SHALL force that
   condition rather than wait for a production bump").
7. **The login use case is now genuinely wired in the integration suite** (it used to be an
   `unexercised` placeholder). The brute-force gate and the MFA challenge store are admissive
   doubles: neither participates in the persistence outcome under test, and using the real Redis
   adapters would make a credential-persistence assertion depend on a cache being up.

## PostgreSQL-cascade latent finding (orchestrator amendment item 5) — OWNERSHIP JUDGMENT

**This link did NOT reach that neighbourhood, so per the amendment's own terms it goes to the
backlog with its paragraph.**

The finding is about `RequestPasswordResetUseCase.doWork()` continuing past a per-row failure
inside one UoW transaction while PostgreSQL aborts the whole transaction on a failed statement.
PR-2a's assigned phases touch the port, the adapter, and the three CREDENTIAL callers (Login,
CompleteMfa, Register). `RequestPasswordResetUseCase` is not among them and was not opened; the
write it calls, `issueResetToken`, is a PR-1 seam this link deliberately left byte-identical
(decision 5 above). Reaching in to change its loop would have meant editing a use case no task in
this link names, on the strength of a conditional, which is how scope creep gets laundered into
a PR.

Backlog entry, carried verbatim so nothing is lost: _`RequestPasswordResetUseCase.doWork()`
`continue`s past a per-row failure inside one UoW transaction, but PostgreSQL aborts the whole
transaction on a failed statement — the unit fake has no transaction semantics, so the
continue-path is only proven fake-deep. Spec obligations hold either way (a cascaded failure
still e-mails no unpersisted link and the response stays uniform)._ Saved to engram alongside
this link's record.

## Deviations from design

None. D-4's port surface is implemented exactly as tabled — signatures, Prisma shapes and error
contracts — including the gate-accepted `upgradePasswordHash` divergence with its
only-sanctioned-caller JSDoc. The authority criterion is implemented as D-4 describes it: a
table-driven test diffing the fake's row before and after each method and asserting
changed-column-set equality.

## Issues found

- **The launch brief and `tasks.md` disagree about `findByResetToken`.** Resolved in favour of
  `tasks.md` (decision 1). Flagged so the orchestrator can confirm rather than discover it in
  review.
- **`apps/api/tests/integration/customerPasswordReset.integration.test.ts` still calls
  `repo.updatePasswordHash`** in the UoW-rollback probe, as a vehicle for "a write through the
  adapter". It is a harness call, not a credential caller, so the link's exit condition holds —
  but PR-2b deletes that method and will have to move the probe onto `upgradePasswordHash`.

## Files changed

| File                                                                                  | Action   | What                                                                                                                                           |
| ------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/tests/unit/infrastructure/repositories/customerUserWriteInvariants.test.ts` | Created  | The authority criterion as a table: declared write sets, pinned writer lists, soft-delete and MFA guards                                       |
| `packages/core/domain/src/repositories/CustomerUserRepository.ts`                     | Modified | +5 intent declarations with JSDoc; `findByResetToken` declaration deleted                                                                      |
| `apps/api/src/infrastructure/repositories/PrismaCustomerUserRepository.ts`            | Modified | +`create` (genuine create, narrow P2002 mapping), +4 count-gated commands via `updateOneLiveRow`; `findByResetToken` impl deleted              |
| `packages/core/customer-auth/src/LoginCustomerUseCase.ts`                             | Modified | Rehash → `upgradePasswordHash`; login stamp → `recordLogin` with the Result checked; the stale-entity comment rewritten to its real conclusion |
| `packages/core/customer-auth/src/CompleteCustomerMfaLoginUseCase.ts`                  | Modified | Login stamp → `recordLogin` inside the same UoW, typed failure kept                                                                            |
| `packages/core/customer-auth/src/RegisterCustomerUseCase.ts`                          | Modified | `save` → `create`, `EMAIL_EXISTS` mapped onto the existing code                                                                                |
| `apps/api/tests/integration/customerPasswordReset.integration.test.ts`                | Modified | Login use case really wired; the rehashing-login scenario; a stored-hash seed override                                                         |
| `apps/api/tests/unit/customerAuthUseCases.test.ts`                                    | Modified | Double gains the five commands; register/login assertions moved onto `create` / `recordLogin`                                                  |
| `apps/api/tests/unit/onboarding/onboarding.test.ts`                                   | Modified | Registration double moved onto `create`                                                                                                        |
| `packages/core/customer-auth/tests/unit/LoginCustomerUseCase.test.ts`                 | Modified | Double and its negative assertions moved onto `recordLogin` / `upgradePasswordHash`                                                            |
| `packages/core/customer-auth/tests/unit/CompleteCustomerMfaLoginUseCase.test.ts`      | Modified | Double and its three assertions moved onto `recordLogin`                                                                                       |
| `openspec/changes/password-reset-integrity/tasks.md`                                  | Modified | 11 boxes checked, per-phase evidence added                                                                                                     |

## Next recommended

`sdd-verify` for PR-2a, then `sdd-apply` again for PR-2b. PR-2b is unblocked by this link: its
three team callers still compile against the surviving `save()`, the five intent writes it needs
are in place, and its `create` conflict row (13.1) extends a suite that already exists.

## Orchestrator amendment — PR-2a gate outcome (same night)

Fresh gate: **PASS WITH WARNINGS (0 CRITICAL / 1 WARNING / 2 SUGGESTION)**, all re-run
evidence reproduced (batch 497/497 twice, vitest 8,795, invariants 20/20, fitness set 0).
Dispositions: **WARNING 1** (failure branches of the three migrated credential callers have
zero coverage — Login's INTERNAL_ERROR branch, Register's EMAIL_EXISTS arm at use-case
level) routed into task 13.2, WIDENED to name all six callers so the MERGE-BLOCKING
"each caller" scenario closes whole in PR-2b. **SUGGESTION 2**: the link's CODE is **290**
(+241/−49, gate-measured via git diff) — the writer's 324 was self-accounting; 290 is the
number for the PR body. **SUGGESTION 3** (create's P2002 duplicate path proven fake-only;
happy path real-DB proven) stays named for PR-2b's integration additions or the backlog.
Database-as-found re-proven by the orchestrator's own out-of-band read (separate client):
catalog census unchanged, 0 leftover fixtures. The gate's verify record lives in Engram
(#659) with its mid-chain scope note — no terminal verify artifact exists yet, by
construction (native status: 40/58, next: apply).
