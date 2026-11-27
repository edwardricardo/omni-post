# ADR-0044: One plan, ordered by feature and by dependency, replaces the one-file plan and the testing refoundation documents

- **Status**: Accepted
- **Date**: 2026-11-10
- **Decision-makers**: Product Owner (the route and the plan) and Maintainer (the gates and the
  tools) ([GOVERNANCE.md](../GOVERNANCE.md))
- **Consulted**: —
- **Informed**: —
- **Supersedes**: —
- **Superseded by**: —
- **Amended**: 2026-11-27, §"Amendment of 2026-11-27" (the planning documents the plan replaced
  are absorbed into it, nothing in the tree references them, and their files are kept in an
  archive folder that nothing names; decisions 5 and 6 and rationale 4 are amended)
- **Related**: [The plan](../product/PLAN.md) (entered in pull request #858, merge commit
  `57551df8`); [ADR-0040](ADR-0040-artifact-language-and-role-attribution.md) (the artifact
  language and the roles rule that the plan and this record follow)

## Context

1. Three documents listed the pending work of the product with no order by feature: the one-file
   plan this decision replaced, the testing refoundation tracker and its fixed plan.
2. The plan of 2026-11-10 placed every live item of them. A live item is a row or a task its source
   does not mark closed: 562 live rows and tasks of the one-file plan and 110 live units of the
   testing refoundation.
3. The rules of `CLAUDE.md` sent cross-cutting work and every finding outside a task's scope to
   rows of the one-file plan.

## Decision

1. **One plan.** [`docs/product/PLAN.md`](../product/PLAN.md) is the plan, with five parts under
   `docs/product/plan/`: the chain of features (`chain.md`), the areas outside the chain
   (`areas.md`), cross-cutting work (`cross-cutting.md`), the deletion candidates and the old rows
   the code already shows as done (`off-the-map.md`), and the ideas with no slice (`parking.md`).
   It is ordered by dependency, feature by feature, under the rules of its `## Rules` section.
2. **Where work goes.** Cross-cutting work and findings outside a task's scope go to the plan:
   to the feature the finding belongs to, to the cross-cutting part when it belongs to no
   feature, to parking when it is an idea. A finding's viability is decided when its feature opens,
   not when it is found. `CLAUDE.md` says so in its sections "Cross-cutting work" and "Findings
   outside a task's scope", and in step 4 of "Extending the suite".
3. **What leaves.** The testing refoundation tracker and its fixed plan leave the tree, and the
   tools whose only purpose was to read the tracker leave with them: `scripts/testing/metrics.mjs`,
   its suite `apps/api/tests/unit/scripts/testingMetrics.test.ts`, and the battery step `metrics`.
4. **What stays.** Fitness #30, #36, #37, #49, #52, #53 and #54; the test ledger; `mutation-diff`;
   `docs/development/testing-refoundation/`; `TESTING_REFOUNDATION_MEASUREMENTS.md`; `openspec/`;
   and the decision records.
5. **The one-file plan stays in the tree as an archive that takes no new row**, by the Product
   Owner's decision of 2026-11-10: "I approve all of it, except deleting [its] file: I want to keep
   it as an archive. It can be removed from every reference, and/or the references changed to
   point to the new plan." This is a stated exception to the Plan closure rule of `CLAUDE.md`,
   under which a closed plan leaves the tree and every place that cites it gets a permanent link.
   Amended on 2026-11-27: the one-file plan is absorbed into the plan, nothing in the tree
   references it, and its file is kept in an archive folder that nothing names (§"Amendment of
   2026-11-27").
6. **Delivery in separate changes.** The plan entered in pull request #858 (merge commit
   `57551df8`) and nothing else did. This change moves the tools and the rules. A later change
   removes the two testing refoundation documents, marks the one-file plan as the archive and
   repoints the citations; the archive and the citations are amended on 2026-11-27 (§"Amendment of
   2026-11-27").

## Rationale

1. **One document to work from.** The aim is "a single cleaner, more explanatory document, without
   having to go back and forth between other documents each time a feature needs work" (Product
   Owner).
2. **The rules move with the plan.** A rule that names a section or a row of the one-file plan as
   the destination of work would keep sending work to the old document, so each such rule names
   the plan instead.
3. **A tool that reads a deleted document has no purpose.** The Product Owner: "We will no longer
   need them, so they are deleted too." They leave in the change that stops the rules from naming
   the tracker.
4. **The archive keeps the ids resolvable.** The SMELL, FN and DEF ids written across the tree
   resolve in the rows of the one-file plan. Amended on 2026-11-27: they resolve in the plan
   (§"Amendment of 2026-11-27").

## Alternatives Considered

- **Reorder the one-file plan in place.** Not taken: the Product Owner asked for one document that
  holds the text of each feature itself, so that work on a feature does not go back and forth
  between documents; a reordered one-file plan would still sit beside the tracker and its fixed
  plan.
- **Delete the one-file plan with permanent links, the default of the closure rule.** Not taken:
  the Product Owner keeps it as an archive (decision 5).
- **Keep the metrics script without the metric that reads the tracker.** Not taken: the script's
  purpose was to derive the metrics the tracker lists, and the Product Owner decided the tools
  leave with the tracker.

## Consequences

**Positive**

- Cross-cutting work and findings have one destination, named in `CLAUDE.md` and in the plan's
  rules.
- The battery runs one step fewer, and no tool reads the tracker.
- This record amends the sentence of [ADR-0040](ADR-0040-artifact-language-and-role-attribution.md)
  on where a closed tracker's content goes: the tracker's state and decisions are kept at the
  permanent link, and its live units went to the plan, not to the one-file plan.

**Negative / costs**

- The metrics the tracker lists are no longer derived by a script.
- Until the later change lands, the tracker and the fixed plan remain in the tree, frozen, and the
  tracker's metric commands no longer resolve.
- The one-file plan stays in the tree, an exception to the closure rule, stated in decision 5 and
  amended on 2026-11-27 (§"Amendment of 2026-11-27").

## Legal impact

`none — documentation and test tooling; no personal data, cookie or storage key, OAuth scope,
recipient, retention period, acceptance record or controller role changes`

## Support impact

`none — documentation and test tooling; no feature page under docs/support/ describes a path this
change touches`

## Deployment impact

`none — no repository variable or secret, runtime variable, external account or post-deployment
check is added, changed or retired; the battery step that leaves is a local tool`

## Revisit if

- The later change that removes the testing refoundation documents lands: this record's
  consequences about the frozen tracker then stop applying.
- The Product Owner decides the archive leaves the tree: the Plan closure rule's default then
  applies to it, and decision 5 is amended.

## Risks and Mitigations

| Risk                                                         | Mitigation                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| A finding is attached to the archive out of habit            | `CLAUDE.md` and the plan's rules name the plan, and the archive takes no row  |
| An old id no longer resolves                                 | The ids resolve in the plan (`pnpm plan:show <id>`), as amended on 2026-11-27 |
| A citation of the tracker is left pointing at a deleted file | The later change repoints every citation to a permanent link or removes it    |

## References

- [The plan](../product/PLAN.md)
- The two testing refoundation documents at commit `a72e0525`:
  [testing refoundation tracker](https://github.com/edwardricardo/omni-post/blob/a72e052577f4c74903de2e7b48487daa85658c7f/docs/development/TESTING_REFOUNDATION.md) and
  [its fixed plan](https://github.com/edwardricardo/omni-post/blob/a72e052577f4c74903de2e7b48487daa85658c7f/docs/development/TESTING_REFOUNDATION_PLAN.md)
- [ADR-0040](ADR-0040-artifact-language-and-role-attribution.md): the roles rule
- [FOUNDATION_PRACTICES.md](../development/FOUNDATION_PRACTICES.md): FP-028 and FP-029

## Amendment of 2026-11-27

The Product Owner decided on 2026-11-25 that the plan is the only source of truth, and said of
the planning documents it replaced: "None must remain, all must be absorbed, but they do not have
to be eliminated; just make sure that they are not referenced and move them to an archive folder
or similar." The decision covers every planning document the plan replaced, the one-file plan of
decision 5 among them.

1. **Absorbed.** Everything those documents held is absorbed into the plan, and the SMELL, FN and
   DEF ids written across the tree resolve in it (`pnpm plan:show <id>`).
2. **Unreferenced.** Nothing in the tree references them, by a path, a link or a name.
3. **Kept.** Their files are not deleted: they are kept in an archive folder that nothing names.

This amendment replaces two decisions of this record: that the one-file plan stays in the tree as
an archive that takes no new row and that a citation of one of its closed rows may point at it
(decision 5, and its exception in the Plan closure rule of `CLAUDE.md`), and that the old ids
resolve in its rows (rationale 4). The citations decision 6 repoints cite the plan, or say what
they have to say without the citation; none points at the archive folder. `CLAUDE.md` states the
decision in its Plan closure rule and in its rule on findings outside a task's scope.
