# Verification Report — mfa-consolidation (N-SEC-5 / Cluster B)

Artifact store: hybrid (this file + engram `sdd/mfa-consolidation/verify-report`).
Mode: Strict TDD. Scope of this report: **PR1** (Port + admin adapter + unified
service completion + DI rewire + parity/contract tests). PR2/PR3 not started.

---

## PR1 — Port + Service Completion + DI

**Verdict: PASS WITH WARNINGS** (0 CRITICAL, 1 WARNING, 2 SUGGESTION).

- **Admin login MFA intact (no lockout regression): YES**
- **DI rewire clean (single registration, no alias, SMELL-37 gone): YES**

Branch `workstream/cluster-b-mfa` (cut from `workstream/cluster-a-cross-tenant`;
the committed diff vs `main` carries Cluster A work — PR1's MFA change is entirely
in the uncommitted working tree + untracked files). Git untouched.

### Task completeness (PR1 tasks 1.1–1.8)

All 8 PR1 tasks checked and matched to code state:

| Task                                                                                                             | Evidence                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1.1 Port `MfaUserRepositoryPort.ts` (+ `MfaSubject`/`MfaUserRecord`/`MFA_SUBJECT_TYPE`, exported in `index.ts`)  | Present; `@layer domain`; technology-free (`@shared/types` `Result` only) |
| 1.2 Legacy-behavior parity contract `tests/unit/mfaService.test.ts` (27)                                         | 27/27 GREEN; legacy file retained (deleted PR3)                           |
| 1.3 `PrismaAdminMfaUserRepository.ts` + test (12)                                                                | Present; constructor-injected Prisma (no singleton); 12/12 GREEN          |
| 1.4 `tests/unit/unifiedMfaService.test.ts` (17) — RED→GREEN anchors                                              | 17/17 GREEN                                                               |
| 1.5 Unified `MfaService.ts` complete (port-injected, subject dispatch, #18 hasher, 8×8-hex, local window:2, UoW) | Verified by source inspection                                             |
| 1.6 `adminAuthConfig.mfa.backupCodesCount = 8`                                                                   | Confirmed (adminAuthConfig.ts:40)                                         |
| 1.7 DI rewire (single `TOKENS.MfaService`; legacy factory dropped; `AdminAuthService` resolves token)            | Confirmed                                                                 |
| 1.8 `authService`/`authServiceCore` subject-first; #21 hard-zero                                                 | Confirmed                                                                 |

### Spec compliance matrix (unified-mfa-service-and-port)

| MERGE-BLOCKING requirement                          | Covering test (passed)                                                                                                                                          | Status |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| One MFA capability serves both subjects via DI port | unifiedMfaService (parity `describe.each` admin+customer)                                                                                                       | PASS   |
| Setup issues secret + hashed codes returned once    | unifiedMfaService "setup issues…hashed backup codes returned once" (asserts `$argon2id$`, 8×8-hex, stored != plaintext)                                         | PASS   |
| Backup-code login parity + single-use               | unifiedMfaService "logs in with a valid unused backup code and marks it single-use" (index "2" marked; reuse → INVALID_TOKEN); "rejects an unknown backup code" | PASS   |
| Regenerate backup codes (old dead, fresh work)      | unifiedMfaService "regenerate invalidates old codes and issues working new ones"                                                                                | PASS   |
| TOTP verify (algorithm unchanged)                   | unifiedMfaService "verifies a current TOTP and rejects an invalid one"                                                                                          | PASS   |
| adminForceDisable over both subjects + clean audit  | unifiedMfaService "adminForceDisable clears MFA and audits actor+subject with no secret" (audit contains actor+subject, `not.toContain(secret)`)                | PASS   |
| Status without disclosing secrets                   | unifiedMfaService "status reports enrollment without leaking secret material" + no-secret-logging spy                                                           | PASS   |

### Adversarial checks

1. **DI cleanliness (SMELL-37 / the fixed smell)** — PASS
   - `rg UnifiedMfaService apps/api/src` = **0** (alias gone).
   - `TOKENS.MfaService` registered **exactly once** (setupServices.ts:193-203, unified `new MfaService(adminRepo, customerRepo, auditLog, uow)`).
   - Legacy `auth/mfaService` in production composition root = comment only (setupServices.ts:189); **no import**.
   - `AdminAuthService` resolves `TOKENS.MfaService` (setupServices.ts:419); inline `new MfaService(this.prisma)` deleted; constructor param `mfaService: MfaService` (AdminAuthService.ts:42).
   - Both adapter tokens present (types.ts:21-22). `CustomerMfaUserRepository` aliases to the admin adapter in PR1 (behavior-preserving; real customer adapter is PR2) — documented.
2. **Admin-login parity (lockout risk)** — PASS. All three admin verify entry points pass the ADMIN subject: `AdminAuthService.verifyMfaToken` (:131-132), `authServiceCore.verifyMfaToken` (:257-258), `mfaRoutes` (:204-205). Parity suite (27) + unified suite (17) green.
3. **Format + config invariants** — PASS. Codes are 8×8-hex (`BACKUP_CODE_BYTES=4` → `randomBytes(4).hex.toUpperCase()`; test asserts `/^[0-9A-F]{8}$/` and length 8); `backupCodesCount=8`; TOTP window pinned per call via `authenticator.clone({ window: 2 })` (MfaService.ts:368) — **no** `authenticator.options` global mutation; canonical `hashPassword`/`verifyPassword` only.
4. **Adapter correctness** — PASS. `PrismaAdminMfaUserRepository` maps AdminUser↔MfaUserRecord (select of exactly the 6 fields), returns NOT_FOUND on missing row + P2025; test exercises all 6 port methods incl. used-map MERGE (asserts both "0" and "1" retained) and null/malformed used-map normalization.
5. **No secret logging** — PASS. `authLogger.error({ err: error }, ...)` only; audit `details` carry `subjectType`/`actorId`/`subjectId`/`remainingCodes`/`tokenLength`/`reason` — no secret/code material.
6. **Scope boundaries** — PASS. `mfaRoutes.ts` uses ADMIN subject in all 8 call sites (CUSTOMER=0), preserving today's behavior including the `userEmail = request.customerUser?.id` bug (mfaRoutes.ts:99, PR2 fix, correctly deferred). No PR2 artifacts (`PrismaCustomerMfaUserRepository.ts` absent; `CustomerUser` mfa columns absent — schema.prisma untouched; no `/admin/customers/:id/mfa/force-disable` route; no new migration) and no PR3 artifacts (`scripts/migrations/backfill-admin-mfa-backup-codes.ts` absent; legacy file retained).
7. **Gates** — PASS (all below).
8. **Known deferral** — CONFIRMED BENIGN (see WARNING W1).

### Build / test / gate evidence (commands + results)

- `pnpm --filter @apps/api exec vitest run tests/unit/unifiedMfaService.test.ts` → **17/17 pass**
- `... tests/unit/mfaService.test.ts` → **27/27 pass** (legacy parity)
- `... tests/unit/infrastructure/adapters/PrismaAdminMfaUserRepository.test.ts` → **12/12 pass**
- `... tests/unit/authService.test.ts` → **24/24 pass**
- `... tests/unit/mfaRoutes.test.ts` → **26/26 pass** (PR1 total **106/106**)
- `pnpm --filter @ports/core exec tsc --noEmit` → **exit 0**
- `pnpm --filter @apps/api exec tsc --noEmit` → **exit 0**
- `pnpm exec eslint --max-warnings 0` on all 16 changed files → **exit 0**
- Fitness **#18** (argon2 outside helper) = **0**; **#21** (prisma singleton outside composition root) = **0**; **#9** (@file headers on 6 new files) = **0**; **#14** (per-class cache Map) = **0**.

### Issues

**CRITICAL: none.**

**WARNING**

- **W1 — Test-harness legacy import (accepted deferral, PR3 dependency; NOT a PR1 defect).** ~15 route smoke tests (`tests/unit/{authRoutes,channelRoutes,team/teamRoutes,rbacRoutes,dashboardRoutes,trendRoutes,...}.test.ts`, `tests/mfa.test.ts`) still import legacy `auth/mfaService.ts` and register it under `TOKENS.MfaService` for DI bootstrap. They do not exercise MFA and pass at runtime because the legacy file (14472 bytes) is retained until PR3. Not run in this verify (LXC single-file rule). **Forward risk:** PR3 must repoint/delete these bootstraps together with the legacy file deletion, or CI breaks. Track as a PR3 acceptance criterion.

**SUGGESTION**

- **S1 — Audit `accountId` sourcing for PR2.** `MfaService.audit` calls `logSecurityEvent(subject.id, subject.id, …)` — `subject.id` is passed as both `userId` and `accountId`. Benign for admin subjects (not account-scoped) and the force-disable spec is satisfied via `details.actorId`/`subjectId`. When PR2 makes customer subjects real, the `accountId` position should carry the customer's tenant account (and admin-over-customer force-disable should attribute the admin actor) for tenant-correct audit rows.
- **S2 — Negative-path no-secret-logging.** The logger spy test only exercises happy-path ops (the service logs only in `catch`). A test that forces a DB error and asserts the error log carries no secret would harden the disclosure guarantee. Low priority — audit-payload assertions already cover the main surface.

### Deviations from design/tasks

None. PR1 implements exactly the design-mandated slice; the customer-subject repoint, `userEmail` fix, customer force-disable route, `CustomerUser` migration, backfill, and legacy deletion are correctly deferred to PR2/PR3 per the design's chained-PR plan.

**next_recommended: commit PR1** (then sdd-apply PR2). Warnings are non-blocking and PR3-tracked.
