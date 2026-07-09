# Proposal: MFA Consolidation (N-SEC-5)

## Intent

Two MFA services coexist in `apps/api`. Legacy `apps/api/src/auth/mfaService.ts` is feature-complete (already on the canonical argon2 helper) but stores hashed backup codes as JSON inside the `passwordResetToken` column — conflating a reset-token column with MFA secrets, so reset and MFA flows can clobber each other's state. New `apps/api/src/admin/auth/MfaService.ts` uses the correct `mfaBackupCodes`/`mfaBackupUsedAt` columns but is incomplete — TOTP-only verification (no backup-code login), no `regenerateBackupCodes`, no `adminForceDisable` — takes `PrismaClient` directly, and is hand-instantiated inside `AdminAuthService` (SMELL-37). Latent auth bug: `mfaRoutes.ts` reads `request.customerUser?.id` while the legacy service writes the `AdminUser` table (plus a `userEmail = customerUser?.id` bug). The duality risks divergent, incomplete MFA behavior.

Corrected premises vs the original finding: (1) legacy hashing is already canonical argon2 (SHA-256 removed in `1a48bbf3`) — the only hack is the storage location; (2) `AdminUser` already has the backup-code columns — no new admin migration.

## Scope

### In Scope

- Complete the new service: port backup-code login verification, `regenerateBackupCodes`, `adminForceDisable` with legacy feature parity.
- New technology-free MFA port (`packages/ports`) + Prisma adapter; service off raw `PrismaClient`.
- DI: register in the composition root; constructor-inject into `AdminAuthService` (fixes SMELL-37).
- Customer MFA as a real feature: `CustomerUser` migration adding `mfaBackupCodes`/`mfaBackupUsedAt`; repoint `mfaRoutes` to target `CustomerUser` (fixes the identity mismatch and the `userEmail` bug).
- Data migration: move admin backup codes off `passwordResetToken` into `mfaBackupCodes`; `passwordResetToken` reverts to reset-only use.
- Delete legacy `auth/mfaService.ts` and its DI wiring.

### Out of Scope

- TOTP algorithm/library changes.
- MFA UX redesign (frontend flows unchanged beyond endpoint correctness).
- New factor types (WebAuthn, SMS).

## Capabilities

### New Capabilities

- `unified-mfa-service-and-port`: one port-based MFA service (setup, verify incl. backup codes, regenerate, force-disable, status) serving admin + customer subjects via DI.
- `customer-mfa-persistence`: `CustomerUser` backup-code columns + admin data migration off `passwordResetToken`.
- `mfa-flow-correctness`: customer MFA routes operate on `CustomerUser`; audit logging preserved; no secret logging.

### Modified Capabilities

None.

## Approach

Approach B (decided): complete the new service; never extend the legacy one. Author the MFA port; port the three missing capabilities with parity (single-use backup-code marking, audit events); wire via DI; migrate `CustomerUser` schema and repoint the customer flow; backfill admin codes; delete legacy. Candidate seam — one subject-typed MFA-user port vs two adapters behind one port — deferred to design.

## Affected Areas

| Area                                                     | Impact   | Description                                |
| -------------------------------------------------------- | -------- | ------------------------------------------ |
| `packages/ports/src/` (MFA port)                         | New      | Technology-free port contract              |
| `apps/api/src/admin/auth/MfaService.ts`                  | Modified | Completed, port-based                      |
| `apps/api/src/auth/mfaService.ts`                        | Removed  | Legacy service retired                     |
| `apps/api/src/infrastructure/container/setupServices.ts` | Modified | DI rewire (token, injection)               |
| `apps/api/src/**/mfaRoutes.ts`                           | Modified | CustomerUser targeting                     |
| `infra/prisma/schema.prisma` + migrations                | Modified | CustomerUser columns + admin data backfill |

## Risks

| Risk                                       | Likelihood | Mitigation                                                                                            |
| ------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------- |
| Feature-parity loss porting the 3 methods  | Med        | Contract tests mirroring legacy behavior before deletion                                              |
| Backfill loses/corrupts admin backup codes | Med        | Idempotent migration; verify counts; keep source values until verified                                |
| Identity-mismatch fix touches live auth    | Med        | Integration tests per subject type; chained PRs                                                       |
| Fitness regressions                        | Low        | #18 canonical hasher only; #21 port injection, no singleton; #23 migration script via sanctioned path |
| Secret leakage in logs                     | Low        | Never log codes/secrets; rely on `REDACT_PATHS`                                                       |

Fitness interactions: #18 (argon2 helper — must stay green), #21 (composition-root DI), #23 (raw SQL in data migration), #9/#10 (JSDoc on new files).

## Rollback Plan

Each chained PR independently revertible: port + service completion is additive (revert commit); customer columns have a down-migration (new columns only, no data loss); legacy deletion lands only after backfill is verified — revert restores the service + DI token. Backfill leaves `passwordResetToken` values intact until a verified cleanup step.

## Dependencies

- `pnpm db:up` before Prisma migrations (mandatory). No external dependencies.

## Delivery

Likely >400 changed lines + a schema migration → chained PRs (candidate split: 1. port + service completion; 2. customer persistence + flow; 3. data migration + legacy retirement). Final split decided at sdd-tasks.

## Success Criteria

- [ ] Single MFA service; legacy `auth/mfaService.ts` deleted, zero references.
- [ ] Backup codes live only in `mfaBackupCodes` (both tables); `passwordResetToken` reset-only.
- [ ] Customer MFA flow operates end-to-end on `CustomerUser`.
- [ ] 0-defect gate: `lint --max-warnings 0`, `tsc` clean, all CI fitness functions hard-zero (#18/#21/#23 explicitly), LXC-safe tests green.
