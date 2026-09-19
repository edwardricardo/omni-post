# Post Persistence Adapter Boundary — Spec (post-persistence-adapter-relocation)

> **NEW capability** for change `post-persistence-adapter-relocation`. Capability: **the four Post
> persistence adapters — aggregate hydration, the version CAS + outbox write, and the GUC-bound
> transaction — live in `@adapters/db-prisma`, are reachable from ANY composition root through the
> package root specifier, take their tenant scope from an INJECTED provider instead of an ambient
> `apps/api` accessor, leave `apps/api` behaviour identical, and stay covered at their new location by
> every guard that watched them at the old one.**
>
> **Why the boundary is the whole subject.** The proposal declares **no product surface, no
> user-visible behaviour, no business rule and no API contract change** — this is a pure relocation.
> Its deliverable value is therefore a BOUNDARY CONTRACT, and that is what this file states.
> Requirements are of two kinds: **preservation invariants** (what must NOT change, which is what
> makes "`apps/api` behaviour identical" checkable rather than merely asserted) and **boundary rules**
> (what makes the new location durable). N-COR-8 D1 is the consumer: it "assumes this exists after
> it" and bases PR 1b on the contract below.
>
> **Contents: 8 requirements, 25 scenarios.** All 8 are **[MERGE-BLOCKING]**.
>
> **Scenario tags.** `[static]` — decidable by inspecting source or by a named gate's measured count;
> every `[static]` scenario names the exact gate or command and the expected number. `[integration]` —
> decidable by a named suite against real Postgres/Redis (`pnpm db:up`, LXC-safe single-file runs).
> `[unit]` — vitest with doubles of the ports, never of the unit under test.
>
> **Measured baselines this file pins** (taken on the unmodified tree at base `main` @ `c23ec2c8`, so a
> later reading is comparable rather than merely plausible): fitness #40 Part A `SEAM_HITS` = 3 /
> `COUNT` = 0; #40 Part B `SITES` = 13 against floor 10; #23 = 0; #3 = 0; #5 = 0; #38 swept-tree 0 and
> `DBPRISMA` 11; `apps/api` unit coverage **lines 59.58 / functions 59.95 / branches 49.88 /
> statements 59.01** against the #37 literals 56.8 / 57.3 / 47.8 / 56.2; `tenantTransactionNesting`
> walk population 16 against a non-vacuity floor of 8.

---

## Requirements

### Requirement: The four adapters live in `@adapters/db-prisma` and are consumed ONLY through the root specifier **[MERGE-BLOCKING]**

`PrismaPostRepository`, `PostAggregateMapper`, `PrismaOutboxWriter` and `PrismaUnitOfWork` SHALL live
under `packages/adapters/db-prisma/src/{post,outbox,unitofwork}/` and SHALL be exported from the
package barrel `packages/adapters/db-prisma/src/index.ts`.

Every consumer — `apps/api`, its tests, and any future composition root including `apps/workers` —
SHALL import them through the ROOT specifier `@adapters/db-prisma`. **A subpath specifier SHALL NOT
exist anywhere in the tree.** This is not style: `tsconfig.base.json` maps `@adapters/db-prisma` ROOT
ONLY (no `/*` wildcard, unlike every `@core/*` entry) under `moduleResolution: bundler` with no
`customConditions`, so a subpath falls through `paths` onto the package's `default` export condition
(`./dist/*`) and breaks exactly the dev/test/CI source-resolution mode ADR-0017 §1c and fitness #27
exist to protect. The root-specifier rule is also what guarantees the single `AsyncLocalStorage`
asserted further below — one module identity, never a src/dist pair.

The barrel SHALL distinguish, in writing, the pre-existing `@ports/core` DTO factory
`createPostRepository` from the newly exported `@core/domain` aggregate adapter `PrismaPostRepository`.
Two names one letter apart in one barrel is where the confusion lands, so the disambiguation is part
of the contract rather than a courtesy.

#### Scenario: the four resolve from the package root [static]

- **GIVEN** the change is applied
- **WHEN** every consumer of the four adapters is enumerated in `apps/` and `packages/`
- **THEN** each imports them from the bare specifier `@adapters/db-prisma`, and each of the four is named in the package barrel's export list

#### Scenario: zero subpath imports exist [static]

- **GIVEN** the change is applied
- **WHEN** `rg '@adapters/db-prisma/' apps packages` is run
- **THEN** the match count is **0**

#### Scenario: both consumers typecheck and build against the relocated package [static]

- **GIVEN** the change is applied
- **WHEN** `tsc -b apps/api packages/adapters/db-prisma` and `pnpm build` are run
- **THEN** both exit 0 with no error and no warning, proving the barrel resolves in the source mode AND through the built `dist`

---

### Requirement: Tenant scope is DERIVED from an INJECTED provider, and no relocated file reaches into `apps/api` **[MERGE-BLOCKING]**

Each relocated adapter that binds a tenant scope SHALL obtain it from a `TenantContextProvider`
supplied through its constructor, resolved via `resolveGucScope(provider)`. **No relocated file SHALL
import anything from `apps/api`** — an adapter package that reaches back into an application is the
app-to-app source dependency the hexagonal canon forbids and the reason this relocation exists.

`apps/api` behaviour SHALL be IDENTICAL afterwards. The API composition root SHALL inject
`ambientTenantContextProvider` — the SAME object the retired ambient accessor already read — so the
identity is by construction, not by coincidence. In particular, a call made under
`withSystemContext()` SHALL still resolve to the `__system__` scope: the system-context path is the
one place where an ambient→injected seam could change what the transaction binds, so it is asserted
explicitly rather than assumed to ride along.

The proof SHALL be the EXISTING behaviour suites running green with **no assertion edit** — specifier
and constructor edits only. A suite whose assertions were adjusted to the new arrangement proves
nothing about preservation.

#### Scenario: no relocated file imports `apps/api` [static]

- **GIVEN** the change is applied
- **WHEN** `packages/adapters/db-prisma/src` is searched for `apps/api` and for `../../security/tenantContext`
- **THEN** the match count is **0** for both

#### Scenario: the ambient accessor is gone from the packages tree [static]

- **GIVEN** the change is applied
- **WHEN** `rg getAmbientGucScope packages/` is run
- **THEN** the match count is **0** — every relocated scope derivation goes through the injected provider

#### Scenario: the GUC binding and tenant isolation are unchanged [integration]

- **GIVEN** the change is applied and the API composition root injects `ambientTenantContextProvider`
- **WHEN** `tenantGucTransactionBinding.test.ts` and `post-trio-tenant-isolation.test.ts` are run
- **THEN** both are green, and their diff against base contains only import-specifier and constructor-argument edits — **no assertion change**

#### Scenario: a system-context call still binds `__system__` [integration]

- **GIVEN** a write performed under `withSystemContext()` through a relocated adapter
- **WHEN** the scope bound at the start of its transaction is observed
- **THEN** it is `__system__`, identical to the pre-change binding

---

### Requirement: The constructor contract keeps options POSITIONAL and makes the tenant provider REQUIRED **[MERGE-BLOCKING]**

`PrismaUnitOfWork` SHALL take `(prisma, tenantProvider, options?)` — the transaction options stay the
THIRD positional parameter. Taken in the two-parameter shape, the existing positional call sites would
silently hand `HARD_DELETE_TX_OPTIONS` to the provider slot on the **Serializable hard-delete path**;
the ordering is therefore load-bearing, not cosmetic, and `HARD_DELETE_TX_OPTIONS` semantics SHALL be
preserved byte-for-byte in effect.

`PrismaPostRepository` SHALL take `(prisma, outboxWriter, tenantProvider)` with `tenantProvider`
**REQUIRED**. A construction that omits it SHALL be a TYPE ERROR — never a silently unscoped adapter.
An adapter that binds no tenant and says nothing is the fail-open shape this repository's whole
isolation stack exists to prevent, so the constructions that break are planned breaks, updated on
purpose.

#### Scenario: the Serializable hard-delete path still gets its options [integration]

- **GIVEN** the hard-delete use case constructed with its transaction options in the third position
- **WHEN** `hardDeleteSerializableRace.test.ts` is run
- **THEN** it is green, and the transaction still runs at the isolation level and timeout those options name

#### Scenario: omitting the tenant provider does not compile [static]

- **GIVEN** the change is applied
- **WHEN** a `PrismaPostRepository` construction without a tenant provider is attempted
- **THEN** `tsc` rejects it, and no runtime path can produce an adapter with no scope source

#### Scenario: every construction site was updated deliberately [static]

- **GIVEN** the change is applied
- **WHEN** every construction of the two classes in `apps/` and `packages/` is enumerated
- **THEN** each passes a tenant provider explicitly, and each site that previously passed options positionally still does so in the third position

---

### Requirement: There is EXACTLY ONE transaction-context storage per process **[MERGE-BLOCKING]**

`PrismaUnitOfWork.getTransactionClient()` SHALL remain STATIC, and the `AsyncLocalStorage` that backs
it SHALL be instantiated exactly ONCE per process. Every repository that participates in an active
Unit of Work — those still in `apps/api/src` and the relocated one alike — SHALL observe the SAME
transaction client.

Two storages would not fail loudly: a repository resolving a second module instance would simply see
no active transaction, open its own connection, and write outside the caller's transaction and outside
its GUC binding. The invariant is therefore stated as an observable property of the running process,
not as a note about module layout.

#### Scenario: a relocated and a non-relocated repository share one transaction client [unit]

- **GIVEN** a Unit of Work transaction in flight
- **WHEN** a repository still living in `apps/api/src` and the relocated `PrismaPostRepository` each resolve the active transaction client
- **THEN** both receive the SAME client instance, and neither opens a transaction of its own

#### Scenario: the static accessor survives the move for its existing callers [static]

- **GIVEN** the change is applied
- **WHEN** the callers of `PrismaUnitOfWork.getTransactionClient()` are enumerated
- **THEN** every one still calls it statically through the root specifier, and none was rewritten to an instance form

---

### Requirement: Every guard that watched these files FOLLOWS them **[MERGE-BLOCKING]**

A relocation that leaves the guards behind nets NEGATIVE coverage: three `withGucBoundTransaction`
sites, a `set_config` statement and a nesting adjudication all leave the gates that watch them while
every counter still reads 0. That is the **"dead scope = infallible gate"** class `CLAUDE.md` opens by
naming, and this change is the cheapest moment to prevent it.

Therefore: fitness **#40 Part A**'s `TX_SEAMS` SHALL name the relocated Unit of Work's new path;
**#40 Part B**'s site scope SHALL include the three relocated subdirectories
`packages/adapters/db-prisma/src/{post,outbox,unitofwork}` (NOT the package root: the six flat
db-prisma seam sites pass explicit scopes by design and stay outside Part B — design C4), every seam
call there SHALL derive its scope from the injected provider through a SINGLE greppable token (the
design names the token), the population SHALL be RE-MEASURED and the floor RE-SET with margin greater
than zero;
**#23**'s scope SHALL include `packages/adapters/db-prisma/src` with the relocated Unit of Work
exception RE-PATHED and documented as INERT until SMELL-111 closes; **#3** and **#5** SHALL name the
new directory; and `tenantTransactionNesting.test.ts` SHALL adjudicate the relocated repository, with
its walk covering the new directory and its non-vacuity floor re-measured.

The re-pathed #23 exception SHALL carry an honest comment: its regex is anchored on `(` and the line
it names is a tagged template, so it has NEVER matched. Carrying it silently would move a piece of
fiction to a new address. No exception SHALL be added for `resilience.ts` — a second inert line is the
SOLO GORDO class, and it is named in the #23 comment block as a site SMELL-111's closure must enrol.

`CLAUDE.md` and `.github/workflows/fitness.yml` SHALL stay BYTE-IDENTICAL in the grep expressions and
code lines ("paste, don't paraphrase"; the surrounding shell plumbing and comments already differ today),
and **every edited gate SHALL ship with a demonstrated red path**: plant the violation, observe a REAL
non-zero exit, restore the tree byte-exact (verified by checksum), re-confirm the count. A gate whose
red path was never demonstrated does not merge.

Guards that need NO edit SHALL be RE-MEASURED rather than assumed — "it still passes" is a claim about
a number nobody read.

#### Scenario: #40 Part A holds at the new seam path [static]

- **GIVEN** the change is applied
- **WHEN** fitness #40 Part A is run
- **THEN** `SEAM_HITS` is **3** (meeting its floor) and `COUNT` is **0**, with the seam term naming the relocated Unit of Work

#### Scenario: #40 Part B covers the relocated sites with margin [static]

- **GIVEN** the change is applied
- **WHEN** fitness #40 Part B is run
- **THEN** `BCOUNT` is **0**, the measured `SITES` population includes the relocated seam calls, the floor is set below that population (margin > 0), and every relocated site derives its scope through the one admitted derived token

#### Scenario: #23 can now see a raw query in the relocated Unit of Work [static]

- **GIVEN** a paren-form `$queryRawUnsafe(` planted in the relocated Unit of Work
- **WHEN** fitness #23 is run under the OLD scope and then under the NEW scope
- **THEN** the old scope reports **0** (proving the dead scope) and the new scope reports **1**; after byte-exact restore the count is **0**

#### Scenario: #3 and #5 cover the new directory [static]

- **GIVEN** an `as any` and a `@ts-ignore` planted in the relocated files
- **WHEN** fitness #3 and #5 are run
- **THEN** each reports a non-zero count; after byte-exact restore both report **0**

#### Scenario: the nesting adjudication reaches the relocated repository [unit]

- **GIVEN** the change is applied
- **WHEN** `tenantTransactionNesting.test.ts` is run
- **THEN** it is green, its walk includes `packages/adapters/db-prisma/src`, the relocated repository's seam calls are adjudicated, and its non-vacuity floor equals the re-measured population — the `ENOENT` failure and the silent population shrink are BOTH closed

#### Scenario: the guard pair stays byte-identical and each edit has a proven red [static]

- **GIVEN** the change is applied
- **WHEN** the edited blocks in `CLAUDE.md` and `.github/workflows/fitness.yml` are compared, and each edited gate's red path is replayed
- **THEN** the blocks are byte-identical, and each edited gate exits NON-ZERO with its violation planted and reports its expected count after a checksum-verified restore

#### Scenario: the unedited guards are re-measured, not assumed [static]

- **GIVEN** the change is applied
- **WHEN** fitness #38 is run
- **THEN** the swept-tree count is **0** and the `db-prisma` ratchet count is **11** — unchanged from the baseline, and both numbers recorded rather than inferred

---

### Requirement: The move is REVIEWABLE as a rename, and the relocated comments are ENGLISH **[MERGE-BLOCKING]**

The relocation SHALL be recorded as a git RENAME, with content edits in the move commit kept surgical
so rename detection survives. A move that reads as a 1 431-line add/delete is not reviewable, and an
unreviewable diff is how a behavioural edit rides into a change that promised none.

Translating the relocated comments to English SHALL be a SEPARATE commit, strictly AFTER the move, for
the same reason. Afterwards, all comments in the four relocated files SHALL be in English
(`CODING_STANDARDS.md §Comment Quality Rules`), and the Unit of Work's `@example` SHALL show the
injected-provider constructor call `new PrismaUnitOfWork(prisma, tenantProvider)` (the third
parameter, the transaction options, is optional) — a doc comment that lies is worse than none.

#### Scenario: the four files are renames, not rewrites [static]

- **GIVEN** the change is applied
- **WHEN** the move commit is inspected with rename detection enabled
- **THEN** each of the four files is reported as a rename, and the translation commit is a later, separate commit

#### Scenario: no Spanish comment survives in the relocated files [static]

- **GIVEN** the change is applied
- **WHEN** the four relocated files are searched case-insensitively for Spanish-accented characters (`[áéíóúñ¿¡]`) on comment lines
- **THEN** the match count is **0**, and the reviewer additionally confirms the unaccented Spanish blocks the explore enumerated are translated — the grep is a floor, not the whole proof

---

### Requirement: The coverage ratchet is NOT weakened by hand **[MERGE-BLOCKING]**

Relocating 1 431 lines out of `apps/api`'s coverage `include` shifts the aggregate in a direction no
one can know without running it. The four #37 literals SHALL NOT be lowered by hand, and the BEFORE /
AFTER measurement SHALL be recorded in the PR body so the shift is a number on the record rather than
a claim.

If the aggregate descends below a literal, the change SHALL STOP and escalate. It SHALL NOT invent a
`canon-exception` scenario — `{migration, prototype, hotfix, spike, test-fixture}` contains nothing
that honestly describes a relocation — and SHALL NOT neutralise the ratchet. Adding a scenario to that
allowed list is an ADR-level canon amendment and belongs to a human.

#### Scenario: #37 measures zero with the literals untouched [static]

- **GIVEN** the change is applied
- **WHEN** fitness #37 is run against the PR base
- **THEN** it reports **0**, and none of the four literals (56.8 / 57.3 / 47.8 / 56.2) is lower than on base

#### Scenario: the before/after coverage is recorded, and a descent escalates [static]

- **GIVEN** the BEFORE measurement lines 59.58 / functions 59.95 / branches 49.88 / statements 59.01
- **WHEN** `pnpm --filter @apps/api test:unit:coverage` is run after the relocation and both numbers are placed in the PR body
- **THEN** either every AFTER value still clears its literal, or the change stops and escalates with both numbers — and in no case is a `canon-exception` marker added to a lowered literal

---

### Requirement: The docs NAME the new paths, and the dated measurement record is not rewritten **[MERGE-BLOCKING]**

`ADR-0023`, `ADR-0014`, `ADR-0005` and `docs/security/MULTI_TENANT_GUARDS.md` SHALL name the relocated
paths. Two of those citations are STALE TODAY — they name directories that do not exist — and this
change is the natural moment to close that rot rather than move past it.

`docs/reports/TENANT_RLS_AB_MEASUREMENT.md` SHALL NOT have its citations rewritten. It is a DATED
measurement record; rewriting its source citations would falsify what was measured and when. A dated
note naming the relocation is the most that SHALL be added.

#### Scenario: no doc still names an old adapter path [static]

- **GIVEN** the change is applied
- **WHEN** `docs/technical/` and `docs/security/` are searched for the four old paths under `apps/api/src/infrastructure/{repositories,repositories/mappers,outbox,unitofwork}/`
- **THEN** the match count is **0**, with `docs/reports/TENANT_RLS_AB_MEASUREMENT.md` outside the searched scope by design

#### Scenario: the dated measurement record keeps its citations [static]

- **GIVEN** the change is applied
- **WHEN** `docs/reports/TENANT_RLS_AB_MEASUREMENT.md` is diffed against base
- **THEN** every existing line-level citation is unchanged, and the diff is either empty or a single dated note naming the relocation

---

## Non-goals (explicit statements, NOT requirements)

These are stated so a later reader cannot mistake their absence for an oversight. None of them is a
requirement of this capability, and none is satisfied by this change.

| #   | Not in this capability                                                                                                                                                                    | Owner                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1   | Publication-record logic, `PostChannelPublication`, any schema or migration                                                                                                               | N-COR-8 `post-publish-partial-failure` |
| 2   | Worker composition-root wiring — `apps/workers/src/container/workerContainer.ts` stays `workerPrisma` only, and `git diff main -- apps/workers/src/container/workerContainer.ts` is EMPTY | N-COR-8 D2                             |
| 3   | Splitting the 903-line `PrismaPostRepository` into its write-side adapter and a `PrismaPostQueryRepository`                                                                               | backlog B6                             |
| 4   | Relocating the three unit suites out of `apps/api/tests/unit/` — they stay, importing the root specifier, as `PrismaMentionRepository.test.ts` already does                               | follow-up B7                           |
| 5   | Moving `tenantTransaction.ts` — the API-side ambient wrapper stays in `apps/api`                                                                                                          | —                                      |
| 6   | Widening the depcruise scope, #5's one-level `packages/*/src` glob, or closing SMELL-111's tagged-template blindness                                                                      | backlog B5, B8, B2/B3                  |

---

## Verification note (strict TDD — RED → GREEN)

Every **[MERGE-BLOCKING]** requirement is RED on the unmodified tree, and the dangerous reds fail by
REPORTING THE WRONG THING rather than by crashing — which is why each names its gate and its expected
number instead of "the gate passes".

Three reds are worth naming because a careless apply would read them as green: (a) #40 Part A breaks
TWICE on the move — a scope-error `exit 1` from `SEAM_HITS` 2 < 3 AND `COUNT` 1 — so its seam re-path
rides in the SAME commit as the move; (b) #23 under the old scope reports **0** over a planted
`$queryRawUnsafe(` in the relocated file, which is the dead scope proving itself; (c)
`tenantTransactionNesting.test.ts` fails LOUDLY on an `ENOENT` while its walk population shrinks
SILENTLY from 16 to 15 over a floor of 8 — fixing only the loud half satisfies CI and quietly retires
the guard, so both halves are asserted.

Integration scenarios need DB + Redis via `pnpm db:up` and, on LXC, run as heap-capped single files
under a `timeout` wrapper. The behaviour suites named above MUST be green with import-specifier and
constructor-argument edits only; an assertion edit in any of them invalidates the preservation claim
they exist to prove. `pnpm lint --max-warnings 0`, `pnpm format:check`, `madge --circular` and
`pnpm --filter @adapters/db-prisma test` all end at 0 error / 0 warning.
