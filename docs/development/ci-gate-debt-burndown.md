# CI-gate stopgap debt — burn-down ledger

Three CI gates were made green on `green-main-ci` (2026-05-18) using
**tracked stopgaps, not suppressions**. Each prevents regressions today and
**must be burned down** as the codebase is restored. This file is the single
tracked owner of that obligation — it must trend toward empty.

> Distinction: the _security vulnerabilities themselves are genuinely fixed_
> (patched upstream code runs — verified by `pnpm audit` → 0 fixable left).
> What is a stopgap is the _mechanism_ (forced `overrides`) and the
> _acceptance ledgers_ for legacy analyzer debt (knip baseline, jscpd
> baseline). None of these hide a problem; each fails CI on any regression.

## 1. knip baseline ratchet

- **Stopgap**: `knip-baseline.json` accepts 538 pre-existing knip findings;
  `scripts/knip-ratchet.mjs` fails CI on any _new_ finding.
- **Why not fixed now**: ~most are false positives from knip's blindness to
  DI/dynamic/Next; verifying + removing the genuine subset is multi-session.
- **Exit criteria**: per-workspace `entry` corrected in `knip.json` so
  DI/Next/worker reachability is traced (collapses false positives), then
  genuinely-dead exports/types deleted. `knip-baseline.json` count → 0, then
  `check:dead-code` reverts to bare `knip`.
- **Owner signal**: the baseline `count` field. Each restoration PR must
  lower it; CI prints resolved entries to nudge.

## 2. jscpd baseline ratchet

- **Stopgap**: `.jscpd-baseline.json` accepts the clones found when it was last
  written: 1,012 fingerprint instances over 1,004 distinct fingerprints
  (jscpd 5.3.2, 2026-10-03). `.jscpd.json` sets `failOnNewClones: 0`, so
  `pnpm check:duplicates` fails CI on any clone the baseline does not hold
  (the console marks it `[NEW]`); a missing baseline file fails it too, and
  `failOnEmpty: true` fails a scan that reads no file. `*.config.ts` excluded
  (legitimate: config boilerplate, like the existing tests/stories/generated
  excludes — not logic duplication); generated code also covers
  `**/api-generated/**` and `**/*.generated.ts`, which jscpd 4 skipped only
  because they passed its 1,000-line cap.
- **What a fingerprint is**: a hash of the raw text of a clone's two
  fragments. It survives line shifts and file renames, but any edit inside a
  duplicated fragment, whitespace included, makes that clone new (measured:
  one trailing space inside a baselined fragment → exit 1). Touching
  duplicated code therefore means removing the duplication, or rewriting the
  baseline in the same PR for a reviewer to see.
- **The number it replaced covered less**: the 4.84% threshold never scanned a
  `.tsx` file. `.jscpd.json` named the format `typescriptreact`, which jscpd
  does not have: jscpd 4 skipped it in silence, jscpd 5 refuses it. The format
  is `tsx` now, and the first baseline holds the 70 clones of the 369 `.tsx`
  files it scanned.
- **Why not fixed now**: rushed dedup of production use cases at session-end
  = regression risk (a different time bomb).
- **Exit criteria**: genuinely deduplicate the real clones (top: Approve/
  Reject & Create/Update PostUseCase, admin/client `notificationStore`,
  inbox use cases) with tests. The PR that removes a clone runs
  `pnpm check:duplicates:update-baseline` and commits the rewritten baseline;
  the baseline count → 0.
- **Owner signal**: the baseline's fingerprint total, the `(N total)` that
  `pnpm check:duplicates:update-baseline` prints (the sum of the counts in
  `.jscpd-baseline.json`). Each restoration PR must lower it.
- **Stale entries — not detected by jscpd**: jscpd never reports or fails on
  a stale entry, a fingerprint no current clone matches. A removed clone keeps
  its entry until the baseline is rewritten, and while it stays, an identical
  clone added back passes unflagged (measured 2026-10-03: both runs exit 0).
  Edward decided on 2026-10-03 that CI fails them; the gate that does it is
  the next slice of this stack.

## 3. Security `pnpm.overrides`

- **Stopgap**: 52 `overrides` (counted 2026-10-03) force upstream-patched transitive versions
  (124 advisories genuinely resolved). `auditConfig.ignoreGhsas` — in
  `pnpm-workspace.yaml` as of ADR-0019 (pnpm 11 stopped reading the
  `package.json` `pnpm` field) — holds only advisories with no upstream fix,
  the rule of `docs/security/dependency-audit-policy.md`. The entries, each
  with its chain, reason and remove-when, live in
  `docs/security/SECURITY_CANON.md` §"Ignored GHSAs"; this page keeps no count
  of them, because a copied count drifts.
- **Why a stopgap**: the clean end-state is the _direct_ dependencies
  upgrading (the open Dependabot PRs) so transitive patches arrive naturally;
  a forced override is a hand-maintained pin that can rot or conflict
  (e.g. `brace-expansion@5` broke eslint → pinned to `2.0.3`).
- **Exit criteria**: as Dependabot direct-dep upgrades merge, drop the now-
  redundant overrides; re-run `pnpm audit` to confirm still 0. Review every
  Dependabot cycle. `overrides` added for security → trend toward only the
  team's original pins.

## Rule

Never grow any of these to silence a new problem. New finding ⇒ fix it (or
correct config for a _proven_ false positive) — never expand the ledger.
