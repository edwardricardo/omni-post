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

---

## PR2 — Customer Persistence + Route Correctness

**Verdict: PASS WITH WARNINGS** (0 CRITICAL, 2 WARNING, 3 SUGGESTION).

- **MERGE-BLOCKING invariants — all met**: subject targeting (customer→CustomerUser, never AdminUser) PROVEN at table level; tenant isolation enforced (cross-account 404); `passwordResetToken`/`resetToken` no-clobber PROVEN; no secret material in logs/audit.
- **No PR2b / PR3 leakage**: `/auth/mfa/verify` stays ADMIN; `LoginCustomerUseCase` untouched; legacy `auth/mfaService.ts` retained (27/27); no backfill script.

Implementation is the uncommitted working tree at HEAD `c9c73f39` (git untouched). Verified adversarially — every claim re-derived at source plus runtime test evidence (LXC-safe, one file per run, heap-capped, `timeout` wrapper).

### Task completeness (PR2 tasks 2.1–2.6)

All 6 checked and matched to code state:

| Task                                                                                               | Evidence                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 Schema + migration (`CustomerUser.mfaBackupCodes`/`mfaBackupUsedAt`)                           | `schema.prisma` diff = exactly the 2 columns (mirrors AdminUser :176-177); `migration.sql` adds only the 2; `down.sql` drops only the 2; migration applied (integration round-trips real Postgres columns) |
| 2.2 Integration no-clobber + JSONB round-trip                                                      | `mfaCustomer.integration.test.ts` 5/5, 0 cancelled                                                                                                                                                         |
| 2.3 CustomerUser-never-AdminUser + tenant cross-account 404                                        | integration tests 3 + 4; unit force-disable "never touch AdminUser"                                                                                                                                        |
| 2.4 Decision-4 assumption validated PARTIAL                                                        | 5 self-service routes CUMPLEN; `/auth/mfa/verify` deferred to PR2b                                                                                                                                         |
| 2.5 `PrismaCustomerMfaUserRepository` + DI rewire                                                  | adapter present, 12/12; placeholder alias replaced by real adapter                                                                                                                                         |
| 2.6 5 self-service routes → customer; `userEmail` source-fix; audit actor; new force-disable route | all confirmed at source + tests                                                                                                                                                                            |

### Adversarial checks (with file:line evidence)

1. **Migration (item 1) — PASS.** `migration.sql` adds only `mfaBackupCodes TEXT[] DEFAULT ARRAY[]::TEXT[]` + `mfaBackupUsedAt JSONB DEFAULT '{}'` on `CustomerUser`, mirroring `AdminUser` (schema.prisma:176-177). `down.sql` drops exactly those 2 (`IF EXISTS`), nothing else. `git diff schema.prisma` = only :339-340 on `CustomerUser` — no other drift. Migration is applied (integration reads/writes both columns against real Postgres).
2. **Customer adapter (item 2) — PASS.** Mirrors the admin adapter 1:1 — 6 port methods, identical `normalizeUsedAt`, UoW-aware `getClient()` (`PrismaUnitOfWork.getTransactionClient() ?? this.prisma`), P2025→NOT_FOUND, single-table `customerUser`. Delta: `findById` also selects+returns `accountId` (:47,:61). Unit **12/12**.
3. **DI (item 3) — PASS.** `setupServices.ts:181-185` — placeholder alias GONE; `CustomerMfaUserRepository` → real `new PrismaCustomerMfaUserRepository(...)`. `MfaService` registered EXACTLY ONCE (:193-194; :210/:416-419 are `resolve`). `rg UnifiedMfaService apps/` = 0.
4. **Subject targeting (item 4, MERGE-BLOCKING) — PASS.** 5 self-service on CUSTOMER: status(:83), setup(:108), verify-setup(:157), disable(:254), regenerate(:298). Login-time `/auth/mfa/verify` STILL ADMIN (:205). 2 admin routes unchanged (:338,:379). Table-level proof: integration test 1 (customerUser gets 8 `$argon2id$` hashes) + test 3 (adminUser findFirst === null) + unit force-disable (adminRowAfter deep-equals adminRowBefore while customer store cleared). Integration 5/5, mfaRoutes 31/31, 0 cancelled.
5. **Tenant isolation (item 5, MERGE-BLOCKING) — PASS (covered).** Integration test 4: real subject + mismatched `accountId` claim → status 404 (tenant guard scopes `customerUser.findUnique` to the bound accountId). The literal "customer B reaches customer A's row" is UNREACHABLE — self-service routes derive the target id from `request.customerUser.id` (JWT subject), never a param. The reachable cross-tenant vector is exercised against the real tenant-guarded Prisma client. Not a finding.
6. **`withSystemContext` force-disable (item 6) — PASS + WARNING (W2).** `POST /admin/customers/:userId/mfa/force-disable` (:571) guarded by `requireAdminAuth` + `requirePermission(USER_MANAGE)` (:573); body `reason` = `min(10).max(500)` (:59); disable + internal audit inside `withSystemContext(...)` (:443-450). Route-level audit (:461-473) attributes the ADMIN actor (`userId: adminUserId`) with the customer as RESOURCE (`resource:"CustomerUser"`, `resourceId:userId`).
7. **`userEmail` fix (item 7) — PASS.** `setupMfa(subject)` dropped `email`; derives label from `found.value.email` (MfaService.ts:126). Route bug line `const userEmail = request.customerUser?.id` DELETED. Call sites drop the arg (mfaRoutes.ts:108, AdminAuthService.ts:431). `rg userEmail apps/api/src` = only Zod `SecureSchemas.userEmail` + legacy (PR3). Integration test 1 + unit `keyuriSpy.toHaveBeenCalledWith(customerEmail,…)` anchor it.
8. **Customer audit (item 8, A1 seam) — PASS + WARNING (W1).** `resolveAuditActor` → customer `auditActor.customer(id, accountId)`, admin `auditActor.admin(id)` (MfaService.ts:411-420); `writeAuditLog` maps CUSTOMER→`customerUserId`, ADMIN→`userId`, +`actorType`, +customer `accountId` (:341-361). Seam unit-tested (AuditableService 19/19). Coverage gap (W1): no test asserts an end-to-end customer audit ROW with `actorType=CUSTOMER`+`customerUserId`+`userId` null+`accountId`.
9. **`passwordResetToken` no-clobber (item 9, MERGE-BLOCKING) — PASS.** `rg passwordResetToken|resetToken` over new path (MfaService, both adapters, mfaRoutes, port) = 0. Integration test 2 seeds `resetToken` then asserts it survives a full enrollment. Legacy still writes it (PR3); no self-service route routes to legacy.
10. **No PR2b/PR3 leakage (item 10) — PASS.** `/auth/mfa/verify` handler + registration untouched (ADMIN, no preHandler). `LoginCustomerUseCase` git-clean, no `mfaRequired`/`mfaEnabled`. Legacy `auth/mfaService.ts` present, 27/27. No backfill script.
11. **Regression (item 11) — PASS.** unifiedMfaService 17/17, PrismaAdminMfaUserRepository 12/12, legacy mfaService 27/27, AuditableService (A1) 19/19.
12. **0-defect gate (item 12) — PASS.** tsc @ports/core=0, @apps/api=0; eslint --max-warnings 0 on 11 files=0; fitness #18=0, #21(global)=0, #23=0, #9 present, #6/#8=0; tripwire sweep CLEAN; `@file`/`@layer infrastructure` on new files; all artifacts English.
13. **Test honesty (item 13) — PASS.** mfaRoutes.test.ts 26→31: removals are a REPOINT (separate customer `InMemoryMfaUserRepository` + signed customer JWT), not a weakening. New assertions behavioral: keyuri=email, cross-store isolation, response-shape + auth-guard on force-disable. unifiedMfaService diff = drop `email` arg only. InMemory helper diff = additive optional `accountId`.

### Build / test / gate evidence

- `PrismaCustomerMfaUserRepository.test.ts` → 12/12
- `mfaRoutes.test.ts` → 31/31
- `mfaCustomer.integration.test.ts` (real API :3000 + Postgres) → 5 tests, 5 pass, 0 cancelled
- `unifiedMfaService.test.ts` → 17/17 · `PrismaAdminMfaUserRepository.test.ts` → 12/12 · legacy `mfaService.test.ts` → 27/27 · `AuditableService.test.ts` (A1) → 19/19
- tsc @ports/core=0, @apps/api=0 · eslint --max-warnings 0 (11 files)=0 · fitness #18/#21/#23=0, tripwire CLEAN

### Issues

**CRITICAL: none.**

**WARNING**

- **W1 — Customer-subject audit row not asserted end-to-end (coverage gap; behavior correct by construction).** No test proves a customer MFA op persists an audit row with `actorType=CUSTOMER`+`customerUserId` set+`userId` null+`accountId`. Unit only substring-checks the payload; integration asserts no `AuditLog` row. The MERGE-BLOCKING spec scenario ("payload carries identity, no secret") IS covered; only structured column-level correctness is unverified. Non-blocking; add one read-back assertion.
- **W2 — `adminForceDisable` over a CUSTOMER records the MfaService-internal security row with `actorType=CUSTOMER` (the disabled customer), not the acting admin.** `resolveAuditActor` dispatches purely by `subject.type`; the real admin is only in `details.actorId`. The authoritative route-level audit row DOES attribute the admin correctly, so the trail is not broken — but the internal `MFA_ADMIN_FORCE_DISABLED` row is semantically muddy. Same root cause as PR1 S1. Non-blocking (both identities present, no secret).

**SUGGESTION**

- **S1 — Explicit cross-customer-unreachability test** documenting that self-service routes derive the target id from the authenticated subject (item-5 invariant self-evident).
- **S2 — Duplicate JSDoc header** in `mfaCustomer.integration.test.ts` (two `@file` blocks, lines 1-27 and 29-32). Cosmetic.
- **S3 (→ PR3) — Test-harness legacy import** (inherited PR1 W1): ~15 route smoke tests still bootstrap legacy `auth/mfaService.ts` under `TOKENS.MfaService`; PR3 must repoint/delete these with the legacy file.

### Deviations from design/tasks

- Audit accountId fix (design Decision-4 S1) superseded by the A1 actor-first seam (`resolveAuditActor` builds a structured `auditActor.customer`/`admin` after commit `3242147a`) — superior, matches apply-progress; accepted, not a defect. Residual is W2, which the design's S1 anticipated and the route-level audit satisfies.
- `/auth/mfa/verify` correctly left on the ADMIN subject (PR2b boundary) per the design's apply-time PARTIAL finding.

**next_recommended: commit PR2 → sdd-apply PR2b** (customer login MFA challenge), then PR3. The 2 WARNINGs are non-blocking (no unaddressed CRITICAL, no failing/untested MERGE-BLOCKING scenario) and do NOT block archive.

---

## Post-verify remediation (PR2, same session)

Owner policy: warnings get resolved now, not carried. All 4 findings (2 WARNING + 2 of 3 SUGGESTION) fixed this batch; the 3rd SUGGESTION (S3) is confirmed staying an explicit PR3 acceptance criterion, not a defect to fix now. A fresh `sensitive-edit` token authorized `MfaService.ts` edits (though it turned out `MfaService.ts` is not on the hook's `SENSITIVE_PATTERNS` list — the edit was never actually gated, confirmed by it landing without a hook error).

| Finding                                                    | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W2 — force-disable attributed the wrong actor**          | Fixed at the root: `MfaService.adminForceDisable` now computes an explicit `{ actor: auditActor.admin(actor.id), accountId }` override and passes it to `audit()` via a new optional `actorOverride` parameter (`audit()` still defaults to `resolveAuditActor(subject)` for the 5 self-service ops, where the subject IS correctly the actor). `accountId` on the override is the customer's real account when the subject is CUSTOMER, else the acting admin's id (unchanged admin convention). RED→GREEN: `unifiedMfaService.test.ts` gained an explicit actor-shape assertion (`actorType==="ADMIN"`, `userId===actingAdminId`, `customerUserId===null`) inside the existing parity test (both admin and customer subjects), plus a new dedicated test proving a self-service customer op still audits `actorType==="CUSTOMER"`. **End-to-end proof** (not just unit-mocked): a new real-DB integration test instantiates `MfaService` over the real `PrismaCustomerMfaUserRepository`/`PrismaAdminMfaUserRepository`/`PrismaAuditLogRepository`, calls `adminForceDisable`, and reads back the persisted `AuditLog` row — `actorType=ADMIN`, `userId=<real admin id>`, `customerUserId=null`, `details.subjectId=<disabled customer's id>`. This surfaced a real test-authoring gap (not a production defect): `AuditLog.userId` carries a genuine FK to `AdminUser`, so the test had to create a real `AdminUser` row for the acting admin rather than a synthetic id string — production code was already correct here since routes always source `actor.id` from an authenticated admin session. |
| **W1 — no end-to-end read-back of the customer audit row** | New integration test reads back a real `MFA_ENABLED` `AuditLog` row after the customer setup+verify-setup HTTP flow and asserts `actorType='CUSTOMER'`, `customerUserId=<customer id>`, `userId IS NULL`, `accountId=<customer's real account>` — the exact column-level assertion pattern from `auditActorPolymorphism.integration.test.ts`. Combined with the W2 fix's force-disable read-back, both audit paths (self-service actor-is-subject, admin-force-disable actor-is-admin) are now proven end-to-end against real Postgres, not just unit-mocked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **S2 — duplicate JSDoc header**                            | Merged into one `@file`/`@description`/`@layer infrastructure` block at the top of `mfaCustomer.integration.test.ts`; the descriptive coverage prose lives inside the single `@description` tag.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **S1 — explicit cross-customer-unreachability test**       | New integration test: customer B (a second, distinct `CustomerUser` in the SAME account as A — a same-tenant scenario the accountId tenant guard alone would not catch) runs a full setup→verify-setup→disable cycle while customer A (already enrolled by an earlier test) is snapshotted before/after; asserts A's `mfaEnabled`, `mfaBackupCodes`, and `resetToken` are byte-for-byte unchanged. Documents that isolation comes from the routes deriving the target id strictly from the authenticated subject, never a caller-supplied parameter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **PR1-S2 carryover — negative-path no-secret-logging**     | New unit test in `unifiedMfaService.test.ts`: `vi.spyOn(adminRepo, "clearMfa").mockRejectedValueOnce(...)` forces `disableMfa`'s mutating write to throw, exercising the previously-uncovered `catch` branch; asserts the resulting `authLogger.error` call (captured via the existing logger spy) carries no TOTP secret and no backup code across the whole logged payload.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **S3 (→ PR3)**                                             | Confirmed staying as-is: ~15 route smoke tests still bootstrap legacy `auth/mfaService.ts` under `TOKENS.MfaService`; tracked as a PR3 acceptance criterion (repoint/delete together with the legacy file), not fixed here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Gate (post-remediation, all green, LXC-safe)

- `unifiedMfaService.test.ts` → **19/19** (was 17; +2 actor-shape/self-service-actor tests, +1 negative-path no-secret-logging test — net +2 after the earlier no-op `email`-arg edits already counted)
- `mfaRoutes.test.ts` → **31/31** (no regression)
- `mfaCustomer.integration.test.ts` → **8/8, 0 cancelled** (was 5; +1 audit read-back, +1 cross-customer-unreachability, +1 force-disable audit read-back)
- `PrismaAdminMfaUserRepository.test.ts` → 12/12 · legacy `mfaService.test.ts` → 27/27 · `authService.test.ts` → 24/24 (regression, unaffected by this batch)
- `tsc --noEmit` `@apps/api` → **0**
- `eslint --max-warnings 0` on `MfaService.ts` + `unifiedMfaService.test.ts` + `mfaCustomer.integration.test.ts` → **0**
- Fitness **#18** (argon2 outside canonical helper) = **0**; **#21** (Prisma singleton outside composition root, touched files) = **0**

**Verdict after remediation: PASS, 0 CRITICAL, 0 WARNING, 1 SUGGESTION remaining (S3, intentionally deferred to PR3).**

---

## PR2b-1 — Companion TOTP single-use fix (protects ADMIN + CUSTOMER)

**Verdict: PASS WITH WARNINGS** (0 CRITICAL, 1 WARNING, 2 SUGGESTION).

- **The replay hole is genuinely closed** (NIST SP 800-63B 5.1.5.2 / OWASP MFA): a given TOTP verifies exactly once for BOTH subjects — proven at runtime (unit both-subject + real-DB integration incl. the concurrency serializer).
- **No admin-login regression** (merge-blocking): both admin call sites green (`authServiceCore`/`AdminAuthService` via `mfaRoutes` 31/31, `authService` 24/24, `test:mfa` 21/21).
- **Scope clean**: zero PR2b-2/PR2b-3 leakage; orphan `POST /auth/mfa/verify` still present; legacy `apps/api/src/auth/mfaService.ts` git-untouched (zero replay coverage — expected, PR3's job).

Implementation is the uncommitted working tree at HEAD `ece795e6` (git untouched, read-only verify). Every claim re-derived at source PLUS runtime evidence (LXC-safe: one file/run, heap-capped, `timeout`).

### Task completeness (PR2b-1 tasks 2b1.1–2b1.11)

All 11 checked and matched to code state:

| Task                                                                         | Evidence                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2b1.1 `pnpm db:up` / no P3015                                                | Migration applied; DB reachable `omnipost-infra:5432`; no orphan dir in migrations/                                                                                            |
| 2b1.2 [RED] integration adapter contract                                     | `mfaTotpSingleUse.integration.test.ts` 4/4 (real Postgres)                                                                                                                     |
| 2b1.3 schema + migration (2 nullable INT cols)                               | `schema.prisma` diff = only `mfaLastUsedTotpStep Int?` on AdminUser + CustomerUser; `migration.sql` = 2 `ADD COLUMN … INTEGER`; `down.sql` drops exactly those 2 (`IF EXISTS`) |
| 2b1.4 [RED] adapter unit tests                                               | both adapter suites 19/19                                                                                                                                                      |
| 2b1.5 port `mfaLastUsedTotpStep` + `claimTotpStep`                           | `MfaUserRepositoryPort.ts` @layer domain; typed `Result<"CLAIMED","NOT_FOUND"\|"ALREADY_USED">`                                                                                |
| 2b1.6 both Prisma adapters conditional `updateMany` + count-0 disambiguation | source-verified identical predicate in both adapters; constructor-injected Prisma (#21=0)                                                                                      |
| 2b1.7 in-memory double                                                       | `InMemoryMfaUserRepository.claimTotpStep` atomic (no await between check/set), mirrors CAS                                                                                     |
| 2b1.8 [RED] both-subject replay unit spec                                    | `mfaTotpSingleUse.test.ts` 10/10                                                                                                                                               |
| 2b1.9 `MfaService` TOTP path claim + HIGH replay audit                       | source-verified `:197-210`; signature UNCHANGED; legacy untouched                                                                                                              |
| 2b1.10 admin regression                                                      | unifiedMfaService 19/19, mfaRoutes 31/31, authService 24/24, test:mfa 21/21                                                                                                    |
| 2b1.11 0-defect gate                                                         | tsc 0/0, eslint 0, fitness #3/#9/#10/#18/#21/#23=0                                                                                                                             |

### Spec compliance matrix (design-pr2b Decision 2 — MERGE-BLOCKING)

| Requirement                                                                                             | Covering test (passed at runtime)                                                             | Status |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ |
| Same TOTP accepted once, then replay rejected — BOTH subjects                                           | `mfaTotpSingleUse` "accepts a TOTP once and rejects the same TOTP on replay" (admin+customer) | PASS   |
| Replay → `err("INVALID_TOKEN")` + HIGH `MFA_TOTP_REPLAY_REJECTED` audit                                 | `mfaTotpSingleUse` "audits a HIGH MFA_TOTP_REPLAY_REJECTED event on replay" (x2)              | PASS   |
| Next 30s step still accepted (no lockout)                                                               | `mfaTotpSingleUse` "still accepts the NEXT 30-second step after a claim" (x2, fake timers)    | PASS   |
| Same-TOTP login-then-regenerate/disable rejected in-window                                              | `mfaTotpSingleUse` "rejects reusing a consumed TOTP for … regenerate/disable" (x2x2)          | PASS   |
| CAS contract: fresh CLAIMED / replay ALREADY_USED / older ALREADY_USED / step+1 CLAIMED — both adapters | integration admin + customer cases; adapter unit suites (5 `claimTotpStep` cases x2)          | PASS   |
| Count-0 disambiguation: missing→NOT_FOUND                                                               | integration "unknown id"; adapter unit "user is gone"                                         | PASS   |
| Concurrent claims of same step → exactly ONE CLAIMED                                                    | integration "two concurrent claims … exactly one CLAIMED" (real Postgres)                     | PASS   |

### Adversarial checks (each re-derived at source and/or by test)

1. **CAS predicate soundness (`MfaService.ts:197-210`, both adapters + in-memory) — PASS.** `where:{ id, OR:[{mfaLastUsedTotpStep:null},{mfaLastUsedTotpStep:{lt:step}}] }`, `data:{mfaLastUsedTotpStep:step}`. Monotonic: a claim succeeds ONLY for `null` or `stored < step`. Replay (equal) rejected; older-in-window (`<` newer) rejected. **Key robustness proof (re-derived from otplib):** a physical TOTP code C maps to a TIME-INVARIANT step — `checkDelta` returns `delta = S − currentCounter`, so `computeTotpStep = currentCounter + delta = S` for every presentation of C within the window. The claim is keyed on C's intrinsic step S, not on when C is presented → the same code can NEVER be re-claimed. Replay is provably closed, not merely window-narrowed.
2. **`computeTotpStep` (`:409-420`) — PASS, verified against otplib 12.0.1 source.** (a) `authenticator.clone({window,epoch:Date.now()})` pins epoch into `_defaultOptions`; `Authenticator.allOptions()`=`authenticatorOptions(this.options)` spreads the fresh `Date.now()` DEFAULT then OVERRIDES with the pinned `epoch` — both `checkDelta` and the explicit `allOptions()` read the SAME pinned instant (no 30s-boundary race), confirmed at `@otplib/core/index.js:388-448`. `step`=30s, `epoch` in ms. (b) `currentCounter+delta` correct for negative delta (past step) — matches otplib's internal `totpCounter(epoch,step)=floor(epoch/step/1000)`. (c) `checkDelta` signature `(token,secret): number|null` confirmed (`authenticator.d.ts:132`). (d) `verifyTotp` now delegates to `computeTotpStep(…)!==null` — semantically identical to prior `check()` (`check`=`checkDelta!==null`); its only other caller `verifyMfaSetup:158` unaffected.
3. **No fall-through to backup on a replayed TOTP (`:198-210`) — PASS.** The `return err("INVALID_TOKEN")` sits INSIDE `if (acceptedStep !== null)`, so a replay never reaches the backup loop. Reverse also holds: a legit backup code (8-hex uppercase) yields `computeTotpStep=null` (not a 6-digit TOTP) → falls through and still works — format non-collision is structural (8-hex vs 6-digit; `BACKUP_CODE_BYTES=4`), unifiedMfaService backup-code path 19/19.
4. **Both adapters + in-memory + count-0 disambiguation — PASS.** Both `updateMany` predicates identical; count-0 → `findUnique({select:{id}})`: existing→ALREADY_USED, missing→NOT_FOUND. A real DB error on `updateMany`/`findUnique` is NOT masked — `claimTotpStep` has no try/catch, so it throws up to `verifyMfaToken`'s catch → `DATABASE_ERROR`. Integration + adapter suites green (19/19 x2).
5. **Atomicity genuinely serialized — PASS (runtime-proven).** Integration "two concurrent claims … exactly one CLAIMED" green against real Postgres. Reasoning: the conditional single-statement `updateMany` row-locks under READ COMMITTED; the loser re-evaluates the WHERE against the committed row (`stored = step`, `step<step` false) → count 0. No UoW widening: `claimTotpStep` runs OUTSIDE `runInTransaction` (autocommit), so no ambient tx holds a lock.
6. **Admin regression (merge-blocking) — PASS.** Both admin login paths pass ADMIN subject through the unchanged `verifyMfaToken` signature; admin TOTP is now single-use too (intended). mfaRoutes 31/31, authService 24/24, unifiedMfaService 19/19, test:mfa 21/21 (0 cancelled).
7. **Test honesty — PASS (no bent tests).** Two existing-test edits, both LEGITIMATE spec adaptations with UNCHANGED assertions: (a) `unifiedMfaService.test.ts` swaps `disableMfa(…, authenticator.generate(secret))` → `disableMfa(…, regen.value[1])` — the prior regenerate already claimed the current step, so disabling with a same-window TOTP would now (correctly) fail; the test uses a DISTINCT unused backup code, `expect(disable.ok).toBe(true)` intact. (b) `tests/mfa.test.ts` two blocks `before/after` → `beforeEach/afterEach` — per-test fresh enrolled user so each gets its own unclaimed step (fixture isolation, zero assertion change). No weakened/deleted behavior assertions. Adapter/in-memory diffs are purely additive.
8. **Audit event — PASS.** `MFA_TOTP_REPLAY_REJECTED` HIGH (`:208`), no `details` arg → carries only `{subjectType, severity}`, zero token/secret/hash. Rides the A1 seam: `audit()`→`resolveAuditActor(subject)`→customer→`auditActor.customer(id, accountId)`. Runtime-asserted HIGH (unit x2).
9. **Migration — PASS.** `git diff schema.prisma` = exactly the 2 nullable `Int?` columns (+JSDoc comment, NIST citation). `migration.sql` = 2 `ADD COLUMN … INTEGER`. `down.sql` (operator-driven) drops exactly those 2 (`IF EXISTS`), nothing else. Migration dir holds only `migration.sql`+`down.sql`.
10. **Scope — PASS.** No challenge store / JWT kind / step-2 route / use case / BF reorder (all PR2b-2/2b-3 files ABSENT; PR2b-3 sensitive files git-clean). Orphan `POST /auth/mfa/verify` still registered (`mfaRoutes.ts:525`, handler `:191-233`, `MfaVerifySchema:41`, ADMIN subject `:205`). Legacy `apps/api/src/auth/mfaService.ts` git-untouched, still has NO `claimTotpStep`/replay protection (expected — deletion is PR3).
11. **0-defect gate — PASS.** tsc `@ports/core`=0, `@apps/api`=0 (heap 6144); eslint `--max-warnings 0` on all 11 touched files=0; fitness #3/#9/#10/#18/#21/#23=0; tripwire vocabulary + #8 sprint refs CLEAN; `@file`/`@layer infrastructure` first in both new files.

### Build / test / gate evidence (commands + results)

- `pnpm --filter @apps/api exec vitest run tests/unit/mfaTotpSingleUse.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism` → **10/10**
- `… tests/unit/infrastructure/adapters/PrismaAdminMfaUserRepository.test.ts` → **19/19**
- `… tests/unit/infrastructure/adapters/PrismaCustomerMfaUserRepository.test.ts` → **19/19**
- `… tests/unit/unifiedMfaService.test.ts` → **19/19**
- `… tests/unit/mfaRoutes.test.ts` → **31/31** · `… tests/unit/authService.test.ts` → **24/24**
- `pnpm --filter @apps/api test:mfa` (node:test, real Postgres) → **21 pass / 0 fail / 0 cancelled**
- `pnpm --filter @apps/api exec node --import tsx --conditions development --env-file=/root/omni-post/.env --test --test-force-exit tests/integration/mfaTotpSingleUse.integration.test.ts` → **4 pass / 0 cancelled** (incl. concurrency)
- `pnpm --filter @ports/core exec tsc --noEmit` → **0** · `NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @apps/api exec tsc --noEmit` → **0**
- `eslint --max-warnings 0` (2 heap-capped batches, 11 files) → **0**
- Fitness **#3=0 #9=0 #10=0 #18=0 #21=0 #23=0**; tripwire + #8 CLEAN

### Issues

**CRITICAL: none.** The ~150s TOTP replay window (`TOTP_WINDOW=2`) is closed for both subjects; the fix is fail-closed and replay is provably impossible (time-invariant step mapping).

**WARNING**

- **W1 — Future-edge claim can lock a correct-clock device out for up to 60s; design-accepted but UNTESTED.** The monotonic invariant means claiming a future-edge step (delta up to +2 ≈ +60s) advances `mfaLastUsedTotpStep` ahead of real time; any subsequent token for a step ≤ the claimed one is then `ALREADY_USED`. Reaching this needs an abnormal precondition (a clock-ahead device / precomputed token claims N+2, then the SAME account presents a correct-time lower-step token within ≤60s — e.g. clock corrected mid-session, or a second correct-time device). This is **design-acknowledged and accepted** (design-pr2b Decision 2 "Known edge … accepted, conservative direction, NIST-permitted") and is the CORRECT invariant — accepting older in-window steps would REOPEN replay. It is **fail-closed** (worst case = a ≤60s self-inflicted login delay, never a bypass). The finding is the **coverage gap**: the "no-lockout" test only proves the happy path (delta-0 claim → strictly-greater next step); no test exercises the future-edge (+1/+2) claim → lower-token-rejected path. Non-blocking. Recommend one documenting test so the accepted tradeoff is auditable in code.

**SUGGESTION**

- **S1 — `computeTotpStep` `catch { return null }` (`:417`) maps an infra fault to a silent "invalid token".** A genuinely corrupt stored secret (base32 decode throw) resolves to `null` → falls through to backup → `INVALID_TOKEN`, not `DATABASE_ERROR`. Fail-closed and near-impossible (secrets are otplib-generated), but it muddies diagnostics for a real infra fault. Consider narrowing the catch or logging at WARN before returning null.
- **S2 — Integration concurrency test fidelity note.** `Promise.all` of two claims on one pooled Prisma client proves the invariant (exactly one CLAIMED) and is sufficient, but does not guarantee the two statements landed on distinct connections. The DB-level WHERE re-evaluation guarantees correctness regardless; no action required — recorded for completeness.

### Deviations from design/tasks

None. PR2b-1 implements exactly design-pr2b Decision 2 (DB column + CAS `claimTotpStep` both subjects + `checkDelta`-derived step + HIGH replay audit); the open question (otplib `checkDelta` signature) is resolved and confirmed at source. The intended behavior change (same-window TOTP reuse for login-then-regenerate/disable now rejected) is documented and tested. Challenge store / JWT / step-2 endpoint / BF reorder / orphan retirement / frontend correctly deferred to PR2b-2/PR2b-3; legacy deletion to PR3.

## Post-verify remediation (PR2b-1)

Owner policy: warnings resolved now, not carried. Fresh `sensitive-edit` token used for the `MfaService.ts` edit (Window). RED→GREEN strict TDD for both fixes.

- **S1 — RESOLVED.** `computeTotpStep`'s `try { … } catch { return null }` swallowed genuine infra faults (e.g. a corrupted/non-base32 `mfaSecret` making otplib's `checkDelta` throw) into the same `null` as a legitimate wrong-token rejection, so the caller fell through to the backup-code path and returned `INVALID_TOKEN` with no operator-visible signal. Fix: removed the catch entirely — `checkDelta` returning `null` (the ONLY legitimate rejection) still resolves to `null` with no throw; a genuine throw now propagates to `verifyMfaToken`'s (and `verifyTotp`'s only other caller, `verifyMfaSetup`'s) own outer `try/catch`, which already logs via `authLogger.error` and returns the honest `err("DATABASE_ERROR")`. Verified empirically that a secret containing a byte ≥128 (outside the base32-decodable ASCII range, e.g. `` `SECRET${String.fromCharCode(200)}X` ``) makes `@otplib/plugin-thirty-two`'s `thirty-two.decode` throw `Error: Invalid input - it is not base32 encoded string` synchronously inside `checkDelta` — this is the realistic on-disk-corruption trigger used for the RED test. RED (both subjects) confirmed 2 failures before the fix (`INVALID_TOKEN` received, `DATABASE_ERROR` expected); GREEN after removing the catch, 14/14. No caller regressed: `verifyMfaSetup`'s legitimate-wrong-token path (checkDelta→null, no throw) is unaffected — confirmed by `tests/mfa.test.ts` "should reject setup verification with invalid token" staying green (21/21 overall).
- **W1 — RESOLVED (documentation-by-test).** Added a parameterized (admin+customer) test proving the accepted future-edge tradeoff end to end: a clock-ahead device claims a future-edge step (`currentCounter+2`, `TOTP_WINDOW` boundary) → CLAIMED; a subsequently presented token for the TRUE current (lower) step is rejected as `ALREADY_USED`→`INVALID_TOKEN` (monotonicity is the invariant that prevents replay — accepting an older in-window step would reopen the hole this slice closes); once the wall clock advances strictly past the claimed step, a fresh token is accepted again (bounded ≤60s self-inflicted delay, never a bypass). Test + inline comment make the tradeoff auditable in code, not a "fix" — the underlying `MfaService.ts` CAS logic is unchanged.
- **S2 — NO ACTION.** Confirmed as recorded in the original report: the DB-level conditional `updateMany` WHERE re-evaluation under READ COMMITTED is what proves the invariant, independent of whether the two racing claims land on distinct pooled connections. No code or test change needed.

### Remediation gate (single-file re-runs, LXC-safe)

- `vitest run tests/unit/mfaTotpSingleUse.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism` → **14/14** (was 10; +2 new: S1 fail-closed, W1 future-edge documentation)
- `… tests/unit/unifiedMfaService.test.ts` → **19/19**
- `… tests/unit/mfaRoutes.test.ts` → **31/31**
- `pnpm --filter @apps/api test:mfa` (node:test, real Postgres) → **21 pass / 0 fail / 0 cancelled**
- `node --env-file=../../.env --conditions development --import tsx --test --test-force-exit tests/integration/mfaTotpSingleUse.integration.test.ts` → **4 pass / 0 cancelled**
- `pnpm --filter @ports/core exec tsc --noEmit` → **0** · `NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @apps/api exec tsc --noEmit` → **0**
- `eslint --max-warnings 0` (`MfaService.ts`, `mfaTotpSingleUse.test.ts`) → **0**
- Fitness **#3=0**

### Result

0 CRITICAL, 0 WARNING, 0 SUGGESTION open. PR2b-1 is clean for merge.

**next_recommended: commit PR2b-1** (`size:exception` ~665 lines, rationale in PR body) → sdd-apply PR2b-2. The single WARNING is non-blocking (design-accepted, fail-closed, no failing/untested MERGE-BLOCKING scenario) and does NOT block archive of this slice.

---

## PR2b-2 — Client-portal MFA challenge UI (INERT until PR2b-3)

**Mode**: openspec (mirrored to engram). **Verdict: PASS WITH WARNINGS** (0 CRITICAL, 1 WARNING, 2 SUGGESTION). Adversarial re-derivation at source + full test execution.

### Scope (fitness #6-style) — CLEAN

`git diff --name-only` + untracked = entirely under `apps/client/**` plus `openspec/changes/mfa-consolidation/tasks.md`. Zero `apps/api/**`, `infra/**`, `packages/**`. Backend confirmed still inert: `LoginCustomerUseCase.ts` has NO `mfaRequired`/`mfaEnabled` branch; orphan `POST /auth/mfa/verify` still registered (`mfaRoutes.ts:525`, hardcoded `MFA_SUBJECT_TYPE.ADMIN` at `:205`) — PR2b-3's job.

### Completeness — tasks 2b2.1–2b2.10 all `[x]`, each mapped to code

Verified in source: authApi fields+`completeMfaLogin` (2b2.1/2b2.2), authContext return-type change + `completeMfaLogin` (2b2.3), proxy `AUTH_LOGIN_MFA_PATH` (2b2.4/2b2.5), split action/RTL tests (2b2.6), `MfaChallengeForm.tsx`+two-step page (2b2.7), `loginAction`/`completeMfaLoginAction` (2b2.8), i18n en+es (2b2.9), 0-defect gate (2b2.10).

### Tests executed (LXC-safe: `vitest run <file> --pool=forks --maxWorkers=1 --no-file-parallelism`, `NODE_OPTIONS=--max-old-space-size=3072`, `timeout 300`)

| File                                                 | Result                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `app/api/backend/[...path]/route.test.ts`            | **4/4**                                                     |
| `app/actions/auth.test.ts`                           | **7/7**                                                     |
| `components/auth/MfaChallengeForm.test.tsx`          | **5/5**                                                     |
| `lib/auth/__tests__/authApi.test.ts`                 | **30/30**                                                   |
| `tests/integration/authContext.integration.test.tsx` | **11/11** (0 skipped — `describeIf` resolved to `describe`) |

**Total 57/57, 0 fail, 0 skipped, 0 cancelled.** Counts match the self-report exactly.

### 0-defect gate (re-run at source)

- `tsc --noEmit` @apps/client (`--max-old-space-size=6144`) → **0**
- `eslint --max-warnings 0` on all 11 touched files → **0**
- Fitness **#9** @file (11/11 present) · **#10** @layer (all `infrastructure`, no forbidden values) · **#12** @component (`MfaChallengeForm`, `LoginPage`, `AuthProvider`) · **#17** client `process.env` exact grep → **0**
- No tripwire vocabulary, no sprint/phase refs in touched source.

### LOAD-BEARING security check — PASS (verified in code AND by the test's real assertions)

- `route.ts`: diff is purely additive — `AUTH_LOGIN_MFA_PATH="auth/customer/login/mfa"` added to (a) the `parseRememberMe` branch (`:105`) and (b) the cookie-persist branch (`:141-155`). The non-MFA `AUTH_LOGIN_PATH`/`AUTH_REGISTER_PATH`/`refresh`/`logout` branches are **byte-for-byte unchanged**.
- Step-2 body strip verified through the REAL helper: `persistTokensFromAuthResponse` → `stripTokensFromResponse` (`sessionCookie.ts:113-118`) removes `accessToken`+`refreshToken` from `data` and returns the sanitized JSON; cookies set httpOnly via `setSessionCookie`/`setRefreshCookie`.
- `route.test.ts` genuinely asserts NO leak, not merely cookie-persistence: test 2 (`:100-121`) reads `res.text()` and asserts `not.toContain("ACCESS-TOKEN")`, `not.toContain("REFRESH-TOKEN")`, `toContain("u1")` — a true no-leak assertion, NOT a false pass. Step-1 challenge passes through with **0 cookies** (test 4, `:145-161`). rememberMe TTL (30d) honored on step-2 (test 3).

### Behavioral verification per spec

- **INERT guarantee — HOLDS.** `loginAction` only enters the challenge branch when `readMfaChallenge(data)` returns non-null, i.e. backend sends `mfaRequired===true`+`challengeToken` — which the backend never does yet. `page.tsx` challenge render is gated on `state.mfaChallenge`. `authContext.login` return-type change `throw → Promise<MfaChallenge|null>` breaks NO production consumer: grep of `apps/client` shows every `useAuth()` call destructures only `{ user }` / `{ user, logout }` — none reads `login`/`completeMfaLogin`. Register auto-login `null` path preserved (`authContext.tsx:172`, return value ignored; a just-registered user has `mfaEnabled=false`).
- **authApi/authContext** — `MfaChallenge` gains `challengeToken`+`expiresInSeconds` (`authApi.ts:75-77`); `completeMfaLogin` POSTs proxy `/login/mfa` (`:165-187`); `login` maps `data.mfaRequired` (`:143-151`). Integration test asserts challenge-return-not-throw (`:133`), null path (`:161`), completeMfaLogin sets user (`:180`) — behavioral, not tautological.
- **completeMfaLoginAction** — forwards XFF via `forwardedForHeaders` (`auth.ts:197`), persists via `setSessionCookie`/`setRefreshCookie({rememberMe})` (`:229-231`), redirects `/{locale}/dashboard` (`:241`); wrong-code (401+`INVALID_MFA_CODE`) keeps challenge, 401-other/503 fall back (`:213-219`). Unknown error → `challengeGone=true` → safe fallback to password step (never strands, never bypasses MFA).
- **MfaChallengeForm.tsx** — `@file`/`@component`/`@layer infrastructure` tags first (within first ~370 bytes, well under the 1500-byte stop-hook window); prop docs on `MfaChallengeFormProps` interface not the function; challenge in `useActionState`+hidden input. **Whole slice grep: ZERO `localStorage`/`sessionStorage`** (only a prohibiting comment at `MfaChallengeForm.tsx:9`). RTL covers password⇄challenge transition (tests 4-5), wrong-code-keeps-challenge (test 2), expired-falls-back (test 3).
- **i18n** — 7 `auth.mfa*` keys present in BOTH `en.json` and `es.json` (no missing-key mismatch); es is neutral professional Spanish (tuteo "Ingresa"/"Inicia", NOT voseo).
- **Test honesty** — the moved request-shape assertion genuinely lives in its new home: `auth.test.ts:124-141` asserts the `POST /auth/customer/login/mfa` URL + `x-forwarded-for` relay + exact body; `authApi.test.ts:195-218` asserts the proxy-path shape. Nothing dropped.

### Issues

**CRITICAL** — none.

**WARNING — [W-PR2b-2-1] Cross-slice error-code contract is not satisfiable by the design's stated backend approach; current tests paper over it.**
`completeMfaLoginAction` (`apps/client/app/actions/auth.ts:203-214`) discriminates wrong-code (retry, keep challenge) from invalid-challenge (fall back to password) via `errorData.code === "INVALID_MFA_CODE"` — a machine STRING expected in the response body. But the existing customer-auth error path that Design Decision 6 says to "mirror" (`customerAuthRoutes.ts:148-162`) routes through `sendError` (`BaseRouteHandler.ts:281-285`), which emits `{ ok:false, error:<message> }` with **no machine `code` string** — the `code` in each errorMap is the HTTP status NUMBER, consumed as transport status, never placed in the body. If PR2b-3 mirrors that pattern verbatim, a wrong TOTP code returns 401 with body `{ ok:false, error:"Invalid MFA code." }`; the frontend then computes `errorCode=undefined`, `undefined !== "INVALID_MFA_CODE"` → `challengeGone=true` → the UI drops the user back to the PASSWORD step on every typo — breaking Decision 6's core goal ("a TOTP typo must not force password re-entry", the weakness the hybrid exists to avoid). `auth.test.ts:143-150` is GREEN only because it mocks a `code:"INVALID_MFA_CODE"` field the current backend shape does not produce — false confidence. Not CRITICAL because this slice is INERT and the fallback direction is SAFE (no strand, no MFA bypass), but PR2b-3 MUST emit a machine `code:"INVALID_MFA_CODE"` string in the step-2 401 body (a deliberate deviation from `sendError`'s current shape) OR realign the frontend discriminator (e.g. match the design's distinct client-facing MESSAGE). Documented as a contract in apply-progress; recorded here as the concrete PR2b-3 acceptance condition.

**SUGGESTION — [S-PR2b-2-1] (pre-existing, out of scope)** `stripTokensFromResponse` (`sessionCookie.ts:113-118`) strips tokens only from `parsed.data`, while `readAuthTokens` (`:98-107`) also reads top-level `accessToken`/`refreshToken`. Not reachable with the current `{ data:{...} }` success shape (proven by route.test.ts test 2), but a top-level-token response would leak. Defense-in-depth: strip both levels. Predates PR2b-2.

**SUGGESTION — [S-PR2b-2-2] (pre-existing)** `authContext.integration.test.tsx:32-38,54` keeps a `describe.skip` fallback that would SILENTLY skip all 11 tests if the `useAuth` export ever moved. All 11 ran here, but a hard import would fail loudly instead (CODING_STANDARDS "Zero Cancelled/Skipped" spirit).

### Result

Load-bearing token-leak fix verified in code and by a real no-leak assertion. Scope, INERT guarantee, 0-defect gate, i18n parity, and 57/57 tests all confirmed at source. One non-blocking cross-slice WARNING (safe fallback, inert today) to hand to PR2b-3, plus two pre-existing SUGGESTIONs. **PR2b-2 is clean for commit/merge (`size:exception`, stacked-to-main, after PR2b-1, before PR2b-3).** The WARNING does NOT block this slice's archive; it is an acceptance condition for PR2b-3.

---

## PR2b-3 — Backend login MFA gate + orphan retirement — VERDICT: PASS WITH WARNINGS (0 CRITICAL, 2 WARNING, 2 SUGGESTION)

**Mode**: openspec (mirrored to engram). Adversarial re-derivation at source + full test execution against the UNCOMMITTED working tree on `workstream/cluster-b-mfa` (nothing committed for PR2b-3; PR2b-1 `da8ef686` + PR2b-2 landed). THE authentication gate of the chain — verified hardest-first.

### Merge-blocking security invariants — ALL PROVEN (code + runtime)

1. **Fail-CLOSED end-to-end — NO fail-open path exists.** `RedisMfaChallengeStoreAdapter.consume` returns typed `err("STORE_ERROR")` on any Redis fault (`RedisMfaChallengeStoreAdapter.ts:57-59`); the use case maps it to `MFA_UNAVAILABLE` (`CompleteCustomerMfaLoginUseCase.ts:162-165`) → route 503 + WARN `mfa_challenge_store_unavailable` (`customerAuthRoutes.ts:273-277,310-317`). Traced the full chain: a store error CANNOT become a 200/session. At step 1, `issue` failure → `MFA_UNAVAILABLE` BEFORE any `recordLogin`/mint, and the `mfaEnabled` branch returns without falling through to the non-MFA session path (`LoginCustomerUseCase.ts:201-222`). Outer `try/catch` returns `INTERNAL_ERROR` (500) on any throw — never success. Runtime: `LoginCustomerUseCase.test.ts` (MFA_UNAVAILABLE, signMfaChallengeToken NOT called), `CompleteCustomerMfaLoginUseCase.test.ts` (consume STORE_ERROR → MFA_UNAVAILABLE, `save` NOT called), `customerLoginMfaRoutes.test.ts` (503 + WARN both steps).
2. **Single-use is genuinely atomic on real Redis.** `issue` = `SET key "1" EX ttl NX`; `consume` = `DEL` with `removed === 1 ? "CONSUMED" : "NOT_FOUND"` (`RedisMfaChallengeStoreAdapter.ts:35-61`) — single-command atomicity, no Lua, no GETDEL. **Integration test against REAL Redis (`omnipost-infra`, `pnpm db:up`) 3/3**: two/three concurrent `consume` of one jti → EXACTLY ONE `CONSUMED`, the rest `NOT_FOUND` (`customerLoginMfa.integration.test.ts:65-79`); sequential second consume `NOT_FOUND`; TTL expiry drops the jti. Real-infra atomicity anchor, not a mock.
3. **Step-2 error contract — top-level `code`, cross-slice CONTRACT SATISFIED (prior W-PR2b-2-1 RESOLVED).** A wrong code returns 401 with a TOP-LEVEL `code: "INVALID_MFA_CODE"` via `ctx.reply.code(...).send(...)` — NOT `sendError` (`customerAuthRoutes.ts:294-297`). The LIVE portal path (`completeMfaLoginAction`) `fetch`es the backend DIRECTLY (`apps/client/app/actions/auth.ts:197`, bypassing the proxy) and reads `errorData.code ?? errorData.data?.code` (`:205`) → gets the top-level string → `challengeGone = status===503 || (status===401 && code!=="INVALID_MFA_CODE")` (`:216`). Wrong code keeps the challenge (retry); invalid/expired/consumed challenge (401 `INVALID_CHALLENGE`) and store outage (503) fall back. Runtime: `customerLoginMfaRoutes.test.ts` asserts the REAL top-level `body.code`.
4. **Anti-oracle — byte-identical `INVALID_CHALLENGE`.** Expired / consumed / foreign / user-vanished / mfa-since-disabled and `CHALLENGE_BINDING_MISMATCH` all collapse to the SAME 401 body `{ok:false, error:"MFA challenge is invalid or expired. Please sign in again.", code:"INVALID_CHALLENGE"}` (`customerAuthRoutes.ts:282-293`). Binding-mismatch + store-outage WARNs are server-side `authLogger` only — NOT in the response. Runtime: `customerLoginMfaRoutes.test.ts:105-127` asserts `binding.body === invalid.body` byte-identical + WARN fires. Timing considered: attacker-controllable branches (expired, binding mismatch) both return pre-DB/pre-BF; the slower branches (consumed jti, vanished user) require a valid, correctly-bound, non-expired token that already passed verify — unreachable without the legitimate credential. Not a practical oracle.
5. **No session minted pre-MFA.** `LoginCustomerUseCase` `mfaEnabled` branch performs ZERO of `recordLogin`/`save`/`recordSuccessfulAttempt`/`signAccessToken`/`signRefreshToken` — only `issue` + `signMfaChallengeToken` (`LoginCustomerUseCase.ts:201-222`). Runtime: `LoginCustomerUseCase.test.ts:247-269` asserts `not.toHaveBeenCalled()` on every mint/record path.
6. **BF ordering.** Success recorded ONLY after `verifyMfaToken` ok AND `consume` === `CONSUMED` AND `save` ok (`CompleteCustomerMfaLoginUseCase.ts:137-196`); a wrong code → `recordFailedAttempt({failureReason:"MFA_FAILED"})` and does NOT consume the challenge (consume is strictly after verify). Same BF identifier (email) as step 1. Non-MFA login records success exactly once, never touches the store. Runtime: `CompleteCustomerMfaLoginUseCase.test.ts`, `LoginCustomerUseCase.test.ts`.
7. **JWT kind isolation, both directions.** Challenge sign+verify pin `algorithms:["HS256"]`, `issuer:"omnipost-customer"`, dedicated `audience:"omnipost-customer-mfa"` + payload `type:"customer-mfa-challenge"` (`customerJwt.ts:158-191`). Challenge fails `verifyCustomerToken`/`verifyCustomerRefreshToken`; access/refresh fails `verifyCustomerMfaChallengeToken` (aud+type). Runtime: `customerJwt.test.ts` 5/5 both directions throw.
8. **Tenant context.** Step-2 handler runs `withSystemContext("customer-mfa-login", ...)` (`customerAuthRoutes.ts:241`); the CustomerUser read/write is inside it. `resolveClientIp` on BOTH handlers, never `request.ip` (`customerAuthRoutes.ts:94-101,173,245`); route test asserts the trusted XFF entry reaches the use case. See W-PR2b-3-1 for the `accountId`-claim gap.
9. **Orphan retirement clean + complete.** `POST /auth/mfa/verify` (registration + handler + `MfaVerifySchema`) DELETED from `mfaRoutes.ts`; LIVE `/auth/mfa/verify-setup` remains (`mfaRoutes.ts:463-470`). Repo-wide grep: residual `/auth/mfa/verify` refs are only the intentionally-kept rate-limit rule (prefix-covers `verify-setup`, comment refreshed, `httpRateLimitPreHandler.ts:129-134`), the 404 test, and the DISTINCT live admin route `/admin/auth/mfa/verify`. `api-generated/types.gen.ts` regenerated (orphan `url:"/auth/mfa/verify"` removed, `url:"/auth/customer/login/mfa"` added — verified). 3 docs + k6 helper updated. Runtime: `mfaRoutes.test.ts` 29/29 (orphan → 404), `authRateLimit.test.ts` 25/25.
10. **Admin regression — NONE.** `MfaService` diff is ADDITIVE only (`implements MfaVerificationPort`; types from `@ports/core`; local `MfaVerificationResult`/`VerifyTokenError` dropped) — PR2b-1's TOTP single-use claim logic (`MfaService.ts:196-210`) is UNTOUCHED (not in the diff; committed `da8ef686`). Runtime: `test:mfa` 21/21, `unifiedMfaService` 19/19, `mfaTotpSingleUse` 14/14, `adminAuthService` 15/15, `authService` 24/24.

### DI / hexagonal — CLEAN

2 new tokens only: `TOKENS.MfaChallengeStore` + `TOKENS.CompleteCustomerMfaLoginUseCase` (`types.ts:27,447`). `MfaVerificationPort` resolves the EXISTING `TOKENS.MfaService` typed as the port (`setupCustomerAuthUseCases.ts:102`) — no 3rd token, fitness #21 at one instance. `RedisMfaChallengeStoreAdapter` constructed only in the composition root on its own `createRedisConnection()` (`setupServices.ts:861-871`). The `@core/customer-auth` use case imports only `@core/domain`/`@ports/core`/`@shared/types`/node crypto — no infra import. UoW wraps `recordLogin`+`save`; `recordSuccessfulAttempt` runs OUTSIDE the tx (`CompleteCustomerMfaLoginUseCase.ts:170-196`).

### Tests executed (LXC-safe: vitest `--pool=forks --maxWorkers=1 --no-file-parallelism`, `NODE_OPTIONS=--max-old-space-size=3072`, `timeout`; node:test `--import tsx --conditions development --test --test-force-exit`, `pnpm db:up` first)

| File                                                                                | Result    |
| ----------------------------------------------------------------------------------- | --------- |
| `packages/core/customer-auth/.../CompleteCustomerMfaLoginUseCase.test.ts`           | **12/12** |
| `packages/core/customer-auth/.../LoginCustomerUseCase.test.ts`                      | **9/9**   |
| `packages/core/customer-auth/.../challengeBinding.test.ts`                          | **3/3**   |
| `apps/api/tests/unit/customerJwt.test.ts`                                           | **5/5**   |
| `apps/api/tests/unit/infrastructure/adapters/RedisMfaChallengeStoreAdapter.test.ts` | **7/7**   |
| `apps/api/tests/unit/customerLoginMfaRoutes.test.ts`                                | **8/8**   |
| `apps/api/tests/integration/customerLoginMfa.integration.test.ts` (REAL Redis)      | **3/3**   |
| `apps/api/tests/unit/mfaRoutes.test.ts` (orphan → 404)                              | **29/29** |
| `apps/api/tests/unit/authRateLimit.test.ts`                                         | **25/25** |
| `apps/api/tests/unit/customerAuthUseCases.test.ts`                                  | **25/25** |
| `apps/api/tests/unit/unifiedMfaService.test.ts`                                     | **19/19** |
| `apps/api/tests/unit/mfaTotpSingleUse.test.ts`                                      | **14/14** |
| `apps/api/tests/unit/admin/adminAuthService.test.ts`                                | **15/15** |
| `apps/api/tests/unit/authService.test.ts`                                           | **24/24** |
| `apps/api/tests/mfa.test.ts` (`test:mfa`, node:test)                                | **21/21** |

**Total 219/219, 0 fail, 0 skipped, 0 cancelled.** Every count matches the self-report. Modified tests contain no `.skip`/`.only`/`xit`; the orphan test change (3× 400 → 1× 404) is a STRENGTHENING; new tests assert BEHAVIOR (real error codes, real Redis atomicity, byte-identical bodies), not tautological mocks.

### 0-defect gate (re-run at source)

- `tsc --noEmit`: @ports/core **0** · @core/domain **0** · @core/customer-auth **0** · @shared/types **0** · @apps/api (`--max-old-space-size=6144`) **0**.
- `eslint --max-warnings 0`: 10 touched `apps/api/src` files **0** · 8 touched package files **0**.
- Fitness **#3 0** · **#9 0** · **#10 0** · **#16 0** · **#18 0** · **#21 0** · **#28 0** · **#8 0** (no sprint/phase refs on added lines). Tripwire vocabulary sweep on the diff **0**. `any` in new src **0**. `@file`/`@layer` first in every new file.

### Issues

**CRITICAL** — none. No fail-open path, no distinguishable anti-oracle response, no pre-MFA token leak.

**WARNING — [W-PR2b-3-1] The challenge's `accountId` claim is carried but NEVER cross-checked; the step-2 lookup loads by `sub` alone.** `CompleteCustomerMfaLoginUseCase.execute` reads `claims.iph/uah/sub/jti` but never `claims.accountId` — the user is loaded via `customerUserRepo.findById(claims.sub)` under `withSystemContext` with no `user.accountId === claims.accountId` guard (`CompleteCustomerMfaLoginUseCase.ts:104-109`). DEVIATES from Design Decision 7 and the domain doc-comment (`CustomerTokenService.ts:53` "keeps the step-2 lookup tenant-explicit"); the claim is now dead on the auth gate. **NOT exploitable today**: the challenge JWT is HMAC-signed (no forge/tamper), `sub` is a globally-unique PK, and step 1 always sets `sub`+`accountId` from the same row (consistent by construction). Recommendation (defense-in-depth + honor design intent): add `if (user.accountId !== claims.accountId) return err("INVALID_CHALLENGE");` after the load, OR downgrade the design/comment to informational-only. Non-blocking.

**WARNING — [W-PR2b-3-2] Full wired-stack HTTP flow (task 2b3.21) + Playwright e2e NOT executed.** Every merge-blocking invariant is proven at the appropriate layer (unit + real-Redis integration + route-level), but the end-to-end composition — DI-resolved live route → real `RedisMfaChallengeStoreAdapter` + real `MfaService` + real JWT → proxy/cookie persistence, in ONE booted API(:3000)+Next pass — was not run (needs a running dev server the executor does not boot; same constraint as `mfaCustomer.integration.test.ts` + `auth.spec.ts:231-254`). DI wiring is verified by source inspection + a clean `@apps/api` tsc. **Recommendation**: a reviewer should run the manual enroll→login→challenge→complete→cookie flow against a booted stack (and/or the Playwright MFA spec) before merge to close the composition-level assurance. Matches the apply's honest disclosure. Non-blocking given per-link coverage.

**SUGGESTION — [S-PR2b-3-1]** The domain comment `CustomerTokenService.ts:53` ("keeps the step-2 lookup tenant-explicit") is now inaccurate — align with W-PR2b-3-1's resolution.

**SUGGESTION — [S-PR2b-3-2] (carried from PR2b-2 S-PR2b-2-1, still open)** `stripTokensFromResponse` strips only `parsed.data`; the LIVE server-action path uses direct `fetch` + `setSessionCookie` (tokens never reach the browser) and the proxy path is dead on the live flow — no leak today. Defense-in-depth: strip both levels. Out of PR2b-3 scope.

### Result

The highest-stakes slice holds. Fail-closed store, atomic single-use on real Redis, byte-identical anti-oracle, no pre-MFA session, correct BF ordering, bidirectional JWT-kind isolation, clean orphan retirement, and zero admin regression are all proven in code AND at runtime (219/219, 0 cancelled). 0-defect gate green (tsc 0 across 5 packages, eslint 0, fitness #3/#8/#9/#10/#16/#18/#21/#28 = 0). Two non-blocking WARNINGs: a dead `accountId` claim (design-vs-impl deviation, not exploitable) and the un-run full HTTP/e2e composition (each link individually proven). **PR2b-3 is clean for commit/merge (`size:exception`, stacked-to-main, merges LAST after PR2b-1 + PR2b-2).** Neither WARNING blocks archive; both belong on the reviewer/merge checklist. next_recommended: **sdd-archive** (after the manual e2e spot-check).

---

## Post-verify remediation (PR2b-3)

Owner policy: resolvable warnings get fixed now, not carried. No `sensitive-edit` token needed — the fix is entirely inside `packages/core/customer-auth` (non-sensitive). Strict TDD RED→GREEN, RED confirmed by temporarily removing the check and re-running the new test before reapplying.

| Finding                                                  | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W-PR2b-3-1 — dead `accountId` tenant-binding claim**   | **RESOLVED.** `CompleteCustomerMfaLoginUseCase.execute` now cross-checks `user.accountId !== claims.accountId` immediately after loading the user by `sub` (`CompleteCustomerMfaLoginUseCase.ts:111-120`, step "3b"), returning byte-identical `err("INVALID_CHALLENGE")` — same as expired/consumed/foreign — and does NOT consume the `jti` (a mismatch is not a legitimate burn attempt; consuming it would let an attacker exhaust a victim's pending challenge without the real code). Placed BEFORE the `mfaEnabled`/`isActive` re-check and BEFORE the BF gate/second-factor verify, so a tenant mismatch fails as early as the binding check. RED confirmed: with the check temporarily removed, the new test failed (`assert.ok(!mismatched.ok)` — got `true` instead of the expected falsy `ok`); reapplying the check turned it GREEN, 13/13 (was 12). The domain doc-comment (`CustomerTokenService.ts:53`, S-PR2b-3-1) was realigned to describe the now-enforced invariant instead of the dead one. |
| **W-PR2b-3-2 — full wired-stack HTTP flow not executed** | **DEFERRED (recorded, not fixed in this batch).** Confirmed as a manual merge-readiness step: a reviewer runs the enroll→login→challenge→complete→cookie flow against a booted API(:3000)+Next stack (and/or the Playwright `auth.spec.ts:231-254` MFA spec) before merge. Every individual link (challenge store atomicity on real Redis, route-level error contract, JWT kind isolation, DI wiring via clean `tsc`) is already proven at its own layer; only the full-stack composition is un-run, and the apply/verify executor does not boot a dev server. Tracked on the reviewer/merge checklist, same disposition as the original report.                                                                                                                                                                                                                                                                                                                                                                  |
| **Adapter-test relocation**                              | **CONFIRMED.** `RedisMfaChallengeStoreAdapter.test.ts` was moved from the flat `apps/api/tests/unit/` path to the canonical `apps/api/tests/unit/infrastructure/adapters/` directory (mirroring the Prisma adapter tests' location); its `../../src/` imports were rewritten to `../../../../src/`. Re-run at the new path: **7/7**, and the old flat path no longer exists (`git status` shows the file only under the new path).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Gate (post-remediation, all green, LXC-safe)

- `pnpm --filter @core/customer-auth exec vitest run tests/unit/CompleteCustomerMfaLoginUseCase.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism` → **13/13** (was 12; +1 tenant-binding anti-oracle test)
- `pnpm --filter @apps/api exec vitest run tests/unit/infrastructure/adapters/RedisMfaChallengeStoreAdapter.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism` → **7/7** (relocation confirmed)
- `pnpm --filter @core/customer-auth exec tsc --noEmit` → **0** · `pnpm --filter @core/domain exec tsc --noEmit` → **0** · `NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @apps/api exec tsc --noEmit` → **0**
- `eslint --max-warnings 0` on `CompleteCustomerMfaLoginUseCase.ts`, `CompleteCustomerMfaLoginUseCase.test.ts`, `CustomerTokenService.ts`, `RedisMfaChallengeStoreAdapter.test.ts` → **0**
- Fitness **#3** (no `any` in `apps/api/src/{domain,application,infrastructure}`) = **0**

### Result

W-PR2b-3-1 RESOLVED (tenant-binding invariant now enforced, byte-identical anti-oracle preserved, RED→GREEN proven). W-PR2b-3-2 remains an explicit reviewer/merge-checklist item (manual e2e spot-check), not a code defect — unchanged disposition from the original report. Adapter-test relocation confirmed green at its new canonical path. **0 CRITICAL, 0 resolvable WARNING open, 1 deferred WARNING (manual checklist item, non-blocking), 1 SUGGESTION (S-PR2b-3-2, pre-existing, out of scope) unchanged.**

**next_recommended: sdd-archive** (after the manual e2e spot-check on the merge/reviewer checklist).

---

## PR3 — Admin Backfill + Legacy Service Retirement

**Verdict: PASS WITH WARNINGS** (0 CRITICAL, 2 WARNING, 2 SUGGESTION).

Adversarial re-derivation at source + full runtime execution on the UNCOMMITTED
working tree (`workstream/cluster-b-mfa`; nothing committed for PR3). This is a
data-migration that mutates a security-dual column (`AdminUser.passwordResetToken`
holds both legacy MFA backup-code JSON _and_ genuine reset tokens) plus the deletion
of a service — a mis-classifying guard would corrupt reset tokens or silently lose
backup codes. Every such path was hunted and PROVEN safe (code + runtime).

### Data-corruption paths — ALL PROVEN SAFE (headline)

- **Guard cannot misclassify a non-MFA value.** `parseLegacyBackupBlob`
  (`infra/prisma/scripts/backfill-admin-mfa-backup-codes.ts:35-53`) migrates a row
  IFF the value is a non-empty JSON array whose every element `startsWith("$argon2id$")`.
  Verified at runtime against a 14-case adversarial matrix (throwaway probe importing
  the exported guard) — **0 throws, 0 misclassifications**: null, genuine UUID reset
  token, `CHANGE_REQUIRED` sentinel, empty array `[]`, malformed JSON starting with
  `[`, array of non-argon2 strings, mixed `[valid, non-hash]`, non-string element,
  nested array, JSON object, `[CHANGE]`-shaped non-array, and a bcrypt-hash array ALL
  return `null` (skip); only genuine single/double argon2id arrays migrate. Ordering
  is correct: `parsed.length === 0` is checked BEFORE `.every(...)`, so the JS
  `[].every()===true` foot-gun cannot mis-fire on an empty array. `JSON.parse` is in
  try/catch → malformed input is skipped, never thrown.
- **Cleanup cannot null a pending genuine reset token.** `runCleanup`
  (`:167-206`) is triple-gated: the query requires `passwordResetToken startsWith "["`
  AND `mfaBackupCodes isEmpty:false`, and the in-loop `parseLegacyBackupBlob(...) === null`
  re-check skips anything that isn't a genuine argon2id array. A UUID reset token does
  not start with `[` (never fetched) and fails the guard (defense-in-depth). Integration
  test 7 asserts on REAL Postgres that a pending `randomUUID()` token and the
  `CHANGE_REQUIRED` sentinel are NEVER nulled while the migrated legacy source IS nulled.
- **Cleanup cannot run before codes are safely persisted.** The `mfaBackupCodes isEmpty:false`
  query filter means a legacy row whose codes have NOT been copied yet is never fetched
  by cleanup → the source is preserved until the codes exist in the canonical column.
  Even a premature operator `--cleanup` cannot lose codes. `main()` runs
  backfill→verify→(cleanup only behind `--cleanup`) in that order (`:231-257`), so a
  single `--cleanup` invocation populates `mfaBackupCodes` first.

### Behavioral compliance matrix — integration test, real Postgres

`cd apps/api && (source /root/omni-post/.env) node --conditions development --import tsx --test --test-force-exit tests/integration/backfillAdminMfaBackupCodes.integration.test.ts`
→ **7/7 pass, 0 fail, 0 cancelled, 0 skipped.** Every `it()` asserts BEHAVIOR against a
real DB (no mocks); none weakened:

| #   | Scenario (spec/contract)                                                         | Evidence                                                                     | Status |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| 1   | Legacy blob → hashes copied into `mfaBackupCodes`, source RETAINED               | `deepStrictEqual(mfaBackupCodes,[A,B])` + `passwordResetToken===LEGACY_BLOB` | PASS   |
| 2   | Idempotent — re-run does not re-migrate                                          | before/after `mfaBackupCodes` equal; query filters `isEmpty:true` (`:75`)    | PASS   |
| 3   | Genuine UUID reset token SKIPPED, untouched                                      | `mfaBackupCodes===[]` + token intact                                         | PASS   |
| 4   | `CHANGE_REQUIRED` sentinel SKIPPED, untouched                                    | `mfaBackupCodes===[]` + sentinel intact                                      | PASS   |
| 5   | Row with pre-existing codes SKIPPED, never overwritten                           | `mfaBackupCodes===[EXISTING]` unchanged                                      | PASS   |
| 6   | `verifyIntegrity` counts `migrated <= sourceMatching`, source retained           | numeric invariant asserted                                                   | PASS   |
| 7   | Cleanup nulls only guard-matched+codes-present; pending reset token never nulled | migrated→null, UUID+sentinel intact                                          | PASS   |

### Idempotency + source retention — CONFIRMED

`runBackfill` (`:64-108`) selects `mfaBackupCodes:{isEmpty:true}` at query level and only
sets `mfaBackupCodes` (never touches `passwordResetToken`). Re-run migrates nothing;
pre-existing codes never overwritten. Keyset batching (`id:{gt:lastId}`, `orderBy id asc`,
`take 200`, `lastId` advanced first-in-loop) is robust to the filter-mutation the update
causes and cannot loop infinitely on skipped rows. Test 2 proves the re-run no-op.

### Import-safety — CONFIRMED

`isDirectRun()` (`:216-222`, `import.meta.url === pathToFileURL(process.argv[1]).href`)
gates the CLI `main()`. Proof: the adversarial guard probe imported the module with
`DATABASE_URL` UNSET and ran to completion WITHOUT throwing `"DATABASE_URL is required"`
— i.e. `main()` did not self-execute on import; and the integration test statically imports
the three exports and drives them without the module connecting/exiting.

### Legacy deletion — COMPLETE & SAFE

- `apps/api/src/auth/mfaService.ts` (498 lines) is ABSENT (`git status`: unstaged `D`).
- `tsc --noEmit` @apps/api (heap 6144) = **0** — nothing dangles on the deleted file.
- Zero real imports of `auth/mfaService` repo-wide. Every `MfaService` import in `src/` and
  `tests/` resolves to the unified `src/admin/auth/MfaService.js` (verified by import-line grep,
  27 sites). The only 3 residual textual mentions of `auth/mfaService.ts` are genuine `why`
  comments, NOT code: `setupServices.ts:190` (documents the closed single-registration
  invariant — accurate post-deletion, valuable, no edit needed), `tests/mfa.test.ts:26`
  (historical note in the repointed suite), and the backfill test's own JSDoc `:9`.
- `tests/unit/mfaService.test.ts` (590 lines, legacy-only `passwordResetToken`-storage
  assertions) deleted; those assertions describe a storage mechanism the unified service no
  longer uses, so their removal is correct, not lost coverage.

### Parity preserved — runtime verified

- `vitest run tests/unit/unifiedMfaService.test.ts` → **19/19** (setup, TOTP+backup-code verify,
  regenerate, admin-force-disable both subjects, status — no secret leakage).
- `vitest run tests/unit/mfaTotpSingleUse.test.ts` → **14/14** — PR2b-1 TOTP single-use/replay
  rejection INTACT after the deletion.
- Backup codes are argon2id-hashed and 8-char-derived per the unified service
  (`MfaService.ts:8,42-43`), which matches the guard's `$argon2id$` prefix check — the
  migrated hashes are exactly what the legacy service stored.

### Repointed tests (15 DI-bootstrap-only) — mechanical, sound

Diffs are a pure constructor-signature migration: `new MfaService(adminUserRepo, audit)` →
`new MfaService(new PrismaAdminMfaUserRepository(p), new PrismaCustomerMfaUserRepository(p), audit)`

- import path `auth/mfaService.js` → `admin/auth/MfaService.js`. NO MFA assertion touched (these
  suites never exercise MFA; the service is a DI dependency of `AuthService`). Representative runtime
  check: `vitest run tests/unit/rbacRoutes.test.ts` → **38/38**.

### Canon + fitness gate — all green

- `eslint --max-warnings 0` on the new script + new test → **0**.
- New script: **0** raw queries (fitness #23 — also out of #23 scope, in `infra/prisma/scripts/`),
  **0** `any`, **0** time-bomb words. `@file`/`@description`/`@layer infrastructure` tags FIRST,
  then `// canon-exception: migration:2026-07-11` — a valid Pragmatic-Exceptions scenario
  (`migration:<ts>`) for a one-off migration script using injected/direct Prisma.
- Fitness #9 (@file) present on both new files; #10 (@layer) valid on both.
- Typed Prisma only (`findMany`/`update`); no `$queryRaw`/`$executeRaw`.

### Scope — CLEAN

`git status` shows exactly PR3 surface: deleted `auth/mfaService.ts` + `tests/unit/mfaService.test.ts`,
15 test repoints, new `infra/prisma/scripts/backfill-admin-mfa-backup-codes.ts` (untracked), new
integration test, `tasks.md`. No PR2b file touched, no frontend, no unrelated src change.

### Issues

| Sev        | ID      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WARNING    | W-PR3-1 | **The guard's safety-critical rejection branches have NO committed test.** `runBackfill`'s query pre-filters on `startsWith("[")` and every seeded blob-shaped fixture is VALID, so the in-loop guard-reject path (`skipped++`, `:88`) and the guard's try/catch/mixed-array/empty-array branches are never exercised by the committed suite. I proved them safe out-of-band (14-case probe, 0 throw/0 misclassify), but that probe is not committed — a future regression that weakened the guard (e.g. dropped the `.every($argon2id$)` check) would still pass 7/7. Highest-risk code path in the change with zero committed negative-path coverage. Non-blocking because the code is correct today. |
| WARNING    | W-PR3-2 | **5 node:test ROOT repoints not executed in this verify.** `auth/audit/rbac/trialPeriod/accountLifecycle.test.ts` are live-API batches (fetch `localhost:3000`) and were NOT re-run here (no booted API in the LXC single-file harness); they are also NOT covered by `tsc --noEmit` (apps/api tsconfig excludes `tests/`). Validated instead by mechanical-diff (pure ctor widening, no assertion change) + tsx-compile + the identical vitest sibling pattern passing (rbacRoutes 38/38). Low risk; reviewer/CI should run the live-API batch before merge.                                                                                                                                           |
| SUGGESTION | S-PR3-1 | Commit a unit test for the already-exported `parseLegacyBackupBlob` covering the adversarial matrix (UUID, sentinel, empty/malformed/mixed/non-argon2 arrays) — closes W-PR3-1 cheaply, no DB needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| SUGGESTION | S-PR3-2 | `backfillAdminMfaBackupCodes.integration.test.ts` carries a duplicate `@layer infrastructure` tag (lines 4 and 41). Cosmetic; remove one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Operational note (not a finding)

For a row where `mfaBackupCodes` is already non-empty AND `passwordResetToken` holds a
DIFFERENT legacy blob, `runCleanup` nulls that legacy blob. This is CORRECT: a re-enrolled admin's
canonical codes live in `mfaBackupCodes`; the stale legacy blob should be discarded. No meaningful
data loss. Operator guidance already embedded in `main()`: run without `--cleanup` first, reconcile
`verifyIntegrity` counts, then `--cleanup`.

### Result

No data-corruption path exists: the guard cannot misclassify a reset token or sentinel, cleanup
cannot null a pending reset token or run before codes are persisted, and the module is import-safe —
all proven by source inspection AND runtime. Legacy deletion is complete with a clean zero-reference
gate and `tsc` = 0; parity and PR2b-1 replay protection are intact. **0 CRITICAL, 2 WARNING
(both non-blocking; W-PR3-1 is a test-coverage gap on already-correct code, W-PR3-2 is deferred
live-API execution), 2 SUGGESTION.**

**next_recommended: sdd-archive.** Neither WARNING blocks archive; both go on the reviewer/merge
checklist. Merge to main stays gated (per apply) by the manual e2e smoke (W-PR2b-3-2) and the operator
running the backfill against prod (COUNT the guard population first; migrate → verify → `--cleanup`
only if > 0).

---

## Post-verify remediation (PR3)

Owner policy: findings we can close cheaply get closed now, not carried. No `sensitive-edit`
token needed — the only change is a new DB-free unit test under `apps/api/tests/unit/`.

| Finding                                                                                       | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S1 (W-PR3-1 / S-PR3-1) — guard's safety-critical rejection branches had no committed test** | **RESOLVED.** New pure unit test `apps/api/tests/unit/backfillAdminMfaBackupCodesGuard.test.ts` (vitest, `node:assert/strict`, mirrors the integration test's import style: `../../../../infra/prisma/scripts/backfill-admin-mfa-backup-codes.js`). Exercises the already-exported `parseLegacyBackupBlob` DB-free against the full adversarial matrix: valid 2-hash array (the only migrate case); empty array `[]`; mixed valid+non-hash array (all-or-nothing); array of non-Argon2id strings; a genuine `randomUUID()` reset token; the `CHANGE_REQUIRED` sentinel; a JSON object (not an array); malformed JSON starting with `[` (asserts it returns `null` WITHOUT throwing); `null` and empty-string input. **9/9 pass** — every non-MFA case confirmed `null` (no misclassification); this is a characterization/regression lock on already-correct behavior, not a bug fix. Closes W-PR3-1's coverage gap: a future regression that weakened the guard (e.g. dropping the `.every($argon2id$)` check) now fails this suite without needing `pnpm db:up`.                                                                                                                                                                                                                                                                                                                               |
| **S2 — `verifyIntegrity.migrated` naming (cosmetic)**                                         | **RESOLVED (2026-07-11, second remediation pass, sensitive-edit token — `infra/prisma/**`).** Renamed `verifyIntegrity`'s returned field `migrated`→`verifiedMigrated`in`infra/prisma/scripts/backfill-admin-mfa-backup-codes.ts` — **no logic change**: the counting conditions (`sourceMatching`= guard-matching retained legacy rows;`verifiedMigrated`= the subset of those whose`mfaBackupCodes`is already non-empty) are byte-for-byte identical, only the field key + JSDoc +`logger.info`payload key changed.`runBackfill`'s own `migrated`(a per-invocation delta) is UNCHANGED. New JSDoc explicitly distinguishes the two:`verifiedMigrated` is an END-STATE SNAPSHOT (`verifiedMigrated === sourceMatching`⇒ safe to run`runCleanup`), never a per-run delta — `verifyIntegrity`structurally cannot report a delta since it is a separate step that only observes the end state. Updated the one consumer that read the old field name:`backfillAdminMfaBackupCodes.integration.test.ts`'s `verifyIntegrity`test now asserts`verify.verifiedMigrated`(both the`typeof`check and the`<= sourceMatching`invariant); the OTHER test asserting`result.migrated`(from`runBackfill`) was left untouched, as required. Grepped repo-wide for any other consumer of `verifyIntegrity(...).migrated`— none found (the CLI`main()`only logs the whole`verify` object, never a specific field). |
| **S3 — SMELL-53 (tests without a `tsc` type-gate)**                                           | **ACCEPTED, deferred to backlog.** Already tracked in the approved PR3 plan's own Backlog section (`openspec/changes/mfa-consolidation/tasks.md`, "Backlog (registrado, fuera de scope de PR3)"): `apps/api/tsconfig.json`'s `include` does not cover `tests/`, so `tsc --noEmit` never type-checks test files (only transpiles via `tsx`). Fixing it means widening the `include` repo-wide — a type-gate change well beyond PR3's scope, confirmed staying deferred.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **STALE-DOC (new finding, backlog, not PR3 scope)**                                           | `docs/product/MASTER_PLAN_ES.md:150` and `docs/standards/code-standards.md:22` both describe the (now-deleted) legacy `auth/mfaService.ts` as storing MFA backup codes with **"SHA-256"**. Verified against the actual legacy source captured before deletion this session: the legacy `hashBackupCode` method called the SAME canonical `hashPassword` (Argon2id) helper the unified service uses, with an inline comment explicitly REJECTING SHA-256 ("SHA-256 alone is vulnerable to brute-force given the small alphabet... Argon2id makes the search space computationally infeasible"). The docs' "SHA-256" claim was already factually wrong even before the deletion, not merely made stale by it. Correcting these two doc lines is docs-only (no code/spec impact) — a separate slice, not PR3; flagged here for the docs backlog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Remediation gate (LXC-safe, single-file re-runs)

- `vitest run tests/unit/backfillAdminMfaBackupCodesGuard.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism` → **9/9** (new)
- `node --env-file=/root/omni-post/.env.test --conditions development --import tsx --test --test-force-exit tests/integration/backfillAdminMfaBackupCodes.integration.test.ts` → **7/7, 0 cancelled** (no regression from exporting/using the guard in a second consumer)
- `NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @apps/api exec tsc --noEmit` → **0**
- `eslint --max-warnings 0` on the new test + the script → **0**
- Fitness **#9** (@file) = 0, **#10** (@layer infrastructure) = 0 on the new file

### S2 remediation gate (second pass, sensitive-edit token, field rename only)

- `node --env-file=/root/omni-post/.env.test --conditions development --import tsx --test --test-force-exit tests/integration/backfillAdminMfaBackupCodes.integration.test.ts` → **7/7, 0 cancelled** (with `verify.verifiedMigrated`)
- `vitest run tests/unit/backfillAdminMfaBackupCodesGuard.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism` → **9/9** (untouched, confirmed unaffected by the rename)
- `NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @apps/api exec tsc --noEmit` → **0**
- `eslint --max-warnings 0` on the script + the integration test → **0**
- Fitness **#23** (raw queries, apps/api/src + apps/workers/src) = **0** (still typed-Prisma only)
- Repo-wide grep for any other `verifyIntegrity(...).migrated` consumer → **0** (the CLI `main()` only logs the whole `verify` object)

### Result (post-remediation, both S1 and S2 batches)

S1 and S2 resolved; S3 accepted/deferred with reason (backlog, no functional impact, no test/spec
regression). STALE-DOC finding logged for a future docs-only slice. **0 CRITICAL, 2 WARNING unchanged
from the original verify (W-PR3-1 is now closed by the new test — downgrade to resolved; W-PR3-2
live-API execution remains a reviewer/merge-checklist item, unaffected by either remediation batch),
1 SUGGESTION remaining (S-PR3-2, duplicate `@layer` tag, cosmetic, unchanged).**

**next_recommended: sdd-archive.**
