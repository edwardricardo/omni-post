# Multi-Tenant Isolation — Living Spec

> Cumulative living specification for the **multi-tenant-isolation** capability:
> STRUCTURAL enrollment of `projectId`-only models into the two-layer tenant guard
> (`accountId` denormalization + Prisma `$extends` guard + PostgreSQL RLS).
> Established by change `external-notification-tenant-guard` (Slice 1 of the
> `project-scoped-tenant-guard` rollout), archived 2026-07-14, PR #113
> (branch `workstream/cluster-c-extnotif-guard`).
> Source of truth: `docs/security/MULTI_TENANT_GUARDS.md`.
>
> Scope note: this capability covers isolation **by construction at the data layer**.
> It is distinct from the per-model APP-LEVEL ownership specs archived separately
> (`trackedlink-tenant-isolation`, `post-tenant-isolation`), which gate at the
> route/use-case layer.
>
> **Extension contract for Slices 2–8 of the rollout.** Requirements 1, 3, 4, and 5
> below are **model-agnostic invariants** — every slice that enrolls a new model
> extends them (appends a row to the Requirement 1 "Enrolled models" table, appends
> a concretizing bullet/scenario to Requirement 3 for its own create/repoint path)
> WITHOUT restating the invariant text. Requirement 2 is **model-scoped by design**
> (its heading names the model and enumerates that model's specific live IDOR
> routes) — each slice ADDS its own Requirement-2-shaped block, named after its
> model, rather than editing this one. Slice 1's instance is
> `ExternalNotificationConfig — the three live IDOR routes are closed...` below.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** MUST be proven green before merge. Scenarios marked **[static]**
> are checkable by inspecting schema/migrations/config; **[integration]** scenarios
> require a real-DB, two-tenant run through HTTP — a mocked unit test CANNOT prove a
> guard that operates at the Prisma layer.

---

## Requirements

### Requirement: Structural tenant isolation by construction [MERGE-BLOCKING]

Every enrolled model SHALL be isolated at the DATA layer, not by per-route ownership
checks. For each enrolled model the system SHALL satisfy all three legs:

1. the table carries a **non-null `accountId`** column with an `Account` relation
   (`onDelete: Cascade`) and an index led by `accountId` (a plain `@@index([accountId])`,
   or a composite `@@index([accountId, <parentId>])` when the model's dominant guarded
   read is parent-filtered);
2. the model is listed in **`TENANT_SCOPED_MODELS`** (Prisma `$extends` guard, layer 1);
3. the table is covered by an **RLS policy** keyed on the `app.account_id` GUC (layer 2),
   introduced by a NEW forward migration (the existing `20260527000000` SHALL NOT be edited).

Consequently, every query issued through the guarded Prisma client SHALL be auto-scoped to
the account bound in the active `TenantContext`, and NO per-route ownership check SHALL be
required for read, update, or delete paths.

**Enrolled models (extended by each slice):**

| Model                        | Slice | accountId | `TENANT_SCOPED_MODELS` | RLS policy |
| ---------------------------- | ----- | --------- | ---------------------- | ---------- |
| `ExternalNotificationConfig` | 1     | Required  | Required               | Required   |
| `ScheduledReport`            | 2     | Required  | Required               | Required   |
| `Campaign`                   | 2     | Required  | Required               | Required   |

#### Scenario: the three legs are present for each enrolled model [static]

- **GIVEN** the change enrolling a model is applied
- **WHEN** `schema.prisma`, `infra/prisma/src/extensions/tenantGuard.ts`, and the RLS migration are inspected
- **THEN** the model's `accountId` is non-null with an `Account` relation + accountId-led index, its lowerCamel name appears in `TENANT_SCOPED_MODELS`, and an RLS policy covers the table

#### Scenario: reads through the guarded client are auto-scoped [integration]

- **GIVEN** tenant A's context is bound and rows of an enrolled model exist for both A and B
- **WHEN** any find/update/delete query runs through the guarded Prisma client
- **THEN** only A's rows are visible/affected, with no `accountId` filter written by the caller

#### Scenario: a query with no bound tenant context is refused [integration]

- **GIVEN** no `TenantContext` is bound (and no `withSystemContext()` wrap)
- **WHEN** a query on an enrolled model runs through the guarded client
- **THEN** it fails with `TenantContextMissingError` — it SHALL NOT silently return unscoped rows

---

### Requirement: ExternalNotificationConfig — the three live IDOR routes are closed, and no decrypted secret crosses the boundary [MERGE-BLOCKING]

An authenticated tenant A SHALL NOT be able to read, delete, or act on tenant B's
`ExternalNotificationConfig`. Each of the three live cross-tenant paths SHALL resolve to
NOT_FOUND. Critically, because `webhookUrl` is an AES-GCM envelope decrypted on EVERY read,
NO decrypted webhook secret (Slack/Teams bearer token) SHALL cross the tenant boundary — not
in a response body, not in an error message, and not through an outbound webhook send.

#### Scenario: A cannot list B's configs via a foreign projectId [integration]

- **GIVEN** tenant A is authenticated and tenant B owns a config under B's project
- **WHEN** A calls `GET /external-notifications?projectId={B's projectId}`
- **THEN** the response contains ZERO of B's configs (empty result), and no decrypted `webhookUrl` of B appears in the payload

#### Scenario: A cannot delete B's config by id [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's config
- **WHEN** A calls `DELETE /external-notifications/{B's configId}`
- **THEN** the request resolves to NOT_FOUND and B's config still exists in the database

#### Scenario: A cannot fire the test webhook for B's config [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's config
- **WHEN** A calls `POST /external-notifications/{B's configId}/test`
- **THEN** the request resolves to NOT_FOUND, NO outbound send is performed against B's webhook, and B's decrypted secret is never materialized in the response or logs

---

### Requirement: Create paths validate parent ownership per enrolled model [MERGE-BLOCKING]

The guard injects `accountId` from the bound context but does NOT validate parent–child
consistency. Therefore every create (or repoint) path of an enrolled model that accepts a
client-supplied parent id SHALL verify that the parent belongs to the caller's account
BEFORE persisting, and SHALL reject with **NOT_FOUND (404)** otherwise — never 403
(anti-enumeration: a 403 confirms the resource exists). Without this check a tenant could
persist a row carrying its OWN `accountId` and a FOREIGN parent id — an inconsistent row and
a latent exfiltration channel. Each slice concretizes this requirement for its own model's
create path; the invariant is stated once here.

**Applied so far (extended by each slice):**

| Model                        | Slice | Create path                                                             |
| ---------------------------- | ----- | ----------------------------------------------------------------------- |
| `ExternalNotificationConfig` | 1     | `POST /external-notifications` → `ConfigureExternalNotificationUseCase` |
| `ScheduledReport`            | 2     | `POST /reports` → `CreateScheduledReportUseCase`                        |
| `Campaign`                   | 2     | `POST /campaigns` → `CreateCampaignUseCase`                             |

#### Scenario: create against a foreign parent is rejected [integration]

- **GIVEN** tenant A is authenticated and the supplied parent id (e.g. `projectId`) belongs to tenant B
- **WHEN** A calls the model's create endpoint with B's parent id
- **THEN** the response is **404 NOT_FOUND** (never 403), and NO row is persisted

#### Scenario: create against an own parent succeeds and is consistent [integration]

- **GIVEN** tenant A is authenticated and the supplied parent id belongs to A
- **WHEN** A calls the model's create endpoint
- **THEN** the row is created and `accountId == <parent>.accountId` holds on the persisted row

---

### Requirement: Backfill integrity — zero NULL accountId

Every pre-existing row of an enrolled model SHALL receive its `accountId` from the guarded
parent's `accountId`, traversed over the parent's NOT NULL FK, BEFORE the `SET NOT NULL`
flip. Zero rows SHALL remain NULL, and zero rows SHALL be dropped or orphaned by the
migration.

#### Scenario: no row survives the migration with a NULL or inconsistent accountId [integration]

- **GIVEN** rows exist before the migration
- **WHEN** the backfill migration runs and `SET NOT NULL` is applied
- **THEN** the count of rows with NULL `accountId` is **0**, every row satisfies `accountId == <parent>.accountId`, and the pre-migration row count is preserved

---

### Requirement: No caller regression from the guard flip

Every existing reader and writer of an enrolled model SHALL execute under a bound
`TenantContext` (or an explicit `withSystemContext()` wrap). Flipping the guard SHALL NOT
produce `TenantContextMissingError` on any runtime path — routes, use cases, queries,
workers, seeds, sagas, or scripts.

#### Scenario: all routes keep working for their own tenant [integration]

- **GIVEN** tenant A is authenticated and owns the enrolled model's resources
- **WHEN** A exercises the model's own CRUD/action routes on its OWN resources
- **THEN** each succeeds as before the change, with no `TenantContextMissingError`

#### Scenario: no out-of-context caller exists [static]

- **GIVEN** the change is applied
- **WHEN** every reference to the model is enumerated (api, workers, seeds, scripts, sagas)
- **THEN** each call site runs behind `enterTenantContext` or an explicit `withSystemContext()` wrap
