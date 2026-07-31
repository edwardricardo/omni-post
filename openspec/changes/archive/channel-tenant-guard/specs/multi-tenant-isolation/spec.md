# Delta for multi-tenant-isolation

> Slice 7 of the `project-scoped-tenant-guard` rollout (Tier 4 / HIGH, max blast).
> Enrolls the credential-bearing, `projectId`-only model `Channel`
> (`schema.prisma:766-830`, 4 encrypted OAuth-credential columns) into the two-layer
> structural tenant guard, EXTENDING the living `multi-tenant-isolation` capability
> (Slices 1–5).
>
> **Deployment fact baked into these requirements (verified against the live DB).**
> The app AND worker connection role is `postgres` with `rolsuper=true` /
> `rolbypassrls=true`, so RLS (leg 3) is CURRENTLY INERT for the whole deployment;
> the Prisma `$extends` guard (leg 1) is the ONLY active enforcement and the workers
> run on the RAW client that LACKS it. Requirements therefore demand APP-LAYER tenant
> safety on every worker Channel path that holds under BOTH role postures (BYPASSRLS
> today, NOBYPASSRLS future) AND require the account GUC to be bound in the worker's
> own transaction so a future NOBYPASSRLS role does not silently filter worker reads
> to zero rows (publish breakage). Leg 3 (RLS policy) is still required as
> defense-in-depth for when the role is corrected.
>
> Reused VERBATIM (not restated): the model-agnostic invariants of Requirements 1, 3,
> 4, and 5 apply to `Channel`. This delta (a) appends `Channel` to the Requirement 1
> Enrolled-models table (57 → 58), (b) adds three `Channel`-scoped requirements — the
> route/credential IDOR closure, the worker-path tenant-safety requirement, and the
> child-table read-confirmation requirement, (c) extends Requirement 3 to `Channel`'s
> TWO create paths, (d) concretizes Requirement 4 for `Channel`'s soft-deleted rows,
> and (e) concretizes Requirement 5 for `Channel`'s out-of-context callers.
>
> RFC 2119 keywords are normative; **[MERGE-BLOCKING]** requirements MUST be proven
> green by a two-tenant real-DB integration run (and, for the worker paths, a
> publish-flow regression) before merge. **[static]** scenarios are checkable by
> inspecting schema/migrations/config; **[integration]** scenarios require a real-DB,
> two-tenant run; **[deploy-time]** scenarios are enforced by a migration-time `RAISE`.
>
> **Corrected at archive (2026-07-28, verify SUGGESTION-2).** The list-route wording
> below originally said the foreign-`projectId` list returns an empty result "with no
> per-route ownership check". The code is STRICTER than that: `channelRoutes.ts:351`
> runs `assertCallerOwnsProject` (predating this slice, commit `4730470a`) so a foreign
> `projectId` resolves to 404 at the route, and the guarded repository independently
> returns `[]` at the data layer. The requirement text and its scenario are corrected
> here to match shipped behavior; the living spec already carries the corrected wording.

## ADDED Requirements

### Requirement: Channel — the live IDOR routes are closed, and no decrypted provider credential crosses the tenant boundary [MERGE-BLOCKING]

An authenticated tenant A SHALL NOT read, list, connect, update, or delete tenant B's
`Channel`. Each of B's id-only JSON routes (get / update / delete) SHALL resolve to
**NOT_FOUND (404)** for A — never 403 (anti-enumeration) and never a 500. The
provider-connect action resolves the same NOT_FOUND decision, surfaced per its transport:
the Bluesky connect (JSON route) returns a literal **404** via `assertCallerOwnsProject`,
while the OAuth callback — a browser-redirect flow whose catch converts every error into a
302 (`providerOAuthFlow.ts:310-318`) — surfaces the NOT_FOUND as the standard **error
redirect (302)**, never a literal 404 status. In BOTH transports NO channel is persisted
under B's project. A list carrying a FOREIGN `projectId` SHALL resolve to NOT_FOUND at the
route (`channelRoutes.ts:351` `assertCallerOwnsProject`, predating this slice — strictly
stronger than the guard-natural empty result the guarded repository still returns for a
foreign `projectId`). Critically, because `Channel` carries FOUR AES-GCM
credential columns (`credentialsCiphertext` / `Iv` / `AuthTag` / `KeyVersion`) decrypted
by the credential-resolution path, NO decrypted provider OAuth token SHALL cross the tenant
boundary — not in a response body, not in an error message, not in a log, and not through
an outbound provider API call performed on B's behalf.

#### Scenario: A cannot read B's channel by id [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's `Channel`
- **WHEN** A calls the get-by-id route with B's channel id
- **THEN** the request resolves to NOT_FOUND and no channel data of B — including any decrypted credential — appears in the payload

#### Scenario: listing with a foreign projectId exposes zero channels [integration]

- **GIVEN** tenant A is authenticated and B owns channels under B's project
- **WHEN** A calls the list route with `projectId={B's projectId}`
- **THEN** the request resolves to NOT_FOUND at the route's `assertCallerOwnsProject` gate and the response contains ZERO of B's channels; independently, the guarded repository returns `[]` for that `projectId` under A's context

#### Scenario: A cannot update or delete B's channel [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's channel
- **WHEN** A calls the update or delete route against B's channel id
- **THEN** each resolves to NOT_FOUND and B's channel is unchanged in the database

#### Scenario: A cannot connect a provider into B's project via the OAuth callback [integration]

- **GIVEN** tenant A is authenticated and the OAuth callback carries B's `projectId` in the consumed OAuth state
- **WHEN** A completes the OAuth callback
- **THEN** the request resolves to an ERROR REDIRECT (302 — the browser-redirect flow surfaces the NOT_FOUND as the standard error redirect via `providerOAuthFlow.ts:310-318`, never a literal 404 status) and NO channel is persisted under B's project

#### Scenario: A cannot connect a provider into B's project via the Bluesky connect [integration]

- **GIVEN** tenant A is authenticated and the Bluesky connect (JSON route) carries B's `projectId`
- **WHEN** A completes the Bluesky connect action
- **THEN** the request resolves to **404 NOT_FOUND** (never 403, never 500) via the `assertCallerOwnsProject` gate and NO channel is persisted under B's project

#### Scenario: no decrypted credential is ever materialized across the boundary [integration]

- **GIVEN** tenant B owns a channel with stored encrypted credentials
- **WHEN** tenant A exercises ANY Channel route referencing B's channel id
- **THEN** the response, error body, and logs contain NO decrypted credential of B, and no provider API call is made with B's token

---

### Requirement: Channel worker credential and reconciliation paths are tenant-safe under both DB-role postures, with the account GUC bound [MERGE-BLOCKING]

The three worker paths that today read `Channel` on the RAW client with NO tenant scope —
credential resolution (`CredentialResolver` → `getChannelsByIds` → decrypt), the
auth-failure recorder (`ChannelAuthFailureRecorder`), and the mention channel lookup
(`mentionIngestWorker`) — SHALL be made tenant-safe. A worker operation SHALL resolve or
mutate ONLY channels belonging to the account the job is attributed to; a `channelId` that
does not belong to the job's account SHALL NOT have its credentials decrypted, its
reauth flag written, or its row returned. This safety SHALL hold under BOTH postures: (1)
the current BYPASSRLS role, where RLS is inert and app-layer scoping is the sole guard, and
(2) a future NOBYPASSRLS role. To satisfy (2) without silent publish breakage, the worker
SHALL bind the account GUC (`app.account_id`) in its OWN transaction for the job's account,
so RLS permits the job's own rows and denies foreign rows once the role is corrected.
**The publish flow SHALL remain green — credential resolution keeps working for the job's
own channel** (the MERGE-BLOCKING regression). Binding `withSystemContext` on the raw
client alone SHALL NOT be accepted as satisfying this requirement, because the raw client
has no `$extends` guard and RLS needs the GUC bound in-tx.

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
`TENANT_SCOPED_MODELS`, so the `Channel` guard does NOT protect their reads directly.
Enrolling those tables is OUT OF SCOPE for this slice (confirm-only). This slice SHALL
AUDIT every analytics read/aggregate path that queries by `channelId`
(`PrismaAnalyticsReadRepository`, `AnalyticsAggregationQuery`, `analyticsRoutes`,
`AnalyticsDashboardHandlers`) and CONFIRM that each resolves the parent `channelId` within
tenant scope (via a guarded `Channel` lookup) BEFORE the child-table read, so a foreign
`channelId` yields NOT_FOUND before any child aggregation. "Confirmed" means the audit
result is documented in `docs/security/MULTI_TENANT_GUARDS.md`. Any path found NOT to
resolve `channelId` within tenant scope SHALL be ESCALATED to the backlog as a tracked gap
(future child-table enrollment) — it SHALL NOT be silently dropped.

#### Scenario: a foreign channelId is unresolvable before any child-table read [integration]

- **GIVEN** tenant A is authenticated and B owns a channel with analytics/publish-log rows
- **WHEN** A calls an analytics read/aggregate route with B's `channelId`
- **THEN** the request resolves to NOT_FOUND before any child-table read or aggregation, and none of B's analytics or publish-log data appears in the payload

#### Scenario: an unresolved child-table read path is escalated, not dropped [static]

- **GIVEN** the child-table read audit is complete
- **WHEN** its findings are recorded
- **THEN** every audited path is documented in `MULTI_TENANT_GUARDS.md`, and any path that does not resolve `channelId` within tenant scope is filed as a tracked backlog gap rather than omitted

## MODIFIED Requirements

### Requirement: Structural tenant isolation by construction [MERGE-BLOCKING]

(Previously: the Enrolled-models table ended at `ProjectMember` (Slice 5). This delta appends `Channel` (Slice 7); the invariant text and scenarios are unchanged. Note: leg 3/RLS is required but currently INERT deployment-wide under the superuser role — legs 1–2 plus the Channel worker-path app-layer scoping are the ACTIVE enforcement today.)

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
`@@index([accountId, projectId])`. Guard membership moves from **57 → 58** (JSDoc header
count bumped).

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

### Requirement: Create paths validate parent ownership per enrolled model [MERGE-BLOCKING]

(Previously: the Applied-so-far table ended at `ProjectMember` (Slice 5, deferred). This delta appends `Channel` (Slice 7), which has TWO create paths — the OAuth callback and the Bluesky connect. The OAuth callback today persists a client-supplied `projectId` from consumed OAuth state with NO ownership check; the Bluesky connect ALREADY has an `assertCallerOwnsProject` gate but its create lacks `accountId`. Both SHALL thread `accountId` and reject a foreign `projectId` with 404.)

The guard injects `accountId` from the bound context but does NOT validate parent–child
consistency. Therefore every create (or repoint) path of an enrolled model that accepts a
client-supplied parent id SHALL verify that the parent belongs to the caller's account
BEFORE persisting, and SHALL reject with **NOT_FOUND (404)** otherwise — never 403
(anti-enumeration: a 403 confirms the resource exists) and never 500. Without this check a
tenant could persist a row carrying its OWN `accountId` and a FOREIGN parent id — an
inconsistent row and a latent exfiltration channel. Each slice concretizes this requirement
for its own model's create path; the invariant is stated once here. `Channel`'s OAuth
callback SHALL bind `withTenantContext({ accountId: record.accountId })` from the consumed
OAuth state and thread `accountId` into `Channel.create` (never `update`), so the guard
scopes the save and a foreign `projectId` resolves to NOT_FOUND — surfaced as the standard
**error redirect (302)** by the browser-redirect callback flow (`providerOAuthFlow.ts:310-318`),
not a literal 404 status, with NO channel persisted; the Bluesky connect (JSON route) SHALL
thread `accountId` from its already-gated owned project and return a literal **404** via
`assertCallerOwnsProject`.

**Applied so far (extended by each slice):**

| Model                        | Slice | Create path                                                                                                                                                 |
| ---------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExternalNotificationConfig` | 1     | `POST /external-notifications` → `ConfigureExternalNotificationUseCase`                                                                                     |
| `ScheduledReport`            | 2     | `POST /reports` → `CreateScheduledReportUseCase`                                                                                                            |
| `Campaign`                   | 2     | `POST /campaigns` → `CreateCampaignUseCase`                                                                                                                 |
| `TrackedLink`                | 3     | `POST /links` → `CreateTrackedLinkUseCase` (`projectId`)                                                                                                    |
| `RecurringPost`              | 3     | `POST /recurring-posts` → `CreateRecurringPostUseCase` (`projectId` + `templatePostId` + `channels[]`)                                                      |
| `GeneratedImage`             | 4     | `POST /ai/generate-image` → `GenerateImageUseCase` (`projectId`; check runs BEFORE the paid AI call)                                                        |
| `ProjectMember`              | 5     | **N/A — no production create path** (seed-only writer); check becomes MANDATORY when SMELL-59 wires writes                                                  |
| `Channel`                    | 7     | OAuth callback (`providerOAuthFlow.ts` `handleOAuthCallback`, `projectId` from consumed OAuth state) + Bluesky connect (channel connect route, `projectId`) |

#### Scenario: create against a foreign parent via the OAuth callback is rejected [integration]

- **GIVEN** tenant A is authenticated and the consumed OAuth state carries a `projectId` belonging to tenant B
- **WHEN** A completes the OAuth callback create path with B's `projectId`
- **THEN** the response is an ERROR REDIRECT (302 — the browser-redirect flow surfaces the NOT_FOUND as the standard error redirect via `providerOAuthFlow.ts:310-318`, never a literal 404 status), and NO channel is persisted

#### Scenario: create against a foreign parent via the Bluesky connect is rejected [integration]

- **GIVEN** tenant A is authenticated and the supplied `projectId` belongs to tenant B
- **WHEN** A completes the Bluesky connect create path with B's `projectId`
- **THEN** the response is **404 NOT_FOUND** (never 403, never 500) via `assertCallerOwnsProject`, and NO channel is persisted

#### Scenario: create against an own parent succeeds and is consistent [integration]

- **GIVEN** tenant A is authenticated and the supplied `projectId` belongs to A
- **WHEN** A completes either Channel create path
- **THEN** the channel is created and `accountId == Project.accountId` holds on the persisted row

---

### Requirement: Backfill integrity — zero NULL accountId

(Previously: the requirement covered single-parent and double-parent backfill. This delta concretizes it for `Channel`, whose rows include SOFT-DELETED rows (`deletedAt`) that MUST also be backfilled so the `SET NOT NULL` flip does not fail; the invariant text is otherwise unchanged.)

Every pre-existing row of an enrolled model SHALL receive its `accountId` from the guarded
parent's `accountId`, traversed over the parent's NOT NULL FK, BEFORE the `SET NOT NULL`
flip. Zero rows SHALL remain NULL, and zero rows SHALL be dropped or orphaned by the
migration. Soft-deleted rows SHALL be backfilled equally (the `UPDATE ... FROM Project`
covers them naturally over the NOT-NULL `projectId` FK). When an enrolled model has TWO
`accountId`-bearing parents, the backfill SHALL derive `accountId` from one parent AND
assert it EQUALS the other for EVERY row; any mismatch SHALL HALT the migration (RAISE).

#### Scenario: no row survives the migration with a NULL accountId, soft-deleted included [integration]

- **GIVEN** `Channel` rows exist before the migration, including soft-deleted rows
- **WHEN** the backfill runs and `SET NOT NULL` is applied
- **THEN** the count of `Channel` rows (soft-deleted included) with NULL `accountId` is **0**, every row satisfies `accountId == Project.accountId`, and the pre-migration row count is preserved

#### Scenario: a NULL accountId halts the migration [deploy-time]

- **GIVEN** a `Channel` row whose `accountId` could not be derived before `SET NOT NULL`
- **WHEN** the backfill migration runs
- **THEN** the in-transaction `RAISE` HALTS the migration (no partial backfill committed) and surfaces the offending row

---

### Requirement: No caller regression from the guard flip

(Previously: the concretizing scenario covered Slice 3's three `withSystemContext()` callers. This delta adds a `Channel`-specific scenario for the system-context and cascade callers that MUST keep working after the flip; the invariant text is unchanged.)

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
- **WHEN** every reference to `Channel` is enumerated (api, workers, seeds, scripts, sagas)
- **THEN** each call site runs behind `enterTenantContext`, an explicit `withSystemContext()` wrap, or the worker's declared account-scoped context

#### Scenario: Channel's system-context and cascade callers keep working [integration]

- **GIVEN** the guard is flipped for `Channel`
- **WHEN** an inbound webhook processor resolves a channel by `providerAccountId` under `withSystemContext("system:inbound-webhook")`, a bulk-by-provider reauth/soft-delete op runs cross-tenant under system context, and a project/account cascade delete removes a project's channels and their `PublishLog`/`Analytics` child rows
- **THEN** each completes successfully with no `TenantContextMissingError`, and no cross-tenant channel is affected by the tenant-scoped paths
