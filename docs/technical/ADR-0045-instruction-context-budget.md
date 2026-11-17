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

## Risks and Mitigations

| Risk                                                   | Mitigation                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A record nobody reads                                  | The path-scoped rule loads on the governed files; decision 3 blocks an edit with no read                                                                           |
| The rule's `paths` list drifts from the governed files | The budget check refuses a glob that matches no tracked file without a stated reason (amendment, item 5); a governed file the list does not name is left to review |
| A moved citation is left pointing at the canon         | The canon's section lists every moved title, so an old citation resolves in one hop                                                                                |
| The canon or the record grows past the budget          | The budget check of decision 4                                                                                                                                     |

## References

- [`docs/security/DEPENDENCY_AUDIT_RECORD.md`](../security/DEPENDENCY_AUDIT_RECORD.md) and the
  canon's section "Dependency audit record" in
  [`SECURITY_CANON.md`](../security/SECURITY_CANON.md)
- [ADR-0018](ADR-0018-dependency-freshness-canon.md): the dependency freshness canon
- [FOUNDATION_PRACTICES.md](../development/FOUNDATION_PRACTICES.md): FP-033
- The plan row TOKEN-1 in [`cross-cutting.md`](../product/plan/cross-cutting.md)
