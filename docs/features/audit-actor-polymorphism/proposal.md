# Proposal: Audit Actor Polymorphism

## Intent

Customer-actor audit rows are silently dropped. `AuditLog.userId` carries an FK to `AdminUser` only (`infra/prisma/schema.prisma:251`), so when `MfaService.audit()` (`apps/api/src/admin/auth/MfaService.ts:387-398`) writes a customer subject id as `userId`, the insert violates the FK and `AuditableService.writeAuditLog`'s catch (`apps/api/src/services/AuditableService.ts:297-306`) logs the error and drops the row — the security evidence is lost. An audit record that cannot attribute the action to its actor violates OWASP Logging Cheat Sheet / NIST SP 800-92 attribution guidance. The gap becomes production-visible the moment `mfa-consolidation` PR2 routes customer MFA subjects into audit writes; today readers also infer "system action" from `userId == null`, which a second actor FK would make ambiguous without an explicit discriminator.

## Scope

### In Scope

- Schema: `AuditLog.customerUserId String?` + real FK to `CustomerUser` (`onDelete: SetNull`, distinct relation name), reverse relation on `CustomerUser`, `@@index([customerUserId, createdAt])`.
- Explicit `actorType` discriminator (const-object union `SYSTEM | ADMIN | CUSTOMER`), backfilled for existing rows (`userId != null` → `ADMIN`, else `SYSTEM`).
- Exclusive-arc CHECK as raw SQL inside the Prisma migration: `num_nonnulls("userId", "customerUserId") <= 1` (`<=` because system rows have both null).
- Write path: propagate `customerUserId` + `actorType` through `AuditLogCreateInput` / `AuditLogRecordDto`, `PrismaAuditLogRepository`, `InMemoryAuditLogRepository`, `AuditableService` (customer-actor seam for MFA), `AuditService.log`, `AuditLogger.log` (optional fields only).
- `anonymizeUser` extended to customer actors (DSAR) — `actorType` survives anonymization.
- Read path (second PR): `AuditService.getLogs`/`getStats`, `AuditLogger.getStatistics`, CSV export column, API response shape, `apps/admin` frontend type.
- ADR-0020 (next free number after ADR-0019) documenting the exclusive-arc decision. Deciders: Edward Velasquez.
- Unit + integration tests, including a customer-actor row persisted against a real database.

### Out of Scope

- **Making audit-write failure loud** (alerting/rethrow). Verified: the catch DOES emit `logger.error(..., "Failed to write audit log")` — the row is lost but the failure is not invisible (the repo's own "silently swallowed" JSDoc is imprecise). This change removes the FK _cause_ of the loss; loud-failure is a separate operational decision (OWASP/NIST) → backlog follow-up.
- Migrating `AuditService.log` / `AuditLogger.log` to the port — they keep their direct writes and only gain the new optional fields.
- A third actor type (provider, service account, API key). Approach A's future cost if it arrives: one more nullable column + a CHECK edit.
- Any RLS / tenant-guard change. `AuditLog` stays denylisted (immutable evidence outside RLS).

## Capabilities

### New Capabilities

- `audit-actor-attribution`: polymorphic actor schema — `customerUserId` FK, `actorType` discriminator, exclusive-arc CHECK, index, backfill.
- `customer-audit-write-path`: customer-actor writes through port/adapters/services + `anonymizeUser` DSAR extension.
- `audit-actor-visibility`: customer actors surfaced in logs/stats/CSV export/admin frontend compliance views.

### Modified Capabilities

None.

## Approach

Approach A (decided): additive exclusive arc — one nullable FK per actor table plus a CHECK, the shape sanctioned by Karwin (_SQL Antipatterns_ ch. 7) and Prisma's own polymorphism guidance. Rejected: free-string `userId` + `actorType` without FKs (the documented antipattern — zero referential integrity) and a shared actor supertype table (disproportionate blast radius for two actor types). The `actorType` discriminator is in because `userId == null` would otherwise conflate system and customer actions. Fitness #23 scopes application code only, so the CHECK and backfill in hand-written migration SQL are canon-clean. Deferred to design: the MFA seam shape (`customerUserId?` field vs actor object `{ type, id }`) and whether `accountId` is required on customer-actor rows.

## Affected Areas

| Area                                                                         | Impact   | Description                                              |
| ---------------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| `infra/prisma/schema.prisma` + migration                                     | Modified | `customerUserId` FK, `actorType`, CHECK, index, backfill |
| `packages/core/domain/src/repositories/AuditLogRepository.ts`                | Modified | Port input/DTO + `anonymizeUser` contract                |
| `apps/api/src/infrastructure/repositories/PrismaAuditLogRepository.ts`       | Modified | Create + `anonymizeUser` for customer actors             |
| `apps/api/tests/unit/helpers/InMemoryAuditLogRepository.ts`                  | Modified | Mirror port changes                                      |
| `apps/api/src/services/AuditableService.ts`                                  | Modified | Customer-actor write seam (consumed by MFA PR2)          |
| `apps/api/src/audit/auditService.ts`, `apps/api/src/security/auditLogger.ts` | Modified | Optional new fields (A1); stats/queries (A2)             |
| `apps/api/src/audit/auditRoutes.ts` + `apps/admin/lib/api/types.ts`          | Modified | CSV column, response shape, frontend type (A2)           |
| `docs/technical/ADR-0020-*.md`                                               | New      | Exclusive-arc decision record (A1)                       |

## Risks

| Risk                                                                                                                                  | Likelihood | Mitigation                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ambiguity regression: without `actorType`, `userId == null` conflates system vs customer                                              | High       | `actorType` ships in A1 with deterministic backfill; readers never infer actor from null checks again                                                                                                                           |
| DSAR/GDPR gap _introduced by this change_: customers appear in `AuditLog` for the first time, but `anonymizeUser` nulls `userId` only | High       | Extend `anonymizeUser` to customer actors in A1, same PR that enables customer rows — the gap never ships                                                                                                                       |
| Ordering violation: `mfa-consolidation` PR2 merges first and customer MFA audits are dropped                                          | Med        | Hard dependency recorded here + in PR descriptions; A1 explicitly blocks MFA PR2                                                                                                                                                |
| CHECK on a table with existing rows fails to apply                                                                                    | Low        | Existing rows cannot violate it: `customerUserId` is new, so every existing row has it null → `num_nonnulls <= 1` holds by construction                                                                                         |
| Read/stats/export drift if only the write path ships                                                                                  | Med        | A2 chained immediately after A1; meanwhile admin consumers are unaffected (customer rows surface `user` as null)                                                                                                                |
| Fitness regressions                                                                                                                   | Low        | #23 (migration SQL exempt — check targets app code only); #9/#10 (JSDoc `@file` + valid `@layer` on new files); #21 (anything new constructed only in the composition root); #3 (no `any` — const-object union for `actorType`) |

## Rollback Plan

A1 migration is down-migratable: drop the CHECK, drop the index, drop `customerUserId`, drop `actorType` — no data loss (`actorType` is re-derivable from `userId`). Code changes are additive and revert cleanly by commit; the port keeps backward-compatible optional fields so a revert does not break existing writers. A2 is read-path only — revert the commit. If A1 must be rolled back after MFA PR2 merges, PR2 must be reverted first (it depends on the seam).

## Dependencies

- **Hard ordering: A1 MUST merge before `mfa-consolidation` PR2** — PR2 makes `MfaService` audit customer subjects; without A1 those rows hit the AdminUser FK and are dropped.
- `pnpm db:up` before running the Prisma migration (mandatory per CLAUDE.md).
- No external dependencies.

## Delivery

Two chained PRs, `stacked-to-main`:

1. **A1** — schema (FK + `actorType` + CHECK + index + reverse relation + backfill) + full write path + `anonymizeUser` for customer actors + ADR-0020 + tests. **Blocks `mfa-consolidation` PR2.**
2. **A2** — visibility/read path: `AuditService.getLogs`/`getStats`, `AuditLogger.getStatistics`, CSV export column, API response shape, `apps/admin` frontend type.

## Success Criteria

- [ ] A customer-actor audit row persists against a real database (integration test — a mocked unit test would not have caught the original FK bug).
- [ ] Exclusive-arc CHECK enforced: an insert with both `userId` and `customerUserId` set is rejected by the database.
- [ ] `actorType` backfill correct: pre-existing rows read `ADMIN` (had `userId`) or `SYSTEM` (null).
- [ ] `anonymizeUser` anonymizes customer-actor rows; `actorType` attribution survives anonymization.
- [ ] Admin read paths behave identically for admin rows; after A2, a customer actor is visible in logs, stats, CSV export, and the admin compliance view.
- [ ] ADR-0020 merged in A1.
- [ ] A1 merged before `mfa-consolidation` PR2.
- [ ] 0-defect gate: `eslint --max-warnings 0`, `tsc` clean, all CI fitness functions hard-zero (#3/#9/#10/#21/#23 explicitly), LXC-safe tests green.
