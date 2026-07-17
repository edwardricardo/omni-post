# Delta for multi-tenant-isolation

> Slice 4 of the `project-scoped-tenant-guard` rollout. Enrolls the `projectId`-only
> model `GeneratedImage` (guard **55 → 56**) into the two-layer structural tenant
> guard, EXTENDING the living `multi-tenant-isolation` capability (Slices 1–3).
>
> Two model-agnostic invariants are REUSED as-is and NOT restated: **Backfill
> integrity — zero NULL accountId** (Req 4) applies verbatim; and — because this
> slice's out-of-context caller inventory is EMPTY (generate is synchronous and
> in-request, NO `withSystemContext()` wraps) — **No caller regression from the guard
> flip** (Req 5) also applies verbatim and is NOT modified (unlike Slice 3).
> `GeneratedImage` has NO child or join tables, so the obs-285 join/child-table gap
> class is structurally ABSENT — the FIRST slice where it does not apply. This delta
> (a) appends `GeneratedImage` to the Req 1 Enrolled-models and Req 3 Applied-so-far
> tables, (b) adds a `GeneratedImage`-scoped IDOR-closure requirement (list is
> guard-natural; generate burns NO paid AI call for a foreign project), and (c) adds a
> server-derived usage-billing requirement (SIGNED decision, engram obs 306). RFC 2119
> keywords are normative; **[MERGE-BLOCKING]** requirements MUST be proven green by a
> two-tenant real-DB integration run before merge.

## ADDED Requirements

### Requirement: GeneratedImage — the live IDOR routes are closed, no prompt or image content exfiltrates, and no paid AI call is burned for a foreign project [MERGE-BLOCKING]

An authenticated tenant A SHALL NOT list or generate into tenant B's `GeneratedImage`
rows. A list request carrying a FOREIGN `projectId` SHALL return an EMPTY result — the
guard scopes the list to A's account, so B's prompt text, revised prompts, and image
URLs never appear regardless of the client-supplied `projectId` (guard-natural, no
per-route ownership check required on the list path). Critically, the **paid-AI-spend
escalation SHALL be closed**: A SHALL NOT generate an image into a FOREIGN project — the
create path's guarded parent-ownership check SHALL resolve to **NOT_FOUND (404)** (never
403, never 500) BEFORE the paid AI-provider call, so no AI call is burned and no row is
planted in B's project. `GeneratedImage` has NO child or join tables, so no join/child
traversal scenario applies (the obs-285 gap class is structurally absent for this model).

#### Scenario: A cannot list B's generated images via a foreign projectId [integration]

- **GIVEN** tenant A is authenticated and tenant B owns generated images under B's project
- **WHEN** A calls `GET /ai/generated-images?projectId={B's projectId}`
- **THEN** the response is HTTP 200 with ZERO of B's images (empty result), and no prompt text, revised prompt, or image URL of B appears in the payload

#### Scenario: A cannot generate an image into B's project — no burned AI call [integration]

- **GIVEN** tenant A is authenticated and the supplied `projectId` belongs to tenant B
- **WHEN** A calls `POST /ai/generate-image` with B's `projectId`
- **THEN** the request resolves to **404 NOT_FOUND** (never 403, never 500), the paid AI-provider call is NEVER invoked, and NO `GeneratedImage` row is persisted in B's project

### Requirement: GeneratedImage usage billing is attributed by server-derived accountId [MERGE-BLOCKING]

The `aiCallsMade` usage increment on the generate path SHALL be attributed to the
`accountId` derived from the authenticated `TenantContext`, NOT to any client-supplied
`accountId` in the request body. A client-supplied `accountId` SHALL be IGNORED.
Consequently a request SHALL NOT increment ANY other tenant's usage counter — if a
counter is incremented, it is the caller's OWN account's counter. (SIGNED decision,
engram obs 306; resolves the proposal's Open Question 1 in favor of server-derived
attribution.)

#### Scenario: a foreign accountId in the body does not increment another tenant's counter [integration]

- **GIVEN** tenant A is authenticated and the generate body carries a FOREIGN `accountId` (tenant B's)
- **WHEN** A calls `POST /ai/generate-image`
- **THEN** tenant B's `aiCallsMade` counter is UNCHANGED, and any increment applies ONLY to A's own account

#### Scenario: the usage increment is attributed to the caller's own tenant [integration]

- **GIVEN** tenant A is authenticated on its own project and the AI call succeeds
- **WHEN** A calls `POST /ai/generate-image` (with or without a body `accountId`)
- **THEN** the `aiCallsMade` increment is attributed to A's context-derived account, and the body-supplied value has no effect

## MODIFIED Requirements

### Requirement: Structural tenant isolation by construction [MERGE-BLOCKING]

(Previously: the Enrolled-models table listed `ExternalNotificationConfig` (S1), `ScheduledReport` + `Campaign` (S2), `RecurringPost` + `TrackedLink` (S3). This delta appends `GeneratedImage` (Slice 4), taking `TENANT_SCOPED_MODELS` from 55 to 56 models; the invariant text and scenarios are unchanged.)

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

(Previously: the Applied-so-far table listed S1–S3 models. This delta appends `GeneratedImage` (Slice 4). `GeneratedImage` create validates a client `projectId`; uniquely, its ownership check SHALL run BEFORE the paid AI-provider call — a foreign `projectId` therefore resolves to 404 with NO AI spend and NO persist. The invariant text and scenarios are unchanged.)

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

| Model                        | Slice | Create path                                                                                            |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `ExternalNotificationConfig` | 1     | `POST /external-notifications` → `ConfigureExternalNotificationUseCase`                                |
| `ScheduledReport`            | 2     | `POST /reports` → `CreateScheduledReportUseCase`                                                       |
| `Campaign`                   | 2     | `POST /campaigns` → `CreateCampaignUseCase`                                                            |
| `TrackedLink`                | 3     | `POST /links` → `CreateTrackedLinkUseCase` (`projectId`)                                               |
| `RecurringPost`              | 3     | `POST /recurring-posts` → `CreateRecurringPostUseCase` (`projectId` + `templatePostId` + `channels[]`) |
| `GeneratedImage`             | 4     | `POST /ai/generate-image` → `GenerateImageUseCase` (`projectId`; check runs BEFORE the paid AI call)   |

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
