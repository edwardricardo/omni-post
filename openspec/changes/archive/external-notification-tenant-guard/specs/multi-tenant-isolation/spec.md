# Multi-Tenant Isolation — Delta Spec

> Delta spec for change `external-notification-tenant-guard` (Slice 1 of the
> `project-scoped-tenant-guard` rollout). NEW capability: **multi-tenant-isolation** —
> STRUCTURAL enrollment of `projectId`-only models into the two-layer tenant guard
> (`accountId` denormalization + Prisma `$extends` guard + PostgreSQL RLS).
> Source of truth: `proposal.md`, `docs/security/MULTI_TENANT_GUARDS.md`.
>
> Scope note: this capability covers isolation **by construction at the data layer**.
> It is distinct from the per-model APP-LEVEL ownership specs already archived
> (`trackedlink-tenant-isolation`, `post-tenant-isolation`), which gate at the
> route/use-case layer.
>
> **Extension contract for Slices 2–8:** Requirements 1, 3, 4 and 5 are
> **model-agnostic invariants** — later slices extend the _Enrolled models_ table and
> add their own model-specific IDOR-closure requirement (the Requirement-2 shape),
> without restating the invariants.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** MUST be proven green before merge. Scenarios marked **[static]**
> are checkable by inspecting schema/migrations/config; **[integration]** scenarios
> require a real-DB, two-tenant run through HTTP — a mocked unit test CANNOT prove a
> guard that operates at the Prisma layer.

---

## ADDED Requirements

### Requirement: Structural tenant isolation by construction [MERGE-BLOCKING]

Every enrolled model SHALL be isolated at the DATA layer, not by per-route ownership
checks. For each enrolled model the system SHALL satisfy all three legs:

1. the table carries a **non-null `accountId`** column with an `Account` relation
   (`onDelete: Cascade`) and an index on `accountId`;
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

#### Scenario: the three legs are present for the enrolled model [static]

- **GIVEN** the change is applied
- **WHEN** `schema.prisma`, `infra/prisma/src/extensions/tenantGuard.ts`, and the RLS migration are inspected
- **THEN** `ExternalNotificationConfig.accountId` is non-null with an `Account` relation + index, `externalNotificationConfig` appears in `TENANT_SCOPED_MODELS`, and an RLS policy covers the table

#### Scenario: reads through the guarded client are auto-scoped [integration]

- **GIVEN** tenant A's context is bound and configs exist for both A and B
- **WHEN** any find/update/delete query runs through the guarded Prisma client
- **THEN** only A's rows are visible/affected, with no `accountId` filter written by the caller

#### Scenario: a query with no bound tenant context is refused [integration]

- **GIVEN** no `TenantContext` is bound (and no `withSystemContext()` wrap)
- **WHEN** a query on the enrolled model runs through the guarded client
- **THEN** it fails with `TenantContextMissingError` — it SHALL NOT silently return unscoped rows

---

### Requirement: The three live IDOR routes are closed, and no decrypted secret crosses the boundary [MERGE-BLOCKING]

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

### Requirement: Create paths validate parent (project) ownership [MERGE-BLOCKING]

The guard injects `accountId` from the bound context but does NOT validate parent–child
consistency. Therefore every create path that accepts a client-supplied parent id SHALL
verify that the parent belongs to the caller's account BEFORE persisting. For this slice:
`POST /external-notifications` → `ConfigureExternalNotificationUseCase` SHALL verify the
supplied `projectId` resolves under the caller's account, and SHALL reject with **NOT_FOUND
(404)** otherwise. It SHALL NOT return 403 (anti-enumeration: a 403 confirms the resource
exists). Without this check a tenant could persist a row carrying its OWN `accountId` and a
FOREIGN `projectId` — an inconsistent row and a latent exfiltration channel.

#### Scenario: create against a foreign project is rejected [integration]

- **GIVEN** tenant A is authenticated and `projectId` belongs to tenant B
- **WHEN** A calls `POST /external-notifications` with B's `projectId`
- **THEN** the response is **404 NOT_FOUND** (never 403), and NO row is persisted

#### Scenario: create against an own project succeeds and is consistent [integration]

- **GIVEN** tenant A is authenticated and `projectId` belongs to A
- **WHEN** A calls `POST /external-notifications`
- **THEN** the config is created and the persisted row satisfies `accountId == Project.accountId`

---

### Requirement: Backfill integrity — zero NULL accountId

Every pre-existing row SHALL receive its `accountId` from `Project.accountId` traversed over
the NOT NULL `projectId` FK, BEFORE the `SET NOT NULL` flip. Zero rows SHALL remain NULL, and
zero rows SHALL be dropped or orphaned by the migration.

#### Scenario: no row survives the migration with a NULL or inconsistent accountId [integration]

- **GIVEN** rows exist before the migration
- **WHEN** the backfill migration runs and `SET NOT NULL` is applied
- **THEN** the count of rows with NULL `accountId` is **0**, every row satisfies `accountId == Project.accountId`, and the pre-migration row count is preserved

---

### Requirement: No caller regression from the guard flip

Every existing reader and writer of `ExternalNotificationConfig` SHALL execute under a bound
`TenantContext` (or an explicit `withSystemContext()` wrap). Flipping the guard SHALL NOT
produce `TenantContextMissingError` on any runtime path — routes, use cases, queries,
workers, seeds, sagas, or scripts.

#### Scenario: all four routes keep working for their own tenant [integration]

- **GIVEN** tenant A is authenticated and owns a project and a config
- **WHEN** A exercises create, list, delete, and test-fire on its OWN resources
- **THEN** each succeeds as before the change, with no `TenantContextMissingError`

#### Scenario: no out-of-context caller exists [static]

- **GIVEN** the change is applied
- **WHEN** every reference to the model is enumerated (api, workers, seeds, scripts, sagas)
- **THEN** each call site runs behind `enterTenantContext` or an explicit `withSystemContext()` wrap
