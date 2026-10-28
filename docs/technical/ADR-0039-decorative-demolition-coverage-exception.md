# ADR-0039: Decorative-test demolition — a coverage-floor descent under a marker that names its ledger slice

- **Status**: Accepted
- **Date**: 2026-10-19
- **Deciders**: Edward (owner) — decision D2 of the Testing Refoundation tracker (2026-09-27); plan
  approval 2026-10-05 and 2026-10-19
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [CLAUDE.md](../../CLAUDE.md) §Pragmatic Exceptions and fitness #37;
  [TESTING_REFOUNDATION_PLAN.md](../development/TESTING_REFOUNDATION_PLAN.md) premise 5 and WU-2.0;
  [TESTING_REFOUNDATION.md](../development/TESTING_REFOUNDATION.md) decision D2 and metric M14

## Context

1. **Coverage counts execution, not assertion.** A test that calls code and asserts nothing about it
   (an existence check, a tautology, a self-skip) raises the coverage of everything it calls. Phase 2
   of the Testing Refoundation deletes those tests, up to 105 files and 272 blocks by the plan's
   Appendix C upper bound, and each deletion lowers measured coverage by the lines only it executed
   (premise 5 of the plan).
2. **`apps/api`'s floors are a ratchet.** The four global literals in `apps/api/vitest.config.ts`
   (`lines` 56.8, `functions` 57.3, `branches` 47.8, `statements` 56.2 on `b053ba58`) rise through
   `autoUpdate`, a run below one goes red, `apps/api/tests/unit/config/coverageThresholds.test.ts`
   pins them exactly, and fitness #37 refuses a hand-lowered literal against the pull request's base.
3. **#37 accepts a descent only under a listed scenario.** The marker
   `// canon-exception: <scenario>` on or above the lowered literal must name a scenario of
   §Pragmatic Exceptions. None of the six covers deleting tests that asserted nothing: `hotfix` is a
   P0/P1 patch with a mandatory ADR within five working days, and the other five skip other rules.
4. **#37's matcher read the scenario only**, measured on `b053ba58`. A marker could not name what
   justified its descent, and a marker the base already carried accepted every later descent under
   it: with a base carrying `// canon-exception: hotfix:INC-1` above `statements: 56.1`, the step
   accepted a second descent to 56.0 under the same line (exit 0).

## Decision

1. **A seventh scenario, `decorative-demolition`**, in §Pragmatic Exceptions. It skips one thing:
   the floor descent #37 refuses in `apps/api/vitest.config.ts`. Lint, the slice's own tests and
   every other gate still apply.
2. **Marker:** `// canon-exception: decorative-demolition:<ledger-slice>`, on the lowered literal's
   line or the line above it. `<ledger-slice>` is the demolition slice's work-unit id as the
   committed ledger lists it, grammar `[0-9]+(\.[0-9]+)+[a-z]?` (`2.6a`, `2.7`, `2.8.1a`).
3. **Who may use it:** a demolition slice of Phase 2 (WU-2.6a to WU-2.8.7) that the committed
   `ledger.json` lists, in the pull request that deletes that slice's tests. No other pull request
   carries it.
4. **#37's matcher**, byte-identical in its CLAUDE.md block and its `fitness.yml` step: `SCENARIOS`
   gains `decorative-demolition`; a `SUBJECTS` map holds each scenario whose marker names its subject
   after a colon, with the subject's grammar; the bare scenario and a malformed id are refused; and,
   for every scenario, a marker the base already carries on that metric accepts no new descent.
5. **Reconciliation:** the slice's pull request records in the tracker its deleted files and blocks
   and the expected and real drop, and edits `MEASURED_FLOOR` in `coverageThresholds.test.ts` to the
   lowered values. M14, "coverage that was decorative", counts the descents carried by a marker,
   re-derived by `metrics.mjs --m14` from the ledger's marker slices.
6. **The pre-edit tripwire hook** (`.claude/hooks-py/pre_edit_tripwire_blocker.py`) admits the
   scenario.

## Rationale

- The descent is the measurement becoming true: the lines it loses were executed by tests that
  proved nothing about them. Refusing it keeps a number that overstates what is tested.
- Naming the slice makes each descent attributable to one listed deletion: M14 can sum it and a
  reviewer can check it against the ledger.
- The grammar is checked by machine so that M14 can parse the slice from the marker, and so that a
  marker without one cannot pass.
- A marker stays above its literal after its slice merges, and nothing removes it. Without the
  inherited-marker refusal the next pull request could lower the same floor under the old slice's
  id.

## Alternatives Considered

- **Lower the ratchet globally**, once to a post-demolition estimate or by loosening #37 for Phase 2.
  Rejected: a real regression in the same window reads as demolition.
- **Freeze #37 during Phase 2.** Rejected: a disabled gate for every pull request of the phase,
  while code keeps changing.
- **A per-pull-request admin override**, D2's other option. Rejected by D2: it leaves no record in
  the tree, and the required check's only exit becomes the override.
- **Per-file floors**, so a deletion moves only its own files' floors. Deferred to WU-5.1, which
  puts coverage defaults in the shared factory.

## Consequences

- A demolition slice that lowers an `apps/api` floor ships the lowered literal, its marker naming
  the slice, and the matching `MEASURED_FLOOR` edit in one diff.
- #37 refuses, for every scenario, a marker its base already carries on that metric. No marker exists
  in `apps/api/vitest.config.ts` on `b053ba58`, so no verdict in the tree changes.
- A scenario that later needs a subject adds one `SUBJECTS` entry.
- The ledger lists each demolition slice under its work-unit id, in this grammar.
- Residual: #37 checks the id's form, not that `ledger.json` lists it. The ledger is committed since
  2026-10-28 (WU-2.5), and the membership check is its own change, which lands before the first
  slice that lowers a floor (the 2.B checklist of the plan); until then no marker exists, and review
  checks membership. M14 reconciles it, and a slice that lowers a floor by more than its deletion
  explains shows in the tracker's expected-versus-real drop.

## Legal impact

None: test tooling and CI. No personal data, cookie or storage key, OAuth scope, recipient, retention
period, acceptance record or controller role changes.

## Support impact

`none for decorative-demolition-coverage-exception — no support document under docs/support/ lists
the paths this decision touches (CLAUDE.md, .github/workflows/fitness.yml, .claude/hooks-py/, docs/)`

## Deployment impact

`none — a CI step's rule changes (fitness #37 in fitness.yml admits one scenario and refuses an
inherited marker); no repository variable or secret, runtime variable, external account or
post-deployment check is added, changed or retired`

## Revisit if

- The last demolition slice merges: the row, its `SUBJECTS` entry and the markers above the literals
  are removed together, unless a later phase plans another demolition.
- WU-5.1 puts floors in every package: the scenario's scope follows the descents to those configs,
  or per-file floors replace it.
- #37 is rebuilt over every config (WU-5.7): `SCENARIOS`, `SUBJECTS` and the inherited-marker
  refusal move with it.
- `ledger.json` is committed: checking the slice's membership moves into #37. Fired 2026-10-28
  (WU-2.5 committed the ledger); the move is its own change, before the first slice that lowers a
  floor.

## Risks and Mitigations

| Risk                                                          | Mitigation                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A pull request that is not a demolition slice uses the marker | The id must name a slice; review checks it against the ledger; M14 reconciles it |
| A marker left from an earlier slice accepts a later descent   | #37 refuses a marker the base already carries on that metric                     |
| A slice lowers a floor by more than its deletion explains     | The tracker records the expected (`--area`) and the real drop per slice          |
| The scenario outlives Phase 2                                 | Revisit-if: removed with the last demolition slice                               |

## References

- [CLAUDE.md](../../CLAUDE.md) §Pragmatic Exceptions, §Mandatory Pre-Action Triggers (tripwire #2),
  §Automated Compliance Checks fitness #37
- `.github/workflows/fitness.yml`, step "#37 Coverage threshold floors never descend vs the PR base"
- `.claude/hooks-py/pre_edit_tripwire_blocker.py` and its suite
  `.claude/hooks-py/tests/test_pre_edit_tripwire_blocker.py`
- [TESTING_REFOUNDATION_PLAN.md](../development/TESTING_REFOUNDATION_PLAN.md) premise 5, WU-2.0,
  WU-2.2, WU-2.5, the demolition slices 2.B, WU-5.1, WU-5.7
- [TESTING_REFOUNDATION.md](../development/TESTING_REFOUNDATION.md) decision D2, metric M14, §Gates
- `apps/api/vitest.config.ts`; `apps/api/tests/unit/config/coverageThresholds.test.ts`
