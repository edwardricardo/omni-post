# Canon Enforcement

The detail behind two sections of [CLAUDE.md](../../CLAUDE.md), which holds the rules themselves and is loaded in every session; this document is read as a file. For §Pragmatic Exceptions: what each allowed scenario lets a change skip, its marker and its follow-up, the record template of a hot patch and the reviewer's protocol. For §Mandatory Pre-Action Triggers: the reason of each tripwire, whose table `CLAUDE.md` keeps with the hook that holds each row, two more examples of a valid `canon-check:` line, what the hook searches for, and how to extend the list.

## Pragmatic Exceptions

### Allowed scenarios

| Scenario                         | What you can skip                                                            | Marker form                                                | Follow-up                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One-off migration script         | UoW + ports + DI (use `prisma` direct)                                       | `// canon-exception: migration:<ts>`                       | None (script is throwaway; lives under `scripts/migrations/`)                                                                                                                           |
| Prototype branch (`prototype/*`) | TDD strict (write tests after, not before)                                   | `// canon-exception: prototype:<branch>`                   | ADR before merging to main, OR delete the branch                                                                                                                                        |
| Bug-fix hotpatch (P0/P1)         | Coverage gate, fitness count for the patch line                              | `// canon-exception: hotfix:<incident-id>`                 | **Mandatory** ADR within 5 working days of merge                                                                                                                                        |
| Spike work                       | `any`, missing JSDoc, `@ts-ignore` on the spike file                         | `// canon-exception: spike:<branch>`                       | TTL ≤ 2 weeks; if it survives, ADR + remove markers                                                                                                                                     |
| Test fixture coercion            | `as any` / `as never` to construct invalid state for negative tests          | `// canon-exception: test-fixture`                         | None (fixtures are not production code)                                                                                                                                                 |
| Decorative-test demolition       | The `apps/api/vitest.config.ts` floor descent fitness #37 refuses, only that | `// canon-exception: decorative-demolition:<ledger-slice>` | The slice is listed in the committed ledger (`ledger.json`), which records its deletion and its descent ([ADR-0039](../technical/ADR-0039-decorative-demolition-coverage-exception.md)) |
| Generated code                   | All canon (file is regenerated; commenting is futile)                        | Header comment in generated file                           | None (file is in `.gitattributes` `linguist-generated=true`)                                                                                                                            |

`<ledger-slice>` is the demolition slice's work-unit id as the committed ledger lists it (`2.6a`, `2.8.1a`), grammar `[0-9]+(\.[0-9]+)+[a-z]?`. Fitness #37 refuses the bare scenario, a malformed id, a marker the base already carries on that metric, so each descent ships with its own, and a slice that the committed `ledger.json` does not record as deleted in that pull request with that descent.

### Hotpatch ADR template

For scenarios marked **Mandatory** above, the ADR-NNNN follow-up uses:

```markdown
# ADR-NNNN: <scenario>:<incident-id> — canon exception

- **Status**: Accepted (canon-exception)
- **Date**: YYYY-MM-DD
- **Decision-makers**: <the role that approved the hotpatch>
- **Consulted**: <the roles whose opinion was sought, or —>
- **Informed**: <the roles kept up to date, or —>

## What canon was broken

<one line: which rule from which canon doc, file:line of the violation>

## Why the canon path was infeasible

<concrete: time pressure, incident scope, dependency outage, etc.>

## Remediation plan

- [ ] Restore canon path by <date>
- [ ] Remove the `// canon-exception:` marker once remediated
- [ ] Update relevant test/coverage gates

## References

- Incident: <link>
- Commit that introduced the marker: <sha>
```

### Reviewer protocol

When you see `// canon-exception:` in a diff:

1. Confirm the scenario in the marker matches the allowed list above.
2. For **Mandatory ADR** scenarios, block the merge unless the ADR PR is linked.
3. For non-mandatory scenarios, accept the marker but note the TTL where applicable (spike: 2 weeks; prototype: until branch merges or dies).
4. If the scenario isn't in the list → reject + ask for an ADR proposing a new allowed scenario.

Audit the marker pool any time:

```bash
grep -rn "canon-exception:" apps/ packages/ infra/ --include="*.ts" --include="*.tsx" | wc -l
```

A non-zero count is FINE — that's the design. A growing count without paired ADRs or remediation is the smell. Spot-check during code review; no automated CI gate (intentionally — false positives would punish legitimate use).

## Tripwires

| #   | Pattern                                                                                                                                                                                                                                                                                                        | Why it's a tripwire                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Comments matching `// <word>` where `<word>` ∈ {`temporary`, `temporal`, `provisional`, `puente`, `bridge`, `phase-bridge`, `hack`, `kludge`, `workaround`, `patch`, `parche`, `atajo`, `stub`, `placeholder`, `FIXME`, `XXX`, `time-bomb`, `silencioso`, `truco`, `trampa`} (case-insensitive, word-boundary) | Time-bomb / patch / workaround signature — 20 bilingual words derived from grep over `~/.claude/feedback/` + `feedback_archive/`. Per `feedback/canon-research.md §no-time-bombs §no-patches`.                                                                                                                                                           |
| 1b  | `// TODO §X.Y` markers (TODO followed by `§` and section ref)                                                                                                                                                                                                                                                  | Defers work to undefined future phase (vs `// TODO(date \| owner)` which has accountability).                                                                                                                                                                                                                                                            |
| 2   | `// canon-exception:` without a scenario from the [Pragmatic Exceptions](#pragmatic-exceptions) allowed list following the colon                                                                                                                                                                               | Marker must cite a real scenario; un-tagged exceptions defeat the audit grep.                                                                                                                                                                                                                                                                            |
| 3   | Import `from "@core/<a>/..."` inside a file under `packages/core/<b>/src/` where `<a> ≠ <b>` and `<a> ∉ {domain, embeddings, application/UseCase}`                                                                                                                                                             | Cross-bounded-context import. Resolve via port-adapter (see `docs/architecture/BOUNDED_CONTEXTS.md`).                                                                                                                                                                                                                                                    |
| 4   | Mass `sed -i` against import paths in Bash (regex `sed.*-i.*from.*@core`)                                                                                                                                                                                                                                      | Mass-rewrite of imports is the carrier for time-bomb resolution shortcuts. Force review per-file.                                                                                                                                                                                                                                                        |
| 5   | Architectural pattern choice: `extends X`, `class Y implements Z` for new bounded-context-crossing types, `Shared Kernel` / `Anti-Corruption Layer` in JSDoc                                                                                                                                                   | Patterns that require DDD canon research (Evans + Vaughn Vernon).                                                                                                                                                                                                                                                                                        |
| 6   | Plan/phase/sprint/timeline reference inside `//` or `*` comments — matches `Workstream:`, `Phase <letter><digit>`, `§<n>.<n>(.<a>)?`, `S<n>.<n>`, `Per §` / `Resolves §` / `Closes §`, `Sprint/Phase/Fase <digit>`, `Roadmap (item/fase/phase/§)`                                                              | Per CLAUDE.md §Coding-Standards §Comment-Quality-Rules: "No references to sprint numbers, implementation phases, or development timeline — belong in git history, not source code".                                                                                                                                                                      |
| 7   | (Separate hook `pre_edit_planmode_guard.py`) Edit/Write on branch matching `workstream/*` without recent Plan Mode activity in the transcript (no `EnterPlanMode` / `ExitPlanMode` tool, no Read/Edit of `/root/.claude/plans/*.md`). Trivial edits (< 30 lines diff on existing file) auto-pass.              | Per `feedback/workflow.md §planning-before-execution`: non-trivial phase work requires Plan Mode active OR a plan file referenced. No env/token bypass exists; clear the guard via Plan Mode activity or a `/root/.claude/plans/*.md` Read/Edit in the (parent) transcript — a delegating orchestrator can do the latter on behalf of a sub-agent apply. |

## The canon-check line

Examples (valid):

```
canon-check: ARCHITECTURE_CANON.md §Saga.compensable — cross-context import `@core/saga` authorized because the saga engine is transversal infra, not a bounded context.
canon-check: feedback/audit-deletion.md §three-questions — comment `// TODO §X.Y` authorized after (1) is it a time-bomb? no — TTL is 1 session, (2) is there an ADR? yes ADR-NNNN, (3) is the remediation testable? yes.
```

The hook searches the prior assistant message for a line that starts with `canon-check:`, then a `.md` path as its first word, a `§` rule id, a dash (`—` or `-`) with a space on each side, and text after it (`CANON_CHECK_RE` in `.claude/hooks-py/pre_edit_tripwire_blocker.py`). If absent or malformed, the Edit/Write is blocked.

## How to extend tripwires

1. Add the pattern to the table above with rationale.
2. Add the regex to `pre_edit_tripwire_blocker.py` `TRIPWIRE_PATTERNS`.
3. Reset baseline: run `grep -rn '<new pattern>' apps/ packages/` and document any pre-existing instances in a ramp-down ADR.

**Owner:** Maintainers.
