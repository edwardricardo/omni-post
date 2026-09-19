# Archive Report: post-publish-status-integrity (N-COR-1)

**Archived**: 2026-09-16 · **Store**: openspec · **Branch of this archive step**: `workstream/ncor1-close` (off `main @ f2668717`)

## Summary

Closes the defect where a total-success publish-now saga reported `COMPLETED` while the `Post`
aggregate stayed `DRAFT`. The fix wires the previously-dead aggregate promotion path
(`startPublishing()` / `markAsPublished()`) through a new synchronous use case that runs inside a
single Result-aware Unit-of-Work transaction, replacing the silent drop that let the terminal status
transition disappear when routed through the content-only `post.update` command.

## Change identity

- Full name: `post-publish-status-integrity` — Master Plan dashboard ID `N-COR-1` (`docs/product/MASTER_PLAN_ES.md §1.B`)
- Store: openspec
- Branch chain: `workstream/post-publish-status-integrity` (PR1) → `workstream/post-publish-status-integrity-pr2` (PR2+PR3 folded)
- Base at pre-propose: `main @ 31e2a2ad`

## The defect (explore.md, re-verified by the proposer and the verifier)

`UpdatePostStatusStep` (`packages/shared/src/saga.ts:865-946`) routed the terminal status transition
through the content-only `post.update` command; its handler discarded `status`/`publishedAt`
(`apps/api/src/cqrs/handlers/PostCommandHandlers.ts:220-234`). The provider had published, the
database denied it, and both re-publish guards (`SagaIntegration.ts:428`,
`PostCommandHandlers.ts:362`) keyed off a status that never advanced — a silent double-publish path.
`startPublishing()` / `markAsPublished()` were correct and dead (zero production callers) before
this change.

## The fix, by PR

- **PR1 (#259, merged `main @ 8887a02a`)** — additive `UnitOfWork.executeResultInTransaction` port
  member (ADR-0023) + `PrismaUnitOfWork` implementation via a private sentinel thrown inside the
  existing `$transaction` (no second `$transaction` call — fitness #40 Part A). 52 test-double files
  / 53 definition sites swept, measured shape-agnostically after the original colon-regex gate was
  caught blind to method-shorthand and property-shorthand doubles. `ARCHITECTURE_CANON.md §Unit of
Work` extended with the Result-aware second shape; fitness #4's remove-when closed in both
  `CLAUDE.md` and `.github/workflows/fitness.yml` mirrors. Zero behaviour change — no caller invokes
  the new member yet.
- **PR2+PR3, folded into one PR (#261, merged `main @ f2668717`, 10 commits `b562d36b`→`dec8938e`
  over PR1's merge point `8887a02a`)**:
  - **PR2 scope** — `CompletePostPublishingUseCase` (`packages/core/posts`) as the single writer:
    load once, `startPublishing()` then `markAsPublished()`, save once inside
    `executeResultInTransaction`, honouring OCC (`expectedVersion`, idempotent-answer check resolved
    BEFORE the version comparison), refusing non-total and unknowable outcomes fail-closed. New
    `post.complete-publishing` command + Zod schema (`.strict()`) + CQRS handler + DI token and
    registration. Additive only — nothing emits the command yet, so the defect was still live at
    this PR's own tip.
  - **PR3 scope — the defect closes here.** `UpdatePostStatusStep` rewritten as a thin forwarder
    emitting `post.complete-publishing` with the per-channel outcome, fail-closed on every D1
    precondition; `status` removed from `UpdatePostCommandSchema` + `.strict()` added (the
    sole-producer claim was re-verified against the tree BEFORE the deletion, per R6);
    `PostPublishingStarted` decided to stay INTERNAL — deleted from `INTEGRATION_EVENT_NAMES` with
    the reason recorded in a code comment and the PR body (counterfactual timing: the hop runs after
    the provider already published; best-effort `Promise.allSettled` fan-out with no per-subscription
    retry cannot guarantee "never started without published" across two independently delivered
    outbox rows). Merge-blocking integration proof `sagaPublishNowPromotion.test.ts` on an engine
    harness with the real `PrismaPostRepository` + real `OutboxWriter`, wired into exactly one
    `run_batch` (`integration:saga-recovery`, per fitness #30). Three lock-in tests rewritten so they
    stop enshrining the defect (the fabricated-version assertion, the no-op-success assertion, the
    deterministic-id double that returned success for a command the handler drops).
  - **Verify corrective** (uncommitted at first verify, landed in the same PR at `7db12c39`) closed
    two proof gaps the first verify pass found (a redelivered-completion re-entry case for R4, a
    stale-token-then-recovery case for R5) plus the cross-tenant write-isolation assertion for R8.

## Verification

- `verify-report.md` rev 2 (superseding rev 1's FAIL on 2 CRITICAL — both proof gaps, closed by the
  corrective and re-verified by the verifier's own runs, not by reading the corrective's claims):
  **PASS WITH WARNINGS**, 0 CRITICAL / 3 WARNING / 5 SUGGESTION, **10/10 requirements, 32/32
  scenarios**. Admitted via `sdd-verify-validate`,
  `evidence_revision: sha256:0156d6b63b7606e232a10de513c9f037b4ca346b0ee178e571c56c129ed339b3`.
  Bound to that revision by commit `dec8938e` ("bind the N-COR-1 verify report to its settled native
  evidence revision").
- RDD (receipt-driven review) lineages recorded across the change: `review-8d2897f4f4b800e2`,
  `review-7e9d26bef4e4ed10` (canonical 4R fan-out), `review-9e27b151a42d24d8`. Gatekeeper verdicts
  PASS-WITH-WARNINGS with bounded correctives on both PR2 (work unit WU4-C: findings W1/W2/W3/S2/S4)
  and PR3.
- Gates run directly by the verifier in this phase, all green: unit (api, 6 touched suites / 79
  tests), unit (`packages/core/posts`, 2 files / 27 tests), integration (`integration:saga-recovery`,
  **33/33 pass, 0 fail / 0 cancelled / 0 skipped**), typecheck (api + core/posts, direct `tsc`),
  lint (`--max-warnings 0`), format (`prettier --check`). Fitness #2/#3/#4/#8/#9/#10/#32/#40A/#40B
  measured at 0; #30 measured **20** against the 21 baseline (not risen).

## Budget (measured against `origin/main`)

**CODE 855 / EVIDENCE ~3,822.** The ratified two-tier stop for this change was 2,000 (EVIDENCE); the
overshoot was reported rather than trimmed, and Edward accepted it on 2026-09-16. The recorded
lesson is a forecasting-method error, the third instance of this project's "measure the forecast,
don't trust the analogy" pattern (after the MFA and analytics-route-port-integrity closures): PR2's
use-case estimate (~240 lines) was extrapolated from a sibling use case carrying one guard, and
undershot a six-guard ordered chain with two-way `save()` narrowing by roughly 40%; PR3's ~155
CODE / ~710 EVIDENCE forecast was extrapolated from sibling suites instead of sized file by file —
the integration harness, the six scenarios, the `sagaDeterministicIds` rewrite that D1's nine
independent preconditions forced to 275 lines, and two lock-in-test rewrites were never separately
counted.

`verify-report.md` records the pre-report-commit measurement as CODE 855 (unchanged by the
test-only corrective) / EVIDENCE 3,404 (2,990 committed + 414 corrective); the verify report itself
adds ~418 further lines once committed. The orchestrator's launch figures (CODE 855 / EVIDENCE
~3,822) are used above as the final-state authority per the archive phase's ranking rules and are
consistent with the verify-report's own trajectory.

## Warnings carried at close (verify-report.md)

- **W2** — R2's `[static]` scenario needed the PR body to exist as its own artefact; discharged by
  PR #261 actually opening and merging.
- **W4** — the review budget was breached on both axes (see Budget above); accepted by Edward.
- **W6 / SMELL-121** — the promotion decrypts channel credentials it never reads
  (`CompletePostPublishingUseCase.resolveProviders` → `ChannelRepository.findById` → full aggregate
  reconstitution + decrypt) to reach one field (`provider.type`); an undecryptable envelope THROWS
  past the unresolved-channel path D7 designed for exactly this case, which can block a promotion
  whose publish genuinely completed — this change's own defect, observable through another door.
  Deferred: the sound fix is a credential-free provider-resolution port method with its own adapter
  and tests.

## Residuals (backlog rows, all landed in `docs/reports/roadmap-detected-smells-backlog.md` pre-archive)

| Row       | Subject                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| SMELL-119 | `UpdatePostCommandHandler` fabricates and projects a hardcoded `version: 2` to external subscribers              |
| SMELL-120 | content-update command still accepts and silently drops `mediaIds`                                               |
| SMELL-121 | the promotion's credential-decrypt throw path (see W6 above)                                                     |
| SMELL-122 | `post.update` now has zero production producers while its handler stays registered and wired                     |
| SMELL-123 | `PublishPostCommandHandler` naming promises a transition its body never performs                                 |
| SMELL-124 | 8 TypeScript diagnostics in `PostCommandHandlers.update.test.ts`, invisible to any typecheck program in the repo |

Plus the D10 residual named in `design.md` §Residuals (not a backlog row, a stated trade): with the
transaction now aborting on a returned `err`, a deterministic JS-side save failure fails the saga
post-pivot, leaving the post `DRAFT` while the provider holds it — the correct trade (a wrongly
committed state is worse than a visible failure), not a defect.

## Signed decisions honoured (`pre-propose-decisions.md` Q1–Q5, all confirmed YES by verify)

- **Q1** — synchronous command from the saga step; the `PostPublished` event is an effect in the
  same transaction, never the mechanism that sets status.
- **Q2** — no schema migration (verified: the diff restricted to the Prisma infrastructure tree is
  empty).
- **Q3** — no backfill (omni-post has no production environment; forward-only fix).
- **Q4** — two-hop `DRAFT → PUBLISHING → PUBLISHED` in one Unit of Work; no FSM amendment, no ADR for
  the state machine itself.
- **Q5** — partial-failure policy split out to its own successor change; `markAsFailed()` stays
  unwired until it lands.

## Successors

- **`post-publish-partial-failure`** — this change's own Q5 split. In planning as of this archive:
  `openspec/changes/post-publish-partial-failure/` exists (untracked in git status at archive time).
  Owns the product decision of what status a post takes when N channels publish and M fail.
  **Naming collision, recorded rather than silently propagated:** this change's own artifacts
  (`proposal.md`, `design.md` D8, `pre-propose-decisions.md` Q5) refer to that successor internally
  as "N-COR-2" — but `docs/product/MASTER_PLAN_ES.md` already has a `N-COR-2` on its dashboard (saga
  in-flight recovery, closed by `saga-tenant-scope-and-recovery`, PRs #173/#180, unrelated). The
  Master Plan edits made by this archive step do NOT introduce a second `N-COR-2`; the successor is
  referenced there by its OpenSpec change name (`post-publish-partial-failure`) only.
- The orchestrator's launch instructions for this archive additionally named "N-COR-3 webhook-driven
  post status" and "N-COR-4 thread retraction" as successors of this change. **These labels do not
  appear in any artifact read for this archive** (`explore.md`, `proposal.md`, `design.md`,
  `pre-propose-decisions.md`, `tasks.md`, `verify-report.md`, `apply-progress.md`) — recorded here
  for traceability of the instruction, but not independently verified against the change's own
  artifact set. Like the `N-COR-2` label above, both would also collide with `MASTER_PLAN_ES.md`'s
  pre-existing, unrelated `N-COR-3` (client publishing broken) and `N-COR-4` (billing dunning dead).
  No Master Plan edit asserts either as a confirmed successor of this change.
- **Resolution at close (orchestrator, 2026-09-16):** the collision was the orchestrator's — the labels
  were coined without checking the Master Plan sequence. The successors now carry the next free numbers
  and their OpenSpec names: **N-COR-8** `post-publish-partial-failure` (this change's Q5 split; its
  planning artifacts were renamed accordingly), **N-COR-9** webhook-driven post status (the five
  processors' direct `prisma.post.update({status:"PUBLISHED"})`, unguarded — today the only path that
  promotes a SCHEDULED post at all, since the publish saga skips schedule mode), **N-COR-10** thread
  atomicity: retraction (no provider port exposes delete/unpublish; only the X, Telegram and YouTube
  API clients carry an internal delete). Two further named dependencies of N-COR-8 have no number
  yet: the prerequisite change `post-persistence-adapter-relocation` (the four Post persistence
  adapters move to `packages/adapters/db-prisma` so the worker can reach the aggregate root) and an
  SMS notification channel (does not exist in the tree). The Master Plan §1.B rows for N-COR-8/9/10
  were added in the same close commit.
- SMELL-119..124 (see Residuals) — each is its own future slice with a named owner and remedy already
  recorded in `docs/reports/roadmap-detected-smells-backlog.md`.

## Model attribution

- `sdd-propose` / `sdd-design`: Fable 5.1 (project pin, `.claude/agents/sdd-*.md` frontmatter)
- `sdd-explore` / `sdd-spec` / `sdd-tasks` / `sdd-apply` / `sdd-verify`: Opus 5 (1M context window)
- `sdd-archive` (this report): Sonnet 5

## Artifacts promoted / archived by this phase

- Spec promoted byte-for-byte: `openspec/specs/post-publish-status-promotion/spec.md` (new
  capability — 416 lines, matching the source at
  `openspec/changes/archive/post-publish-status-integrity/specs/post-publish-status-promotion/spec.md`
  line for line; no shell/`diff -r` was available to this executor, so the promotion was performed
  by reading the source file fully and writing its exact content — the same pattern this project used
  for `password-reset-integrity` and `analytics-route-port-integrity`).
- Change folder was already relocated by the orchestrator (via git) to
  `openspec/changes/archive/post-publish-status-integrity/` before this phase started (`explore.md`,
  `pre-propose-decisions.md`, `proposal.md`, `design.md`, `tasks.md`, `apply-progress.md`,
  `verify-report.md`, `specs/post-publish-status-promotion/spec.md`). This archive-report.md is
  additive to that folder.
- `docs/product/MASTER_PLAN_ES.md`: N-COR-1 marked `[x]` and closed in §1.B (item bullet + N.B
  dashboard count 2→3, Total Nivelación 4→5), a `[COR]` closure ficha added to the running
  cluster-closure log, §6 unified dashboard row updated (Hechas 4→5 + closure note).
- `docs/architecture/NORMALIZATION_ROADMAP.md`: read in full (583 lines) — no reference to N-COR-1,
  `post-publish-status-integrity`, or `publish-now` exists in this file. That roadmap's own changelog
  (2026-07-21 entry) states that N-SEC-_/N-COR-_ nivelación items are tracked in
  `MASTER_PLAN_ES.md §1`, not in this roadmap. **Not edited** — no item existed to close.
- `docs/reports/roadmap-detected-smells-backlog.md`: read the SMELL-119..124 rows (all already
  correctly attributed to `post-publish-status-integrity apply`/`verify` and marked `PENDING` with a
  named remedy). No row anywhere references N-COR-1 or this change as "in flight" needing closure.
  **Not edited.**

## Tasks completion (Task Completion Gate)

58/58 `[x]` in `tasks.md`, confirmed independently by `verify-report.md` ("Task completion: 58 of 58
`[x]`, 0 unchecked"). No stale unchecked checkboxes. No explicit "archive" / "promote spec" checklist
item exists in `tasks.md` itself — the closing instruction lived in `verify-report.md`'s `## Next`
pointer ("`sdd-archive`, once W2 is discharged"), which this report discharges now that PR #261 has
opened and merged.
