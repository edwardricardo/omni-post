# Multi-Tenant Isolation — Living Spec

> Cumulative living specification for the **multi-tenant-isolation** capability:
> STRUCTURAL enrollment of `projectId`-only models into the two-layer tenant guard
> (`accountId` denormalization + Prisma `$extends` guard + PostgreSQL RLS).
> Established by change `external-notification-tenant-guard` (Slice 1 of the
> `project-scoped-tenant-guard` rollout), archived 2026-07-14, PR #113
> (branch `workstream/cluster-c-extnotif-guard`).
> Source of truth: `docs/security/MULTI_TENANT_GUARDS.md`.
>
> **Extended by Slice 2** — change `scheduled-report-campaign-tenant-guard`, archived
> 2026-07-14, PR #114 (branch `workstream/cluster-c-schedreport-campaign-guard`).
> Enrolled `ScheduledReport` and `Campaign`; added their Requirement-2-shaped
> IDOR-closure blocks below. Slice 2 also generalized a SECOND systematic gap class
> beyond the create-path check (Requirement 3): guard enrollment closes routes that
> QUERY the enrolled model directly, but does NOT close a route that mutates or reads
> a RELATED / JOIN / CHILD table (e.g. `campaignPost`) without first resolving the
> parent through a guarded `findById`. Every future slice's MERGE-BLOCKING integration
> suite MUST (a) audit both WRITE and READ routes for join/child-table traversal or a
> bypassed parent lookup, (b) exercise ALL of the model's routes, not a subset, and
> (c) copy the reference per-row `accountId == <parent>.accountId` consistency
> invariant plus a positive control for every exfiltration sentinel — not just a
> NULL check.
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

### Requirement: ScheduledReport — the live IDOR routes are closed, and no analytics exfiltrates across the tenant boundary [MERGE-BLOCKING]

An authenticated tenant A SHALL NOT read, update, delete, or generate tenant B's
`ScheduledReport`. Each of B's id-only routes (get / update / delete / generate) SHALL
resolve to NOT_FOUND for A. Critically, the **analytics-exfiltration escalation SHALL be
closed**: A SHALL NOT be able to rewrite `recipients` on B's report and then trigger
generation to have B's analytics emailed to an A-controlled address — because the guard
makes B's report unresolvable for A, BOTH the update and the generate resolve to NOT_FOUND
before any analytics is computed or any email is sent.

#### Scenario: A cannot read B's report by id [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's `ScheduledReport`
- **WHEN** A calls the get-by-id route with B's report id
- **THEN** the request resolves to NOT_FOUND and none of B's report data appears in the payload

#### Scenario: A cannot repoint recipients on B's report [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's report
- **WHEN** A calls the update route to rewrite `recipients` to an A-controlled address
- **THEN** the request resolves to NOT_FOUND and B's stored `recipients` are unchanged

#### Scenario: A cannot generate B's report — the exfil vector is closed [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's report
- **WHEN** A calls the generate route against B's report id
- **THEN** the request resolves to NOT_FOUND, NO analytics is computed for B, and NO email carrying B's analytics is sent

#### Scenario: A cannot delete B's report by id [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's report
- **WHEN** A calls the delete route with B's report id
- **THEN** the request resolves to NOT_FOUND and B's report still exists in the database

---

### Requirement: Campaign — the live IDOR routes are closed [MERGE-BLOCKING]

An authenticated tenant A SHALL NOT read, patch, archive, tag, or untag tenant B's
`Campaign`. Each of B's id-only routes SHALL resolve to NOT_FOUND for A, and a list request
carrying a FOREIGN `projectId` SHALL return an EMPTY result — the guard scopes the list to
A's account, so B's campaigns never appear regardless of the client-supplied `projectId`
(guard-natural, no explicit ownership check required on the list path). The untag route is a
join-table mutation (`campaignPost`, absent from `TENANT_SCOPED_MODELS`) that bypasses the
guarded `Campaign` lookup entirely unless the use case resolves the parent `Campaign` first —
enrollment alone does NOT close it; an explicit guarded `findById(campaignId)` before the
join-row mutation is REQUIRED (see `docs/security/MULTI_TENANT_GUARDS.md` for the generalized
join/child-table gap class).

#### Scenario: A cannot read B's campaign by id [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's `Campaign`
- **WHEN** A calls the get-by-id route with B's campaign id
- **THEN** the request resolves to NOT_FOUND and none of B's campaign data appears in the payload

#### Scenario: A cannot patch or archive B's campaign [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's campaign
- **WHEN** A calls the patch or archive route against B's campaign id
- **THEN** each resolves to NOT_FOUND and B's campaign is unchanged in the database

#### Scenario: A cannot tag or untag B's campaign — including the join-row mutation [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's campaign
- **WHEN** A calls the tag or untag route against B's campaign id
- **THEN** each resolves to NOT_FOUND, B's tag set is unchanged, and B's underlying `campaignPost` join row survives untouched

#### Scenario: A cannot read B's campaign analytics via the join-table traversal [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's campaign
- **WHEN** A calls the analytics route (which traverses the `campaignPost` join table via `findPostIdsByCampaignId`) against B's campaign id
- **THEN** the request resolves to NOT_FOUND before any join-table read or aggregation occurs, and none of B's analytics data appears in the payload

#### Scenario: listing with a foreign projectId returns empty [integration]

- **GIVEN** tenant A is authenticated and B owns campaigns under B's project
- **WHEN** A calls the list route with `projectId={B's projectId}`
- **THEN** the response contains ZERO of B's campaigns (empty result), with no per-route ownership check

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
