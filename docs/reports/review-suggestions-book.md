# Review Suggestions Book

**Owner:** Platform engineering
**As of:** 2026-10-06
**Purpose:** the ledger of review findings disposed as **JUSTIFIED — deferred** because they change no behaviour: comment placement, docstring wording, naming, test-fixture readability, and extra test coverage for branches that already share tested code. Every entry names the candidate, the finding, the exact location and what implementing it would take, so it can be picked up later without re-deriving anything.

## Rules

1. **What may enter.** A finding with severity SUGGESTION whose implementation would not change what the code does: prose (comments, docstrings), naming, formatting choices, and _additional_ test coverage for a path that is already exercised through shared code. Each entry is disposed in the review's dispositions file as `JUSTIFIED` with a pointer to its `SB-nnn` id — the receipt is still burned with every finding disposed.
2. **What never enters.** A WARNING. A finding that names a defect, a wrong value, a missing behaviour, a security or tenant-isolation concern, or a test that proves nothing. Those are fixed in the candidate before it ships, and the candidate is reviewed again.
3. **When it is read.** At the end of each workstream's slices (for the first entries: when the `mental-map-hooks` chain has merged), every row is either implemented — the row moves to **Implemented** with the commit — or closed with a one-line reason. A row is never deleted.
4. **Why it exists.** A fresh reviewer re-reads a whole diff on every round and always finds a new sentence to improve; fixing each one changes the candidate and buys another round. Four rounds on one 370-line change (2026-10-01) is the measurement that created this file. The cost of a deferred sentence is zero; the cost of a round is not.

## Index

| Id     | Candidate                                                                             | Finding                                                          | Location                                                                                                                                    | Kind                         | Status                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SB-001 | `mental-map-hooks` 1a-ii (`workstream/hooks-memory-dir`, 817c93bf)                    | R2-001                                                           | `.claude/hooks-py/_common.py:85-96`                                                                                                         | comment placement            | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-002 | same                                                                                  | R2-002                                                           | `.claude/hooks-py/_common.py:118` + `tests/test_common.py`                                                                                  | test sentinel                | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-003 | same                                                                                  | R2-003                                                           | `.claude/hooks-py/tests/test_common.py:5-6`                                                                                                 | docstring wording            | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-004 | same                                                                                  | R2-004                                                           | `.claude/hooks-py/tests/test_common.py:62`                                                                                                  | fixture comment              | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-T01 | same                                                                                  | R3-worktree-detection-depends-on-common-dir-basename             | `.claude/hooks-py/_common.py:67-68`                                                                                                         | test coverage                | closed: a hook never runs inside a bare repository; the branch reaches the fallback the suite proves                                                            |
| SB-T02 | same                                                                                  | R3-fallback-branches-of-main-repository-root-untested            | `.claude/hooks-py/_common.py:57-62`                                                                                                         | test coverage                | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-005 | `mental-map-hooks` 1d (`workstream/hooks-visibility`)                                 | R4-notices-log-dedup-race                                        | `.claude/hooks-py/_common.py` `notice_already_sent`                                                                                         | concurrency design           | implemented (1d, second review raised it to WARNING)                                                                                                            |
| SB-006 | same                                                                                  | R4-notices-log-unbounded, R3-notices-log-unbounded               | `.claude/hooks-py/_common.py` `notice_already_sent`                                                                                         | growth bound                 | implemented (1d, second review raised it to WARNING)                                                                                                            |
| SB-007 | same                                                                                  | R3-cross-hook-dedup-shares-consequence                           | `.claude/hooks-py/_common.py` `emit_missing_file_context`                                                                                   | dedup key design             | closed: one notice per session about the file is the contract, whichever hook detects it                                                                        |
| SB-T03 | same                                                                                  | R3-session-id-tab-collision                                      | `.claude/hooks-py/_common.py` `notice_already_sent`                                                                                         | test coverage / escaping     | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-008 | `mental-map-hooks` 1d                                                                 | R4-003                                                           | `.claude/hooks-py/_common.py` `emit_missing_file_context`                                                                                   | recovery notice design       | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-009 | same                                                                                  | R2-emit-missing-file-context-hard-coded-hook-event-default       | `.claude/hooks-py/_common.py` `emit_missing_file_context`                                                                                   | parameter default            | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-010 | same                                                                                  | R2-load-index-signature-divergence                               | `.claude/hooks-py/pre_edit_decision_guard.py` `load_index`                                                                                  | signature symmetry           | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-011 | book sweep (`workstream/hooks-book-sweep`, 1e6a3c66)                                  | R2-duplicated-prefix-lines-pattern, R3-prefix-lines-module-state | `.claude/hooks-py/pre_edit_canon.py`, `pre_edit_decision_guard.py` (`_PREFIX_LINES`, `emit_*`)                                              | shared helper / test hygiene | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-012 | same                                                                                  | R2-load-index-signature-asimetrica                               | `.claude/hooks-py/pre_edit_decision_guard.py` `load_index`                                                                                  | parameter order              | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-013 | same                                                                                  | R2-recovered-notice-key-contract-implicito                       | `.claude/hooks-py/_common.py` `emit_missing_file_context` / `recovered_file_notice`                                                         | shared key helper            | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-T04 | same                                                                                  | R3-notice-newline-unescaped                                      | `.claude/hooks-py/_common.py` `_notice_field`                                                                                               | escaping / test              | implemented (book sweep, f885c98d)                                                                                                                              |
| SB-014 | `testing-refoundation` contract part 3 (`workstream/trf-contract-3`, 7138e554)        | R2-unexplained-constant-floor-formula                            | `openspec/changes/testing-refoundation/specs/coverage-floor-ratchet/spec.md:79`                                                             | prose structure              | implemented (spec sweep, `workstream/suggestions-book-specs`)                                                                                                   |
| SB-015 | same                                                                                  | R2-overlong-sentence-parallel-writers                            | `openspec/changes/testing-refoundation/specs/behavioural-coverage-backfill/spec.md:178-179`                                                 | prose structure              | implemented (spec sweep, `workstream/suggestions-book-specs`)                                                                                                   |
| SB-016 | same                                                                                  | R2-cross-spec-mirroring-duplication                              | `openspec/changes/testing-refoundation/specs/testing-toolchain-alignment/spec.md:116-124` and `dependency-version-management/spec.md:14-33` | cross-reference              | implemented (spec sweep, `workstream/suggestions-book-specs`)                                                                                                   |
| SB-017 | same                                                                                  | R2-ambiguous-maturity-anchor                                     | `openspec/changes/testing-refoundation/specs/dependency-version-management/spec.md:72`                                                      | cross-reference              | implemented (spec sweep, `workstream/suggestions-book-specs`)                                                                                                   |
| SB-018 | same                                                                                  | R3-k6-cv-boundary-ambiguity                                      | `openspec/changes/testing-refoundation/specs/k6-load-gate/spec.md:89-90`                                                                    | prose precision              | implemented (spec sweep, `workstream/suggestions-book-specs`)                                                                                                   |
| SB-019 | same                                                                                  | R3-coverage-floor-formula-edge                                   | `openspec/changes/testing-refoundation/specs/coverage-floor-ratchet/spec.md:79`                                                             | prose precision              | implemented (spec sweep, `workstream/suggestions-book-specs`)                                                                                                   |
| SB-020 | same                                                                                  | R3-env-port-refusal-recovery                                     | `openspec/changes/testing-refoundation/specs/test-environment-contract/spec.md:88-90`                                                       | scenario precision           | implemented (book sweep, `workstream/book-sweep-contract`)                                                                                                      |
| SB-021 | same                                                                                  | R3-mutation-no-both-directions-proof                             | `openspec/changes/testing-refoundation/specs/mutation-score-floors/spec.md:133-139`                                                         | missing red scenario         | implemented (spec sweep, `workstream/suggestions-book-specs`): the second option — the ledger reopening named as the enforcement surface; no Red scenario added |
| SB-022 | same                                                                                  | R3-dependency-closure-coverage-silent                            | `openspec/changes/testing-refoundation/specs/dependency-version-management/spec.md:47-49`                                                   | missing red scenario         | implemented (book sweep, `workstream/book-sweep-contract`)                                                                                                      |
| SB-023 | `testing-refoundation` contract part 7 (`workstream/trf-contract-7`, tasks-part-2.md) | R3-phase2-ordering-vs-H3                                         | `openspec/changes/testing-refoundation/tasks-part-2.md` Phase 2 preamble                                                                    | prose precision              | implemented (spec sweep, `workstream/suggestions-book-specs`)                                                                                                   |
| SB-024 | same                                                                                  | R3-S4-decline-branch-undefined                                   | `openspec/changes/testing-refoundation/tasks-part-2.md` task S.4.2                                                                          | decision record              | implemented (book sweep, `workstream/book-sweep-contract`)                                                                                                      |
| SB-025 | same                                                                                  | R3-4b5-measured-branch-no-acceptance                             | `openspec/changes/testing-refoundation/tasks-part-2.md` task 4b.5.2                                                                         | acceptance line              | implemented (spec sweep, `workstream/suggestions-book-specs`)                                                                                                   |
| SB-026 | same                                                                                  | R3-X2-decision-rule-ambiguity                                    | `openspec/changes/testing-refoundation/tasks-part-2.md` task X.2.1                                                                          | prose precision              | implemented (spec sweep, `workstream/suggestions-book-specs`)                                                                                                   |
| SB-027 | same                                                                                  | R3-1-11-3-env-coupling                                           | `openspec/changes/testing-refoundation/tasks-part-2.md` task 1.11.3                                                                         | missing red row              | implemented (book sweep, `workstream/book-sweep-contract`)                                                                                                      |
| SB-028 | `mental-map-hooks` 3a-i (`workstream/hooks-canon-index`, 4c921dbb)                    | R2-canon-finalize-import-ordering                                | `.claude/scripts/canon-finalize.py:34-41` and the three sibling canon scripts                                                               | duplication                  | closed: three scripts are left and each keeps the two-line bootstrap, which no shared helper can replace                                                        |
| SB-029 | `mental-map-hooks` 3a-ii (`workstream/hooks-canon-staleness`, 61cfeccc)               | R2-canon-line-implicit-invariant                                 | `.claude/hooks-py/user_prompt_submit.py` `canon_index_line`                                                                                 | comment                      | implemented (English sweep, `workstream/hooks-english-canon`)                                                                                                   |
| SB-030 | same                                                                                  | R2-canon-line-broad-except                                       | `.claude/hooks-py/user_prompt_submit.py` `canon_index_line`                                                                                 | comment                      | implemented (English sweep, `workstream/hooks-english-canon`)                                                                                                   |
| SB-031 | same                                                                                  | R2-dead-patterns-named-naming                                    | `.claude/hooks-py/_common.py` `DEAD_PATTERNS_NAMED`                                                                                         | naming                       | implemented (English sweep, 4eb09fdc)                                                                                                                           |
| SB-032 | `mental-map-hooks` sweep 5/5 (`workstream/hooks-sweep-leftovers`, 7c82bfb8)           | R2-synth-naming-mismatch                                         | `.claude/scripts/canon-staleness-report.py` `--synth-days`, `synth_age`, `stale_synth`                                                      | naming                       | implemented (code sweep, `workstream/suggestions-book-code`); the summary label reads `Stale by date`; the flag stays                                           |
| SB-033 | same                                                                                  | R2-list-operations-column-fragility                              | `.claude/hooks-py/tests/test_omnipost_allow.py`                                                                                             | comment                      | implemented (code sweep, `workstream/suggestions-book-code`)                                                                                                    |
| SB-034 | `mental-map-hooks` 3b-2 (`workstream/hooks-battery-state`, 485003da)                  | R3-rmSync-no-recursive                                           | `scripts/testing/battery-state.mjs` (the staging-file cleanup, `rmSync(staging, { force: true })`)                                          | comment                      | implemented (code sweep, `workstream/suggestions-book-code`)                                                                                                    |
| SB-035 | `testing-refoundation` 0.18 (`workstream/refound-0-18`, f99f2fc3)                     | R2-override-bands-gate-comment-density                           | `scripts/testing/override-bands-gate.mjs` (the file header)                                                                                 | prose structure              | implemented (book sweep part 2, `workstream/book-sweep-sensitive`)                                                                                              |
| SB-036 | same                                                                                  | R2-security-canon-brace-expansion-row                            | `docs/security/SECURITY_CANON.md` (the `brace-expansion` CVE-floor row)                                                                     | prose structure              | implemented (book sweep, `workstream/book-sweep-contract`)                                                                                                      |
| SB-037 | same                                                                                  | R2-fasturi-row-scannability                                      | `docs/security/SECURITY_CANON.md` (the `fast-uri` CVE-floor row)                                                                            | prose structure              | implemented (book sweep, `workstream/book-sweep-contract`)                                                                                                      |
| SB-038 | `testing-refoundation` P.4 (`workstream/refound-p-4`, 3ade5c22)                       | R2-audit-comment-stream-coloring                                 | `.github/workflows/audit.yml` (the comment above the scan step on why gitleaks' log prose is not read)                                      | comment                      | implemented (book sweep part 2, `workstream/book-sweep-sensitive`)                                                                                              |
| SB-039 | `testing-refoundation` P.5 (`workstream/refound-p-5`, 91f26952)                       | R2-testing-refoundation-doc-length                               | `docs/development/TESTING_REFOUNDATION.md` (the whole file, 2111 lines)                                                                     | prose structure              | deferred: keep the tables in the tracker; move the fixed plan and the measurement narratives to their own files                                                 |
| SB-040 | `testing-refoundation` 0.11 (`workstream/refound-0-11`, e3c26b2e)                     | R2-003                                                           | `docs/security/SECURITY_CANON.md` (the `webpack-dev-middleware` CVE-floor row)                                                              | prose                        | implemented (book sweep, `workstream/book-sweep-contract`)                                                                                                      |
| SB-041 | `testing-refoundation` 0.12 (`workstream/refound-0-jsdom`, a618c8bf)                  | R2-001, R3-prisma-shape-fragile                                  | `apps/api/tests/unit/security/sanitizerOutputs.test.ts` (the `unusedPrisma` client)                                                         | test-fixture readability     | implemented (code sweep, `workstream/suggestions-book-code`)                                                                                                    |
| SB-042 | same                                                                                  | R2-002                                                           | `apps/api/tests/unit/security/sanitizerOutputs.test.ts` (`SanitizerCase.templateEngine`)                                                    | naming                       | implemented (code sweep, `workstream/suggestions-book-code`)                                                                                                    |
| SB-043 | replacement slice (i-a) (`workstream/refound-dead-devdeps`, 29077cb2)                 | R2-packagejson-any-field                                         | `quality/scripts/bundle-analyzer.ts` (`packageJson` and `lockfile` fields)                                                                  | typing                       | implemented (code sweep, `workstream/suggestions-book-code`); `lockfile`, which nothing read, deleted                                                           |
| SB-044 | night slice N3 (`workstream/refound-secretlint-13`, fec21f88)                         | R2-test-secret-content-concat                                    | `.claude/hooks-py/tests/test_post_edit.py` (`SECRET_CONTENT`)                                                                               | test-fixture readability     | implemented (book sweep part 2, `workstream/book-sweep-sensitive`)                                                                                              |
| SB-045 | same                                                                                  | R3-003                                                           | `.claude/hooks-py/tests/test_post_edit.py` (the argv test)                                                                                  | test precision               | implemented (book sweep part 2, `workstream/book-sweep-sensitive`)                                                                                              |
| SB-046 | night slice N4 (`workstream/refound-jscpd-5`, 778aad25)                               | R2-baseline-opaque-fingerprints                                  | `.jscpd-baseline.json` (the `fingerprints` keys)                                                                                            | readability                  | closed: the gate's own output names every clone's paths and marks `[NEW]`; a generated mapping file would drift                                                 |
| SB-047 | same                                                                                  | R4-fail-on-empty-risk                                            | `.jscpd.json` (`failOnEmpty: true`)                                                                                                         | failure mode                 | closed: a scan that reads nothing must not report green (fitness #36, #44); a misconfiguration is what it stops                                                 |
| SB-048 | same                                                                                  | R3-pnpm-lock-generated                                           | `pnpm-lock.yaml`                                                                                                                            | review scope                 | closed: the battery installs frozen and audits; CI runs `pnpm dedupe --check`; D39 (b) carries the delta                                                        |
| SB-049 | same                                                                                  | R2-unused-code-inventory-stale                                   | `docs/reports/UNUSED_CODE_INVENTORY.md` (the `jscpd.json` rows of §4.5 and §8.1)                                                            | audit record                 | closed: the inventory is an audit record; a resolution is appended in its row, as D35 did (7f4f6e0b)                                                            |
| SB-050 | F6a (`workstream/env-secret-fallbacks`, eb6bc726)                                     | R2-config-spread-shadowing                                       | `apps/api/src/auth/providerOAuthConfigs.ts`, the eight `validateCode` bodies                                                                | naming                       | implemented (book sweep, `workstream/book-sweep-contract`)                                                                                                      |
| SB-051 | F6a (`workstream/env-secret-fallbacks`, 7d93feb9)                                     | R2-credentialsfromenv-return-type-opaque                         | `apps/api/src/auth/providerOAuthConfigs.ts` `credentialsFromEnv`                                                                            | naming                       | implemented (book sweep, `workstream/book-sweep-contract`)                                                                                                      |
| SB-052 | item (v) PR1 (`workstream/item-v-cruiser`, ba39279b)                                  | R2-module-path-comment-misleading                                | `.dependency-cruiser-resolve.cjs:17` (the comment above the `@shared/types` alias)                                                          | comment                      | deferred: say that `module.path` is this file's directory, so the file stays at the repository root or the alias path moves with it                             |
| SB-053 | same                                                                                  | R2-forbidden-to-path-array-no-comment-on-regex-semantics         | `.dependency-cruiser.cjs:141-168` (the `to.path` arrays of `core-domain-no-framework` and `core-application-no-infrastructure`)             | comment                      | deferred: say what each form in the arrays matches, a written name or a resolved path, and that both are needed                                                 |
| SB-054 | same                                                                                  | R2-planned-steps-magic-number                                    | `scripts/testing/battery.sh:34` (`PLANNED_STEPS`)                                                                                           | duplication                  | deferred: derive the count from the `step` invocations or check it against them; the battery's owner decides                                                    |
| SB-055 | same                                                                                  | R2-architecture-step-warn-vs-red-contract-buried                 | `scripts/testing/battery.sh:156-159` (the comment above `step architecture`)                                                                | cross-reference              | deferred: point the comment at the verdict's warn-line rule in `scripts/testing/battery-verdict.mjs`                                                            |
| SB-056 | same                                                                                  | R2-knip-entry-cjs-config-file-unexplained                        | `knip.json:6` (the `.dependency-cruiser-resolve.cjs` entry)                                                                                 | comment                      | deferred: say why the file is an entry; strict JSON takes no comment, so the file becomes `knip.jsonc`                                                          |
| SB-057 | same                                                                                  | R3-batteryverdict-architecture-fixture-coverage                  | `apps/api/tests/unit/scripts/batteryVerdict.test.ts:257-274` (the architecture step's clean-log case)                                       | test coverage                | deferred: a RED case built from a real error log, an `error no-circular:` record plus the `(1 errors, 0 warnings)` summary                                      |
| SB-058 | same                                                                                  | R3-battery-architecture-warn-no-assertion                        | `scripts/testing/battery.sh:156-159` (the comment above `step architecture`)                                                                | failure mode                 | closed: `--output-type err` prints every severity; a warn-severity violation reaches the log and the verdict reads it as RED                                    |
| SB-059 | item (v) PR v-d1 (`workstream/item-v-logger-a`, 0986c8ad)                             | R3-single-error-path-covered, R3-004                             | `apps/api/tests/unit/billing/GatewayBillingService.test.ts:384-396` (the one case on the injected logger)                                   | test coverage                | deferred: a case per remaining catch site and per email `.catch` warning, asserting the injected logger's context and message                                   |
| SB-060 | same                                                                                  | R3-bindings-formatter-conditional, R3-003                        | `apps/api/src/lib/logger.ts:48-55` (the `bindings` formatter)                                                                               | test coverage                | deferred: a case for a logger with no name (no `name` key) and one for a child (its parent's `name` kept), both measured 2026-10-05                             |
| SB-061 | same                                                                                  | R3-type-test-collector-fragility                                 | `apps/api/vitest.config.ts:53-54` (`include`, `exclude`) and the four `*.type-test.ts` under `apps/api/tests/unit`                          | test configuration           | deferred: `**/*.type-test.ts` in `test.exclude`, so no wider glob collects a compile-time pin                                                                   |
| SB-062 | same                                                                                  | R3-pino-internal-symbol-dependency                               | `apps/api/tests/unit/logger.test.ts:39-54` (the name-binding case; the contract suite's capture fixed in 0986c8ad)                          | test capture                 | deferred: one guarded capture shared by both suites, or a destination the test hands to `createLogger`                                                          |
| SB-063 | item (v) PR v-d2 (`workstream/item-v-logger-port`, beb017e1)                          | R2-logging-canon-core-row-prose-is-tangled                       | `docs/observability/LOGGING_CANON.md:19` (the `Why` cell of the `packages/core/**` row)                                                     | prose structure              | deferred: three sentences, with the factory's logger as the subject of "It implements the port as is"                                                           |
| SB-064 | same                                                                                  | R2-data-retention-doc-references-test                            | `packages/core/compliance/src/DataRetentionService.ts:7-12` (the header)                                                                    | comment                      | deferred: keep the audit call, drop the suite's path; in the change that takes DEF-17                                                                           |
| SB-065 | same                                                                                  | R2-dlq-archive-silent-sweep, R2-dlq-archival-asymmetric-logging  | `packages/core/webhooks/src/DlqArchivalService.ts:1-38` (the header and both method comments)                                               | comment                      | deferred: one class-level sentence on why only the stale lookup warns; in the change that takes DEF-18                                                          |
| SB-066 | same                                                                                  | R2-logger-param-position                                         | `packages/core/compliance/src/ComplianceService.ts:85-95` (the constructor)                                                                 | parameter shape              | deferred: the logger's place among many ports in LOGGING_CANON, or an ADR for one dependencies object                                                           |
| SB-067 | same                                                                                  | R3-004                                                           | `packages/core/auth/tests/unit/RoleManagementService.test.ts:188-200` (the `deleteRole` case)                                               | test coverage                | deferred: a case each for `createRole`, `updateRole` and `setRolePermissions`                                                                                   |
| SB-068 | same                                                                                  | R3-005                                                           | `packages/core/compliance/tests/unit/ComplianceService.test.ts:181-193` (the `updateGdprSettings` case)                                     | test coverage                | deferred: a case per remaining logger call, seven in all                                                                                                        |
| SB-069 | item (v) PR v-e2 (`workstream/item-v-cheap-queue`, 33476917)                          | R3-001                                                           | `apps/api/tests/unit/queueRoutes.test.ts:73-108` (the module-level publish-queue double)                                                    | test determinism             | deferred: a double built per test, before a case overrides a mock or mutates `storedJob`                                                                        |
| SB-070 | same                                                                                  | R3-002                                                           | `apps/api/tests/unit/queueRoutes.test.ts:105` (`getJobs`) and the listing cases at `:188-226`                                               | test precision               | deferred: a `getJobs` answer per state and offset; with DEF-26, which rewrites the `total` assertion                                                            |
| SB-071 | production-ci trigger (`workstream/production-ci-stacked-prs`, 80cc7e65)              | R2-001                                                           | `.github/workflows/production-ci.yml:8-9` (the comment above the `pull_request` branches)                                                   | comment                      | deferred: state what `omni-post-cc` is in the comment of all five workflows that list it, in one change under a `sensitive-edit` token                          |
| SB-072 | @typescript-eslint 8.71.0 (`workstream/toolchain-ts-eslint-8-71`, 53e6cc0c)           | R4-002                                                           | `pnpm-workspace.yaml:94` (the comment on the `typescript` catalog entry)                                                                    | comment                      | deferred: put the remove-when first in that comment and move the re-measurement history behind it                                                               |
| SB-073 | same                                                                                  | R2-002                                                           | `docs/development/TESTING_REFOUNDATION.md:706-710` (the second of "The five crossings": the `typescript` hold)                              | prose structure              | deferred: split the install note from the peer-range measurement and link `scripts/testing/maturity-watchlist.json`                                             |
| SB-074 | @typescript-eslint 8.71.0 (`workstream/toolchain-ts-eslint-8-71`, dbbfeeb6)           | R2-002                                                           | `scripts/testing/maturity-watchlist.json:200-215` (the entry's `name` and its `members`)                                                    | schema documentation         | deferred: state the convention for a family entry's `name` in the list's `description` and the script header, when the list's schema next changes               |
| SB-075 | same                                                                                  | R2-003                                                           | `scripts/testing/maturity-watchlist.json:220` (`entered.via` of the same entry)                                                             | schema shape                 | deferred: structured `entered` sub-fields with their `validate()` rules and suite cases, in a change to the list's schema                                       |
| SB-076 | audit floors 2026-10-06 (`workstream/audit-floors-oct06`, a0e2c374)                   | R2-canon-row-length                                              | `docs/security/SECURITY_CANON.md:275` (the `prosemirror-view` row of §"CVE-floor pins"; its Why cell is 2,454 characters)                   | prose structure              | deferred: lead each statement of the Why cell with a bold label, as its `**REACHABLE**` and `**Remove-when:**` already are; no value changes                    |
| SB-077 | same                                                                                  | R2-watchlist-entered-note-sentence                               | `scripts/testing/maturity-watchlist.json:240` (`entered.via` of the `source-map-js` entry; the review cites `:239`)                         | prose precision              | deferred: end the clause with what the deviation is lesser than, and a full stop, when the entry's maturity review (2026-10-07) rewrites the record             |
| SB-078 | same                                                                                  | R2-override-key-count-mismatch-risk                              | `docs/security/SECURITY_CANON.md:286` (the `@opentelemetry/instrumentation-*` row) and `pnpm-workspace.yaml:253-260` (the eight keys)       | cross-reference              | deferred: name the eight packages and their versions in the Floor cell in place of "see Why", or point at the override block by its comment                     |
| SB-079 | slice 0.22 PR C, second round (`workstream/0-22-c-runner`, 348480bb)                  | R2-storybook-row-readability                                     | `docs/security/SECURITY_CANON.md:401` (the `storybook` hold row, at `4b98772a`; the review cites the table, `:397-414`)                     | table layout                 | deferred: when PR D removes admin's Storybook, drop `@storybook/nextjs` and its webpack sentences; move the dated measurements behind the remove-when           |
| SB-080 | same                                                                                  | R3-003                                                           | `pnpm-workspace.yaml:167-173` (the `@vitest/browser` and `@vitest/browser-playwright` entries and their comment, at `4b98772a`)             | test coverage                | deferred: a check that the catalog's `vitest` and `@vitest/*` entries carry one version, failing with the values, when the family next moves                    |
| SB-081 | same                                                                                  | R3-003                                                           | `apps/client/.storybook/preview.tsx:19-20` (`isStoryLocale`, used at `:105`; at `30d3f010`)                                                 | test coverage                | deferred: a story whose `globals` set an unknown locale, with a `play` asserting the English text, or a unit case calling the decorator with one                |
| SB-082 | same                                                                                  | R2-testing-refoundation-table-rewrap                             | `docs/development/TESTING_REFOUNDATION.md:352-371` (the gate inventory table, `Story runner` row at `:371`; at `31da136f`)                  | table layout                 | part implemented at `e472aaa9` (the pipe is a comma; the row renders); deferred: shorten that row's Red proof cell                                              |
| SB-083 | same                                                                                  | R4-002                                                           | `.github/workflows/ci.yml:825-828` (the Playwright cache's `restore-keys` and its comment, at `31da136f`; `:827-829` at the tip)            | failure mode                 | deferred: if a stale restore is ever observed, drop `restore-keys` so a version bump starts from an empty cache                                                 |
| SB-084 | unit B lossless credentials (`workstream/cred-b-channel-credentials`, a6fd8183)       | R4-003                                                           | `packages/core/domain/src/entities/Channel.ts:47-57` (`readExpiry`; the review cites `:46-51`) and `:384-387` (`areCredentialsExpired`)     | failure mode                 | deferred: reject an unparsable `expiresAt` where credentials enter, in the typed per-provider contract (§2F slice 1, DEF-36); the domain logs nothing           |
| SB-085 | unit B.1 credential invariant (`workstream/cred-b1-credential-invariant`, d67733ed)   | R2-001                                                           | `apps/api/src/channels/channelRoutes.ts:267-269` (the comment above `Channel.reconstitute` in the POST handler)                             | comment                      | deferred: say that credentials with a key passed the invariant and an omitted or empty value is stored unchecked, which is what makes the PENDING channel       |
| SB-086 | same                                                                                  | R2-002                                                           | `apps/api/src/channels/channelRoutes.ts:252-255` (the POST gate on `credentials`; the review cites `:252`)                                  | comment                      | deferred: a one-line comment above the gate: the body schema (`:41`) leaves `credentials` a record or absent, and `{}` skips the check on purpose               |
| SB-087 | same                                                                                  | R2-003                                                           | `packages/core/domain/src/entities/Channel.ts:117` (the class-level invariant) against `:175-185` (`validateCredentials`)                   | docstring wording            | deferred: add "top-level" to the class-level invariant, or link it to `Channel.validateCredentials`                                                             |
| SB-088 | same                                                                                  | R3-001                                                           | `apps/api/src/channels/channelRoutes.ts:252-256` (the POST gate) and the body schemas at `:41` and `:48`                                    | comment                      | deferred: the comment of SB-086; validating whenever `credentials` is sent would turn POST with `{}`, the OAuth hand-off, into a 400                            |
| SB-089 | same                                                                                  | R3-002                                                           | `apps/api/tests/unit/channelRoutes.test.ts:289-296` (the POST case that stores `{}` when no credentials are sent)                           | test precision               | deferred: assert the response's `status` is PENDING in that case; the first POST case pins it on the same payload (`:268`)                                      |

## Entries — code and prose

### SB-001 — split the auto-memory comment block

- **Source:** review `hooks-1aii3`, readability lens, 2026-10-01.
- **Location:** `.claude/hooks-py/_common.py:85-96` (the comment above `_MEMORY_DIR_CACHE`).
- **Suggestion:** the block mixes the slug contract (`/root/omni-post` → `-root-omni-post`, shared with Claude Code) with the caching policy; move the slug/contract text into the `_resolve_memory_dir` docstring and keep only the caching rationale beside the two globals.
- **Why deferred:** prose placement; both facts are stated and true where they are.
- **To implement:** move two sentences; no code change.

### SB-002 — the `sin caché` sentinel couples a log message to a test

- **Source:** review `hooks-1aii3`, readability lens.
- **Location:** `.claude/hooks-py/_common.py:118` (`memory_dir` warning) and `tests/test_common.py` (`.count("sin caché")`).
- **Suggestion:** extract the sentinel into a constant used by both, or assert on the `memory_dir:` line prefix.
- **Why deferred:** a reworded message breaks the test loudly, not silently; the coupling is visible in both places.
- **To implement:** a module constant `MEMORY_DIR_FALLBACK_NOTE` and the test asserting on it.

### SB-003 — `tests/test_common.py` module docstring enumerates the wrong contracts

- **Source:** review `hooks-1aii3`, readability lens.
- **Location:** `.claude/hooks-py/tests/test_common.py:5-6`.
- **Suggestion:** rewrite the docstring to list the contracts the module actually covers (path resolution, memory directory, log-line format, current branch, hook wiring, stop audits).
- **Why deferred:** docstring prose; the test class names already carry the list.
- **To implement:** one paragraph.

### SB-004 — explain the empty commit in the worktree fixture

- **Source:** review `hooks-1aii3`, readability lens.
- **Location:** `.claude/hooks-py/tests/test_common.py:62` (`MemoryDirTests`).
- **Suggestion:** a one-line comment saying `git worktree add` needs at least one commit, and a less dense identity argv for the empty commit.
- **Why deferred:** fixture readability.
- **To implement:** one comment; optionally a `_commit(repo)` helper.

### SB-005 — two hooks on one Edit may both send the first notice

- **Source:** review `hooks-1d`, resilience lens, 2026-10-01.
- **Location:** `.claude/hooks-py/_common.py`, `notice_already_sent` (read-then-append, no lock).
- **Suggestion:** Claude Code runs the PreToolUse hooks of one event in parallel; `pre_edit_canon` and `pre_edit_decision_guard` can both read the notices log before either appends, and the model receives the MISSING line twice in that session.
- **Why deferred:** bounded to one duplicate context line, only while the index is missing and only on an Edit where the guard also matched a decision pattern; the OSError branch already degrades to emitting.
- **To implement:** append first with a per-process nonce, re-read, and emit only if our line is the first one carrying the marker (deterministic tie-break without a lock); one test with two interleaved callers.

### SB-006 — the notices log has no bound

- **Source:** review `hooks-1d`, resilience and reliability lenses.
- **Location:** `.claude/hooks-py/_common.py`, `notice_already_sent`.
- **Suggestion:** the file is append-only and re-read in full on every hook invocation; cap or rotate it, or key on the current session only.
- **Why deferred:** one line per (session, key, state) — a handful per session; the read is a few hundred bytes for years of use.
- **To implement:** keep only lines of the current session when appending (rewrite on write), or truncate above a few KB.

### SB-007 — the dedup key drops the per-hook consequence

- **Source:** review `hooks-1d`, reliability lens.
- **Location:** `.claude/hooks-py/_common.py`, `emit_missing_file_context` (`key = tag:name:state`).
- **Suggestion:** the guard's consequence (which decision patterns went unchecked) is suppressed when the canon hook notified the session first.
- **Why deferred:** intended — one notice per session about the missing file is the contract ("whichever hook detects it"); the fact is the same even if the sentence differs.
- **To implement:** if both sentences are wanted, include `tag:name:state:hook` in the key and expect up to one notice per hook per session.

### SB-011 — the `_PREFIX_LINES` pattern is duplicated in both canon hooks

- **Source:** review `hooks-sweep`, readability and reliability lenses, 2026-10-01.
- **Location:** `.claude/hooks-py/pre_edit_canon.py` and `pre_edit_decision_guard.py` (`_PREFIX_LINES`, `emit_context`/`emit_no_context`, `emit_warning`/`emit_no_warning`).
- **Suggestion:** the module-level list plus the two emitters that read it are the same twenty lines in both hooks; a change to the separator or the early-exit must be made twice, and tests must clear the list by hand (`guard._PREFIX_LINES.clear()`). Extract a helper in `_common` (or pass the prefix as an argument) and clear it in a `setUp`.
- **Why deferred:** no behavioural effect; each hook is a fresh process.
- **To implement:** `_common.emit_context(hook_event, body, prefix=())` used by both hooks; tests pass the prefix explicitly.

### SB-012 — `load_index(session_id="", *, decision_ids)` puts the optional argument first

- **Source:** review `hooks-sweep`, readability lens.
- **Location:** `.claude/hooks-py/pre_edit_decision_guard.py`, `load_index`.
- **Suggestion:** `load_index(*, decision_ids: str, session_id: str = "")` makes the obligation visible in the signature.
- **Why deferred:** naming/shape; every call site is already keyword-based.
- **To implement:** reorder and update the four test call sites and `main()`.

### SB-013 — the notice key format is rebuilt by hand in two places

- **Source:** review `hooks-sweep`, readability lens.
- **Location:** `.claude/hooks-py/_common.py`, `emit_missing_file_context` (writes `tag:name:state`) and `recovered_file_notice` (reads it).
- **Suggestion:** a `_notice_key(tag, name, state)` helper so a format change cannot silently break recovery detection.
- **Why deferred:** both sites are ten lines apart in the same module and covered by the recovery test, which fails if they drift.
- **To implement:** one helper, two call sites.

### SB-014 — unexplained constant floor formula

- **Source:** review `trf-contract-3r2` (part 3 of the contract landing, round 2), readability lens, finding `R2-unexplained-constant-floor-formula`.
- **Location:** `openspec/changes/testing-refoundation/specs/coverage-floor-ratchet/spec.md:79`.
- **Suggestion:** bullet the three constants of the floor formula (truncate to one decimal, subtract 0.1 pp, clamp at 0) instead of one sentence.
- **Why deferred:** the sentence already names all three constants; a bullet list is layout, not meaning.
- **To implement:** a prose edit in the spec named above, reviewed with the slice that next touches it.

### SB-015 — overlong sentence parallel writers

- **Source:** review `trf-contract-3r2` (part 3 of the contract landing, round 2), readability lens, finding `R2-overlong-sentence-parallel-writers`.
- **Location:** `openspec/changes/testing-refoundation/specs/behavioural-coverage-backfill/spec.md:178-179`.
- **Suggestion:** split the five acceptance conditions of the parallel-writer scenario into bullets.
- **Why deferred:** the five conditions are each checkable as written; the parenthetical is the single CODE definition pointer round 1 asked for.
- **To implement:** a prose edit in the spec named above, reviewed with the slice that next touches it.

### SB-016 — cross spec mirroring duplication

- **Source:** review `trf-contract-3r2` (part 3 of the contract landing, round 2), readability lens, finding `R2-cross-spec-mirroring-duplication`.
- **Location:** `openspec/changes/testing-refoundation/specs/testing-toolchain-alignment/spec.md:116-124` and `dependency-version-management/spec.md:14-33`.
- **Suggestion:** name which spec OWNS the mirrored `@types/node` / `engines.node` rule and which one restates it.
- **Why deferred:** both statements are identical today and both are reviewed together in this part; ownership is a naming decision for the canon pass (Phase 8).
- **To implement:** a prose edit in the spec named above, reviewed with the slice that next touches it.

### SB-017 — ambiguous maturity anchor

- **Source:** review `trf-contract-3r2` (part 3 of the contract landing, round 2), readability lens, finding `R2-ambiguous-maturity-anchor`.
- **Location:** `openspec/changes/testing-refoundation/specs/dependency-version-management/spec.md:72`.
- **Suggestion:** make the ADR-0018 citation a repository-relative path (`docs/technical/ADR-0018-dependency-freshness-canon.md`).
- **Why deferred:** the ADR is unique by number and lives under `docs/technical/`; a path is one hop from a grep.
- **To implement:** a prose edit in the spec named above, reviewed with the slice that next touches it.

### SB-018 — k6 cv boundary ambiguity

- **Source:** review `trf-contract-3r2` (part 3 of the contract landing, round 2), reliability lens, finding `R3-k6-cv-boundary-ambiguity`.
- **Location:** `openspec/changes/testing-refoundation/specs/k6-load-gate/spec.md:89-90`.
- **Suggestion:** say in words that EITHER condition alone deletes the tool (the sentence already says "OR").
- **Why deferred:** `DELETED if A, OR B` is a disjunction; the reviewer asks for the same rule in a second wording.
- **To implement:** a prose edit in the spec named above, reviewed with the slice that next touches it.

### SB-019 — coverage floor formula edge

- **Source:** review `trf-contract-3r2` (part 3 of the contract landing, round 2), reliability lens, finding `R3-coverage-floor-formula-edge`.
- **Location:** `openspec/changes/testing-refoundation/specs/coverage-floor-ratchet/spec.md:79`.
- **Suggestion:** state the two endpoints explicitly (0.1 → 0.0, 100 → 99.9).
- **Why deferred:** the arithmetic at both endpoints is self-consistent, as the finding itself concedes.
- **To implement:** a prose edit in the spec named above, reviewed with the slice that next touches it.

### SB-020 — env port refusal recovery

- **Source:** review `trf-contract-3r2` (part 3 of the contract landing, round 2), reliability lens, finding `R3-env-port-refusal-recovery`.
- **Location:** `openspec/changes/testing-refoundation/specs/test-environment-contract/spec.md:88-90`.
- **Suggestion:** the refusal MUST always include the bound port and the whole test port set, process identity being optional.
- **Why deferred:** the scenario already requires the port in every refusal; process identity was added as optional in round 2.
- **To implement:** a prose edit in the spec named above, reviewed with the slice that next touches it.

### SB-021 — mutation no both directions proof

- **Source:** review `trf-contract-3r2` (part 3 of the contract landing, round 2), reliability lens, finding `R3-mutation-no-both-directions-proof`.
- **Location:** `openspec/changes/testing-refoundation/specs/mutation-score-floors/spec.md:133-139`.
- **Suggestion:** add a Red scenario where a new assertion-free test fails the incremental mutation lane, or state that the ledger reopening is the enforcement surface.
- **Why deferred:** the enforcement surface is decided in Phase 7 (7.5 mutation PR lane); writing the scenario before the lane exists would be fiction.
- **To implement:** a prose edit in the spec named above, reviewed with the slice that next touches it.

### SB-022 — dependency closure coverage silent

- **Source:** review `trf-contract-3r2` (part 3 of the contract landing, round 2), reliability lens, finding `R3-dependency-closure-coverage-silent`.
- **Location:** `openspec/changes/testing-refoundation/specs/dependency-version-management/spec.md:47-49`.
- **Suggestion:** add a Red scenario where a documented chain that the parsed lockfile does not contain exits non-zero naming the entry.
- **Why deferred:** the gate lands with slice 0.3/0.18 and carries its own red proof there; the spec scenario can name the exit when that gate is final.
- **To implement:** a prose edit in the spec named above, reviewed with the slice that next touches it.

### SB-023 — phase2 ordering vs H3

- **Source:** review `trf-contract-7` (part 7 of the contract landing), reliability lens, finding `R3-phase2-ordering-vs-H3`.
- **Location:** `openspec/changes/testing-refoundation/tasks-part-2.md` Phase 2 preamble.
- **Suggestion:** name gate H8 (2.3.1) in the Phase 2 preamble next to H3, since later block-deletion slices can descend floors.
- **Why deferred:** H8 is named at the slice that owns it and the Decisions log records it when it fires; the preamble line is a reading aid.
- **To implement:** a prose edit in the tasks file named above, reviewed with the slice that next touches it.

### SB-024 — S4 decline branch undefined

- **Source:** review `trf-contract-7` (part 7 of the contract landing), reliability lens, finding `R3-S4-decline-branch-undefined`.
- **Location:** `openspec/changes/testing-refoundation/tasks-part-2.md` task S.4.2.
- **Suggestion:** give the S.4.2 decline branch a human-gate id so the taken branch is observable from the plan, not only from the tracker Decisions log.
- **Why deferred:** the tracker Decisions log is the existing typed record for every human decision; a gate id is a cross-reference on top of it.
- **To implement:** a prose edit in the tasks file named above, reviewed with the slice that next touches it.

### SB-025 — 4b5 measured branch no acceptance

- **Source:** review `trf-contract-7` (part 7 of the contract landing), reliability lens, finding `R3-4b5-measured-branch-no-acceptance`.
- **Location:** `openspec/changes/testing-refoundation/tasks-part-2.md` task 4b.5.2.
- **Suggestion:** add an acceptance line citing the measured N and either the removed db steps (N=0) or the opened ledger rows and the resume condition (N>0).
- **Why deferred:** the line can only be written with the measured N, when slice 4b.5 runs.
- **To implement:** a prose edit in the tasks file named above, reviewed with the slice that next touches it.

### SB-026 — X2 decision rule ambiguity

- **Source:** review `trf-contract-7` (part 7 of the contract landing), reliability lens, finding `R3-X2-decision-rule-ambiguity`.
- **Location:** `openspec/changes/testing-refoundation/tasks-part-2.md` task X.2.1.
- **Suggestion:** restate the fork rule as "any hard criterion other than H5 failing keeps node:test" so no reader has to infer the two-failures case.
- **Why deferred:** the rule is total as written; the request is a second wording of the same rule.
- **To implement:** a prose edit in the tasks file named above, reviewed with the slice that next touches it.

### SB-027 — 1 11 3 env coupling

- **Source:** review `trf-contract-7` (part 7 of the contract landing), reliability lens, finding `R3-1-11-3-env-coupling`.
- **Location:** `openspec/changes/testing-refoundation/tasks-part-2.md` task 1.11.3.
- **Suggestion:** add a RED row where an unset `TEST_API_URL` fails fast with a named error, so the deleted `localhost:3000` default is proved gone.
- **Why deferred:** slice 1.11 carries its own red proofs and is planned in detail when it is next in the queue.
- **To implement:** a prose edit in the tasks file named above, reviewed with the slice that next touches it.

### SB-028 — four canon scripts repeat the `_common` bootstrap

- **Source:** review `hooks-canon-index` (`mental-map-hooks` 3a-i, lineage `review-d419d8af1b0cdde5`), readability lens, finding `R2-canon-finalize-import-ordering`.
- **Location:** `.claude/scripts/canon-finalize.py:34-41`, and the same two lines in `canon-staleness-report.py`, `omnipost-status.py` and `migrate-canon-index.py`.
- **Suggestion:** move the `sys.path.insert` plus `from _common import` pair into one helper, or say next to it that `sys` is imported at the top of the file.
- **Why deferred:** no behaviour changes. A helper module in the scripts directory would not resolve when the suite loads a script by path, so the pair is the smallest form that works both ways; how many scripts carry it depends on a pending decision about the report scripts that read paths which no longer exist.
- **To implement:** after that decision, with the scripts that remain: either one bootstrap the tests can also load, or closing this row with the count that is left.

### SB-029 — the `current` branch of the prompt line relies on an unnamed invariant

- **Source:** review `hooks-canon-staleness` (`mental-map-hooks` 3a-ii, lineage `review-b7a56b2c20984aaa`), readability lens, finding `R2-canon-line-implicit-invariant`.
- **Location:** `.claude/hooks-py/user_prompt_submit.py`, `canon_index_line`.
- **Suggestion:** say at the return that a `None` staleness result implies a parsed `synthesizedAt`, and that the index read guarantees `entries` is a dict.
- **Why deferred:** the invariant holds by construction and a violation would land in the catch-all two lines below; the request is one comment.
- **To implement:** one comment line; no code change.

### SB-030 — the catch-all of the prompt line does not say what it absorbs

- **Source:** same review, finding `R2-canon-line-broad-except`.
- **Location:** `.claude/hooks-py/user_prompt_submit.py`, `canon_index_line`.
- **Suggestion:** narrow the `except Exception`, or name in its comment that it also absorbs path-resolution faults.
- **Why deferred:** catching everything is the contract of the prompt line — it never crashes the hook and never goes silent, the error is logged and shown as STALE with its class, and a test pins that. Only the comment was short of the code.
- **To implement:** reword the comment; no code change.

### SB-031 — `DEAD_PATTERNS_NAMED` reads as a predicate

- **Source:** same review, finding `R2-dead-patterns-named-naming`.
- **Location:** `.claude/hooks-py/_common.py`, the module constant used by `canon_index_staleness`.
- **Suggestion:** a name that reads as a cap, such as `MAX_NAMED_DEAD_PATTERNS`, or a comment on the constant.
- **Why deferred:** naming only; one call site.
- **To implement:** rename the constant and its uses.

### SB-032 — the staleness report still says `synth` where its output says `date`

- **Source:** review `hooks-sweep-leftovers`, third round (lineage `review-536fb073acb8c708`), readability lens, finding `R2-synth-naming-mismatch`.
- **Location:** `.claude/scripts/canon-staleness-report.py`: the `--synth-days` flag, the locals `synth_age` and `stale_synth`, one comment.
- **Suggestion:** one vocabulary in the function: finish the rename to `date`, or go back to `synthesizedAt` everywhere.
- **Why deferred:** every surface a user reads already names the field the code compares, pinned by a test. Renaming the locals changes nothing observable; renaming the flag changes the command line, which is not a wording matter.
- **To implement:** rename the two locals and the comment; decide the flag separately, keeping the old spelling accepted if it is renamed.

### SB-035 — the override-bands gate explains itself twice

- **Source:** a rebase-round review of the stack at slice 0.10 (lineage `review-cd752169e41b423c`), readability lens, finding `R2-override-bands-gate-comment-density`; its text was lost with its receipt, so the entry records what the file shows.
- **Location:** `scripts/testing/override-bands-gate.mjs`, the header (64 lines), and the comment on the `Override bands` step of `.github/workflows/fitness.yml`.
- **Suggestion:** the WHY, ALLOWLIST and FAIL-CLOSED paragraphs appear in both places; keep them in one and point the other at it.
- **Why deferred:** prose only; which copy stays authoritative is an editorial choice, and the workflow side is a sensitive path.
- **To implement:** shorten the step comment to the reason the step lives in that job plus a pointer to the header, or the reverse.

### SB-036 — the `brace-expansion` floor row carries its whole history

- **Source:** the same review (lineage `review-cd752169e41b423c`), readability lens, finding `R2-security-canon-brace-expansion-row`; text lost with its receipt.
- **Location:** `docs/security/SECURITY_CANON.md`, the `brace-expansion` row of §"CVE-floor pins".
- **Suggestion:** a reader looking for the current floor reads five dated raises first.
- **Why deferred:** every statement in the row was re-checked on 2026-10-02 against `pnpm-workspace.yaml`, the parsed lockfile and the registry, and none is false; what remains is length and order.
- **To implement:** keep floor, bands, chain and remove-when in the row; move the dated advisory history to a per-floor note under the table.

### SB-037 — the `fast-uri` floor row is hard to scan

- **Source:** a rebase-round review of the stack at slice P.4 (lineage `review-87fb61a48b367a85`), readability lens, finding `R2-fasturi-row-scannability`; text lost with its receipt.
- **Location:** `docs/security/SECURITY_CANON.md`, the `fast-uri` row of §"CVE-floor pins".
- **Suggestion:** as SB-036.
- **Why deferred:** as SB-036; the row's bands, consumers with their declared ranges, publish dates and `latest` were re-measured on 2026-10-02 and all hold.
- **To implement:** the same split as SB-036, done for both rows together.

### SB-038 — the scan step's comment says the commit count is coloured on any stream

- **Source:** the review of slice P.4 (`workstream/refound-p-4`, 3ade5c22; lineage `review-81888e0e0c6ba77f`), readability lens, finding `R2-audit-comment-stream-coloring`.
- **Location:** `.github/workflows/audit.yml`, the comment above the secret-scan step, the sentence on gitleaks' `N commits scanned.` line: it counts only commits that add lines, so a deletion-only or merge-only pull request reports 0, "and is coloured on any stream".
- **Suggestion:** the colour remark is a second reason beside the one that matters; drop it or tighten it so the paragraph only says why the log is not parsed.
- **Why deferred:** prose in a comment; the step's verdict comes from git, the JSON report, the exit status and the error stream, none of which the remark touches.
- **To implement:** cut "— and is coloured on any stream" from that sentence, or replace it with the reason it was written, measured.

### SB-039 — the testing tracker is too long to read as a tracker

- **Source:** a rebase-round review of the stack at slice P.5 (lineage `review-93c21cabf03f1430`), readability lens, finding `R2-testing-refoundation-doc-length`; text lost with its receipt.
- **Location:** `docs/development/TESTING_REFOUNDATION.md`, 2111 lines on 2026-10-02: §Estado 325, §Toolchain lag 270, §OSV measurement 103, §Plan (fixed) 1330, §How to extend 40.
- **Suggestion:** the progress a reader comes for (metrics, work units, gates, decisions) sits inside a document dominated by the fixed plan and by measurement narratives.
- **Why deferred:** prose structure only. Moving the plan out touches every link into it and every slice of the stack that edits it; the split is its own change, not a line in a rebase.
- **To implement:** keep §Estado and the tables in the tracker; move §Plan (fixed) to a sibling file under `docs/development/` and the measurement narratives (toolchain lag, OSV) to `docs/reports/`, leaving one link each.

### SB-040 — the `webpack-dev-middleware` floor row has no per-version structure

- **Source:** the review of slice `0.11` (`workstream/refound-0-11`, e3c26b2e), readability lens, finding `R2-003`. The index row had no entry section; this entry text was reconstructed on 2026-10-05 from the index row.
- **Location:** `docs/security/SECURITY_CANON.md`, the `webpack-dev-middleware` row of §"CVE-floor pins".
- **Suggestion:** give the row a per-version structure — added against / installed / latest immature.
- **Why deferred:** not recorded with the index row; the finding is prose structure, the same class as SB-036 and SB-037.
- **To implement:** the per-version structure, done together with the SB-036 / SB-037 split.

### SB-050 — each `validateCode` names its credentials-merged object `config`

- **Source:** review `review-b1e3dfd3916d6f28` of night slice F6a (`workstream/env-secret-fallbacks`, `eb6bc726`), readability lens, finding `R2-config-spread-shadowing`.
- **Location:** `apps/api/src/auth/providerOAuthConfigs.ts`, the `const config = { ...this.config, ...requireCredentials(this) }` line of each of the eight `validateCode` bodies, and their `config.*` reads.
- **Suggestion:** name the merged local apart from the exported `OAuthConfig` (for example `authenticatedConfig`), or destructure the credentials, so a reader does not look for `clientId` on a type that no longer carries it.
- **Why deferred:** naming; the merged object and every read of it behave the same under either name, and the rename touches about thirty lines across eight functions.
- **To implement:** rename the local in the eight bodies, or read `{ clientId, clientSecret }` from `requireCredentials(this)` and the rest from `this.config`.

### SB-051 — `credentialsFromEnv` returns an unnamed `Pick<…>` type

- **Source:** review `review-ac79acc5d00d298c` of F6a merged after F7 (`workstream/env-secret-fallbacks`, `7d93feb9`), readability lens, finding `R2-credentialsfromenv-return-type-opaque`.
- **Location:** `apps/api/src/auth/providerOAuthConfigs.ts`, the return type of `credentialsFromEnv`.
- **Suggestion:** give the spread's shape a name, so a reader sees what the helper contributes to a provider without resolving `Pick<OAuthProvider, "credentials">`.
- **Why deferred:** naming; the type and every call site behave the same under either spelling.
- **To implement:** declare `type OAuthCredentialFields = Pick<OAuthProvider, "credentials">` beside `OAuthCredentials` and use it as the return type.

### SB-052 — the alias comment does not say that `module.path` depends on where the file sits

- **Source:** review `review-d18095cc939a06db` of item (v) PR1 (`workstream/item-v-cruiser`, `ba39279b`), readability lens, finding `R2-module-path-comment-misleading`.
- **Location:** `.dependency-cruiser-resolve.cjs:17`, the comment above the `@shared/types` alias: "`module.path` is this file's directory, the repository root."
- **Suggestion:** say that CommonJS `module.path` is the directory of this file and that the alias target is resolved relative to it, so the file must stay at the repository root or the alias path must move with it.
- **Why deferred:** prose only; the comment is true where the file stands and the alias target is right, so no behaviour changes. A move that leaves its pointer behind already fails loudly: `.dependency-cruiser.cjs` names the file in `webpackConfig.fileName`, and the gate exits 1 on a name with no file behind it (measured 2026-10-05).
- **To implement:** reword the comment as the suggestion says; no code change.

### SB-053 — the two `to.path` arrays do not say what each of their forms matches

- **Source:** review `review-d18095cc939a06db` of item (v) PR1 (`workstream/item-v-cruiser`, `ba39279b`), readability lens, finding `R2-forbidden-to-path-array-no-comment-on-regex-semantics`.
- **Location:** `.dependency-cruiser.cjs:141-168`, the `to.path` arrays of `core-domain-no-framework` and `core-application-no-infrastructure`.
- **Suggestion:** say in each array that the alias-name alternation matches an UNRESOLVED specifier (an import that fails to resolve keeps its written name) while the anchored `^packages/adapters/`, `^infra/` and `^packages/api-common/` prefixes match RESOLVED paths, and that both forms are needed.
- **Why deferred:** comment wording; the rules match the same imports whatever the comment says. The comment above the first array already says that `to.path` is matched against the resolved path, that a workspace adapter or the infra package resolves to a source path the alias names never match, and that the names still catch an import that fails to resolve; the second array points back at it. The finding asks for those facts at each array, in the words of the two forms.
- **To implement:** one sentence per array saying what the name alternation catches and what the anchored prefixes catch, so neither is taken for the redundant one.

### SB-054 — `PLANNED_STEPS` is raised by hand with every step

- **Source:** review `review-d18095cc939a06db` of item (v) PR1 (`workstream/item-v-cruiser`, `ba39279b`), readability lens, finding `R2-planned-steps-magic-number`.
- **Location:** `scripts/testing/battery.sh:34`, `PLANNED_STEPS=20`.
- **Suggestion:** derive the count from the `step` invocations, or check it against them before the first step runs, instead of keeping the number in step with them by convention.
- **Why deferred:** the shape is older than this change: the duplicate-code step (D42) moved the number from 18 to 19 the same way, and this change moved it from 19 to 20. A drift is loud, not silent: the verdict refuses a `steps.tsv` with any other number of rows (`expected N steps, found M`), so a step added without raising the number turns the battery RED, as the comment above the line says. Whether to derive the number is a decision for the battery's owner, not for a change that adds one step.
- **To implement:** derive it from the step list, or add a pre-run check; the api loop starts two steps from one `step` line, so counting source lines gives 19, not 20. The verdict's own count check stays either way.

### SB-055 — the architecture step's comment does not point at where a warn line turns RED

- **Source:** review `review-d18095cc939a06db` of item (v) PR1 (`workstream/item-v-cruiser`, `ba39279b`), readability lens, finding `R2-architecture-step-warn-vs-red-contract-buried`.
- **Location:** `scripts/testing/battery.sh:156-159`, the comment above `step architecture`.
- **Suggestion:** point the comment at the verdict's warn-line rule (`scripts/testing/battery-verdict.mjs`, pinned by `apps/api/tests/unit/scripts/batteryVerdict.test.ts`), so the "any warn line is RED" contract can be found from one place.
- **Why deferred:** comment wording; the comment already says the `warn`-severity rules print `warn` lines "which this battery reads as RED", and the script's header states the rule for every log: a warning anywhere in any log makes the verdict RED, with no allowlist and no waiver. The finding asks for the pointer to the rule's home, not for the rule.
- **To implement:** one clause in that comment naming the verdict module and its suite; no code change.

### SB-056 — `knip.json` lists the resolve file as an entry without saying why

- **Source:** review `review-d18095cc939a06db` of item (v) PR1 (`workstream/item-v-cruiser`, `ba39279b`), readability lens, finding `R2-knip-entry-cjs-config-file-unexplained`.
- **Location:** `knip.json:6`, the `.dependency-cruiser-resolve.cjs` entry of the root workspace.
- **Suggestion:** a local signal for why a `.cjs` file that no module imports is an entry: `.dependency-cruiser.cjs` reads it through `webpackConfig.fileName`.
- **Why deferred:** strict JSON carries no comments, so the signal needs the file renamed to `knip.jsonc` (knip reads it) for one line of prose. The explanation exists where the file is: the header of `.dependency-cruiser-resolve.cjs` says its `resolve` section reaches the resolver through the `webpackConfig` option of `.dependency-cruiser.cjs`.
- **To implement:** rename `knip.json` to `knip.jsonc` and put a `//` comment above the entry. The name appears in two scripts (`scripts/knip-ratchet.mjs:115`, a message, and `.claude/scripts/migrate-canon-index.py:133`) and in docs and specs that cite it, which follow the rename.

### SB-063 — LOGGING_CANON's `packages/core/**` row packs four statements into one cell

- **Source:** two reviews of item (v) PR v-d2 (`workstream/item-v-logger-port`, `beb017e1`), readability lens, the same suggestion: `review-0e1b0a09928ffaa3` (log `itemv3a2b`), finding `R2-logging-canon-core-row-prose-is-tangled`, and `review-f1691ed852d066ae` (log `itemv3a2d`), finding `R2-docs-table-row-awkward-phrasing`.
- **Location:** `docs/observability/LOGGING_CANON.md:19`, the `Why` cell of the `packages/core/**` row, whose second sentence reads "It implements the port as is, because the port uses Pino's `(context, message)` order".
- **Suggestion:** split the cell into the statements it makes — what the composition root passes, why that logger satisfies the port without an adapter, what `packages/core` never imports — and give "It" its subject, the logger the factory returns.
- **Why deferred:** wording; the rule is the same either way. `loggerPortContract.type-test.ts` pins the argument order and `loggerPortContract.test.ts` the written line, and item 5 of the canon's How to extend states the rule again in full sentences.
- **To implement:** for example: "The composition root passes the logger that `createLogger(name)` returns from the deployable's own factory. That logger satisfies the port without an adapter, because the port takes Pino's `(context, message)` order, so core entries carry the factory's redaction and `name`. `packages/core` never imports `@observability/logger` or `pino`, and the port exposes `warn` and `error` only."

### SB-064 — the retention service's header names the suite that pins it by path

- **Source:** review `review-f1691ed852d066ae` of item (v) PR v-d2 (`workstream/item-v-logger-port`, `beb017e1`; log `itemv3a2d`), readability lens, finding `R2-data-retention-doc-references-test`.
- **Location:** `packages/core/compliance/src/DataRetentionService.ts:7-12`, the header paragraph, which names `apps/api/tests/unit/compliance/DataRetentionService.test.ts` at `:10`.
- **Suggestion:** state the invariant where it lives — each run's counts reach `auditEmitter.emit({ action: "DATA_RETENTION_CLEANUP" })`, and the application layer logs WARN and ERROR only — without naming a test file, which can move and leave the comment stale.
- **Why deferred:** comment wording; the path is right today, and that suite's case `emits cleanup summary via AuditEmitterPort` (`:198-219`) pins the counts on the audit entry. The two rounds pull in opposite directions: `bd4e9376` put the audit call and the suite in the header to answer the round before, whose WARNING `R2-dataretention-doc-mismatch` (`review-d48267d0d8a7d331`) asked for a code reference. DEF-17 of `docs/product/MASTER_PLAN_ES.md` §5.11 changes what the sweep records on a failure, and with it this header.
- **To implement:** keep the audit call and drop or shorten the suite's path, in the change that takes DEF-17.

### SB-065 — the DLQ archival service does not say why only one of its two methods logs

- **Source:** two reviews of item (v) PR v-d2 (`workstream/item-v-logger-port`, `beb017e1`), readability lens: `review-0266f5fe272cd583` (log `itemv3a2`), finding `R2-dlq-archive-silent-sweep`, and `review-f1691ed852d066ae` (log `itemv3a2d`), finding `R2-dlq-archival-asymmetric-logging`, which asks for the first one's pointer at the class level.
- **Location:** `packages/core/webhooks/src/DlqArchivalService.ts`, the file header (`:1-10`) and the two method comments (`:21-25`, `:35-38`).
- **Suggestion:** say at the class level that `archiveResolvedEvents` returns its count and logs nothing while `flagStaleEvents` warns, because stale unresolved events need an operator, so a reader takes neither the silent sweep for a lost call nor the constructor's `LoggerPort` for half used.
- **Why deferred:** comment wording; the archive method's comment already says "The count is returned, not logged: a routine sweep asks nothing of an operator" (`:24`). DEF-18 of `docs/product/MASTER_PLAN_ES.md` §5.11 queues the failure side of that silence — both methods turn a port failure into `0` or `[]` — and its fix changes what the comment has to say.
- **To implement:** one class-level sentence, written in the change that takes DEF-18.

### SB-066 — `ComplianceService` takes nine positional parameters, the logger last

- **Source:** review `review-d48267d0d8a7d331` of item (v) PR v-d2 (`workstream/item-v-logger-port`, `beb017e1`; log `itemv3a2c`), readability lens, finding `R2-logger-param-position`.
- **Location:** `packages/core/compliance/src/ComplianceService.ts:85-95`, the constructor; its one production call is `apps/api/src/infrastructure/container/setupServices.ts:560-570`.
- **Suggestion:** a convention for services with many ports — the logger last among them — or one dependencies object for a service with five or more ports, so a reader of the call site does not count positions. The finding counts eight parameters; the constructor takes nine.
- **Why deferred:** constructor shape, not behaviour: the nine parameters are typed ports, and their one production call sits in the type-checked composition root. Item 5 of LOGGING_CANON's How to extend already places the logger "ahead of a trailing `unitOfWork`"; a service with nine ports and no `unitOfWork` is where that rule says nothing more.
- **To implement:** a sentence in that item naming the logger as the last port. A dependencies object is a constructor-injection shape the DI canon does not name, so it goes through an ADR.

### SB-071 — the trigger comment names `omni-post-cc` beside the glob patterns without saying what that branch is

- **Source:** review `review-bea8fdec80e55221` of the production-ci trigger (`workstream/production-ci-stacked-prs`, `80cc7e65`; log `review-prodci.log`), readability lens, finding `R2-001`.
- **Location:** `.github/workflows/production-ci.yml:8-9`, the two comment lines above the `pull_request` branch list `[main, omni-post-cc, "feature/**", "workstream/**"]`: "A stacked PR targets its parent branch and its retarget to main starts no run here, so without these patterns the PR lacks Test and Build, which main requires to merge."
- **Suggestion:** name the role of `omni-post-cc` in that comment, so a maintainer can tell whether it is a long-lived integration branch, a temporary bootstrap or an entry to remove, and a stale entry does not accumulate unnoticed.
- **Why deferred:** comment wording; the trigger is unchanged. The list mirrors `ci.yml`'s `pull_request` list verbatim (`ci.yml:11`), where `omni-post-cc` has stood without a comment since the Genesis commit (`5603d6be`, whose list was `[main, omni-post-cc]`), and four other workflows carry it — `ci.yml`, `security-testing.yml`, `audit.yml` and `fitness.yml` — none of which says what it is. A sentence in this file alone would explain one copy of five, and an edit to a workflow file takes a `sensitive-edit` token.
- **To implement:** find the branch's role (`git log --oneline -3 origin/omni-post-cc`, and the Genesis commit `5603d6be` that first listed it in `ci.yml`) and state it in the comment of all five workflows in one change, under one `sensitive-edit` token.

### SB-072 — the `typescript` catalog comment grew with re-measurement prose while its remove-when did not change

- **Source:** review `review-59c4d4badd3a842d` of @typescript-eslint 8.71.0 (`workstream/toolchain-ts-eslint-8-71`, `53e6cc0c`; log `review-tseslint.log`), resilience lens, finding `R4-002`.
- **Location:** `pnpm-workspace.yaml:94`, the comment on the `typescript` catalog entry (`6.0.3`), which now carries the 8.71.0 re-measurement: "re-measured 2026-10-05 on 8.71.0: the range is unchanged from 8.70.0 and 8.70.1, and the 8.71.1 alphas carry it too".
- **Suggestion:** keep the remove-when first in the comment — the hold lifts when an `@typescript-eslint` release admits `typescript` 7.x — and move the measurement history behind it, so a reader scanning for the rollback trigger does not parse past the re-measurement prose. The finding adds that no new failure mode is introduced; it is a signal-density observation.
- **Why deferred:** comment density; nothing in the comment is wrong. The remove-when did not change, and the canon's `typescript` row (`docs/security/SECURITY_CANON.md`, §"Build-tool version holds"), which the comment points to, carries it together with the full measurement.
- **To implement:** reorder that comment so the remove-when leads and the history follows; no value changes.

### SB-073 — the second crossing's bullet merges the install note, the maturity window and the peer-range measurement into one sentence

- **Source:** review `review-59c4d4badd3a842d` of @typescript-eslint 8.71.0 (`workstream/toolchain-ts-eslint-8-71`, `53e6cc0c`; log `review-tseslint.log`), readability lens, finding `R2-002`.
- **Location:** `docs/development/TESTING_REFOUNDATION.md:706-710`, the second item of "The five crossings" (`typescript` 6.0.3 → 7.0.2, HOLD). One sentence carries the install date, the maturity window and the peer-range measurement: "`@typescript-eslint/parser@8.71.0` and `@typescript-eslint/eslint-plugin@8.71.0` — installed since 2026-10-05, taken a few hours before their `17:09Z` / `17:13Z` maturity on Edward's instruction and tracked in `scripts/testing/maturity-watchlist.json` — still peer `typescript: ">=4.8.4 <6.1.0"`, byte-identical to 8.70.0's and 8.70.1's, and so do the 8.71.1 alphas."
- **Suggestion:** split the install note (the date, the maturity window, why the pair was taken early) from the peer-range measurement, and link `scripts/testing/maturity-watchlist.json` where the bullet names it, so the hold's remove-when is easier to trace against the canon row.
- **Why deferred:** prose structure; every fact in the sentence is right, and the canon row it mirrors (`docs/security/SECURITY_CANON.md`, the `typescript` row) says the same.
- **To implement:** two sentences, the install note and then the measurement, with the watchlist file linked; no value changes.

### SB-074 — the watchlist entry names one package of the `@typescript-eslint` family without saying why that one

- **Source:** review `review-a437cc3ade9afeef` of @typescript-eslint 8.71.0 (`workstream/toolchain-ts-eslint-8-71`, `53e6cc0c..dbbfeeb6`; log `review-tseslint2.log`), readability lens, finding `R2-002`.
- **Location:** `scripts/testing/maturity-watchlist.json:200-215`, the entry whose `name` is `@typescript-eslint/parser` (`:202`) and whose `members` (`:205-215`) list the nine siblings at 8.71.0; the review's `:183-203` are the same lines before the reviews merged in #420 moved the entry down. Neither the list's `description` (`:2`) nor the header of `scripts/testing/maturity-watchlist.mjs` (`:1-18`) says which package of a family becomes `name`.
- **Suggestion:** state the convention where the list's schema is described, so a maintainer reading a family entry knows why one package is singled out and a later bump of one sibling alone does not leave the grouping unexplained.
- **Why deferred:** documentation of the list's schema; `name` only forms the entry's id in messages and issue titles. The choice has a reason: the parser is the family's catalog entry, declared in two manifests (the root and `packages/eslint-plugin-testing`), while the plugin is a root literal that peers `@typescript-eslint/parser ^8.71.0`, and the other eight siblings come in through those two and `@vitest/eslint-plugin` (the lockfile parsed with `yaml.safe_load_all`). The pair cannot drift apart without that peer showing it at install, and the holds gate measures both packages separately (`scripts/testing/toolchain-population.json` names both). Writing the convention down changes the watchlist's documentation, a unit of its own, not a line inside a version bump.
- **To implement:** one sentence in the list's `description` and in the header of `maturity-watchlist.mjs`: a family enters as one entry, keyed on the package whose declaration drives its version, with the siblings released with it under `members` as `name@version`. Taken when the list's schema next changes.

### SB-075 — the entry's `entered.via` packs four facts into one sentence

- **Source:** review `review-a437cc3ade9afeef` of @typescript-eslint 8.71.0 (`workstream/toolchain-ts-eslint-8-71`, `53e6cc0c..dbbfeeb6`; log `review-tseslint2.log`), readability lens, finding `R2-003`.
- **Location:** `scripts/testing/maturity-watchlist.json:220`, `entered.via` of the same entry (the review's `:200-202`): one line naming the two manifest declarations that moved, the 6.9 days since publication, the 2.9 hours before the 17:09Z maturity and Edward's instruction of 2026-10-05. The finding counts 400 characters; the string carries 274.
- **Suggestion:** split it into structured sub-fields — the finding names `manifests`, `age_days`, `pre_maturity_hours` and `authorized_by` — or at least shorten it to the authorization, so an early adoption can be audited mechanically instead of by reading prose.
- **Why deferred:** every fact in the sentence is right and readable today, and no code reads `via`: `validate()` checks `entered.date`, `entered.commit` and `entered.pr`, and the reminder issue cites the same three. Sub-fields are a change to the list's schema — new shapes under `SHAPES.package.entered` in `scripts/testing/maturity-watchlist.mjs`, their `validate()` messages and cases in `apps/api/tests/unit/scripts/maturityWatchlist.test.ts` — and so a unit of their own, outside a version bump.
- **To implement:** add the sub-fields to `SHAPES.package.entered` with their `validate()` messages and suite cases, move the facts of the seven package entries' `via` into them in the same change, and name the fields in the list's `description`.

### SB-076 — the `prosemirror-view` canon row packs resolution, reachability, override reasoning and measurement into one cell

- **Source:** review `review-879c6d3e5109448e` of the audit floors of 2026-10-06 (`workstream/audit-floors-oct06`, `a0e2c374`; log `review-floors.log`), readability lens, finding `R2-canon-row-length`.
- **Location:** `docs/security/SECURITY_CANON.md:275`, the `prosemirror-view` row of §"CVE-floor pins". Its `Why (CVE floor)` cell is 2,454 characters (the finding counts about 2,200); the Floor cell carries the version (`1.42.6`) and the Why cell ends with the remove-when.
- **Suggestion:** break the dense cell into labelled sub-fields (the finding names `Why`, `Reachability`, `Measurement` and `Remove-when`) so each answers one question, as shorter rows such as `js-yaml` already stop at a sentence.
- **Why deferred:** prose structure; no value changes. The row follows the table's convention: `next` (2,588 characters, `:272`), the `@opentelemetry/instrumentation-*` row (2,557, `:286`) and `axios` (2,398, `:261`) are longer, and the dated-history notes under §"Floor history" exist for history, which a row added the same day has none of. The version and the remove-when sit where a reader scanning for them looks: the Floor cell and the end of the Why cell.
- **To implement:** lead each statement of the Why cell with a bold label, as its `**REACHABLE**` and `**Remove-when:**` already are: the resolution, the override reasoning, the side effects and the probe measurement. The table has fixed columns, so separate sub-fields are not available to one row.

### SB-077 — the `source-map-js` watchlist entry's `entered.via` ends on an elliptical clause with no full stop

- **Source:** review `review-879c6d3e5109448e` of the audit floors of 2026-10-06 (`workstream/audit-floors-oct06`, `a0e2c374`; log `review-floors.log`), readability lens, finding `R2-watchlist-entered-note-sentence`.
- **Location:** `scripts/testing/maturity-watchlist.json:240`, `entered.via` of the `source-map-js` entry (the review cites `:239`). The string is 642 characters and ends "…; the lesser deviation against a knowingly-red gate or an ignore the policy forbids for an advisory with a published fix", without a full stop.
- **Suggestion:** finish the clause, or split it into two sentences, so the justification of the deviation is self-contained for a future reader.
- **Why deferred:** prose precision; the clause is grammatical but terse, and no code reads `via` (`validate()` checks `entered.date`, `entered.commit` and `entered.pr`, as SB-075 records). The entry's own maturity review, due on 2026-10-07 (`milestones.maturity`, `:242`), rewrites that record and completes the sentence then.
- **To implement:** end the clause with what the deviation is lesser than, and a full stop, in that review.

### SB-078 — the `@opentelemetry/instrumentation-*` canon row and the eight override keys name each other only by glob

- **Source:** review `review-879c6d3e5109448e` of the audit floors of 2026-10-06 (`workstream/audit-floors-oct06`, `a0e2c374`; log `review-floors.log`), readability lens, finding `R2-override-key-count-mismatch-risk`.
- **Location:** `docs/security/SECURITY_CANON.md:286`, the `@opentelemetry/instrumentation-*` row (the review cites `:285`, the `@opentelemetry/core` row above it). Its Floor cell reads "8 targets, one per package (see Why)" and its Why cell lists the eight bands. The keys are `pnpm-workspace.yaml:253-260` (the review cites `:258-265`), under a comment that ends by naming the row (`:251-252`).
- **Suggestion:** enumerate the eight package names in the Floor cell, or add an explicit `See pnpm-workspace.yaml:258-265` pointer, so the authoritative set is unambiguous from the row alone; otherwise a later addition or removal, for example when `auto-instrumentations-node@0.79.0` lands and the row's remove-when fires, must re-sync two files by hand.
- **Why deferred:** the two already point at each other: the override block's comment names the row, the row's Why cell names all eight bands with their versions (`cassandra-driver` 0.66.0 to `tedious` 0.40.0), and `scripts/testing/override-bands-gate.mjs` holds each band's `pkg@<X: X` shape. A count drift would show in the row's own text at the next raise. No value changes.
- **To implement:** put the eight package names and versions in the Floor cell in place of "see Why", or point at the override block by its comment rather than by line numbers; either keeps the set readable from the row alone.

### SB-079 — the `storybook` hold row lists six packages and a Reason cell of 2,369 characters

- **Source:** review `review-dc438804c734560d` of slice 0.22 PR C (`workstream/0-22-c-runner`, tip `348480bb`; second-round review of commit `4b98772a`; log `review-cs1.log`), readability lens, finding `R2-storybook-row-readability`.
- **Location:** `docs/security/SECURITY_CANON.md:401`, the `storybook` row of §"Build-tool version holds" (the review cites the whole table, `:397-414`; the row is still at `:401` at the tip). Its Package cell names `storybook`, `@storybook/addon-a11y`, `@storybook/addon-docs`, `@storybook/addon-vitest`, `@storybook/nextjs` and `@storybook/nextjs-vite` (140 characters; the next widest, the `vitest` row, is 98), and its Reason cell is 2,369 characters (the next longest, the `msw` row, is 1,281).
- **Suggestion:** split the Vite and webpack frameworks into their own rows, or at least break the Reason prose into bullets, so a row compares against its neighbours again.
- **Why deferred:** table layout; the hold, its floor and its remove-when do not change. The six packages are one hold because the family moves as one change (the row's remove-when: "the six move to `10.6.1` ... as one change"), and the row says the webpack framework `@storybook/nextjs` "stays for `apps/admin` alone", the consumer whose Storybook PR D deletes. A table cell takes no bullets.
- **To implement:** in the change that next rewrites the row, the family's move to `10.6.1` that its remove-when schedules or PR D, whichever lands first: drop `@storybook/nextjs` and the sentences about the webpack framework once nothing uses it, and move the dated measurements behind the remove-when.

### SB-082 — the gate inventory's `Story runner` row has an unescaped pipe and sets the width of all 18 rows

- **Source:** review `review-04c9222c2f2b23b3` of slice 0.22 PR C (`workstream/0-22-c-runner`, tip `348480bb`; second-round review of commit `31da136f`; log `review-cs5.log`), readability lens, finding `R2-testing-refoundation-table-rewrap`.
- **Location:** `docs/development/TESTING_REFOUNDATION.md:352-371`, the gate inventory table: header `:352`, eighteen data rows, the `Story runner (D29)` row at `:371`; the same lines at `31da136f` and at the tip.
- **Suggestion:** normalise the column widths, or split the wide `Red proof` cells into bullet lists, because the final `PR` column now holds hundreds of trailing spaces on every row and each row is one line thousands of columns long.
- **Why deferred:** layout, and that half is prettier's: the padding is its table alignment (`.prettierrc` sets no `proseWrap`), so widths normalised by hand do not survive `format:check`. The rewidening has a second cause, found when booking: the `Story runner` row still holds one unescaped pipe, the first of its three red-proof counts (`1 failed | 58 passed (59)`; the other two read `1 failed, 58 passed (59)`). A GFM parser ends the cell there, so the row has five cells under the four-column header: its Red proof cell stops after `1 failed`, the rest of that text fills the `PR` cell, and the row's own `PR` value is dropped. That overflow is what pads the `PR` column to 1,363 characters (113 at the parent commit, where the other rows were 3,291 columns wide; at `31da136f` every row is 4,541).
- **Implemented (part):** `e472aaa9` on `workstream/0-22-c-runner` (2026-10-06) writes the comma, and prettier re-pads the table to its real widths; the Red proof cell's length stays deferred.
- **To implement:** escape that pipe (`\|`) or write a comma as the other two counts do. The `PR` column then pads to 64 characters and the row renders its own `PR` cell (measured on a scratch copy with prettier 3.9.9 and `marked` 15). The table then stays 4,607 columns wide, because the row's Red proof cell is 4,236 characters against at most 2,871 for every other row; shorten that cell for the layout the finding asks for.

### SB-083 — a restored earlier Playwright cache is not shown to leave the job on the new driver's browser

- **Source:** review `review-04c9222c2f2b23b3` of slice 0.22 PR C (`workstream/0-22-c-runner`, tip `348480bb`; second-round review of commit `31da136f`; log `review-cs5.log`), resilience lens, finding `R4-002`.
- **Location:** `.github/workflows/ci.yml:825-828` at `31da136f` (`:827-829` at the tip): the comment above `restore-keys` and the `restore-keys` of the `Cache Playwright browsers` step in the `stories` job, `${{ runner.os }}-playwright-`.
- **Suggestion:** none requested; the finding is "a resilience observation rather than a blocker". `restore-keys` lets a version bump recover an earlier driver's cache and have `playwright install` fetch only the missing browser, but a restored cache that already holds the new browser's directory tree could satisfy `playwright install`'s skip heuristics and leave the job running with the previous driver's binaries. "No concrete failure is proven here from the patch alone."
- **Why deferred:** no failure is shown, by the finding's own account. The key carries the driver version (`:824`), `playwright install --with-deps chromium` runs after every restore (`:833`), and the comment above `restore-keys` states the mechanism: a version bump restores the previous revision's cache and `playwright install` fetches only the missing browser. The stories step reports a missing browser as exit 1 with "Executable doesn't exist" (PR C's red proof), so an absent revision stops the job instead of substituting another.
- **To implement:** if a stale restore is ever observed, delete `restore-keys`, so a version bump starts from an empty cache and `playwright install` downloads the browser in full, which is the cost the comment at `:825-826` avoids.

### SB-084 — an unparsable persisted `expiresAt` never compares as past and nothing records it

- **Source:** review `review-f5fbb0b1b44ac8a4` of unit B (`workstream/cred-b-channel-credentials`, `a6fd8183`; log `review-b.log`), resilience lens, finding `R4-003`.
- **Location:** `packages/core/domain/src/entities/Channel.ts:47-57`, `readExpiry` (the review cites `:46-51`), which returns `new Date(value)` for any string; it is read by `areCredentialsExpired` at `:384-387`.
- **Suggestion:** a log line or a metric when the stored `expiresAt` is a string that does not parse, so a corrupted channel is flagged instead of surfacing only when a publish attempt returns 401. The finding notes that the doc comment already says such a value "never compares as past".
- **Why deferred:** the domain layer logs nothing by canon (LOGGING_CANON: "Domain layer: zero logging"), so the entity cannot record it. The behaviour is stated in the doc comment (`:47-51`) and pinned by a test added in B.1 (the finding's sibling `R3-003`), and a malformed expiry is the typed per-provider credentials contract's rejection at the boundary (§2F slice 1, DEF-36), which unit B leaves out on purpose.
- **To implement:** reject an unparsable `expiresAt` where credentials enter, in the typed contract of §2F slice 1; the entity needs no change.

### SB-085 — the POST handler's comment says sent credentials passed the invariant, which an omitted or empty object did not

- **Source:** review `review-7b97174154baea37` of unit B.1 (`workstream/cred-b1-credential-invariant`, `d67733ed`; log `review-b1.log`), readability lens, finding `R2-001`.
- **Location:** `apps/api/src/channels/channelRoutes.ts:267-269`, the comment above `Channel.reconstitute` in the POST handler: "`reconstitute`, not `Channel.create()`: a channel registered ahead of its OAuth grant starts PENDING with `{}`, which `create()` refuses. Sent credentials passed the same invariant above and are stored exactly as sent." (the review cites `:267`).
- **Suggestion:** say that the last sentence holds only when the request carried credentials with at least one key: the gate at `:252` skips validation for an omitted or `{}` value, which is stored as sent without being checked, so a maintainer tracing the difference between POST (an empty object is allowed) and PUT (it is rejected) does not have to re-derive it from the gate.
- **Why deferred:** prose precision; no value or behaviour changes. The comment's first sentence already says that `{}` is what a PENDING channel starts with, and the gate's `Object.keys(credentials).length > 0` clause carries the exemption.
- **To implement:** reword the last sentence: sent credentials with a key passed the invariant above and are stored exactly as sent; an omitted or empty value is stored as `{}` without a check.

### SB-086 — the POST gate does not say that the body schema keeps `null` and non-objects out of `Object.keys`

- **Source:** review `review-7b97174154baea37` of unit B.1 (`workstream/cred-b1-credential-invariant`, `d67733ed`; log `review-b1.log`), readability lens, finding `R2-002`.
- **Location:** `apps/api/src/channels/channelRoutes.ts:252-255`, the gate `if (credentials !== undefined && Object.keys(credentials).length > 0)` that runs `Channel.validateCredentials` (the review cites `:252`).
- **Suggestion:** a one-line comment saying that the parse schema narrows `credentials` (`Object.keys(null)` throws and `Object.keys("x")` returns index strings), or passing the raw value straight to `Channel.validateCredentials`, which takes `unknown`, so a local reader can tell whether the gate is defensive or relies on an invariant held elsewhere.
- **Why deferred:** the gate relies on an invariant held by the body schema, and the invariant holds: both schemas declare `credentials: z.record(z.string(), z.unknown()).optional()` (`:41` and `:48`), so `null`, a string or an array is a 400 at parse and never reaches `Object.keys`. Only the comment is missing. The finding's second remedy would reject `{}`, the PENDING hand-off, so it is a behaviour change, not a prose one (see SB-088).
- **To implement:** a one-line comment above the gate: the body schema (`:41`) leaves `credentials` a record or absent, and `{}` skips the check on purpose.

### SB-087 — the `Channel` class doc states the credentials invariant without its top-level qualifier

- **Source:** review `review-7b97174154baea37` of unit B.1 (`workstream/cred-b1-credential-invariant`, `d67733ed`; log `review-b1.log`), readability lens, finding `R2-003`.
- **Location:** `packages/core/domain/src/entities/Channel.ts:117`, the class-level invariant "A channel's credentials must be a non-empty object with no missing or blank value", against the `@method validateCredentials` block at `:175-185`, which adds that only top-level values are inspected and that numbers, booleans, arrays and nested objects are accepted.
- **Suggestion:** mirror the "top-level values" qualifier in the class-level line, or link it to `Channel.validateCredentials`, so the invariant is single-sourced and the two descriptions cannot drift.
- **Why deferred:** docstring wording; the class-level line is accurate and shorter, no value or behaviour changes, and the `validateCredentials` block is the authoritative statement.
- **To implement:** add "top-level" to the class-level line (no missing or blank top-level value), or end it with a pointer to `Channel.validateCredentials`.

### SB-088 — non-object credentials on POST are kept out by the body schema, not by the gate

- **Source:** review `review-7b97174154baea37` of unit B.1 (`workstream/cred-b1-credential-invariant`, `d67733ed`; log `review-b1.log`), reliability lens, finding `R3-001`.
- **Location:** `apps/api/src/channels/channelRoutes.ts:252-256`, the POST gate (`:252-255`), and the body schemas at `:41` and `:48`.
- **Suggestion:** validate whenever `credentials !== undefined`, as the update branch does, so a string, an array or `null` in the body is a 400 at the boundary and `reconstitute` is left to accept only the empty-object PENDING case. The finding reads the current gate, which validates only when the object has a key, as letting non-objects fall through to `reconstitute` and be persisted raw.
- **Why deferred:** the premise does not hold, as SB-086 shows: both body schemas declare `credentials` as `z.record(z.string(), z.unknown()).optional()`, so a string, an array or `null` is a 400 at parse and never reaches the gate. Validating whenever `credentials` is sent would also reject `{}`, which POST accepts for the OAuth hand-off (an omitted or `{}` value still registers the PENDING channel), so the finding's remedy is a behaviour change, not a prose one. The update branch is stricter on purpose: storing credentials there replaces the stored ones whole.
- **To implement:** the one-line comment of SB-086; the gate itself stays.

## Entries — tests

### SB-T01 — a bare repository's `--git-common-dir` is not named `.git`

- **Source:** review `hooks-1aii3`, reliability lens.
- **Location:** `.claude/hooks-py/_common.py:67-68` (`_main_repository_root`).
- **Suggestion:** a test where git resolves a common dir whose basename is not `.git` (bare repo `<name>.git`), asserting the fallback slug.
- **Why deferred:** a hook never runs inside a bare repository — Claude Code runs them from a worktree — so the branch is a guard, not a behaviour; the fallback it reaches is the one `test_falls_back_to_project_root_without_git_and_does_not_cache_it` already proves.
- **To implement:** `git init --bare` fixture + `PROJECT_ROOT` patched to it; assert the fallback slug and the one-time warning.

### SB-T02 — `CalledProcessError` and `TimeoutExpired` fallbacks are only proved through `OSError`

- **Source:** review `hooks-1aii3`, reliability lens.
- **Location:** `.claude/hooks-py/_common.py:57-62` (`_main_repository_root` except clause).
- **Suggestion:** inject `subprocess.CalledProcessError` (git outside a repo) and `subprocess.TimeoutExpired` and assert the same fallback-and-warn-once behaviour.
- **Why deferred:** the three exceptions share one `except` arm and one return; the behaviour is proved once through `OSError`.
- **To implement:** parametrise the existing fallback test over the three exception types.

### SB-T03 — a tab inside a session id or key would corrupt the marker

- **Source:** review `hooks-1d`, reliability lens.
- **Location:** `.claude/hooks-py/_common.py`, `notice_already_sent` (`f"{session_id}\t{key}"`).
- **Suggestion:** assert or escape tabs in identifiers; no test covers a tab-bearing session id.
- **Why deferred:** session ids are opaque UUIDs from Claude Code and keys are built from constants; a tab cannot reach the marker today.
- **To implement:** reject or escape `\t` in both fields and add the negative test.

### SB-008 — no RECOVERED notice after a transient UNREADABLE

- **Source:** review `hooks-1d2`, resilience lens, 2026-10-01.
- **Location:** `.claude/hooks-py/_common.py`, `emit_missing_file_context` (dedup key `tag:name:state`).
- **Suggestion:** once UNREADABLE was notified in a session, a later successful load is silent, so the model keeps a stale "blind" line; emit a RECOVERED notice on the first successful load after a failure marker, or key the dedup on the exact error.
- **Why deferred:** design choice; the stale line is conservative (the model treats the index as unreliable) and the next session starts clean.
- **To implement:** on a successful `load_index`, if the session has a MISSING/UNREADABLE marker, emit one `RECOVERED` line and record it.

### SB-009 — `hook_event` defaults to PreToolUse

- **Source:** review `hooks-1d2`, readability lens.
- **Location:** `.claude/hooks-py/_common.py`, `emit_missing_file_context(hook_event="PreToolUse")`.
- **Suggestion:** a future UserPromptSubmit caller that forgets the argument emits the wrong `hookEventName`; make it required or name the default.
- **Why deferred:** both real callers are PreToolUse hooks; the prompt hook prints its own line.
- **To implement:** make `hook_event` keyword-only and required; update the two callers and the tests.

### SB-010 — the two `load_index` helpers have different signatures

- **Source:** review `hooks-1d2`, readability lens.
- **Location:** `.claude/hooks-py/pre_edit_decision_guard.py`, `load_index(pattern_ids_text, session_id="")` vs the canon hook's `load_index(session_id="")`.
- **Suggestion:** the guard's loader takes a label only to interpolate it into the blindness message; pass the matched patterns (or a formatter) and keep the pair symmetric.
- **Why deferred:** naming/shape; the label is what the consequence line needs and the tests name it.
- **To implement:** `load_index(session_id="", *, consequence_for=...)` or a small formatter passed in.

### SB-T04 — `_notice_field` escapes tabs and backslashes, not newlines

- **Source:** review `hooks-sweep`, reliability lens (pre-existing exposure, not worsened).
- **Location:** `.claude/hooks-py/_common.py`, `_notice_field`.
- **Suggestion:** a newline inside a session id or key would split a record across lines; escape `\n` as well and extend the collision test.
- **Why deferred:** session ids are opaque UUIDs from Claude Code and keys are built from constants.
- **To implement:** one more `.replace`, one more assertion.

### SB-033 — the alignment test does not say what its separator is

- **Source:** review `hooks-sweep-leftovers`, third round (lineage `review-536fb073acb8c708`), readability lens, finding `R2-list-operations-column-fragility`.
- **Location:** `.claude/hooks-py/tests/test_omnipost_allow.py`, `test_descriptions_start_at_the_same_column`.
- **Suggestion:** a comment naming the string the test searches for as the description separator `list_operations()` writes, or one constant shared with the CLI.
- **Why deferred:** prose and naming; the assertion and its coverage do not change.
- **To implement:** one comment line, or a module constant in `omnipost-allow` that the test imports.

### SB-041 — the sanitizer test builds its template engine over an anonymous empty client

- **Source:** review `js1` of slice `0.12` (lineage `review-6c25280721a8aebf`), readability lens `R2-001` and reliability lens `R3-prisma-shape-fragile`, the same suggestion from two lenses.
- **Location:** `apps/api/tests/unit/security/sanitizerOutputs.test.ts`, `const unusedPrisma = {} as unknown as PrismaClient`.
- **Suggestion:** a named stub factory (or a typed stub holding only the members the constructor touches), so the reason the engine runs without a database is in a name, and a constructor that starts reading a client member fails with a message about the stub, not a bare TypeError.
- **Why deferred:** readability only. The cast is the convention of 54 files under `apps/api/tests`, the line carries a comment saying `sanitize` never reaches the database, and the constructor only stores the client today (`ServerTemplateEngine.ts:124`). A constructor that read a member would fail every case at construction, loudly, never as a false pass.
- **To implement:** one factory beside the test (or in a shared test helper used by the other 53 files), and one call site.

### SB-042 — the sanitizer test's `templateEngine` field holds HTML, not an engine

- **Source:** review `js1` of slice `0.12` (lineage `review-6c25280721a8aebf`), readability lens, finding `R2-002`.
- **Location:** `apps/api/tests/unit/security/sanitizerOutputs.test.ts`, the `SanitizerCase` interface and the 27 rows of `CASES`.
- **Suggestion:** rename the field `templateEngine` to `templateEngineHtml`, symmetric with `validatorHtml`.
- **Why deferred:** naming only; the field's JSDoc already reads "Observed output of `ServerTemplateEngine.sanitize(input)`", and no assertion changes.
- **To implement:** one rename across the interface, the 27 rows and the destructuring in the test body.

### SB-043 — the bundle analyzer still types its manifest and lockfile as `any`

- **Source:** third review of replacement slice (i-a) (commit `29077cb2`), readability lens, finding `R2-packagejson-any-field`.
- **Location:** `quality/scripts/bundle-analyzer.ts`, `private packageJson: any;` and `private lockfile: any;`.
- **Suggestion:** give both fields the shape the analyzer reads (or `unknown` with guards), now that the new `runCommand: CommandRunner` field beside them is typed.
- **Why deferred:** pre-existing and outside this slice's change: the slice did not touch either field or the code that reads them, and typing them changes no behaviour. `quality/scripts` is in no tsconfig, so fitness #3 does not see it.
- **To implement:** two field types plus the guards at the points where the parsed JSON is read.

### SB-044 — the hook test splits the planted credential's key across three literals

- **Source:** review of night slice N3 (commit `fec21f88`), readability lens, finding `R2-test-secret-content-concat`.
- **Location:** `.claude/hooks-py/tests/test_post_edit.py`, `SECRET_CONTENT`.
- **Suggestion:** build the key name once (a named constant joined at run time) and interpolate it, keeping the source free of a detectable credential.
- **Why deferred:** readability of a fixture; the split is what keeps the file from tripping the scanner it tests, the comment above it says so, and the suite proves the fixture is detected (the AWS rule names it in three cases).
- **To implement:** one constant and one f-string.

### SB-045 — the hook's argv test checks the flags' presence, not their position

- **Source:** review of night slice N3 (commit `fec21f88`), reliability lens, finding `R3-003`.
- **Location:** `.claude/hooks-py/tests/test_post_edit.py`, `test_the_command_passes_the_path_verbatim_with_both_selection_flags`.
- **Suggestion:** assert the complete argv, so a reorder that put the path before the flags is caught.
- **Why deferred:** no behaviour depends on the order today: secretlint parses flags anywhere on the line, and the three end-to-end cases run the real binary with the real argv, so a reorder that broke selection would fail them.
- **To implement:** replace the three `assert*` lines with one `assertEqual` on the argv.

### SB-046 — the baseline's fingerprints say nothing about the clones they forgive

- **Source:** review `review-e42ff63c1b339429` of night slice N4 (commit `4948650c`, rebased as `778aad25`), readability lens, finding `R2-baseline-opaque-fingerprints`.
- **Location:** `.jscpd-baseline.json`, the keys of `fingerprints`.
- **Suggestion:** make the baseline readable, for example with a generated file that maps each fingerprint to its clone's paths.
- **Why closed:** the readable view is the gate's own output, which names every clone's paths and marks `[NEW]` on each run; a second, generated mapping file would drift from the baseline it explains.

### SB-047 — `failOnEmpty` turns a misconfigured scan into a red build

- **Source:** review `review-e42ff63c1b339429` of night slice N4 (commit `4948650c`, rebased as `778aad25`), resilience lens, finding `R4-fail-on-empty-risk`.
- **Location:** `.jscpd.json`, `failOnEmpty: true`.
- **Suggestion:** add a diagnostic that tells "no files scanned because of a misconfiguration" apart from a duplication regression, instead of one binary failure.
- **Why closed:** failing closed on an empty scan is deliberate: a gate that reads nothing must not report green, the rule fitness #36 and #44 follow, and a misconfiguration is exactly what it should stop; jscpd's own message already names the cause ("jscpd analyzed no files (--fail-on-empty)"), distinct from its new-clone error.

### SB-048 — the lockfile diff is generated and unreviewable by eye

- **Source:** review `review-e42ff63c1b339429` of night slice N4 (commit `4948650c`, rebased as `778aad25`), reliability lens, finding `R3-pnpm-lock-generated`.
- **Location:** `pnpm-lock.yaml`.
- **Suggestion:** give the reviewer a way to trust the generated lockfile change.
- **Why closed:** the battery runs `pnpm install --frozen-lockfile` and `pnpm audit` on every candidate, CI's `Dependency Consistency` job runs `pnpm dedupe --check`, and the commit message and D39 (b) carry the lockfile delta in snapshots (61 out, 9 in).

### SB-049 — the inventory keeps the deleted `jscpd.json` in its rows

- **Source:** review `review-e42ff63c1b339429` of night slice N4 (commit `4948650c`, rebased as `778aad25`), readability lens, finding `R2-unused-code-inventory-stale`.
- **Location:** `docs/reports/UNUSED_CODE_INVENTORY.md`, the `jscpd.json` rows of §4.5 and §8.1.
- **Suggestion:** drop or rewrite the rows that describe a file which no longer exists.
- **Why closed:** the inventory is an audit record; a resolution is appended in the row it resolves, as D35 did in `7f4f6e0b`, so the finding and its outcome stay side by side.

### SB-057 — the verdict suite pins the architecture step's clean log but no error log

- **Source:** review `review-d18095cc939a06db` of item (v) PR1 (`workstream/item-v-cruiser`, `ba39279b`), reliability lens, finding `R3-batteryverdict-architecture-fixture-coverage`.
- **Location:** `apps/api/tests/unit/scripts/batteryVerdict.test.ts:257-274`, `returns GREEN over the architecture step's clean log`.
- **Suggestion:** a RED case beside it built from a real error log: an `error no-circular: …` record and the summary `x N dependency violations (1 errors, 0 warnings)`.
- **Why deferred:** no reading is left unproven. A failing step is pinned by `returns RED naming the step when one step exits non-zero`, and dependency-cruiser's `warn` line and its summary line by two rows of the RED table (`dependency-cruiser's`, `dependency-cruiser's summary`). A log of the suggested shape reads RED for exactly those two reasons, `step architecture exit 1` and `1 warning line(s)` (the summary carries the word `warnings`), measured 2026-10-05; the new case would run their combination over one realistic log.
- **To implement:** one case in the same `describe`: `steps` with `architecture` at exit 1, and an `architecture.log` holding the `error no-circular:` record with its continuation lines and the summary line; assert RED and both reasons.

### SB-058 — `--output-type err` is read as keeping `warn` lines out of the architecture log

- **Source:** review `review-d18095cc939a06db` of item (v) PR1 (`workstream/item-v-cruiser`, `ba39279b`), reliability lens, finding `R3-battery-architecture-warn-no-assertion`.
- **Location:** `scripts/testing/battery.sh:156-159`, the comment above `step architecture`.
- **Suggestion:** assert that the `warn` lines the step comment mentions can reach the log; the finding assumed `--output-type err` emits error-severity violations only.
- **Why closed:** the premise is false, measured 2026-10-05 on the candidate's tree: a planted orphan, `packages/shared/src/zzOrphanProbe.ts` (the `no-orphans` rule is warn-severity), made `pnpm check:architecture` print `warn no-orphans: packages/shared/src/zzOrphanProbe.ts` and `x 1 dependency violations (0 errors, 1 warnings). 1685 modules, 7325 dependencies cruised.` and exit 0. The `err` reporter prints every severity and only the exit code is error-only, so both lines reach `architecture.log`; the verdict's warn-line rule reads each as RED, and its suite pins both forms (`warn no-orphans: …` and the `x N dependency violations (0 errors, N warnings)` summary). The step comment is accurate as written.

### SB-059 — the billing suite asserts one of the service's fourteen logger calls

- **Source:** two reviews of item (v) PR v-d1 (`workstream/item-v-logger-a`, `0986c8ad`), reliability lens, the same suggestion: `review-476cc1c6a49fadfa` (log `itemv3a1`), finding `R3-single-error-path-covered`, and `review-a085bbeff6850b14` (log `itemv3a1c`, after the rebase), finding `R3-004`.
- **Location:** `apps/api/tests/unit/billing/GatewayBillingService.test.ts:384-396`, the one case that asserts the injected logger; the service's other calls are at `packages/core/billing/src/GatewayBillingService.ts:249, 287, 318, 361, 437, 494, 554, 615, 666, 697, 920, 925, 996` (eleven more `error` calls, and the two `warn` calls at `:318` and `:920` for the cancellation and dunning emails).
- **Suggestion:** assert the injected logger at every catch site, so a site that stops reporting its cause fails a test.
- **Why deferred:** extra coverage of a path already exercised: every site writes through the one `logger` field the constructor takes, and the case at `:384-396` proves that field end to end; the port's argument order and the written line are pinned by `apps/api/tests/unit/lib/loggerPortContract.type-test.ts` and `loggerPortContract.test.ts`. What each other site adds is its own context fields and message, which change no return value.
- **To implement:** one case per site: the collaborator throws, or `emailPort.send` rejects for the two warnings, and the case asserts the returned error and the injected logger's `{ err: cause, … }` and message.

### SB-060 — no case pins the API logger's line for a logger without a name

- **Source:** two reviews of item (v) PR v-d1 (`workstream/item-v-logger-a`, `0986c8ad`), reliability lens, the same suggestion: `review-476cc1c6a49fadfa` (log `itemv3a1`), finding `R3-bindings-formatter-conditional`, and `review-a085bbeff6850b14` (log `itemv3a1c`), finding `R3-003`.
- **Location:** `apps/api/src/lib/logger.ts:48-55`, the `bindings` formatter, which spreads `name` only when it is present (`:53`); the positive case is `apps/api/tests/unit/logger.test.ts:39-54`.
- **Suggestion:** a case for a logger built without a name (its line carries no `name` key) and one for a child logger (its line keeps the parent's `name` beside the child's bindings).
- **Why deferred:** the omission branch has no caller in the tree: `createLogger(name: string)` requires a name, and every pre-built logger passes one. Both behaviours were measured on 2026-10-05 with the same formatter on the installed pino 10.3.1: a logger without a name writes no `name` key, and a child of a named logger keeps the parent's `name` beside its own bindings. The cases would pin that measurement, not change it.
- **To implement:** two cases beside `should include the name in log bindings`, through the same capture, or through the shared one SB-062 proposes.

### SB-061 — the type tests stay out of vitest by their file name alone

- **Source:** review `review-8efd780a24d196da` of item (v) PR v-d1 (`workstream/item-v-logger-a`, `0986c8ad`; log `itemv3a1b`), reliability lens, finding `R3-type-test-collector-fragility`.
- **Location:** `apps/api/vitest.config.ts:53-54`, the `include` and `exclude` globs, and the four `*.type-test.ts` files under `apps/api/tests/unit`: `lib/loggerPortContract`, `infrastructure/container/containerSetupOptionsContract`, `infrastructure/repositories/customerCredentialWriteContract` and `security/tenantScopedQueryContract`.
- **Suggestion:** exclude `**/*.type-test.ts` from the collector explicitly, or give each type test a shape that is harmless at run time, so a wider include glob cannot collect them.
- **Why deferred:** no behaviour changes. The include globs (`tests/unit/**/*.test.ts`, `tests/eval/**/*.test.ts`) do not match the `.type-test.ts` suffix, `tsconfig.type-tests.json` compiles the four files in the package's `typecheck`, and the header of `loggerPortContract.type-test.ts` states the reliance. A glob that admitted them would fail at collection rather than pass: the logger type test reads two `declare const` bindings at run time, a `ReferenceError` on import. The convention is older than item (v): the other three files date from 2026-09-09, 2026-09-11 and 2026-09-23.
- **To implement:** add `"**/*.type-test.ts"` to `test.exclude` in `apps/api/vitest.config.ts`; fitness #36 reads only `include` arrays, so the exclusion needs no fixture.

### SB-062 — the name-binding case reads pino's destination without the contract suite's guard

- **Source:** review `review-8efd780a24d196da` of item (v) PR v-d1 (`workstream/item-v-logger-a`, `0986c8ad`; log `itemv3a1b`), reliability lens, finding `R3-pino-internal-symbol-dependency`. The next round raised it to a WARNING, `R3-002` of `review-a085bbeff6850b14` (log `itemv3a1c`), which `0986c8ad` fixed for the contract suite; this row keeps what that commit left.
- **Location:** `apps/api/tests/unit/logger.test.ts:39-54`, `should include the name in log bindings`, which spies on `Reflect.get(testLogger, pino.symbols.streamSym)` with no check; the guarded capture is `portFromFactory` in `apps/api/tests/unit/lib/loggerPortContract.test.ts:28-47`.
- **Suggestion:** capture the written line through a destination the test owns rather than through `pino.symbols.streamSym`, in both suites.
- **Why deferred:** test robustness, not behaviour. The case cannot pass in silence: an unresolved destination makes `vi.spyOn` throw, and an empty capture fails `expect(line?.name).toBe("my-service")`. What it lacks is the contract suite's error naming the cause. `pino.symbols` is pino's exported surface, and pino 10.3.1 resolves the destination through it.
- **To implement:** move the guarded capture into a shared test helper used by both suites, or give `createLogger` an optional destination for tests; the second changes the factory's signature, not what it does for the callers that pass none.

### SB-067 — the role service's suite asserts one of its four logger calls

- **Source:** review `review-f1691ed852d066ae` of item (v) PR v-d2 (`workstream/item-v-logger-port`, `beb017e1`; log `itemv3a2d`), reliability lens, finding `R3-004`.
- **Location:** `packages/core/auth/tests/unit/RoleManagementService.test.ts:188-200`, the `deleteRole` case; the other calls are `packages/core/auth/src/RoleManagementService.ts:137` (`createRole`), `:178` (`updateRole`) and `:212` (`setRolePermissions`).
- **Suggestion:** a case per remaining catch site asserting `DATABASE_ERROR` and the injected logger's `{ err: cause }` with that site's message.
- **Why deferred:** as SB-059: the four calls share the constructor's `logger` field, which the `deleteRole` case proves; each other site adds only its message.
- **To implement:** three cases in the same `describe`, each making the repository method its operation calls reject.

### SB-068 — the compliance suite asserts one of the service's eight logger calls

- **Source:** review `review-f1691ed852d066ae` of item (v) PR v-d2 (`workstream/item-v-logger-port`, `beb017e1`; log `itemv3a2d`), reliability lens, finding `R3-005`.
- **Location:** `packages/core/compliance/tests/unit/ComplianceService.test.ts:181-193`, the `updateGdprSettings` case; the other calls are `packages/core/compliance/src/ComplianceService.ts:219, 384, 425, 464, 523, 595, 651` (the security settings, the three DSAR transitions, the DSAR submission, the breach report and its notifications).
- **Suggestion:** a case per remaining site, as SB-067 asks for the role service.
- **Why deferred:** as SB-059 and SB-067.
- **To implement:** seven cases, each making the collaborator its operation writes through reject and asserting the returned error and the injected logger's call.

### SB-069 — the queue suite shares one publish-queue double across its cases

- **Source:** review `review-088f335c47c5ebd3` of item (v) PR v-e2 (`workstream/item-v-cheap-queue`, `33476917`; log `itemv3b2`), reliability lens, finding `R3-001`.
- **Location:** `apps/api/tests/unit/queueRoutes.test.ts:73-108`, the module-level double (`storedJob`, the `retry` and `remove` spies and the queue's mocks), registered once in `beforeAll` (`:137`) and cleared by `vi.clearAllMocks()` in `beforeEach` (`:149-151`).
- **Suggestion:** build the double per test, so a future case that overrides a mock or mutates `storedJob` cannot leak into the cases after it.
- **Why deferred:** the suite is deterministic as written: no case overrides a mock implementation or writes to `storedJob`, so clearing the call history is all it needs. The finding guards against a case that does not exist yet.
- **To implement:** a `makePublishQueue()` factory called from `beforeEach`, with the app registered per test, before the first case that overrides the double.

### SB-070 — the queue double answers every `getJobs` call with the same job

- **Source:** review `review-088f335c47c5ebd3` of item (v) PR v-e2 (`workstream/item-v-cheap-queue`, `33476917`; log `itemv3b2`), reliability lens, finding `R3-002`.
- **Location:** `apps/api/tests/unit/queueRoutes.test.ts:105`, `getJobs: vi.fn(async () => [storedJob])`, which the three listing cases read (`:188-226`).
- **Suggestion:** answer per state and offset, and assert that the response items follow what the queue returned, so the listing cases prove more than the arguments the route forwards.
- **Why deferred:** test precision. What the route decides is the state filter and the range defaults, and the cases pin both through the arguments it forwards (`:203`, `:214`, `:225`), while the first case's `items[0]` pins how a job becomes an item. That case's `total` assertion (`:197`) reads the page length the route returns, which DEF-26 of `docs/product/MASTER_PLAN_ES.md` §5.11 queues; fixing that defect rewrites the case.
- **To implement:** a `getJobs` double keyed by state and offset, with the listing cases asserting the items they get back; take it with DEF-26.

### SB-080 — nothing asserts that the catalog's `vitest`, `@vitest/browser` and `@vitest/browser-playwright` share a version

- **Source:** review `review-dc438804c734560d` of slice 0.22 PR C (`workstream/0-22-c-runner`, tip `348480bb`; second-round review of commit `4b98772a`; log `review-cs1.log`), reliability lens, finding `R3-003`.
- **Location:** `pnpm-workspace.yaml:167-173` at `4b98772a`: the comment above the `@vitest/*` block and the `@vitest/browser` and `@vitest/browser-playwright` catalog entries, both `4.1.11`, beside `vitest` at `:93` (the review cites `:167`; the block is at `:168-174` at the tip). `@vitest/coverage-v8` and `@vitest/ui` follow at `:174-175`, also `4.1.11`.
- **Suggestion:** a gate or test that asserts `vitest`, `@vitest/browser` and `@vitest/browser-playwright` keep one version when a catalog edit touches one of them, so a divergence cannot present only as a peer warning at install time.
- **Why deferred:** it guards a divergence that does not exist. Every `@vitest/*` entry and `vitest` read `4.1.11` at that commit, the comment ties the block to the `vitest` hold row (`:167-168`) and states that both browser packages peer `vitest` exactly, so a bump of one alone shows at install as a peer warning, the failure the finding itself names.
- **To implement:** a check that the catalog's `vitest` and `@vitest/*` entries carry one version, failing with the entries and their values, in a gate that reads the catalog block of `pnpm-workspace.yaml`; written when the family next moves, the one edit that can break it.

### SB-081 — no case reaches the Storybook preview's locale fallback

- **Source:** review `review-373723878b0b05f8` of slice 0.22 PR C (`workstream/0-22-c-runner`, tip `348480bb`; second-round review of commit `30d3f010`; log `review-cs2.log`), reliability lens, finding `R3-003`.
- **Location:** `apps/client/.storybook/preview.tsx:19-20`, `isStoryLocale`, used by the decorator at `:105`: `isStoryLocale(context.globals.locale) ? context.globals.locale : "en"` (the review cites `:19-22`).
- **Suggestion:** a story or unit assertion that invokes the decorator with an unknown locale, so a refactor that drops the guard fails a suite.
- **Why deferred:** test coverage for a defensive branch in a development tool; no behaviour changes. `initialGlobals.locale` is `en` (`:73`), the toolbar offers `en` and `es` (`:95-96`), and none of the client's six story files sets a locale or `globals`, so no run reaches the fallback. The finding guards against a refactor that does not exist yet.
- **To implement:** a story whose `globals` set an unknown locale, with a `play` that asserts the English text of a message the story renders, or a unit case that calls the decorator with one.

### SB-089 — the empty-credentials POST case asserts the stored object but not the channel's status

- **Source:** review `review-7b97174154baea37` of unit B.1 (`workstream/cred-b1-credential-invariant`, `d67733ed`; log `review-b1.log`), reliability lens, finding `R3-002`.
- **Location:** `apps/api/tests/unit/channelRoutes.test.ts:289-296`, the case "stores an empty credentials object when the channel is created without credentials": it asserts a 201 and `storedCredentials(...)` equal to `{}`.
- **Suggestion:** also assert the resulting channel state (`PENDING`, or `needsReauth`) that the create-versus-reconstitute comment at `channelRoutes.ts:267-269` motivates, so the test proves the whole intended behaviour of the branch, not only that the empty object round-trips.
- **Why deferred:** test precision; the first POST case, "should create a channel successfully" (`:254-270`), posts the same payload shape (no credentials) and asserts `body.data.status` is `PENDING` at `:268`, so the status is already pinned for the branch, and the case at issue pins what it is named for.
- **To implement:** one more assertion in that case: the response's `data.status` is `PENDING`.

## Implemented

| Id                                                                     | Implemented in                                       | How                                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SB-005                                                                 | 1d (`workstream/hooks-visibility`)                   | `notice_already_sent` reads and records under `fcntl.flock(LOCK_EX)`; test asserts the lock                    |
| SB-006                                                                 | 1d                                                   | the notices log keeps only the current session's lines when it records; test asserts other sessions are pruned |
| SB-001, SB-002, SB-003, SB-004, SB-T02, SB-T03, SB-008, SB-009, SB-010 | book sweep (`workstream/hooks-book-sweep`, 1e6a3c66) | see the PR; red proofs for the four behavioural rows                                                           |
| SB-031                                                                 | English sweep (`workstream/hooks-english`, 4eb09fdc) | the constant is `MAX_NAMED_DEAD_PATTERNS`, renamed together with its three uses                                |
| SB-029, SB-030                                                         | English sweep (`workstream/hooks-english-canon`)     | two comments in `canon_index_line`: the invariant behind `current`, and what the catch-all absorbs and why     |
| SB-014, SB-019                                                         | spec sweep (`workstream/suggestions-book-specs`)     | the floor function's three constants are bullets, and the two endpoints are stated (0.1 → 0.0, 100 → 99.9)     |
| SB-015                                                                 | spec sweep                                           | the parallel-writer scenario's five conditions are one THEN line and four AND lines                            |
| SB-016                                                                 | spec sweep                                           | `dependency-version-management` owns both rules, and `testing-toolchain-alignment` says it restates them       |
| SB-017                                                                 | spec sweep                                           | the ADR-0018 citation is the path `docs/technical/ADR-0018-dependency-freshness-canon.md`                      |
| SB-018                                                                 | spec sweep                                           | the requirement says that either condition alone deletes the tool                                              |
| SB-021                                                                 | spec sweep                                           | the second option: the ledger reopening is named as the enforcement surface; no Red scenario was added         |
| SB-023                                                                 | spec sweep                                           | the Phase 2 heading names gate H8 (2.3.1) beside H3, for the slices that depend on slice 2.3                   |
| SB-025                                                                 | spec sweep                                           | 4b.5.2 gains an acceptance line: the measured N, then the removed steps or the rows and their resume condition |
| SB-026                                                                 | spec sweep                                           | X.2.1 names every failing combination: any hard criterion but H5 keeps node:test; H5 alone may go to Edward    |
| SB-032                                                                 | code sweep (`workstream/suggestions-book-code`)      | the locals are `date_age` and `stale_date`, the summary label `Stale by date`; the flag stays                  |
| SB-033                                                                 | code sweep                                           | a comment names the em-dash separator `list_operations()` writes; a changed one makes `.index()` raise         |
| SB-034                                                                 | code sweep                                           | a comment on `rmSync`: not recursive on purpose, so a directory at the staging path is reported (EISDIR)       |
| SB-041                                                                 | code sweep                                           | `makeUnusedPrismaClient()`: a Proxy that throws naming any member read; a planted read fails all 27 cases      |
| SB-042                                                                 | code sweep                                           | the field is `templateEngineHtml` in the interface, the 27 rows and the engine suite's body                    |
| SB-043                                                                 | code sweep                                           | `packageJson` a readonly `PackageManifest` set in the constructor; `lockfile`, never read, deleted             |
| SB-020                                                                 | book sweep (`workstream/book-sweep-contract`)        | the port refusal always names the bound port and the whole test port set; the process is optional              |
| SB-022                                                                 | book sweep                                           | a Red scenario: a documented chain the parsed lockfile does not contain exits non-zero naming it               |
| SB-024                                                                 | book sweep                                           | `tasks.md` gains human gate H9 for the S.4.2 decline branch, and S.4.2 names H9 when it declines               |
| SB-027                                                                 | book sweep                                           | RED sub-row 1.11.3a: with `TEST_API_URL` unset, `testUtils.ts` must throw an error naming it                   |
| SB-036, SB-037                                                         | book sweep                                           | both rows keep floor, bands, chains and remove-when; their dated history is §"Floor history"                   |
| SB-040                                                                 | book sweep                                           | the `webpack-dev-middleware` note is per builder version: added against, installed, latest immature            |
| SB-050                                                                 | book sweep                                           | the merged local is `authenticatedConfig` in each of the eight `validateCode` bodies                           |
| SB-051                                                                 | book sweep                                           | `OAuthCredentialFields` names `Pick<OAuthProvider, "credentials">` and types `credentialsFromEnv`              |
| SB-035                                                                 | book sweep 2 (`workstream/book-sweep-sensitive`)     | the `Override bands` step comment keeps why the step sits in its job and points at the gate's header           |
| SB-038                                                                 | book sweep part 2                                    | the colour remark is cut; the sentence keeps only that a deletion- or merge-only pull request reports 0        |
| SB-044                                                                 | book sweep part 2                                    | `PLANTED_KEY_NAME` is joined at run time and interpolated by one f-string; the three AWS cases still block     |
| SB-045                                                                 | book sweep part 2                                    | one `assertEqual` pins the whole argv, the flags before the path; the `cwd` assertion stays beside it          |

## Closed with a reason

| Id     | Reason                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SB-007 | one notice per session about the missing file is the contract, whichever hook detects it                                                                                                               |
| SB-T01 | a hook never runs inside a bare repository; the branch reaches the fallback the suite already proves                                                                                                   |
| SB-028 | three scripts are left after the four report scripts were deleted; each keeps the two-line bootstrap, which a shared helper could not replace because nothing can import it before the path it sets up |
| SB-046 | the readable view is the gate's own output, which names every clone's paths and marks `[NEW]` on each run; a second, generated mapping file would drift from the baseline it explains                  |
| SB-047 | failing closed on an empty scan is deliberate: a gate that reads nothing must not report green (fitness #36 and #44), and a misconfiguration is exactly what it should stop                            |
| SB-048 | the battery runs `pnpm install --frozen-lockfile` and `pnpm audit`, CI's dependency job runs `pnpm dedupe --check`, and D39 (b) carries the parsed lockfile delta                                      |
| SB-049 | the inventory is an audit record: a resolution is appended in its row, as D35 did (7f4f6e0b), so a finding and its outcome stay side by side                                                           |
| SB-058 | `--output-type err` prints every severity and exits non-zero on errors only: a planted orphan printed a `warn` line and a `(0 errors, 1 warnings)` summary at exit 0, both read as RED by the verdict  |
