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
> **Extended by Slice 3** — change `recurring-post-tracked-link-tenant-guard`, archived
> 2026-07-14, PR #116 (branch `workstream/cluster-c-recurringpost-trackedlink-guard`).
> Enrolled `RecurringPost` and `TrackedLink`; added their Requirement-2-shaped
> IDOR-closure blocks below. Slice 3 also establishes the rollout's FIRST
> `withSystemContext()` wraps — for a recurrence-sweep scheduler tick, a public
> unauthenticated link redirect, and a short-code uniqueness probe — and adds a THIRD
> model-scoped requirement, "Public link redirect is a capability-URL exemption with
> mandatory compensating controls", capturing the rollout's first deliberate, signed
> guard bypass (W3C TAG Capability URLs + OWASP public-resource exemption, engram obs 297) together with its three normative compensating controls (leaks-nothing response,
> namespace-keyed rate limiting, read-path-only scope). `RecurringPost`'s create path
> additionally concretizes a NEW "create against multiple parent refs" scenario in
> Requirement 3 — the first model with THREE client-supplied parent refs (`projectId`,
> `templatePostId`, `channels[]`) that must each resolve to the caller's own account.
>
> **Extended by Slice 4** — change `generated-image-tenant-guard`, archived
> 2026-07-15, on branch `workstream/cluster-c-generatedimage-guard` (stacked
> under the pnpm-11 migration commit `fd3bc746`, PR #118). Enrolled
> `GeneratedImage`; added its Requirement-2-shaped IDOR-closure block below.
> `GeneratedImage` is the FIRST model in the rollout with a structurally
> EMPTY join/child-table gap class (no child or join tables exist) and the
> FIRST whose create-path ownership check gates a PAID external call — the
> guarded `projectRepository.findById` runs BEFORE the AI-provider call, so a
> foreign `projectId` burns zero AI spend and persists nothing. Slice 4 also
> adds a SECOND, capability-adjacent model-scoped requirement — "GeneratedImage
> usage billing is attributed by server-derived accountId" — closing a
> client-supplied-`accountId` billing-integrity smell (SIGNED decision, engram
> obs 306) discovered while enrolling the model: the `aiCallsMade` usage
> increment now derives its `accountId` from the authenticated `TenantContext`
> only, never from the request body.
>
> **Extended by Slice 5** — change `project-member-tenant-guard`, archived
> 2026-07-16, PR #119 (branch `workstream/cluster-c-projectmember-guard`).
> Enrolled `ProjectMember`; added its Requirement-2-shaped block below.
> `ProjectMember` is a SIGNED forgotten-feature (engram obs 321/322) — a
> designed but UNWIRED per-project membership layer with zero HTTP routes, one
> DEAD reader (`findByProjectId`), and a seed-only writer — enrolled
> DEFENSIVELY so it is born tenant-safe when wired. Slice 5 is the FIRST model
> in the rollout with TWO `accountId`-bearing parents (`Project` via
> `projectId`, `CustomerUser` via `memberId`), extending Requirement 4 with a
> double-parent equality assertion that HALTS the migration (RAISE) on
> mismatch. It is also the FIRST model with a structurally EMPTY HTTP surface,
> so the living spec's all-routes HTTP proof rule is VACUOUSLY satisfied and
> the MERGE-BLOCKING isolation proof runs at the repository/guarded-client
> layer instead. The create-path parent-ownership check (Requirement 3) is a
> DEFERRED obligation — there is no production create path today; it becomes
> MANDATORY, validating BOTH parents, when backlog SMELL-59 wires a write
> path. Outside the model-scoped requirement, Slice 5 also wired the
> rollout-wide `integration:tenant-isolation` run-tests.sh batch (the 6 prior
> slices' MERGE-BLOCKING suites had never run under `test:all`) and converted
> the RLS policy-count assertion in `rls-tenant-isolation.test.ts` from a
> literal to a count derived from `getTenantScopedModels().size`.
>
> **Extended by Slice 7** — change `channel-tenant-guard`, archived 2026-07-28,
> PR #152 (structural + API + the RLS pair) and PR #164 (worker reconciliation),
> branch `workstream/channel-tenant-guard`. Enrolled `Channel`, the credential-bearing,
> max-blast model (Tier 4): it carries FOUR AES-GCM credential columns
> (`credentialsCiphertext` / `Iv` / `AuthTag` / `KeyVersion`) decrypted by the
> credential-resolution path, so a cross-tenant read is a decrypted-OAuth-token
> exfil, not just a metadata leak. `Channel` now carries a non-null `accountId`
> (denormalized from `Project.accountId`) with a composite
> `@@index([accountId, projectId])`; Migration A backfills over the NOT-NULL
> `projectId` FK — soft-deleted rows included — with an in-transaction `RAISE`
> on residual NULL. It has TWO create paths (a Requirement-3 first): the OAuth
> callback and the Bluesky connect (plus `POST /channels`). All three legs are in
> place: `Channel` is in the Prisma `$extends` guard (layer 1), its
> `tenant_isolation` RLS policy shipped with Migration B
> (`20260723000100_add_rls_channel` + `down.sql`), and the API create paths thread
> the ownership-verified `accountId`. The worker credential/reconciliation paths
> carry explicit `accountId` predicates plus the account GUC bound in their own
> transaction. Leg 3/RLS is INERT deployment-wide today (the app AND worker role
> is superuser / BYPASSRLS, verified against the live DB), so layer 1 and the
> app-layer scoping are the ACTIVE enforcement. The MERGE-BLOCKING isolation
> proofs are `apps/api/tests/integration/channelTenantIsolation.test.ts` (API,
> two tenants) and `apps/api/tests/integration/publishWorkerTenantIsolation.test.ts`
> (worker publish regression).
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
> **Extended by the saga tenant-scope change** — change
> `saga-tenant-scope-and-recovery`. This one does NOT extend the enrollment table:
> `sagaInstance` was ALREADY in `TENANT_SCOPED_MODELS`. It closes a DATA-CORRECTNESS
> defect on an already-enrolled model — the engine persisted the acting
> `CustomerUser.id` into `SagaInstance.accountId`, so every saga row was keyed on a
> value that is not a tenant, and it did so silently because the bootstrap handed the
> engine the RAW Prisma singleton (layer 1 was never in its write path; there is NO
> `$transaction` bypass — an explicit mismatch throws in-transaction, verified
> empirically). Its requirement blocks are appended at the end of this spec, together
> with the recorded structural gap that stays OPEN.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** MUST be proven green before merge. Scenarios marked **[static]**
> are checkable by inspecting schema/migrations/config; **[integration]** scenarios
> require a real-DB, two-tenant run through HTTP — a mocked unit test CANNOT prove a
> guard that operates at the Prisma layer; **[deploy-time]** scenarios are enforced by a
> migration-time assertion (e.g. a `RAISE`) that halts the deploy on violation rather than
> by a CI test — checkable by inspecting the migration SQL, confirmed by the deploy halting
> on violation rather than by test execution.

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
| `RecurringPost`              | 3     | Required  | Required               | Required   |
| `TrackedLink`                | 3     | Required  | Required               | Required   |
| `GeneratedImage`             | 4     | Required  | Required               | Required   |
| `ProjectMember`              | 5     | Required  | Required               | Required   |
| `Channel`                    | 7     | Required  | Required               | Required   |

`Channel`'s dominant guarded reads are `projectId`-filtered, so its index is
`@@index([accountId, projectId])`. Its `TENANT_SCOPED_MODELS` membership took the guard
count from 57 to 58; its RLS policy (leg 3) is in place via Migration B
(`20260723000100_add_rls_channel`) and is INERT deployment-wide today under the superuser
role, so legs 1–2 plus the worker-path app-layer scoping are the ACTIVE enforcement.

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

---

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

---

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

---

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

---

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

---

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

---

### Requirement: Channel — the live IDOR routes are closed, and no decrypted provider credential crosses the tenant boundary [MERGE-BLOCKING]

An authenticated tenant A SHALL NOT read, list, connect, update, or delete tenant B's
`Channel`. Each of B's id-only JSON routes (get / update / delete) SHALL resolve to
**NOT_FOUND (404)** for A — never 403 (anti-enumeration) and never 500. The
provider-connect action resolves the same NOT_FOUND decision, surfaced per its transport:
the Bluesky connect (JSON route) returns a literal **404** via `assertCallerOwnsProject`,
while the OAuth callback — a browser-redirect flow whose catch converts every error into a
302 — surfaces the NOT_FOUND as the standard **error redirect (302)**, never a literal 404
status. In BOTH transports NO channel is persisted under B's project. A list carrying a
FOREIGN `projectId` SHALL resolve to NOT_FOUND at the route (Channel's list route runs an
explicit `assertCallerOwnsProject` gate — strictly stronger than the guard-natural empty
result, which the guarded repository still returns for a foreign `projectId`). Critically,
because `Channel` carries FOUR AES-GCM credential columns decrypted by the
credential-resolution path, NO decrypted provider OAuth token SHALL cross the tenant
boundary — not in a response body, not in an error message, not in a log, and not through
an outbound provider API call performed on B's behalf.

#### Scenario: A cannot read, update, or delete B's channel by id [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's `Channel`
- **WHEN** A calls the get / update / delete route with B's channel id
- **THEN** each resolves to NOT_FOUND, B's channel is unchanged in the database, and no channel data of B — including any decrypted credential — appears in the payload

#### Scenario: A cannot connect a provider into B's project [integration]

- **GIVEN** tenant A is authenticated and B's `projectId` is carried by the connect action (consumed OAuth state for the OAuth callback, request body for the Bluesky connect)
- **WHEN** A completes the connect action
- **THEN** the OAuth callback resolves to an ERROR REDIRECT (302, never a literal 404), the Bluesky connect resolves to a literal **404 NOT_FOUND** (never 403, never 500), and in BOTH cases NO channel is persisted under B's project

#### Scenario: no decrypted credential is ever materialized across the boundary [integration]

- **GIVEN** tenant B owns a channel with stored encrypted credentials
- **WHEN** tenant A exercises ANY Channel route referencing B's channel id
- **THEN** the response, error body, and logs contain NO decrypted credential of B, and no provider API call is made with B's token

---

### Requirement: Channel worker credential and reconciliation paths are tenant-safe under both DB-role postures, with the account GUC bound [MERGE-BLOCKING]

`apps/workers` is a separate executable running the RAW Prisma client — the `$extends`
guard is bound to the API client only — so the worker paths that reach `Channel` enforce
tenant scope explicitly. The three such paths — credential resolution (`CredentialResolver`
→ `getChannelsByIds` → decrypt), the auth-failure recorder (`ChannelAuthFailureRecorder`),
and the mention channel lookup (`mentionIngestWorker`) — SHALL resolve or mutate ONLY
channels belonging to the account the job is attributed to. A `channelId` that does not
belong to the job's account SHALL NOT have its credentials decrypted, its reauth flag
written, or its row returned. This safety SHALL hold under BOTH postures: (1) the current
BYPASSRLS role, where RLS is inert and the app-layer `WHERE accountId` predicate is the
sole guard, and (2) a future NOBYPASSRLS role. To satisfy (2) without silent publish
breakage, the worker SHALL bind the account GUC (`app.account_id`) in its OWN transaction
for the job's account (`setTenantGuc`), so RLS permits the job's own rows and denies
foreign rows once the role is corrected. **The publish flow SHALL remain green —
credential resolution keeps working for the job's own channel** (the MERGE-BLOCKING
regression). Binding `withSystemContext` on the raw client alone SHALL NOT be accepted as
satisfying this requirement, because the raw client has no `$extends` guard and RLS needs
the GUC bound in-tx.

The job's account SHALL reach the worker through the job payload. The single publish-job
producer (the saga schedule step) SHALL FAIL CLOSED — refusing to enqueue a job whose saga
metadata carries no account — rather than emitting an unscoped job. A bounded
deploy-compat fallback MAY resolve the owner for payloads enqueued before the field
existed, provided it selects the `accountId` column ONLY (never the credential envelope)
and is observable (`worker_publish_job_account_id_source_total{source}`) so it can be
removed on evidence rather than kept indefinitely.

#### Scenario: publish resolves credentials for its own channel [integration]

- **GIVEN** a publish job attributed to account A referencing A's own channel id
- **WHEN** the worker resolves credentials
- **THEN** the channel is found, its credentials decrypt, and the publish flow proceeds green

#### Scenario: a foreign channelId decrypts no credentials [integration]

- **GIVEN** a worker path is invoked with a `channelId` belonging to account B while attributed to account A
- **WHEN** the credential-resolution, auth-failure-recorder, or mention-lookup path runs
- **THEN** B's channel is NOT resolved, NO credential of B is decrypted, and NO reauth flag is written on B's channel — under both the BYPASSRLS and NOBYPASSRLS role

#### Scenario: the worker binds the account GUC in its own transaction [static]

- **GIVEN** the worker credential/reconciliation path is inspected
- **THEN** it either scopes each Channel query by the job's `accountId` explicitly OR binds `app.account_id` to the job's account inside the worker transaction — never a bare raw-client read with no scope and no GUC

---

### Requirement: Channel child-table reads resolve channelId within tenant scope; any gap is escalated, not silently dropped [MERGE-BLOCKING]

`Channel`'s child tables keyed by `channelId` — `PublishLog`, `Analytics`,
`AnalyticsDailySummary`, `AnalyticsMonthlySummary` — are NOT enrolled in
`TENANT_SCOPED_MODELS`, so the `Channel` guard does NOT protect their reads directly; they
are transitively scoped through `Channel`. Enrolling those tables is OUT OF SCOPE for
Slice 7 (confirm-only). Every analytics read/aggregate path that queries by `channelId`
(`PrismaAnalyticsReadRepository`, `PrismaAnalyticsAggregationQuery`, `analyticsRoutes`,
`AnalyticsDashboardHandlers`) SHALL be AUDITED and CONFIRMED to resolve the parent
`channelId` within tenant scope (via a guarded `Channel` lookup or a project-gated read)
BEFORE the child-table read, so a foreign `channelId` yields NOT_FOUND before any child
aggregation. "Confirmed" means the audit result is documented in
`docs/security/MULTI_TENANT_GUARDS.md`. Any path found NOT to resolve `channelId` within
tenant scope SHALL be ESCALATED to the backlog as a tracked gap (future child-table
enrollment) — it SHALL NOT be silently dropped. Any FUTURE path that reads one of these
child tables SHALL be added to that audit table before it is wired to a route.

#### Scenario: a foreign channelId is unresolvable before any child-table read [integration]

- **GIVEN** tenant A is authenticated and B owns a channel with analytics/publish-log rows
- **WHEN** A calls an analytics read/aggregate route with B's `channelId`
- **THEN** the request resolves to NOT_FOUND before any child-table read or aggregation, and none of B's analytics or publish-log data appears in the payload

#### Scenario: an unresolved child-table read path is escalated, not dropped [static]

- **GIVEN** the child-table read audit is complete
- **WHEN** its findings are recorded
- **THEN** every audited path is documented in `MULTI_TENANT_GUARDS.md`, and any path that does not resolve `channelId` within tenant scope is filed as a tracked backlog gap rather than omitted

---

### Requirement: Create paths validate parent ownership per enrolled model [MERGE-BLOCKING]

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

| Model                        | Slice | Create path                                                                                                                                                                                                                                                                             |
| ---------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExternalNotificationConfig` | 1     | `POST /external-notifications` → `ConfigureExternalNotificationUseCase`                                                                                                                                                                                                                 |
| `ScheduledReport`            | 2     | `POST /reports` → `CreateScheduledReportUseCase`                                                                                                                                                                                                                                        |
| `Campaign`                   | 2     | `POST /campaigns` → `CreateCampaignUseCase`                                                                                                                                                                                                                                             |
| `TrackedLink`                | 3     | `POST /links` → `CreateTrackedLinkUseCase` (`projectId`)                                                                                                                                                                                                                                |
| `RecurringPost`              | 3     | `POST /recurring-posts` → `CreateRecurringPostUseCase` (`projectId` + `templatePostId` + `channels[]`)                                                                                                                                                                                  |
| `GeneratedImage`             | 4     | `POST /ai/generate-image` → `GenerateImageUseCase` (`projectId`; check runs BEFORE the paid AI call)                                                                                                                                                                                    |
| `ProjectMember`              | 5     | **N/A — no production create path** (seed-only writer); check validating `projectId`→`Project` AND `memberId`→`CustomerUser` becomes MANDATORY when SMELL-59 wires writes                                                                                                               |
| `Channel`                    | 7     | OAuth callback (`providerOAuthFlow.ts` `handleOAuthCallback`, `projectId` from consumed OAuth state → error redirect 302 on foreign) + Bluesky connect (`channelRoutes.ts` `connectBluesky`, `projectId` → literal 404) + `POST /channels` (`createChannel`, `projectId` → literal 404) |

#### Scenario: create against a foreign parent is rejected [integration]

- **GIVEN** tenant A is authenticated and the supplied parent id (e.g. `projectId`) belongs to tenant B
- **WHEN** A calls the model's create endpoint with B's parent id
- **THEN** the response is **404 NOT_FOUND** (never 403, never 500), and NO row is persisted

#### Scenario: create against multiple parent refs rejects any foreign ref [integration]

- **GIVEN** tenant A is authenticated and any of `projectId`, `templatePostId`, or a `channels[]` entry belongs to tenant B
- **WHEN** A calls the `RecurringPost` create (or patch-repoint) endpoint
- **THEN** the response is **404 NOT_FOUND** (never 403, never 500), and NO recurrence is persisted

#### Scenario: Channel's create paths reject a foreign parent per transport [integration]

- **GIVEN** tenant A is authenticated and B's `projectId` is supplied to a `Channel` create path
- **WHEN** A completes the OAuth callback (browser-redirect flow) OR the Bluesky connect / `POST /channels` (JSON route)
- **THEN** the OAuth callback resolves to an ERROR REDIRECT (302 — the guarded `projectRepository.findById` probe rejects the foreign `projectId` BEFORE any token exchange; the catch surfaces NOT_FOUND as a 302, never a literal 404), the JSON routes resolve to a literal **404 NOT_FOUND** (never 403, never 500) via `assertCallerOwnsProject`, and in BOTH cases NO channel is persisted

#### Scenario: create against an own parent succeeds and is consistent [integration]

- **GIVEN** tenant A is authenticated and the supplied parent id belongs to A
- **WHEN** A calls the model's create endpoint
- **THEN** the row is created and `accountId == <parent>.accountId` holds on the persisted row

---

### Requirement: Backfill integrity — zero NULL accountId

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

#### Scenario: the three out-of-context callers declare their context explicitly [integration]

- **GIVEN** the guard is flipped for both `RecurringPost` and `TrackedLink` (Slice 3)
- **WHEN** the recurrence-scheduler tick runs, an anonymous visitor hits `GET /r/:shortCode`, and the create path runs its short-code uniqueness probe
- **THEN** each executes inside an explicit `withSystemContext("recurrence-sweep")`, `withSystemContext("public-link-redirect")`, and a `withSystemContext(...)` short-code probe respectively, and none raises `TenantContextMissingError`

---

### Requirement: SagaInstance.accountId carries the TRUE tenant, never a CustomerUser.id [MERGE-BLOCKING]

`SagaContext` SHALL carry `accountId` as a first-class, typed field (not only inside the
untyped `metadata` bag), populated at saga start from the authenticated customer's
`accountId`. Every persisted `SagaInstance` row SHALL store that account in the
`accountId` column on BOTH upsert branches. The engine SHALL NOT write `context.userId`
into `accountId` under any code path. `context.userId` is RETAINED for the audit trail,
the event payloads, and the route ownership check, so the product-visible behavior is
unchanged.

The two identifiers are provably distinct: `customerAuthMiddleware` derives
`customerUser.id` from the `sub` claim and binds the tenant from a SEPARATE `accountId`
claim, so a saga row keyed on `userId` is keyed on a non-tenant value and every
`accountId`-led index lookup, tenant-scoped saga query, and future RLS predicate
resolves against garbage. A saga started for an account with several users SHALL produce
rows carrying ONE stable account value, not one value per user.

#### Scenario: the two identifiers are distinct, so the proof cannot pass by coincidence [static]

- **GIVEN** the customer auth boundary and the test fixtures
- **WHEN** `customerUser.id` and the bound `accountId` are compared
- **THEN** they come from different claims (`sub` vs `accountId`) and the fixture asserts `customerUser.id !== account.id`, so no isolation proof below can pass by accidental equality

#### Scenario: a started saga persists the account, not the user [integration]

- **GIVEN** an authenticated customer of account A whose user id differs from A
- **WHEN** the customer starts a post-publishing saga and the first persist completes
- **THEN** the persisted row's `accountId` equals A's account id, does NOT equal the customer's user id, and no `TenantContextMismatchError` is raised

#### Scenario: two-tenant saga isolation holds through the guarded client [integration]

- **GIVEN** account A and account B each own saga instances and A's tenant context is bound
- **WHEN** A lists saga instances and reads B's saga instance by id through the guarded client, with B's entry deleted from the Redis hot cache first so the guard-blind fast path cannot satisfy the read
- **THEN** the list contains ZERO of B's rows and the by-id read resolves NOT_FOUND — never 403, never 500 — and no mutation of B's row is possible under A's context

---

### Requirement: Saga persistence executes on the guarded client so layer 1 is in the write path [MERGE-BLOCKING]

The saga engine SHALL receive the tenant-GUARDED Prisma client. The bootstrap SHALL NOT
construct the saga integration with the raw `@infra/prisma` singleton, because layer 1
cannot enforce, inject, or reject on a client it never sees — that absence, not any
`$transaction` behavior, is why a non-tenant value persisted silently. Consequently a
saga write whose `accountId` disagrees with the bound context SHALL FAIL LOUDLY
(`TenantContextMismatchError`) instead of persisting, and a saga write with no bound
context SHALL fail with `TenantContextMissingError` unless it runs inside an explicit
`withSystemContext(reason)` wrap.

#### Scenario: no engine construction path takes the raw singleton [static]

- **GIVEN** the change is applied
- **WHEN** every saga-engine construction site is enumerated (bootstrap and container)
- **THEN** each is handed the guarded client, and no saga-engine path receives the raw `@infra/prisma` singleton

#### Scenario: a mismatched account fails loudly instead of persisting [integration]

- **GIVEN** tenant A's context is bound and a saga persist is attempted carrying account B
- **WHEN** the write executes through the engine, including inside its transaction
- **THEN** it raises `TenantContextMismatchError`, no row is written, and the failure is visible in logs — it SHALL NOT be silently accepted

---

### Requirement: SagaInstance backfill integrity — zero CustomerUser.id values remain [MERGE-BLOCKING]

A forward migration SHALL repair historical rows. For each `SagaInstance` row whose
`accountId` is not an account: the true tenant SHALL be resolved from
`context->'metadata'->>'accountId'` when present (authoritative, which also repairs rows
whose column was never written because a falsy `userId` persisted no value), otherwise
from the `CustomerUser.id -> CustomerUser.accountId` join. Rows resolvable by either
source are MAPPABLE and SHALL be corrected. Rows resolvable by neither are UNMAPPABLE and
SHALL be dispositioned by state:

- an unmappable row in a TERMINAL state (`COMPLETED` / `FAILED` / `COMPENSATED`) SHALL be
  set to an explicit, documented sentinel value and counted in a migration report — never
  left holding a `CustomerUser.id`, never silently deleted, never given a fabricated
  account-looking value;
- an unmappable row in a NON-TERMINAL state SHALL HALT the migration with a `RAISE`,
  because a live saga with no true tenant is not safely recoverable and MUST be resolved
  by an operator rather than guessed.

After the migration, ZERO `SagaInstance` rows SHALL hold a value that matches any
`CustomerUser.id`, and the pre-migration row count SHALL be preserved. Every statement
SHALL be idempotent and re-runnable, because a process still running the old code in the
deploy-to-cutover window re-persists its in-memory sagas with the acting user id; the
runbook remedy is a manual re-run after cutover. The down migration is a documented no-op
by design: restoring corrupted user ids is not a rollback goal.

#### Scenario: mappable rows are corrected to the true tenant [integration]

- **GIVEN** historical rows whose `accountId` holds a `CustomerUser.id` or was never written, some also carrying `context.metadata.accountId`
- **WHEN** the backfill migration runs
- **THEN** each row's `accountId` becomes the owning account (metadata preferred over the join), the count of rows matching any `CustomerUser.id` is **0**, and the row count is unchanged

#### Scenario: an unmappable terminal row gets the sentinel and is reported [integration]

- **GIVEN** a terminal-state row whose account is resolvable by neither metadata nor the join
- **WHEN** the backfill migration runs
- **THEN** the row is set to the documented sentinel, the migration reports the count of sentinel rows, and the row is neither deleted nor left holding a user id

#### Scenario: an unmappable non-terminal row halts the migration [deploy-time]

- **GIVEN** a PENDING or RUNNING row whose account is resolvable by neither source
- **WHEN** the backfill migration runs
- **THEN** the in-transaction `RAISE` HALTS the migration with no partial backfill committed and surfaces every offending saga id for operator resolution

#### Scenario: a second run of the migration writes nothing [integration]

- **GIVEN** the backfill has already repaired a set of rows
- **WHEN** the same statements run again
- **THEN** no row is written at all, so the cutover runbook's manual re-run is safe

---

### Requirement: SagaInstance's missing structural legs are recorded and escalated, not silently closed

`SagaInstance` satisfies leg 2 (`TENANT_SCOPED_MODELS`) but its `accountId` is nullable
with NO `Account` relation, and it is covered by neither leg 1 (non-null + relation +
accountId-led index) nor a leg 3 RLS policy. Completing those legs is OUT OF SCOPE here:
the column CANNOT be flipped non-null while the backfill's sentinel rows exist, so the
sentinel disposition is a prerequisite decision. This change SHALL record the residual
gap in `docs/security/MULTI_TENANT_GUARDS.md` and file it as a tracked backlog item — it
SHALL NOT be presented as closed and SHALL NOT be silently dropped. The same recording
obligation covers the guard-blind Redis fast path and the system-scoped engine by-id load
whose control is the route ownership check.

#### Scenario: the residual structural gap is documented and tracked [static]

- **GIVEN** the change is applied
- **WHEN** `docs/security/MULTI_TENANT_GUARDS.md` and the backlog are inspected
- **THEN** the `SagaInstance` leg-1 and leg-3 gap is documented with its reason, the guard-blind cache read and the system-scoped by-id load are recorded as residuals rather than as closed controls, and a tracked backlog item exists for completing the enrollment
