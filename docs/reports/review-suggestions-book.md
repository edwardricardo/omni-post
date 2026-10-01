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

| Id     | Candidate                                                          | Finding                                               | Location                                                   | Kind              | Status   |
| ------ | ------------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------- | ----------------- | -------- |
| SB-001 | `mental-map-hooks` 1a-ii (`workstream/hooks-memory-dir`, 817c93bf) | R2-001                                                | `.claude/hooks-py/_common.py:85-96`                        | comment placement | deferred |
| SB-002 | same                                                               | R2-002                                                | `.claude/hooks-py/_common.py:118` + `tests/test_common.py` | test sentinel     | deferred |
| SB-003 | same                                                               | R2-003                                                | `.claude/hooks-py/tests/test_common.py:5-6`                | docstring wording | deferred |
| SB-004 | same                                                               | R2-004                                                | `.claude/hooks-py/tests/test_common.py:62`                 | fixture comment   | deferred |
| SB-T01 | same                                                               | R3-worktree-detection-depends-on-common-dir-basename  | `.claude/hooks-py/_common.py:67-68`                        | test coverage     | deferred |
| SB-T02 | same                                                               | R3-fallback-branches-of-main-repository-root-untested | `.claude/hooks-py/_common.py:57-62`                        | test coverage     | deferred |

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

## Implemented

_None yet._
