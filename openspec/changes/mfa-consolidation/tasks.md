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

> **Unblocked (2026-07-10):** a fresh `sensitive-edit` token authorized the schema/migration edit; tasks
> 2.1–2.3, 2.5, 2.6 landed in this run. The audit `accountId` fix (item 7 of the plan) was superseded by
> the `audit-actor-polymorphism` (A1) landing: `MfaService.audit()` now dispatches to
> `auditActor.customer(subject.id, accountId)` / `auditActor.admin(subject.id)` instead of a bare
> accountId-position fix — see `resolveAuditActor()` in `MfaService.ts`.

- [x] 2.1 `pnpm db:up`; added `CustomerUser.mfaBackupCodes String[] @default([])` + `mfaBackupUsedAt Json? @default("{}")` to `schema.prisma`; migration `20260710000747_add_customer_mfa_backup_codes` created + applied (`prisma migrate deploy`) + client regenerated. Down-migration (`down.sql`, operator-driven per repo convention) drops only the two columns.
- [x] 2.2 GREEN + integration (node:test, real DB): `tests/integration/mfaCustomer.integration.test.ts` — customer setup persists hashed codes to `mfaBackupCodes`; `resetToken` untouched across a full MFA enrollment (no-clobber); the real adapter round-trips `mfaBackupUsedAt` through Postgres JSONB. 5/5 pass, 0 cancelled.
- [x] 2.3 GREEN: same integration file + `tests/unit/mfaRoutes.test.ts` — customer route reads/writes CustomerUser never AdminUser (anchor, both unit + integration); a token whose `accountId` doesn't match its subject's real account is rejected 404 (tenant-guard cross-subject anchor); admin routes (`:338`/`:378`) untouched.
- [x] 2.4 Validate apply-time ASSUMPTION — **DONE, result PARTIAL**: the 5 self-service routes CUMPLEN (`requireClientAuth` binds `enterTenantContext({accountId})`, exposes `request.customerUser.accountId`); login-time `/auth/mfa/verify` NO CUMPLE (no preHandler, no TenantContext, body has no `accountId`) and customer login never challenges MFA. `/auth/mfa/verify` repoint moved to **PR2b**; PR2 leaves it on the admin subject.
- [x] 2.5 GREEN: created `PrismaCustomerMfaUserRepository.ts` (tenant-scoped, `customerUser` in `TENANT_SCOPED_MODELS`; `findById` returns `accountId`). JSDoc `@layer infrastructure`. Wired in DI (`setupServices.ts:174-186`) replacing the placeholder alias. 12/12 unit tests.
- [x] 2.6 GREEN: repointed the **5 self-service** routes in `mfaRoutes.ts` to customer subject `{type:"customer",id}` (`:81` status, `:108` setup, `:157` verify-setup, `:254` disable, `:298` regenerate); fixed `userEmail` at source (dropped `setupMfa`'s `email` param, derives from `MfaUserRecord.email` inside the service); fixed audit actor via `resolveAuditActor()`; added `/admin/customers/:userId/mfa/force-disable` (`requireAdminAuth`+`USER_MANAGE`, audit resource `CustomerUser`, `withSystemContext()`). **`/auth/mfa/verify` (`:205`) untouched — confirmed ADMIN.**

## PR2b: Customer Login MFA Challenge (base: main after PR2) — 3 chained sub-slices

> Authoritative design: `design-pr2b.md` (PASSED adversarial gate). Supersedes the stale 2b.1–2b.3 stubs
> (which said "repoint `/auth/mfa/verify` to customer" — WRONG: the design RETIRES that orphan and adds a
> dedicated `POST /auth/customer/login/mfa`). Owner-fixed: 3 sub-slices, `stacked-to-main`, merge order
> **PR2b-1 → PR2b-2 → PR2b-3** (a live gate without the portal UI locks MFA-enabled customers out).
> Dependency diagram: `📍 PR2b-1 → PR2b-2 → PR2b-3`.
>
> **Legacy note (do NOT assume coverage)**: the TOTP single-use fix touches ONLY the unified
> `apps/api/src/admin/auth/MfaService.ts`. It does NOT touch the retired legacy `apps/api/src/auth/mfaService.ts`
> (~18 tests still import it; `tests/mfa.test.ts` was repointed this session) — that file has ZERO replay
> coverage after PR2b; its deletion stays PR3's job.

### Legend & LXC-safe verify commands

- `[SENSITIVE]` — touches `infra/prisma/schema.prisma`, `infra/prisma/migrations/**`, `apps/api/src/auth/**`,
  `apps/api/src/admin/auth/**`, `apps/api/src/security/**`. Needs an active `omnipost-allow sensitive-edit`
  token (15-min TTL). `[RED]`/`[GREEN]` = Strict TDD (RED first).
- **U** (vitest unit, api): `NODE_OPTIONS=--max-old-space-size=2048 timeout 300 pnpm --filter @apps/api exec vitest run <file> --pool=forks --maxWorkers=1 --no-file-parallelism`
- **Uc** (customer-auth pkg): same with `--filter @core/customer-auth`
- **Uf** (client): same with `--filter @apps/client`
- **I** (node:test integration; `pnpm db:up` FIRST): `timeout 300 pnpm --filter @apps/api exec node --import tsx --conditions development --test <file>`

### Sensitive-edit token windows

- **PR2b-1 · Window A** (FIRST): `schema.prisma` + migration + `down.sql`.
- **PR2b-1 · Window B**: `admin/auth/MfaService.ts` (the non-sensitive port + both adapters land between A and B → two windows, mirroring A1).
- **PR2b-3 · Window C** (contiguous): `auth/customerJwt.ts`, `admin/auth/MfaService.ts`, `auth/customerAuthRoutes.ts`, `auth/mfaRoutes.ts`, `security/httpRateLimitPreHandler.ts`.

### PR2b Review Workload Forecast

| Field                   | Value                                                  |
| ----------------------- | ------------------------------------------------------ |
| Estimated changed lines | PR2b-1 ~490, PR2b-2 ~800, PR2b-3 ~1600 (total ~2,900)  |
| 400-line budget risk    | High (every sub-slice)                                 |
| Chained PRs recommended | Yes                                                    |
| Suggested split         | PR2b-1 → PR2b-2 → PR2b-3 (owner-fixed; do NOT reorder) |
| Delivery strategy       | ask-on-risk                                            |
| Chain strategy          | stacked-to-main                                        |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Each sub-slice exceeds 400 lines (strict-TDD keeps tests with code → no clean sub-split); each needs
maintainer `size:exception`. PR2b-3 further isolates the orphan-retirement into its own commit for review
focus. Design header-count correction (the tables are truth, headers are stale): **backend = 22 rows
(21 files + the schema/migration/down row)**, not "17 files"; **frontend = 8 files across 7 rows**
(`en.json`+`es.json` share a row), not "7 files"; plus docs/generated/cleanup (3 docs, `api-generated`
regen, k6 helper, 3 orphan tests deleted, `authRateLimit` test retargeted).

#### Suggested Work Units

| Unit | Goal                                                                                               | PR     | Base                |
| ---- | -------------------------------------------------------------------------------------------------- | ------ | ------------------- |
| 1    | TOTP single-use: schema column + `claimTotpStep` CAS (both subjects) + `checkDelta` + replay tests | PR2b-1 | main (after PR2)    |
| 2    | Client-portal challenge UI + `authApi`/action wiring + proxy cookie-path fix + i18n (INERT)        | PR2b-2 | main (after PR2b-1) |
| 3    | Backend gate: challenge store + JWT + use cases + step-2 route + BF reorder + orphan retirement    | PR2b-3 | main (after PR2b-2) |

---

### PR2b-1 — Companion TOTP single-use fix (protects ADMIN + CUSTOMER)

**Foundation [Window A; schema FIRST]**

- [x] 2b1.1 Run `pnpm db:up`. If Prisma reports **P3015 / "not yet applied"**, move any orphan NON-migration dir (e.g. stray `.claude/`) OUT of `infra/prisma/migrations/` — stray-dir gotcha, not shadow-DB (diagnose with `prisma migrate status`).
- [x] 2b1.2 [RED] (I) `apps/api/tests/integration/mfaTotpSingleUse.integration.test.ts` — real-DB adapter: `claimTotpStep(id, step)` first call `CLAIMED`, second same step `ALREADY_USED`, `step+1` `CLAIMED`, unknown id `NOT_FOUND`. Fails RED (column absent). JSDoc `@layer infrastructure`.
- [x] 2b1.3 [SENSITIVE][GREEN] `infra/prisma/schema.prisma`: add `mfaLastUsedTotpStep Int?` to `AdminUser` AND `CustomerUser` (nullable, no default → metadata-only ALTER). Migration `<ts>_add_mfa_last_used_totp_step`: up = `ALTER TABLE "AdminUser" ADD COLUMN "mfaLastUsedTotpStep" INTEGER;` + same for `"CustomerUser"`; hand-write `down.sql` (operator-driven) dropping exactly those 2 columns. Regenerate client. 2b1.2 GREEN.

**Port + adapters + service [Window B for MfaService only]**

- [x] 2b1.4 [RED] (U) extend `apps/api/tests/unit/infrastructure/adapters/PrismaAdminMfaUserRepository.test.ts` + `PrismaCustomerMfaUserRepository.test.ts`: `claimTotpStep` conditional `updateMany` count `1`→`CLAIMED`; count `0` → `findById` disambiguation (missing→`NOT_FOUND`, present→`ALREADY_USED`); `mfaLastUsedTotpStep` surfaced on `MfaUserRecord`. Fails RED.
- [x] 2b1.5 [GREEN] `packages/ports/src/MfaUserRepositoryPort.ts`: add `mfaLastUsedTotpStep: number | null` to `MfaUserRecord`; add `claimTotpStep(userId, step): Promise<Result<"CLAIMED", "NOT_FOUND" | "ALREADY_USED">>`. JSDoc `@layer domain`.
- [x] 2b1.6 [GREEN] both Prisma adapters implement `claimTotpStep` (conditional `updateMany` `where:{ id, OR:[{mfaLastUsedTotpStep:null},{mfaLastUsedTotpStep:{lt:step}}] }`; count 0 → `findById` disambiguate) + map the new record field. Constructor-injected Prisma (#21). 2b1.4 GREEN.
- [x] 2b1.7 [GREEN] mirror in the in-memory double `apps/api/tests/unit/helpers/InMemoryMfaUserRepository.ts` (field + atomic `claimTotpStep` — single-threaded `Map`, no `await` between check and set).
- [x] 2b1.8 [RED] (U) `apps/api/tests/unit/mfaTotpSingleUse.test.ts` — parameterized over subject `{admin, customer}`: same TOTP accepted once then **replay rejected** (`INVALID_TOKEN` + `MFA_TOTP_REPLAY_REJECTED` HIGH audit); **the next 30s step still accepted (no lockout)**; same-TOTP login-then-`regenerateBackupCodes`/`disableMfa` rejected within window. Fails RED (`MfaService.ts:197-199` accepts without claiming).
- [x] 2b1.9 [SENSITIVE][GREEN][Window B] `apps/api/src/admin/auth/MfaService.ts` TOTP path: `verifyTotp` ok → accepted step via `authenticator.clone({window: TOTP_WINDOW}).checkDelta(token, secret)` (verify otplib `checkDelta` signature at apply — Open Question) → `claimTotpStep` → `ALREADY_USED` → audit `MFA_TOTP_REPLAY_REJECTED` + `err("INVALID_TOKEN")`. `verifyMfaToken` signature UNCHANGED. Does NOT touch legacy `auth/mfaService.ts`. 2b1.8 GREEN.

**Regression + gate**

- [x] 2b1.10 Admin regression (merge-blocking): (U) `unifiedMfaService.test.ts`, `mfaRoutes.test.ts`, `PrismaAdminMfaUserRepository.test.ts`, and `tests/mfa.test.ts` (21, via `pnpm --filter @apps/api test:mfa`) stay green; admin login MFA behavior (`authServiceCore`/`AdminAuthService` suites) unchanged.
- [x] 2b1.11 0-defect gate: `eslint --max-warnings 0`, `tsc` clean; fitness #3/#9/#10/#21 hard-zero (exact greps inlined at 2b3.23); record `size:exception` rationale in PR body (~490 > 400).

---

### PR2b-2 — Client-portal challenge UI (INERT until PR2b-3)

- [x] 2b2.1 [RED] (Uf) extended `apps/client/lib/auth/__tests__/authApi.test.ts`: `authApi.completeMfaLogin({challengeToken, code, rememberMe})` POSTs proxy `/login/mfa`; `login` maps `challengeToken`+`expiresInSeconds`. RED confirmed (4 fail), then GREEN. 30/30.
- [x] 2b2.2 [GREEN] `apps/client/lib/auth/authApi.ts`: `MfaChallenge` gained `challengeToken`/`expiresInSeconds`; new `CompleteMfaLoginParams` + `completeMfaLogin`; `login` maps the fields. 2b2.1 GREEN.
- [x] 2b2.3 [GREEN] `apps/client/lib/auth/authContext.tsx`: `login` returns `Promise<MfaChallenge | null>` (challenge returned, no longer thrown); new `completeMfaLogin` context method. Register-auto-login `null` path preserved. `authContext.integration.test.tsx` extended (mock + 3 tests). 11/11.
- [x] 2b2.4 [RED] (Uf) `app/api/backend/[...path]/route.test.ts`: step-2 through `auth/customer/login/mfa` persists httpOnly session/refresh cookies + does NOT leak tokens to the browser body; rememberMe extends refresh TTL; step-1 challenge passes through with no cookies. RED confirmed (3 fail, step-1 guard passed), then GREEN. 4/4.
- [x] 2b2.5 [GREEN] `apps/client/app/api/backend/[...path]/route.ts`: added `AUTH_LOGIN_MFA_PATH = "auth/customer/login/mfa"` to the cookie-persist branch + the `parseRememberMe` detection. 2b2.4 GREEN.
- [x] 2b2.6 [RED] Split by concern (mock isolation): `app/actions/auth.test.ts` (server-action shape: XFF relay + wrong-code-keeps-challenge vs invalid/503-falls-back mapping) + `components/auth/MfaChallengeForm.test.tsx` (RTL: hidden inputs, wrong-code inline error, expired → `onChallengeExpired`, page two-step password ⇄ challenge). RED confirmed for both, then GREEN.
- [x] 2b2.7 [GREEN] Created `apps/client/components/auth/MfaChallengeForm.tsx` (`@component` + `@layer infrastructure`, tags first; props documented on the interface; challenge in `useActionState`/hidden input — memory/DOM only). Wired `app/[locale]/login/page.tsx` two-step render (challenge state + `onChallengeExpired` fallback). 2b2.6 GREEN (component/page 5/5).
- [x] 2b2.8 [GREEN] `apps/client/app/actions/auth.ts`: `loginAction` returns `{mfaChallenge}` on `mfaRequired` (fixes the dead end); NEW `completeMfaLoginAction` POSTs `/auth/customer/login/mfa` with the `forwardedForHeaders` relay, persists via `setSessionCookie`/`setRefreshCookie({rememberMe})`, `redirect` to `/{locale}/dashboard`; distinguishes `INVALID_MFA_CODE` (retry) from invalid-challenge/503 (fallback). `auth.test.ts` 7/7.
- [x] 2b2.9 [GREEN] i18n: added `auth.*` MFA-step keys (`mfaTitle`/`mfaSubtitle`/`mfaCodeLabel`/`mfaCodePlaceholder`/`mfaVerify`/`mfaVerifying`/`mfaChallengeExpired`) to `messages/en.json` + `es.json` (es neutral professional Spanish).
- [x] 2b2.10 0-defect gate: `tsc --noEmit` @apps/client = 0 (heap 6144); `eslint --max-warnings 0` = 0 on all touched files; fitness #9 (@file) / #10 (@layer) / #12 (@component MfaChallengeForm) / #17 (client process.env = 0) hard-zero; all touched tests green (57/57 across 5 files). Inert: no user-visible change until the backend emits `mfaRequired`. `size:exception` (~1,060 changed lines incl. tests > 400).

---

### PR2b-3 — Backend gate + orphan retirement (merges LAST)

**Ports + domain (non-sensitive)**

- [ ] 2b3.1 [RED] (U) `apps/api/tests/unit/RedisMfaChallengeStoreAdapter.test.ts` + port contract: `issue` = `SET NX EX`; `consume` returns `CONSUMED` to exactly one caller (`DEL` count 1), `NOT_FOUND` on second/expired/unknown; store error → typed `err("STORE_ERROR")` (NOT swallowed). Fails RED.
- [ ] 2b3.2 [GREEN] Create `packages/ports/src/MfaChallengeStorePort.ts` (`issue`/`consume`, `MfaChallengeStoreError`) + `packages/ports/src/MfaVerificationPort.ts` (move `MfaVerificationResult` + `MfaVerifyTokenError` here); export both in `packages/ports/src/index.ts`. JSDoc `@layer domain`.
- [ ] 2b3.3 [RED→GREEN] (Uc) `packages/core/customer-auth/tests/unit/challengeBinding.test.ts` + create `packages/core/customer-auth/src/challengeBinding.ts` (`sha256` hex helper, node crypto). `@layer application`.
- [ ] 2b3.4 [RED] (U) `apps/api/tests/unit/customerJwt.test.ts` — token-kind confusion BOTH directions: a `customer-mfa-challenge` token rejected by `verifyCustomerToken`/refresh verify (aud + type); an access/refresh token rejected by `verifyCustomerMfaChallengeToken`; alg `["HS256"]`/iss `omnipost-customer`/aud `omnipost-customer-mfa` pinned. Fails RED.
- [ ] 2b3.5 [GREEN] `packages/core/domain/src/repositories/CustomerTokenService.ts`: add `CUSTOMER_MFA_CHALLENGE_TTL_SECONDS = 180`, `CustomerMfaChallengeClaims`, `signMfaChallengeToken`/`verifyMfaChallengeToken` signatures. `@layer domain`.

**Use cases (non-sensitive; fake ports)**

- [ ] 2b3.6 [RED] (Uc) extend `packages/core/customer-auth/tests/unit/LoginCustomerUseCase.test.ts` — **no session minted pre-MFA**: `mfaEnabled` → returns `CustomerMfaChallengeOutput` (not tokens), performs NO `recordLogin`/`save`/`recordSuccessfulAttempt`/mint; `store.issue` failure → `MFA_UNAVAILABLE`; customer **WITHOUT** MFA → unchanged token mint. Fails RED (no branch today).
- [ ] 2b3.7 [GREEN] `packages/core/customer-auth/src/LoginCustomerUseCase.ts`: branch on `targetUser.mfaEnabled` after `isActive`+rehash; hash `iph`/`uah`; `store.issue(jti, TTL)`; sign challenge; widen return to `Result<LoginCustomerOutput | CustomerMfaChallengeOutput, …>`; add `MFA_UNAVAILABLE`; append `MfaChallengeStorePort` dep. 2b3.6 GREEN.
- [ ] 2b3.8 [RED] (Uc) `packages/core/customer-auth/tests/unit/CompleteCustomerMfaLoginUseCase.test.ts` — step-2 anchors: happy TOTP+backup mint session; **two concurrent valid step-2 → exactly ONE session** (jti consume serializes; loser → `INVALID_CHALLENGE`); wrong code → challenge NOT consumed + `recordFailedAttempt({failureReason:"MFA_FAILED"})` + retry succeeds; **BF success recorded only post-MFA**; expired/consumed/foreign challenge + binding mismatch → **byte-identical `INVALID_CHALLENGE`** (anti-oracle); `consume` store error → `MFA_UNAVAILABLE`. Fails RED (file absent).
- [ ] 2b3.9 [GREEN] Create `packages/core/customer-auth/src/CompleteCustomerMfaLoginUseCase.ts` (deps incl. `MfaVerificationPort`, `MfaChallengeStorePort`, `BruteForceProtectionPort`, `UnitOfWork?` LAST): verify JWT → binding → load by `sub` → isActive/mfaEnabled → BF check → `verifyMfaToken` → consume `jti` → UoW `recordLogin`+`save` → `recordSuccessfulAttempt` (outside tx) → mint. Export use case + DTOs in `packages/core/customer-auth/src/index.ts`.

**Adapters + JWT + routes [Window C for the sensitive files]**

- [ ] 2b3.10 [GREEN] Create `apps/api/src/infrastructure/adapters/RedisMfaChallengeStoreAdapter.ts` (dedicated `createRedisConnection()`, keyPrefix `auth:mfa-challenge:`, `SET NX EX`/`DEL`-count, typed fail-closed errors). `@layer infrastructure`. 2b3.1 GREEN.
- [ ] 2b3.11 [SENSITIVE][GREEN][Window C] `apps/api/src/auth/customerJwt.ts`: 4th token kind — payload `type:"customer-mfa-challenge"`, sign+verify pin alg `["HS256"]`/iss `omnipost-customer`/aud `omnipost-customer-mfa`, carry `jti`+`iph`+`uah`. 2b3.4 GREEN.
- [ ] 2b3.12 [GREEN] `apps/api/src/infrastructure/adapters/CustomerTokenServiceAdapter.ts`: delegate the 2 new methods to `customerJwt.ts` (follows 2b3.11).
- [ ] 2b3.13 [SENSITIVE][GREEN][Window C] `apps/api/src/admin/auth/MfaService.ts`: add `implements MfaVerificationPort`; import `MfaVerificationResult`/error union from `@ports/core` (drop local copies). Additive on top of PR2b-1's TOTP edit — do not revert it.
- [ ] 2b3.14 [RED] (U) extend `apps/api/tests/unit/customerAuthUseCases.test.ts` + route inject: step-2 route maps errors per the design taxonomy (401 generic / 403 / 429 / **503 `MFA_UNAVAILABLE`** / 500); **store outage → 503 + WARN `threat_type:"mfa_challenge_store_unavailable"`** (fail-closed — deliberate contrast to the limiter's fail-open); binding mismatch → WARN `mfa_challenge_binding_mismatch`; `resolveClientIp` (NEVER `request.ip`) feeds `ip` on both handlers. Fails RED.
- [ ] 2b3.15 [SENSITIVE][GREEN][Window C] `apps/api/src/auth/customerAuthRoutes.ts`: login handler challenge mapping + `resolveClientIp`; NEW `POST /auth/customer/login/mfa` route/handler/`MfaLoginSchema`/`errorMap` under `withSystemContext("customer-mfa-login", …)`; resolve `TOKENS.CompleteCustomerMfaLoginUseCase`. 2b3.14 GREEN.
- [ ] 2b3.16 [SENSITIVE][GREEN][Window C] `apps/api/src/security/httpRateLimitPreHandler.ts`: add explicit `{ path:"/auth/customer/login/mfa", config: RateLimitConfigs.AUTH }` to `AUTH_ROUTE_RULES`; update the `:122-126` comment (rule stays — covers `/auth/mfa/verify-setup`). (U) `authRateLimit` pattern (`:212-230`): step-2 6th request 429s.

**DI wiring (non-sensitive)**

- [ ] 2b3.17 [GREEN] `apps/api/src/infrastructure/container/types.ts`: add `TOKENS.MfaChallengeStore` + `TOKENS.CompleteCustomerMfaLoginUseCase` (2 new tokens ONLY — no token for `MfaVerificationPort`).
- [ ] 2b3.18 [GREEN] `setupServices.ts`: register `RedisMfaChallengeStoreAdapter` under `TOKENS.MfaChallengeStore` (dedicated `createRedisConnection()`, `:839-855` pattern). `setupCustomerAuthUseCases.ts`: `LoginCustomerUseCase` gains the store dep; register `CompleteCustomerMfaLoginUseCase` resolving `TOKENS.MfaService` **typed as `MfaVerificationPort`** (reuse, not a 2nd token — fitness #21).

**Orphan retirement + cleanup [sensitive edit in Window C; isolate as its own commit]**

- [ ] 2b3.19 [SENSITIVE][GREEN][Window C] `apps/api/src/auth/mfaRoutes.ts`: DELETE the orphan `POST /auth/mfa/verify` — registration `:523-528`, handler `:191-233`, `MfaVerifySchema` `:41-46`. (U) inject: `POST /auth/mfa/verify` → **404**.
- [ ] 2b3.20 [GREEN] Cleanup blast radius: delete 3 orphan tests `tests/unit/mfaRoutes.test.ts:341-369`; retarget `tests/unit/authRateLimit.test.ts:212-230` to `/auth/mfa/verify-setup`; regenerate `packages/shared/src/api-generated/*` (dump:openapi flow — retires `types.gen.ts:431`); update `docs/api/auth.md:123`, `docs/api/README.md:131`, `docs/architecture/API.md:161` (replace orphan row with the new endpoint); fix/remove k6 helper `performance/k6/utils/auth-helpers.js:201`.

**Integration + gate**

- [ ] 2b3.21 [RED→GREEN] (I) `apps/api/tests/integration/customerLoginMfa.integration.test.ts` — real DB+Redis, single file: enroll → login → challenge → complete → mints a token pair; two parallel `consume` on real Redis → exactly one `CONSUMED`. `pnpm db:up` first.
- [ ] 2b3.22 Regression: PR1/PR2 MFA suites + `tests/mfa.test.ts` (21) + admin login suites green; e2e MFA spec (`apps/client/tests/e2e/tests/auth.spec.ts:231-254`) expectations revisited at apply.
- [ ] 2b3.23 0-defect gate — `eslint --max-warnings 0`, `tsc` clean, LXC-safe single-file runs green, `size:exception` in PR body (~1,600 > 400; orphan-retirement isolated commit). Fitness hard-zero (exact greps):
  - #3 `grep -rnE "(:\s+any\b|\bas any\b|<any>)" apps/api/src/domain/ apps/api/src/application/ apps/api/src/infrastructure/ --include="*.ts" | grep -vE "//.*any|^[^:]+:[0-9]+:\s*\*" | wc -l` → 0
  - #9 `grep -rL "@file" apps/ packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules\|dist\|\.next\|\.stryker\|reports/mutation\|next-env\.d\.ts" | wc -l` → 0
  - #10 `grep -rn "@layer" apps/ packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules\|dist\|\.next\|\.stryker\|reports/mutation" | grep -v "@layer application\|@layer domain\|@layer infrastructure" | wc -l` → 0
  - #16 `grep -rn "process\.env\." apps/api/src --include="*.ts" | grep -v "config/env\.ts\|/tests/\|\.test\.\|process\.env\.NODE_ENV\b" | wc -l` → 0
  - #18 `grep -rnE "argon2\.(hash|verify)\(" apps/api/src --include="*.ts" | grep -v "passwordHashing\.ts\|/tests/\|\.test\." | wc -l` → 0
  - #21 `grep -rlE "import \{[^}]*\bprisma\b[^}]*\} from \"@infra/prisma\"" apps/api/src apps/workers/src --include="*.ts" | grep -vE "/infrastructure/container/|/index\.ts$|/container/|\.test\.|/tests/" | wc -l` → 0
  - #28 `grep -rnE "config:\s*\{\s*rateLimit:" apps/api/src --include="*.ts" 2>/dev/null | grep -vE "/tests/|\.test\." | wc -l` → 0

## PR3: Backfill + Legacy Retirement (base: main after PR2)

- [ ] 3.1 RED (node:test): seed legacy admin rows; backfill moves codes exactly once; re-run is no-op; source `passwordResetToken` retained until verified; guard skips genuine reset tokens; assert fitness #23 count `0` (typed Prisma only).
- [ ] 3.2 GREEN: create `scripts/migrations/backfill-admin-mfa-backup-codes.ts` — cursor-batched `findMany`, `$argon2id$`-JSON content guard, skip-migrated, per-row typed `update`, source retained; `// canon-exception: migration:<ts>`. JSDoc `@layer infrastructure`.
- [ ] 3.3 Separate verify step (count source-matching vs migrated) and separate cleanup step (null `passwordResetToken` only where guard matches AND `mfaBackupCodes` non-empty).
- [ ] 3.4 After backfill verify + parity tests pass: delete `apps/api/src/auth/mfaService.ts`; repoint imports (`setupServices.ts:19`, `authService.ts:11`, `authServiceCore.ts:17`, `mfaRoutes.ts:11`).
- [ ] 3.5 Zero-reference gate: `rg "auth/mfaService"` → 0; file absent; TOTP behavior unchanged.
