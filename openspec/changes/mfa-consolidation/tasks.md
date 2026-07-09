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

- [ ] 2.1 `pnpm db:up`; add `CustomerUser.mfaBackupCodes String[] @default([])` + `mfaBackupUsedAt Json? @default("{}")` to `schema.prisma`; generate migration with down-migration dropping only those two columns.
- [ ] 2.2 RED (node:test, needs DB+Redis): migration adds two columns; customer setup persists hashed codes to `mfaBackupCodes`/`mfaBackupUsedAt`; MFA setup never writes `passwordResetToken`; reset↔MFA no-clobber; down-migration data-safe.
- [ ] 2.3 RED (node:test): customer route reads/writes CustomerUser never AdminUser (anchor); `userEmail` is email not id (anchor); admin route hits AdminUser; no cross-subject mutation.
- [ ] 2.4 Validate apply-time ASSUMPTION: confirm pre-auth `/auth/mfa/verify` exposes the identified CustomerUser's `accountId` so tenant context binds before the MFA read/write; if not, flag as blocker before 2.6.
- [ ] 2.5 GREEN: create `PrismaCustomerMfaUserRepository.ts` (tenant-scoped, `customerUser` in `TENANT_SCOPED_MODELS`). JSDoc `@layer infrastructure`.
- [ ] 2.6 GREEN: repoint `mfaRoutes.ts` to customer subject `{type:"customer",id}`; fix `userEmail = email` (:98); add `/admin/customers/:userId/mfa/force-disable` (`requireAdminAuth`+`USER_MANAGE`, audit resource `CustomerUser`, `withSystemContext()`).

## PR3: Backfill + Legacy Retirement (base: main after PR2)

- [ ] 3.1 RED (node:test): seed legacy admin rows; backfill moves codes exactly once; re-run is no-op; source `passwordResetToken` retained until verified; guard skips genuine reset tokens; assert fitness #23 count `0` (typed Prisma only).
- [ ] 3.2 GREEN: create `scripts/migrations/backfill-admin-mfa-backup-codes.ts` — cursor-batched `findMany`, `$argon2id$`-JSON content guard, skip-migrated, per-row typed `update`, source retained; `// canon-exception: migration:<ts>`. JSDoc `@layer infrastructure`.
- [ ] 3.3 Separate verify step (count source-matching vs migrated) and separate cleanup step (null `passwordResetToken` only where guard matches AND `mfaBackupCodes` non-empty).
- [ ] 3.4 After backfill verify + parity tests pass: delete `apps/api/src/auth/mfaService.ts`; repoint imports (`setupServices.ts:19`, `authService.ts:11`, `authServiceCore.ts:17`, `mfaRoutes.ts:11`).
- [ ] 3.5 Zero-reference gate: `rg "auth/mfaService"` → 0; file absent; TOTP behavior unchanged.
