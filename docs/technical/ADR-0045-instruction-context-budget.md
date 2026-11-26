# ADR-0045: The instruction context loaded by every session holds rules; a record that grows with every change is read as a file, never loaded

- **Status**: Accepted
- **Date**: 2026-11-17
- **Decision-makers**: Product Owner ([GOVERNANCE.md](../GOVERNANCE.md))
- **Consulted**: Maintainer (the hooks and the gates this decision adds)
- **Informed**: —
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0018](ADR-0018-dependency-freshness-canon.md) (the dependency audit record that
  moves); [ADR-0040](ADR-0040-artifact-language-and-role-attribution.md) (the roles rule this
  record follows)

## Context

1. Every session of this project loads `CLAUDE.md`, the four canon documents it imports, the
   memory index and the project's local instruction file by itself. Those files grow with every
   change: the auto-loaded project files were 449 KB on 2026-10-15, 561 KB on 2026-11-13 and 572 KB
   on 2026-11-14.
2. On 2026-11-17 the Product Owner reported that Opus 5.5 had been refused by the model provider's
   safeguards for three days in this project, whatever the message, "Hello" included. The parent
   measured it with twelve headless probes of the same message: the refusal follows the size of the
   loaded instruction content, not the message. An empty directory answered; the project's
   `CLAUDE.md` and the four canon documents (268K input tokens) answered; the same with the local
   instruction file (281K) answered; adding the memory index (about 287K) was refused; the real
   project (about 290K) was refused; the same project with the security canon cut to its rules
   (189K) answered; a request of `sonnet` with the same 290K answered.
3. The largest part of that content is not a rule. `docs/security/SECURITY_CANON.md` was 319,025
   bytes, and its section "Audited audit-ignores", a record with tables and dated history that grows
   with every dependency change, was 295,719 bytes of them (the parent's first estimate of the
   section was 285,612 bytes), about 98,000 tokens of every request. The other 23,306 bytes are
   the canon's rules.
4. Four more probes, run on 2026-11-17, found where the line is drawn:

   | Probe        | Setup                                                                | Result                                                                                                                                    |
   | ------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
   | R4 (`haiku`) | a path-scoped rule that imports a document; the prompt reads no file | the imported document loads at session start, with the rule as its parent: an `@import` inside a path-scoped rule defers nothing          |
   | R3 (`opus`)  | the 189K fixture and a rule importing the 286,379-byte record        | refused on the first request at about 287K (`req_011Ch8kBtcvokvQ9axm7VdAt`)                                                               |
   | R5 (`opus`)  | the same fixture, the record as the rule's own body                  | the first request answers and reads a file, the rule loads on the match, and the next request is refused (`req_011Ch8kHAGAU6Mmxz3CHEFLF`) |
   | R6 (`opus`)  | the 189K fixture; six neutral files of 66 KB read with the Read tool | answers, with a last request of 326,680 input tokens                                                                                      |

   So the line is on the instruction content the harness loads (memory files, imports, rules), at
   the start or later, and not on the size of the conversation: the same amount read as a file
   costs nothing against it. A subagent loads the same instruction files, and the writer launched on
   `opus` for the first unit of this decision was stopped on its first request
   (`req_011Ch8kf9V9GnBsg1jcunTzk`).

## Decision

1. **Rules load, records are read.** The auto-loaded instruction context holds rules. A record
   that grows with every change (a ledger, an audit trail, dated history, a table of rows) lives in
   a document that is read as a file.
2. **A moved document is never loaded as instruction content.** It is not imported with `@import`
   from any file, and it is not the body of a path-scoped rule; a short path-scoped rule under
   `.claude/rules/` points at it. The rule loads when a governed file is touched, and says where the
   record is, that it is read as a file, what to search in it before a change and what the change
   must record there. The first record moved is the dependency audit record,
   [`docs/security/DEPENDENCY_AUDIT_RECORD.md`](../security/DEPENDENCY_AUDIT_RECORD.md), moved byte
   for byte from the canon; the canon keeps its rules and a short section,
   "Dependency audit record", with the obligation to read and update it.
3. **Loading is checked, and a lack blocks.** At session start the set of instruction files the
   harness reports as loaded is compared with a checked-in manifest, and a session that lacks a
   required file is blocked, failing closed. An edit of a governed file is blocked when the session
   did not read the record. These two land with the enforcement task of this feature; until they do,
   the rule of decision 2 is the only mechanism, and nothing blocks a session.
4. **A size budget is held by a check.** The bytes of the auto-loaded instruction content have a
   budget that a check in the battery holds, with its red path shown, so the context cannot grow back
   unnoticed. The check and its figure land with the enforcement task; the plan row TOKEN-1 holds the
   open budget question.

This record decides the whole feature; the unit that moves the dependency audit record is its first
part, and the other parts (the fitness section of `CLAUDE.md`, the local instruction file, the
feedback files, the enforcement) follow as their own units.

## Rationale

1. **The measurement is the reason.** The refusal follows the loaded instruction content, so the
   fix is to load less of it, and the content that can leave without losing a rule is the record.
2. **Every request pays for what it loads.** The record is about 98,000 tokens of every request,
   and a change to a dependency is the only work that uses it; moving it lowers the cost of every
   call of every model.
3. **A rule that is read when needed is enough for a record.** The record is searched by package
   name before a change to that package; it needs to be found, not to be present.

## Alternatives Considered

- **Import the record from a path-scoped rule.** Not taken: measured by R4, the imported document
  loads at session start, so it defers nothing, and R3 was refused on the first request.
- **The record as the body of a path-scoped rule.** Not taken: measured by R5, the first request
  answers, the rule loads on the match and the next request is refused.
- **Leave the record auto-loaded and change the model.** Not taken: the context keeps growing, and
  every request of every model carries 98,000 tokens it does not use. `sonnet` answered at about
  290K, so a change of model does not stop the growth.

## Consequences

**Positive**

- The canon is 24,832 bytes of rules and a pointer, and the instruction context of a session falls by about 98,000
  tokens.
- A change to a dependency is guided by a rule that loads when the governed file is touched.

**Negative / costs**

- The record is read as a file, so a change that skips the search can miss an entry. Decision 3
  closes that, and is not in force yet.
- Every consumer of a moved section is repointed: the hold-table gate, the comments of
  `pnpm-workspace.yaml`, the policy and plan documents. Dated records, such as accepted ADRs,
  keep their old citation, which resolves through the canon's section "Dependency audit record".

## Amendment of 2026-11-17: the budget check and its manifest

Decision 4 is in force. Decision 3 stands as written and is not yet in force: the session check
and the edit guard are not part of this amendment.

1. **The manifest.** `.claude/instruction-manifest.json` names the instruction files a session
   loads by itself: `tracked`, the files every checkout loads (`CLAUDE.md` and the four canon
   documents it imports); `local`, the files only the main checkout holds and git ignores
   (`CLAUDE.local.md`, `.claude/CLAUDE.md`); `records`, each moved record with its path-scoped
   rule and, in `emptyGlobs`, each glob of the rule that matches nothing today with the reason;
   and `budget`.
2. **The check.** `scripts/testing/instruction-context-gate.mjs`, run as
   `pnpm check:instruction-context` and as the static battery step `instruction-context`,
   derives a set that is never smaller than what the harness loads at session start, and holds it
   to the manifest in both directions. It does not copy the harness's loader, whose next version
   could move away from a copy; where it cannot derive exactly, it counts the file, so its errors
   are false reds and never false greens.
   - **Derived exactly:** the entry files the harness reads from the project root, each when git
     tracks it: `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`.
   - **Over-counted on purpose:** a tracked `AGENTS.md` or `.claude/AGENTS.md`, which the harness
     reads beside `CLAUDE.md` only under a per-user setting; every `@` token of a loaded file and
     of every rule, path-scoped ones included, since an import loads at session start whatever
     its rule's scope, wherever it is written (code spans, fenced blocks and comments included),
     read with every prefix, so an import next to Markdown markup or with a `#` fragment is never
     missed, and followed with no depth limit, past the harness's four hops; every rule under
     `.claude/rules/` whose front matter does not prove it path-scoped (`paths:` and a block list
     of double-quoted globs, at least one glob with no comma and no brace that, trimmed and once a
     trailing `/**` is cut, is neither empty nor `**`), since the harness loads at session start a
     rule whose `paths:` is null, all `**` or not valid YAML. A symbolic link or a submodule at
     `.claude`, at `.claude/rules` or under `.claude/rules/` is refused, because git's listing
     does not show the rules behind it.
   - **Not counted:** what the harness loads on a match after session start, a path-scoped rule's
     body, a `CLAUDE.md` in a subdirectory and the rules of a `.claude/rules` directory inside a
     subdirectory; files git does not track, those of the main checkout named by the manifest's
     `local` list; the files
     of a session started in a subdirectory; and the user's and the organization's instruction
     files.

   It holds the budget, and it holds each record: its rule is a tracked rule under
   `.claude/rules/` whose front matter proves it path-scoped, that imports nothing and names the
   record, the record is tracked and never loaded, and every glob of the rule matches a tracked
   file unless `emptyGlobs` says why not. It exits 0 clean, 1 on a verdict, 2 on a usage error and
   3 on an input it could not read, a file git tracks and the checkout lacks included; 3 wins.

3. **The figure.** The budget counts tracked files only, because a local file exists in one
   checkout and neither CI nor a worktree can read it; the local files are measured by the
   closing measurement of this feature. Measured at `253b2413` with `wc -c`: `CLAUDE.md` 201,668,
   `ARCHITECTURE_CANON.md` 18,519, `CODING_STANDARDS.md` 30,762, `SECURITY_CANON.md` 24,776,
   `LOGGING_CANON.md` 13,172; 288,897 bytes in all, which is `budget.bytes`. The target stays
   250,000 bytes (the plan row TOKEN-1), and `budget.targetOwedBy` names the plan item that brings
   the context under it.
4. **A ceiling with a slack, not an exact figure.** The context may not exceed `budget.bytes`,
   and `budget.bytes` may not sit more than 1,024 bytes above the context: a larger gap is a stale
   ceiling, which `--write` lowers and never raises. An exact figure would conflict on its one line
   at every merge of two branches that both touch a loaded document; the ceiling still makes any
   growth above the recorded figure a red that only a visible, hand-made edit of `budget.bytes`
   clears. Growth back into the slack a reduction leaves, at most 1,024 bytes, passes with no edit
   until `--write` lowers the figure. While `budget.bytes` is above the target, `targetOwedBy` is required; once the context
   meets the target it must be deleted, and the target then holds as a hard cap.
5. **The risk row on the rule's `paths:`** is closed in one direction: the rule's `paths:` is the
   one list of governed files, and the check refuses a glob that matches no tracked file unless
   the manifest gives the reason. The reverse direction, a governed file the list does not name,
   stays with review: no source states which files the record governs except the rule itself.

## Amendment of 2026-11-17: the enforcement

Decision 3 is in force, with one correction of its wording: the loads are compared with the
manifest at every prompt, not at session start.

1. **The prompt, not the session start.** No event at session start can block: `SessionStart`
   shows its stderr and goes on, and `InstructionsLoaded`, which reports each instruction file the
   harness loads, runs asynchronously and ignores its exit code
   ([hooks reference](https://code.claude.com/docs/en/hooks)). `UserPromptSubmit` can block, and a
   prompt it refuses never reaches the model (measured: a refused headless prompt ends with
   `num_turns: 0` and no cost). So `.claude/hooks-py/instructions_loaded.py` records each reported
   load, per session, under `.claude/state/instruction-context/`, which git ignores, and
   `.claude/hooks-py/user_prompt_instruction_check.py` compares that record with the manifest at
   every prompt. The loads arrive asynchronously, one of them measured 1 ms after the first prompt
   hook started, so the check reads the record for at most 5 seconds and then blocks.
2. **What a session must have loaded.** Every `tracked` entry, and every `local` entry when the
   checkout's marker stands or when the checkout is a main checkout (its `.git` is a directory)
   that holds any `local` entry. The recorder writes the marker the first time it records a `local`
   file loaded in a checkout: one file under `~/.claude/instruction-context-markers/`, named by the
   sha256 of the checkout's real path, outside the checkout, so that deleting every local file (as
   `git clean -fdX` does) cannot silence their requirement. A linked worktree and a clone the local
   files were never copied to have no marker and require the tracked set alone. A checkout meant to
   hold no local file drops its marker by hand: the refusal prints its path and `rm <marker>`. A
   marker directory the check cannot read blocks, since the check cannot then tell, and so does a
   marker path that holds a symbolic link, a directory or anything but a regular file, whose
   refusal prints `rm -r <marker>`. Residual limits of the marker: a checkout that moves to another
   real path starts with no marker, so the requirement of its local files restarts at its next load
   of one; and a session can remove the marker with a Bash command, which no hook refuses, a
   deliberate act on a file outside the checkout, the same class as a line forged into a reads file
   (item 5). A required file
   must stand on disk as a non-empty regular file, which is decided at once, and must be in the
   session's record. The record only grows: a file that stops loading after the session's first
   load of it (its import removed, then a compaction) passes until the session ends, and only what
   stands on disk is checked again at every prompt.
3. **Fail-closed.** The check and the guard's judging entry are wired with `"onFailure": "block"`
   ([hooks reference](https://code.claude.com/docs/en/hooks): from Claude Code 2.1.295, a hook that
   cannot start, exits with a code other than 0 or 2, or times out then refuses its prompt or call,
   where without the key the harness lets it through). Measured on 2.1.326 with a check that lost
   its executable bit: the prompt was blocked with the key (0 turns, no cost) and answered without
   it. Inside its process the check turns each failure of its own into exit 2 with its repair:
   input that is not JSON, a missing or malformed manifest, a marker or a record it cannot read, no
   record after the wait, and any exception, a failure to import its shared module included. The
   key has no effect before 2.1.295 (measured on 2.1.143: the prompt went through), so the check
   refuses a harness that does not name 2.1.295 or later in its `AI_AGENT` variable, with the
   upgrade to make; the variable is not in the hooks reference and was measured
   (`claude-code_2-1-326_harness`, `claude-code_2-1-143_harness`); an empty value is reported as
   empty. Residual: on an older harness a check that cannot start lets the prompt through; the
   gate's rule W1 (item 7) holds each hook tracked, executable and wired with the key. The value can
   be forged: an `env` block in a settings source overrides the `AI_AGENT` the harness sets
   (measured with a `--settings` file on 2.1.143, whose forged value passed the check). W1 refuses
   the key in the tracked settings, and a settings source the hooks do not guard (item 6) can still
   set it; what a forged value gains is, on an old harness, the fail-open of a check that cannot
   start, and nothing else. The recovery when a blocking hook cannot start,
   measured on a fixture: a session starts meanwhile with `--settings '{"disableAllHooks": true}'`
   (measured with the key in the same settings source as the hooks; the reference gives a
   `--settings` value precedence over project and local settings), which turns every hook off, the
   other guards included, so it serves the repair alone; the hook is restored from a plain terminal
   with `git -C <root> checkout -- .claude/hooks-py/<hook>.py`, which writes the file and its
   executable bit back from git's index; the next session passes.
4. **Subagents.** A subagent's hook input carries its parent's session id, and no load event fires
   for the files it receives at its start (measured), so the session covers its subagents: a
   subagent runs only under a session whose prompt passed. The built-in Explore and Plan agents
   receive no instruction files by design.
5. **The write guard.** `.claude/hooks-py/pre_tool_record_guard.py` runs on `PreToolUse` twice,
   keyed by session and by agent (`main` for the session). As `record`, on Read and Grep and with
   no `onFailure`, so that a guard that cannot run never refuses a read, it records each opening
   of a record document, and an opening is a tool call the harness performed: the Read tool on it,
   or the Grep tool whose path (the working directory when absent) is the record or a directory
   that holds it, when its `glob` and `type` still select it. A Bash command opens nothing, `rg` and
   `bat` included: its text says what it would run, not what ran (`false && rg x <record>`,
   `exit 0; rg …` and a failing `cd X && rg …` name searches that never happen), so the guard does
   not read it. The natural sequence is to find the row's lines with `rg -n '<package>' <record>`,
   then Read that range. As `judge`, on Edit, Write, MultiEdit and Bash and with
   `"onFailure": "block"`, it refuses a write of a file the record's rule governs until the same
   agent has opened the record in an earlier call of this session. It judges an Edit, Write or
   MultiEdit of its file; in a Bash command, and in every script it hands to a shell, every
   destination `pre_bash.effective_write_targets` derives, every word of a command that holds an
   in-place writer whose file is a word of it (pre-bash's `COARSE_WRITE_RES`, and `sd`), and
   `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` for a pnpm command that writes them,
   run directly or through a launcher (`corepack pnpm`, `npx pnpm`, `env … pnpm`). Every builtin and
   alias pnpm 12.6.0's `pnpm help` lists (it refuses `pnpm help -a`) is in exactly one class, by what
   `pnpm help <command>` says it writes and, for `lane`, `prune`, `change`, `clean --lockfile` and
   `config set`, by a measurement in a scratch workspace: it writes, and is judged under the flags
   that decide it (`install` unless `--frozen-lockfile` and no flag that writes the lockfile, `ci`
   only with one, `audit` only with `--fix` or `--interactive`, `dedupe` unless `--check`, `clean`
   only with `--lockfile`, `config set` and `config delete` only with `--location project`, `pkg`
   only with `set`, `delete` or `fix`); it writes none of the three files; or it runs code. A test
   reads the installed pnpm's list and fails naming a command in no class, so a pnpm that adds one
   goes red until it is classified. "Writes none of the three" holds where the lockfile already
   records pnpm itself, as this repository's does: measured, pnpm 12.6.0 writes `pnpm-lock.yaml` on
   most commands (`list`, `why`, `view`, `outdated`, `root`, `pkg get`) when it does not. A write
   the guard cannot derive passes unjudged: a script or a pnpm command that runs code, an
   interpreter one-liner (`python3 -c`, `node -e`, `perl -pi`), another package manager, a path
   built from a variable, `git apply`, and a checkout or a rebase that names no governed file. A
   Bash command the guard cannot read as shell words is refused only when its text holds the word
   `pnpm` or a name the last named segment of a governed glob matches, the names read from the
   rules' `paths:`; two commands are refused that write no governed file, and each costs one Read of
   the record: `git restore --staged package.json` and `CI=true pnpm install`. The refusal prints
   the rule's body, how to open the record and the forms that count. It judges a file by the
   manifest and the rule of the checkout that holds it, because a path-scoped rule loads neither for
   a file in a sibling worktree nor before the first write of a new file (both measured), and it
   keys on tool calls rather than on the transcript, which a subagent shares with its parent and
   which may lag behind the conversation. The manifest and a broken rule stay editable, so the
   repair is never locked out. A line written into a reads file by hand counts as an opening:
   `.claude/state/` is not a guarded path, so only a deliberate act gets there. Measured costs, a
   median of ten runs on 2026-11-17: 36 ms for `record` on a Read of a Markdown file that is not a
   record (a Read of any other file returns before an import), and 39 ms for `judge` on a Bash call
   that writes nothing and on one that cannot be parsed; a Bash call no longer starts `record`.
6. **The switch.** By the Maintainer's decision of 2026-11-17,
   `MAINTAINER_DISABLE_INSTRUCTION_CHECK=yes` in the environment the hooks run with turns the check
   and the guard off. An `env` block in a settings source reaches the hooks too (measured with a
   `--settings` file). The pre-edit and pre-bash gates guard every file whose path holds
   `/.claude/settings.json` or `/.claude/settings.local.json` (`SENSITIVE_PATTERNS`,
   `.claude/hooks-py/pre_edit.py:29-39`, which `pre_bash.py:40` imports): the project's settings,
   the local settings and the user's `~/.claude/settings.json`. They do not guard the managed
   settings file, `/etc/claude-code/managed-settings.json`, which the harness reads (its debug log
   names the path), and a `--settings` file or argument and the terminal's environment are chosen by
   whoever launches the session. So the switch is not the Maintainer's alone to set; what keeps it
   from staying on unseen, whoever sets it, is the condition of the Maintainer's decision: every
   prompt shows the person and the model a warning that the check is off and how to switch it back
   on, and every prompt and every write it lets through unjudged writes a line to
   `.claude/hooks.log`. W1 refuses the switch in the tracked settings' `env` block (item 7). The
   unguarded source is the plan row INSTRUCTION-SETTINGS-UNGUARDED.
7. **The wiring rule.** The gate's rule W1 refuses a tree whose `.claude/settings.json` is not
   tracked, sets `disableAllHooks`, sets `MAINTAINER_DISABLE_INSTRUCTION_CHECK` or `AI_AGENT` in its
   `env` block with any value, or does not run four entries: the recorder on `InstructionsLoaded`
   and the check on `UserPromptSubmit`, each in a group with no matcher, the guard's `record` on
   `PreToolUse` in a group whose matcher names Read and Grep and no other tool (a Bash call opens
   no record, so a matcher that still names Bash is refused), and its `judge` for Edit, Write,
   MultiEdit and Bash. W1 reads the tracked settings only: the same keys set in any other settings
   source are not held. Each entry is an allowlist: `type: "command"`, its command, an optional
   timeout of at least 10 seconds (the check may wait 5), and, on the check and the judging guard,
   `"onFailure": "block"`, which the recording entries may not carry; every other key (`async`,
   `asyncRewake`, `if`, `shell`, `args` and any unknown one) is refused, since each changes whether
   the hook runs or blocks, and so is a second copy that breaks the allowlist. It also refuses a
   tree whose three hooks or shared module `_instruction_context.py` are not tracked, or whose hooks
   are not executable in git's index and in the checkout. The gate runs in CI as an
   un-numbered step of the fitness job; it takes a number when the fitness section of `CLAUDE.md` is
   rewritten (plan row TOKEN-1), since a numbered check adds its block to the file whose bytes the
   gate holds.
8. **The rollout.** A session already running when the hooks reach its checkout has no record of
   its loads, so its next prompt is blocked, and the message gives the repair: end the session and
   resume it once (`claude --resume <id>`); the harness reports every instruction file again on
   resume (measured), and the session passes. The same repair serves a session whose record was
   cleaned away. State files no session has written for 30 days are removed. By harness, measured
   on a fixture: a session of the VS Code extension's Claude Code 2.1.326 passes; a session of the
   `claude` on this machine's path, 2.1.143, is refused at its first prompt with the upgrade to
   make, and lets the prompt through if its check cannot start. A session of that 2.1.143 `claude`
   that is already running when the hooks reach its checkout gets the version refusal at its next
   prompt, not the no-record message: the check reads the harness version before the record.
9. **Not covered, stated.** A required file deleted between two prompts, by a compaction, a built-in
   slash command or in the middle of a turn, is caught at the next prompt; a file that is still on
   disk but stops loading after the session's first load of it is not (item 2). A session started
   in a subdirectory of the project runs none of the hooks of the tracked `.claude/settings.json`,
   these included: measured on 2.1.326 from `docs/` of a linked worktree (debug log
   `525014ad-f1fa-41c1-b974-a45dbf427608`), the harness looked for the project settings at
   `docs/.claude/settings.json` and `docs/.claude/settings.local.json` and found neither (lines 3-4),
   never at the worktree root's `.claude/settings.json`, and watched `docs/` for a `.claude` to
   appear (line 168); the local settings it read and watched were the main checkout's
   `/root/omni-post/.claude/settings.local.json` (lines 23-30 and 169), which holds no `hooks` today;
   and `$CLAUDE_PROJECT_DIR` named `docs/` (plan row SUBDIRECTORY-SESSION-RUNS-NO-PROJECT-HOOK). The
   memory index is not reported by the harness and
   stays outside the manifest; a session started with
   `--setting-sources` that leaves out the project, or with `--bare`, runs none of the project's
   hooks; and the review tool's native reviewers run in an empty temporary directory with
   `--setting-sources ""` (its Claude adapter, gentle-ai 4.2.0), so no hook of this project runs
   there and none can block them.
10. **Retirement.** The check retires when the harness itself refuses a session that lacks a
    required instruction file, or when `CLAUDE.md` imports nothing and no local file remains; the
    guard, per record, when its document leaves the tree or every row of it is derived by a gate
    from machine-readable data, so that a skipped search cannot lose a fact.

## Amendment of 2026-11-18: the fitness reference

1. **The second record.** The blocks of the fitness checks left `CLAUDE.md` §Automated Compliance
   Checks for [`docs/development/FITNESS_FUNCTIONS.md`](../development/FITNESS_FUNCTIONS.md), byte
   for byte: the fenced block of the 54 checks (157,314 bytes, sha256 `fba1d8f2d7facc8a…`) and the
   paragraph on the integration-tier RLS coverage gate (2,389 bytes, sha256 `7718c881676a3520…`).
   The reference is the manifest's second record. Its path-scoped rule,
   `.claude/rules/fitness-functions.md`, governs the fitness workflow, the reference itself and the
   scripts whose behaviour a block states, and the record guard of decision 3 refuses a write of
   those files until the session, or the agent writing, has opened the reference. A block is a
   record while its one-line rule stays loaded: a block grows with every change of its check (its
   threat, scope, exclusions, fail-closed paths and residual limits), while what a session needs in
   order to work is the list of checks and how to change one.
2. **The list is derived.** `CLAUDE.md` keeps the section's heading, its governing paragraph, the
   paragraph on a scope path that does not exist, a paragraph that says where the blocks are, one
   line per check, a short pointer for the RLS coverage gate, and "Extending the suite". A list line
   is `- **#N** <name> — <how>`: its name is the name of its step in
   `.github/workflows/fitness.yml`, copied, and `<how>` is `shell` or the command the step runs. No
   rule is reworded: the list carries the workflow's names, and "Extending the suite" changes only
   the words that name where a block lives.
3. **Fitness #44 holds the three sources to one set.** It reads the numbered steps of the workflow
   with their run bodies, the `# N.` headings of the reference's `## Check blocks`, and the list of
   `CLAUDE.md`. It refuses a number one of the three lacks, a list name that differs from its
   step's, a list command its step's body does not contain, a list line not in the form, a check
   block left in a code block of `CLAUDE.md`, and a count sentence in the reference.
4. **The instruction-context gate is fitness #55.** Item 7 of the previous amendment left it
   un-numbered until the section was rewritten, since a numbered check added its block to the file
   whose bytes the gate holds. Its block now lives in the reference, and `CLAUDE.md` carries its
   list line only.
5. **The measurement.** `CLAUDE.md` went from 201,668 to 48,394 bytes, and the auto-loaded tracked
   set, as the gate measures it, from 288,897 to 135,623 bytes, 114,377 under the target of
   250,000. `budget.targetOwedBy` left the manifest (the gate's `--write` lowers `budget.bytes` and
   leaves that key, so it was deleted by hand), and rule B3 now refuses any `budget.bytes` above the
   target: the target holds as a hard cap.
6. **ADR-0012 superseded in one point.** ADR-0012 adds a check's regex to `CLAUDE.md §Automated
Compliance Checks`. The block now goes to the reference, and that section takes the check's line
   and the raised count, as its "Extending the suite" states.
7. **The import form, measured.** The gate resolves an `@` token from the directory of the file
   that holds it. `@docs/development/FITNESS_FUNCTIONS.md` written in a rule under `.claude/rules/`
   names no file and loads nothing; `@../../docs/development/FITNESS_FUNCTIONS.md` written there is
   refused by R1 and R2, and `@docs/development/FITNESS_FUNCTIONS.md` written in `CLAUDE.md` by R2
   and M1.

## Amendment of 2026-11-18: the feedback files

1. **The five files live in the project.** `CLAUDE.local.md` imports five feedback files
   (`workflow.md`, `canon-research.md`, `audit-deletion.md`, `runtime-contract.md` and
   `tools-infra.md`, 71,143 bytes together). They lived in the user's directory, and an import that
   resolves outside the project loads only once the harness holds an approval for the project
   (`hasClaudeMdExternalIncludesApproved`), which is `false` for this one: measured on 2026-11-17,
   a session loaded 8 instruction files and none of the five. They now live under
   `.claude/feedback/`, which git ignores, and `CLAUDE.local.md` imports them by a path relative
   to itself.
2. **The manifest's `local` list names them.** The session check of decision 3 therefore requires
   them of a session in the main checkout, as it requires `CLAUDE.local.md` and
   `.claude/CLAUDE.md`: 12 files where it required 7, and a session whose record lacks one is
   refused at its next prompt. The budget check cannot read a file git ignores, so of the five it
   holds what rule M2 holds of every local entry: git tracks none of them, and the tracked set
   loads none.
3. **The measurement.** On 2026-11-18 a headless session in the main checkout reported 13
   instruction files as loaded (the 12 and the user's own file), the five among them, each as an
   `include` with `CLAUDE.local.md` as its parent. The session check, run over that session's
   record with this manifest, passes; run over the record of a session started before the move, it
   refuses and names the five.

## Amendment of 2026-11-18: the closing measurement

1. **What the ceiling covers.** The Product Owner decided on 2026-11-18 that the 250,000 bytes of
   decision 4 cover the project's files a session loads by itself: the tracked set, the local files
   of the main checkout and the feedback files. The user's own instruction file and the memory
   index load too and are outside it: they belong to the user and to the machine, not to a
   checkout, and the manifest does not name them.
2. **The bytes.** With the feedback files loading, the project's files total 223,800 bytes, 26,200
   under the ceiling: 135,623 tracked, as the gate measures them; 679 of `CLAUDE.local.md`; 16,355
   of `.claude/CLAUDE.md`; 71,143 of the five feedback files. Beside them a session on this machine
   loads the user's instruction file, 91,629 bytes, and the memory index, 15,008: 330,437 bytes in
   all, where the plan row TOKEN-1 counted about 692,000 before this feature.
3. **The requests.** A headless request of one word from the main checkout on 2026-11-18, each
   session reporting 13 instruction files: `opus` (`claude-opus-5-5`) 166,618 input tokens, `sonnet`
   (`claude-sonnet-5-5`) 166,587, `haiku` 167,298, and each answered. On 2026-11-17 the same
   checkout sent about 290,000 and `opus` refused every request; once the audit record had left the
   canon it sent about 187,000.
4. **What no check holds.** The gate holds the tracked set to its exact ceiling and to the target.
   It cannot read the local and the feedback files, 88,177 bytes today, which git ignores and which
   grow with every new feedback rule, so their sum with the tracked set is measured here and held
   by no check (plan row `INSTRUCTION-BUDGET-LOCAL-FILES-HELD-BY-NO-CHECK`).

## Amendment of 2026-11-25: the inventory in the reference

1. **The list follows the blocks.** By the Product Owner's decision of 2026-11-25, the list of one
   line per check left `CLAUDE.md` §Automated Compliance Checks for the section `## Inventory` of
   [`docs/development/FITNESS_FUNCTIONS.md`](../development/FITNESS_FUNCTIONS.md), with no change of
   wording but the pointers the move made false, and with it the detail of the ratcheted baselines and of the three checks that run on
   `pull_request` only, the paragraph on a scope path that does not exist, the paragraph on the
   integration-tier RLS coverage gate and "Extending the suite", now a section of its own there.
   `CLAUDE.md` keeps the count sentence, where it is stated once, the pointer to the reference with
   its search command, the mention of fitness #44 and the red-path rule for every gate. This changes
   item 2 of the amendment of 2026-11-18, whose list is still derived from the workflow, and item 4,
   since `CLAUDE.md` no longer carries a line for fitness #55.
2. **Fitness #44 reads the list there.** It reads the numbered steps of the workflow, the `# N.`
   headings of the reference's `## Check blocks` and the lines of its `## Inventory`, and the count
   sentence of `CLAUDE.md`; a list left in `CLAUDE.md` is never read as the inventory, so a
   reference without its inventory fails closed, and a list line left in that section is refused
   by its line number. This changes item 3 of the amendment of 2026-11-18. A citation of
   `CLAUDE.md §Automated Compliance Checks` now resolves in two hops, through the section's pointer
   to the reference, where the Risks table says one; and the line of the References that names
   "their list in `CLAUDE.md`" describes the state before this amendment.
3. **The measurement.** `CLAUDE.md` went from 45,484 bytes before the pull request of the rows P to
   21,185, and the auto-loaded tracked set, as the gate measures it, from 132,672 to 108,421 bytes.

## Amendment of 2026-11-26: the canon keeps its rules, and its reference is read as a file

The Product Owner took six decisions on 2026-11-26 on how the canon loads, one at a time, each on
a measured cost. The measurements read 14 days of this project's session transcripts, 343 of them
(main sessions 21,329 turns in 22 transcripts, subagents 55,356 turns in 321), with scripts kept
beside the tools, outside the tree. A cost is in token-turns, the tokens a text weighs times the
turns that carry it, and the tokens of a text were counted as its bytes divided by four: item 9
measures how low that is, so the ratios between routes hold and every absolute token figure of
items 1 to 6 is low by that factor. On that scale the decided text of the four canon documents is
11,043 tokens, where the documents were 21,808.

1. **The main session keeps the canon loaded.** `CLAUDE.md` still imports the four canon
   documents with `@`, and they now hold their rules only; no path-scoped rule and no loader hook
   carries them. Carried on every main-session turn, the decided text costs 235.4 million
   token-turns over the 14 days, against 464.9 million for the documents before. A route by path
   with full coverage would save 17.6% of it, 41.4 million, 0.13% of all the tokens of the period;
   a native path-scoped rule does not reach full coverage, because it fires on a file of the main
   checkout only: 34.4% of the main-session turns follow a code touch there, 82.4% follow one in
   any checkout. The main session needs the rules before it touches a file, to write a brief and to
   judge a delivery.
2. **The writer and the verifier carry the canon; the auditor does not.** Subagents make 2,560 of
   the 2,767 code writes of the period (92.5%), and 94.8% of their code writes fall in a sibling
   worktree, where a native path-scoped rule does not load: such a rule is in the context of 5.1%
   of their code writes. The ceiling cost of the canon loaded at the start of every agent that
   writes code or only reads it is 331.5 million token-turns, 1.05% of all tokens, against 1,207
   million when every subagent loaded the whole canon. The verifier judges a delivery against the
   canon; a brief for an audit against the canon names the document.
3. **The workers receive it by the native preload.** One loader skill, to be listed in `skills:` of
   the writer's and the verifier's definitions, reads each tracked canon document at the agent's
   launch by one command placeholder per document. Measured by probes on `sonnet`: a preloaded skill's
   whole body reaches an agent with `omitClaudeMd`, as a user-role message ahead of the brief, and a
   project skill preloads as a user skill does; a placeholder runs when the agent is launched, so the
   agent receives the file as it is at that moment; outputs of 6,000 to 30,000 bytes arrived whole,
   five of them 85,989 bytes in one skill, and one of 85.2 KB arrived as a preview of 2 KB that the
   agent is not told to read; of two identical commands in one skill only the first was replaced
   (one observation). So each canon document stays under 30,000 bytes, and each definition is to
   stop its agent when the canon arrives missing or as a preview. This item records the decision.
   The loader skill, the `skills:` field and the stop line are local configuration outside the tree
   (git ignores `.claude/skills/`), added to the local agent definitions once the documents of this
   change are on `main`; none of the three exists yet. A `SubagentStart` hook was not chosen: by
   the documentation's account, not measured, its `additionalContext` is capped at 10,000
   characters per string.
4. **Each canon document keeps its rules, and its reference moves to a companion beside it.** The
   rationale, the examples and `## How to extend` of each document are in
   `ARCHITECTURE_CANON_REFERENCE.md`, `CODING_STANDARDS_REFERENCE.md`,
   `SECURITY_CANON_REFERENCE.md` and `LOGGING_CANON_REFERENCE.md`, each in its document's
   directory, read as a file and never imported. The reference is 5,371 tokens; loaded with the
   rules, it would be carried on the 21,329 main-session turns and on the 30,022 turns of the agents
   that write or read code, 275.8 million token-turns, 0.87% of all tokens. The rules keep the paths
   the citations name: of 214 mentions of the four documents in tracked files, the 37 that name a
   section all name a rule section.
5. **Three-line headers.** Each canon document opens with its title, `**Owner:** Maintainers` and
   a `**Reference:**` line that names its companion. The quote that said how the document loads and
   the `**Loaded:**` line left: `CLAUDE.md` §Canon Documents says it once, and no script read them.
   The four headers went from 280 to 270 tokens, so this decides where a fact is stated, not a cost.
6. **A rule that governs one area lives in that area's document.** The saga rules are in
   [`docs/architecture/SAGA_CANON.md`](../architecture/SAGA_CANON.md), the React rules in
   `docs/frontend/REACT_STANDARDS.md`, the client portal's rules in
   `docs/standards/frontend-standards.md`, the Prisma rule in
   `docs/architecture/schema-conventions.md` and the dependency rules in
   `docs/security/dependency-audit-policy.md`. The loaded canon keeps one pointer line per piece
   that says when to read it, and the brief of a unit that touches the area names the document. The
   pieces are about 2,160 tokens: loaded with the canon they would cost 111.3 million token-turns;
   as native path-scoped rules 5.7 million, covering between 0% and 9% of the subagents' writes of
   each area; as documents read on a pointer at the first touch in any checkout 21.5 million, 6.4
   million of it the five pointer lines.
7. **The bytes.** Before is `git cat-file -s 21e9bc007:<path>`, the base of this change; after is
   `wc -c` of the tree.

   | Loaded file             | Before  | After  |
   | ----------------------- | ------- | ------ |
   | `CLAUDE.md`             | 21,185  | 21,939 |
   | `ARCHITECTURE_CANON.md` | 18,529  | 8,392  |
   | `CODING_STANDARDS.md`   | 30,715  | 18,752 |
   | `SECURITY_CANON.md`     | 24,800  | 13,164 |
   | `LOGGING_CANON.md`      | 13,192  | 6,636  |
   | **Total**               | 108,421 | 68,883 |

   The four canon documents went from 87,236 to 46,944 bytes; `CLAUDE.md` grew by 754, its
   §Canon Documents now saying how the four load and what fitness #24 holds. The auto-loaded
   tracked set, as the gate measures it, is 68,883 bytes, and `budget.bytes` was lowered from
   108,421 to 68,883 with the gate's `--write`. Five documents are new, each read as a file and never
   imported: `ARCHITECTURE_CANON_REFERENCE.md` 6,191 bytes, `CODING_STANDARDS_REFERENCE.md` 6,554,
   `SECURITY_CANON_REFERENCE.md` 6,458, `LOGGING_CANON_REFERENCE.md` 2,041 and `SAGA_CANON.md`
   3,954, 25,198 in all. The documents that received a section grew: `REACT_STANDARDS.md` from 8,062
   to 11,072, `frontend-standards.md` from 33,337 to 35,409, `dependency-audit-policy.md` from 2,384
   to 5,012 and `schema-conventions.md` from 20,082 to 20,588.

8. **Fitness #24 reads the companion.** Its contract, per canon document: the document exists; a
   line of it starts `**Owner:**`; its companion, the document's path with `.md` replaced by
   `_REFERENCE.md`, exists; a line of the companion is exactly `## How to extend`. The step checks
   every clause of every document and exits 1 at the end when any failed, so one run names every
   violation. Before, it required `## How to extend` in each canon document, which left with the
   reference, and it accepted a line that starts `**Owner:` with no closing asterisks and a heading
   that only starts `## How to extend`; both now fail. Its block is in
   [`docs/development/FITNESS_FUNCTIONS.md`](../development/FITNESS_FUNCTIONS.md), with its limits:
   it proves the companion exists, not that the `**Reference:**` line names it.
9. **The token scale, measured twice.** On the main session's model (`claude-fable-5-2`), 3.23
   bytes per token, 3.09 characters per token: the merge of the rows P lowered the five loaded files
   by 24,251 bytes, from 132,672 to 108,421, and the first-turn input of the main session fell by
   7,497 tokens, from 140,811 to 133,314, while the rest of the text recorded before the first turn
   moved by about 1,000 characters. On `sonnet`, 2.78 bytes per token: a probe that preloaded about
   174,200 bytes of canon text started at 65,763 tokens against 3,101 for its control. So the real
   count is about 24% above "bytes divided by four" on the main session's model and about 44% above
   on `sonnet`, and the 11,043 tokens of the decided text are about 13,700 on the first scale and
   15,900 on the second. Each figure is one measurement on one model, and the first one measured the
   text of `CLAUDE.md`, tables and lists, not the canon's. Sizes in this record are therefore given
   in bytes.
10. **What the review of the four documents left to this record.**
    - The section "Mandatory Requirements for Every Sprint" of `CODING_STANDARDS.md` is renamed
      "Mandatory Requirements for Every Change". ADR-0035 is a record that keeps its words, and it
      names the section by its earlier heading (`:11` in full; `:88` and `:121` as "§Mandatory
      Requirements"), which is now "Mandatory Requirements for Every Change".
    - The section "Storybook port convention" of `CODING_STANDARDS.md` is removed. ADR-0035 cites it
      (`:88`) for the colocation of a story, which `docs/frontend/REACT_STANDARDS.md` §"A story per
      component" states.
    - ADR-0035 records (`:10`, `:86-88`) that `CODING_STANDARDS.md` §Test Framework Rules gained the
      story row and the criterion. The row stays there; the criterion lives in
      `REACT_STANDARDS.md` alone, §"When a story passes".
    - ADR-0037 cited `CODING_STANDARDS.md` §"React component JSDoc — props on the interface" for its
      note that App Router components need `appDirectory: true`; the note is in
      `REACT_STANDARDS.md` §"A story per component", and the two citations of ADR-0037 now name it.
    - The section "Dependency audit record" is in both security files: `SECURITY_CANON.md` keeps the
      rule to read the policy and the package's entry before a change, and says the record holds the
      sections cited as `SECURITY_CANON.md §"<title>"`; `SECURITY_CANON_REFERENCE.md` holds the
      obligation to read the entry and record the change, the statement that the record is
      authoritative and the list of the moved titles. The canon no longer says why the record is not
      loaded: decisions 1 and 2 of this record say it. So decision 2's "a short section, 'Dependency
      audit record', with the obligation to read and update it", the line of the References that
      names that section in `SECURITY_CANON.md`, and the Risks row "The canon's section lists every
      moved title" describe the state before this amendment: an old citation resolves in one hop
      through the canon's sentence to the record, and the titles are listed in the companion. The
      record's rule, `.claude/rules/dependency-audit-record.md`, names the companion.
11. **What this change does not do.** It adds no hook and no path-scoped rule for the canon. A
    native path-scoped rule loads for a file of the main checkout and not for a file of a sibling
    worktree, where most code is written: that limit holds for the two path-scoped rules of the
    records, which stay as they are, and this change does not repair it. It adds no loader skill
    and changes no agent definition: that configuration is local and follows the merge (item 3).
    The budget check counts the tracked files a session loads, so no check of this repository will
    hold the loader skill, and no gate holds a canon document under the 30,000 bytes a placeholder
    delivers whole: the stop line decided for each definition is to be that guard, and until it is
    added nothing holds that limit. The instruction
    context gate, fitness #55, is unchanged; only its manifest's `budget.bytes` moved.

## Legal impact

`none — documentation and tooling; no personal data, cookie or storage key, OAuth scope,
recipient, retention period, acceptance record or controller role changes`

## Support impact

`none — documentation and tooling; no feature page under docs/support/ describes a path this
change touches`

## Deployment impact

`none — no repository variable or secret, runtime variable, external account or post-deployment
check is added, changed or retired`

## Revisit if

- The model provider's limit on instruction content changes: the budget of decision 4 is then
  re-measured.
- A moved record stops being consulted: a measurement of edits that skipped the search decides
  whether decision 3's block is enough.
- The harness gains an event at session start that can block, or refuses by itself a session that
  lacks a required instruction file: the check at the prompt moves there, or retires.

## Risks and Mitigations

| Risk                                                   | Mitigation                                                                                                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A record nobody reads                                  | The path-scoped rule loads on the governed files; decision 3 blocks an edit with no read                                                                                                                          |
| The rule's `paths` list drifts from the governed files | The budget check refuses a glob that matches no tracked file without a stated reason (amendment, item 5); a governed file the list does not name is left to review                                                |
| A moved citation is left pointing at the canon         | The canon's section lists every moved title, so an old citation resolves in one hop; a citation of `CLAUDE.md §Automated Compliance Checks` finds the check's line there and its block by number in the reference |
| The canon or the record grows past the budget          | The budget check of decision 4                                                                                                                                                                                    |

## References

- [`docs/security/DEPENDENCY_AUDIT_RECORD.md`](../security/DEPENDENCY_AUDIT_RECORD.md) and the
  canon's section "Dependency audit record" in
  [`SECURITY_CANON.md`](../security/SECURITY_CANON.md)
- [`docs/development/FITNESS_FUNCTIONS.md`](../development/FITNESS_FUNCTIONS.md), the blocks of the
  fitness checks, and their list in `CLAUDE.md` §Automated Compliance Checks
- [ADR-0012](ADR-0012-fitness-functions-architecture-tests.md): the fitness functions, whose
  location of a check's regex the amendment of 2026-11-18 supersedes
- [ADR-0018](ADR-0018-dependency-freshness-canon.md): the dependency freshness canon
- [FOUNDATION_PRACTICES.md](../development/FOUNDATION_PRACTICES.md): FP-033, FP-034, FP-048
- The plan row TOKEN-1 in [`cross-cutting.md`](../product/plan/cross-cutting.md)
