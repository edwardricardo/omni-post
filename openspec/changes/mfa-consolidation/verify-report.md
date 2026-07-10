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

- **W1 — Test-harness legacy import (accepted deferral for smoke tests; `tests/mfa.test.ts` REPOINTED in PR1).** ~15 route smoke tests (`tests/unit/{authRoutes,channelRoutes,team/teamRoutes,rbacRoutes,dashboardRoutes,trendRoutes,...}.test.ts`) still import legacy `auth/mfaService.ts` and register it under `TOKENS.MfaService` for DI bootstrap; those do not exercise MFA (verified: zero `mfaToken`/`verifyMfaToken` usages), so the legacy file's retention keeps them green. `tests/mfa.test.ts` is the exception: its "Auth Service MFA Integration" block DOES drive MFA-enabled logins through `AuthServiceCore.login`, whose call site now uses the unified subject-typed signature — wiring the legacy service there breaks at runtime (subject object forwarded as a Prisma string id). It is therefore repointed to the unified `MfaService` inside PR1 itself (admin adapter doubling as the customer repository, mirroring the composition root). **Forward risk:** the legacy-file deletion PR must repoint/delete the remaining smoke-test bootstraps together with the legacy file, or CI breaks. Track as an acceptance criterion of that PR.

**SUGGESTION**

- **S1 — Audit `accountId` sourcing for PR2.** `MfaService.audit` calls `logSecurityEvent(subject.id, subject.id, …)` — `subject.id` is passed as both `userId` and `accountId`. Benign for admin subjects (not account-scoped) and the force-disable spec is satisfied via `details.actorId`/`subjectId`. When PR2 makes customer subjects real, the `accountId` position should carry the customer's tenant account (and admin-over-customer force-disable should attribute the admin actor) for tenant-correct audit rows. **RESOLVED by the PR2 slice below:** `resolveAuditActor` carries the customer's real tenant `accountId`, and admin-over-customer force-disable attributes the acting admin via `actorOverride`.
- **S2 — Negative-path no-secret-logging.** The logger spy test only exercises happy-path ops (the service logs only in `catch`). A test that forces a DB error and asserts the error log carries no secret would harden the disclosure guarantee. Low priority — audit-payload assertions already cover the main surface.

### Deviations from design/tasks

None. PR1 implements exactly the design-mandated slice; the customer-subject repoint, `userEmail` fix, customer force-disable route, `CustomerUser` migration, backfill, and legacy deletion are correctly deferred to PR2/PR3 per the design's chained-PR plan.

**next_recommended: commit PR1** (then sdd-apply PR2). Warnings are non-blocking and PR3-tracked.

---

## PR2 — Customer Persistence + Route Correctness

> Label namespace: the W*/S* labels in this section are scoped to this PR2
> section and are independent of the PR1 section's W1/S1/S2 above.

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
