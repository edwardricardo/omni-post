```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:8b6a4d5e7f0fe0c9c8311bfc833063b6dfbb59bc3ec34c37cfe0455496c548ad
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 8/8
scenarios: 25/25
test_command: "NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @apps/api test"
test_exit_code: 0
test_output_hash: sha256:388534730f2e2a0be5157eed21075b861704f28303ddd0edfbad7b84397b30aa
build_command: "NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc -b --force apps/api packages/adapters/db-prisma"
build_exit_code: 0
build_output_hash: sha256:335425c3810dd74ea3c4e8b629dbbd0ccc233a5b6a1c0bb5a2a0cd0f6886d933
```

# Verification Report — post-persistence-adapter-relocation

**Change**: `post-persistence-adapter-relocation` · **Store**: openspec · **Mode**: Strict TDD ACTIVE
**Candidate**: `workstream/post-persistence-adapter-relocation` at `724a29d0` (6 commits over `origin/main` `f2668717`; PR #263 open, CI 31 checks green plus the 4 chronic Container Security failures), clean tree.
**Inputs**: `specs/post-persistence-adapter-boundary/spec.md` (8 requirements / 25 scenarios, all merge-blocking), `design.md` rev 1.1, `tasks.md` (41/41), `apply-progress.md`, the fresh-context apply gate (PASS WITH WARNINGS), the receipt-driven review (`review-c29331e372a104bf`, approved and acknowledged).
**How this report was produced**: the sdd-verify agent executed every gate and every scenario below and stopped on a Read hook timeout (host unreachable) before writing the file; the orchestrator completed the one remaining scenario (R2.S3) from the same completed run log, settled the native attempt (`evidence_revision` above is the sha256 of the four captured logs: unit tier, forced build, integration tier, fitness suite) and wrote this report from the recorded evidence. Nothing below is inferred from the ledger; every number was produced by a run or an inspection at `724a29d0`.

## Verdict

**PASS WITH WARNINGS.** 8/8 requirements, 25/25 scenarios. No blocker, no critical finding. The warnings are ledger accuracy and one pre-existing nullability; none is a code defect introduced by the change.

## Gates executed

| Gate                    | Command                                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types (real compile)    | `tsc -b --force apps/api packages/adapters/db-prisma`                         | exit 0, zero diagnostics. Plain `tsc -b` also exits 0 but `--dry` showed it skipping `apps/api` from `.tsbuildinfo`, so the forced build is the evidence.                                                                                                                                                                                                                                                                                            |
| Unit tier (api)         | `pnpm --filter @apps/api test`                                                | 577 files / 8986 tests passed, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                |
| Unit tier (package)     | `pnpm --filter @adapters/db-prisma test`                                      | 4 files / 70 tests passed, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Lint                    | `eslint apps packages infra --ext .ts,.tsx --max-warnings 0`                  | exit 0 (only the three pre-existing `[boundaries]` plugin notices on stdout)                                                                                                                                                                                                                                                                                                                                                                         |
| Format                  | `prettier --check "apps/**" "packages/**" "infra/**"` and `pnpm format:check` | both clean, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Fitness                 | all 41 checks, extracted byte-exact from the canon file                       | 41/41 green; #30 = 20 (baseline 21, may fall), #38 0 / 11, #37 0, #3 #5 #23 = 0, #31 0/2/1                                                                                                                                                                                                                                                                                                                                                           |
| Fitness #40 internals   | shipped pipelines replayed                                                    | Part A `SEAM_HITS=3`, `COUNT=0`; Part B `SITES=13` (floor 10, margin 3), `BCOUNT=0`, the three relocated seam sites listed                                                                                                                                                                                                                                                                                                                           |
| Integration tier        | `cd apps/api && TIER=pr-integration bash scripts/run-tests.sh`                | 536 tests: 532 pass, 4 fail, 0 cancel, 0 skip. The four failures are all in `rls-tenant-isolation.test.ts` (pg_catalog coverage gate) and name `postChannelPublication`, a table this tree does not define — see Finding W5. Every other batch green: repositories 163, retention 10, hard-delete-race 2, sync 36, outbox 7, consumers 3, tenant-isolation 242 of 246, customer-auth, mfa-backup-single-use, admin-single-use-claims, saga-recovery. |
| Build (whole workspace) | `pnpm build` at HEAD (orchestrator re-run after the apply gate)               | 86/86 tasks, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Requirements and scenarios

### R1 — the four adapters live in `@adapters/db-prisma` and are consumed only through the root specifier (3/3)

- S1 resolve from the package root — PASS. `packages/adapters/db-prisma/src/index.ts:47-50` exports all four; every consumer imports the bare specifier. The three relative imports that remain (`PrismaOutboxWriter.ts:17`, `PrismaPostRepository.ts:31-32`) are intra-package siblings, the design's own layout.
- S2 zero subpath imports — PASS. `rg '@adapters/db-prisma/' apps packages` = 0.
- S3 typecheck and build — PASS. Forced `tsc -b` exit 0; `pnpm build` 86/86.

### R2 — tenant scope derived from an injected provider; no relocated file reaches into `apps/api` (4/4)

- S1 no `apps/api` import — PASS. `rg 'apps/api|security/tenantContext' packages/adapters/db-prisma/src` = 0.
- S2 ambient accessor gone from the packages tree — PASS. `rg getAmbientGucScope packages/` = 0.
- S3 GUC binding and tenant isolation unchanged — PASS. In the integration run: `ok 21 - GUC binding and a repository-opened transaction` (`tenantGucTransactionBinding.test.ts`) and `ok 20 - Post trio composite foreign key — engine-enforced tenant integrity` (`post-trio-tenant-isolation.test.ts`); both diffs against `origin/main` contain import-specifier and constructor-argument edits only (one comment clause in the first), no assertion change.
- S4 system-context call still binds `__system__` — PASS. `hardDeleteSerializableRace` 2/2 runs the use case under `withSystemContext()` through the relocated Unit of Work; the unit tier asserts `gucCall?.[1] === "__system__"`.

### R3 — constructor contract: options positional, provider required (3/3)

- S1 hard-delete path keeps its options — PASS. `setupProjectUseCases.ts:72-76` and `setupAccountUseCases.ts:72-76` pass `HARD_DELETE_TX_OPTIONS` as the third positional argument; `hardDeleteSerializableRace` green.
- S2 omitting the provider does not compile — PASS, executed. A probe type-checked from a scratchpad tsconfig extending the repo base: `new PrismaPostRepository(prisma, undefined)` → `TS2554: Expected 3 arguments, but got 2`; `new PrismaUnitOfWork(prisma)` → `TS2554: Expected 2-3 arguments, but got 1`.
- S3 every construction site updated — PASS. 0 one-argument repository constructions and 0 two-argument-with-options Unit of Work constructions in source (the single grep hit is inside a generated mutation report).

### R4 — exactly one transaction-context storage per process (2/2)

- S1 relocated and non-relocated repositories share one transaction client — PASS. One module-level storage; `softDeleteJoinsUnitOfWork.test.ts:155` asserts the transaction client's `post.count` is called and the base client's is not; green in the unit tier. The root-specifier rule (R1.S2) is the guard against a src/dist duality; the unit case cannot detect one (design D7).
- S2 static accessor survives — PASS. `static getTransactionClient()` at `PrismaUnitOfWork.ts:173`; all 22 non-test callers use the static form.

### R5 — every guard that watched these files follows them (7/7)

Every edited gate's red was replayed without mutating the tree: scope reachability measured with a benign probe (the relocated file yields 0 hits under each OLD scope and 1 under each NEW scope) and a synthetic violation line fed through each gate's own filter chain.

- S1 #40 Part A at the new seam path — PASS. Old term → `SEAM_HITS=2` → scope error exit 1; new term → 3 / 0.
- S2 #40 Part B covers the relocated sites — PASS. `SITES=13`, `BCOUNT=0`; the three relocated sites (`PrismaPostRepository.ts:185, :568, :664`) each derive `resolveGucScope(this.tenantProvider)`; the window test fed a non-derived token → `BCOUNT=1`.
- S3 #23 sees a raw query in the relocated files — PASS. Synthetic paren-form violation → 1 in the repository, 0 in the Unit of Work (its exception is a whole-file filter, correction C2); the shipped exception is documented as inert (its line is a tagged template against a paren-anchored regex; SMELL-111); no exception was added for `resilience.ts`.
- S4 #3 and #5 cover the new directory — PASS. Both name `packages/adapters/db-prisma`; 0 hits; synthetic violations → 1 each.
- S5 nesting adjudication reaches the relocated repository — PASS. `tenantTransactionNesting.test.ts` walks four roots, population floor 16 (= measured), and pins `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts` by name; green.
- S6 guard pair byte-identical and proven red — PASS. Every scope list, `TX_SEAMS`, `PART_B_SCOPE`, `SCOPE_EXEMPT`, the window regex and the floor literal are identical between the canon file and the workflow; the only deltas are the pre-existing shell plumbing (`MATCHES=$(… || true)` vs `| wc -l`, the workflow's existence loop). Both documented inert claims are true: `sagaTenant.ts` holds 0 `.$transaction(`; the Unit of Work's raw query is a tagged template at `:106`.
- S7 unedited guards re-measured — PASS. #38 swept 0, db-prisma 11, baseline literal untouched.

### R6 — the move is reviewable as a rename and the relocated comments are English (2/2)

- S1 renames — PASS. `git diff -M`: 100 % / 100 % / 97 % / 96 %; the translation commit `daa4e80c` is later, separate, touches only the two relocated files, and every changed line in it is a comment line.
- S2 no Spanish comment survives — PASS. Accent-class grep over the four files = 0; a 40-word unaccented sweep = 0.

### R7 — the coverage ratchet is not weakened by hand (2/2)

- S1 #37 zero, literals untouched — PASS. `git diff origin/main..HEAD -- apps/api/vitest.config.ts` is empty; literals 56.8 / 57.3 / 47.8 / 56.2; #37 = 0.
- S2 before/after recorded — PASS. Ledger and PR body: lines 59.58 → 59.37, functions 59.95 → 59.68, branches 49.88 → 49.77, statements 59.01 → 58.81; every value clears its literal; the `autoUpdate` raise was restored and not shipped. Verify does not re-execute the measurement: a coverage run rewrites the literals and would mutate the tree.

### R8 — the docs name the new paths; the dated measurement record is not rewritten (2/2)

- S1 no doc names an old adapter path — PASS. The file-level grep (tasks C8 / T5.4) over `docs/technical` and `docs/security` = 0.
- S2 dated record keeps its citations — PASS. `TENANT_RLS_AB_MEASUREMENT.md` diff = one dated blockquote, zero citation edits.

Non-goal check: `git diff origin/main..HEAD -- apps/workers/src/container/workerContainer.ts` is empty.

## Preservation proof

The seven suites the spec names (`tenantGucTransactionBinding`, `post-trio-tenant-isolation`, `hardDeleteSerializableRace`, `PrismaPostRepository` integration, `sagaCrashRecovery`, `sagaCompensationRecovery`, `mfaBackupCodeSingleUse`) were diffed line by line against `origin/main`: every changed line is an import specifier, a constructor argument or a comment (the allowed clause in `tenantGucTransactionBinding`, plus a two-line `@file` header edit in `hardDeleteSerializableRace` describing the constructor the change altered). No assertion changed in any of them.

## Ledger audit

41/41 tasks ticked, none open. Corrections C10–C13 are true in the tree: the mapper is flat at `src/post/PostAggregateMapper.ts`; exactly two `DELIBERATE soft-delete-sweep exception` markers and `git diff -M` shows 0 changed marker lines; the guards doc's dated blockquote is untouched; fitness #30 measures 20 against the unchanged baseline 21. Strict-TDD claims hold: the new `setupRepositories.test.ts` (three cases asserting real scope values with a bound/unbound pair), the nesting-walk change (population floor plus the `toContain` pin, closing the counting mask) and the constructor-contract cases are real and green; the assertion-quality audit found no tautology, orphan-empty, ghost-loop or smoke-only assertion. The red-path transcripts are coherent (plant → real non-zero exit → sha256-verified restore → count re-confirmed).

## Findings

**CRITICAL**: none.

- **W1 — stale ledger note (format:check).** Batch-1 note 2 and batch-2 note 1 say `pnpm format:check` exits 1 on markdown under `openspec/changes/post-publish-partial-failure/`. At HEAD it exits 0 and that directory is not in this tree. Archive rewording: "`pnpm format:check` at the repo root is clean at HEAD (exit 0); the notes describing an exit 1 on that directory were true when written; those artifacts are no longer in the tree."
- **W2 — stale ledger note (empty `mappers/`).** Batch-1 note 5 says `apps/api/src/infrastructure/repositories/mappers/` "is left in place and empty"; it is absent at HEAD (git tracks no empty directories). Archive rewording accordingly.
- **W3 — the ledger names a W1 sha that is not on the branch.** The header says W1 is `ad8b7992`; the shipped W1 is `44a1b121` (the branch was rebased onto `origin/main`; the earlier object's relocation source is identical, differing only in `docs/product/MASTER_PLAN_ES.md` from the dropped base commit). Archive rewording: "base `main` @ `f2668717`, W1 committed as `44a1b121`".
- **W4 — pre-existing, follow-up not failure.** `PrismaPostRepository` still accepts `outboxWriter: OutboxWriter | undefined`; the change made the slot explicit (an optional parameter cannot precede a required one) but the nullability predates it. Backlog row: an adapter built without a writer drops domain events silently.
- **W5 — environmental, not the candidate's.** The four integration failures are the pg_catalog RLS coverage gate reporting "RLS policy on `postChannelPublication` has no matching TENANT_SCOPED_MODELS entry" (62 policies against 61 enrolled models). The shared dev database carries migration `20260917093257_add_post_channel_publication` from another branch (N-COR-8 PR 1b); this tree neither defines the table nor enrols the model. The gate is doing its job across branches; on a database at this branch's migration state the batch is green, as the apply's own run of the same batch (247 pass) showed before the foreign migration was applied.
- **S1 — `@example` wording.** The shipped example `new PrismaUnitOfWork(prisma, tenantProvider)` is a two-argument call of a three-parameter constructor whose third parameter is optional; spec R6's prose says "three-parameter constructor" while tasks T2.1 defines the target as this exact expression. No scenario covers it and the comment does not lie; align the R6 sentence at archive.
- **S2 — a trap worth recording.** `apps/api/scripts/run-tests.sh` resolves its test paths relative to the process cwd; run from the repo root (the form quoted in tasks §Verification and in the apply ledger) every batch collects zero tests and exits 1, which the runner's own vacuity guard (fitness #31 Part B) reports loudly instead of green. The archive should amend those quotations to `cd apps/api && TIER=pr-integration bash scripts/run-tests.sh`.

## Recommendation

Archive after PR #263 merges. Nothing found blocks it. The archive step applies the W1–W3 rewordings and the S1/S2 amendments to the artifacts, and carries W4 and the run-tests cwd note as backlog rows.
