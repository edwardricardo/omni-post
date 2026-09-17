# Delta for multi-tenant-isolation — the per-channel publication record's create path (post-publish-partial-failure)

> ONE requirement changes: **"Create paths validate parent ownership per enrolled model"**. This
> change introduces a new `accountId`-bearing child of `Post`, keyed by `channelId`, whose create
> path accepts **client-supplied refs for BOTH parents** — the `postId` being scheduled and every
> `channelId` in the requested target set (`SchedulePostUseCase.ts:139-151`). The living requirement
> exists precisely for that shape: the tenant guard injects `accountId` from the bound context but
> does NOT validate parent–child consistency, so without the check a tenant can persist a row
> carrying its OWN `accountId` and a FOREIGN parent id.
>
> **Model-agnostic invariants are REUSED, not restated**, per the living spec's extension contract.
> Structural enrollment (leg 1 / leg 2 / leg 3), backfill integrity, and "no caller regression from
> the guard flip" apply to this model verbatim and are NOT repeated here. Backfill is trivially
> satisfied: the table is NEW, so it has no pre-existing rows and the `accountId` column is born NOT
> NULL.
>
> **`rls-policy-form` is a CONFORMANCE constraint, not a modification.** The new table's policy SHALL
> be written in that capability's canonical InitPlan-wrapped form, and its migration SHALL follow its
> migration rules — timeouts first, reversible down, landing in ONE commit with the `schema.prisma`
> edit. No requirement of `rls-policy-form` is amended by this change, and the `pg_catalog` coverage
> gate enumerates `getTenantScopedModels()`, so the new table is gated by construction the moment it
> is enrolled.
>
> **The model's NAME is deliberately not fixed here.** The record's entity/model name is an open item
> for this change's design phase; the row below identifies it by what it IS — the enrolled child of
> `Post` keyed by `channelId` — so the requirement does not depend on a naming decision it has no
> business making.
>
> Scenario tags are the living spec's: `[integration]`, `[static]`, `[deploy-time]`.

---

## MODIFIED Requirements

### Requirement: Create paths validate parent ownership per enrolled model [MERGE-BLOCKING]

(Previously: the applied-so-far table ended at `Channel` (Slice 7). It gains a row for the
per-channel publication record introduced by `post-publish-partial-failure`, whose create path
validates TWO kinds of client-supplied ref — the parent `postId` and every requested `channelId` —
and the requirement text now states explicitly that a create path reached from a BACKGROUND worker
or a saga step, rather than from an HTTP request, is bound by the same obligation.)

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

**The obligation follows the REF, not the transport.** A create path reached from a saga step, a
queue worker, or any other non-HTTP entry point carries the same duty: it SHALL execute bound to the
owning account's tenant scope and SHALL validate the client-supplied refs it was handed, because the
refs were client-supplied at the moment the work was REQUESTED even if they are persisted later. A
path that cannot resolve a tenant scope SHALL fail closed and persist nothing rather than execute
unscoped.

**Applied so far (extended by each slice):**

| Model                                                                                                                                    | Slice   | Create path                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExternalNotificationConfig`                                                                                                             | 1       | `POST /external-notifications` → `ConfigureExternalNotificationUseCase`                                                                                                                                                                                                                                                                                       |
| `ScheduledReport`                                                                                                                        | 2       | `POST /reports` → `CreateScheduledReportUseCase`                                                                                                                                                                                                                                                                                                              |
| `Campaign`                                                                                                                               | 2       | `POST /campaigns` → `CreateCampaignUseCase`                                                                                                                                                                                                                                                                                                                   |
| `TrackedLink`                                                                                                                            | 3       | `POST /links` → `CreateTrackedLinkUseCase` (`projectId`)                                                                                                                                                                                                                                                                                                      |
| `RecurringPost`                                                                                                                          | 3       | `POST /recurring-posts` → `CreateRecurringPostUseCase` (`projectId` + `templatePostId` + `channels[]`)                                                                                                                                                                                                                                                        |
| `GeneratedImage`                                                                                                                         | 4       | `POST /ai/generate-image` → `GenerateImageUseCase` (`projectId`; check runs BEFORE the paid AI call)                                                                                                                                                                                                                                                          |
| `ProjectMember`                                                                                                                          | 5       | **N/A — no production create path** (seed-only writer); check validating `projectId`→`Project` AND `memberId`→`CustomerUser` becomes MANDATORY when SMELL-59 wires writes                                                                                                                                                                                     |
| `Channel`                                                                                                                                | 7       | OAuth callback (`providerOAuthFlow.ts` `handleOAuthCallback`, `projectId` from consumed OAuth state → error redirect 302 on foreign) + Bluesky connect (`channelRoutes.ts` `connectBluesky`, `projectId` → literal 404) + `POST /channels` (`createChannel`, `projectId` → literal 404)                                                                       |
| Per-channel publication record — the enrolled child of `Post` keyed by `channelId` (name fixed by `post-publish-partial-failure` design) | N-COR-8 | The post-scheduling path (`SchedulePostUseCase`) and the channel-scoped retry: the parent `postId` AND every requested `channelId` SHALL belong to the caller's account before any record is persisted → literal **404 NOT_FOUND** on a foreign ref. The row is written ONLY through the `Post` aggregate root, and `accountId == post.accountId` holds on it |

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

#### Scenario: a publication record is never created for a foreign channel or a foreign post [integration]

- **GIVEN** tenant A is authenticated and either the `postId` or one entry of the requested channel set belongs to tenant B
- **WHEN** A schedules the post, or retries a channel on it
- **THEN** the response is **404 NOT_FOUND** (never 403, never 500), NO publication record is persisted for any channel of that request, and no publish job is enqueued

#### Scenario: a record written from the worker stays inside its post's tenant [integration]

- **GIVEN** a per-channel outcome applied from the publish worker rather than from an HTTP request
- **WHEN** it commits
- **THEN** it executed bound to the owning account's tenant scope, the persisted row satisfies `accountId == post.accountId`, and no row of another tenant was reachable by that transaction

#### Scenario: create against an own parent succeeds and is consistent [integration]

- **GIVEN** tenant A is authenticated and the supplied parent id belongs to A
- **WHEN** A calls the model's create endpoint
- **THEN** the row is created and `accountId == <parent>.accountId` holds on the persisted row
