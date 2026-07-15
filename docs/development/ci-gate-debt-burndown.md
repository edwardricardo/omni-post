# CI-gate stopgap debt — burn-down ledger

Three CI gates were made green on `green-main-ci` (2026-05-18) using
**tracked stopgaps, not suppressions**. Each prevents regressions today and
**must be burned down** as the codebase is restored. This file is the single
tracked owner of that obligation — it must trend toward empty.

> Distinction: the _security vulnerabilities themselves are genuinely fixed_
> (patched upstream code runs — verified by `pnpm audit` → 0 fixable left).
> What is a stopgap is the _mechanism_ (forced `overrides`) and the
> _acceptance ledgers_ for legacy analyzer debt (knip baseline, jscpd
> threshold). None of these hide a problem; each fails CI on any regression.

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

## 2. jscpd threshold ratchet

- **Stopgap**: threshold ratcheted 5 → 4.84 (current real value); cannot grow.
  `*.config.ts` excluded (legitimate: config boilerplate, like the existing
  tests/stories/generated excludes — not logic duplication).
- **Why not fixed now**: rushed dedup of production use cases at session-end
  = regression risk (a different time bomb).
- **Exit criteria**: genuinely deduplicate the real clones (top: Approve/
  Reject & Create/Update PostUseCase, admin/client `notificationStore`,
  inbox use cases) with tests; ratchet the threshold further down each time.
  Target trajectory: 4.84 → … → a healthy baseline (e.g. ≤2%).

## 3. Security `pnpm.overrides`

- **Stopgap**: 53 `overrides` force upstream-patched transitive versions
  (124 advisories genuinely resolved). `auditConfig.ignoreGhsas` — in
  `pnpm-workspace.yaml` as of ADR-0019 (pnpm 11 stopped reading the
  `package.json` `pnpm` field) — holds only the 3 advisories with no upstream
  fix (documented in `docs/security/dependency-audit-policy.md`).
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
