# Delta for multi-tenant-isolation

> Slice 5 of the `project-scoped-tenant-guard` rollout. Enrolls the `projectId`-only
> model `ProjectMember` (guard **56 → 57**) into the two-layer structural tenant guard,
> EXTENDING the living `multi-tenant-isolation` capability (Slices 1–4).
>
> `ProjectMember` is a SIGNED forgotten-feature (engram obs 321/322): a designed but
> UNWIRED per-project membership layer — zero HTTP routes, ONE DEAD reader
> (`findByProjectId`, zero production callers), seed-only writer. It is enrolled
> DEFENSIVELY now so it is born tenant-safe when the feature is wired (backlog SMELL-59);
> this slice does NOT delete the model and does NOT build the feature.
>
> Two slice-specific deltas: (1) `ProjectMember` is the FIRST enrolled model with TWO
> `accountId`-bearing parents (`Project` via `projectId`, `CustomerUser` via `memberId`),
> so the backfill derives `accountId` from `Project.accountId` AND asserts equality with
> `CustomerUser.accountId` — any mismatch is corrupt cross-tenant membership and HALTS the
> migration (RAISE), EXTENDING Requirement 4; (2) because the HTTP surface is EMPTY, the
> living spec's all-routes HTTP proof rule is VACUOUSLY satisfied — the MERGE-BLOCKING
> isolation proof runs at the repository/guarded-client layer instead, and the added
> `ProjectMember` block pins "no HTTP surface" so any FUTURE route triggers a spec update.
>
> **No caller regression** (Req 5) is REUSED as-is and NOT modified: the only writer is the
> dev seed (`seed.ts:1109`), fixed IN-SCOPE to pass an explicit `accountId`; no
> worker/saga/scheduler touches the model, so NO `withSystemContext()` wrap is introduced.
> RFC 2119 keywords are normative; **[MERGE-BLOCKING]** requirements MUST be proven green by
> a two-tenant real-DB integration run at the guarded-client layer before merge.

## ADDED Requirements

### Requirement: ProjectMember — a forgotten feature enrolled defensively; cross-tenant membership is unresolvable at the guarded-client layer, and double-parent accountId consistency holds [MERGE-BLOCKING]

`ProjectMember` has NO live HTTP route today (the single reader `findByProjectId` is DEAD —
zero production callers). Enrollment therefore closes cross-tenant access AT THE DATA LAYER,
proven at the repository/guarded-client layer rather than over HTTP. An authenticated tenant
A SHALL NOT resolve tenant B's `ProjectMember` rows: a guarded-client read scoped to A that
supplies a FOREIGN `projectId` SHALL return ZERO of B's member rows, and a read issued with
NO bound `TenantContext` SHALL fail with `TenantContextMissingError` — it SHALL NOT silently
return unscoped rows. Because `ProjectMember` has TWO `accountId`-bearing parents, a guarded
create SHALL inject `accountId` from the bound context such that `accountId == Project.accountId
== CustomerUser.accountId` holds on every persisted row.

**Deferred obligation (no HTTP surface today):** there is NO production create path. When
SMELL-59 wires a route or use case that WRITES `ProjectMember`, that write path SHALL add a
create-path parent-ownership assertion validating that BOTH `projectId` (→ `Project`) and
`memberId` (→ `CustomerUser`) belong to the caller's account BEFORE persist (per the
living-spec "Create paths validate parent ownership" invariant), and this spec SHALL be
updated to enumerate that route. This is a documented deferred obligation, NOT implemented in
this slice.

#### Scenario: A cannot list B's project members via a foreign projectId [integration]

- **GIVEN** tenant A's context is bound and tenant B owns `ProjectMember` rows under B's project
- **WHEN** A's guarded client calls `findByProjectId(B's projectId)`
- **THEN** the result contains ZERO of B's member rows, with no `accountId` filter written by the caller

#### Scenario: a read with no bound tenant context is refused [integration]

- **GIVEN** no `TenantContext` is bound (and no `withSystemContext()` wrap)
- **WHEN** a `ProjectMember` read runs through the guarded client
- **THEN** it fails with `TenantContextMissingError` and returns NO rows

#### Scenario: a guarded create is consistent across both parents [integration]

- **GIVEN** tenant A's context is bound and both `projectId` and `memberId` belong to A
- **WHEN** a `ProjectMember` row is created through the guarded client
- **THEN** the persisted row satisfies `accountId == Project.accountId == CustomerUser.accountId`

## MODIFIED Requirements

### Requirement: Structural tenant isolation by construction [MERGE-BLOCKING]

(Previously: the Enrolled-models table listed S1–S4 models (`ExternalNotificationConfig`, `ScheduledReport`, `Campaign`, `RecurringPost`, `TrackedLink`, `GeneratedImage`). This delta appends `ProjectMember` (Slice 5), taking `TENANT_SCOPED_MODELS` from 56 to 57 models and using a composite `@@index([accountId, projectId])` because the model's dominant guarded read is `projectId`-filtered; the invariant text and scenarios are unchanged.)

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
| `RecurringPost`              | 3     | Required  | Required               | Required   |
| `TrackedLink`                | 3     | Required  | Required               | Required   |
| `GeneratedImage`             | 4     | Required  | Required               | Required   |
| `ProjectMember`              | 5     | Required  | Required               | Required   |

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

(Previously: the Applied-so-far table listed S1–S4 models. This delta appends `ProjectMember` (Slice 5) as **N/A — no production create path**: the dev seed is the only writer and runs out of tenant context by design. The invariant text and scenarios are unchanged; the create-path assertion becomes MANDATORY, validating BOTH parents, when SMELL-59 wires writes.)

The guard injects `accountId` from the bound context but does NOT validate parent–child
consistency. Therefore every create (or repoint) path of an enrolled model that accepts a
client-supplied parent id SHALL verify that the parent belongs to the caller's account
BEFORE persisting, and SHALL reject with **NOT_FOUND (404)** otherwise — never 403
(anti-enumeration: a 403 confirms the resource exists) and never 500. Without this check a
tenant could persist a row carrying its OWN `accountId` and a FOREIGN parent id — an
inconsistent row and a latent exfiltration channel. Each slice concretizes this requirement
for its own model's create path; the invariant is stated once here. `TrackedLink` create
validates a client `projectId`; `RecurringPost` create/repoint validates THREE
client-supplied refs — `projectId`, `templatePostId`, and each entry of `channels[]` — every
one of which SHALL belong to the caller's account before persist.

**Applied so far (extended by each slice):**

| Model                        | Slice | Create path                                                                                                                                                                   |
| ---------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExternalNotificationConfig` | 1     | `POST /external-notifications` → `ConfigureExternalNotificationUseCase`                                                                                                       |
| `ScheduledReport`            | 2     | `POST /reports` → `CreateScheduledReportUseCase`                                                                                                                              |
| `Campaign`                   | 2     | `POST /campaigns` → `CreateCampaignUseCase`                                                                                                                                   |
| `TrackedLink`                | 3     | `POST /links` → `CreateTrackedLinkUseCase` (`projectId`)                                                                                                                      |
| `RecurringPost`              | 3     | `POST /recurring-posts` → `CreateRecurringPostUseCase` (`projectId` + `templatePostId` + `channels[]`)                                                                        |
| `GeneratedImage`             | 4     | `POST /ai/generate-image` → `GenerateImageUseCase` (`projectId`; check runs BEFORE the paid AI call)                                                                          |
| `ProjectMember`              | 5     | **N/A — no production create path** (seed-only writer); assertion validating `projectId`→`Project` AND `memberId`→`CustomerUser` becomes MANDATORY when SMELL-59 wires writes |

#### Scenario: create against a foreign parent is rejected [integration]

- **GIVEN** tenant A is authenticated and the supplied parent id (e.g. `projectId`) belongs to tenant B
- **WHEN** A calls the model's create endpoint with B's parent id
- **THEN** the response is **404 NOT_FOUND** (never 403, never 500), and NO row is persisted

#### Scenario: create against multiple parent refs rejects any foreign ref [integration]

- **GIVEN** tenant A is authenticated and any of `projectId`, `templatePostId`, or a `channels[]` entry belongs to tenant B
- **WHEN** A calls the `RecurringPost` create (or patch-repoint) endpoint
- **THEN** the response is **404 NOT_FOUND** (never 403, never 500), and NO recurrence is persisted

#### Scenario: create against an own parent succeeds and is consistent [integration]

- **GIVEN** tenant A is authenticated and the supplied parent id belongs to A
- **WHEN** A calls the model's create endpoint
- **THEN** the row is created and `accountId == <parent>.accountId` holds on the persisted row

### Requirement: Backfill integrity — zero NULL accountId

(Previously: the backfill derived `accountId` from a SINGLE guarded parent. `ProjectMember` (Slice 5) is the FIRST enrolled model with TWO `accountId`-bearing parents; this delta adds the double-parent equality assertion and its RAISE-and-halt scenario. The single-parent invariant text and existing scenario are unchanged.)

Every pre-existing row of an enrolled model SHALL receive its `accountId` from the guarded
parent's `accountId`, traversed over the parent's NOT NULL FK, BEFORE the `SET NOT NULL`
flip. Zero rows SHALL remain NULL, and zero rows SHALL be dropped or orphaned by the
migration. When an enrolled model has TWO `accountId`-bearing parents (e.g. `ProjectMember`
via `Project` and `CustomerUser`), the backfill SHALL derive `accountId` from one parent AND
assert it EQUALS the other parent's `accountId` for EVERY row; any mismatch is corrupt
cross-tenant membership and SHALL HALT the migration (RAISE) rather than silently pick a side.

#### Scenario: no row survives the migration with a NULL or inconsistent accountId [integration]

- **GIVEN** rows exist before the migration
- **WHEN** the backfill migration runs and `SET NOT NULL` is applied
- **THEN** the count of rows with NULL `accountId` is **0**, every row satisfies `accountId == <parent>.accountId`, and the pre-migration row count is preserved

#### Scenario: a double-parent mismatch halts the migration [deploy-time]

- **GIVEN** a pre-existing `ProjectMember` row whose `Project.accountId` differs from its `CustomerUser.accountId`
- **WHEN** the backfill migration runs
- **THEN** the migration HALTS with a RAISE (no partial backfill committed) and surfaces the corrupt row for remediation
