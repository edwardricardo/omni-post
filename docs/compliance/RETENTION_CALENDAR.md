# Data Retention Calendar

> **Workstream:** §4.3 of the normalization roadmap, phase A1 ([its last version](https://github.com/edwardricardo/omni-post/blob/3758be3ee3d4274bcc01582b437080732f50d11d/docs/architecture/NORMALIZATION_ROADMAP.md)); the open
> work is in Master Plan §5.2, rows GDPR-1 to GDPR-3.
> **Owner:** Platform engineering · Compliance.
> **Source of truth** for per-data-type retention windows, the field on
> `GdprSettings` that drives each window, and the scheduled job that
> enforces the deletion.

This document is the central registry. When you add a new tenant-scoped or
PII-bearing model, append a row before the migration ships. When you change
a retention window, update this calendar in the same PR that bumps the
default on `GdprSettings`.

---

## Retention matrix

| Data type           | Retention                                 | Source `GdprSettings` field | Enforcement                                                                      | Status                         |
| ------------------- | ----------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- | ------------------------------ |
| `AuditLog`          | 90 days (default)                         | `auditLogRetentionDays`     | `DataRetentionService.runRetentionCleanup` — hard delete                         | ✅ Phase A1 — DAILY            |
| `DsarRequest`       | `dsarResponseDays` deadline (30d default) | `dsarResponseDays`          | `DataRetentionService.runRetentionCleanup` — `PENDING` past deadline → `EXPIRED` | ✅ Phase A1 — DAILY            |
| `DataBreachReport`  | indefinite                                | n/a                         | manual (no automated retention)                                                  | ⚠ GDPR-3 (regulator reporting) |
| `OutboxEvent`       | 7 days after creation, once published     | n/a                         | `OutboxCleaner` — hourly hard delete of published events older than 7 days       | ✅ automatic — HOURLY          |
| `StoredEvent`       | indefinite                                | n/a                         | no automated retention                                                           | ❌ GDPR-2                      |
| `AccountCredential` | tied to `Account` lifecycle               | n/a                         | DB-level FK CASCADE on `Account` delete                                          | ⚠ no soft-delete               |
| `CustomerUser`      | tied to `Account` lifecycle               | n/a                         | DB-level FK CASCADE on `Account` delete                                          | ⚠ GDPR-2: GDPR cascade pending |
| Tenant tables (51)  | tied to `Account` lifecycle               | n/a                         | DB-level FK CASCADE on `Account` delete                                          | ⚠ GDPR-2: GDPR cascade pending |
| Notice claim key    | 24 hours; SHA-256 hex, not the address    | n/a                         | Redis key TTL; `ThrottledDeletedAccountNoticeMailer` set-if-absent with expiry   | ✅ automatic — key TTL         |

Legend:

- ✅ **Phase A1 — DAILY**: enforced by a registered `BackgroundTaskScheduler` task running every 24h.
- ✅ **automatic — HOURLY**: enforced by a scheduled task that runs every hour (the outbox's `OutboxCleaner`).
- ⚠ **manual / no soft-delete**: deletion happens only via explicit operator action or DB cascade; no scheduled cleanup.
- ✅ **automatic — key TTL**: the Redis key of the deleted-account notice claim expires on its own after 24h; no scheduled job runs.
- ❌ **no automated retention**: data accumulates indefinitely; retention work tracked under the linked Master Plan row.

---

## Scheduled enforcement

The data-retention task is registered in
`apps/api/src/index.ts:964-971` (the outbox has its own hourly `OutboxCleaner`,
started at `:901`):

```typescript
scheduler.register(
  "data-retention-cleanup",
  () =>
    withSystemContext("system:data-retention-cleanup", () => dataRetention.runRetentionCleanup()),
  24 * 60 * 60 * 1000 // every 24h
);
```

| Property       | Value                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------- |
| Task ID        | `data-retention-cleanup`                                                                     |
| Interval       | `24 * 60 * 60 * 1000` ms (24 h)                                                              |
| Registered via | `TOKENS.BackgroundTaskScheduler` (`DefaultBackgroundTaskScheduler`)                          |
| Driver service | `DataRetentionService.runRetentionCleanup()`                                                 |
| Gating flag    | `GdprSettings.enableAutoDataDeletion === true`                                               |
| Logger         | `createLogger("data-retention")` — emits `{ auditLogsDeleted, expiredDsarRequests }` per run |
| Audit emitter  | `AuditEmitterPort` — emits `DATA_RETENTION_CLEANUP` per non-zero run                         |
| Teardown       | `scheduler.shutdownAll()` on SIGINT/SIGTERM                                                  |

### `DataRetentionService.runRetentionCleanup` invariants

1. **Gated** on `GdprSettings.enableAutoDataDeletion === true` — when the
   tenant disables auto-deletion (legal hold, audit window), the job is a
   no-op.
2. **Idempotent**: re-running the cleanup on the same dataset yields the
   same end state. The `AuditLog` window is `createdAt < now - window`;
   the `DsarRequest` transition is `PENDING ∧ deadlineAt < now → EXPIRED`.
3. **Layered**: queries through `AuditLogRetentionPort` +
   `DsarRequestRepository` — no raw `prisma.*` in the service.
4. **Audit-emitted** only when the cleanup mutated rows (auditLogsDeleted > 0
   or expiredDsarRequests > 0). Zero-row runs do not pollute the audit log.

---

## Jurisdictional matrix

| Regime           | Triggers retention requirement                                               | Affected fields                                  |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| GDPR (EU)        | Right-to-erasure (Art. 17), data minimization (Art. 5), DSAR 30d (Art. 12§3) | `AuditLog`, `DsarRequest`, all tenant PII tables |
| LGPD (BR)        | Art. 18 (data access/erasure), Art. 15 (data retention principle)            | same as GDPR                                     |
| CCPA / CPRA (CA) | Right-to-delete (CCPA §1798.105), DSAR ~45d                                  | `AuditLog`, `DsarRequest`                        |
| PIPEDA (CA)      | Principle 5 (limiting retention)                                             | `AuditLog`, `DsarRequest`                        |

The current Phase A1 enforcement (`auditLogRetentionDays` default 90,
`dsarResponseDays` default 30) is the strictest common denominator across
the four regimes. Per-tenant overrides via `GdprSettings` allow tightening
(e.g., a GDPR-strict tenant can drop `auditLogRetentionDays` to 30) but
the system is meant not to allow loosening past the regulatory ceiling — that
guard is open under Master Plan GDPR-3; today only the request schema bounds the value, to 30 to 3650 days (`apps/api/src/compliance/complianceSchemas.ts:17`).

---

## Verification

- **Integration tests:**
  `apps/api/tests/integration/data-retention.integration.test.ts` — 2 E2E
  tests against real Postgres:
  1. `AuditLog` rows with `createdAt` past the window are hard-deleted;
     rows within the window are preserved.
  2. `DsarRequest` rows with `status=PENDING` and `deadlineAt < now` are
     marked `EXPIRED`; on-time rows remain `PENDING`.
- **Unit tests:**
  `apps/api/tests/unit/compliance/DataRetentionService.test.ts` — 5 cases
  covering the 4 short-circuit guards + the active cleanup path.
- **Manual smoke test:**
  Trigger the task body via the scheduler shim (test only):
  ```typescript
  const result = await dataRetention.runRetentionCleanup();
  // { auditLogsDeleted: N, expiredDsarRequests: M }
  ```

---

## Out of scope (linked Master Plan rows)

The following are NOT enforced by Phase A1. Each item is a row of
[Master Plan](../product/MASTER_PLAN.md) §5.2 and keeps its roadmap id:

- **GDPR-1 (§4.3.b) — DSAR EXPORT real dump.** Today the `exportUrl` is a manual
  operator input. A background job that (1) serializes every tenant-scoped
  table for a `requestorAccountId`, (2) uploads the dump to S3, (3) sets
  `exportUrl` + a 7-day expiration is **pending**. Requires multi-table
  serializer + S3 integration.
- **GDPR-2 (§4.3.c) — StoredEvent retention + account deletion
  cascade.** The event store grows unbounded (the outbox does not:
  `OutboxCleaner` deletes published events older than 7 days, hourly). A
  retention window (typically 14-30d post-`PROCESSED`) + a GDPR-integrated
  account deletion cascade are **pending**.
- **GDPR-3 (§4.3.d) — PII masking in audit logs + regulatory reporting API.**
  Today `AuditLog.details` can contain PII (user emails; the IP has its own
  `ipAddress` column). A
  redaction pass on persistence + a `regulatoryReportedAt` submission
  endpoint (per-breach jurisdictional reporting) are **pending**.

---

## How to extend

Adding a new retention rule:

1. Add the row to the §"Retention matrix" above with the data type,
   window source, enforcement mechanism, and status.
2. If the window is configurable, add the field to `GdprSettings` and
   migrate; default value MUST match the regulatory floor.
3. Add the deletion / state-transition path to `DataRetentionService` (or
   to a sibling service if scope warrants), exposing it via a port —
   never `prisma.*` direct.
4. Add an integration test in
   `apps/api/tests/integration/data-retention.integration.test.ts`
   (or sibling) — insert with an artificially aged timestamp, run the
   cleanup, assert the desired post-state.
5. Update the scheduled job documentation here if you add a new task ID.
