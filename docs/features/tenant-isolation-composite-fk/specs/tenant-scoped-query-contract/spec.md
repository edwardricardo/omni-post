# Tenant-Scoped Query Contract — Delta Spec (tenant-isolation-composite-fk / Transversal)

> **NEW capability** for change `tenant-isolation-composite-fk`. Capability: **the tenant is
> a REQUIRED, non-nullable argument of every collection query — an unscoped collection query
> is INEXPRESSIBLE, not merely detectable.**
>
> **Why "inexpressible" is the whole point.** The alternative this replaces is detection, and
> detection has a measured ceiling: the best available IDOR-detection tooling tops out at
> **59.9% recall at 57.5% precision**, and this repo's fitness checks are regexes, well below
> that. A grep can prove that an ownership call _exists_; it cannot prove the call is
> _correct_, and it cannot see the route that never called it. A required non-nullable
> argument moves the guarantee from "every use case remembers to check" to "the code does not
> compile without it" — the pattern Buffer ships as `PostsInput.organizationId`.
>
> **This capability is TRANSVERSAL and independent of the storage decision.** It is worth
> doing whichever way A′, B′, or C resolves, and it does not depend on the Slice 0 red being
> cleared. It is also NOT a substitute for the data-layer guarantees: a required argument
> whose VALUE is wrong still queries the wrong tenant, which is why the provenance
> requirement below is not optional.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** gate the PR of the slice that owns them.
>
> **Scenario tags** are as defined in the `rls-enforcement` delta of this change, plus
> `[compile-time]` — **new tag introduced by this delta**: the scenario is proven by the
> TypeScript compiler rejecting a program, which is the only evidence that distinguishes
> "inexpressible" from "conventionally always passed". A runtime test cannot prove
> inexpressibility.
>
> **Non-goals:** this capability does not change which rows a query returns for a correctly
> scoped caller, does not replace the Prisma `$extends` guard or RLS, and does not by itself
> close a point read by ID (its subject is COLLECTION queries — the shape where an omitted
> scope silently returns everything rather than failing).

---

## ADDED Requirements

### Requirement: Every collection query takes the tenant as a required, non-nullable argument **[MERGE-BLOCKING]**

Every collection query in the application query layer — any query whose result is a LIST,
COUNT, or AGGREGATE over rows rather than a single addressed row — SHALL take the tenant as a
**required, non-nullable** parameter of its input type. The parameter SHALL NOT be optional
(`?`), SHALL NOT be nullable, and SHALL NOT carry a default value, because each of the three
restores the exact failure the contract exists to prevent: a call site that omits it and
silently queries across tenants.

An overload, alternate entry point, or convenience wrapper that reaches the same query WITHOUT
the tenant argument SHALL NOT exist — an escape hatch beside a required argument is the
required argument's defeat.

#### Scenario: the input type makes the tenant mandatory [static]

- **GIVEN** a collection query enrolled in this contract
- **WHEN** its input type is inspected
- **THEN** the tenant parameter is present, non-optional, non-nullable, and has no default value

#### Scenario: no unscoped entry point reaches the same query [static]

- **GIVEN** an enrolled collection query
- **WHEN** every exported entry point that reaches it is enumerated
- **THEN** each one requires the tenant argument — no overload, wrapper, or alternate signature reaches the query without it

#### Scenario: a correctly scoped caller behaves exactly as before [integration]

- **GIVEN** a caller that already scopes its reads to its own tenant
- **WHEN** the contract is applied and the caller passes its tenant explicitly
- **THEN** the returned rows are unchanged from before the change — the contract constrains expressibility, not results

---

### Requirement: The contract is enforced by the compiler, not by a grep **[MERGE-BLOCKING]**

The enforcement mechanism SHALL be the **type system**. Deleting the tenant argument from a
call site SHALL fail the build. A fitness regex MAY be added as a secondary signal, but a
regex alone SHALL NOT be accepted as satisfying this capability, because it proves the call
exists rather than that it is correct, and it is blind to the path that never made the call.

#### Scenario: removing the tenant argument fails the build [compile-time]

- **GIVEN** an enrolled collection query and one of its call sites
- **WHEN** the tenant argument is deleted from that call site
- **THEN** `tsc` reports an error and the build FAILS — this is demonstrated by actually planting the deletion, observing the failure, and restoring the tree byte-exact

#### Scenario: widening the argument to optional fails the build [compile-time]

- **GIVEN** an enrolled input type
- **WHEN** the tenant parameter is made optional or nullable
- **THEN** the existing call sites and the query implementation no longer type-check — the tightening cannot be silently undone in one place

#### Scenario: a regex is not accepted as the mechanism [static]

- **GIVEN** the enforcement this change ships
- **WHEN** it is inspected
- **THEN** the primary mechanism is a type-level obligation; any accompanying fitness grep is documented as a secondary signal, and the capability is NOT reported as satisfied by the grep alone

---

### Requirement: The tenant argument is server-derived; a client-supplied value SHALL NOT scope a query **[MERGE-BLOCKING]**

A required argument holding an attacker-chosen value is worse than no argument, because it
reads as a control. The value passed to a collection query SHALL be derived from the
authenticated `TenantContext` (server-side), never from a request body, query string, path
parameter, or header. A client-supplied tenant-looking value SHALL be IGNORED for scoping
purposes.

This restates, for the new contract, the invariant this repo already holds elsewhere (the
living `multi-tenant-isolation` spec's server-derived attribution requirement) — it is applied
here, not invented here.

#### Scenario: a client-supplied tenant value does not scope the query [integration]

- **GIVEN** tenant A is authenticated and the request carries tenant B's identifier in the body or query string
- **WHEN** an enrolled collection query runs
- **THEN** the query is scoped to A's context-derived tenant, ZERO of B's rows are returned, and the client-supplied value has no effect on scoping

#### Scenario: the argument's provenance is the bound context [static]

- **GIVEN** each call site of an enrolled collection query
- **WHEN** the source of its tenant argument is traced
- **THEN** it resolves to the authenticated `TenantContext` (or an explicit `withSystemContext()` wrap with a stated reason) — never to request input

#### Scenario: a system-scoped caller declares itself explicitly [static]

- **GIVEN** a caller that legitimately runs outside a tenant (a scheduler sweep, a global report)
- **WHEN** its call site is inspected
- **THEN** it runs inside an explicit `withSystemContext(reason)` wrap naming why — an unscoped read SHALL NOT be expressed by passing an empty, placeholder, or sentinel tenant value

---

### Requirement: The contract's blast radius is declared and extended slice by slice

The application query layer is large, and a contract asserted over "every collection query"
without a declared boundary is unverifiable. This change SHALL therefore publish an
**enrolled-queries table** — the same extension pattern the living `multi-tenant-isolation`
spec uses for enrolled models — stating exactly which collection queries are under the
contract, and extended by each slice rather than claimed wholesale.

The models this change enrolls at the data layer SHALL have their collection queries enrolled
in this contract in the SAME slice, so the two guarantees do not drift apart. Queries outside
the declared set SHALL be listed as NOT yet enrolled, with the remaining count stated — a
partial rollout reported as complete is the failure mode this table exists to prevent.

**Enrolled collection queries (extended by each slice):**

| Query surface                                           | Slice       | Tenant parameter       | Enforcement  |
| ------------------------------------------------------- | ----------- | ---------------------- | ------------ |
| `Post` / `PostContent` / `PostMedia` collection queries | 1           | Required, non-nullable | Compile-time |
| Remaining application-layer collection queries          | Transversal | Required, non-nullable | Compile-time |

#### Scenario: the enrolled set is explicit and the residual is counted [static]

- **GIVEN** the change is applied
- **WHEN** the enrolled-queries table is compared against the application query layer
- **THEN** every enrolled query appears in the table, every non-enrolled collection query is accounted for as residual with a stated count, and the capability is NOT reported as covering queries it has not reached

#### Scenario: an enrolled model's collection queries land in the same slice [static]

- **GIVEN** a slice that enrolls a model into the data-layer tenant guard
- **WHEN** that slice's diff is inspected
- **THEN** that model's collection queries are enrolled in this contract in the same slice — the data-layer enrollment SHALL NOT ship ahead of its query-layer counterpart

#### Scenario: the residual is a tracked gap, not a silent omission [static]

- **GIVEN** collection queries remain outside the contract when the transversal slice closes
- **WHEN** the change is reported
- **THEN** the residual is documented with its count and filed as a tracked backlog item — it SHALL NOT be dropped from the report to make the coverage read as complete
