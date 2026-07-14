# Delta for multi-tenant-isolation

> Slice 2 of the `project-scoped-tenant-guard` rollout. Enrolls the two
> `projectId`-only, HIGH-importance models `ScheduledReport` and `Campaign` into
> the two-layer structural tenant guard, EXTENDING the living
> `multi-tenant-isolation` capability established by Slice 1.
>
> The model-agnostic invariants already in the living spec are REUSED as-is and
> NOT restated: **Backfill integrity — zero NULL accountId** (Req 4) and **No
> caller regression from the guard flip** (Req 5) apply verbatim to both new
> models (both are zero-wrap; every reader/writer runs behind `enterTenantContext`).
> This delta only (a) appends both models to the Req 1 Enrolled-models table and
> the Req 3 Applied-so-far table, and (b) adds two model-scoped IDOR-closure
> requirements. RFC 2119 keywords are normative; **[MERGE-BLOCKING]** requirements
> MUST be proven green by a two-tenant real-DB integration run before merge.

## ADDED Requirements

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

### Requirement: Campaign — the live IDOR routes are closed [MERGE-BLOCKING]

An authenticated tenant A SHALL NOT read, patch, archive, tag, or untag tenant B's
`Campaign`. Each of B's id-only routes SHALL resolve to NOT_FOUND for A, and a list request
carrying a FOREIGN `projectId` SHALL return an EMPTY result — the guard scopes the list to
A's account, so B's campaigns never appear regardless of the client-supplied `projectId`
(guard-natural, no explicit ownership check required on the list path).

#### Scenario: A cannot read B's campaign by id [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's `Campaign`
- **WHEN** A calls the get-by-id route with B's campaign id
- **THEN** the request resolves to NOT_FOUND and none of B's campaign data appears in the payload

#### Scenario: A cannot patch or archive B's campaign [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's campaign
- **WHEN** A calls the patch or archive route against B's campaign id
- **THEN** each resolves to NOT_FOUND and B's campaign is unchanged in the database

#### Scenario: A cannot tag or untag B's campaign [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's campaign
- **WHEN** A calls the tag or untag route against B's campaign id
- **THEN** each resolves to NOT_FOUND and B's tag set is unchanged

#### Scenario: listing with a foreign projectId returns empty [integration]

- **GIVEN** tenant A is authenticated and B owns campaigns under B's project
- **WHEN** A calls the list route with `projectId={B's projectId}`
- **THEN** the response contains ZERO of B's campaigns (empty result), with no per-route ownership check

## MODIFIED Requirements

### Requirement: Structural tenant isolation by construction [MERGE-BLOCKING]

(Previously: the Enrolled-models table listed only `ExternalNotificationConfig` (Slice 1). This delta appends `ScheduledReport` and `Campaign` (Slice 2); the invariant text and scenarios are unchanged.)

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

### Requirement: Create paths validate parent ownership per enrolled model [MERGE-BLOCKING]

(Previously: the Applied-so-far table listed only `ExternalNotificationConfig` (Slice 1). This delta appends `ScheduledReport` and `Campaign` (Slice 2); the invariant explicitly covers `CreateScheduledReportUseCase` and `CreateCampaignUseCase`, both of which today accept a client `projectId` and validate only its UUID shape, never its ownership.)

The guard injects `accountId` from the bound context but does NOT validate parent–child
consistency. Therefore every create (or repoint) path of an enrolled model that accepts a
client-supplied parent id SHALL verify that the parent belongs to the caller's account
BEFORE persisting, and SHALL reject with **NOT_FOUND (404)** otherwise — never 403
(anti-enumeration: a 403 confirms the resource exists) and never 500. Without this check a
tenant could persist a row carrying its OWN `accountId` and a FOREIGN parent id — an
inconsistent row and a latent exfiltration channel. Each slice concretizes this requirement
for its own model's create path; the invariant is stated once here.

**Applied so far (extended by each slice):**

| Model                        | Slice | Create path                                                             |
| ---------------------------- | ----- | ----------------------------------------------------------------------- |
| `ExternalNotificationConfig` | 1     | `POST /external-notifications` → `ConfigureExternalNotificationUseCase` |
| `ScheduledReport`            | 2     | ScheduledReport create route → `CreateScheduledReportUseCase`           |
| `Campaign`                   | 2     | Campaign create route → `CreateCampaignUseCase`                         |

#### Scenario: create against a foreign parent is rejected [integration]

- **GIVEN** tenant A is authenticated and the supplied `projectId` belongs to tenant B
- **WHEN** A calls the model's create endpoint with B's `projectId`
- **THEN** the response is **404 NOT_FOUND** (never 403, never 500), and NO row is persisted

#### Scenario: create against an own parent succeeds and is consistent [integration]

- **GIVEN** tenant A is authenticated and the supplied `projectId` belongs to A
- **WHEN** A calls the model's create endpoint
- **THEN** the row is created and `accountId == <project>.accountId` holds on the persisted row
