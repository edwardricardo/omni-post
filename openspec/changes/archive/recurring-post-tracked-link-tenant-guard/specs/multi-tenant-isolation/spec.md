# Delta for multi-tenant-isolation

> Slice 3 of the `project-scoped-tenant-guard` rollout. Enrolls the two
> `projectId`-only models `RecurringPost` and `TrackedLink` into the two-layer
> structural tenant guard, EXTENDING the living `multi-tenant-isolation`
> capability (Slices 1–2).
>
> Two model-agnostic invariants are REUSED as-is and NOT restated: **Backfill
> integrity — zero NULL accountId** (Req 4) applies verbatim to both new models.
> Unlike Slices 1–2 (zero-wrap), Slice 3 establishes the rollout's FIRST
> `withSystemContext()` wraps, so **No caller regression from the guard flip**
> (Req 5) is MODIFIED with a concretizing scenario. This delta (a) appends both
> models to the Req 1 Enrolled-models and Req 3 Applied-so-far tables, (b) adds
> three model-/capability-scoped IDOR-closure requirements, and (c) concretizes
> Req 5. RFC 2119 keywords are normative; **[MERGE-BLOCKING]** requirements MUST
> be proven green by a two-tenant real-DB integration run before merge.

## ADDED Requirements

### Requirement: RecurringPost — the live IDOR routes are closed, and the template-clone content-exfil vector is closed [MERGE-BLOCKING]

An authenticated tenant A SHALL NOT read, list, repoint, or deactivate tenant B's
`RecurringPost`. Each of B's id-only routes (get / patch / deactivate) SHALL resolve to
NOT_FOUND for A, and a list carrying a FOREIGN `projectId` SHALL return an EMPTY result
(guard-natural). Critically, the **template-clone content-exfil escalation SHALL be closed**:
A SHALL NOT create or repoint a recurrence that references a FOREIGN `templatePostId` or
foreign `channels[]`, because the scheduler's system-context sweep would otherwise clone B's
post CONTENT into A's account and publish to B's channels — the create/repoint ownership
check makes each resolve to NOT_FOUND before persist.

#### Scenario: A cannot read B's recurring post by id [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's `RecurringPost`
- **WHEN** A calls the get-by-id route with B's id
- **THEN** the request resolves to NOT_FOUND and none of B's recurrence data appears in the payload

#### Scenario: A cannot patch or deactivate B's recurring post [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's recurring post
- **WHEN** A calls the patch (incl. `channels[]` repoint) or delete/deactivate route against B's id
- **THEN** each resolves to NOT_FOUND and B's recurrence is unchanged in the database

#### Scenario: listing with a foreign projectId returns empty [integration]

- **GIVEN** tenant A is authenticated and B owns recurring posts under B's project
- **WHEN** A calls the list route with `projectId={B's projectId}`
- **THEN** the response contains ZERO of B's recurring posts, with no per-route ownership check

#### Scenario: A cannot seed a recurrence from B's template post — content-exfil closed [integration]

- **GIVEN** tenant A is authenticated and `templatePostId`/`channels[]` belong to tenant B
- **WHEN** A calls create (or patch-repoint) referencing B's template or channels
- **THEN** the request resolves to **404 NOT_FOUND** before persist, NO recurrence is created, and the scheduler NEVER clones B's post content into A's account

### Requirement: TrackedLink — the live IDOR routes are closed, including the child-table stats traversal [MERGE-BLOCKING]

An authenticated tenant A SHALL NOT read, delete, generate UTM variants for, or read stats
of tenant B's `TrackedLink`. Each of B's id-only routes (get / delete / utm-generate /
utm-url) SHALL resolve to NOT_FOUND for A. Critically, the **stats route traverses the
`linkClick` CHILD table** (`getClickStats` → `linkClick.findMany`, absent from
`TENANT_SCOPED_MODELS`), so enrollment closes it ONLY via the upstream guarded
`findById(linkId)`; the suite MUST pin that a foreign stats request resolves to NOT_FOUND
BEFORE any child-table read, so none of B's click analytics is aggregated or returned.

#### Scenario: A cannot read B's tracked link by id [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's `TrackedLink`
- **WHEN** A calls the get-by-id route with B's id
- **THEN** the request resolves to NOT_FOUND and none of B's link data appears in the payload

#### Scenario: A cannot delete B's tracked link — child click rows survive [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's link (with `linkClick` rows)
- **WHEN** A calls the delete route against B's id
- **THEN** the request resolves to NOT_FOUND, and B's link and its `linkClick` rows survive untouched

#### Scenario: A cannot generate or read UTM variants for B's link [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's link
- **WHEN** A calls the utm-generate or utm-url route against B's id
- **THEN** each resolves to NOT_FOUND and B's link is unchanged

#### Scenario: A cannot read B's link stats via the child-table traversal [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's link
- **WHEN** A calls the stats route (which traverses `linkClick.findMany`) against B's id
- **THEN** the request resolves to NOT_FOUND before any child-table read or aggregation occurs, and none of B's click analytics appears in the payload

### Requirement: Public link redirect is a capability-URL exemption with mandatory compensating controls [MERGE-BLOCKING]

The public redirect `GET /r/:shortCode` SHALL resolve GLOBALLY via
`withSystemContext("public-link-redirect")` — the `shortCode` is a capability token (W3C TAG
Capability URLs) and public resources are exempt from deny-by-default (OWASP). **This
capability-URL exemption is a FINAL, signed product/security decision (engram obs 297,
2026-07-14) — the slice is NOT gated on further approval.** This exemption is admissible ONLY
with the following compensating controls, which are NORMATIVE:

1. the redirect SHALL leak NO tenant-identifying data — its only success output is a `302` to
   the destination URL (no accountId, no analytics, no tenant metadata in body or headers);
2. the `/r/:shortCode` namespace SHALL be rate-limited to resist enumeration;
3. the exemption SHALL be read-path only — the exemption SHALL NOT extend to any management
   surface.

#### Scenario: the redirect leaks nothing [integration]

- **GIVEN** tenant B owns a published short link
- **WHEN** an anonymous visitor calls `GET /r/:shortCode` for that link
- **THEN** the response is ONLY a `302` to the destination URL, with no accountId, analytics, or tenant-identifying data in the body or headers

#### Scenario: the redirect namespace is rate-limited [integration]

- **GIVEN** anonymous requests to `/r/:shortCode` exceed the configured threshold
- **WHEN** the limit is crossed
- **THEN** the rate limiter engages (e.g. HTTP 429) and further enumeration attempts are throttled

#### Scenario: the management surface stays tenant-scoped [integration]

- **GIVEN** tenant A is authenticated and B owns a `TrackedLink` and a `RecurringPost`
- **WHEN** A calls any TrackedLink management route (create / get / update / delete / stats) or any RecurringPost route against B's ids
- **THEN** each resolves to NOT_FOUND — the capability exemption applies to the redirect read path ONLY

## MODIFIED Requirements

### Requirement: Structural tenant isolation by construction [MERGE-BLOCKING]

(Previously: the Enrolled-models table listed `ExternalNotificationConfig` (S1), `ScheduledReport` + `Campaign` (S2). This delta appends `RecurringPost` and `TrackedLink` (Slice 3); the invariant text and scenarios are unchanged.)

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

(Previously: the Applied-so-far table listed S1 + S2 models. This delta appends `RecurringPost` and `TrackedLink` (Slice 3). `TrackedLink` create validates a client `projectId`; `RecurringPost` create/repoint validates THREE client-supplied refs — `projectId`, `templatePostId`, and each entry of `channels[]` — every one of which SHALL belong to the caller's account before persist.)

The guard injects `accountId` from the bound context but does NOT validate parent–child
consistency. Therefore every create (or repoint) path of an enrolled model that accepts a
client-supplied parent id SHALL verify that the parent belongs to the caller's account
BEFORE persisting, and SHALL reject with **NOT_FOUND (404)** otherwise — never 403
(anti-enumeration: a 403 confirms the resource exists) and never 500. Without this check a
tenant could persist a row carrying its OWN `accountId` and a FOREIGN parent id — an
inconsistent row and a latent exfiltration channel. Each slice concretizes this requirement
for its own model's create path; the invariant is stated once here.

**Applied so far (extended by each slice):**

| Model                        | Slice | Create path                                                                                            |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `ExternalNotificationConfig` | 1     | `POST /external-notifications` → `ConfigureExternalNotificationUseCase`                                |
| `ScheduledReport`            | 2     | ScheduledReport create route → `CreateScheduledReportUseCase`                                          |
| `Campaign`                   | 2     | Campaign create route → `CreateCampaignUseCase`                                                        |
| `TrackedLink`                | 3     | `POST /links` → `CreateTrackedLinkUseCase` (`projectId`)                                               |
| `RecurringPost`              | 3     | `POST /recurring-posts` → `CreateRecurringPostUseCase` (`projectId` + `templatePostId` + `channels[]`) |

#### Scenario: create against a foreign parent is rejected [integration]

- **GIVEN** tenant A is authenticated and the supplied `projectId` belongs to tenant B
- **WHEN** A calls the model's create endpoint with B's `projectId`
- **THEN** the response is **404 NOT_FOUND** (never 403, never 500), and NO row is persisted

#### Scenario: create against multiple parent refs rejects any foreign ref [integration]

- **GIVEN** tenant A is authenticated and any of `projectId`, `templatePostId`, or a `channels[]` entry belongs to tenant B
- **WHEN** A calls the `RecurringPost` create (or patch-repoint) endpoint
- **THEN** the response is **404 NOT_FOUND** (never 403, never 500), and NO recurrence is persisted

#### Scenario: create against an own parent succeeds and is consistent [integration]

- **GIVEN** tenant A is authenticated and every supplied parent ref belongs to A
- **WHEN** A calls the model's create endpoint
- **THEN** the row is created and `accountId == <parent>.accountId` holds on the persisted row

### Requirement: No caller regression from the guard flip

(Previously: Slices 1–2 were zero-wrap and this requirement carried only the "no out-of-context caller exists [static]" scenario. Slice 3 establishes the rollout's FIRST `withSystemContext()` wraps; this delta adds a concretizing integration scenario for the three wraps. The invariant text is unchanged.)

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

#### Scenario: the three out-of-context callers declare their context explicitly [integration]

- **GIVEN** the guard is flipped for both models
- **WHEN** the recurrence-scheduler tick runs, an anonymous visitor hits `GET /r/:shortCode`, and the create path runs its short-code uniqueness probe
- **THEN** each executes inside an explicit `withSystemContext("recurrence-sweep")`, `withSystemContext("public-link-redirect")`, and a `withSystemContext(...)` short-code probe respectively, and none raises `TenantContextMissingError`
