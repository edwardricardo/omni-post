# Review Suggestions Book

**Owner:** Platform engineering
**As of:** 2026-10-01
**Purpose:** the ledger of review findings disposed as **JUSTIFIED — deferred** because they change no behaviour: comment placement, docstring wording, naming, test-fixture readability, and extra test coverage for branches that already share tested code. Every entry names the candidate, the finding, the exact location and what implementing it would take, so it can be picked up later without re-deriving anything.

## Rules

1. **What may enter.** A finding with severity SUGGESTION whose implementation would not change what the code does: prose (comments, docstrings), naming, formatting choices, and _additional_ test coverage for a path that is already exercised through shared code. Each entry is disposed in the review's dispositions file as `JUSTIFIED` with a pointer to its `SB-nnn` id — the receipt is still burned with every finding disposed.
2. **What never enters.** A WARNING. A finding that names a defect, a wrong value, a missing behaviour, a security or tenant-isolation concern, or a test that proves nothing. Those are fixed in the candidate before it ships, and the candidate is reviewed again.
3. **When it is read.** At the end of each workstream's slices (for the first entries: when the `mental-map-hooks` chain has merged), every row is either implemented — the row moves to **Implemented** with the commit — or closed with a one-line reason. A row is never deleted.
4. **Why it exists.** A fresh reviewer re-reads a whole diff on every round and always finds a new sentence to improve; fixing each one changes the candidate and buys another round. Four rounds on one 370-line change (2026-10-01) is the measurement that created this file. The cost of a deferred sentence is zero; the cost of a round is not.

## Index

| Id     | Candidate                                                          | Finding                                                    | Location                                                   | Kind                     | Status                                               |
| ------ | ------------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------- | ------------------------ | ---------------------------------------------------- |
| SB-001 | `mental-map-hooks` 1a-ii (`workstream/hooks-memory-dir`, 817c93bf) | R2-001                                                     | `.claude/hooks-py/_common.py:85-96`                        | comment placement        | deferred                                             |
| SB-002 | same                                                               | R2-002                                                     | `.claude/hooks-py/_common.py:118` + `tests/test_common.py` | test sentinel            | deferred                                             |
| SB-003 | same                                                               | R2-003                                                     | `.claude/hooks-py/tests/test_common.py:5-6`                | docstring wording        | deferred                                             |
| SB-004 | same                                                               | R2-004                                                     | `.claude/hooks-py/tests/test_common.py:62`                 | fixture comment          | deferred                                             |
| SB-T01 | same                                                               | R3-worktree-detection-depends-on-common-dir-basename       | `.claude/hooks-py/_common.py:67-68`                        | test coverage            | deferred                                             |
| SB-T02 | same                                                               | R3-fallback-branches-of-main-repository-root-untested      | `.claude/hooks-py/_common.py:57-62`                        | test coverage            | deferred                                             |
| SB-005 | `mental-map-hooks` 1d (`workstream/hooks-visibility`)              | R4-notices-log-dedup-race                                  | `.claude/hooks-py/_common.py` `notice_already_sent`        | concurrency design       | implemented (1d, second review raised it to WARNING) |
| SB-006 | same                                                               | R4-notices-log-unbounded, R3-notices-log-unbounded         | `.claude/hooks-py/_common.py` `notice_already_sent`        | growth bound             | implemented (1d, second review raised it to WARNING) |
| SB-007 | same                                                               | R3-cross-hook-dedup-shares-consequence                     | `.claude/hooks-py/_common.py` `emit_missing_file_context`  | dedup key design         | deferred                                             |
| SB-T03 | same                                                               | R3-session-id-tab-collision                                | `.claude/hooks-py/_common.py` `notice_already_sent`        | test coverage / escaping | deferred                                             |
| SB-008 | `mental-map-hooks` 1d                                              | R4-003                                                     | `.claude/hooks-py/_common.py` `emit_missing_file_context`  | recovery notice design   | deferred                                             |
| SB-009 | same                                                               | R2-emit-missing-file-context-hard-coded-hook-event-default | `.claude/hooks-py/_common.py` `emit_missing_file_context`  | parameter default        | deferred                                             |
| SB-010 | same                                                               | R2-load-index-signature-divergence                         | `.claude/hooks-py/pre_edit_decision_guard.py` `load_index` | signature symmetry       | deferred                                             |

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

## Implemented

| Id     | Implemented in                     | How                                                                                                            |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SB-005 | 1d (`workstream/hooks-visibility`) | `notice_already_sent` reads and records under `fcntl.flock(LOCK_EX)`; test asserts the lock                    |
| SB-006 | 1d                                 | the notices log keeps only the current session's lines when it records; test asserts other sessions are pruned |
