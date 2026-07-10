# Tasks: MFA Consolidation (N-SEC-5 / Cluster B)

## Review Workload Forecast

| Field                   | Value                                             |
| ----------------------- | ------------------------------------------------- |
| Estimated changed lines | PR1 ~550, PR2 ~420, PR3 ~330 (total ~1300)        |
| 400-line budget risk    | High                                              |
| Chained PRs recommended | Yes                                               |
| Suggested split         | PR1 → PR2 → PR3 (design-mandated, do NOT reorder) |
| Delivery strategy       | ask-on-risk                                       |
| Chain strategy          | stacked-to-main                                   |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

PR1 and PR2 each likely exceed 400 lines; strict-TDD + work-unit rule keeps tests with code, so neither sub-splits cleanly. Each oversized PR needs maintainer `size:exception`. PR3 fits budget.

### Suggested Work Units

| Unit | Goal                                                                         | PR  | Base             |
| ---- | ---------------------------------------------------------------------------- | --- | ---------------- |
| 1    | Port + admin adapter + unified service + DI rewire + parity tests            | PR1 | main             |
| 2    | CustomerUser migration + customer adapter + route repoint + no-clobber tests | PR2 | main (after PR1) |
| 3    | Online backfill + verify + cleanup + legacy deletion                         | PR3 | main (after PR2) |

## PR1: Port + Service Completion + DI (base: main)

- [x] 1.1 Create `packages/ports/src/MfaUserRepositoryPort.ts` (port + `MfaSubject`/`MfaUserRecord`); export in `index.ts`. JSDoc `@file/@layer domain` (#9/#10).
- [x] 1.2 RED (vitest): parity contract tests capturing legacy `auth/mfaService.ts` behavior of backup-code login / regenerate / adminForceDisable vs mocked `AdminUserRepositoryPort` (legacy still present). — `tests/unit/mfaService.test.ts` (27 tests) is the retained legacy-behavior contract; the same behaviors run against the unified service in `unifiedMfaService.test.ts`.
- [x] 1.3 Create `PrismaAdminMfaUserRepository.ts` (constructor-injected PrismaClient, no singleton import — #21). JSDoc `@layer infrastructure`. — adapter + `tests/unit/infrastructure/adapters/PrismaAdminMfaUserRepository.test.ts` (12 tests).
- [x] 1.4 RED (vitest, fake port): `unified-mfa-service` scenarios — Admin lifecycle; Customer-parity lifecycle; setup issues hashed codes returned once; backup-code valid-unused succeeds+marked (anchor), used rejected, unknown rejected; regenerate old-fails/new-works; adminForceDisable both subjects + audit has actor/subject, zero secret (anchor); status enabled+count, no secret; no-secret-logging (logger spy). — `tests/unit/unifiedMfaService.test.ts` (17 tests).
- [x] 1.5 GREEN: complete `apps/api/src/admin/auth/MfaService.ts` in place — port-injected, subject dispatch, 3 ported capabilities, `verifyPassword`/`hashPassword` only (#18), 8×8-hex codes, local `window: 2` (no global mutation), UoW-wrapped state+audit writes.
- [x] 1.6 Align `adminAuthConfig.mfa.backupCodesCount` to 8/8.
- [x] 1.7 GREEN wiring: add `TOKENS.AdminMfaUserRepository`/`CustomerMfaUserRepository` in `types.ts`; register adapters + unified service under `TOKENS.MfaService` in `setupServices.ts` (drop legacy factory); delete inline `new MfaService(this.prisma)` in `AdminAuthService.ts`; inject `MfaService`. Customer routes keep admin-targeted behavior (behavior-preserving). — legacy factory removed; single `TOKENS.MfaService` registration; `AdminAuthService` resolves `TOKENS.MfaService`; `mfaRoutes.ts` adapted to admin subject-first (behavior-preserving; customer-subject repoint deferred to PR2/2.6).
- [x] 1.8 Adapt `authService.ts`/`authServiceCore.ts` call sites to subject-first signatures. Assert fitness #21 hard-zero. — done; #21 hard-zero confirmed; zero `UnifiedMfaService`; no prod import of legacy `auth/mfaService.ts`.

## PR2: Customer Persistence + Route Correctness (base: main after PR1)

> Scope note (apply-time, Edward): the design's Decision-4 pre-auth assumption was validated **PARTIAL**.
> The 5 authenticated self-service routes satisfy it (`requireClientAuth` binds TenantContext + exposes
> `accountId`), but login-time `POST /auth/mfa/verify` has no preHandler/TenantContext and the customer
> login never challenges MFA. Building that challenge is a new auth flow → moved to **PR2b**. PR2 does
> NOT touch `/auth/mfa/verify` (stays admin subject). See design §"Apply-time findings".

> **BLOCKED (2026-07-09):** tasks 2.1–2.3, 2.5, 2.6 require editing `infra/prisma/schema.prisma` + creating a
> migration under `infra/prisma/migrations/` — both are sensitive paths gated by `.claude/hooks-py/pre_edit.py`.
> The `sensitive-edit` grant token is EXPIRED and `omnipost-allow sensitive-edit` (TTL 15 min) is a user-side
> command unavailable to the agent. Per Security canon (wait for authorization, never skip the gate) NO
> workaround was taken. The migration is the STRUCTURAL prerequisite for the whole slice: the customer adapter
> cannot typecheck (references `customerUser.mfaBackupCodes`/`mfaBackupUsedAt`, absent from the generated client
> until `prisma generate`), and repointing routes without the real adapter would dispatch to the aliased ADMIN
> adapter → operate on `AdminUser` (a false fix). Resume: Edward runs `omnipost-allow sensitive-edit`, then a
> fresh `sdd-apply` completes 2.1→2.6 atomically (RED→GREEN). STEP 0 (this scope amendment) is DONE.

- [!] 2.1 BLOCKED (sensitive-edit token): `pnpm db:up` (DB is up); add `CustomerUser.mfaBackupCodes String[] @default([])` + `mfaBackupUsedAt Json? @default("{}")` to `schema.prisma`; generate migration with down-migration dropping only those two columns.
- [!] 2.2 BLOCKED (needs 2.1 columns): RED (node:test, needs DB+Redis): migration adds two columns; customer setup persists hashed codes to `mfaBackupCodes`/`mfaBackupUsedAt`; MFA setup never writes `passwordResetToken`; reset↔MFA no-clobber; down-migration data-safe.
- [!] 2.3 BLOCKED (needs 2.1 columns + 2.5/2.6): RED (node:test): customer route reads/writes CustomerUser never AdminUser (anchor); `userEmail` is email not id (anchor); admin route hits AdminUser; no cross-subject mutation.
- [x] 2.4 Validate apply-time ASSUMPTION — **DONE, result PARTIAL**: the 5 self-service routes CUMPLEN (`requireClientAuth` binds `enterTenantContext({accountId})`, exposes `request.customerUser.accountId`); login-time `/auth/mfa/verify` NO CUMPLE (no preHandler, no TenantContext, body has no `accountId`) and customer login never challenges MFA. `/auth/mfa/verify` repoint moved to **PR2b**; PR2 leaves it on the admin subject.
- [!] 2.5 BLOCKED (needs 2.1 regenerated client): GREEN: create `PrismaCustomerMfaUserRepository.ts` (tenant-scoped, `customerUser` in `TENANT_SCOPED_MODELS`); returns `accountId`. JSDoc `@layer infrastructure`. Wire in DI (`setupServices.ts`) replacing the placeholder alias.
- [!] 2.6 BLOCKED (needs 2.5 adapter to avoid a false fix): GREEN: repoint the **5 self-service** routes in `mfaRoutes.ts` to customer subject `{type:"customer",id}` (`:81` status, `:106` setup, `:157` verify-setup, `:254` disable, `:298` regenerate); fix `userEmail` at source (drop `setupMfa`'s `email` param, derive from `MfaUserRecord.email`); fix audit `accountId` (`record.accountId ?? subject.id`); add `/admin/customers/:userId/mfa/force-disable` (`requireAdminAuth`+`USER_MANAGE`, audit resource `CustomerUser`, `withSystemContext()`). **`/auth/mfa/verify` (`:205`) untouched.**

## PR2b: Customer Login MFA Challenge (base: main after PR2) — NEW SLICE

> Own design (challenge token, expiry, anti-replay). Not started in PR2.

- [ ] 2b.1 Design the customer login MFA challenge: `LoginCustomerUseCase` returns `mfaRequired` + a short-lived challenge token when `mfaEnabled`; anti-replay + expiry on the challenge.
- [ ] 2b.2 Repoint login-time `POST /auth/mfa/verify` to the customer subject and resolve `accountId`/TenantContext from the identified CustomerUser (the challenge carries it) before the MFA read/write.
- [ ] 2b.3 RED→GREEN tests: customer login returns `mfaRequired`; challenge verify succeeds/fails; expired/replayed challenge rejected; TOTP + backup-code parity on the login path.

## PR3: Backfill + Legacy Retirement (base: main after PR2)

- [ ] 3.1 RED (node:test): seed legacy admin rows; backfill moves codes exactly once; re-run is no-op; source `passwordResetToken` retained until verified; guard skips genuine reset tokens; assert fitness #23 count `0` (typed Prisma only).
- [ ] 3.2 GREEN: create `scripts/migrations/backfill-admin-mfa-backup-codes.ts` — cursor-batched `findMany`, `$argon2id$`-JSON content guard, skip-migrated, per-row typed `update`, source retained; `// canon-exception: migration:<ts>`. JSDoc `@layer infrastructure`.
- [ ] 3.3 Separate verify step (count source-matching vs migrated) and separate cleanup step (null `passwordResetToken` only where guard matches AND `mfaBackupCodes` non-empty).
- [ ] 3.4 After backfill verify + parity tests pass: delete `apps/api/src/auth/mfaService.ts`; repoint imports (`setupServices.ts:19`, `authService.ts:11`, `authServiceCore.ts:17`, `mfaRoutes.ts:11`).
- [ ] 3.5 Zero-reference gate: `rg "auth/mfaService"` → 0; file absent; TOTP behavior unchanged.
