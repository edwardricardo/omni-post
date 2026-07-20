# Audit Actor Visibility — Delta Spec (audit-actor-polymorphism / A2)

> New capability for change `audit-actor-polymorphism`. Capability: **customer
> actors are surfaced everywhere admin actors are read today — logs, stats /
> top-actors, the CSV export, the API response shape, and the `apps/admin`
> compliance frontend — without changing how admin rows render.**
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Every requirement
> carries Given/When/Then scenarios written to become a FAILING test (RED) then
> made GREEN.
>
> **Ordering:** A2 is the read-path slice and depends on A1
> (`audit-actor-attribution` + `customer-audit-write-path`). It is non-breaking for
> admin consumers even before it ships (customer rows simply surface `user` as null).
>
> Behavior-first: these requirements state WHAT the read path must expose, not the
> exact query shape, DTO field names, or CSV column key — those are design choices.

---

## ADDED Requirements

### Requirement: Customer actors are visible in logs and stats

`AuditService.getLogs` / `getStats` and `AuditLogger.getStatistics` SHALL surface
customer actors. Statistics and top-actors SHALL NOT bucket all customer-actor rows
into a single null-user bucket; a customer actor SHALL be counted and identifiable
distinctly from system rows (which today share `userId == null`).

#### Scenario: Stats no longer collapse customers into the null bucket

- GIVEN audit rows attributed to customer actors and to system actions
- WHEN stats / top-actors are computed
- THEN customer actors are counted per customer identity, not merged into one null-user bucket
- AND system rows remain distinguishable via `actorType = SYSTEM`

#### Scenario: getLogs returns the customer actor for a customer row

- GIVEN a customer-actor audit row
- WHEN `getLogs` returns it
- THEN the row exposes the customer actor's identity (not a null user)

---

### Requirement: CSV export carries the customer actor identity

The CSV export SHALL include a customer action's actor identity. Today the export
declares only a `"user.email"` column (`apps/api/src/audit/auditRoutes.ts:375`),
which is blank for customer rows; after this change a customer row SHALL carry its
actor identity in the export.

#### Scenario: Customer row exports a non-blank actor

- GIVEN a customer-actor audit row
- WHEN the CSV export is generated
- THEN the exported row carries the customer actor's identity (not a blank `user.email`)

#### Scenario: Admin row exports identically to today

- GIVEN an admin-actor audit row
- WHEN the CSV export is generated
- THEN its actor column matches the pre-change `"User Email"` output exactly

---

### Requirement: API response and admin frontend type expose the actor

The audit API response shape and the `apps/admin` frontend `AuditLog` type
(`apps/admin/lib/api/types.ts:170-182`) SHALL represent a customer actor so the
compliance view can render it. Admin rows SHALL render identically to today.

#### Scenario: Frontend type represents a customer actor

- GIVEN the `apps/admin` `AuditLog` type after the change
- WHEN a customer-actor row is consumed by the compliance view
- THEN the customer actor is representable (e.g. via `actorType` + customer identity) without breaking existing admin fields

#### Scenario: Admin rows render unchanged

- GIVEN an admin-actor audit row
- WHEN the admin compliance view renders it
- THEN it renders identically to the current behavior (no visual or field regression)

---

## Verification note (strict TDD — RED→GREEN)

Stats/getLogs scenarios are **vitest** unit tests in `apps/api/tests/unit/`; the CSV
and API-shape scenarios that need a real store are **node:test** integration tests
requiring DB + Redis via `pnpm db:up`. Frontend type/render scenarios are **vitest**
component tests with `@testing-library/react`. RED: before A2, customer rows collapse
into the null-user bucket and export blank; admin rendering is the do-not-regress
baseline. GREEN: customers are counted and exported distinctly while admin output is
byte-for-byte unchanged. LXC: run a single test file, heap-capped
(`--max-old-space-size`), under a `timeout` wrapper. New/changed code carries tests +
JSDoc `@file/@description/@layer` (fitness #9/#10).
