# Archive Report: post-persistence-adapter-relocation

**Archived**: 2026-09-17 · **Store**: openspec · **Branch of this archive step**: `workstream/reloc-archive` (off `main @ ef776753`)

## Summary

Relocates the four Post persistence adapters — `PrismaPostRepository`, `PostAggregateMapper`,
`PrismaOutboxWriter` and `PrismaUnitOfWork` — out of `apps/api/src/infrastructure/{repositories,
repositories/mappers,outbox,unitofwork}/` into `packages/adapters/db-prisma/src/{post,outbox,
unitofwork}/`, exported through the package's root specifier `@adapters/db-prisma`. Tenant scope,
previously read from an ambient `apps/api` accessor (`getAmbientGucScope`), is now derived from a
`TenantContextProvider` injected through each adapter's constructor. The relocation declares no
product surface, no user-visible behaviour, no business rule and no API contract change — it is a
pure boundary move, made necessary because N-COR-8 (`post-publish-partial-failure`) needs its
publish worker (`apps/workers`) to reach the `Post` aggregate root, and an `apps/workers` composition
root cannot import from `apps/api` without inverting the hexagonal dependency direction. This
change is N-COR-8 design D1's own named prerequisite: "the four Post persistence adapters move to
`packages/adapters/db-prisma` so the worker can reach the aggregate root."

## Change identity

- Full name: `post-persistence-adapter-relocation` — prerequisite of Master Plan item `N-COR-8`
  (`post-publish-partial-failure`, design D1), not itself a numbered Master Plan dashboard row
- Store: openspec
- Branch: `workstream/post-persistence-adapter-relocation`
- Base at pre-propose: `main` @ `f2668717`, W1 committed as `44a1b121` (an earlier object
  `ad8b7992` was superseded when the branch was rebased; its relocation source is identical)
- PR #263, merged as `ef776753` on 2026-09-17, 7 commits: `f903fe19` plan, `44a1b121` W1,
  `daa4e80c` W2, `304dce68` W3, `ba81380b` W4, `724a29d0` W5, `7bf9f7d6` verify report

## Gates

- **Explore** — inline PASS.
- **Proposal** — inline PASS.
- **Spec** — inline PASS, 8 requirements / 25 scenarios, all merge-blocking.
- **Design** — rev 1.1, fresh-context gate PASS WITH WARNINGS, corrections C1–C4 applied.
- **Tasks** — inline PASS, 41 tasks (22 W1 + 19 W2–W5), corrections C5–C9 measured at tasks time.
- **Apply** — fresh-context gate PASS WITH WARNINGS; the whole-workspace build was re-run by the
  orchestrator after the apply gate, 86/86 tasks green.
- **RDD (receipt-driven review)** — lineage `review-c29331e372a104bf`, canonical 4R fan-out
  approved and acknowledged, 10 advisory findings.
- **Verify** — `pass_with_warnings`, 8/8 requirements, 25/25 scenarios, 0 blockers, 0 critical
  findings, admitted natively with `evidence_revision:
sha256:8b6a4d5e7f0fe0c9c8311bfc833063b6dfbb59bc3ec34c37cfe0455496c548ad`.

## Measured budget

67 files, +2978/−278 against `main`: code 25 files (+99/−72), tests 29 files (+484/−163), gates 2
files (+124/−33), docs 5 files (+22/−10), SDD artefacts 2249 lines. Delivery decision: single PR,
five work-unit commits (W1 → W2 → W3 → W4 → W5). Under the two-tier budget instrument (CODE 400
hard / EVIDENCE pre-approved with one decision per change, recorded in the tasks-phase forecast):
CODE ≈ 171, EVIDENCE ≈ 836 — both within the tasks-time forecast's tolerance (CODE ≈ 209 forecast
against the 400 hard limit; EVIDENCE ≈ 747 forecast, pre-approved by the single two-tier decision
in `tasks.md`'s Review Workload Forecast). No chained PRs; `size:exception` was not invoked because
the two-tier convention retired per-PR exceptions in favour of the forecast-time decision.

## Coverage before/after

Measured by the apply phase (T1.21), config restored byte-exact after measurement (`cmp` clean,
sha256 match):

| Metric     | BEFORE | AFTER | Literal | Verdict          |
| ---------- | ------ | ----- | ------- | ---------------- |
| lines      | 59.58  | 59.37 | 56.8    | clears by 2.57pp |
| functions  | 59.95  | 59.68 | 57.3    | clears by 2.38pp |
| branches   | 49.88  | 49.77 | 47.8    | clears by 1.97pp |
| statements | 59.01  | 58.81 | 56.2    | clears by 2.61pp |

Every AFTER value clears its literal; no literal was lowered; no `canon-exception` marker was
added. The `autoUpdate` raise (to 59.2 / 59.5 / 49.6 / 58.7) that a coverage run would have
committed was measured and left unshipped (backlog row, below).

## What the change amended in N-COR-8 D1

N-COR-8's own design (`post-publish-partial-failure/design.md`, read-only from this change) named
this relocation as its prerequisite but got several details wrong, corrected by this change's
apply and carried forward in `tasks.md`'s "Handoff to N-COR-8" section for PR 1b to consume:

- Both constructors take the tenant provider as a **REQUIRED** parameter, not optional —
  `PrismaUnitOfWork(prisma, tenantProvider, options?)` and `PrismaPostRepository(prisma,
outboxWriter, tenantProvider)`. Options stay positional, third, on the Unit of Work.
- Fitness #23's pre-existing Unit-of-Work exception was **inert** before this change (its regex
  is anchored on `(` and the line it names is a tagged template, so it had never matched) — this
  change re-paths it to the new location and documents the inertness explicitly rather than
  silently relocating a piece of fiction.
- Fitness #40 Part B's second scope is the **three relocated subdirectories**
  (`packages/adapters/db-prisma/src/{post,outbox,unitofwork}`), not the package root — the six
  flat db-prisma seam sites (`PrismaMentionRepository.ts`, `PrismaProjectRepository.ts` (flat
  variant), `PostRepository.ts`) pass explicit scopes by design and stay outside Part B (design
  C4).
- The mapper (`PostAggregateMapper.ts`) landed **flat** at `packages/adapters/db-prisma/src/post/`,
  not nested under a `post/mappers/` directory as D1 and the original `tasks.md` T1.5 named — this
  is the path N-COR-8's own design already assumes at two other read sites (correction C10,
  confirmed and not reverted).

## Warnings carried and where they landed

The verify report (`verify-report.md`) recorded findings W1–W5 and S1–S2, all non-blocking. W1–W3
and S1–S2 are **discharged by this archive step's amendments** (below); W4 and W5 are genuine
residuals carried to backlog.

- **W1** (stale `pnpm format:check` note) — reworded in `apply-progress.md`: the note now states
  the repo-root check is clean at HEAD and that the cited directory no longer exists in this tree.
- **W2** (stale empty-`mappers/`-directory note) — reworded in `apply-progress.md`: the directory
  no longer exists at HEAD because git does not track empty directories.
- **W3** (ledger names a superseded W1 sha) — the `apply-progress.md` header now names base
  `main @ f2668717` and the shipped W1 commit `44a1b121`, with the superseded `ad8b7992` object
  noted; the uncounted 2-line `@file` header edit in `hardDeleteSerializableRace.test.ts` is now
  also noted at its T1.17 evidence cell.
- **W4** (pre-existing nullable outbox writer) — carried to backlog, below. Not introduced by this
  change; the change made the slot's optionality explicit (an optional parameter cannot precede a
  required one) but did not create it.
- **W5** (environmental, not this candidate's) — the four integration failures the verifier
  observed were the pg_catalog RLS coverage gate reacting to migration
  `20260917093257_add_post_channel_publication` from the foreign N-COR-8 PR 1b branch on the
  shared dev database; this tree neither defines the table nor enrols the model. No amendment
  needed — recorded here for traceability only.
- **S1** (`@example` wording imprecision in spec R6) — amended: `specs/post-persistence-adapter-
boundary/spec.md` now names the exact injected-provider constructor call `new
PrismaUnitOfWork(prisma, tenantProvider)` with the third, optional, transaction-options
  parameter stated explicitly, promoted byte-identical to `openspec/specs/`.
- **S2** (`run-tests.sh` cwd trap) — amended: both quotations in `apply-progress.md` now read
  `cd apps/api && TIER=pr-integration bash scripts/run-tests.sh`; `tasks.md`'s Verification table
  now carries an explicit warning that a direct invocation from the repo root collects zero tests
  and exits 1.

## Backlog rows owed

- **Nullable outbox writer (W4).** `PrismaPostRepository` accepts `outboxWriter: OutboxWriter |
undefined`; an adapter constructed without a writer drops domain events silently. Pre-existing;
  this change made the slot's optionality explicit but did not introduce the gap.
- **`PostAggregateMapper.toDomain` raw throw.** Named in the change's own explore/design chain as
  a residual outside this relocation's scope; not touched here.
- **depcruise scope excludes `packages/adapters`.** The dependency-cruiser boundary check does not
  yet reach the relocated package; named as backlog B5 in `design.md` / `tasks.md`.
- **Relocating the three unit suites into db-prisma** with a measured stryker mutation threshold —
  the suites for the four adapters stay in `apps/api/tests/unit/` for now (backlog B7), importing
  the root specifier, as `PrismaMentionRepository.test.ts` already does.
- **The inert `sagaTenant.ts` term in fitness #40 Part A** and **the inert #23 Unit-of-Work
  exception** — both are documented as inert rather than deleted; deletion of either is an
  authorisation, not a technical decision, and needs Edward's sign-off (backlog B1 / B2–B3, tied
  to SMELL-111's eventual closure).
- **The guards doc's dated 2026-07-27 blockquote count** in `docs/security/MULTI_TENANT_GUARDS.md`
  ("Seven live statements in `apps/api/src` are invisible to the check today") predates this
  relocation, which moved two of those statements out of `apps/api/src`. Left byte-exact as a
  dated finding (correction C12); SMELL-111's eventual closure should re-measure it rather than
  trust it.
- **The unshipped coverage `autoUpdate` raise** (59.2 / 59.5 / 49.6 / 58.7) — measured, restored,
  not committed.
- **`packages/providers/_template`** is not compiled by any project reference; unrelated
  pre-existing observation carried from the apply phase's honesty notes, not acted on here.
- **`tsc -b` cache hits** — plain `tsc -b` was observed skipping `apps/api` from `.tsbuildinfo`
  during verification; use `--force` when this package pair needs fresh compiler evidence.

## Model attribution

- `sdd-explore` / `sdd-spec` / `sdd-tasks` / `sdd-apply` / `sdd-verify`: Opus 5 (1M context window)
- `sdd-propose` / `sdd-design`: Fable 5.1
- `sdd-archive` (this report): Sonnet 5
- Review/gate delegations: Opus 5

## Successors

- **N-COR-8** `post-publish-partial-failure` consumes the new paths — already in flight on branch
  `workstream/ncor8-1b` (PR 1b), which bases on this change's shipped commit set and inherits the
  amended constructor contracts, the extended fitness #23/#40 scopes, and the flat mapper location
  recorded above.
