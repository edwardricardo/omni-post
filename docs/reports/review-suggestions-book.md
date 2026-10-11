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
| SB-079 | slice 0.22 PR C, second round (`workstream/0-22-c-runner`, 348480bb)                  | R2-storybook-row-readability                                     | `docs/security/SECURITY_CANON.md:401` (the `storybook` hold row, at `4b98772a`; the review cites the table, `:397-414`)                     | table layout                 | closed: #447 deleted the `storybook` hold row (D25) when the family moved to 10.6.1, so nothing is left to act on                                               |
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
| SB-090 | DC-4 group (a) (`workstream/dc-4-dead-security-modules`, 4d5780f8)                    | R2-stale-test-comment                                            | `apps/api/tests/unit/security/sanitizerOutputs.test.ts:123` (the comment above the entities row; the review cites `:69`)                    | comment                      | deferred: say the row holds entity-escaped markup and no live tag, when the suite is next edited                                                                |
| SB-091 | same                                                                                  | R2-docs-smell47-contradiction                                    | `docs/reports/UNUSED_CODE_INVENTORY.md:496` (the `credentialManager.ts` row) and `:303` (its "The fix"; the review cites `:303`)            | cross-reference              | deferred: true until DC-4 group (b) moves SMELL-47 from 14 to 10 sites; that change rewrites both lines                                                         |
| SB-092 | same                                                                                  | R2-master-plan-group-marker                                      | `docs/product/MASTER_PLAN_ES.md:826` (the DC-4 group (a) note; `:831` after the docs touch)                                                 | prose structure              | implemented (docs touch, `workstream/docs-touch-oct06b`)                                                                                                        |
| SB-093 | slice 0.22 PR D (`workstream/0-22-d-admin-storybook`, a56a026b)                       | R3-001                                                           | `apps/admin/tsconfig.json:30` (the `exclude` list after `"stories"` left it)                                                                | failure mode                 | closed: `apps/admin` holds no story file (0, measured twice), and the entry excluded only a top-level `stories/` directory                                      |
| SB-094 | slice 0.22 PR E (`workstream/0-22-e-ui-stories`, 73f3b139, amended to 4a5b50fe)       | R3-button-no-assertions                                          | `packages/ui/src/components/button.stories.tsx` (19 stories moved from `apps/client`, none with a `play`)                                   | test coverage                | deferred: play assertions for Button, with the next slice of 0.22.3                                                                                             |
| SB-095 | same                                                                                  | R3-input-no-assertions                                           | `packages/ui/src/components/input.stories.tsx` (17 stories moved from `apps/client`, none with a `play`)                                    | test coverage                | deferred: play assertions for Input, with the next slice of 0.22.3                                                                                              |
| SB-096 | slice 0.22 PR E (`workstream/0-22-e-ui-stories`, 4a5b50fe)                            | R3-002                                                           | `packages/ui/src/components/avatar.stories.tsx:26` (`onImageStatusChange`, a module-scope `fn()`; the review cites `:24`)                   | test determinism             | deferred: a mock per story, housekeeping for the next slice of 0.22.3; the assertion uses `toHaveBeenLastCalledWith`                                            |
| SB-097 | same                                                                                  | R3-003                                                           | `scripts/testing/story-coverage-baseline.json:2` (the `packages/ui/src/components` count, 40 → 34)                                          | schema documentation         | deferred: the JSON takes no comment; the gate states the count at `story-per-component-gate.mjs:39` and in its messages                                         |
| SB-098 | SUP-1 non-features unit (`workstream/support-sup1-nonfeatures`, 862e5bf6)             | R2-refusals-dsl-fragile                                          | `apps/api/tests/unit/scripts/supportNonFeatures.test.ts:168-187` (the refusal table split on a pipe)                                        | test table shape             | implemented (SB follow-up, `workstream/support-sb-followup`)                                                                                                    |
| SB-099 | same                                                                                  | R2-page-trailing-table-header                                    | `scripts/legal/lib/inventory.mjs:139` (`renderInventory`), `docs/support/NON_FEATURES.md:220-223`, `docs/support/README.md:32-35`           | empty-table rendering        | implemented (SB follow-up, `workstream/support-sb-followup`)                                                                                                    |
| SB-100 | SUP-1 non-features unit (`workstream/support-sup1-nonfeatures`, 6024c966)             | R2-dup-table-helper                                              | `scripts/support/non-features.mjs:93-99` (`table`, a second Markdown table renderer beside `renderInventory`)                               | shared helper                | implemented (SB follow-up, `workstream/support-sb-followup`)                                                                                                    |
| SB-101 | same                                                                                  | R3-002                                                           | `scripts/support/non-features.mjs:103-113` (the scope-error return, which carries the classification's own problems)                        | test coverage                | implemented (SB follow-up, `workstream/support-sb-followup`)                                                                                                    |
| SB-102 | SUP-1 non-features unit (`workstream/support-sup1-nonfeatures`, ce84d6c2)             | R3-generator-counts-whitespace-tie                               | `scripts/support/non-features.mjs:40-48` (the route rule: a path literal on any receiver)                                                   | test coverage                | implemented (SB follow-up, `workstream/support-sb-followup`)                                                                                                    |
| SB-103 | SUP-1 non-features unit (`workstream/support-sup1-nonfeatures`, d0cedc55)             | R3-real-tree-case-nondeterministic                               | `apps/api/tests/unit/scripts/supportNonFeatures.test.ts:192-197` (the real-tree case compares the committed page)                           | test design                  | deferred: decide once, across the six suites that compare a committed page, and apply it in one pass                                                            |
| SB-104 | dependency-cruiser 18.5.0 hold bump (`workstream/hold-cruiser-18-5`, f6554165)        | R2-testing-row-dense-run-on                                      | `docs/development/TESTING_REFOUNDATION.md:389` (the Red proof cell of the Architecture row of `### Gates`)                                  | doc structure                | implemented (docs touch, `workstream/docs-touch-oct08`)                                                                                                         |
| SB-105 | Phase 1 U2 (`workstream/phase1-u2-reserved-suffixes`, a88b8509)                       | R3-app-config-exclude-untested                                   | `apps/{api,workers,admin,client}/vitest.config.ts` (each spreads `RESERVED_TIER_EXCLUDES` by hand)                                          | test coverage                | deferred: the planted-file reds proved it at landing; the reach gate (WU-1.9, WU-1.10) counts structurally                                                      |
| SB-106 | Phase 1 U1 (`workstream/phase1-u1-suffixes`, d75aba0f)                                | R2-stale-docstring-filename-descriptions                         | `@description` lines of the renamed `apps/client/tests/integration` suites                                                                  | docstring wording            | closed: the lines say what the suites exercise; U1 freed a collector suffix only                                                                                |
| SB-107 | same                                                                                  | R2-doc-stale-authContext-citation                                | `docs/development/TESTING_REFOUNDATION.md` (names cited by their old suffix)                                                                | doc accuracy                 | closed: no renamed file is cited by its old name (measured with `rg -o`)                                                                                        |
| SB-108 | Phase 1 U2 (`workstream/phase1-u2-reserved-suffixes`, a88b8509)                       | R3-spec-glob-breadth                                             | `RESERVED_TIER_EXCLUDES` (the `**/*.spec.*` glob)                                                                                           | glob breadth                 | closed: an infix `.spec.` file is never an include candidate, so the exclude cannot hit it                                                                      |
| SB-109 | Phase 1 U3 (`workstream/phase1-u3-double-collection`, 93d835fa)                       | R2-dense-progress-paragraph                                      | `docs/development/TESTING_REFOUNDATION.md:3-17` (the as-of paragraph and its `Previous:` chain)                                             | doc structure                | deferred: the chain is the tracker's convention for every unit; restructuring it is its own docs unit                                                           |
| SB-110 | Test Redis isolation (`workstream/fix-test-redis-isolation`, 652fee83)                | R3-001                                                           | `apps/api/tests/cache.integration.test.ts` (`assertDisposableRedis`, called first in `beforeEach`)                                          | test setup                   | deferred: the per-case call costs one `new URL` parse and changes no outcome; move it with the next change to the suite                                         |
| SB-111 | same                                                                                  | R3-003                                                           | `apps/api/tests/cache.integration.test.ts` (`assertDisposableRedis`, the `new URL` call)                                                    | error wording                | deferred: the suite still fails loudly before any connection; only the wording of the failure differs                                                           |
| SB-112 | same                                                                                  | R3-004                                                           | `apps/api/tests/cache.integration.test.ts` (`assertDisposableRedis`)                                                                        | test coverage                | deferred: the red was proven by hand at landing; a unit test needs a helper module and a new file, which moves the M1 pin                                       |
| SB-113 | Phase 1 U4 (`workstream/phase1-u4-timing-in-tests`, 3e2e0c60)                         | R2-001                                                           | the `TIMING` constant in nine node:test suites under `apps/api/tests` (integration and `*.flow`)                                            | naming                       | deferred: each constant carries a JSDoc; a longer name re-indents more three-argument `it` calls, so the rename is its own pass                                 |
| SB-114 | Phase 1 U4 (`workstream/phase1-u4-timing-in-tests`, 9c502519)                         | R2-poll-timeout-mismatch                                         | `apps/api/tests/integration/sagaCustomerFlow.live.test.ts` (`TIMING`)                                                                       | budget legibility            | deferred: the move kept every case's budget identical; splitting it changes per-case limits                                                                     |
| SB-115 | Phase 1 U9a (`workstream/phase1-u9a-l4-cli`, afdf3dff)                                | R2-reach-prose-stacked-pr-note                                   | `packages/test-contracts/src/reach.ts` (file header)                                                                                        | doc structure                | deferred: the imports name every module the entry delegates to                                                                                                  |
| SB-116 | Phase 1 U9a (`workstream/phase1-u9a-l4-cli`, afdf3dff)                                | R3-001                                                           | `packages/test-contracts/tests/reach.test.ts` (`--base` read failure)                                                                       | test coverage                | deferred: `--base` shares the tested `readQuarantine` with `--quarantine`                                                                                       |
| SB-117 | Phase 1 U9a (`workstream/phase1-u9a-l4-cli`, afdf3dff)                                | R3-002                                                           | `packages/test-contracts/src/reach.ts` (`parseArguments`)                                                                                   | CLI edge case                | deferred: internal CLI; a value starting with `--` is refused, never misread                                                                                    |
| SB-118 | DEF-68 (`workstream/fix-ratelimit-query-key`, 40434165)                               | R2-001                                                           | `apps/api/tests/unit/security/httpRateLimitPreHandler.test.ts` (`!unrouted`)                                                                | test coupling                | deferred: one literal in one suite; exporting the constant widens the module                                                                                    |
| SB-119 | DEF-68 (`workstream/fix-ratelimit-query-key`, 40434165)                               | R2-002                                                           | `apps/api/src/security/httpRateLimitPreHandler.ts` (`resourcePath`)                                                                         | readability                  | deferred: both branches are pinned by unit cases; the split is a refactor                                                                                       |
| SB-120 | DEF-68 (`workstream/fix-ratelimit-query-key`, 40434165)                               | R2-003                                                           | `apps/api/src/security/httpRateLimitPreHandler.ts` (no-route fallback)                                                                      | readability                  | deferred: both expressions are pinned by the unrouted case                                                                                                      |
| SB-121 | DEF-70 (`workstream/fix-ratelimit-dead-rules`, ffaf0b7e)                              | R2-003                                                           | `apps/api/tests/unit/security/httpRateLimitRuleCoverage.test.ts` (`label`, `rulesShadowing`)                                                | readability                  | deferred: both helpers are pinned by the rule cases; naming them is readability only                                                                            |
| SB-122 | secretlint hold bump (`workstream/hold-secretlint-13-0-7`, 535763b1)                  | R2-003                                                           | `scripts/testing/maturity-watchlist.json` (`reviews.maturity` note of `ignore@7.0.12`)                                                      | readability                  | deferred: splitting the note into fields changes the shape the watchlist check validates                                                                        |
| SB-123 | Phase 1 U11 (`workstream/phase1-u11-s2b`, f3d17376)                                   | R3-root-flag-missing-value                                       | `packages/test-contracts/src/source-resolution.ts` (`--root` with no value)                                                                 | CLI edge case                | deferred: a bare `--root` throws before any check and exits non-zero; it never passes                                                                           |
| SB-124 | same                                                                                  | R3-env-undefined-silently-skipped                                | `packages/test-contracts/src/lib/source-resolution.ts` (missing vite environment)                                                           | fail-closed edge             | deferred: all 92 configs register `client` and `ssr` (measured); the import floor bounds a loss                                                                 |
| SB-125 | same                                                                                  | R3-cli-exit-code-not-asserted                                    | `packages/test-contracts/tests/source-resolution.test.ts` (CLI exit code)                                                                   | test coverage                | deferred: the exit code is `clean ? 0 : 1` over the report the cases assert directly                                                                            |
| SB-126 | same                                                                                  | R3-stdout-non-json-parse                                         | `packages/test-contracts/tests/source-resolution.test.ts` (production spawn)                                                                | test diagnostics             | deferred: a non-JSON stdout still fails the case; only its message is less precise                                                                              |
| SB-127 | Phase 1 U7b (`workstream/phase1-u7b-s2`, 7310de1c)                                    | R3-002                                                           | `apps/api/tests/unit/saga/runTestsGate.behavior.test.ts` (`curl` stub)                                                                      | test double                  | deferred: the runner makes exactly two probe shapes today, and both are pinned                                                                                  |
| SB-128 | same                                                                                  | R3-003                                                           | `apps/api/tests/unit/saga/runTestsGate.behavior.test.ts` (`listedFailedEntries`)                                                            | test coupling                | deferred: the indent is the runner's own output, pinned by the cases that read it                                                                               |
| SB-129 | Phase 1 U7b (`workstream/phase1-u7b-s3`, c2605757)                                    | R3-services-tier-cwd-sensitivity                                 | `apps/api/scripts/run-tests.sh` (`collect`, relative `tests` root)                                                                          | working directory            | deferred: run from any other directory it collects nothing and exits 1 naming `apps/api`                                                                        |
| SB-130 | Phase 1 U7b (`workstream/phase1-u7b-s4`, 077ff3d3)                                    | R2-001, R3-order-arg-unquoted                                    | `apps/api/scripts/run-tests.sh` (`collect`, unquoted `$order`)                                                                              | shell clarity                | deferred: `TEST_ORDER` is validated to unset, forward or reverse first; both orders are pinned                                                                  |
| SB-131 | same                                                                                  | R2-002                                                           | `docs/development/TESTING_REFOUNDATION.md` (As-of head of R7b4)                                                                             | readability                  | deferred: every As-of head is one paragraph; a scannable format is a tracker-wide change                                                                        |
| SB-132 | same                                                                                  | R3-reverse-assertion-depends-on-forward-sort                     | `apps/api/tests/unit/saga/runTestsGate.behavior.test.ts` (byte order)                                                                       | test oracle                  | deferred: 0 non-ASCII paths under `apps/api/tests`, where JS and C byte order agree                                                                             |
| SB-133 | DEF-78 (`workstream/fix-def-78-dead-security-config`, 15636798)                       | R2-002                                                           | `docs/product/MASTER_PLAN_ES.md` (DEF-78 closure note)                                                                                      | readability                  | deferred: §5.11 closure notes are one paragraph each; a bulleted form changes every note                                                                        |
| SB-134 | Phase 1 U9b (`workstream/phase1-u9b-1`, cfddf623)                                     | R3-node-collector-windows-absolute                               | `packages/test-contracts/src/lib/node-collector.ts` (absolute-path guard)                                                                   | platform scope               | deferred: --list prints paths from `find tests` on the Linux runners only                                                                                       |
| SB-135 | same                                                                                  | R3-node-collector-parent-escape                                  | `packages/test-contracts/src/lib/node-collector.ts` (`..` segments)                                                                         | input validation             | deferred: no source of --list can print `..`; its paths come from `find tests`                                                                                  |
| SB-136 | same                                                                                  | R3-k6-collector-root-ignored                                     | `packages/test-contracts/src/lib/k6.ts` (`context.root`)                                                                                    | contract clarity             | deferred: the tracked list it reads is built from the root by the engine                                                                                        |
| SB-137 | Phase 1 U9b (`workstream/phase1-u9b-2`, 9763d0aa)                                     | R2-untracked-paths-pluralization; R3-002 (R9b3)                  | `packages/test-contracts/src/lib/node-collector.ts`, `packages/test-contracts/src/lib/playwright-collector.ts` (counts)                     | message wording              | deferred: "1 paths" and "1 errors" still name the count and fail closed                                                                                         |
| SB-138 | same                                                                                  | R2-stopped-signal-null-fallthrough                               | `packages/test-contracts/src/lib/node-collector.ts` (`runFailure`)                                                                          | message wording              | deferred: spawnSync sets a signal whenever it reports no status and no error                                                                                    |
| SB-139 | Phase 1 U9b (`workstream/phase1-u9b-3`, 81aee5ef)                                     | R3-001                                                           | `packages/test-contracts/src/lib/playwright-collector.ts` (nested specs not a list)                                                         | test coverage                | deferred: one defensive branch of the report reader, refusing like its siblings                                                                                 |
| SB-140 | same                                                                                  | R3-003                                                           | `packages/test-contracts/src/lib/playwright-collector.ts` (absolute spec `file`)                                                            | input validation             | deferred: Playwright 1.63 writes spec files relative to rootDir, pinned by a real-CLI case                                                                      |
| SB-141 | Phase 1 U9b (`workstream/phase1-u9b-4`, 880539a3)                                     | R4-001; R2-003                                                   | `packages/test-contracts/src/lib/playwright-collector.ts` (`listWithPlaywrightCli`)                                                         | blocking I/O                 | deferred: reach is a CLI process in CI; nothing else shares its event loop                                                                                      |
| SB-142 | same                                                                                  | R4-002; R2-002                                                   | `packages/test-contracts/src/lib/playwright-collector.ts` (64 MiB `maxBuffer`)                                                              | naming, diagnostics          | deferred: an overflow still fails the listing closed, with node's error                                                                                         |
| SB-143 | same                                                                                  | R2-004                                                           | `packages/test-contracts/src/lib/playwright-collector.ts` (`PlaywrightCollectorOptions`)                                                    | API surface                  | deferred: test-only options documented as such; production builds take none                                                                                     |
| SB-144 | Phase 1 U9b (`workstream/phase1-u9b-7`, d31384d5)                                     | R3-collectorIds-O-n2                                             | `packages/test-contracts/src/lib/executed-by.ts` (registry reconciliation)                                                                  | performance                  | deferred: four collectors; the quadratic pass is over four ids                                                                                                  |
| SB-145 | same                                                                                  | R3-isUnder-trailing-slash                                        | `packages/test-contracts/src/lib/executed-by.ts` (`isUnder`)                                                                                | input normalisation          | deferred: sources are file paths or `file#name`, never ending in a slash                                                                                        |
| SB-146 | same                                                                                  | R3-covers-both-scopes                                            | `packages/test-contracts/src/lib/executed-by.ts` (`covers`)                                                                                 | defensive check              | deferred: the parser refuses an entry carrying both `packages` and `exclude`                                                                                    |
| SB-147 | Phase 1 U9b (`workstream/phase1-u9b-9`, 313643f7)                                     | R2-sort-brittle-to-double-digit-rules                            | `packages/test-contracts/src/reach.ts` (violation order)                                                                                    | ordering                     | deferred: three rules, R1 to R3, where text order is rule order                                                                                                 |
| SB-148 | Phase 1 U8 (`workstream/phase1-u8-1`, 5cb9c9b6)                                       | R4-003                                                           | `apps/api/scripts/run-tests.sh` (`probe_live` curl options)                                                                                 | fail speed                   | deferred: a dropped SYN costs 10 s once, then the tier stops; no file is probed twice                                                                           |
| SB-149 | same                                                                                  | R3-probe-stderr-not-captured-in-ERROR                            | `apps/api/scripts/run-tests.sh` (`ERROR` summary)                                                                                           | diagnostics                  | deferred: curl's error is on the run's stderr beside the ✗ line; CI shows both                                                                                  |
| SB-150 | same                                                                                  | R3-probe-call-log-grep-count-off-by-one                          | `apps/api/tests/unit/saga/runTestsGate.behavior.test.ts` (`curl` stub)                                                                      | test double                  | deferred: the cases that use failFrom assert the exact files run before it                                                                                      |
| SB-151 | same                                                                                  | R3-no-probe-timeout-coverage                                     | `apps/api/tests/unit/saga/sagaLiveSuitePrecondition.static.test.ts` (`--max-time`)                                                          | test coverage                | deferred: the bound is in the probe's one line; a hung probe stops the tier once                                                                                |
| SB-152 | same                                                                                  | R3-static-test-only-asserts-shape-not-timeout                    | `apps/api/tests/unit/saga/sagaLiveSuitePrecondition.static.test.ts` (`-f`)                                                                  | test coverage                | deferred: the live P4 run proved a 429 stops the tier; the flag's text is unpinned                                                                              |
| SB-153 | Phase 1 U8 (`workstream/phase1-u8-2`, f2139739)                                       | R4-002                                                           | `apps/api/scripts/run-tests.sh` (`local -n`)                                                                                                | shell portability            | deferred: CI runs ubuntu-latest and the hosts bash 5.2; bash 4.3+ is not stated                                                                                 |
| SB-154 | same                                                                                  | R4-003                                                           | `apps/api/scripts/run-tests.sh` (refusal order)                                                                                             | diagnostics                  | deferred: every pre-flight failure still exits before any suite with its own message                                                                            |
| SB-155 | same                                                                                  | R3-list-requires-live-suffix-tree                                | `apps/api/scripts/run-tests.sh` (`--list`)                                                                                                  | scope                        | deferred: the tree holds 18 *.live.test.ts files; --list from a trimmed tree is no use                                                                          |
| SB-156 | Phase 1 U8 (`workstream/phase1-u8-3`, a3dac768)                                       | R3-suffix-regex-missed-cases                                     | `apps/api/tests/unit/saga/sagaContextInvariants.static.test.ts` (saga files)                                                                | test scope                   | deferred: fitness #30 reads every file under apps/api/tests whatever its name                                                                                   |
| SB-157 | Fix DEF-83 (`workstream/fix-def-83-test-stdout`, 20ccdebb)                            | R3-no-regression-assertion                                       | `docs/architecture/TESTING.md` (the stderr rule)                                                                                            | regression guard             | deferred: Master Plan DEF-83 follow-up 2, a lint rule or fitness check                                                                                          |
| SB-158 | same                                                                                  | R3-remaining-stdout-warn (WARNING)                               | `apps/api/tests/providerRegistry.live.test.ts:49`                                                                                           | stream choice                | justified: `console.warn` writes to stderr (measured: 0 bytes on stdout, 12 on stderr)                                                                          |
| SB-159 | Turbopack dev (`workstream/dev-turbopack`, bb5b6f2e)                                  | R3-001                                                           | `apps/admin/next.config.mjs`, `apps/client/next.config.mjs` (`agentRules`)                                                                  | regression guard             | deferred: DEF-88's proposed gate on stray `.md` files under `apps/` and `packages/`                                                                             |
| SB-160 | same                                                                                  | R3-002                                                           | `apps/admin/package.json`, `apps/client/package.json` (`dev`)                                                                               | dev memory                   | deferred: no dev-memory gate exists; measured one-off on 2026-10-10                                                                                             |
| SB-161 | same                                                                                  | R3-003                                                           | `docs/product/MASTER_PLAN_ES.md` (DEF-86)                                                                                                   | observability                | deferred: DEF-86 (high priority), whose next step measures a Turbopack production build                                                                         |

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
- **Closed:** 2026-10-06, nothing left to act on. The family's move to 10.6.1 (#447, `workstream/hold-storybook-10-6-1`) deleted the `storybook` hold row, as tracker decision D25 decided for this family, so there is no row left to split, trim or move measurements in; the `tsconfck` chain the row named now sits in the Compatibility pins paragraph of `docs/security/SECURITY_CANON.md`.

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

### SB-091 — the inventory records `credentialManager` as deleted while SMELL-47 still counts its site, with no pointer to where that count moves

- **Source:** review `review-7e3f066c9c820e21` of DC-4 group (a) (`workstream/dc-4-dead-security-modules`, integrating commit `4d5780f8`; log `review-dcr7.log`), readability lens, finding `R2-docs-smell47-contradiction`.
- **Location:** `docs/reports/UNUSED_CODE_INVENTORY.md:496`, the `credentialManager.ts` row of §4.1, which ends "SMELL-47 still counts its site", and `:303`, whose "The fix" paragraph still asks to "remove the 4 sites from SMELL-47's list" (the review cites `:303`). `SMELL-47` (`docs/reports/roadmap-detected-smells-backlog.md:79`) still lists `security/credentialManager (1)` among its 14 sites.
- **Suggestion:** a short cross-reference from the inventory to where the SMELL-47 correction is tracked, so a reader does not take the deletion as fully done.
- **Why deferred:** the statement is true and the correction has an owner: the DC-4 row of `docs/product/MASTER_PLAN_ES.md` §5.13 names "SMELL-47 de 14 a 10 sitios" among its corrections, the unit's PR body leaves that count to group (b), which deletes `auditLogger`, the other module SMELL-47 counts, and since the docs touch of 2026-10-06 the group (a) note under DC-4 says SMELL-47 still counts the `credentialManager` site (SB-092). No value changes.
- **To implement:** in DC-4 group (b), move SMELL-47 to 10 sites in 7 files and, in the same change, end the `:496` row with the new count and the PR number, and mark the SMELL-47 step of `:303` done.

### SB-092 — the DC-4 parent row lists both groups' files, and the group (a) note does not say which remain

- **Source:** review `review-7e3f066c9c820e21` of DC-4 group (a) (`workstream/dc-4-dead-security-modules`, integrating commit `4d5780f8`; log `review-dcr7.log`), readability lens, finding `R2-master-plan-group-marker`.
- **Location:** `docs/product/MASTER_PLAN_ES.md:826` at `4d5780f8` (`:831` after the docs touch), the "Grupo (a)" note under DC-4, which ended "El grupo (b) sigue pendiente." while the parent row above it lists the six modules and the test files of both groups.
- **Suggestion:** name group (b)'s contents (`auditLogger`, `rateLimitingDashboard`, `correlationMiddleware` and their tests) in the same note, or mark them in the parent list, so a reader checking DC-4 off does not diff the two lists by hand.
- **Why deferred:** prose structure; no value changes.
- **Implemented:** the docs touch of 2026-10-06 (`workstream/docs-touch-oct06b`), which was writing the PR number (#436) into that same note: it now names group (b)'s four modules (`auditLogger.ts`, `rateLimitingDashboard.ts`, `correlationMiddleware.ts` and `correlationTracking.ts`, the last one in `packages/observability/opentelemetry`, which the finding does not list), their three test files, and SMELL-47's open count.

### SB-093 — dropping `"stories"` from the admin `exclude` list is not shown to be safe

- **Source:** review `review-590751c289f36a76` of slice 0.22 PR D (`workstream/0-22-d-admin-storybook`, the admin configuration commit `a56a026b`; log `review-dd1.log`), reliability lens, finding `R3-001`.
- **Location:** `apps/admin/tsconfig.json:30`, the `exclude` list (`["node_modules", "tests", "playwright.config.ts", "vitest.config.ts"]`), from which PR D removed `"stories"`.
- **Suggestion:** confirm that no story file remains under `apps/admin`, or re-add the entry as a safety net, since a residual `*.stories.ts(x)` would now be typechecked by `tsc --noEmit`.
- **Why closed:** the confirmation was made and holds. PR D measured `fd -e stories.tsx -e stories.ts . apps/admin` at 0 before acknowledging the review, and the docs touch of 2026-10-06 measured 0 again on `main` `73a03dea`. The entry excluded `apps/admin/stories`, a top-level directory that does not exist; a story written by the convention of ADR-0035 sits beside its component, where that entry never reached.

### SB-097 — the story baseline does not say what its counts are

- **Source:** review `review-20036995f120bbea` of slice 0.22 PR E (`workstream/0-22-e-ui-stories`, the stories commit `4a5b50fe`, second pass; log `review-e2.log`), reliability lens, finding `R3-003`.
- **Location:** `scripts/testing/story-coverage-baseline.json:2`, `"packages/ui/src/components": 34` on PR E's branch (40 on `main`), beside the `apps/client/components` (160) and `apps/admin/components` (54) counts.
- **Suggestion:** a short key description, or a link to the consuming check, so a reviewer can tell from the diff alone that the number is a debt counter and that 40 → 34 is the right direction.
- **Why deferred:** the file is strict JSON, which takes no comment, and the gate refuses any key that is not one of its roots (`scripts/testing/story-per-component-gate.mjs:100`), so a description key would fail it. The meaning is stated where the number is checked: the JSDoc of `BASELINE` (`:39`, "The committed count, per root, of component files without a sibling story") and every message the gate prints ("34 components without a sibling story, baseline 33"); CODING_STANDARDS §Mandatory Requirements for Every Sprint describes the baseline too.
- **To implement:** if a reader still trips on it, the gate's usage text names the file and what its counts are; the JSON itself stays as it is.

### SB-099 — an empty inventory table renders as a header with no rows

- **Source:** the native review of the SUP-1 non-features unit (`workstream/support-sup1-nonfeatures`, `862e5bf6`), readability lens, finding `R2-page-trailing-table-header`.
- **Location:** `scripts/legal/lib/inventory.mjs:139`, where `renderInventory` always appends `table(page.columns, page.rows)`; it shows in `docs/support/NON_FEATURES.md:220-223` (`## Documented`) and `docs/support/README.md:32-35` (`## Index`), both a header row and a separator with no row beneath.
- **Suggestion:** print the sentinel `None.` instead of an empty table when `rows` is empty, the word `buildNonFeatures` already uses for an empty pending list.
- **Why deferred:** it changes only how an empty table renders, and both sections stay empty until the retro pass lands the first support documents. The change also moves the empty-index pin at `apps/api/tests/unit/scripts/supportIndex.test.ts:141` (`/\| Owner \|\n\| -+ …\|\n$/`, outside the unit's surface) and needs a library case, and measured on a scratch copy it would take the unit from 397 to about 406 CODE, over the 400 cap.
- **To implement:** one small unit: `renderInventory` prints `None.` for an empty `rows`; the `supportIndex.test.ts` pin becomes `/## Index\n\nNone\.\n$/`; `legalInventoryLib.test.ts` gains the case `renders None. when the inventory has no rows`; `pnpm support:index` regenerates both support pages. The four legal pages have rows and do not move, which `pnpm check:legal` confirms.

### SB-100 — the non-features page renders its own Markdown tables

- **Source:** the native re-review of the SUP-1 non-features unit (`workstream/support-sup1-nonfeatures`, `6024c966`), readability lens, finding `R2-dup-table-helper`.
- **Location:** `scripts/support/non-features.mjs:93-99` at `6024c966` (the review cites `:95-99`): a local `table(head, body)` that renders the Non-features section, escapes a pipe in a cell and prints `None.` with no rows, while `renderInventory` in `scripts/legal/lib/inventory.mjs` renders the page's final table, the Documented section, with its own helper.
- **Suggestion:** one table renderer for both sections, so their formats cannot drift.
- **Why deferred:** unifying them means the library exports its table renderer and gains a case, and this unit sits at 399 CODE against the 400 cap. The two helpers write the same header, separator and row shape and both escape a pipe in a cell; only the library's also flattens a newline in a cell, which no Non-features reason contains. Both pages are pinned byte for byte against the committed ones by `pnpm check:support`.
- **To implement:** in the same follow-up unit as SB-099: export the table renderer from `scripts/legal/lib/inventory.mjs` (with SB-099's `None.` for an empty body), use it for the Non-features section, keep both support pages byte-identical and add the library case.

### SB-104 — the Architecture gate row packs every dated proof into one capped cell

- **Source:** the native review of the dependency-cruiser 18.5.0 hold bump (`workstream/hold-cruiser-18-5`, `f6554165`), readability lens, finding `R2-testing-row-dense-run-on`.
- **Location:** `docs/development/TESTING_REFOUNDATION.md:389`, the Red proof cell of the Architecture row of `### Gates`: it holds the five plants and two baseline reds of 2026-10-07, the resolution control and the battery run of 2026-10-05, `PR v-b`'s layer rules and `PR v-c`, at the column's 2871-character cap.
- **Suggestion:** split the dated history out of the cell, so a reader cannot attribute plant (3)'s 2026-10-05 `exit 6` to 18.5.0.
- **Why deferred:** a table cell cannot carry a paragraph break, and the cap leaves no room: a longer cell re-pads every row of the Gates table. The cell already dates each proof and says the seventh error of plant (3) is the rule `PR v-b` added, not 18.5.0, and ADR-0032's Consequences records the same.
- **To implement:** a docs unit that touches only `docs/development/TESTING_REFOUNDATION.md` and `docs/technical/ADR-0032-architecture-gate-dependency-cruiser.md` (or a `docs/reports/` note in place of the ADR section): move the gate's dated proof history to a short section of ADR-0032, and leave the row with the current proof and a link to that section.

### SB-109 — the as-of paragraph stacks three dated layers

- **Source:** the native review of Phase 1 U3 (`workstream/phase1-u3-double-collection`, `93d835fa`), readability lens, `R2-dense-progress-paragraph`.
- **Location:** `docs/development/TESTING_REFOUNDATION.md:3-17`, the as-of paragraph: each unit prepends its sentence, the previous head becomes `Previous:` and the one before it `Before it,`.
- **Suggestion:** split the paragraph so a reader scanning for the current state does not parse three layers of history in one block.
- **Why deferred:** the chain is the tracker's convention for every unit since Phase 0, and every unit edits it; restructuring it inside a unit that edits it would conflict with the next one.
- **To implement:** one docs unit that moves the dated layers below the current sentence into a short dated list and states the convention once.

### SB-115 — the reach entry's header does not map the modules it delegates to

- **Source:** the native review of Phase 1 U9a L4 (`workstream/phase1-u9a-l4-cli`, `afdf3dff`), finding `R2-reach-prose-stacked-pr-note`.
- **Location:** `packages/test-contracts/src/reach.ts`, the file header.
- **Suggestion:** add a one-line map in the header naming where the floors (`lib/disk.ts`, `lib/vitest-collector.ts`), the R1/R3 semantics and the quarantine schema (`lib/rules.ts`) and the collector contract (`lib/registry.ts`) live.
- **Why deferred:** the imports name each module and each module's own header states its contract; the map is navigation help only.
- **To implement:** one sentence in the header.

### SB-117 — `parseArguments` refuses a flag value that starts with `--`

- **Source:** the native review of Phase 1 U9a L4 (`workstream/phase1-u9a-l4-cli`, `afdf3dff`), finding `R3-002`.
- **Location:** `packages/test-contracts/src/reach.ts`, `parseArguments`.
- **Suggestion:** treat only a missing next argument as a missing value, or accept `--flag=value`, so a path beginning with `--` is not refused.
- **Why deferred:** the CLI is internal and called by the package script and a future CI step with fixed paths; such a value is refused with a usage error, never misread.
- **To implement:** accept `--flag=value` and keep the refusal for a missing value; add a case.

### SB-118 — the unit suite repeats the `!unrouted` sentinel literal

- **Source:** the native review of DEF-68 (`workstream/fix-ratelimit-query-key`, `40434165`), finding `R2-001`.
- **Location:** `apps/api/tests/unit/security/httpRateLimitPreHandler.test.ts`, the unrouted case.
- **Suggestion:** reference the sentinel by name instead of repeating `"127.0.0.1:!unrouted"`.
- **Why deferred:** the constant is module-private; exporting it only for a test widens the module's surface, and the case pins the observable key, which is what callers and Redis see.
- **To implement:** export the constant, or derive the expected key from a helper the module already exports.

### SB-119 — `resourcePath` folds the named and wildcard parameter branches into one lookup

- **Source:** the native review of DEF-68 (`workstream/fix-ratelimit-query-key`, `40434165`), finding `R2-002`.
- **Location:** `apps/api/src/security/httpRateLimitPreHandler.ts`, `resourcePath`.
- **Suggestion:** split the replacer on whether the capture names a parameter or is the bare `*`, instead of `values[name ?? "*"]`.
- **Why deferred:** both branches are pinned by unit cases (a named parameter and a wildcard); the change is a readability refactor of security code that earns its own review.
- **To implement:** two branches in the replacer, same cases green.

### SB-120 — the no-route fallback is written twice

- **Source:** the native review of DEF-68 (`workstream/fix-ratelimit-query-key`, `40434165`), finding `R2-003`.
- **Location:** `apps/api/src/security/httpRateLimitPreHandler.ts`, `createHttpRateLimitPreHandler`.
- **Suggestion:** derive the rule input and the resource key from one `const route = pattern ?? UNROUTED`.
- **Why deferred:** both expressions are pinned by the unrouted case, so a drift between them fails a test; the intermediate is readability only.
- **To implement:** one intermediate, same cases green.

### SB-121 — the coverage test's label and shadowing helpers are dense

- **Source:** the native review of DEF-70 (`workstream/fix-ratelimit-dead-rules`, `ffaf0b7e`), finding `R2-003`.
- **Location:** `apps/api/tests/unit/security/httpRateLimitRuleCoverage.test.ts`, `label` and `rulesShadowing`.
- **Suggestion:** name the `"none"` sentinel of `rulesShadowing` and extract a helper for the winning rule's label; say beside `label` that rules share preset objects by identity.
- **Why deferred:** both helpers only build the failure message and the shadowing verdict, which the rule cases pin; the change is readability only.
- **To implement:** a named constant and one helper, same cases green.

### SB-122 — a maturity review note packs every check into one paragraph

- **Source:** the native review of the secretlint hold bump (`workstream/hold-secretlint-13-0-7`, `535763b1`), finding `R2-003`.
- **Location:** `scripts/testing/maturity-watchlist.json`, the `reviews.maturity` note of the `ignore@7.0.12` entry.
- **Suggestion:** split the note into labelled fields (registry, OSV, upstream, reachability, local checks), so the claim behind the `clean` outcome is visible on its own.
- **Why deferred:** the note is a free-text field that `scripts/testing/maturity-watchlist.mjs --check` validates; structured fields change that schema and every existing review, which is its own change.
- **To implement:** a schema change in `maturity-watchlist.mjs` with its suite, then the existing notes migrated.

### SB-123 — a bare `--root` throws instead of reporting

- **Source:** the native review of Phase 1 U11 R2b3 (`workstream/phase1-u11-s2b`, `f3d17376`), finding `R3-root-flag-missing-value`.
- **Location:** `packages/test-contracts/src/source-resolution.ts`, the `--root` argument.
- **Suggestion:** refuse `--root` with no value as a reported error, so the JSON report contract holds for that input too.
- **Why deferred:** `realpathSync(undefined)` throws before any check runs, so the command exits non-zero; the gate can never pass on that input.
- **To implement:** a missing-value check in the argument loop and one CLI case.

### SB-124 — an import whose vite environment is missing is skipped, not counted

- **Source:** the same review, finding `R3-env-undefined-silently-skipped`.
- **Location:** `packages/test-contracts/src/lib/source-resolution.ts`, the per-import loop of `checkSourceResolution`.
- **Suggestion:** report an import whose mapped `client` or `ssr` environment is not registered as an error, instead of skipping it before `checked` is counted.
- **Why deferred:** measured on 2026-10-10, every one of the 92 tracked vitest configs registers both environments for each of its projects, so no import is skipped today; and the 800-import floor fails the gate if a large share ever is.
- **To implement:** push an error naming the config and the missing environment, with a planted config that drops one.

### SB-159 — nothing automated proves `agentRules: false` keeps agent files out of the apps

- **Source:** the native review of the Turbopack dev unit (`workstream/dev-turbopack`, `bb5b6f2e`), finding `R3-001`.
- **Location:** `apps/admin/next.config.mjs` and `apps/client/next.config.mjs`, the `agentRules` key.
- **Suggestion:** add a check that fails if `AGENTS.md` or `CLAUDE.md` reappear under an app after `next dev`.
- **Why deferred:** the effect was proven by hand on two scratch apps identical but for the flag (`true` wrote both files, `false` wrote none), and Next validates the key in `config-schema.js`. A gate on stray `.md` files under `apps/` and `packages/` is DEF-88's proposed fix, which covers this case and more.
- **To implement:** DEF-88's gate, with its red proved.

### SB-160 — no check catches a return of Turbopack's dev memory to the June profile

- **Source:** the same review, finding `R3-002`.
- **Location:** `apps/admin/package.json` and `apps/client/package.json`, the `dev` scripts.
- **Suggestion:** add a dev-boot probe or an RSS check, so a regression to the 2026-06-19 out-of-memory profile is caught.
- **Why deferred:** no gate measures dev-server memory today, with either bundler; `next dev` runs in no CI job or battery step. The measurement of 2026-10-10 (admin 985 MiB, client 1149 MiB on the first page, on an 18 GB box) is recorded in SMELL-52 and the Master Plan.
- **To implement:** a dev-boot probe, if dev memory becomes a recurring problem again.

### SB-161 — the Sentry initialization of a Turbopack build is not asserted

- **Source:** the same review, finding `R3-003`.
- **Location:** `docs/product/MASTER_PLAN_ES.md`, DEF-86.
- **Suggestion:** add a production-build boot check or a Sentry-init test.
- **Why deferred:** it is DEF-86, registered with high priority in this same unit; its next step measures whether Sentry initializes in a Turbopack production build, which already ran on Turbopack before this change.
- **To implement:** DEF-86.

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

### SB-090 — the sanitizer suite's comment says its entities row carries no markup at all

- **Source:** review `review-7e3f066c9c820e21` of DC-4 group (a) (`workstream/dc-4-dead-security-modules`, integrating commit `4d5780f8`; log `review-dcr7.log`), readability lens, finding `R2-stale-test-comment`.
- **Location:** `apps/api/tests/unit/security/sanitizerOutputs.test.ts:123`, "The next row carries no markup at all: it exercises the parser's entity serialization alone.", above the row `escaped entities with no markup` (`:124-129`; the review cites `:69`).
- **Suggestion:** say that the input holds entity-escaped markup and no live tag, for example "exercises the parser's entity serialization on an input that contains no live tags", since the string literally contains markup-shaped sequences and the reduced suite now characterizes one caller, the template engine.
- **Why deferred:** comment wording in a test; no assertion or value changes. The row's name and its input already show that the markup is escaped.
- **To implement:** reword the comment as the finding proposes, the next time the suite is edited.

### SB-094 — the moved Button stories carry no `play` assertion

- **Source:** first pass of the review of slice 0.22 PR E's stories commit (`workstream/0-22-e-ui-stories`, `73f3b139`, amended to `4a5b50fe`), reliability lens, finding `R3-button-no-assertions`. The second pass overwrote that pass's log (`review-e2.log`), so the finding survives as its id and its disposition in the PR body; this entry describes it from the tree.
- **Location:** `packages/ui/src/components/button.stories.tsx` at PR E's tip `440ce053` (396 lines, 19 stories), moved from `apps/client/stories/components/ui/Button.stories.tsx` with only its `@file` line and its imports changed; no story has a `play` function or an `expect`.
- **Suggestion:** play assertions on the Button stories, so the runner proves their behaviour beyond rendering, the console contract and axe.
- **Why deferred:** PR E moved the existing stories without changing their content, and play assertions for the moved Button and Input stories belong to the next slice of decision 0.22.3, which also writes stories for the 34 components that still have none. Each moved story already runs under the pass criterion of CODING_STANDARDS §Test Framework Rules: it renders, writes nothing to the console and passes axe.
- **To implement:** a `play` per meaningful state (default, disabled, loading) asserting what the user sees, in that slice.

### SB-095 — the moved Input stories carry no `play` assertion

- **Source:** first pass of the review of slice 0.22 PR E's stories commit (`workstream/0-22-e-ui-stories`, `73f3b139`, amended to `4a5b50fe`), reliability lens, finding `R3-input-no-assertions`; its text survives only as its id and disposition, as for SB-094.
- **Location:** `packages/ui/src/components/input.stories.tsx` at `440ce053` (446 lines, 17 stories), moved from `apps/client/stories/components/ui/Input.stories.tsx` with only its `@file` line and its imports changed; no story has a `play` function or an `expect`.
- **Suggestion:** play assertions on the Input stories, as for SB-094.
- **Why deferred:** the reason of SB-094: the moved stories keep their content, and their play assertions belong to the next slice of 0.22.3.
- **To implement:** a `play` per meaningful state (default, disabled, error) asserting what the user sees and types, in that slice.

### SB-096 — the avatar stories share one module-scope spy across runs

- **Source:** review `review-20036995f120bbea` of slice 0.22 PR E (`workstream/0-22-e-ui-stories`, the stories commit `4a5b50fe`, second pass; log `review-e2.log`), reliability lens, finding `R3-002`.
- **Location:** `packages/ui/src/components/avatar.stories.tsx:26` at `440ce053`, `const onImageStatusChange = fn();` (the review cites `:24`), which the `ImageFailed` story asserts at `:71`.
- **Suggestion:** create the mock inside the story, or reset it in a loader or `beforeEach`, because nothing clears its call history between runs and a future assertion that counts calls would depend on run order.
- **Why deferred:** test determinism for an assertion that does not exist yet: the one at `:71` uses `toHaveBeenLastCalledWith("error")`, which reads only the last call whatever ran before. A mock per story is housekeeping for the next slice of 0.22.3, which writes the remaining stories.
- **To implement:** create the `fn()` per story (in its `args`) or reset it in a `beforeEach`, in that slice.

### SB-098 — the support suites split their refusal tables on `" | "`

- **Source:** the native review of the SUP-1 non-features unit (`workstream/support-sup1-nonfeatures`, `862e5bf6`), readability lens, finding `R2-refusals-dsl-fragile`; the same point from the reliability lens as `R3-001` (re-review of `6024c966`) and `R3-refusal-table-silent-misread` (re-review of `ce84d6c2`).
- **Location:** `apps/api/tests/unit/scripts/supportNonFeatures.test.ts:168-187` at `862e5bf6` (the review cites `:166-179`): a `String.raw` table, one refusal per line, split with `row.split(" | ")` and read by `it.each(REFUSALS)` as `(_, id = "", value = "", problem = "")`.
- **Suggestion:** a refusal whose message ever contains `" | "` would split into more than four cells, and the destructuring defaults would hide a row that splits into fewer; the table should not be able to misread a row in silence.
- **Why deferred:** the silent-misread half is closed in this unit: `supportNonFeatures.test.ts` reads each row as `(title, id, value, problem, ...extra)`, with no defaults, and first asserts `expect([title, id, value, problem, ...extra].filter(Boolean)).toHaveLength(4)`, so a row of three or five cells or with an empty cell fails its own test loudly (probed 2026-10-07: each fails with `expected [ … ] to have a length of 4`). What stays deferred is the table shape: `supportFrontMatter.test.ts:52-62` and `supportIndex.test.ts:58-77` keep the lenient split with destructuring defaults, measured with `rg 'split\(" \| "\)'` over `apps/api/tests/unit/scripts/` (no legal suite uses the shape), and changing the shape in one suite would leave it in the other two, so it belongs to one pass over all three. No row today contains `" | "`, and every case passes with each named refusal asserted by its message.
- **To implement:** in the three suites, a structured array of rows or a split on a delimiter no message can contain; in `supportFrontMatter.test.ts` and `supportIndex.test.ts`, also the four-cell assertion that `supportNonFeatures.test.ts` already makes, replacing their defaults.

### SB-101 — no case pins a scope error reported together with classification problems

- **Source:** the native re-review of the SUP-1 non-features unit (`workstream/support-sup1-nonfeatures`, `6024c966`), reliability lens, finding `R3-002`.
- **Location:** `scripts/support/non-features.mjs:103-113` at `6024c966` (the review cites `:98-104`): when a root is missing or a kind yields no candidate, `buildNonFeatures` returns the scope error together with the `problems` of `loadClassification`, and `supportNonFeatures.test.ts` exercises the scope error only on a classification without problems.
- **Suggestion:** pin that both reach the runner: the scope error and the classification's problem lines, and exit 1.
- **Why deferred:** a combined case is about eight CODE lines, and this unit sits at 399 against the 400 cap. Measured from the code, the problems returned beside a scope error are only those `loadClassification` raises itself (malformed JSON, an unknown status, a non-feature without its note); the join problems (an unclassified candidate, an entry the tree does not yield, the pending baseline) are computed after the return at `:113`, because without the whole scope there is no candidate set to join. A fixture pairing a missing root with a stale entry would therefore show only the scope error.
- **To implement:** in the same follow-up unit as SB-099: one case with a missing root and a non-feature entry without its note, asserting through `runGenerators` that the scope error and the `has no note` line are both printed and the exit is 1.

### SB-102 — no case refuses an unclassified route found by its path literal alone

- **Source:** the native re-review of the SUP-1 non-features unit (`workstream/support-sup1-nonfeatures`, `ce84d6c2`), reliability lens, finding `R3-generator-counts-whitespace-tie`.
- **Location:** `scripts/support/non-features.mjs:40-48` at `ce84d6c2`: `ROUTE_NAME` and `ROUTE`, whose comment states that any receiver counts, so a module outside the route naming that registers a path literal becomes a candidate, refused until it is classified.
- **Suggestion:** a fixture that pins that contract: a non-route module carrying `app.get("/path"`, derived as a route candidate and refused while unclassified.
- **Why deferred:** a fixture and its assertion are over the 400-CODE cap here (the unit sits at 400). Measured, half of the contract is already pinned: the fixture `apps/api/src/auth/providerOAuth.ts` (`supportNonFeatures.test.ts:37-38`) is named outside the convention and carries `app.post<{ Body: Generate<Text> }>("/ai/generate", handler)`, and the derivation case requires `route:auth/providerOAuth.ts` (`:61`); removing the path-literal rule fails it. What no case pins is the refusal of such a candidate when it is unclassified (the unclassified refusal row uses `queue:dlq`) and the plain `app.get` spelling; the `http.get` fixture (`:40`) proves only that a non-path string is no candidate.
- **To implement:** in the same follow-up unit as SB-099: a fixture file outside the route naming carrying `app.get("/planted"`, left out of the classification, asserting that `route:<path>` is in the derived set and that the build refuses it with `has no entry: classify it`.

### SB-103 — the real-tree case compares the committed page, so a stale page fails the unit suite too

- **Source:** the native review of the SUP-1 non-features unit (`workstream/support-sup1-nonfeatures`, `d0cedc55`), reliability lens, finding `R3-real-tree-case-nondeterministic`, a WARNING acknowledged by the orchestrator under this entry.
- **Location:** `apps/api/tests/unit/scripts/supportNonFeatures.test.ts:192-197` at `d0cedc55` (the review cites `:195-198`): `finds the real tree clean and its committed page current` builds from `REPO_ROOT` and expects the result to equal the committed `docs/support/NON_FEATURES.md`.
- **Suggestion:** the case depends on the working tree, so a change elsewhere in the tree can turn this unit suite red.
- **Why deferred:** the case is deterministic, not flaky: it goes red only when the tree changes a candidate or the classification without the page being regenerated, and it then names the same remedy as the gate, `pnpm support:index`. Its cost is a second place that goes red for the same reason as `pnpm check:support`. It is the convention of every suite that compares a committed page, six measured with `rg` over `apps/api/tests/unit/scripts/`: the four legal inventory suites (`cookiesAndStorageInventory.test.ts:226`, `oauthScopesInventory.test.ts:302`, `personalDataInventory.test.ts:196`, `subprocessorsInventory.test.ts:190`) and both support suites (`supportIndex.test.ts:158` and this one). Changing only this suite would make it diverge from the other five.
- **To implement:** decide once, across the six suites, whether the real-tree case keeps the page comparison or asserts only that `problems` is empty (leaving staleness to `pnpm check:legal` and `pnpm check:support`), and apply the decision in one pass.

### SB-105 — no in-process assertion pins that each app config keeps the reserved globs

- **Source:** the native review of Phase 1 U2 (`workstream/phase1-u2-reserved-suffixes`, `a88b8509`), reliability lens, finding `R3-app-config-exclude-untested`.
- **Location:** `apps/{api,workers,admin,client}/vitest.config.ts`: each spreads `RESERVED_TIER_EXCLUDES` into its own `test.exclude` by hand.
- **Suggestion:** pin, in a unit case, that each hand-spread app config keeps the reserved globs in its resolved `test.exclude`, so a config that drops the spread fails a test instead of silently collecting a reserved suite.
- **Why deferred:** the planted-file reds of the unit proved it at landing: five plants were listed before the exclude and absent after. The reach gate (the WU-1.9 engine and the WU-1.10 `test-contracts` job) will count every file's collectors structurally, which closes the class rather than one config.
- **To implement:** either one vitest case per app that resolves its own config and asserts `test.exclude` contains every entry of `RESERVED_TIER_EXCLUDES`, or nothing if WU-1.10 lands first.

### SB-106 — the renamed client suites still describe themselves as "Integration tests for …"

- **Source:** the native review of Phase 1 U1 (`workstream/phase1-u1-suffixes`, `d75aba0f`), readability lens, finding `R2-stale-docstring-filename-descriptions`.
- **Location:** the `@description` lines of the client suites renamed from `X.integration.test.tsx` to `X.test.tsx`.
- **Suggestion:** reword the lines, so a description does not name a suffix the file no longer carries.
- **Why closed:** the lines describe what the suites exercise, component integration under vitest, and `apps/client/tests/integration/` stays their home. U1 freed a collector suffix; it did not change the nature of the tests.

### SB-107 — the tracker may cite a renamed file by its old name

- **Source:** the native review of Phase 1 U1 (`workstream/phase1-u1-suffixes`, `d75aba0f`), finding `R2-doc-stale-authContext-citation`.
- **Location:** `docs/development/TESTING_REFOUNDATION.md`, the citations of the renamed `.integration.test.tsx` suites.
- **Suggestion:** replace any citation of a renamed file by its old name.
- **Why closed:** measured with `rg -o '[A-Za-z0-9_./-]+\.integration\.test\.tsx?'` over the tracker against the tree, no renamed file is cited by its old name. The three old-suffix names left are `httpSecurityPosture.integration.test.ts`, a file a later unit creates, and the planted-red examples `x.integration.test.ts` and `empty.integration.test.ts`.

### SB-108 — `**/*.spec.*` also matches an infix such as `foo.spec.types.ts`

- **Source:** the native review of Phase 1 U2 (`workstream/phase1-u2-reserved-suffixes`, `a88b8509`), finding `R3-spec-glob-breadth`.
- **Location:** `RESERVED_TIER_EXCLUDES`, the `**/*.spec.*` glob.
- **Suggestion:** narrow the glob so it cannot match an infix `.spec.` name.
- **Why closed:** an exclude only removes files the include would otherwise collect, and vitest's include requires the suffix at the end of the name, so an infix `.spec.` file is never a candidate. The shape mirrors `**/*.integration.test.*`, which must match `.ts` and `.tsx` alike.

### SB-110 — the Redis guard runs before every case

- **Source:** the native review of `workstream/fix-test-redis-isolation` (DEF-63, `652fee83`), finding `R3-001`.
- **Location:** `apps/api/tests/cache.integration.test.ts`, the `assertDisposableRedis` guard, called first in `beforeEach`.
- **Suggestion:** run the guard once in the node:test `before` hook instead of in every `beforeEach`; the host does not change between cases.
- **Why deferred:** the per-case call costs one `new URL` parse and changes no outcome. Moving it belongs to the next change that touches the suite.
- **To implement:** move one call from `beforeEach` to a `before` hook.

### SB-111 — a malformed `REDIS_URL` fails before the guard's guidance is printed

- **Source:** the same review, finding `R3-003`.
- **Location:** `apps/api/tests/cache.integration.test.ts`, the `assertDisposableRedis` guard.
- **Suggestion:** a malformed or empty `REDIS_URL` throws `TypeError [ERR_INVALID_URL]` from `new URL` before the guard's guidance message is printed. Catch that error and rethrow it naming `.env.test.example`.
- **Why deferred:** the suite still fails loudly, before any connection; only the wording of the failure differs.
- **To implement:** wrap the `new URL` call and rethrow with the guidance message.

### SB-112 — the Redis guard has no unit test of its own

- **Source:** the same review, finding `R3-004`.
- **Location:** `apps/api/tests/cache.integration.test.ts`, the `assertDisposableRedis` guard.
- **Suggestion:** add a unit test of the guard.
- **Why deferred:** its red was proven by hand when it landed. With `REDIS_URL=redis://example.invalid:6379`, every case failed with the guard's message before any connection. A unit test needs the guard moved to a helper module plus a new test file, which moves the M1 metric pin.
- **To implement:** extract the guard to a helper under `apps/api/tests/`, test it, and update the tracker's M1 `Now` cell.

### SB-113 — the `TIMING` constant is not self-describing at its call sites

- **Source:** the native review of Phase 1 U4 (`workstream/phase1-u4-timing-in-tests`, `3e2e0c60`), finding `R2-001`.
- **Location:** the `TIMING` constant in nine node:test suites under `apps/api`: `tests/integration/hardDeleteSerializableRace`, `sagaCrashRecovery`, `sagaCompensationRecovery`, `sagaPublishNowPromotion`, `sagaCustomerFlow`, and `tests/{publish,analytics,media,schedule}.flow`.
- **Suggestion:** a name such as `TEST_TIMEOUT` would make the call sites (`it("…", TIMING, async () => {…})`) self-describing.
- **Why deferred:** each constant carries a JSDoc stating its value and why. A longer name pushes more three-argument `it` calls past the print width, and prettier re-indents their bodies again; most of that unit's raw diff was already this re-indent.
- **To implement:** rename in the nine files in one change, with `prettier --write`.

### SB-114 — one 180 s budget for every case of the saga customer flow

- **Source:** the native review of Phase 1 U4 (`workstream/phase1-u4-timing-in-tests`, `9c502519`), finding `R2-poll-timeout-mismatch`.
- **Location:** `apps/api/tests/integration/sagaCustomerFlow.live.test.ts`, the `TIMING` constant.
- **Suggestion:** give the publish-now cases, which poll up to 120 s for a terminal state, their own budget and the quick cases (missing auth, the XOR refinement, cross-tenant 404s) a shorter one, so each call site states its real cost.
- **Why deferred:** the unit moved each batch's timeout into its suites with every case's budget unchanged, which is what its same-count acceptance measured; shortening some cases' limits is a behaviour change of its own.
- **To implement:** a second constant for the quick cases, measured against their slowest `duration_ms` in CI.

### SB-116 — no case plants an unreadable `--base` quarantine

- **Source:** the native review of Phase 1 U9a L4 (`workstream/phase1-u9a-l4-cli`, `afdf3dff`), finding `R3-001`.
- **Location:** `packages/test-contracts/tests/reach.test.ts`.
- **Suggestion:** plant a missing or malformed base file and assert exit 1 with an error line naming it.
- **Why deferred:** `--base` and `--quarantine` both go through `readQuarantine`, whose failure path the `--quarantine` cases already pin end to end.
- **To implement:** one CLI case with a missing base path.

### SB-125 — the command line's exit code is not asserted

- **Source:** the same review, finding `R3-cli-exit-code-not-asserted`.
- **Location:** `packages/test-contracts/tests/source-resolution.test.ts`.
- **Suggestion:** run `main` over a planted violation and assert exit 1, so a reversed clean branch is caught.
- **Why deferred:** the exit code is `clean ? 0 : 1` over the same report whose violations and floor breaches the planted cases assert directly.
- **To implement:** one `main` case over the existing planted tree.

### SB-126 — a non-JSON stdout hides the production run's real failure

- **Source:** the same review, finding `R3-stdout-non-json-parse`.
- **Location:** `packages/test-contracts/tests/source-resolution.test.ts`, the `NODE_ENV=production` child-process case.
- **Suggestion:** guard `JSON.parse` so a stray log line fails with the child's stdout and stderr, not a `SyntaxError`.
- **Why deferred:** a non-JSON stdout still fails the case; only the failure message is less precise.
- **To implement:** a try/catch that rethrows with both streams.

### SB-127 — the runner suite's `curl` stub answers by a loose argument match

- **Source:** the native review of Phase 1 U7b R7b2 (`workstream/phase1-u7b-s2`, `7310de1c`), finding `R3-002`.
- **Location:** `apps/api/tests/unit/saga/runTestsGate.behavior.test.ts`, the stub `curl` written for the scratch runs.
- **Suggestion:** match each probe by its URL, and fail on an unknown probe shape, instead of returning 200 for any argument list that contains `http_code` and a one-consumer body for everything else.
- **Why deferred:** the runner makes exactly two probe shapes today, the readiness status code and the queue-consumer body, and both are asserted by the cases that drive them; a new probe shape arrives with its own case.
- **To implement:** a `case` on the URL in the stub, with an `exit 97` default that a case would surface.

### SB-128 — `listedFailedEntries` depends on a two-space indent

- **Source:** the same review, finding `R3-003`.
- **Location:** `apps/api/tests/unit/saga/runTestsGate.behavior.test.ts`, `listedFailedEntries`.
- **Suggestion:** parse the `FAILED files:` block without fixing its indent width, so an indent change fails with a clear message rather than an empty list.
- **Why deferred:** the two-space indent is the runner's own output format, and the accounting cases compare that block with the reported files on every run, so a change to it turns them red.
- **To implement:** accept any leading whitespace, and assert the block is non-empty whenever the run reports failures.

### SB-129 — the services collection reads `tests` relative to the working directory

- **Source:** the native review of Phase 1 U7b R7b3 (`workstream/phase1-u7b-s3`, `c2605757`), finding `R3-services-tier-cwd-sensitivity`.
- **Location:** `apps/api/scripts/run-tests.sh`, `collect`.
- **Suggestion:** resolve the `tests` root from the script's own location, so the collection does not depend on the caller's working directory.
- **Why deferred:** every caller runs the script from `apps/api` (the package scripts, the CI jobs, fitness #30 through `cd apps/api`). Measured 2026-10-10 from the repository root: both `--list` and a `TIER` run exit 1 with "collect integration found no *.integration.test.ts to run under tests/ … run it from apps/api" and start nothing, so a wrong directory fails closed rather than passing empty.
- **To implement:** `cd` to the script's package root at start, with a case that runs it from another directory.

### SB-130 — `collect` passes an unquoted, possibly empty `$order` to `sort`

- **Source:** the native review of Phase 1 U7b R7b4 (`workstream/phase1-u7b-s4`, `077ff3d3`), findings `R2-001` and `R3-order-arg-unquoted`.
- **Location:** `apps/api/scripts/run-tests.sh`, `collect`.
- **Suggestion:** branch on the order explicitly (`sort` and `sort -r` in two arms), or build the arguments as an array, instead of relying on word splitting to drop an empty `$order`.
- **Why deferred:** `TEST_ORDER` is validated at the top of the script to unset, `forward` or `reverse` (anything else exits 2), so `$order` is either empty or `-r`; the behaviour and static suites pin both orders.
- **To implement:** the two-arm form, with the existing order cases unchanged.

### SB-131 — R7b4's As-of head packs every fact into one paragraph

- **Source:** the same review, finding `R2-002`.
- **Location:** `docs/development/TESTING_REFOUNDATION.md`, the As-of head of R7b4.
- **Suggestion:** a short bulleted summary per head, so a single fact can be found without re-reading the paragraph.
- **Why deferred:** every As-of head in the tracker's chain is one paragraph, turned into "Before it, …" by the next head; a scannable format is a change to the whole chain's convention, not to one head.
- **To implement:** decide the head format once, then apply it to the chain as its own docs change.

### SB-132 — the reverse-order case compares against JavaScript's default sort

- **Source:** the same review, finding `R3-reverse-assertion-depends-on-forward-sort`.
- **Location:** `apps/api/tests/unit/saga/runTestsGate.behavior.test.ts`, the reverse-order case.
- **Suggestion:** compare the forward call list against an explicit byte-order sort (`Buffer.compare`), matching `LC_ALL=C sort`.
- **Why deferred:** measured 2026-10-10, `apps/api/tests` holds 0 paths with a non-ASCII byte, and for ASCII JavaScript's default sort (UTF-16 code units) and `LC_ALL=C sort` give the same order.
- **To implement:** a byte comparator in the case's expected order.

### SB-133 — DEF-78's closure note is one long paragraph

- **Source:** the native review of DEF-78 (`workstream/fix-def-78-dead-security-config`, `15636798`), finding `R2-002`.
- **Location:** `docs/product/MASTER_PLAN_ES.md`, the DEF-78 entry of §5.11.
- **Suggestion:** split the closure into bullets: what was deleted, why the ZAP file is not a rules file, the search before and after, the documents it changed.
- **Why deferred:** every closure note in §5.11 (DEF-37, DEF-49, DEF-63, DEF-67, DEF-68, DEF-70, DEF-72) is one paragraph appended to its entry; a bulleted form is a convention change for the whole queue, not for one entry.
- **To implement:** decide the closure-note format once and apply it to the closed entries as one docs change.

### SB-134 — the node collector's absolute-path guard is POSIX-only

- **Source:** the native review of Phase 1 U9b R9b1 (`workstream/phase1-u9b-1`, `cfddf623`), finding `R3-node-collector-windows-absolute`.
- **Location:** `packages/test-contracts/src/lib/node-collector.ts`, the `--list` line reader.
- **Suggestion:** refuse a Windows-style absolute path too (`path.win32.isAbsolute`).
- **Why deferred:** `run-tests.sh --list` prints repository paths from `find tests` and its own collection, and it runs only on the Linux runners and hosts the repository supports.
- **To implement:** one extra check and a case with a drive-letter path.

### SB-135 — the node collector accepts `..` segments in a listed path

- **Source:** the same review, finding `R3-node-collector-parent-escape`.
- **Location:** `packages/test-contracts/src/lib/node-collector.ts`, the `--list` line reader.
- **Suggestion:** refuse a listed path that normalises outside the runner's package.
- **Why deferred:** every path `--list` prints comes from `find tests` inside `apps/api`, so no source of the listing can produce `..`.
- **To implement:** refuse any line whose normalised path starts with `../`, with a case.

### SB-136 — the k6 collector never reads `context.root`

- **Source:** the same review, finding `R3-k6-collector-root-ignored`.
- **Location:** `packages/test-contracts/src/lib/k6.ts`.
- **Suggestion:** read and validate the root the way the vitest collector does through `trackedConfigs`.
- **Why deferred:** the collector filters the tracked file list the engine builds from that root for every collector; it has no root-relative work of its own.
- **To implement:** pass the root through `trackedConfigs` once the k6 collector reads files.

### SB-137 — two failure messages pluralise a count of one

- **Source:** the native reviews of R9b2 (`9763d0aa`, finding `R2-untracked-paths-pluralization`) and R9b3 (`81aee5ef`, finding `R3-002`).
- **Location:** `packages/test-contracts/src/lib/node-collector.ts` (untracked paths) and `packages/test-contracts/src/lib/playwright-collector.ts` (reported errors).
- **Suggestion:** word the noun by the count, so "1 path" and "1 error".
- **Why deferred:** both messages still state the exact count and fail closed; the Playwright one opens with the `REPORTED_ERRORS` prefix the listing reads, so its wording changes together with that constant.
- **To implement:** a small plural helper and the cases that quote the messages.

### SB-138 — a stopped run with no signal would read "stopped by null"

- **Source:** the native review of R9b2 (`9763d0aa`), finding `R2-stopped-signal-null-fallthrough`.
- **Location:** `packages/test-contracts/src/lib/node-collector.ts`, `runFailure`.
- **Suggestion:** fall back to "produced no exit status" when both status and signal are null.
- **Why deferred:** `spawnSync` reports a null status only when a signal ended the child, and every other no-status outcome (spawn failure, timeout) sets `error`, which is handled first.
- **To implement:** a guard and a case with a hand-built run result.

### SB-139 — the report reader's "specs not a list" branch has no case

- **Source:** the native review of R9b3 (`81aee5ef`), finding `R3-001`.
- **Location:** `packages/test-contracts/src/lib/playwright-collector.ts`, the nested suite walk.
- **Suggestion:** a case with `specs` or `suites` set to a string or a number inside a nested suite.
- **Why deferred:** the branch refuses like its tested siblings, and the reader fails closed either way.
- **To implement:** one fixture per non-list shape.

### SB-140 — an absolute spec `file` would bypass the `rootDir` anchor

- **Source:** the same review, finding `R3-003`.
- **Location:** `packages/test-contracts/src/lib/playwright-collector.ts`, `path.resolve(rootDir, file)`.
- **Suggestion:** refuse a spec whose `file` is absolute.
- **Why deferred:** Playwright 1.63.0 writes every spec `file` relative to `config.rootDir`, and the self-test that lists the admin portal through the real CLI pins that shape on every run.
- **To implement:** an absolute-path check and a fixture.

### SB-141 — the Playwright listing blocks while typed as asynchronous

- **Source:** the native review of R9b4 (`880539a3`), findings `R4-001` and `R2-003`.
- **Location:** `packages/test-contracts/src/lib/playwright-collector.ts`, `listWithPlaywrightCli`.
- **Suggestion:** run the CLI with an asynchronous child process, or type the listing as synchronous.
- **Why deferred:** `reach` runs as its own CLI process in CI, so a blocked event loop delays nothing else, and the 120 s cap bounds each config.
- **To implement:** `execFile` with a promise, keeping the same failure messages.

### SB-142 — the 64 MiB listing buffer is unnamed and its overflow message terse

- **Source:** the same review, findings `R4-002` and `R2-002`.
- **Location:** `packages/test-contracts/src/lib/playwright-collector.ts`, the `maxBuffer` option.
- **Suggestion:** name the cap beside `LIST_TIMEOUT_MS` and report an overflow as "listing exceeded 64 MiB".
- **Why deferred:** an overflow still fails the listing closed, with node's own `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` message. Measured 2026-10-10, the two tracked configs list 31 KB (admin) and 649 KB (client), about 1 % of the cap.
- **To implement:** a constant and a branch on that error code.

### SB-143 — the Playwright collector's test options are part of its exported API

- **Source:** the same review, finding `R2-004`.
- **Location:** `packages/test-contracts/src/lib/playwright-collector.ts`, `PlaywrightCollectorOptions`.
- **Suggestion:** name the options for the self-tests, or keep the test factory internal.
- **Why deferred:** the options are documented as for the self-tests only, and `reach` builds the collector without them, so the production floor always applies.
- **To implement:** rename to a test-overrides type, or split an internal factory.

### SB-144 — registry reconciliation checks ids with a nested loop

- **Source:** the native review of R9b7 (`d31384d5`), finding `R3-collectorIds-O-n2`.
- **Location:** `packages/test-contracts/src/lib/executed-by.ts`, the registry-to-collector reconciliation.
- **Suggestion:** build a `Set` of collector ids once.
- **Why deferred:** the engine has four collectors, so the nested pass is over four ids and its order is already deterministic.
- **To implement:** a `Set` lookup.

### SB-145 — `isUnder` trims the prefix's trailing slash but not the source's

- **Source:** the same review, finding `R3-isUnder-trailing-slash`.
- **Location:** `packages/test-contracts/src/lib/executed-by.ts`, `isUnder`.
- **Suggestion:** normalise both sides.
- **Why deferred:** collection sources are file paths or `file#name`, never a path ending in a slash.
- **To implement:** trim both, with a case.

### SB-146 — `covers` does not re-check that `packages` and `exclude` exclude each other

- **Source:** the same review, finding `R3-covers-both-scopes`.
- **Location:** `packages/test-contracts/src/lib/executed-by.ts`, `covers`.
- **Suggestion:** assert the exclusivity again where the entry is used.
- **Why deferred:** the registry parser refuses an entry carrying both (`executed-by.ts:105`), and entries reach `covers` only through it.
- **To implement:** an assertion and a hand-built entry in a case.

### SB-147 — the violation order relies on single-digit rule names

- **Source:** the native review of R9b9 (`313643f7`), finding `R2-sort-brittle-to-double-digit-rules`.
- **Location:** `packages/test-contracts/src/reach.ts`, the merged violation sort.
- **Suggestion:** sort by an explicit rule order, or compare rule numbers numerically.
- **Why deferred:** there are three rules, R1 to R3, whose text order is their rule order.
- **To implement:** a rule-order table used by the sort.

### SB-148 — the readiness probe has no connect timeout

- **Source:** the native review of Phase 1 U8 R8a (`workstream/phase1-u8-1`, `5cb9c9b6`), finding `R4-003`.
- **Location:** `apps/api/scripts/run-tests.sh`, `probe_live`.
- **Suggestion:** add `--connect-timeout` beside `--max-time`, so a host that drops connections fails fast.
- **Why deferred:** the first failed probe stops the live tier, so a silently dropping host costs one 10 s probe, never one per file.
- **To implement:** `--connect-timeout 3`, with SB-151's case pinning it.

### SB-149 — the ERROR line points at a curl error printed on another stream

- **Source:** the same review, finding `R3-probe-stderr-not-captured-in-ERROR`.
- **Location:** `apps/api/scripts/run-tests.sh`, the final `ERROR` summary.
- **Suggestion:** capture curl's error and print it with the `env-unready-before` line.
- **Why deferred:** curl writes its error to the run's stderr next to the `✗ env-unready-before` line, and CI and the battery show both streams; the measured live reds (P4, P5) carry it in the log.
- **To implement:** capture `curl`'s stderr in `probe_live` and append it to `ENV_UNREADY`.

### SB-150 — the curl stub counts a call before deciding whether it fails

- **Source:** the same review, finding `R3-probe-call-log-grep-count-off-by-one`.
- **Location:** `apps/api/tests/unit/saga/runTestsGate.behavior.test.ts`, the stub `curl`.
- **Suggestion:** decide before appending to the call log, or assert the log's exact contents.
- **Why deferred:** the cases that use `failFrom` assert exactly which files ran before the failing probe, so an off-by-one in the stub turns them red.
- **To implement:** check the count before the append.

### SB-151 — no case bounds a hung probe

- **Source:** the same review, finding `R3-no-probe-timeout-coverage`.
- **Location:** `apps/api/tests/unit/saga/sagaLiveSuitePrecondition.static.test.ts`.
- **Suggestion:** assert that `probe_live` passes `--max-time`, and state the per-file worst case.
- **Why deferred:** the bound is on the probe's one `curl` line, and the first failed probe stops the tier, so a hung API costs one bounded probe per tier, not one per file.
- **To implement:** one assertion over the `probe_live` line.

### SB-152 — the static suite pins the probe's URLs but not `-f`

- **Source:** the same review, finding `R3-static-test-only-asserts-shape-not-timeout`.
- **Location:** `apps/api/tests/unit/saga/sagaLiveSuitePrecondition.static.test.ts`.
- **Suggestion:** assert that `probe_live` passes `-f`, so a 429 keeps failing the probe.
- **Why deferred:** the behaviour suite's failing-probe cases and the live P4 red (a 429 after `security.live.test.ts` stopped the tier, 2026-10-10) prove the outcome; only the flag's text is unpinned.
- **To implement:** one assertion over the `probe_live` line.

### SB-153 — the runner needs bash 4.3 for its nameref and does not say so

- **Source:** the native review of U8 R8b (`workstream/phase1-u8-2`, `f2139739`), finding `R4-002`.
- **Location:** `apps/api/scripts/run-tests.sh`, `select_files` (`local -n`).
- **Suggestion:** state the bash 4.3 requirement, or check the version at start and name it.
- **Why deferred:** CI runs every job on `ubuntu-latest` (bash 5) and the repository's hosts run bash 5.2; the nameref is the script's first bash-4.3 feature.
- **To implement:** a version check under the shebang with a message naming the requirement.

### SB-154 — pre-flight errors now print before the missing-database refusal

- **Source:** the same review, finding `R4-003`.
- **Location:** `apps/api/scripts/run-tests.sh`, the order of the start-up checks.
- **Suggestion:** list the possible pre-flight causes in the final error, or check `DATABASE_URL` first.
- **Why deferred:** every pre-flight failure (a malformed quarantine, a moved tree, an emptied tier) still exits before any suite with its own message, so the order changes which message comes first, not whether one comes.
- **To implement:** move the `DATABASE_URL` refusal ahead of the collection, keeping `--list` above it.

### SB-155 — `--list` fails on a tree without live suites

- **Source:** the same review, finding `R3-list-requires-live-suffix-tree`.
- **Location:** `apps/api/scripts/run-tests.sh`, `--list`.
- **Suggestion:** let `--list` print the services inventory when no `*.live.test.ts` exists.
- **Why deferred:** the repository holds 18 `*.live.test.ts` files, and `--list` serves fitness #30 and the reach engine over this tree, never a trimmed checkout.
- **To implement:** skip the empty-collection refusal under `--list` for the live suffix, with a case.

### SB-156 — the saga suffix case reads only files whose path names a saga

- **Source:** the native review of U8 R8c (`workstream/phase1-u8-3`, `a3dac768`), finding `R3-suffix-regex-missed-cases`.
- **Location:** `apps/api/tests/unit/saga/sagaContextInvariants.static.test.ts`, the saga-suite filter.
- **Suggestion:** widen the case to every test-shaped file outside `tests/unit`, or state its scope as saga files by path.
- **Why deferred:** fitness #30 reads every file under `apps/api/tests` outside `unit` and `eval`, whatever its name, and fails a file no collector reaches, so a misnamed saga file is caught there.
- **To implement:** state the scope in the case's comment, or widen its filter.

### SB-157 — no automated check keeps non-ASCII text off a node:test child's stdout

- **Source:** the native review of the DEF-83 fix (`workstream/fix-def-83-test-stdout`, `20ccdebb`), finding `R3-no-regression-assertion`.
- **Location:** `docs/architecture/TESTING.md`, the stderr rule, and the suites that import `apps/api/tests/setup.ts`.
- **Suggestion:** add a lint rule or fitness check so a non-ASCII-leading `console.log` cannot return to a file node:test runs.
- **Why deferred:** it is DEF-83's follow-up 2 in the Master Plan, decided on 2026-10-10 with its own unit; Node 24.20.0 and later also parse the frame correctly.
- **To implement:** the guard named in that follow-up, with its red path proved.

### SB-158 — a `console.warn` with a non-ASCII prefix stays in `providerRegistry.live`

- **Source:** the same review, finding `R3-remaining-stdout-warn` (WARNING).
- **Location:** `apps/api/tests/providerRegistry.live.test.ts:49`.
- **Suggestion:** note beside it that `console.warn` writes to stderr, so a contributor does not move it back to stdout.
- **Why justified:** `console.warn` writes to stderr, not to the runner's channel. Measured on Node 24.15.0: 0 bytes on stdout and 12 on stderr for one `console.warn("⚠️ warn")`.
- **To implement:** nothing in this unit; the guard of SB-157 covers a move back to stdout.

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
| SB-092                                                                 | docs touch (`workstream/docs-touch-oct06b`)          | the group (a) note under DC-4 names group (b)'s modules and tests, and SMELL-47's open count                   |
| SB-098                                                                 | SB follow-up (`workstream/support-sb-followup`)      | the index and front-matter suites read four cells with no defaults and assert four; a three-cell row fails     |
| SB-099                                                                 | SB follow-up                                         | `renderTable` prints `None.` for an empty body; the index pin and both support pages follow                    |
| SB-100                                                                 | SB follow-up                                         | the library exports `renderTable` and the Non-features section uses it; the local `table` is deleted           |
| SB-101                                                                 | SB follow-up                                         | `runGenerators` with a missing root and a noteless non-feature prints both lines and exits 1                   |
| SB-102                                                                 | SB follow-up                                         | `app.get("/planted"` in `lib/planted.ts` is derived as a route and refused until classified                    |
| SB-104                                                                 | docs touch (`workstream/docs-touch-oct08`)           | the dated proofs moved to ADR-0032 §Gate red proofs, dated; the row keeps the current proof and a link         |

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
| SB-079 | #447 deleted the `storybook` hold row the finding asked to reshape, as D25 decided for the family's move to 10.6.1; no row is left to split or trim                                                    |
| SB-093 | `apps/admin` holds no story file (0 in PR D and again on 2026-10-06), and the dropped entry excluded only a top-level `apps/admin/stories/` directory, never a colocated story                         |
| SB-106 | the `@description` lines say what the suites exercise (component integration under vitest), not their suffix; `apps/client/tests/integration/` stays their home                                        |
| SB-107 | measured with `rg -o` over the tracker against the tree: no renamed file is cited by its old name; the three old-suffix names left are a file a later unit creates and two planted-red examples        |
| SB-108 | an exclude only removes files the include would collect, and the include needs the suffix at the end of the name, so an infix `.spec.` file is never a candidate                                       |
