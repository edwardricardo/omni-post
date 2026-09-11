# Design: Password Reset Integrity

> Inputs: `proposal.md` (required), `explore.md` (evidence). Binding decisions applied:
> (1) `TOKEN_EXPIRED` collapses into `INVALID_TOKEN`; (2) D3 = one token per user row,
> ONE email listing all accounts with a per-account link.

## Technical Approach

PR-1 declares the 4 pre-identity handlers as system-context boundaries, replaces the
read-then-two-writes reset with one count-gated atomic claim behind two new intent-named
port methods, issues per-user tokens composed into one multi-account email, and adopts
UoW transaction resolution (`getClient()`) on the touched adapter. PR-2 is pure port
surgery: delete `save()`/`updatePasswordHash`/the orphaned `findByResetToken`, add the remaining intent writes; the
compiler drives the 6 caller migrations. PR-1's seams are final — PR-2 deletes, never
reworks (no compatibility shims).

## Architecture Decisions

### D-1 — Context shape: (i) whole-handler `withSystemContext`, inline per handler

**Choice**: wrap each of the 4 handlers' use-case invocation in
`withSystemContext("customer-<op>", ...)` — the exact login precedent
(`customerAuthRoutes.ts:164`, `:241`), same declared-boundary rationale comment.

**Rejected (ii) system-scope resolution + `withTenantContext` re-entry**: buys nothing —
the claim predicate names a globally-`@unique` token (`schema.prisma:354`) plus
`deletedAt: null`, so the unique index caps the write at one row regardless of guard
injection; re-entry requires a pre-read solely to learn `accountId`, restoring the
read-then-write silhouette D2's fix exists to delete.

**Rejected (iii) ADR-0020:114 route-group `preHandler` seam**: no `enterSystemContext`
primitive exists — `tenantContext.ts` offers only scoped `withSystemContext` via
`systemStorage.run()`. A preHandler seam needs `enterWith` semantics, which are
"irreversible within the current async frame" (`tenantContext.ts:77-79`): an
irreversible SYSTEM BYPASS is exactly the leakage class this change names as its top
risk. The plugin also registers authenticated routes (`/me`) in the same group, which a
group-level system context would blanket-bypass. ADR-0020's seam preference targets
_tenant_ context at homogeneous route groups; this group is mixed.

**Leakage behavior (required statement)**: if a prior request's `enterTenantContext`
(`enterWith`) leaks tenant ctx across keep-alive requests, shape (i) is deterministic
anyway — system wins over tenant in BOTH layers: the guard checks system context first
(`tenantGuard.ts:202-205`) and `resolveGucScope` returns `__system__` first
(`tenantGuc.ts:119-124`). A leaked tenant ctx is inert under the wrap. The reverse leak
cannot happen: `.run()` scopes the system ctx to the callback's async subtree.
**Consequently, proposal Risk #1 closes as NEUTRALIZED BY CONSTRUCTION** — on the four
wrapped endpoints, leak and no-leak are observationally identical, so no product-behavior
probe can decide leak _existence_ there; what the integration probe (below) proves is
**leak-IMMUNITY of the wrapped handlers** — a regression oracle that goes red if the wrap
or the system-before-tenant precedence ever regresses, which is the property this change
actually depends on. (Gate correction F-1: an earlier draft over-claimed that the probe
"settles the empirical question"; it cannot, for the stated reason.)

### D-2 — Claim write's home: port-first in PR-1 (exactly 2 methods)

**Choice**: add `claimPasswordReset` + `issueResetToken` to `CustomerUserRepository`
(port) in PR-1, in final form; implement in the adapter.
**Rejected — adapter-level first**: unreachable. `ResetPasswordUseCase` imports only
the domain port (`application imports domain only`, ARCHITECTURE_CANON); an adapter-only
method cannot be called without a layering violation. Port-first is forced by the
architecture, not preference. PR-2 then deletes `save()`/`updatePasswordHash` and adds
the rest without touching any PR-1 line — deletion, not rework.

### D-3 — `getClient()` scope: only `PrismaCustomerUserRepository` (all 10 sites) — CONFIRMED

Fase-0 evidence: a base-client operation inside `executeInTransaction` hits
`isGucBound()`'s first branch (`tenantGucBinding.ts:104-106`) and passes through
unwrapped — committing on a second pooled connection, "measured, not theoretical"
(`tenantGuc.ts:16-19`). The use cases this change touches run inside the UoW, so the
adapter MUST resolve the tx client; the same-table sibling
`PrismaCustomerMfaUserRepository:40-42` is the copied template. Widening to the 71
unresolved writers is option C (own ADR + ratchet) — out of this change.

### D-4 — PR-2 port surface (and the rehash writer the proposal's list omitted)

**Refinement flagged for gate ack**: deleting `updatePasswordHash` outright leaves
`LoginCustomerUseCase`'s rehash (`:218-221`) with no writer. Its single-column
projection was never the defect (`save()` was); it survives under the honest intent name
`upgradePasswordHash`, JSDoc naming login-rehash as its only sanctioned caller. The old
name and its false JSDoc (`CustomerUserRepository.ts:66-68`) die.

| Method (PR)               | Signature                                                                         | Prisma shape                                                                                                                                      | Error contract                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `claimPasswordReset` (1)  | `(token, newPasswordHash) → Result<void, "INVALID_TOKEN" \| "INTERNAL_ERROR">`    | `updateMany({where: {resetToken, resetTokenExpiry: {gt: now}, deletedAt: null}, data: {passwordHash, resetToken: null, resetTokenExpiry: null}})` | `INVALID_TOKEN` ONLY from `count !== 1`; guard throws surface as `INTERNAL_ERROR` — never swallowed into token-invalid (the `:161-168` lesson)                                                         |
| `issueResetToken` (1)     | `(userId, token, expiresAt) → Result<void, "USER_NOT_FOUND" \| "INTERNAL_ERROR">` | count-gated `updateMany({where: {id, deletedAt: null}})`                                                                                          | count gate                                                                                                                                                                                             |
| `create` (2)              | `(user, passwordHash) → Result<void, "EMAIL_EXISTS" \| "INTERNAL_ERROR">`         | genuine `create` (P2002 → `EMAIL_EXISTS`)                                                                                                         | `InviteTeamMemberUseCase` passes its `""` stub hash; its upsert reliance was always the create branch (fresh `randomUUID` id) — a genuine `create` preserves behavior and surfaces duplicates honestly |
| `recordLogin` (2)         | `(userId, at)`                                                                    | `updateMany` → `{lastLoginAt}`                                                                                                                    | count gate                                                                                                                                                                                             |
| `changeRole` (2)          | `(userId, roleId)`                                                                | `updateMany` → `{roleId}`                                                                                                                         | count gate                                                                                                                                                                                             |
| `deactivate` (2)          | `(userId)`                                                                        | `updateMany` → `{isActive: false}`                                                                                                                | count gate                                                                                                                                                                                             |
| `upgradePasswordHash` (2) | `(userId, newHash)`                                                               | `updateMany` → `{passwordHash}`                                                                                                                   | count gate                                                                                                                                                                                             |

**Authority criterion** (each method): _completeness_ — `data` lists every column the
intent requires; _exclusivity_ — every column has exactly one writing intent
(`passwordHash`'s three writers — create/claim/upgrade — each sanctioned by name);
_no side channel_ — no optional parameter alters the projection (`passwordHash?` dies
with `save()`). No credential write touches `deletedAt`. A table-driven invariant test
diffs the fake's row before/after each method and asserts changed-column-set equality.

### D-5 — Email composition (binding decision b)

`RequestPasswordResetUseCase` gains optional `accountQueryRepo?: AccountQueryRepository`
(existing port; `findById → AccountDto` carries the name; `NOT_FOUND` → generic label,
never an error). One send, N labeled links `${base}/reset-password?token=${token_i}`,
per-user tokens generated inside the loop. Anti-enumeration silhouette preserved:
always one email, always `ok`.

## Data Flow (reset confirm)

    POST /reset-password
      → withSystemContext (scoped .run)
      → ResetPasswordUseCase → UoW.executeInTransaction (marker + GUC "__system__")
      → repo.claimPasswordReset → getClient() = tx client
      → guard: system bypass → ONE updateMany (unique-token predicate)
      → count 1 → ok | count 0 → INVALID_TOKEN (single collapsed 400)

## File Changes

| File                                                                       | PR   | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/auth/customerAuthRoutes.ts`                                  | 1    | 4 wraps; delete `TOKEN_EXPIRED` map row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/core/customer-auth/src/ResetPasswordUseCase.ts`                  | 1    | single-claim rewrite; drop `TOKEN_EXPIRED` from union                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/core/customer-auth/src/RequestPasswordResetUseCase.ts`           | 1    | per-user tokens + one multi-account email                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `packages/core/domain/src/repositories/CustomerUserRepository.ts`          | 1, 2 | +2 methods; then delete 3 (incl. the orphaned `findByResetToken` decl `:58-62`) / add 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/api/src/infrastructure/repositories/PrismaCustomerUserRepository.ts` | 1, 2 | `getClient()` (10 sites) + 2 impls; then surgery — **incl. deleting the PR-1-orphaned `findByResetToken`** (port decl + adapter `:151-169`, whose `:161-168` catch is the swallowed-guard-throw lesson; its only consumer dies with the single-claim rewrite)                                                                                                                                                                                                                                                                                                                                           |
| `Login/CompleteMfa/3 team/Register` use cases                              | 2    | migrate to intent writes (compiler-driven)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/api/tests/unit/**` (fake client + tests)                             | 1, 2 | new stateful fake; 4 red tests; **rewrite the whole `ResetPasswordUseCase` describe (`customerAuthUseCases.test.ts:451-514`) plus the `save`-count assertion at `:440-448`** (gate correction F-3 — an earlier draft named only `:489-502`): `:475-487`'s expiry test is **REWRITTEN to assert `INVALID_TOKEN` produced by the claim predicate — NEVER deleted** (it carries the proposal's expired-token acceptance criterion, and its `TOKEN_EXPIRED` assert stops type-checking under the collapsed union); `:461-473` re-drives through the claim path; PR-2 invariant test replaces `save.test.ts` |
| `apps/api/tests/integration/customerPasswordReset.integration.test.ts`     | 1    | new                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/api/scripts/run-tests.sh`                                            | 1    | `CONCURRENCY=1 run_batch "integration:customer-auth"` naming the file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Testing Strategy

| Layer                                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit (vitest, tree-collected)                         | D1 revert red→green; D2 count-gating; column invariants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Stateful Map-backed **Prisma-client** fake (`customerUser.findFirst/findMany/update/updateMany/upsert/create`, real merge semantics, rows carry `customerRole: null`) injected into the REAL adapter — pre-fix the actual 19-column `baseData` upsert executes and the stored hash reverts (red); post-fix the claim path runs (green). Race: two concurrent executes on one token → exactly one `ok` (count-gating logic only — event-loop-atomic fake; atomicity proof is the integration row) |
| Integration (node:test, guarded client, `app.inject`) | D0 reachability ×4; D1 persisted-row asserts (`argon2.verify` both directions, `resetToken IS NULL`); D2 two CONCURRENT confirms → one ok/one 400 (real DB atomicity — the UNIT race decides only count-gating logic, since a Map-backed fake is event-loop-atomic; THIS row is the atomicity proof); D3 N accounts → N tokens, zero P2002; soft-deleted claim refused; **leak-IMMUNITY probe** (not leak-existence — see D-1): keep-alive agent — authenticate as tenant A, then reset-confirm a tenant-B user on the SAME socket must succeed with row B mutated; a tenant-A request after the reset still enforces A-scope (no forward system leak) | New batch line satisfies fitness #30 (ratchet only falls); #31 zero-collection guards apply per batch                                                                                                                                                                                                                                                                                                                                                                                            |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification,
or process-integration boundary (existing handlers wrapped in place).

## Fitness / Fase-0 Interplay

- **#40**: zero new `.$transaction(` — the claim is one statement; the UoW is the
  sanctioned seam; the per-operation GUC batch lives in `infra/prisma` (outside #40's
  scope); Part B site count unchanged.
- **#38**: `customerUser` is UNSWEPT-quarantined; every touched read already carries
  `deletedAt: null`; the new writes are not read operations.
- No sensitive paths (no schema/migrations/workflows); tripwire #7 applies at apply time.

## Migration / Rollout

None. Two stacked PRs to main; each is one clean `git revert` (per proposal).

## PR Forecast (two-tier budget)

- **PR-1 CODE ≈ 260** (wraps ~40, use cases ~90, port ~40, adapter ~90) — under 400, risk Low.
- **PR-2 CODE ≈ 350–400 counted as CHANGED LINES (additions + deletions)** — re-derived
  from measured spans (gate correction F-2; an earlier draft's `port −90/+150` breakdown
  was not reproducible against the 82-line port file): port ≈ +60/−12 (the deletable
  `save`+`updatePasswordHash` block is `:64-75` = 12 lines; 5–7 new ~6-line declarations
  with JSDoc), adapter ≈ +90/−71 (`save` `:171-222` = 52, `updatePasswordHash`
  `:224-242` = 19), six callers ≈ 120 changed. **Headroom over the 400 CODE budget is
  THIN, not comfortable** — if `InviteTeamMemberUseCase`'s typed `EMAIL_EXISTS` ripples
  into its route error map, the margin (~50 lines) can vanish; `sdd-tasks` re-forecasts
  and, if it crosses, PR-2 splits at the callers seam rather than taking an exception.
  Risk Medium; the chain exists because of it.
- **EVIDENCE tier** (fake ~150, unit ~250, integration ~350, rewrites ~80): pre-approved
  for the whole change by proposal acceptance; split declared in each PR body.

## Open Questions

- [x] Gate ack: `upgradePasswordHash` retained as the login-rehash writer — a named
      refinement of the proposal's "delete `updatePasswordHash`" (D-4 rationale).
      **ACCEPTED by the fresh gate (2026-09-11)** on a four-part ruling: the defect was the
      snapshot `save`, not the single-column projection; the login rehash genuinely needs a
      writer (deleting both silently un-persists the transparent rehash); a REQUIRED-hash
      single-column write does not reopen the optional-parameter side channel (three writers
      of one column is multiplicity with per-intent authority, not the ambiguity the
      criterion forbids); and the divergence was named, not absorbed. Corroborated by the
      spec's own `[integration]` scenario "a rehashing login persists the upgraded hash",
      which is unsatisfiable if both writers die.
