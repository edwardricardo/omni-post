# Spec: analytics-route-port-integrity (SMELL-98)

> Materialized from Engram `sdd/analytics-route-port-integrity/spec` (obs 682) with TWO
> post-verify corrections mandated by the verify ruling (obs 687), both spec defects, not
> apply defects: (1) the export's absent/soft-deleted-project branch answers **403**, not
> 404 — `getProjectAccess` uses a strictly narrower predicate than the project re-read, so
> the 404 branch is dead code, and the characterization pins reality; (2) the export route
> is `GET /analytics/export` taking `projectId` as a QUERY parameter, not a path parameter.

## Purpose

The proposal declares **no new and no modified product capability** — this is a pure refactor. Its deliverable value is therefore a BOUNDARY CONTRACT, and that contract is what this spec states: what MUST be true once `AnalyticsRouteHandler` (`apps/api/src/analytics/analyticsRoutes.ts`) stops receiving `PrismaClient`. Requirements are of two kinds: **preservation invariants** (what must NOT change, which is what makes "zero observable behaviour change" checkable rather than merely asserted) and **boundary rules** (what makes the fix durable).

Equivalence is claimed for RESPONSES only. Security posture improves quietly — the analytics scoping step gains tenant-guard layer-1 coverage — and that improvement is deliberately NOT asserted as equivalence.

Requirements marked **[MB]** are merge-blocking: the change does not ship while one of them is unproven.

## Capability: analytics-read-port-boundary (NEW)

### ADDED Requirements

#### Requirement: Ports-only analytics route construction [MB]

The analytics route handler MUST receive only ports and use cases. It MUST NOT receive, import, or reference a database client in any form — including the injected-type form that fitness #1 and #21 cannot see, since both grep the singleton import and this file imports `type PrismaClient` while resolving from DI.

##### Scenario: Constructor carries no database client

- GIVEN the handler class whose constructor today takes `PrismaClient` as parameter 1 (`:132`)
- WHEN the constructor parameter list is inspected after the change
- THEN no parameter has a Prisma client type, AND every parameter is a port interface or a use case

##### Scenario: Plugin registration resolves no client token

- GIVEN the route plugin registration that today resolves `TOKENS.PrismaClient` (`:977`)
- WHEN the container resolutions it performs are enumerated
- THEN `TOKENS.PrismaClient` is absent, AND the analytics and thread read ports are resolved in its place

##### Scenario: Zero prisma references in the route file

- GIVEN `apps/api/src/analytics/analyticsRoutes.ts`
- WHEN it is searched case-insensitively for `prisma`
- THEN the match count is 0 — covering the `type PrismaClient` import (`:18`) and every `this.prisma.*` read

##### Scenario: Every read is served by a port

- GIVEN the ten direct reads enumerated in the exploration (3 in getDashboard, 5 in exportAnalytics, 2 in getProjectAnalytics)
- WHEN each is traced after the swap
- THEN each resolves to a method on the project-query, analytics-read, or thread-read port, AND the route file issues no query of its own

#### Requirement: Characterization net established before the swap [MB]

A characterization suite for `GET /analytics/dashboard`, `GET /analytics/export` (query `projectId`) and `GET /analytics/project/:projectId` MUST exist and be trustworthy BEFORE any call site moves. The net the backlog declared does not exist: the unit test of that basename imports the ADMIN routes file, and the flow test never invokes a handler. Strict TDD applies — the tests are written first.

##### Scenario: Net covers the three handlers under test

- GIVEN the three handlers that carry the ten reads
- WHEN the new characterization suite is run
- THEN each handler is invoked through its real route with a real response asserted, AND the suite imports the customer analytics routes file, not the admin same-basename file

##### Scenario: The net is proven able to fail

- GIVEN the characterization suite green against unmodified pre-swap code
- WHEN a perturbation is planted in a response the suite claims to pin
- THEN at least one test fails with a non-zero exit, AND after restoring the tree byte-exact the suite is green again

##### Scenario: Assertions pin shape, never arithmetic

- GIVEN the four live defects filed as SMELL-101 (per-channel double count, take-truncation labelled as totals, permanently-blank CSV columns, fake-zero fields)
- WHEN the characterization assertions are reviewed
- THEN no assertion declares an engagement or total VALUE to be correct; the suite pins key sets, types, ordering and cardinality so the defects are reproduced without being enshrined as expected output

##### Scenario: Cache cannot serve a stale hit

- GIVEN the dashboard response is HTTP-cached for 5 minutes with `varyBy` projectId + timeRange
- WHEN the characterization requests are issued
- THEN each request uses a unique projectId/timeRange combination, so no assertion can pass against a cached body produced by the pre-swap code

#### Requirement: Response equivalence across the swap [MB]

For the three handlers, the response MUST be byte-identical before and after the swap under identical fixtures. Status codes, headers that the handlers set, key order, key set, value formatting and row ordering are all in scope.

##### Scenario: Dashboard response is byte-identical

- GIVEN a fixture project with channels, posts and analytics entries across at least two channels on the SAME provider
- WHEN `GET /analytics/dashboard` is served pre-swap and post-swap
- THEN the two response bodies are byte-identical, including the duplicated per-channel metrics the double-count produces today

##### Scenario: JSON export is byte-identical for both includePosts values

- GIVEN the same fixture project
- WHEN `GET /analytics/export` is served with `format=json` and `includePosts` set to true and then false, pre-swap and post-swap
- THEN both bodies are byte-identical in each of the two cases

##### Scenario: CSV export is byte-identical including its blank columns

- GIVEN the same fixture project
- WHEN the export is served with `format=csv` and `includePosts` set to true and then false, pre-swap and post-swap
- THEN both bodies are byte-identical, AND the header column set and ordering are unchanged — including the `postStatus` and `publishedAt` columns that are permanently blank when `includePosts=false`

##### Scenario: Project analytics and the export's denied branch are preserved

- GIVEN a fixture project, and separately a projectId that is absent or soft-deleted
- WHEN `GET /analytics/project/:projectId` is served, and the export is requested for the missing project
- THEN the project-analytics body is byte-identical pre/post swap, AND the export answers with today's **403** body and status (the 404 branch is dead code: `getProjectAccess` filters `{id, accountId, deletedAt}`, strictly narrower than the later re-read, so an absent or soft-deleted project never reaches it — correction per the verify ruling)

#### Requirement: Narrow channel projection on the export path [MB — security]

Channel data reaching the export MUST come from a port method whose adapter carries an explicit `select` of `{id, provider, handle}`. The wide project-channel method MUST NOT be called from this file: it runs `findMany` with no `select` and casts the rows, while the export SPREADS its channels into a tenant-downloadable payload (`:783`). SECURITY_CANON admits no exception marker here.

##### Scenario: The export's channel source is select-bearing

- GIVEN the port method the export uses for channels
- WHEN its adapter implementation is inspected
- THEN it carries an explicit `select` naming exactly `id`, `provider` and `handle`

##### Scenario: Credential columns cannot reach the caller

- GIVEN a channel fixture row whose credential columns (ciphertext, IV, auth tag, key version) are populated
- WHEN the port method returns and its result is spread into the export payload
- THEN no returned object carries any credential-bearing key, even though the underlying row does

##### Scenario: The wide channel method is never called from this file

- GIVEN `analyticsRoutes.ts` after the change
- WHEN its call sites are enumerated
- THEN the wide project-channel method appears zero times

##### Scenario: Export channel key set is unchanged

- GIVEN the pre-swap export response
- WHEN the post-swap channel entries are compared
- THEN the key set and ordering of each channel entry are identical — the projection narrows the SOURCE, never the emitted payload

#### Requirement: Query-shape preservation for the moved reads

Moving a read MUST NOT change its query shape or its bound. Cost is part of "no observable change" on a hot, cached path, and an unmeasured plan swap is a behaviour bet rather than a behaviour proof.

##### Scenario: Analytics reads stay one bounded nested join

- GIVEN the three analytics reads (dashboard, export, project-analytics)
- WHEN the bounded port method (`listProjectEntries`) serving them is inspected at the adapter level
- THEN each read issues a SINGLE nested-join query preserving today's `where` (project scope plus `deletedAt: null`, and the capture-time lower bound where one is supplied), today's descending capture-time ordering, and today's respective take bounds of 500, 5000 and 100 — with no unbounded post-id materialization

##### Scenario: Thread read preserves its select and bound

- GIVEN the export's thread read
- WHEN the new thread port method is inspected
- THEN it selects exactly `{id, postId, strategy, createdAt}` and keeps `take: 1000`, AND it does not include tweet bodies or additional timestamp columns

##### Scenario: Post export read preserves its five-field shape

- GIVEN the export's post read
- WHEN the new post port method is inspected
- THEN it preserves the five selected fields, the descending creation ordering and `take: 1000`, AND returns no extra fields such as project id, deletion timestamp or update timestamp

##### Scenario: Exact reuses keep byte-equivalent predicates

- GIVEN the two post-count reads and the export's project read
- WHEN they are served by the existing count and find-by-id port methods
- THEN each executes a `where` byte-equivalent to the predicate it replaced, AND the fields the handlers consume are present on the returned DTOs

#### Requirement: Soft-delete posture preserved

Every new adapter read MUST carry `deletedAt: null` INLINE in its own `where`, inside fitness #38's call-line + 9 detection window. A `deletedAt` seed hoisted into a shared where-builder above the call is a hard-zero violation whose only exit is a file exception on a list that may only shrink.

##### Scenario: Each new adapter read filters inline

- GIVEN each newly added adapter read method
- WHEN its `where` is inspected
- THEN `deletedAt: null` appears in that call's own `where`, within nine lines of the call, and is not inherited from a hoisted builder

##### Scenario: Fitness #38 stays hard-zero and the ratchet is untouched

- GIVEN the full fitness suite run on the change
- WHEN check #38 is evaluated
- THEN the swept-tree count is 0, AND the db-prisma ratchet count is unchanged at or below its measured baseline, AND no name is added to #38's file-exception list

##### Scenario: No work lands in the ratcheted adapter package

- GIVEN the change's file list
- WHEN it is inspected
- THEN no file under `packages/adapters/db-prisma` is modified

#### Requirement: Debt filed, not absorbed

The defects discovered in the code being moved MUST be recorded as owned backlog rows rather than silently carried. Filing is the mechanism that keeps a zero-behaviour-change refactor honest.

##### Scenario: Backlog rows exist with owners and promotion paths

- GIVEN `docs/reports/roadmap-detected-smells-backlog.md`
- WHEN it is read after the change
- THEN the SMELL-98 row is closed with its merge reference, AND rows SMELL-99 (wide channel adapter plus phantom DTO field), SMELL-100 (test-subject mismatch on the same-basename admin file, plus unchecked `implements` in test doubles), SMELL-101 (the four arithmetic/reporting defects plus the export's redundant project re-read) and SMELL-102 (`z.coerce.boolean()` parses the string "false" as true — repo-wide suspect class) each exist with an owner and a stated promotion path

##### Scenario: No defect fix ships inside this change

- GIVEN the change diff
- WHEN it is reviewed against the filed SMELL-101 defects
- THEN none of them is repaired here, AND the responses still exhibit them exactly as they do today

#### Requirement: Quality gate remains zero-defect

The change MUST leave the repository gate at 0 error / 0 warning, per the project's standing obligation.

##### Scenario: Full gate is green and the code budget holds

- GIVEN the completed change
- WHEN lint (max-warnings 0), typecheck, the full fitness suite and the test suites are run
- THEN every one reports zero errors and zero warnings, AND authored CODE additions plus deletions stay within the proposal's declared ceiling and well under the hard 400-line review budget

## Out of scope (restated so the spec cannot be read as authorizing it)

No arithmetic or reporting defect is fixed; the wide channel adapter and its phantom DTO field are not repaired; the export's redundant project re-read is ported rather than deleted; no fitness gate for "routes never receive a database client" is added (that needs a workflow edit and its own tokened change); no CQRS extraction; no fifth analytics port; no schema or migration.
