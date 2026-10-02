# Review Suggestions Book

**Owner:** Platform engineering
**As of:** 2026-10-02
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
| SB-014 | `testing-refoundation` contract part 3 (`workstream/trf-contract-3`, 7138e554)        | R2-unexplained-constant-floor-formula                            | `openspec/changes/testing-refoundation/specs/coverage-floor-ratchet/spec.md:79`                                                             | prose structure              | deferred: bullet the three constants of the floor formula (truncate to one decimal, subtract 0.1 pp, clamp at 0) instead of one sentence                        |
| SB-015 | same                                                                                  | R2-overlong-sentence-parallel-writers                            | `openspec/changes/testing-refoundation/specs/behavioural-coverage-backfill/spec.md:178-179`                                                 | prose structure              | deferred: split the five acceptance conditions of the parallel-writer scenario into bullets                                                                     |
| SB-016 | same                                                                                  | R2-cross-spec-mirroring-duplication                              | `openspec/changes/testing-refoundation/specs/testing-toolchain-alignment/spec.md:116-124` and `dependency-version-management/spec.md:14-33` | cross-reference              | deferred: name which spec OWNS the mirrored `@types/node` / `engines.node` rule and which one restates it                                                       |
| SB-017 | same                                                                                  | R2-ambiguous-maturity-anchor                                     | `openspec/changes/testing-refoundation/specs/dependency-version-management/spec.md:72`                                                      | cross-reference              | deferred: make the ADR-0018 citation a repository-relative path (`docs/technical/ADR-0018-dependency-freshness-canon.md`)                                       |
| SB-018 | same                                                                                  | R3-k6-cv-boundary-ambiguity                                      | `openspec/changes/testing-refoundation/specs/k6-load-gate/spec.md:89-90`                                                                    | prose precision              | deferred: say in words that EITHER condition alone deletes the tool (the sentence already says "OR")                                                            |
| SB-019 | same                                                                                  | R3-coverage-floor-formula-edge                                   | `openspec/changes/testing-refoundation/specs/coverage-floor-ratchet/spec.md:79`                                                             | prose precision              | deferred: state the two endpoints explicitly (0.1 → 0.0, 100 → 99.9)                                                                                            |
| SB-020 | same                                                                                  | R3-env-port-refusal-recovery                                     | `openspec/changes/testing-refoundation/specs/test-environment-contract/spec.md:88-90`                                                       | scenario precision           | deferred: the refusal MUST always include the bound port and the whole test port set, process identity being optional                                           |
| SB-021 | same                                                                                  | R3-mutation-no-both-directions-proof                             | `openspec/changes/testing-refoundation/specs/mutation-score-floors/spec.md:133-139`                                                         | missing red scenario         | deferred: add a Red scenario where a new assertion-free test fails the incremental mutation lane, or state that the ledger reopening is the enforcement surface |
| SB-022 | same                                                                                  | R3-dependency-closure-coverage-silent                            | `openspec/changes/testing-refoundation/specs/dependency-version-management/spec.md:47-49`                                                   | missing red scenario         | deferred: add a Red scenario where a documented chain that the parsed lockfile does not contain exits non-zero naming the entry                                 |
| SB-023 | `testing-refoundation` contract part 7 (`workstream/trf-contract-7`, tasks-part-2.md) | R3-phase2-ordering-vs-H3                                         | `openspec/changes/testing-refoundation/tasks-part-2.md` Phase 2 preamble                                                                    | prose precision              | deferred: name gate H8 (2.3.1) in the Phase 2 preamble next to H3, since later block-deletion slices can descend floors                                         |
| SB-024 | same                                                                                  | R3-S4-decline-branch-undefined                                   | `openspec/changes/testing-refoundation/tasks-part-2.md` task S.4.2                                                                          | decision record              | deferred: give the S.4.2 decline branch a human-gate id so the taken branch is observable from the plan, not only from the tracker Decisions log                |
| SB-025 | same                                                                                  | R3-4b5-measured-branch-no-acceptance                             | `openspec/changes/testing-refoundation/tasks-part-2.md` task 4b.5.2                                                                         | acceptance line              | deferred: add an acceptance line citing the measured N and either the removed db steps (N=0) or the opened ledger rows and the resume condition (N>0)           |
| SB-026 | same                                                                                  | R3-X2-decision-rule-ambiguity                                    | `openspec/changes/testing-refoundation/tasks-part-2.md` task X.2.1                                                                          | prose precision              | deferred: restate the fork rule as "any hard criterion other than H5 failing keeps node:test" so no reader has to infer the two-failures case                   |
| SB-027 | same                                                                                  | R3-1-11-3-env-coupling                                           | `openspec/changes/testing-refoundation/tasks-part-2.md` task 1.11.3                                                                         | missing red row              | deferred: add a RED row where an unset `TEST_API_URL` fails fast with a named error, so the deleted `localhost:3000` default is proved gone                     |
| SB-028 | `mental-map-hooks` 3a-i (`workstream/hooks-canon-index`, 4c921dbb)                    | R2-canon-finalize-import-ordering                                | `.claude/scripts/canon-finalize.py:34-41` and the three sibling canon scripts                                                               | duplication                  | closed: three scripts are left and each keeps the two-line bootstrap, which no shared helper can replace                                                        |
| SB-029 | `mental-map-hooks` 3a-ii (`workstream/hooks-canon-staleness`, 61cfeccc)               | R2-canon-line-implicit-invariant                                 | `.claude/hooks-py/user_prompt_submit.py` `canon_index_line`                                                                                 | comment                      | implemented (English sweep, `workstream/hooks-english-canon`)                                                                                                   |
| SB-030 | same                                                                                  | R2-canon-line-broad-except                                       | `.claude/hooks-py/user_prompt_submit.py` `canon_index_line`                                                                                 | comment                      | implemented (English sweep, `workstream/hooks-english-canon`)                                                                                                   |
| SB-031 | same                                                                                  | R2-dead-patterns-named-naming                                    | `.claude/hooks-py/_common.py` `DEAD_PATTERNS_NAMED`                                                                                         | naming                       | implemented (English sweep, 4eb09fdc)                                                                                                                           |
| SB-032 | `mental-map-hooks` sweep 5/5 (`workstream/hooks-sweep-leftovers`, 7c82bfb8)           | R2-synth-naming-mismatch                                         | `.claude/scripts/canon-staleness-report.py` `--synth-days`, `synth_age`, `stale_synth`                                                      | naming                       | deferred: finish the rename to `date` in the locals and the comment; decide the flag separately                                                                 |
| SB-033 | same                                                                                  | R2-list-operations-column-fragility                              | `.claude/hooks-py/tests/test_omnipost_allow.py`                                                                                             | comment                      | deferred: name the separator the alignment test searches for, or share one constant with the CLI                                                                |

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

## Implemented

| Id                                                                     | Implemented in                                       | How                                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SB-005                                                                 | 1d (`workstream/hooks-visibility`)                   | `notice_already_sent` reads and records under `fcntl.flock(LOCK_EX)`; test asserts the lock                    |
| SB-006                                                                 | 1d                                                   | the notices log keeps only the current session's lines when it records; test asserts other sessions are pruned |
| SB-001, SB-002, SB-003, SB-004, SB-T02, SB-T03, SB-008, SB-009, SB-010 | book sweep (`workstream/hooks-book-sweep`, 1e6a3c66) | see the PR; red proofs for the four behavioural rows                                                           |
| SB-031                                                                 | English sweep (`workstream/hooks-english`, 4eb09fdc) | the constant is `MAX_NAMED_DEAD_PATTERNS`, renamed together with its three uses                                |
| SB-029, SB-030                                                         | English sweep (`workstream/hooks-english-canon`)     | two comments in `canon_index_line`: the invariant behind `current`, and what the catch-all absorbs and why     |

## Closed with a reason

| Id     | Reason                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SB-007 | one notice per session about the missing file is the contract, whichever hook detects it                                                                                                               |
| SB-T01 | a hook never runs inside a bare repository; the branch reaches the fallback the suite already proves                                                                                                   |
| SB-028 | three scripts are left after the four report scripts were deleted; each keeps the two-line bootstrap, which a shared helper could not replace because nothing can import it before the path it sets up |
