# ADR-0046: No feature closes with an open item under its record

- **Status**: Accepted
- **Date**: 2026-11-20
- **Decision-makers**: Product Owner ([GOVERNANCE.md](../GOVERNANCE.md))
- **Consulted**: Maintainer (the gate and its wiring)
- **Informed**: —
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0044](ADR-0044-feature-ordered-plan.md) (the plan whose tracking rule this
  completes); [ADR-0040](ADR-0040-artifact-language-and-role-attribution.md) (the roles rule the
  decision form follows)

## Context

1. The plan's tracking rule ([PLAN.md](../product/PLAN.md), section "Rules") sets a feature
   `closed` when its proof of done passes on `main`, and has the closing pull request mark each
   attached item it resolved `Closed by #<n>`. It says nothing of an item the pull request did not
   resolve, and the rule "An old item is attached to its feature first; its viability is decided
   when the feature opens" does not say where an item goes when its feature closes without it.
2. F-01 closed with pull request #916 while 24 rows of its record were open: 18 that its confirmed
   cut left under "Wait", and 6 findings made while it was open
   ([cross-cutting.md](../product/plan/cross-cutting.md), item ROWS-WAIT-UNDER-CLOSED-F-01).
3. On 2026-11-20 F-02 came within one change of closing with 22 open items under its record. Told
   so, and that an item under a closed feature has no date and no owner, the Product Owner decided
   (translated): "no phase should close with open items … and you implement a way to enforce that
   every item is closed before a phase closes; closing with open items makes no sense."
4. No check read the chain table: `CLAUDE.md` §Plan tracking ended "No check reads the table."

## Decision

1. **A feature closes only when no item under its record is open.** An item is an entry of the
   record's `Attached (<n>)` list or of a list whose label starts with `Findings`. Each item is
   resolved in code, its text starting with `Closed by #<n>`, the pull request that resolved it, or
   closed by a recorded decision, its text starting with
   `Closed by decision of the <Product Owner|Maintainer> on <YYYY-MM-DD>: <the decision>`, where
   the date is a calendar date no later than the day the check runs and the decision holds at
   least one word of three letters or more. Neither form has punctuation of its own: the rest of
   the item's text follows it. Two items' texts, for example:
   - `Closed by #916. Each portal's predev builds …`
   - `Closed by decision of the Product Owner on 2026-11-20: it waits for the move to production.`
2. **A gate holds it.** Fitness #56, `scripts/testing/plan-closure-gate.mjs`
   (`pnpm check:plan-closure`), reads the chain table of the plan and refuses a `closed` feature
   whose record holds an open item, naming the feature and each item. It fails closed, with its own
   message and exit 3, when the plan or a record file cannot be read, when the chain table cannot
   be read, when a closed feature's record is not found or is found twice, and when a record's
   items cannot be read: an entry that is neither an item nor a note, a nested list entry, any line
   of the record shaped like an item that no item list reads, wherever it is written, and a fenced
   code block nothing closes. Fenced code blocks are never read. Only the chain table holds a
   state: the table of the areas outside the chain has no `State` column (`docs/product/PLAN.md`,
   line 86 at commit `6bc6482b`), so an area's open rows are not judged until a feature of the
   area joins the chain table. It runs in the `fitness` job of the fitness workflow, a required
   check of the `main` ruleset (`.github/rulesets/main.json`), and as the static battery step
   `plan-closure`. Its block in [FITNESS_FUNCTIONS.md](../development/FITNESS_FUNCTIONS.md), under
   `# 56.`, gives its scope and its residual limits.
3. **No baseline, and F-01 reopens.** F-01 was `closed` with 24 open items when the gate was
   written. No baseline and no allowlist hold the gate green: the Product Owner decided on
   2026-11-20 that F-01 returns to `in progress` in the same change that brings the gate, and
   closes again when its rows are resolved, in the order of that day (the decisions of F-02's
   items, then those of F-01's, then the repairs of each).

## Rationale

1. **An open item under a closed feature waits for nothing.** No slice opens the feature again, so
   nothing schedules the item and nothing says it waits.
2. **The rule in prose did not hold.** The plan's rules already meant a closed feature to be done,
   and F-01 closed with 24 open items; F-02 nearly closed with 22.
3. **Two forms, both starting `Closed by`.** A reader looking for what closed an item finds both
   with one search. The decision form names the role and the date, so the decision can be traced
   to the role that holds it ([ADR-0040](ADR-0040-artifact-language-and-role-attribution.md)), and
   the decision itself follows the colon, so the record holds it.
4. **The record's own count anchors the reading.** Every record states `Attached (<n>)`; a gate
   that reads a different number of items has misread the record, and refuses rather than passes
   (FP-003 in [FOUNDATION_PRACTICES.md](../development/FOUNDATION_PRACTICES.md)).

## Alternatives Considered

- **Keep the rule in prose.** Not taken: it is the state in which F-01 closed with 24 open items.
- **Move every open item to another feature or to the cross-cutting part when its feature closes**
  (the proposal written in ROWS-WAIT-UNDER-CLOSED-F-01). Not taken as the rule: the Product Owner's
  rule is that every item is resolved or decided before the closure, and a decision that moves an
  item is one more recorded decision in the second form.
- **A baseline that holds F-01's 24 items as known.** Not taken: it would hold green exactly the
  state the rule forbids.
- **Read the records with a Markdown parser, or compare the table's `Closed by` column with the
  items.** Not taken: the records are written in a few fixed line shapes, which the gate reads
  strictly and fails closed on; both stay residual limits of the gate's block.

## Consequences

**Positive**

- No feature reaches `closed` with an open item under its record unless the gate is red.
- `CLAUDE.md` §Plan tracking states both forms and names the gate; the sentence "No check reads the
  table." is gone.

**Negative / costs**

- The gate runs inside a required check, so a feature marked `closed` with an open item under its
  record, or a closed feature's record the gate cannot read, blocks every merge to `main` until it
  is repaired. F-01 returns to `in progress` for that reason (decision 3), which also gives the
  count of 0 on `main` that step 4 of "Extending the suite" in `CLAUDE.md` asks for before the wire
  merges.
- The `Attached (<n>)` count of a record is now load-bearing: a record whose count disagrees with
  its items fails closed when its feature closes. Measured with all 18 features marked closed on a
  copy of the plan at commit `72718bb2`: F-05's `Attached (10)` list held no entry, its rows written
  under the next label, and the gate read 177 open items.
- A record holds no nested list and no item outside its item lists: such a line fails closed while
  its feature is closed. One false positive is left: a line of a closed record, outside a code
  span and not an entry's continuation, that writes a bold text followed by `: ` is refused until
  it is reworded.
- The areas outside the chain are not judged: they have no state the gate could read (decision 2).
- The battery runs one more static step.

## Legal impact

`none — documentation and test tooling; no personal data, cookie or storage key, OAuth scope,
recipient, retention period, acceptance record or controller role changes`

## Support impact

`none — a gate over the plan's documents; no feature page under docs/support/ describes a path this
change touches`

## Deployment impact

`none — no repository variable or secret, runtime variable, external account or post-deployment
check is added, changed or retired; the gate reads files of the repository only`

## Revisit if

- The plan leaves the tree under the Plan closure rule of `CLAUDE.md`: the gate leaves with it.
- The Product Owner decides that a feature may close with an open item.
- A record gains an item list whose label is neither `Attached (<n>)` nor `Findings …`: the gate,
  its block and this record change together.
- The table of the areas outside the chain gains a `State` column: the gate judges it the same
  way, and its block and this record change with it.

## Risks and Mitigations

| Risk                                                           | Mitigation                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| An item is marked closed by a pull request that did not fix it | Review reads the marker; the gate proves the form only, a stated limit       |
| A decision is written in a form the gate does not read         | The gate names the item and prints both forms; the item counts as open       |
| An item is written where the gate cannot read it               | Fail-closed on any item-shaped line no list reads, and on a count off a list |

## References

- [PLAN.md](../product/PLAN.md), section "Rules"; [chain.md](../product/plan/chain.md), the
  records of F-01 and F-02
- [cross-cutting.md](../product/plan/cross-cutting.md), item ROWS-WAIT-UNDER-CLOSED-F-01
- [FITNESS_FUNCTIONS.md](../development/FITNESS_FUNCTIONS.md), check #56
- [FOUNDATION_PRACTICES.md](../development/FOUNDATION_PRACTICES.md): FP-003 and FP-036
