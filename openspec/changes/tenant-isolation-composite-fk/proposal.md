# Proposal — Tenant isolation by construction: denormalized `accountId` with composite foreign keys (A′)

Make cross-tenant rows **unwritable by the database engine** for transitively-owned
entities, starting with the product's core trio (`Post` / `PostContent` / `PostMedia`),
by adopting Option **A′**: denormalized `accountId` + composite foreign key over a
unique constraint — after first proving that RLS enforces anything at all. This
formalizes a decision already signed by Edward (master plan, re-confirmed 2026-09-06);
the full research with verbatim-verified sources is
`docs/technical/TENANT_ISOLATION_RESEARCH.md` and this proposal stays within its scope.

- **Change name:** `tenant-isolation-composite-fk`
- **Branch:** `workstream/tenant-isolation`
- **Evidence base:** `docs/technical/TENANT_ISOLATION_RESEARCH.md` (adversarially verified research, decision §5, slicing §6)
- **Relation to canon:** extends ADR-0014 (multi-tenant guards) and ADR-0020 (tenant context at boundaries); replaces neither.

---

## Intent

65 of the schema's models have **no tenant key at all**. For them, tenant reachability
exists only in application code — the caller gate of ADR-0020 plus the incidental fact
that the guarded parent is usually queried first. That is defense by convention, not by
construction, and it is the #1 OWASP API risk (BOLA, prevalence _Widespread_,
exploitability _Easy_). It is also the exact class this repo's own security findings
already hit (`getProjectAccess` et al.), and the exact shape of the 41.7% of confirmed
real-world BOLA cases where authorization is verified on the parent instead of the
mutated object (arXiv:2605.25865). `Post` **is the product** — and it is precisely the
entity neither isolation layer can reach: the Prisma `$extends` guard has no column to
inject, and the RLS policy form cannot even compile without one.

## Problem evidence — measured state, re-verified this session

Counts re-measured against the current `infra/prisma/schema.prisma` (the research's
table was measured at `main @ b2281abc`; main has since moved):

| Metric                                               | Research (b2281abc) | Now (re-verified) | Note                                                                                |
| ---------------------------------------------------- | ------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| Models in `schema.prisma`                            | 124                 | **125**           | `DeletionRecord` landed (deletion workstream slice A)                               |
| With own `accountId`                                 | 59                  | **60**            | 58 enrolled in `TENANT_SCOPED_MODELS` + 2 denylisted (`AuditLog`, `DeletionRecord`) |
| Without any tenant key                               | 65                  | **65**            | unchanged — the subject of this change                                              |
| `FORCE ROW LEVEL SECURITY` occurrences in migrations | 0                   | 0                 | and the app connects as `postgres` with `BYPASSRLS`                                 |

RLS coverage equals column presence, exactly: the accountId-bearing models are the
RLS-covered models. The 65 keyless models are not "pending enrollment" — they are
**unreachable by construction** under the current policy form. And because the app role
carries `BYPASSRLS`, RLS is currently **decoration**: the models we believe covered may
be enforcing nothing. Slice 0 exists to settle that before anything is built on top.

## Decision (signed — not open for re-litigation here)

**Adopt A′: denormalize `accountId` with a composite foreign key over a unique
constraint** — `UNIQUE (id, accountId)` on the parent plus
`FOREIGN KEY (childFk, accountId) REFERENCES parent(id, accountId)` on the child —
explicitly **NOT** composite primary keys. A′ is the only option where the guarantee is
structural: a row whose `accountId` diverges from its parent's cannot be written, the
engine enforces it independently of RLS configuration (referential integrity checks
bypass row security), and every write path that "forgets" fails noisily at INSERT — the
opposite of silent drift. It is the pattern named on pgsql-hackers (Paul Martinez),
supported by a PG15 feature added for it, shipped first-class by Ecto, and it
dissolves — rather than mitigates — the objection that a denormalized column can drift.
Using a unique constraint instead of composite PKs buys the full guarantee without
touching single-column primary keys across 125 models, and the chain propagates
locally: each child references its **immediate parent** including the tenant column
(`PostContent(postId, accountId) → Post(id, accountId)` → anchored in `Project`).

Rejected alternatives (research §4, one line each):

| Option                                      | Why rejected                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A** — denormalize without constraint      | Silent drift undetectable; Postiz (our exact stack) is the live demonstration: belt-and-suspenders double filters plus a call-site where the tenant filter evaporates.                                                                                                               |
| **B** — correlated RLS join policy          | The PostgreSQL manual explicitly prefers the local-column form; nested policy evaluation per candidate row; `READ COMMITTED` race whose official mitigations are unviable on hot paths. Honestly: unmeasured, not measured-and-failed.                                               |
| **B′** — decorrelated set-membership policy | Cheapest to try, scales with parents-per-tenant, but no structural integrity guarantee; **measured opportunistically against A′ in Slice 1** rather than adopted.                                                                                                                    |
| **C** — application-level gate only         | Best available detection tooling tops out at 59.9% recall / 57.5% precision; a fitness grep proves the call exists, not that it is correct; the best runtime version of C (SQL-level enforcement) _requires_ A's column anyway. Its one transferable piece is adopted transversally. |

## Reinforcements landed after the research was written

Main moved from `b2281abc` to `2ed39df5`; three changes strengthen A′'s position:

1. **Fitness #39 now exists**: every accountId-bearing model must be enrolled in
   `TENANT_SCOPED_MODELS` or the documented denylist — each new denormalized column
   gets an **automatic enrollment gate** the day it lands.
2. **ON DELETE actions are adjudicated** for all 173 relations (deletion workstream
   slice A) — the composite-FK rewrite **inherits a decided action per relation**
   instead of opening that question.
3. **Soft delete is live (B1/B2)**: the partial uniques (`WHERE deletedAt IS NULL`) on
   `Account.email` and `Project(accountId, name)` coexist with the **TOTAL**
   `UNIQUE (id, accountId)` A′ needs, and children referencing soft-deleted parents
   keep FK integrity because the rows still exist.

## Capabilities

### New Capabilities

- `rls-enforcement`: proving RLS actually enforces (app role without
  `BYPASSRLS`/ownership, wrong-tenant-returns-zero-rows proof, index-scan proof) plus
  the pg-catalog coverage gate (`pg_class.relrowsecurity` + `pg_policy`), born with its
  red demonstrated.
- `tenant-key-integrity`: the composite-FK structural guarantee — denormalized
  `accountId`, `UNIQUE (id, accountId)` on parents, composite FKs on children,
  FK-violation proof — plus the Buffer-discriminator triage criteria for the 65
  keyless models.
- `tenant-scoped-query-contract`: tenant as a **required, non-nullable argument** of
  every collection query (Buffer's `PostsInput.organizationId` pattern) — unscoped
  queries inexpressible, not merely detectable.

### Modified Capabilities

- `multi-tenant-isolation`: enrollment of `Post`, `PostContent`, `PostMedia` into
  `TENANT_SCOPED_MODELS` + RLS via a NEW structural path (denormalization backed by a
  composite FK, not by application backfill alone) — a requirement-level extension of
  the living enrollment spec.

## Scope

### In scope — the slicing from research §6, kept exactly

| Slice                               | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Slice 0** (blocking precondition) | Prove RLS enforces: audit connection role per environment for `BYPASSRLS`/`SUPERUSER`/table ownership; decide `FORCE ROW LEVEL SECURITY` vs non-owner role; the wrong-tenant-returns-zero-rows proof; the `EXPLAIN ANALYZE` index-scan proof. Known today: the postgres role has `BYPASSRLS`, so this slice is the demonstrated-red of the whole area. Nothing else merges before it.                                                                                                                                               |
| **Slice 1**                         | The `Post`/`PostContent`/`PostMedia` trio end-to-end: Prisma spike for the shared-scalar-in-two-relations question; nullable column + batched backfill from `project.accountId`; `NOT NULL`; `UNIQUE (id, accountId)` on `Project` and `Post`; composite FK as `NOT VALID` then `VALIDATE CONSTRAINT` with `lock_timeout` budgeted; enrollment in `TENANT_SCOPED_MODELS` + RLS policies (local-column form); the FK-violation proof; `EXPLAIN ANALYZE` before/after on hot `Post` listings; the opportunistic A′-vs-B′ measurement. |
| **Slice 2**                         | Triage of the 65 keyless models using Buffer's discriminator (can the entity exist before its container / be orphaned from its ownership path?). Deliverable is the **CLASSIFIED list** — own key needed / covered by composite-FK inheritance / legitimately global — **not a sweep**.                                                                                                                                                                                                                                             |
| **Transversal**                     | The `tenant-scoped-query-contract` capability above, plus the RLS coverage gate auditing `pg_class.relrowsecurity` + `pg_policy` (partial coverage is a named failure mode a "is RLS on?" check misses). Per repo canon, the gate merges only with its red proven.                                                                                                                                                                                                                                                                  |

### Out of scope (non-goals — explicit)

| Item                                | Reason                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Moving a `Project` between accounts | Stays an explicit cascade migration — signed as acceptable; the noisy failure IS the point.                               |
| `AuditLog` guard divergence         | Named in the research; owned by a separate review, not this change.                                                       |
| The ADR-0020 numbering collision    | Out of scope; resolve when the ADR index is next touched.                                                                 |
| Sweeping all 65 keyless models      | Slice 2 delivers the classification only; migration of the classified subset is follow-up work sized by that deliverable. |
| Composite PRIMARY keys              | Explicitly rejected by the signed decision — the unique-constraint form is the whole point.                               |

## Affected areas

| Area                                          | Impact   | Description                                                                    |
| --------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `infra/prisma/schema.prisma` + migrations     | Modified | New columns, uniques, composite relations on the trio; staged migration files. |
| `infra/prisma/src/extensions/tenantGuard.ts`  | Modified | Enroll the trio in `TENANT_SCOPED_MODELS` (fitness #39 forces this).           |
| `docs/security/MULTI_TENANT_GUARDS.md`        | Modified | Enrollment + RLS policy documentation per canon checklist.                     |
| `CLAUDE.md` + `.github/workflows/fitness.yml` | Modified | New RLS coverage gate (regex + mirrored CI step, red proven).                  |
| Application query layer (collection queries)  | Modified | Required non-nullable tenant argument (transversal).                           |
| `apps/api/tests/**`                           | New      | Zero-rows, FK-violation, and coverage-gate tests (strict TDD).                 |

## Risks

| Risk                                                                                                                           | Likelihood   | Mitigation                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma cannot express the shared scalar (`accountId`) in two relations at once                                                 | Med          | Slice 1 opens with the spike; for `Post` the question is dodged by design (only the composite relation to `Project`, no direct `Account` relation) — the spike decides the pattern before any migration is written. |
| Migration locks: adding a FK takes `AccessExclusive` on both tables (GoCardless measured 15 s of API downtime on a collision)  | Med          | `lock_timeout` budgeted, separate transactions, FK added `NOT VALID` then `VALIDATE`, backfill in batches (Citus warns explicitly against single-pass UPDATE).                                                      |
| No published playbook for retrofitting tenant keys across dozens of tables                                                     | High         | That is WHY Slice 2 is a triage, not a sweep — the actionable number is "how many of the 65 are tenant-owned", and computing it is the deliverable.                                                                 |
| Index bloat: tenant-leading indexes on tables whose indexes are all `projectId`-led (`Post` already carries 7 partial indexes) | Med          | Lane's own advice, adopted verbatim: pay for indexes **by demonstration, not in bulk** — the `EXPLAIN ANALYZE` before/after in Slice 1 is that demonstration; PG16 has no skip scan to hide behind.                 |
| RLS is decoration today (`BYPASSRLS`) and A′ gets built on an unenforced boundary                                              | High (known) | Slice 0 is a BLOCKING precondition; the zero-rows proof decides. If it fails, fixing enforcement becomes the work, in order.                                                                                        |
| `MATCH SIMPLE` default: a NULL `projectId` escapes the composite FK                                                            | Low          | Per-table nullability verification is part of each enrollment; the trio's FKs are non-nullable by design.                                                                                                           |

## Rollback plan

Each migration step is individually revertible in reverse order, and the staging makes
every stage safe to stop at: the nullable-column stage carries no app dependency; a
`NOT VALID` FK drops without a table rewrite; `UNIQUE (id, accountId)` drops
independently of the partial uniques; dropping the column reverts the schema fully
(fitness #39 stays green because the bearing column is gone with the enrollment).
Slices merge independently (stacked-to-main), so rollback is per-slice `git revert`
plus the paired down-migration — never a multi-slice untangle.

## Fitness interactions (config rule)

- **#39** — the enforcement partner: every new `accountId` column must enroll or CI
  fails. This change ADDS bearing models; enrollment lands in the same slice.
- **#38** — `post` and `project` are SWEPT soft-delete models; backfill scripts and any
  new reads must carry `deletedAt` discipline or the marker.
- **#23** — backfill/verification SQL must not bypass the tenant guard outside the
  sanctioned exceptions (UoW-wrapped or `withSystemContext()`).
- **New gate** — the RLS coverage check (pg_catalog audit) joins the suite following
  the 4-step extension protocol, red path proven before merge.

## Success criteria

- [ ] **Zero-rows proof**: querying a covered model as the app role with the WRONG
      tenant context returns zero rows (Slice 0 — currently expected to FAIL; that
      failure is the demonstrated red).
- [ ] **FK-violation proof**: inserting a `Post` whose `accountId` mismatches
      `project.accountId` fails with an FK violation (Slice 1).
- [ ] **EXPLAIN ANALYZE evidence**: normal reads still index-scan on a tenant-leading
      index; before/after captured on hot `Post` listings (Slices 0 + 1).
- [ ] **A′-vs-B′ measurement recorded**: point-by-ID, `projectId`-filtered listing, and
      unfiltered listing, on representative data (Slice 1, opportunistic).
- [ ] **Classified list of the 65** delivered with the Buffer discriminator applied per
      model (Slice 2).
- [ ] Coverage gate merged with its red proven; fitness #39 green with the trio
      enrolled; full gate at 0 error / 0 warning.

## Delivery plan

Cached session decisions: **auto-chain**, **stacked-to-main**. Each slice is an
independently reviewable PR that merges green, in dependency order (Slice 0 →
Slice 1 → Slice 2 ∥ Transversal), with every new gate's red demonstrated before its
merge. Strict TDD is active for all apply phases (`openspec/config.yaml`). Slice 1
will very likely exceed the 400-line budget on migrations + schema alone; the
tasks phase forecasts the exact split within the auto-chain strategy.

## Next step

Proceed to `sdd-spec` (requirement scenarios for the three new capabilities + the
`multi-tenant-isolation` delta) and `sdd-design` (migration staging, Prisma relation
shape post-spike, gate implementation) — both may run in parallel off this proposal.
