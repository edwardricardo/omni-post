# Design: MFA Consolidation (N-SEC-5)

One unified, port-based MFA service (the completed `admin/auth/MfaService.ts`) serves admin and customer subjects through a subject-agnostic `MfaUserRepositoryPort` with two Prisma adapters; the legacy `auth/mfaService.ts` is retired after an online, idempotent admin backfill moves backup codes off `passwordResetToken`.

## Technical Approach

Approach B (proposal-decided): complete the NEW service in place, never extend the OLD. The service loses its raw `PrismaClient` and depends on a technology-free port; subject identity (`admin | customer`) becomes an explicit parameter so one service instance covers both tables — including `adminForceDisable` over either subject. Customer MFA becomes real via a `CustomerUser` migration mirroring the admin backup-code columns. Verified ground truth that shapes the design: `CustomerUser` has **no** `passwordResetToken` column at all (only `resetToken`), so the legacy service never could have served customers — the customer routes were silently operating on `AdminUser` rows.

## Architecture Decisions

### Decision 1: Port shape — one subject-agnostic port interface, two adapters, service-side dispatch

**Choice**: One technology-free `MfaUserRepositoryPort` in `packages/ports/src/` whose methods take only a user id (no subject knowledge). TWO Prisma adapters implement it — `PrismaAdminMfaUserRepository` (AdminUser) and `PrismaCustomerMfaUserRepository` (CustomerUser). The unified `MfaService` receives BOTH instances by constructor injection and dispatches by `MfaSubject.type` (a trivial map lookup). The discriminator lives in the **service API**, not the port contract.

**Alternatives considered**:

| Option                                                        | Why rejected                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Discriminator inside the port; adapters receive `subject` | Every adapter must handle both subjects or throw on the wrong one — partial implementations violate LSP; subject knowledge leaks into a contract that should be table-shaped                                        |
| (b) One port + one adapter switching table internally         | Mixes a tenant-scoped table (CustomerUser) and a global table (AdminUser) in one class — tenant-guard reasoning and fitness auditing per table become impossible to isolate; grows conditional infrastructure logic |
| (c-pure) Two service instances (one per subject)              | `adminForceDisable` must reach BOTH subjects from one call site; two services push subject dispatch up into every route/consumer                                                                                    |

**Rationale**: Each adapter stays single-table (SRP; the customer adapter alone carries tenant-guard concerns), the port stays technology-free and reusable, and the closed two-member dispatch lives in exactly one place (the service). Matches the existing repository-port pattern (`AdminUserRepositoryPort` + Prisma adapter).

### Decision 2: Service completion — port the 3 missing capabilities at behavior parity

**Choice**: Complete `apps/api/src/admin/auth/MfaService.ts` **in place** (path per proposal's Affected Areas; relocation to `auth/mfa/` rejected — rename churn in a security diff, import updates across 5+ consumers, and near-case-collision with the legacy `auth/mfaService.ts` being deleted). Unified surface (all `Result`-typed, subject-first):

- `setupMfa(subject, email)` — issues TOTP secret + backup codes; hashes persisted to `mfaBackupCodes` at setup; plaintext returned exactly once (adopts NEW-service semantics; the legacy quirk of re-issuing fresh codes at verify-setup is dropped per spec "returned exactly once at setup").
- `verifyMfaSetup(subject, token)` — verifies TOTP, flips `mfaEnabled`.
- `verifyMfaToken(subject, token)` — TOTP first; on miss, backup-code path: `verifyPassword` against each unused hash in `mfaBackupCodes`, mark hit single-use in `mfaBackupUsedAt` keyed by **array index → ISO timestamp** (no secret material in the map), emit `MFA_BACKUP_CODE_USED` audit.
- `regenerateBackupCodes(subject, token)` — requires valid verify; writes fresh hashes, resets `mfaBackupUsedAt` to `{}` (old codes dead).
- `disableMfa(subject, token)` / `adminForceDisable(subject, actor)` — clear `mfaEnabled`, `mfaSecret`, `mfaBackupCodes`, `mfaBackupUsedAt`. Force-disable audits actor + subject, never secrets. (Password re-check in `AdminAuthService.disableMfa` stays in `AdminAuthService` — not an MFA concern.)
- `getMfaStatus(subject)` — enabled + remaining-unused count (`mfaBackupCodes.length − keys(mfaBackupUsedAt)`), never secrets.

**Backup codes pinned**: 8 codes × 8-char uppercase hex (`crypto.randomBytes(4)`), matching legacy — **required** because backfilled admin hashes derive from 8-char codes users still hold, and route schemas cap tokens at 8 chars (the NEW service's 10-char `randomBytes(5)` codes could never pass `MfaTokenFlexibleSchema.max(8)`; `adminAuthConfig.mfa` aligns to 8/8). Hashing: canonical `hashPassword`/`verifyPassword` only (fitness #18).

**TOTP verification window**: pinned explicitly to `window: 2` per call **without mutating the global** `authenticator.options` (the legacy service's global mutation means window 2 is already today's effective process-wide behavior — pinning it locally is the do-not-regress choice AND removes shared-mutable-state). Algorithm/library (otplib) unchanged.

**Rationale**: Parity is defined behaviorally (the spec's scenarios), not quirk-for-quirk; every divergence from legacy (setup-once codes, no global mutation) is an explicit, tested normalization.

### Decision 3: Persistence + migration

**Choice — schema**: Prisma migration adds `mfaBackupCodes String[] @default([])` + `mfaBackupUsedAt Json? @default("{}")` to `CustomerUser`. Adding defaulted columns in PostgreSQL 11+ is metadata-only (no table rewrite) — non-blocking, online. Down-migration drops exactly these two columns (data-safe rollback). `pnpm db:up` before migrating (repo rule).

**Choice — admin backfill**: a one-off, ONLINE, IDEMPOTENT script under `scripts/migrations/` (canon-sanctioned `// canon-exception: migration:<ts>` scenario) using the **typed Prisma API only** — zero raw SQL, so fitness #23 is untouched. Algorithm:

1. Cursor-batched `findMany` (≈100 rows) over `AdminUser` where `passwordResetToken != null`.
2. **Content guard**: migrate only values that parse as a JSON array of `$argon2id$…` strings — a genuine password-reset token never matches, so reset state is never destroyed (the column is dual-use today).
3. Skip rows with non-empty `mfaBackupCodes` (already migrated or NEW-service-enrolled) → re-run is a no-op.
4. Per-row single `update` writing `mfaBackupCodes`; `passwordResetToken` RETAINED.
5. Separate **verify step**: report count(source rows matching the guard) vs count(migrated rows).
6. Separate **cleanup step**, run only after verified counts: null `passwordResetToken` only where it matches the guard AND `mfaBackupCodes` is non-empty.

**Alternatives considered**: SQL inside the Prisma migration file (rejected: deploy-time lock window, not idempotent, raw SQL drags fitness #23 exceptions); lazy migrate-on-login (rejected: dual storage persists indefinitely, verification never completes, blocks legacy deletion).

**Rationale**: Single-row typed updates take only row locks (online); idempotency + retained source satisfy the MERGE-BLOCKING backfill scenarios verbatim.

### Decision 4: Subject targeting + tenant isolation

**Choice**: New `MfaSubject` type (const-object union): `{ type: "admin" | "customer"; id: string }`. Customer routes (`/auth/mfa/*`) build `{ type: "customer", id: request.customerUser.id }` and pass `request.customerUser.email` as `userEmail` (fixing `mfaRoutes.ts:98` where the id was assigned to `userEmail`). Admin routes keep `{ type: "admin" }`. For force-disable parity a NEW route `/admin/customers/:userId/mfa/force-disable` (same `requireAdminAuth` + `USER_MANAGE` guards, audit resource `CustomerUser`) sits beside the existing `/admin/users/:userId/mfa/force-disable` — rejected alternative: one route with a `subjectType` body discriminator (ambiguous audit resource naming, easier to mis-review).

**Tenant isolation**: `customerUser` is in `TENANT_SCOPED_MODELS` (tenantGuard.ts:111), so the customer adapter's typed queries get `accountId` auto-injected when TenantContext is bound. Authenticated customer routes run inside the customer's tenant context — a customer can only touch their own row. The pre-auth login verify (`/auth/mfa/verify`) executes after password validation has identified the CustomerUser; the flow binds tenant context from that identified user's `accountId` before the MFA read/write. Admin-over-customer force-disable is a cross-tenant admin operation → sanctioned `withSystemContext()` path (canon; NO tenant-guard bypass invented).

**UoW**: mutating operations (verify-setup enable, backup-code single-use marking, regenerate, disable, force-disable) wrap state write + audit write in `TOKENS.UnitOfWork.executeInTransaction` (UoW-aware repos via AsyncLocalStorage) so MFA state and its audit trail cannot diverge.

### Decision 5: DI wiring (fixes SMELL-37)

**Choice**: Reuse `TOKENS.MfaService` (types.ts:121) for the unified service — every call site already resolves it; renaming is churn with zero information. Add `TOKENS.AdminMfaUserRepository` + `TOKENS.CustomerMfaUserRepository`. Register adapters + service in `setupServices.ts` composition root (replacing the legacy factory at :173-181, same pattern). `AdminAuthService` gains a `mfaService: MfaService` constructor parameter resolved at the composition root — the inline `new MfaService(this.prisma)` at `AdminAuthService.ts:47` is deleted. `AuthService`/`authServiceCore` keep their injected `MfaService` (now the unified one); their call sites adapt to the subject-first signatures. Rejected: a separate `TOKENS.UnifiedMfaService` (two tokens for one capability recreates the duality this change kills).

### Decision 6: Legacy retirement

**Choice**: Delete `apps/api/src/auth/mfaService.ts`; repoint imports in `setupServices.ts:19`, `authService.ts:11`, `authServiceCore.ts:17`, `mfaRoutes.ts:11`. Zero-reference grep gate (`rg "auth/mfaService"` → 0). Deletion lands only in the final PR, after the backfill verify step passes and contract tests prove parity — never before.

## Data Flow

    mfaRoutes (/auth/mfa/*) ──customer subject──┐
    AdminAuthService / authServiceCore ──admin──┤
    /admin/{users|customers}/:id/mfa/* ─either──┤
                                                ▼
                              MfaService (unified, DI)
                              │ dispatch by subject.type
              ┌───────────────┴───────────────┐
              ▼                               ▼
    MfaUserRepositoryPort            MfaUserRepositoryPort
    (PrismaAdminMfaUserRepo)         (PrismaCustomerMfaUserRepo)
              │                               │ tenant guard (accountId)
              ▼                               ▼
         AdminUser                       CustomerUser
    mfaBackupCodes/UsedAt           mfaBackupCodes/UsedAt (NEW)
              ▲
              └── backfill script ← passwordResetToken (retained until verified)

## File Changes

| File                                                                      | Action | Description                                                                                                        |
| ------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `packages/ports/src/MfaUserRepositoryPort.ts`                             | Create | Technology-free port (find MFA state, save enrollment, mark code used, disable) + export in `index.ts`             |
| `apps/api/src/admin/auth/MfaService.ts`                                   | Modify | Completed unified service: port-injected, subject-dispatch, 3 ported capabilities, pinned window/codes             |
| `apps/api/src/infrastructure/adapters/PrismaAdminMfaUserRepository.ts`    | Create | AdminUser adapter (constructor-injected PrismaClient)                                                              |
| `apps/api/src/infrastructure/adapters/PrismaCustomerMfaUserRepository.ts` | Create | CustomerUser adapter (tenant-scoped) — ships with the migration (Prisma client types require the new columns)      |
| `apps/api/src/infrastructure/container/setupServices.ts`                  | Modify | Register adapters + unified service under `TOKENS.MfaService`; inject into `AdminAuthService`; drop legacy factory |
| `apps/api/src/infrastructure/container/types.ts`                          | Modify | Add the two adapter tokens                                                                                         |
| `apps/api/src/admin/auth/AdminAuthService.ts`                             | Modify | Constructor-inject `MfaService`; delete inline `new` (:47)                                                         |
| `apps/api/src/auth/mfaRoutes.ts`                                          | Modify | Customer subject targeting; `userEmail` = email (:98 fix); add `/admin/customers/:userId/mfa/force-disable`        |
| `apps/api/src/auth/{authService,authServiceCore}.ts`                      | Modify | Repoint type imports; subject-first call sites                                                                     |
| `infra/prisma/schema.prisma` + migration                                  | Modify | `CustomerUser.mfaBackupCodes` + `mfaBackupUsedAt`; down-migration drops only these                                 |
| `scripts/migrations/backfill-admin-mfa-backup-codes.ts`                   | Create | Online idempotent backfill + verify + cleanup steps                                                                |
| `apps/api/src/auth/mfaService.ts`                                         | Delete | Legacy retired (final PR only)                                                                                     |

## Interfaces / Contracts

```typescript
export const MFA_SUBJECT_TYPE = { ADMIN: "admin", CUSTOMER: "customer" } as const;
export type MfaSubjectType = (typeof MFA_SUBJECT_TYPE)[keyof typeof MFA_SUBJECT_TYPE];
export interface MfaSubject {
  readonly type: MfaSubjectType;
  readonly id: string;
}

export interface MfaUserRecord {
  readonly id: string;
  readonly email: string;
  readonly mfaEnabled: boolean;
  readonly mfaSecret: string | null;
  readonly mfaBackupCodes: readonly string[]; // argon2id hashes
  readonly mfaBackupUsedAt: Readonly<Record<string, string>>; // index -> ISO timestamp
}

export interface MfaUserRepositoryPort {
  findById(userId: string): Promise<Result<MfaUserRecord, "NOT_FOUND">>;
  saveEnrollment(
    userId: string,
    data: { mfaSecret: string; mfaBackupCodes: string[] }
  ): Promise<Result<void, "NOT_FOUND">>;
  setMfaEnabled(userId: string, enabled: boolean): Promise<Result<void, "NOT_FOUND">>;
  markBackupCodeUsed(
    userId: string,
    codeIndex: number,
    usedAt: Date
  ): Promise<Result<void, "NOT_FOUND">>;
  replaceBackupCodes(userId: string, hashedCodes: string[]): Promise<Result<void, "NOT_FOUND">>;
  clearMfa(userId: string): Promise<Result<void, "NOT_FOUND">>;
}
```

## Testing Strategy

Strict TDD (RED→GREEN). LXC: single test file, `--max-old-space-size`, `timeout` wrapper; `pnpm db:up` before integration.

| MERGE-BLOCKING scenario                                        | Test (RED first)                                                                                    | Layer                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| One capability, both subjects, via DI                          | Lifecycle suite parameterized over subject type, fake port adapters                                 | vitest unit           |
| Setup issues secret + hashed codes                             | Assert stored values are `$argon2id$` hashes, plaintext returned once                               | vitest unit           |
| Backup-code login + single-use (the 3 RED anchors)             | Valid-unused succeeds + index marked; reused fails; unknown fails — FAILS today (capability absent) | vitest unit           |
| Regenerate invalidates old / fresh work                        | Old code fails post-regenerate; new code verifies once                                              | vitest unit           |
| adminForceDisable both subjects + clean audit                  | Both subject types disabled; audit payload has actor+subject, zero secret fields                    | vitest unit           |
| Customer columns exist & written                               | Post-migration schema shape + setup persists to new columns                                         | node:test integration |
| No `passwordResetToken` clobber                                | Reset flow + MFA flow interleaved; both states intact                                               | node:test integration |
| Backfill exactly-once / no-op rerun / source retained / online | Seeded legacy rows; run twice; assert counts, retained source, guard skips real reset tokens        | node:test integration |
| Route subject targeting + `userEmail` fix                      | Customer route touches CustomerUser never AdminUser; `userEmail` is the email — FAILS today         | node:test integration |
| No secret logging                                              | Logger spy across all ops; zero secret material                                                     | vitest unit           |
| Legacy zero references                                         | Grep/existence assertions (file absent, 0 imports)                                                  | fitness-style check   |

**Parity guard**: contract tests capturing legacy behavior of the 3 ported methods (against a mocked `AdminUserRepositoryPort`) land in PR1 while legacy still exists; the same behavioral assertions run against the unified service before deletion.

## Migration / Rollout — chained PRs, blast radius, rollback

> 400 changed lines + schema migration → chained PRs (final split at sdd-tasks). Sequencing constraint: the customer adapter cannot compile before the Prisma migration regenerates client types.

| PR  | Content                                                                                                                                                                                                                                            | Blast radius                                                                                         | Rollback                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| PR1 | Port + admin adapter + service completion + DI rewire (`TOKENS.MfaService` → unified; `AdminAuthService` injection) + contract/parity tests. Customer routes keep today's (buggy, admin-targeted) behavior via admin subject — behavior-preserving | Admin login MFA path (highest risk: admin lockout). Mitigated by contract tests + pinned `window: 2` | Revert commit; legacy still present                                                 |
| PR2 | CustomerUser migration + customer adapter + route repoint (customer subject + `userEmail` fix) + `/admin/customers/.../force-disable` + no-clobber tests                                                                                           | Customer MFA (currently broken-by-design; low regression exposure). Migration additive/non-blocking  | Revert + down-migration (drops only the 2 new columns)                              |
| PR3 | Backfill script + verify + cleanup + legacy deletion + zero-ref gate                                                                                                                                                                               | Admin backup-code data. Source retained until verified count → recoverable at every step             | Restore legacy file + DI factory; source column still intact if cleanup not yet run |

## Open Questions

None blocking. One implementation note for tasks: align `adminAuthConfig.mfa.backupCodesCount` to the pinned 8×8-hex format.
