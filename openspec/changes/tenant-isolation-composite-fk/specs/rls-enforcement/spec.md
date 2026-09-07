# RLS Enforcement — Delta Spec (tenant-isolation-composite-fk / Slice 0 + Transversal)

> **NEW capability** for change `tenant-isolation-composite-fk`. Capability: **Row Level
> Security actually ENFORCES — the app's database role cannot bypass it, a wrong-tenant read
> returns zero rows, a normal read still index-scans, and coverage is audited from
> `pg_catalog` rather than assumed.**
>
> **This capability is the demonstrated RED of the whole area.** Measured today: the app
> connects as `postgres`, which carries `BYPASSRLS`, and `FORCE ROW LEVEL SECURITY` appears
> **zero** times in the entire migration tree. The living `multi-tenant-isolation` spec
> already records the same fact for `Channel` ("Leg 3/RLS is INERT deployment-wide today").
> So the zero-rows proof below is **expected to FAIL on the unmodified deployment**, and
> that failure is not an embarrassment to route around — it is the red this area has never
> had, and every later requirement in this change is built on top of it. Per repo canon
> (`CLAUDE.md` §Automated Compliance Checks, step 3 of the extension protocol), a gate whose
> red was never demonstrated does not merge.
>
> **Slice 0 is a BLOCKING precondition.** Nothing else in this change merges until the
> zero-rows proof is GREEN. If it stays red, fixing enforcement becomes the work — in order.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** gate the PR of the slice that owns them.
>
> **Scenario tags.** `[static]` — checkable by inspecting schema, migrations, config, or
> workflow files. `[integration]` — requires a real-DB run; a mocked test CANNOT prove a
> guarantee that lives in the database engine. `[deploy-time]` — enforced by a
> migration/deploy-time assertion that halts rather than by a CI test. `[evidence]` — **new
> tag introduced by this change**: requires a real-DB run whose OUTPUT is recorded as a
> durable artifact; verified by inspecting that artifact and by the recorded command being
> re-runnable. An `[evidence]` requirement is satisfied by capturing the measurement, and it
> FAILS when the measurement is asserted rather than captured.
>
> **Non-goals (from the proposal, restated so they are not re-litigated here):** this
> capability does NOT enroll any model (that is `multi-tenant-isolation`), does NOT add any
> tenant column (that is `tenant-key-integrity`), and does NOT resolve the `AuditLog` guard
> divergence or the ADR-0020 numbering collision.

---

## ADDED Requirements

### Requirement: The application's database role cannot bypass row security, in every environment **[MERGE-BLOCKING]**

For every environment in which RLS-covered tables exist, the role the application connects
with SHALL NOT be able to bypass row security. A role bypasses row security in three ways,
and ALL THREE SHALL be closed:

1. **Role attribute** — the role SHALL NOT carry `BYPASSRLS`.
2. **Superuser** — the role SHALL NOT be `SUPERUSER`.
3. **Table ownership** — a table's owner is exempt from its own policies unless the table
   carries `FORCE ROW LEVEL SECURITY`. Therefore, for every RLS-covered table, EITHER the
   app role SHALL NOT own the table, OR the table SHALL carry `FORCE ROW LEVEL SECURITY`.

The audit SHALL be performed and RECORDED **per environment** (dev, test, CI, staging,
production as applicable) — a single-environment result SHALL NOT be generalized to the
others, because the connection role is deployment configuration, not schema. The chosen
remedy (non-owner role vs `FORCE ROW LEVEL SECURITY`) SHALL be recorded as a decision with
its reason, because the two have different operational consequences for migrations.

#### Scenario: the role posture is audited and recorded per environment [static]

- **GIVEN** the change is applied
- **WHEN** the recorded role audit is inspected
- **THEN** it names, for EACH environment, the connecting role and whether it carries `BYPASSRLS`, is `SUPERUSER`, and owns the RLS-covered tables — and no environment is left unmeasured or inferred from another

#### Scenario: no bypass path survives on a covered table [integration]

- **GIVEN** an RLS-covered table and the role the application actually connects with
- **WHEN** the role's attributes and the table's `relrowsecurity` / `relforcerowsecurity` / owner are read from `pg_catalog`
- **THEN** the role has neither `BYPASSRLS` nor `SUPERUSER`, and it either does not own the table or the table has `FORCE ROW LEVEL SECURITY` enabled

#### Scenario: the remedy choice is a recorded decision, not an accident [static]

- **GIVEN** the role posture has been corrected
- **WHEN** the decision record is inspected
- **THEN** it states which remedy was taken (non-owner role or `FORCE ROW LEVEL SECURITY`) and why, and the migration tree reflects that choice — it is NOT left to whichever happened to be true in one environment

---

### Requirement: A wrong-tenant read returns zero rows — and its failure today is the demonstrated red **[MERGE-BLOCKING]**

Querying an RLS-covered model **as the application's role** with the WRONG tenant bound in
`app.account_id` SHALL return **zero rows**. This is the proof that decides whether RLS
enforces anything at all; every other claim in this change rests on it.

**The red is mandatory, and it comes first.** The proof SHALL first be executed against the
CURRENT deployment posture (`postgres`, `BYPASSRLS`, no `FORCE ROW LEVEL SECURITY`) and
SHALL be observed to **FAIL** — returning the other tenant's rows. That failing run SHALL be
captured as a durable artifact BEFORE any remediation, so the gate is one that has been seen
to fail rather than one that has only been seen to pass. A proof that is written after the
posture is corrected, and therefore never observed red, does NOT satisfy this requirement.

#### Scenario: the proof FAILS on the unmodified deployment — the demonstrated red [integration]

- **GIVEN** the deployment as it exists today: the app connects as a role carrying `BYPASSRLS`, and no covered table carries `FORCE ROW LEVEL SECURITY`
- **WHEN** an RLS-covered model is queried as that role with `app.account_id` bound to tenant B while tenant A's rows exist
- **THEN** rows ARE returned, the proof FAILS, and that failing output is captured as the recorded red for this area — RLS is confirmed to be decoration under the current posture

#### Scenario: the proof PASSES once the role posture is corrected [integration]

- **GIVEN** the role posture requirement above is satisfied (no `BYPASSRLS`, no `SUPERUSER`, non-owner or `FORCE ROW LEVEL SECURITY`)
- **WHEN** the same query runs as the application's role with the WRONG tenant bound
- **THEN** it returns **zero rows** — not a filtered subset, not an error that could be mistaken for success

#### Scenario: the proof is tenant-symmetric, so it cannot pass by an empty fixture [integration]

- **GIVEN** rows exist for BOTH tenant A and tenant B on the covered model
- **WHEN** the read runs once with A bound and once with B bound
- **THEN** each run returns ONLY its own tenant's rows and a non-zero count for them — a zero-rows result caused by an empty table SHALL NOT be accepted as the proof

---

### Requirement: Slice 0 blocks the rest of the change until the zero-rows proof is green **[MERGE-BLOCKING]**

The zero-rows proof is a **precondition**, not a parallel workstream. No slice of this change
that depends on RLS as an enforcement layer SHALL merge while the proof is red. Concretely:
the composite-FK trio slice, the keyless-model triage, and the transversal query contract
SHALL NOT be presented as delivering data-layer isolation until the proof is green, because a
policy on a bypassable role protects nothing.

The composite foreign key of `tenant-key-integrity` is the ONE guarantee explicitly exempt
from this dependency — referential integrity checks always bypass row security, so the FK
holds regardless of RLS configuration. That exemption SHALL be stated wherever the two are
reported together, so the FK's independence is not read as RLS being fixed.

#### Scenario: dependent slices do not merge on a red proof [static]

- **GIVEN** the zero-rows proof is still failing
- **WHEN** a slice that claims data-layer tenant isolation is proposed for merge
- **THEN** it is blocked, and the blocking reason names the red proof — the slice SHALL NOT merge with the gap recorded as a follow-up

#### Scenario: the FK's independence from RLS is stated, not implied [static]

- **GIVEN** the change reports both the composite-FK guarantee and the RLS posture
- **WHEN** that report is inspected
- **THEN** it states explicitly that the composite FK is enforced independently of RLS configuration, and does NOT let the FK's strength stand in for RLS being enforced

---

### Requirement: RLS does not degrade a normal read to a sequential scan **[MERGE-BLOCKING]**

A policy that silently turns index scans into sequential scans is a performance regression
nobody notices until load. For an RLS-covered model, a normal tenant-scoped read SHALL be
shown by `EXPLAIN ANALYZE` to use an **index scan on a tenant-leading index**, and that plan
SHALL be captured as a durable artifact — not asserted.

If the captured plan shows a sequential scan instead, that result SHALL be RECORDED as a
finding and adjudicated (index added, policy reshaped, or accepted with a stated reason). It
SHALL NOT be silently accepted, and it SHALL NOT be omitted from the artifact because it was
inconvenient.

#### Scenario: the baseline plan is captured, whatever it says [evidence]

- **GIVEN** the RLS role posture is corrected and a covered model holds representative data
- **WHEN** a normal tenant-scoped read is run under `EXPLAIN ANALYZE`
- **THEN** the full plan is recorded as an artifact together with the exact query and the data shape it ran against, and the recorded command is re-runnable

#### Scenario: a sequential scan is a recorded finding, not a silent pass [evidence]

- **GIVEN** the captured plan shows a sequential scan rather than an index scan on a tenant-leading index
- **WHEN** the evidence is reported
- **THEN** the regression is named explicitly with its adjudication (fix, reshape, or accept-with-reason) — the artifact SHALL NOT report only the plans that came out favorable

---

### Requirement: RLS coverage is audited from `pg_catalog`, and PARTIAL coverage fails **[MERGE-BLOCKING]**

A gate that asks "is RLS on?" misses the failure mode that actually happens: coverage that is
present on one axis and absent on another. A new coverage gate SHALL audit
`pg_class.relrowsecurity`, `pg_class.relforcerowsecurity`, table ownership, and `pg_policy`,
and SHALL treat a tenant-owned table as COVERED only when ALL of the following hold:

1. `relrowsecurity` is **true**; **and**
2. at least one `pg_policy` row exists for the table; **and**
3. the app role does not own the table, **or** `relforcerowsecurity` is true.

The gate SHALL fail on each of the three named partial-coverage states, and its failure
message SHALL distinguish them, because they fail in opposite directions:

| Partial state                                                | Direction  | Why it must be named separately                                                       |
| ------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------- |
| Policy exists, `relrowsecurity` false                        | **Leaks**  | The policy is inert; the table is fully readable while the schema reads as protected. |
| `relrowsecurity` true, zero policies                         | **Denies** | PostgreSQL default-denies for non-owners; the table breaks rather than leaks.         |
| Enabled + policy, but app role owns the table and no `FORCE` | **Leaks**  | The owner is exempt from its own policies — the exact posture measured today.         |

The gate's mechanism SHALL be the **INTEGRATION tier**, not a fitness grep: the invariant is
DATABASE state — `pg_class.relrowsecurity` cannot be read by a grep, and the fitness workflow
runs no Postgres service. The gate SHALL be a real-DB suite wired into
`apps/api/scripts/run-tests.sh` (fitness #30's reachability rule — a suite no `run_batch`
names never executes) and SHALL run on every PR in the Integration Tests job against the
migrated Postgres service. The **red-proof obligation is retained in full**: each violation
SHALL be planted in the database, the suite observed to FAIL with a real non-zero exit — a
log line or annotation alone leaves the job green and proves nothing — and the planted state
restored and the suite re-confirmed green. The "mirrored verbatim" obligation re-frames onto
the integration suite: the check CI runs IS the documented suite itself, never a paraphrase
of it, and `CLAUDE.md` §Automated Compliance Checks SHALL gain a pointer note naming this
integration-tier gate so the gate inventory stays complete — a note, not a workflow step.

#### Scenario: each partial-coverage state is caught and named [integration]

- **GIVEN** a table is placed in each of the three partial states in turn
- **WHEN** the coverage gate runs
- **THEN** it FAILS in every case, and its message names WHICH state was found — a single generic "RLS not covered" message does not satisfy this

#### Scenario: the gate's red is demonstrated before it merges [integration]

- **GIVEN** the coverage gate is being added
- **WHEN** each of the three partial-coverage states is planted in the database in turn and the suite is run
- **THEN** every planted state produces a real non-zero suite exit (not merely a log line or annotation), the database state is restored and the suite re-confirmed green — and this demonstration is recorded

#### Scenario: the gate is wired, reachable, and pointed to [static]

- **GIVEN** the gate suite exists
- **WHEN** `apps/api/scripts/run-tests.sh`, the Integration Tests job, and `CLAUDE.md` are inspected
- **THEN** the suite file is named in a `run_batch` (a suite no batch names never executes and SHALL NOT be counted as the gate), the Integration Tests job runs that suite on every PR against a real Postgres, and `CLAUDE.md` §Automated Compliance Checks carries the pointer note naming this integration-tier gate

#### Scenario: a fully covered table passes [integration]

- **GIVEN** a tenant-owned table with `relrowsecurity` true, at least one policy, and either a non-owner app role or `relforcerowsecurity` true
- **WHEN** the coverage gate runs
- **THEN** the table is reported COVERED and the gate exits zero

---

### Requirement: The tenant scope is bound for EVERY application statement — request-scoped, not transaction-only **[MERGE-BLOCKING]**

> **Added by the Slice 0d addendum (2026-09-07), on a measured red.** PR3's two-channel
> measurement (ADR-0022 §Runtime cutover) ran the same 18-suite batch under both roles:
> `postgres` 177/177, `omnipost_app` 170/177 with exit 1. Every failure is the application:
> `app.account_id` is bound only inside `PrismaUnitOfWork.executeInTransaction` (and the saga
> equivalent), so every statement issued OUTSIDE a unit of work runs with the GUC unset and
> RLS fails closed against the app itself. This requirement's red therefore already exists on
> the record; it SHALL NOT be re-manufactured, only re-run.

The application SHALL bind `app.account_id` for every statement it issues against RLS-covered
tables, whether or not a unit of work is open. The binding SHALL derive from the SAME context
source as the layer-1 guard — one provider, no second source of tenant truth. Processes with
no ambient request (queue workers, the saga engine, bootstrap consumers of the raw client)
SHALL bind explicitly per read/write scope; a tenant-DISCOVERY read MAY bind the `__system__`
sentinel only with a narrow column selection and an in-file justification. A flow holding
neither a tenant nor a declared system scope SHALL fail loudly on any guard-enrolled model —
never a silent superuser fallback, and never a silently empty result standing in for an
error. Once this requirement is green, `DATABASE_URL` SHALL NOT name a role that can bypass
row security in any application surface; the owner channel survives ONLY as
`MIGRATE_DATABASE_URL` plus the named seed factory in the test harness.

#### Scenario: an out-of-transaction read resolves under the app role [integration]

- **GIVEN** a tenant context bound at request scope and a real connection as the app role
- **WHEN** a repository read OUTSIDE any unit of work resolves ownership through a JOIN into an RLS-covered parent (the `findOwnerAccountId` shape that produced the measured failures)
- **THEN** the owner's row is returned — not a null-join `500`, and not a zero-row `404` for the owner's own data

#### Scenario: binding never breaks transactional atomicity — unit-of-work or repository-opened [integration]

- **GIVEN** the bound client and an open transaction — an `executeInTransaction` unit of work OR a repository-opened `$transaction` (the UoW-aware fallback arms)
- **WHEN** a statement runs inside that transaction
- **THEN** it executes on the transaction's OWN connection with the GUC bound at most once — proven by a write followed by a forced failure rolling back TOGETHER, exercised on BOTH shapes: the unit of work, and a repository-opened create whose nested write is forced to fail; a write that survives the rollback demonstrates an operation escaped onto a second connection and FAILS this scenario

#### Scenario: no-context stays loud [integration]

- **GIVEN** neither a TenantContext nor a SystemContext is bound
- **WHEN** a guard-enrolled model is queried on the application's client
- **THEN** the call throws (the `TenantContextMissingError` class) — a silent zero-row success SHALL NOT be accepted

#### Scenario: the two channels reach parity, and only then does the flip land [evidence]

- **GIVEN** request-scoped binding has landed
- **WHEN** the two-channel batch measurement from ADR-0022 §Runtime cutover is re-run — same files, same concurrency, only the role differing — together with the full integration tier and CI's worker readiness gate under the app-role URL
- **THEN** both channels report the identical full pass count with exit 0, the result (including wall time per channel) is recorded in the ADR replacing the blocked table, and ONLY then does `DATABASE_URL` flip to the app role in `.env`, `.env.test`, and ci.yml

#### Scenario: the owner channel is named, singular, and not the application's [static]

- **GIVEN** the flip has landed
- **WHEN** the environment surfaces are inspected
- **THEN** `DATABASE_URL` names the app role in every application surface, `MIGRATE_DATABASE_URL` and the harness seed factory that resolves it are the ONLY owner-channel consumers, and no application code path constructs a connection from the owner channel
