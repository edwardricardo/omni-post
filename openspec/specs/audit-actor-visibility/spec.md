# Audit Actor Visibility — Specification

> Living specification for the **audit-actor-visibility** capability:
> customer actors are surfaced everywhere admin actors are read — logs, stats
> / top-actors, the CSV export, the API response shape, and the
> `apps/admin` compliance frontend — while every existing admin-facing read
> stays byte-identical to before this capability shipped.
>
> Source of truth: change `audit-actor-polymorphism` (ADR-0020), PR A2
> (`35d44f4f`, base: A1 `3242147a`). Design detail:
> `openspec/changes/archive/audit-actor-polymorphism/design.md` (Decision 5).
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each
> requirement carries Given/When/Then acceptance scenarios. The admin
> do-not-regress guarantee is marked **[MERGE-BLOCKING]** — any change to
> these read surfaces MUST re-prove admin output is byte-identical before it
> can land; it is not a suggestion, it is the acceptance criterion that gated
> A2, and it freezes the admin row shape/bytes going forward.

---

## Requirements

### Requirement: Customer actors are visible in logs and stats

`AuditService.getLogs` / `getStats` and `AuditLogger.getStatistics` surface
customer actors. Stats and top-actors do not bucket all customer-actor rows
into a single null-user bucket; a customer actor is counted and identifiable
distinctly from system rows (which also carry `userId == null`).

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

### Requirement: Admin stats and getLogs output is byte-identical **[MERGE-BLOCKING]**

The pre-existing admin `groupBy`, `adminUser.findMany`, and `topUsers`
construction in `getStats` / `getStatistics` are untouched; customer
visibility is additive (`topCustomerUsers`, `byActorType`) and appended after
the admin computation, never interleaved with it.

#### Scenario: Admin topUsers is unchanged by adding customer visibility

- GIVEN the same admin-actor audit rows as before this capability shipped
- WHEN `getStats` / `getStatistics` are computed after this capability shipped
- THEN `topUsers` (count, ordering, shape) is identical to the pre-change output

---

### Requirement: CSV export carries the customer actor identity

The CSV export includes a customer action's actor identity. The
pre-existing `"user.email"` column stays in place; new columns append the
actor type and customer identity for rows that are not admin-attributed.

#### Scenario: Customer row exports a non-blank actor

- GIVEN a customer-actor audit row
- WHEN the CSV export is generated
- THEN the exported row carries the customer actor's identity (not a blank cell)

#### Scenario: Non-admin actor columns never fabricate a value

- GIVEN a SYSTEM or CUSTOMER audit row exported to CSV
- WHEN a column has no resolvable value for that actor type
- THEN the cell renders empty, never the literal string `"undefined"` or `"null"`

---

### Requirement: Admin row exports identically to before this capability shipped **[MERGE-BLOCKING]**

An admin-actor row's exported bytes — every pre-existing column, in the same
order, with the same values — are unchanged. This is the do-not-regress
guarantee that bounds every future change to the export: a fix that would
alter an admin row's bytes needs a spec amendment, not a patch inside this
capability.

#### Scenario: Admin row export is a byte-identical prefix of the pre-change row

- GIVEN an admin-actor audit row
- WHEN the CSV export is generated
- THEN its bytes for every pre-existing column are identical to the pre-change export, in the same column order

---

### Requirement: API response and admin frontend type expose the actor

The audit API response shape and the `apps/admin` frontend `AuditLog` type
represent a customer actor (via `actorType` plus customer identity fields) so
the compliance view can render it.

#### Scenario: Frontend type represents a customer actor

- GIVEN the `apps/admin` `AuditLog` type
- WHEN a customer-actor row is consumed by the compliance view
- THEN the customer actor is representable via `actorType` + customer identity, without breaking existing admin fields

---

### Requirement: Admin rows render identically in the compliance view **[MERGE-BLOCKING]**

An admin-actor row renders identically to before this capability shipped —
same fields, same markup, no new badge or visual element on an admin row.
Any actor badge or visual marker introduced for one actor type MUST NOT alter
what an admin row renders; if a future change wants to badge every actor
type (including ADMIN), it is a spec amendment to this requirement, not a
patch.

#### Scenario: Admin row renders unchanged

- GIVEN an admin-actor audit row
- WHEN the admin compliance view renders it
- THEN it renders identically to the current behavior (no visual or field regression)

#### Scenario: A customer-only visual marker never touches an admin row

- GIVEN a visual marker (e.g. an actor badge) that is guarded by `actorType === CUSTOMER`
- WHEN an admin-actor row is rendered
- THEN the admin row cannot enter that guarded branch and gains no new markup

---

## How to extend

1. **Any change to `getStats`/`getStatistics`/CSV export/the compliance
   view** MUST re-prove the two MERGE-BLOCKING admin-byte-identical
   requirements above before merging — treat them as a regression test, not
   a formality.
2. **Fixing the legacy CSV columns that stringify absent optionals to
   `"null"`/`"undefined"`** (`Error`, `Resource`, `Resource ID`, `IP
Address`, `User Agent`) is explicitly OUT of this capability's guarantee:
   those columns are part of the byte-frozen pre-change set, and blanking
   them WOULD change admin row bytes. Fixing them requires an explicit
   amendment to the "Admin row exports identically" requirement above
   (relaxing the freeze on those five columns specifically), not a silent
   patch.
3. **Badging every actor type (including ADMIN) in the compliance view** is
   rejected as-is for the same reason — it would change the admin row's
   rendered markup. It needs the same kind of explicit amendment to the
   "Admin rows render identically" requirement before it can land.
4. **Amending a MERGE-BLOCKING requirement** — requires an ADR (amend
   ADR-0020 or a follow-up ADR referencing it).

Companion capability: `audit-actor-attribution` (the schema) and
`customer-audit-write-path` (the writes this capability reads). Companion
audit trail:
`openspec/changes/archive/audit-actor-polymorphism/design.md` (Decision 5),
`verify-report.md` (A2 section — byte-parity proof at source, in emitted CSV
bytes, and against a real database).
