# TrackedLink Tenant Isolation — Specification

> Living specification for the **trackedlink-tenant-isolation** capability: every
> TrackedLink read/delete resolves ONLY within the caller's account; a foreign id
> returns NOT_FOUND (404) — never leaked, never deleted. Closes the LIVE CWE-639
> IDOR on TrackedLink (exploration §4). Established by change `trackedlink-idor-fix`
> (archived 2026-07-13, merged via PR #109 security fix + PR #110 dead-code purge).
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** are the hard pass/fail bar.

---

## Scope

- **In**: ownership-scoped resolution for the 3 TrackedLink operations (get, get-stats,
  delete); removal of the unwired `/api/cqrs/*` route; correction of one doc paragraph.
- **Out**: the structural `accountId` denormalization on the 9 projectId-only models and
  the AI response-cache leak (N-SEC-4) are SEPARATE changes — this slice is
  TrackedLink-only. The write-side IDOR on `POST /links` (client-supplied `projectId`,
  no ownership check on create) is also OUT of scope here — tracked for the
  `project-scoped-tenant-guard` change (see `## Known follow-up` below).
- **Constant**: fitness **#21** (no Prisma singleton outside composition root) and **#23**
  (no raw queries) stay hard-zero; the fix touches typed Prisma only.

## Requirements

### Requirement: [MERGE-BLOCKING] Ownership-scoped resolution

Each TrackedLink operation (`get`, `get-stats`, `delete`) SHALL resolve a link ONLY when
that link belongs to the caller's account (the account bound in TenantContext). A link
whose owning account differs from the caller's SHALL resolve to NOT_FOUND on every
operation — the link body, its click stats, and its deletion SHALL NOT be reachable.

#### Scenario: Owner succeeds on all three operations

- **GIVEN** a TrackedLink owned by the caller's account
- **WHEN** the caller invokes `GET /links/:id`, `GET /links/:id/stats`, and `DELETE /links/:id`
- **THEN** each operation resolves the link and succeeds (2xx)

#### Scenario: A foreign-account link id returns NOT_FOUND on all three operations

- **GIVEN** tenant A authenticated with A's own valid JWT, and a link id owned by tenant B
- **WHEN** A invokes `GET /links/{B_id}`, `GET /links/{B_id}/stats`, and `DELETE /links/{B_id}`
- **THEN** each returns 404 NOT_FOUND — no link body, no stats, no deletion

### Requirement: [MERGE-BLOCKING] Anti-enumeration

A foreign link id SHALL produce the SAME NOT_FOUND (404) response as a nonexistent id.
The system SHALL NOT return FORBIDDEN, nor any distinguishable "exists but not yours"
signal (status code, body, or timing) that lets a caller enumerate foreign ids.

#### Scenario: Foreign id and nonexistent id are indistinguishable

- **GIVEN** a link id owned by tenant B and a random id that exists nowhere
- **WHEN** tenant A requests each on the same operation
- **THEN** both yield a byte-identical NOT_FOUND outcome (same status, same body shape)
- **AND** neither response reveals whether the id exists

### Requirement: [MERGE-BLOCKING] No destructive cross-tenant effect

A `DELETE` for a foreign link id SHALL NOT delete the target link and SHALL NOT trigger
the `LinkClick` cascade. The ownership check SHALL gate the destructive `$transaction`
before any row is removed.

#### Scenario: Foreign DELETE leaves tenant B's data intact

- **GIVEN** tenant B owns a link with N associated `LinkClick` rows
- **WHEN** tenant A issues `DELETE /links/{B_id}` and receives 404
- **THEN** B's link still exists
- **AND** all N of B's `LinkClick` rows remain

### Requirement: The account comes from the bound context, not the caller

The ownership filter SHALL derive the account from the sanctioned tenant-context path
(`requireTenantContext()`), NOT from any caller-suppliable parameter. No guarded code
path SHALL accept an optional/omittable account argument that, when omitted, resolves a
TrackedLink without an account filter.

#### Scenario: No resolution uses a client-originated account

- **GIVEN** the ownership filter on the read/delete path
- **WHEN** any of the 3 operations resolves a TrackedLink
- **THEN** the account value used in the `where` clause originates from
  `requireTenantContext()`
- **AND** no code path resolves a TrackedLink using an account value derived from client
  input (route param, query, header, or body)

### Requirement: The latent CQRS publish primitive is removed

The unwired `POST /api/cqrs/*` route — a cross-tenant PUBLISH primitive if ever wired —
SHALL NOT exist after this change. It has zero non-test wiring today (exploration §0, §4)
and SHALL be deleted so it cannot be wired later without ownership gating.

#### Scenario: The /api/cqrs/\* route is absent

- **GIVEN** the running API after this change
- **WHEN** a request hits `POST /api/cqrs/posts/:postId/publish`
- **THEN** the route is absent from the route table (404)
- **AND** no non-test code constructs the CQRS integration

### Requirement: Documentation truth (doc requirement)

> This is a correctness requirement on documentation, not code.

`docs/security/MULTI_TENANT_GUARDS.md` (Layer 3) SHALL state fitness **#23**'s real
scope — it blocks raw `$queryRaw`/`$executeRaw` outside the tenant-guard exceptions —
and SHALL NOT claim #23 scans typed-Prisma adapters for a missing `accountId` join.

#### Scenario: The phantom-control paragraph is corrected

- **GIVEN** the Layer 3 paragraph that claimed #23 catches typed-adapter missing-join
- **WHEN** the doc is read after this change
- **THEN** it describes #23 as raw-query blocking only
- **AND** it no longer implies a typed-adapter join scan exists

## Verification note

The three **[MERGE-BLOCKING]** requirements MUST be proven by an INTEGRATION test against
a real database. A mocked unit test would not catch a missing `WHERE` filter — the repository
would return stubbed data regardless of the join — so the same real-DB lesson from prior
tenant-scoping slices applies. The test MUST exercise a genuine two-tenant fixture:
owner-success on all 3 routes, foreign-id 404 on all 3 routes, and post-delete assertion
that tenant B's link and its `LinkClick` rows are intact. Fitness #21 and #23 MUST remain
hard-zero after the change.

Proven at archive time: `apps/api/tests/integration/trackedLinkTenantIsolation.integration.test.ts`
(8/8 green, real-DB two-tenant fixture, `node --import tsx --conditions development --test`).
`getClickStats` is additionally scoped-by-construction (not merely safe-by-convention via the
`findById` gate) — see `## Known follow-up` for the one deferred surface.

## Known follow-up (not required for this capability's pass bar)

The read/delete path closed by this capability does not make `TrackedLink` tenant-safe
end-to-end: `CreateTrackedLinkUseCase` takes `projectId` directly from the request body and
does not verify the project belongs to the caller's account (`TrackedLink` is not yet in
`TENANT_SCOPED_MODELS`, so the Prisma tenant-guard extension is inert on `create`). This is a
real, live write-side CWE-639 (lower severity than a read leak — requires the target's
project UUID out-of-band and cannot read the write back) explicitly deferred to the
`project-scoped-tenant-guard` change per this capability's original `## Scope` "Out" section.
Tracked in engram `security/trackedlink-write-idor` (observation #252).
