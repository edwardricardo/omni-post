# ADR-0036: Dependency update cadence — security immediate, a Tuesday window, a 30-day budget

- **Status**: Accepted
- **Date**: 2026-10-14
- **Deciders**: Edward (owner)
- **Supersedes**: —
- **Superseded by**: —
- **Amends**: [ADR-0018](ADR-0018-dependency-freshness-canon.md) (its "latest stable" is reached in
  a weekly window, not on the day a release matures, and its CI guard tolerates a young lag);
  the `testing-toolchain-alignment` requirement "every lag below latest mature carries a documented
  hold" (`openspec/changes/testing-refoundation/specs/testing-toolchain-alignment/spec.md`)
- **Related**: [ADR-0019](ADR-0019-pnpm-11-migration.md) (pnpm's `minimumReleaseAge`, which the
  follow-up unit adopts); tracker decisions D20, D25, D45 and D50 in
  [TESTING_REFOUNDATION.md](../development/TESTING_REFOUNDATION.md)

## Context

Measured in the week to 2026-10-14 ([TESTING_REFOUNDATION_MEASUREMENTS.md](../development/TESTING_REFOUNDATION_MEASUREMENTS.md) §Toolchain lag, the count's history, entries 21–33):

1. **The gate goes red on the day a release matures.** `scripts/testing/holds-gate.mjs` compares
   each package of the **toolchain population** — the 50 packages listed in
   `scripts/testing/toolchain-population.json`, the set the holds gate measures — with its latest
   release past the 7-day buffer, and exits 1 on any lag no row of `SECURITY_CANON.md`
   §"Build-tool version holds" names. The only ways to stay green were a bump on the day of the
   instant or a row written before it.
2. **That made every maturity instant a unit.** The owner counted nine in the week. Among those
   the log records: `knip` 6.39.0, `jscpd` 5.4.0 and `dependency-cruiser` 18.5.0 on 2026-10-07,
   `vite` 8.3.2 on 2026-10-08, `turbo` 2.11.7 on 2026-10-09, `jsdom` 30.1.2 on 2026-10-11,
   `isomorphic-dompurify` 4.5.0 and `knip` 6.40.0 on 2026-10-13, and `eslint-plugin-jsdoc` 65.2.0,
   the `@playwright/test` pair 1.64.0 and the `size-limit` pair 14.2.0 on 2026-10-14. Each took a
   bump or a row, a certification and a push. The owner's words: "un loop de nunca acabar".
3. **Twice `main` went red with nothing wrong.** `jsdom` 30.1.2 matured at 2026-10-11T09:15Z with no
   row, and the gate failed on `main` and on #549 until the bump; `isomorphic-dompurify` 4.5.0
   matured at 2026-10-13T09:29Z and the gate failed on `main` from 09:30Z until its bump. A red that
   means "a release matured an hour ago" stops meaning "something is wrong".
4. **The row written ahead of an instant could not expire.** Six rows were "pre-registered" holds
   whose text named the day the hold ended. Nothing parses a row's text: a row exempts its package
   for as long as it stands. `eslint-plugin-jsdoc` 65.2.0 matured at 2026-10-14T08:22Z and the gate
   read the lag as held by a row nobody read. The maturity watchlist added a second clock for the
   same moves: eight `hold-*` date entries due between 2026-10-07 and 2026-10-19.
5. **The owner's usage budget resets on Tuesdays.** Bumps compete with the route for that budget.

## Decision

The owner's four points (2026-10-14):

1. **Security floors are unchanged and immediate.** A real advisory, cross-derived from OSV,
   GitHub, the repository advisories and the changelog, raises a floor to the minimal patched
   version, measured, over the 7-day buffer when it must. It is the only dependency event that
   interrupts the route.
2. **Every other bump waits for one weekly window: every Tuesday, or the first day worked after
   it**, subject to the owner's budget. One digest lists what the window can take; bumps are grouped
   by family, and each unit is certified as before. Outside the window no non-security bump is
   taken.
3. **The staleness budget is 30 days.** The holds gate goes red only when the installed version has
   been below a mature release for 30 days with no row naming it. A younger lag is reported, never
   red.
4. **Scheduled rows and the watchlist's `hold-*` date entries are retired.** A row stays for a real
   hold only: a peer range that blocks the move, a measured breakage, or a recorded decision.

The design choices, stated so the owner can override any of them:

- **The budget counts from the maturity instant of the OLDEST unmet stable release**: a lag turns
  red 30 days after that release matured, that is 37 days after publication, because a release
  matures 7 days after it is published. The gate prints a lag inside it as
  `lag: within budget (<n> d of 30)` and does not look it up in the table.
- **The gate refuses a row whose cells say `scheduled` or `pre-registered`**, in any case, as whole
  words, naming the word as the row spells it
  (`holds-gate: row <package> says "<word>": the words … describe a retired scheduled hold …`).
  The six scheduled rows were deleted in the same change, because each lag was inside the budget.
- **The scope is the toolchain population** (Context item 1). Production direct dependencies move by
  CVE floors and by deliberate units; the gate measures none of them, and claims nothing about
  their freshness.
- **The watchlist keeps its package entries** for versions taken inside the buffer, with their 7-
  and 14-day reviews; its `date` kind stays for contract milestones (Node 26 on 2026-10-28).
- **A follow-up unit** adds the weekly digest (one issue per window: lags with their days in budget,
  reviews due, floors inside the buffer), moves the reminder workflow to a weekly Tuesday run,
  adopts pnpm's `minimumReleaseAge: 10080` with an exclude per floor taken inside the buffer
  (ADR-0019's revisit-if), and closes the stale reminder issues.

## Rationale

- **Oldest, not newest.** A clock started by the newest release would restart on every release,
  and a package that ships weekly would never reach the budget. The oldest unmet release is the one
  that has been waiting longest.
- **Thirty days is four windows.** A missed Tuesday still leaves three before a lag needs a row, so
  the budget absorbs a week off without turning `main` red, and a lag that does reach it has been
  skipped deliberately or forgotten, both of which deserve a written reason.
- **Refusing the words, not parsing the dates.** A row with an end date that nothing reads is the
  defect of Context item 4; teaching the gate to read dates would keep the concept alive. The budget
  replaces it, and the refusal keeps it from coming back under the same name.
- **Security stays outside the window** because a floor closes a known vulnerability, and waiting a
  week for it is the risk the floors exist to remove.

## Alternatives Considered

- **Daily watching, as before.** Rejected: Context items 2–4, nine units in a week and two false
  reds on `main`.
- **A monthly window.** Rejected: batches four times larger to review and certify at once, and a
  budget near 60 days before a lag needs a reason, which hides a forgotten package for two months.
- **An informational gate with no budget.** Rejected: nothing would ever go red, and ADR-0018's
  freshness would rest on someone reading a report.
- **Bot-driven pull requests (Renovate or Dependabot).** Three configurations exist: Dependabot's
  `npm` ecosystem (weekly, Monday until this change), `.github/workflows/dependency-updates.yml`
  (a daily 06:00 UTC run that analyses `pnpm audit` and `pnpm outdated` and opens a security pull
  request after `pnpm audit fix` when the audit finds an advisory) and `.github/renovate.json`
  (`minimumReleaseAge: 7 days`, no schedule). Each opens pull requests on its own clock, and each
  pull request still needs a certified unit. This ADR names one cadence: Dependabot's `npm` day
  moves to Tuesday here; the daily workflow and Renovate's schedule are the follow-up unit's to
  align, and stay as they are until then.

## Consequences

- A toolchain package may lag for up to 30 days after a release matures (37 after it is published,
  the 7-day buffer included) with no row; a lag past that needs a row with a measured reason, or
  the gate exits 1.
- Fewer certifications: bumps arrive once a week, by family. A red on the holds gate now means a
  lag past the budget, a refused row, or an input the gate could not read.
- Inside the budget, a real hold and a lag the next window takes read the same (`within budget`).
  The summary line counts the lags three ways — W, the lags within budget; H, the lags past the
  budget held by a real row; U, the lags past the budget that no row names, each one a red — and
  prints them as:
  `N population packages measured, M below latest mature (W within budget, H held, U undocumented)`.
- `SECURITY_CANON.md` §"Build-tool version holds" lost its six scheduled rows. One row,
  `@vitejs/plugin-react`, stands only because its lag was already past the budget when the budget
  landed (5.2.0 mature since 2026-03-19); it leaves with the move the first window takes.
- The watchlist lost its eight `hold-*` date entries; their evidence is in the pull requests that
  took or retired each move (#487 and #580 among them).
- Measured when this landed: the live gate exits 0 with 14 lags (4 within budget, 10 held, 0
  undocumented). With no window at all, the first red would be `eslint-plugin-jsdoc` at
  2026-11-13T08:22:22Z. The first window is Tuesday 2026-10-20.

## Legal impact

None: internal tooling. No personal data, cookie or storage key, OAuth scope, recipient,
retention period, acceptance record or controller role changes; the policy governs when
development dependencies move, and production dependencies keep their CVE floors.

## Support impact

`none for dependency-update-cadence — no support document under docs/support/ lists the paths this
decision touches (scripts/testing/, docs/security/SECURITY_CANON.md, .github/)`

## Deployment impact

`none — a CI step's tolerance changes (the holds step of fitness.yml accepts a lag younger than
the budget); no repository variable or secret, runtime variable, external account or
post-deployment check is added, changed or retired`

## Revisit if

- The population widens to production direct dependencies: the budget and the window are then
  re-decided for code that ships.
- The owner's budget day moves: the window moves with it.
- A lag reaches the budget twice in a row for the same package: the window is not keeping up, and
  the row needs a real reason or the package a deliberate unit.
- A row that schedules a move comes back in other words: the refusal is widened, never relaxed.
- The follow-up unit adopts `minimumReleaseAge`: its excludes are measured against this budget.

## Risks and Mitigations

| Risk                                                     | Mitigation                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A scheduled row returns                                  | The gate refuses `scheduled` and `pre-registered`; a row phrased without them is review's to read             |
| A regression in a new release goes unnoticed for 37 days | Security floors stay immediate; the weekly digest lists every lag with its days in budget                     |
| An untried major reaches the budget                      | A real row with a measured reason, as `vitest` 5 has: a recorded decision, and a remove-when that can fire    |
| A window is missed                                       | Thirty days is four windows; the gate goes red only after the fourth                                          |
| Production dependencies drift with no gate               | Stated as the scope's limit; CVE floors still cover them, and widening the population is a revisit-if trigger |

## References

- [ADR-0018](ADR-0018-dependency-freshness-canon.md) — the freshness canon this amends
- [ADR-0019](ADR-0019-pnpm-11-migration.md) — pnpm 11, and the `minimumReleaseAge` revisit
- Measurements: [TESTING_REFOUNDATION_MEASUREMENTS.md](../development/TESTING_REFOUNDATION_MEASUREMENTS.md) §Toolchain lag (the
  count's history, entries 21–33)
- Tracker: [TESTING_REFOUNDATION.md](../development/TESTING_REFOUNDATION.md) §Gates row "Testing toolchain holds", decisions D20, D25, D45 and D50
- Canon: [SECURITY_CANON.md](../security/SECURITY_CANON.md) §"Build-tool version holds & dated-debt
  overrides"
- Contract: `openspec/changes/testing-refoundation/specs/testing-toolchain-alignment/spec.md`,
  requirement "A lag older than the 30-day budget carries a documented hold"
- Code: `scripts/testing/holds-gate.mjs` and its suite
  `apps/api/tests/unit/scripts/holdsGate.test.ts`; `scripts/testing/maturity-watchlist.json`;
  `.github/workflows/fitness.yml` (step "Testing toolchain holds"); `.github/dependabot.yml`
- Owner decision: 2026-10-14, engram #1613
