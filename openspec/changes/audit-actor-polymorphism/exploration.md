# Exploration: audit-actor-polymorphism

Polymorphic audit actor so `AuditLog` can attribute an action to a **CustomerUser** (not only an `AdminUser`), unblocking the MFA consolidation (`mfa-consolidation`, Cluster B) PR2 customer-audit requirement. INVESTIGATION ONLY — no source edited, no git, no migrations run.

## Current State (verified at source)

### AuditLog model — `infra/prisma/schema.prisma:236-259`

- `userId String?` "Nullable for system actions" (`:238`); `accountId String?` searchability, NOT for RLS (`:239`); `action` / `resource?` / `resourceId?` / `details? Json` / `ipAddress?` / `userAgent?` / `success @default(true)` / `error?` / `createdAt` (`:240-248`).
- `user AdminUser? @relation("PerformedBy", fields: [userId], references: [id], onDelete: SetNull)` (`:251`) — **FK to AdminUser ONLY**.
- Indexes (`:254-258`). Reverse relation: `AdminUser.auditLogs AuditLog[] @relation("PerformedBy")` (`:192`). The relation name `"PerformedBy"` is referenced at those two sites only.

### CustomerUser — `infra/prisma/schema.prisma:313-361`

- `id` (`:314`), `accountId String` (`:315`), `account Account @relation(... onDelete: Cascade)` (`:339`). No AuditLog relation today.

### Tenant / RLS posture

- `AuditLog` is NOT in `TENANT_SCOPED_MODELS` (`infra/prisma/src/extensions/tenantGuard.ts:90-141`; `customerUser` IS, `:111`) → denylisted by canon (immutable evidence lives outside RLS).
- `AuditLog` is NOT under RLS (no match in `20260527000000_add_rls_tenant_isolation/migration.sql`).

### WRITE path — three writers plus one delegator

1. `AuditableService.writeAuditLog` (`apps/api/src/services/AuditableService.ts:276-307`) → port `AuditLogRepository.create`. The catch (`:297-306`) calls `logger.error(..., "Failed to write audit log")` and does NOT rethrow: the row is lost, the caller proceeds, but an ERROR line is emitted. Wrappers: `logUserAction` (`:88`), `logAccountAction` (`:118`), `logSystemAction` (`:149`, the null-userId system workaround), `logResourceAction` (`:180`), `logSecurityEvent` (`:208`), `executeWithAudit` (`:328`). `category` / `severity` are merged into `details`, not columns.
2. `AuditService.log` (`apps/api/src/audit/auditService.ts:62-104`) → direct `prisma.auditLog.create` with `include: { user }` (AdminUser, `:84-93`); also `logCredentialDecrypt` (`:361`).
3. `AuditLogger.log` (`apps/api/src/security/auditLogger.ts:90-149`) → direct create (`:111`). Catch logs, no rethrow.
4. `auditMiddleware` (`apps/api/src/audit/auditMiddleware.ts:78`) delegates to `AuditService.log`.

Port and adapters: `AuditLogCreateInput` / `AuditLogRecordDto` (`packages/core/domain/src/repositories/AuditLogRepository.ts:13-62`); `PrismaAuditLogRepository.create` (`:36-51`) and `anonymizeUser` (`:123-129`, nulls `userId` only); `InMemoryAuditLogRepository` (`:22-37`).

### READ path (blast radius)

- Port: `findByUser` / `findByResource` / `findByAccount`.
- `AuditService.getLogs` / `getStats` — `include: { user }` AdminUser join (`:150-159`); `getStats` does `groupBy(["userId"])` plus `adminUser.findMany` (`:255-276`) → customer actors are INVISIBLE in "top users".
- `AuditLogger.queryLogs` / `getStatistics` — `groupBy(["userId"])` (`:356-365`).
- Routes `auditRoutes.ts`: the CSV export declares a `"user.email"` column (`:375`) → blank for customer rows.
- Frontend: `apps/admin/lib/api/types.ts:170-182`; `auditClient.ts`; `useAuditLogs.ts`; the compliance page.
- Retention (`PrismaAuditLogRetentionRepository`) keys off `createdAt` only — NOT affected.

### Actor-type concept — none exists for AuditLog

- `actorId` exists only on `Notification` (`schema.prisma:385`) and the inbox handlers — unrelated. `MfaService.ts:307` puts an `actorId` inside the `details` JSON only.
- Readers distinguish system from user actions ONLY by `userId == null`. Adding `customerUserId` makes `userId == null` AMBIGUOUS (system vs customer) — the core argument for an explicit `actorType`.

### MFA consumer (the driver)

- `MfaService.audit()` (`apps/api/src/admin/auth/MfaService.ts:387-398`) calls `logSecurityEvent(subject.id, subject.id, { details: { subjectType, ... } })` — passing `subject.id` as BOTH `userId` and `accountId`, with no `resource` / `resourceId`.
- With a customer subject, `userId = customerUser.id` violates the AdminUser FK → the row is dropped. Confirmed loss path.
- `MfaSubject = { type: 'admin' | 'customer', id }`, `MFA_SUBJECT_TYPE = { admin, customer }` (`packages/ports/src/MfaUserRepositoryPort.ts:18-32`). `MfaUserRecord` (`:39-46`) carries `id` and `email` but NO `accountId`.
- Coordination (verified in `openspec/changes/archive/mfa-consolidation/design.md:65,72-73` and `tasks.md:26`): `MfaUserRecord.accountId?` and the customer route repoint are PENDING in **mfa-consolidation PR2** → this change MUST land BEFORE PR2.
- `AuthServiceCore` (`apps/api/src/auth/authServiceCore.ts:48`) is admin-scoped (`AdminUserRepositoryPort`), so its audits carry AdminUser ids and satisfy the FK. The MFA customer path is the FIRST customer-actor writer in the system.

### Constraint feasibility

- Prisma cannot express CHECK constraints in `schema.prisma` → they go in raw SQL inside a migration. Precedent: `20260505043443_socialmessage_sentimentscore_check` (`ALTER TABLE ... ADD CONSTRAINT ... CHECK`), plus `t4t_check_constraints_*`.
- Fitness #23 targets application code only and explicitly excludes migrations, so hand-written SQL in a migration file is canon-clean.
- Column-add precedent: `20260530003011_add_audit_log_account_id_searchable_column`. FK and naming precedent: `infra/prisma/scripts/migrate-team-member-to-customer-user.ts` introduces `customerUserId` FK columns on 13 tables.

## Canon research (sources fetched)

- Karwin, _SQL Antipatterns_ ch. 7 — the no-FK `actorType` + `actorId` pair is the antipattern ("Polymorphic Associations"); the sanctioned fix is an exclusive arc: one nullable FK per parent table plus a CHECK. <https://pragprog.com/titles/bksqla/sql-antipatterns/>
- Prisma docs — no native polymorphism; the recommended shape is multiple nullable FK columns plus a CHECK (`num_nonnulls`) added in a migration. Validates Approach A. <https://www.prisma.io/docs/orm/prisma-schema/data-model/relations>, <https://www.prisma.io/docs/orm/prisma-schema/data-model/table-inheritance>
- OWASP Logging Cheat Sheet and NIST SP 800-92 — an audit record MUST accurately attribute the action to who performed it; recording a wrong or absent identity conceals the responsible party. Argues both against the silent loss and against storing a customer id under an AdminUser FK. <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>

## Approaches

1. **A — Additive `customerUserId String?` + FK → CustomerUser (plus `actorType` discriminator and an exclusive-arc CHECK)** — RECOMMENDED
   - Pros: keeps the AdminUser FK (referential integrity for both actor types); admin consumers are unaffected (customer rows surface `userId`/`user` as null); matches the Prisma and Karwin canon; reuses the existing `customerUserId` FK and naming precedent; the additive migration mirrors an existing one; `onDelete: SetNull` plus `actorType` preserve the attribution type through anonymization.
   - Cons: two nullable actor columns (a third actor type later means a third column and a CHECK edit); read, stats, export and frontend paths must be extended; `anonymizeUser` must learn about customers (DSAR).
   - Effort: Medium.
2. **B — Drop the AdminUser FK; keep `userId` as a free string plus `actorType`**
   - Cons: this is precisely the Karwin/Prisma antipattern — zero referential integrity, and it regresses a sound FK. REJECT.
   - Effort: Low schema cost, high risk.
3. **C — Shared actor supertype table (an `Actor` base; `AuditLog` FK → Actor)**
   - Cons: very large blast radius (new table, backfill of every AdminUser and CustomerUser, identity rewiring) — disproportionate for two actor types. REJECT for now.
   - Effort: High.

## Recommendation

**Approach A**, matching Prisma's and Karwin's documented guidance:

1. `AuditLog.customerUserId String?` plus `customerUser CustomerUser?` (distinct relation name, `onDelete: SetNull`), an `@@index([customerUserId, createdAt])`, and the reverse relation on `CustomerUser`.
2. Add an explicit `actorType` discriminator (const-object union: SYSTEM / ADMIN / CUSTOMER) — it disambiguates system from customer and survives `anonymizeUser` / DSAR.
3. Exclusive-arc CHECK via migration SQL: `num_nonnulls("userId", "customerUserId") <= 1` (`<=`, because system rows have both null).
4. Propagate `customerUserId` and `actorType` through `AuditLogCreateInput`, `AuditLogRecordDto`, `PrismaAuditLogRepository`, `InMemoryAuditLogRepository`, `AuditableService.AuditLogEntry` / `writeAuditLog`, `AuditService`, `AuditLogger`.
5. Extend reads (getLogs / getStats customer join and top-actors, the CSV column, the frontend type). Non-breaking for admin consumers.
6. Extend `anonymizeUser` to customer actors for DSAR.
7. MFA seam: give `AuditableService` a customer-actor write path (either a `customerUserId?` entry field or an actor object `{ type, id }`); `mfa-consolidation` PR2 then routes the customer subject id to `customerUserId` and the account id to `accountId`.

## Risks

- Ambiguity regression if `actorType` is omitted: `userId == null` would conflate system and customer actions.
- Read / stats / export / frontend drift if only the write path changes.
- GDPR / DSAR: `anonymizeUser` nulls `userId` only, so customer-actor rows would not be anonymized — a gap this change introduces.
- Hard ordering: this MUST merge BEFORE `mfa-consolidation` PR2, or MFA customer audits are lost.
- The non-rethrowing catch in `writeAuditLog` remains a separate OWASP/NIST decision; the FK fix removes this particular cause but not the class.

## Open questions for design

1. Add `actorType`? Values `{ SYSTEM, ADMIN, CUSTOMER }`; backfill existing rows (`userId != null` → ADMIN, null → SYSTEM)?
2. Exclusive-arc CHECK `num_nonnulls("userId", "customerUserId") <= 1` now, or defer?
3. Should `accountId` be required on customer-actor rows?
4. MFA seam shape: a `customerUserId?` field, or an actor object `{ type, id }`?
5. Extend `anonymizeUser` to customers in this slice, or as a DSAR follow-up?
6. Make audit-write failure loud in this slice, or defer?
7. CSV and stats: add the customer actor column and grouping now, or ship a write-path-first slice?

## Ready for Proposal

Yes. The problem is confirmed at source, the recommended shape is validated by canon, the blast radius is enumerated, and the hard ordering constraint is identified. Design must resolve the seven open questions — chiefly `actorType` and the MFA write seam.
