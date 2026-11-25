# ADR-0048: A budget for what an agent reads of one document

- **Status**: Accepted
- **Date**: 2026-11-25
- **Decision-makers**: Maintainer ([GOVERNANCE.md](../GOVERNANCE.md))
- **Consulted**: —
- **Informed**: Product Owner
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0045](ADR-0045-instruction-context-budget.md) (the budget of what a session
  loads by itself; this one budgets what it reads after that)

## Context

The Maintainer's rule for all work: a document is indexed and queried, never read whole and read
again, and a model receives only the rows it must judge. A written rule holds only while the
session remembers it. On the night of 2026-11-25 agents were handed whole documents: runs of 300 to
600 thousand tokens that wrote little, and an estimate of 3.5 to 5 million tokens for a step a
script does. The Maintainer asked for a gate, so that the rule cannot be forgotten.

Measured before the gate merged, by replaying through it the 29,225 Bash commands the hooks' log
kept from 2026-11-11 to 2026-11-25: 429 plain commands named an existing document; 5 would have
been refused judged one command at a time, and 16 with one ledger per day, 10 of them on
`docs/product/plan/chain.md` (225,115 bytes). One refusal was a range: lines 80 to 125 of
`chain.md` are 49,392 bytes. The log keeps no `Read` call and no session id, so reads by the `Read`
tool were not measured and a session's ledger could only be approximated by a day's.

## Decision

1. One PreToolUse hook, `.claude/hooks-py/pre_read_document_budget.py`, on `Read` and `Bash`.
2. A document is a file ending in `.md`, `.mdx`, `.txt`, `.json`, `.jsonl`, `.tsv`, `.csv` or
   `.log`. Source code is not one: a writer reads the code it changes.
3. The budget is 40,000 bytes of one document per agent per session (`BUDGET_BYTES`). A document at
   or under it is never refused. For a larger one the hook keeps, per session, per agent and per
   file, the byte spans read, and refuses a call when their union with the new spans would cover
   more than the budget. A span read again adds nothing.
4. `Read` counts `offset` and `limit` (2,000 lines with no `limit`; zero or below reads nothing).
   A `Bash` command is judged only when it is plain: it holds no subshell or group (`(`, `)`, `{`,
   `}`), no command or process substitution (`$(`, a backtick, `<(`, `>(`), no heredoc or
   here-string (`<<`, `<<<`), and no command whose program is a shell, `eval` or `xargs`. A command
   that is not plain is allowed, unrecorded and unlogged. In a plain command the hook counts what a
   pipeline's last command prints, or the one before trailing pagers: `bat`, `cat`, `tac`, `nl`,
   `less`, `more`, `head`, `tail` and `sed -n` with line-number `p` commands, with their ranges, from
   a file named or a redirected standard input, behind `timeout`, `env`, `command`, `nice` or a
   `sudo` that runs something, or not. A search or a computation (`rg`, `jq`, `wc`, `awk`, a script)
   and a reader whose output goes to a file are never counted: querying is the way past. A `cd`
   that is a command of its own moves the directory for what follows; one inside a pipeline of
   several commands does not.
5. The refusal exits 2 with the document's size, the budget, how much of it the agent has read and
   the way past. A fault of the hook allows the call and writes one line to the hooks' log.
6. The ledger is read and written under one lock, so calls of one session made in parallel are
   judged one after the other. A call tries the lock without blocking for at most 2 seconds
   (`LOCK_WAIT_SECONDS`); past that the ledger is a fault, and the call is allowed. The settings
   entry gives the hook a `timeout` of 10 seconds: a hook that runs out of time lets the call go
   on. An allowed read is recorded before the call runs: a call that then fails keeps its read
   counted.
7. No token and no variable switches it off. The budget changes by a pull request.

## Rationale

The cost the rule prevents is the bytes a model receives, so the gate measures bytes, and their
union: a range read twice costs once, and many small reads of one document cost what they cover.
The ledger is per agent because each agent has its own context. The guard fails open because it
protects a budget, not a secret: a session it stopped by its own error would cost more than the
read it let through.

## Alternatives Considered

- **A written rule alone.** Rejected: it is what failed on 2026-11-25.
- **A check of a delegation's brief.** Not instead: a brief can name a path the agent then reads
  whole. It is the next unit, named in the plan row.
- **A report after the fact.** Not instead: the tokens are spent before it runs. It follows as a
  closing report that flags an agent above a token ceiling.

## Consequences

- A feature document above the budget can no longer be read whole by a worker: it is queried by
  section. The feature documents of F-01 (224,780 bytes) and F-02 (118,657 bytes) are above it.
- Each subagent has its own budget of every document, apart from its parent's: a parent that hands
  one document to five agents can have it read five times.
- Every `Read` and `Bash` call pays for the hook. Measured on the development box on 2026-11-25: the
  decision takes 0.02 to 0.1 ms, and running the hook as a process about 36 to 40 ms, against 6 ms
  for a bare interpreter.
- A reader inside any construct that makes a command not plain is not counted, and neither is any
  other reader of that command. This is a choice: the guard is against a habit, and every structure
  it would have to interpret (heredoc bodies, groups, subshells, substitutions, nested shells) is
  where three rounds of wrong refusals came from. Replayed over the log, the plain rule leaves one
  whole read uncounted that the earlier design refused: a `cat` of a 41,849-byte log in a command
  that also held a subshell.
- Known limits, stated rather than guarded: a glob (`cat docs/*.md`), `git show <rev>:<path>`,
  `rg ''` (a search that matches every line), an interpreter that prints a file, the Grep tool, a
  reader feeding a filter (`cat f | head -n 20`), `sed` without `-n`, a range the hook cannot
  compute (`bat -r $L:+8`, skipped with a log line) and a command the shared tokenizer cannot read
  are not counted.
- `pushd` moves the directory as `cd` does, but `popd` is not followed: a reader after a `popd` is
  resolved from the directory the `pushd` moved to.
- The hook makes one tokenizing pass and calls none of the shared scans for heredocs or nested
  shells. On the three shapes those scans are slow on, measured on 2026-11-25: `<<` with no
  delimiter on every line and many `<<` on one line take under 0.1 ms at 8 to 64 KB (the text
  check stops them before the tokenizer), and many shell words before one `-c` take 3 ms at 8 KB
  and 19 ms at 64 KB.

## Legal impact

`none — session tooling; no personal data, cookie or storage key, OAuth scope, recipient, retention
period, acceptance record or controller role changes`

## Support impact

`none — a hook of the development sessions; no page under docs/support/ describes a path it touches`

## Deployment impact

`none — no repository variable or secret, runtime variable, external account or post-deployment
check is added, changed or retired`

## Revisit if

- The harness itself budgets what an agent reads of one file: the hook retires.
- No tracked document above the budget remains and the plan's parser serves every read of the plan:
  the hook retires.
- The refusals of a real week show the budget refusing reads the work needs: the number changes by
  a pull request, with that week's count.

## Risks and Mitigations

| Risk                                                 | Mitigation                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| The guard refuses a read the work needs              | The refusal names the way past; the budget changes by a pull request   |
| A read reaches the agent by a shape the guard misses | The limits are named; the next units check the brief and report tokens |
| A fault of the guard stops a session                 | Every fault allows the call and writes one line to the hooks' log      |
| Two parallel calls both pass against one ledger      | The check and the record run under one lock on the ledger file         |
| A held lock makes every call wait                    | The lock is waited for 2 seconds at most, then the call is allowed     |
| A hostile command makes the hook slow                | One tokenizing pass; no shared scan for heredocs or nested shells      |
| A structure the hook misreads refuses a needed read  | A command that is not plain is not judged at all                       |

## References

- [cross-cutting.md](../product/plan/cross-cutting.md), the plan row of this unit
- `.claude/hooks-py/tests/test_pre_read_document_budget.py`
