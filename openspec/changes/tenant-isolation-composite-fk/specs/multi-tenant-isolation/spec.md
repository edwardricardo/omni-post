# Delta for multi-tenant-isolation — the structural `Post` guard (tenant-isolation-composite-fk / Slice 1)

> Enrolls the product's core trio — **`Post`, `PostContent`, `PostMedia`** — into the living
> `multi-tenant-isolation` capability through a **NEW structural path**: a denormalized
> `accountId` backed by a **composite foreign key**, not by application backfill plus
> convention. This is the "structural `Post` guard" that the living `post-tenant-isolation`
> spec already names as the thing that supersedes its app-level gate at the data layer.
>
> **Why the living Requirement 1 must be MODIFIED rather than merely extended.** Its leg 1
> requires "a non-null `accountId` column with an `Account` relation (`onDelete: Cascade`)".
> The trio deliberately does NOT take a direct `Account` relation — `Post`'s composite
> relation goes to its IMMEDIATE parent `Project` (including the tenant column), and
> `PostContent` / `PostMedia` go to `Post`; the chain anchors in `Project`, then `Account`.
> Written as-is, leg 1 would reject the very form this change adopts. So leg 1 gains a SECOND
> admissible shape. Nothing is weakened: the composite-FK shape is strictly STRONGER than the
> direct relation it joins, because it makes a divergent tenant key unwritable rather than
> merely traceable.
>
> **Model-agnostic invariants are REUSED, not restated**, per the living spec's extension
> contract. "No caller regression from the guard flip" (living Requirement 5) applies verbatim
> to all three models and is NOT repeated here. Two other invariants ARE modified because the
> composite FK changes what they must say: backfill integrity, and the create-path ownership
> check.
>
> **Dependency, stated plainly.** Leg 3 (RLS) is INERT deployment-wide today — the living spec
> already records this for `Channel`, and this change's `rls-enforcement` capability owns the
> demonstrated red and the fix. Until that red is green, the ACTIVE enforcement for the trio
> is leg 1 (now structural, engine-enforced) plus leg 2 (the Prisma `$extends` guard). The
> composite FK is the one part unaffected by the RLS posture, because referential integrity
> checks always bypass row security.
>
> RFC 2119 keywords are normative. **[MERGE-BLOCKING]** requirements MUST be proven green by a
> two-tenant real-DB run before merge. Scenario tags follow the living spec (`[static]`,
> `[integration]`, `[deploy-time]`) plus `[evidence]` as defined in this change's
> `rls-enforcement` delta.
>
> **Out of scope here:** the FK-violation proof, backfill staging, index evidence, and the
> A′-vs-B′ measurement belong to `tenant-key-integrity`; the role posture, zero-rows proof and
> coverage gate belong to `rls-enforcement`; the required-tenant-argument contract belongs to
> `tenant-scoped-query-contract`. This delta covers ENROLLMENT and the trio's model-scoped
> isolation obligations only.

---

## MODIFIED Requirements

### Requirement: Structural tenant isolation by construction **[MERGE-BLOCKING]**

(Previously: leg 1 admitted exactly one shape — a non-null `accountId` with a direct
`Account` relation (`onDelete: Cascade`) and an accountId-led index. This delta adds a SECOND
admissible shape — the composite FK to the immediate parent — and appends `Post`,
`PostContent`, and `PostMedia` to the Enrolled-models table. Leg 2 and leg 3 are unchanged.
The `onDelete` wording is generalized because the deletion workstream has already adjudicated
an action for all 173 relations, and the composite-FK rewrite inherits that decided action per
relation rather than re-opening the question.)

Every enrolled model SHALL be isolated at the DATA layer, not by per-route ownership checks.
For each enrolled model the system SHALL satisfy all three legs:

1. **the table carries a non-null `accountId` column with an accountId-led index**, plus a
   referential anchor in ONE of the two admissible shapes:
   - **1a — direct anchor:** an `Account` relation carrying that relation's adjudicated
     `onDelete` action (`Cascade` for every model enrolled to date); or
   - **1b — composite anchor (NEW):** a composite foreign key to the model's IMMEDIATE parent
     that INCLUDES the tenant column —
     `FOREIGN KEY (parentFk, accountId) REFERENCES parent(id, accountId)` over a **TOTAL**
     `UNIQUE (id, accountId)` on that parent — such that the chain of such references
     terminates in a model satisfying 1a. Under 1b, a row whose `accountId` diverges from its
     parent's is **unwritable**, which is strictly stronger than 1a alone.

   The accountId-led index of leg 1 carries ONE named exemption: a shape-1b child whose
   guarded reads are parent-key-led MAY omit the accountId-led index, because index cost is
   paid **by demonstration, not in bulk** (the research's own rule). The exemption SHALL be
   recorded per table, never silent, and it carries a revisit trigger: if Slice 1's
   `EXPLAIN ANALYZE` evidence shows the RLS policy qual degrading a read on that table to a
   sequential scan, the accountId-led index SHALL be added in the SAME slice;

2. the model is listed in **`TENANT_SCOPED_MODELS`** (Prisma `$extends` guard, layer 1);
3. the table is covered by an **RLS policy** keyed on the `app.account_id` GUC (layer 2),
   introduced by a NEW forward migration (the existing `20260527000000` SHALL NOT be edited).

Shape 1b SHALL NOT be satisfied by composite PRIMARY keys — the signed decision rejects them,
and the unique-constraint form is what buys the guarantee without reshaping identity across the
schema.

Consequently, every query issued through the guarded Prisma client SHALL be auto-scoped to the
account bound in the active `TenantContext`, and NO per-route ownership check SHALL be required
for read, update, or delete paths.

**Enrolled models (extended by each slice):**

| Model                        | Slice            | accountId    | Anchor shape       | `TENANT_SCOPED_MODELS` | RLS policy   |
| ---------------------------- | ---------------- | ------------ | ------------------ | ---------------------- | ------------ |
| `ExternalNotificationConfig` | 1                | Required     | 1a direct          | Required               | Required     |
| `ScheduledReport`            | 2                | Required     | 1a direct          | Required               | Required     |
| `Campaign`                   | 2                | Required     | 1a direct          | Required               | Required     |
| `RecurringPost`              | 3                | Required     | 1a direct          | Required               | Required     |
| `TrackedLink`                | 3                | Required     | 1a direct          | Required               | Required     |
| `GeneratedImage`             | 4                | Required     | 1a direct          | Required               | Required     |
| `ProjectMember`              | 5                | Required     | 1a direct          | Required               | Required     |
| `Channel`                    | 7                | Required     | 1a direct          | Required               | Required     |
| **`Post`**                   | **composite-FK** | **Required** | **1b → `Project`** | **Required**           | **Required** |
| **`PostContent`**            | **composite-FK** | **Required** | **1b → `Post`**    | **Required**           | **Required** |
| **`PostMedia`**              | **composite-FK** | **Required** | **1b → `Post`**    | **Required**           | **Required** |

The trio's dominant guarded reads are `projectId`-filtered, so `Post`'s index is
`@@index([accountId, projectId])` — the same index the composite FK and the RLS policy both
want, so the cost is shared rather than additive. `Post` additionally carries a TOTAL
`@@unique([id, accountId])` because it is itself the FK target for `PostContent` and
`PostMedia`; `Project` gains the same, as the chain's next anchor. `PostContent` and
`PostMedia` take the leg-1 index EXEMPTION: their guarded reads are `postId`-led (equality is
leakproof, so the caller's filter index-scans ahead of the policy qual) and tenant-wide child
listings are not a product query — an accountId-led index on them would be cost paid without
a demonstrated read. The exemption's revisit trigger applies to both tables verbatim.

#### Scenario: the three legs are present for each enrolled model [static]

- **GIVEN** the change enrolling a model is applied
- **WHEN** `schema.prisma`, `infra/prisma/src/extensions/tenantGuard.ts`, and the RLS migration are inspected
- **THEN** the model's `accountId` is non-null with an accountId-led index (or the RECORDED shape-1b parent-key-led exemption with its revisit trigger intact) and satisfies shape 1a OR 1b, its lowerCamel name appears in `TENANT_SCOPED_MODELS`, and an RLS policy covers the table

#### Scenario: shape 1b terminates in a real anchor [static]

- **GIVEN** a model enrolled under the composite-anchor shape
- **WHEN** its parent chain is followed
- **THEN** each hop is a composite FK including the tenant column over a TOTAL `UNIQUE (id, accountId)`, and the chain terminates in a model satisfying shape 1a — no hop drops the tenant column, and no hop is a composite PRIMARY key

#### Scenario: enrolling the trio keeps the enrollment gate green [static]

- **GIVEN** `Post`, `PostContent`, and `PostMedia` now carry `accountId`
- **WHEN** fitness #39 runs
- **THEN** it is green because all three appear in `TENANT_SCOPED_MODELS` — the gate that makes an unenrolled accountId-bearing model impossible to land

#### Scenario: reads through the guarded client are auto-scoped [integration]

- **GIVEN** tenant A's context is bound and rows of an enrolled model exist for both A and B
- **WHEN** any find/update/delete query runs through the guarded Prisma client
- **THEN** only A's rows are visible/affected, with no `accountId` filter written by the caller

#### Scenario: a query with no bound tenant context is refused [integration]

- **GIVEN** no `TenantContext` is bound (and no `withSystemContext()` wrap)
- **WHEN** a query on an enrolled model runs through the guarded client
- **THEN** it fails with `TenantContextMissingError` — it SHALL NOT silently return unscoped rows

---

### Requirement: Backfill integrity — zero NULL accountId

(Previously: the backfill derived `accountId` from the guarded parent and asserted equality,
with a `RAISE` on a double-parent mismatch. This delta adds the composite-FK consequence: once
the FK is VALIDATED, a divergent row is not merely detected — it is unwritable. The equality
assertion therefore moves EARLIER, because `VALIDATE CONSTRAINT` itself becomes the gate that
a bad backfill cannot pass.)

Every pre-existing row of an enrolled model SHALL receive its `accountId` from the guarded
parent's `accountId`, traversed over the parent's NOT NULL FK, BEFORE the `SET NOT NULL` flip
and BEFORE `VALIDATE CONSTRAINT`. Zero rows SHALL remain NULL, zero rows SHALL be dropped or
orphaned, and every row SHALL satisfy `accountId == <immediate parent>.accountId`.

For a model enrolled under shape 1b, `VALIDATE CONSTRAINT` SHALL be treated as the
authoritative verification of that equality across the whole table: it SHALL be run, and it
SHALL pass, before the slice is presented as complete. A slice that leaves the FK `NOT VALID`
has a constraint that governs new writes only, and SHALL say so explicitly rather than report
the guarantee as retroactive.

The existing double-parent obligation is unchanged: when an enrolled model has TWO
`accountId`-bearing parents, the backfill derives from one and ASSERTS equality with the
other, halting the migration (`RAISE`) on mismatch rather than silently picking a side.

#### Scenario: no row survives the migration with a NULL or inconsistent accountId [integration]

- **GIVEN** rows exist before the migration, including soft-deleted rows
- **WHEN** the backfill runs and `SET NOT NULL` is applied
- **THEN** the count of rows with NULL `accountId` is **0**, every row satisfies `accountId == <parent>.accountId`, and the pre-migration row count is preserved

#### Scenario: VALIDATE CONSTRAINT passes over the whole table [deploy-time]

- **GIVEN** the composite FK has been added `NOT VALID` and the backfill has completed
- **WHEN** `VALIDATE CONSTRAINT` runs
- **THEN** it succeeds over every existing row — and if it fails, the migration HALTS and surfaces the offending rows rather than leaving the constraint unvalidated

#### Scenario: an unvalidated constraint is reported as forward-only, never as retroactive [static]

- **GIVEN** a slice ships with the FK still `NOT VALID`
- **WHEN** its completion is reported
- **THEN** the report states that existing rows were not verified by the constraint — the guarantee SHALL NOT be described as covering historical data it never checked

---

### Requirement: Create paths validate parent ownership per enrolled model **[MERGE-BLOCKING]**

(Previously: the invariant existed because the guard injects `accountId` from context but does
NOT validate parent–child consistency, so an inconsistent row could be persisted. This delta
records what the composite FK changes — and, more importantly, what it does NOT change. Under
shape 1b the inconsistent row can no longer be WRITTEN. But the FK's refusal surfaces as a
database error, not as the anti-enumeration **404** this invariant requires. The application
check therefore remains MANDATORY: the FK is a backstop, not a replacement. The Applied-so-far
table appends the trio's write paths.)

Every create (or repoint) path of an enrolled model that accepts a client-supplied parent id
SHALL verify that the parent belongs to the caller's account BEFORE persisting, and SHALL
reject with **NOT_FOUND (404)** otherwise — never 403 (anti-enumeration: a 403 confirms the
resource exists) and **never 500**. A raw foreign-key violation reaching the client as a 500 is
a FAILURE of this requirement even though no row was written, because it both leaks the
existence of the constraint's disagreement and breaks the uniform NOT_FOUND contract.

**Applied so far (extended by each slice):**

| Model                                    | Slice            | Create path                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExternalNotificationConfig`             | 1                | `POST /external-notifications` → `ConfigureExternalNotificationUseCase`                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ScheduledReport`                        | 2                | `POST /reports` → `CreateScheduledReportUseCase`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Campaign`                               | 2                | `POST /campaigns` → `CreateCampaignUseCase`                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `TrackedLink`                            | 3                | `POST /links` → `CreateTrackedLinkUseCase` (`projectId`)                                                                                                                                                                                                                                                                                                                                                                                                                |
| `RecurringPost`                          | 3                | `POST /recurring-posts` → `CreateRecurringPostUseCase` (`projectId` + `templatePostId` + `channels[]`)                                                                                                                                                                                                                                                                                                                                                                  |
| `GeneratedImage`                         | 4                | `POST /ai/generate-image` → `GenerateImageUseCase`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ProjectMember`                          | 5                | N/A — no production create path                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Channel`                                | 7                | OAuth callback + Bluesky connect + `POST /channels`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **`Post` / `PostContent` / `PostMedia`** | **composite-FK** | **Every `Post` write path that accepts a client-supplied `projectId` or clones from an existing post — known members: `CreatePostUseCase`, `DuplicatePostsBatchUseCase`, and the system-context `CreatePostFromRecurrenceUseCase`. The enumeration SHALL be completed and pinned by the slice (see scenario below); `PostContent` / `PostMedia` are written through `Post`'s paths and inherit their `accountId` from the `Post` aggregate, never from request input.** |

#### Scenario: the trio's write paths are ENUMERATED, not sampled [static]

- **GIVEN** the slice is complete
- **WHEN** every production write path that persists a `Post`, `PostContent`, or `PostMedia` is enumerated (routes, use cases, workers, sagas, seeds, scripts)
- **THEN** the enumeration is recorded, each path appears in the table above or is explicitly accounted for, and no write path is left unexamined — a subset audit does not satisfy this

#### Scenario: create against a foreign parent is a 404, not an FK error [integration]

- **GIVEN** tenant A is authenticated and the supplied `projectId` belongs to tenant B
- **WHEN** A calls a `Post` create or duplicate path with B's `projectId`
- **THEN** the response is **404 NOT_FOUND** (never 403, never 500), NO row is persisted, and the raw foreign-key violation does NOT surface to the client

#### Scenario: the system-context writer derives the tenant from the parent, not the caller [integration]

- **GIVEN** the recurrence sweep runs under `withSystemContext("recurrence-sweep")` and creates a post from a template
- **WHEN** the new `Post` is persisted
- **THEN** its `accountId` is derived from the source recurrence's own ownership chain, the composite FK accepts the row, and NO post is created under a different tenant than its `Project`

#### Scenario: child rows inherit the tenant from the aggregate, never from input [integration]

- **GIVEN** a `Post` is created with content and media in the same operation
- **WHEN** the rows are persisted
- **THEN** `PostContent.accountId` and `PostMedia.accountId` equal `Post.accountId`, and a client-supplied tenant value in the payload has no effect on them

#### Scenario: create against an own parent succeeds and is consistent [integration]

- **GIVEN** tenant A is authenticated and the supplied parent id belongs to A
- **WHEN** A calls the model's create endpoint
- **THEN** the row is created and `accountId == <parent>.accountId` holds on the persisted row

---

## ADDED Requirements

### Requirement: Post / PostContent / PostMedia — the product's core entity is isolated at the data layer, and the app-level gate is RETAINED, not replaced **[MERGE-BLOCKING]**

`Post` **is the product**, and it is precisely the entity neither isolation layer could reach:
the Prisma `$extends` guard had no column to inject, and the canonical local-column RLS policy
could not even be written without one. After enrollment, an authenticated tenant A SHALL NOT
read, list, update, duplicate, archive, or delete tenant B's `Post` — and SHALL NOT reach B's
`PostContent` or `PostMedia` through any traversal — at the DATA layer, with no per-route
ownership check required for the guarded paths.

**The existing app-level gate is retained.** The living `post-tenant-isolation` capability
(caller-account ownership on `DELETE /posts/:id` and the four customer-facing read surfaces)
SHALL keep working unchanged. It is superseded at the data layer, which means the data layer
now enforces the same boundary independently — it does NOT mean the app-level gate may be
removed in this change. Removing it is a separate, separately reviewed decision; doing it here
would trade a proven control for an unproven one in the same commit.

`PostContent` and `PostMedia` are enrolled in their own right rather than left as transitively
scoped children, because the living spec's own recorded gap class — a route that reads a
child/join table without resolving the guarded parent first — is exactly how a Post-only
enrollment would leak content while reporting the parent as protected.

#### Scenario: A cannot read or list B's posts through the guarded client [integration]

- **GIVEN** tenant A's context is bound and both A and B own posts
- **WHEN** A issues a post read, a by-project listing with B's `projectId`, and an unfiltered global listing
- **THEN** each returns ZERO of B's posts, with no `accountId` filter written by the caller

#### Scenario: A cannot mutate B's post [integration]

- **GIVEN** tenant A is authenticated and knows the id of B's post
- **WHEN** A calls the update, archive, duplicate, or delete path against B's post id
- **THEN** each resolves to NOT_FOUND, and B's post — including its content and media rows — is unchanged in the database

#### Scenario: B's post content and media are unreachable directly, not only through the parent [integration]

- **GIVEN** tenant A's context is bound and B owns a post with content and media rows
- **WHEN** A queries `PostContent` or `PostMedia` DIRECTLY through the guarded client, without going through `Post`
- **THEN** ZERO of B's rows are returned — the child tables are guarded in their own right, not merely shielded by the parent lookup

#### Scenario: the app-level post ownership gate still passes [integration]

- **GIVEN** the trio is enrolled
- **WHEN** the existing `post-tenant-isolation` integration suites are run (`postDeleteOwnership.test.ts`, `postReadOwnership.test.ts`)
- **THEN** both pass unchanged — the app-level gate is retained alongside the new data-layer guarantee, and neither is removed in this change

#### Scenario: A's own post surfaces keep working [integration]

- **GIVEN** tenant A is authenticated and owns posts, content, and media
- **WHEN** A exercises its own create / read / list / update / duplicate / archive / delete paths
- **THEN** each succeeds as before the change, with no `TenantContextMissingError` and no foreign-key violation on its own rows
