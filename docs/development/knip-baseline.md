# Knip dead-code gate — baseline ratchet

## What this is

`pnpm check:dead-code` runs `scripts/knip-ratchet.mjs`, not bare `knip`.

The ratchet:

1. Runs `knip --reporter json`.
2. Compares every finding against the committed ledger `knip-baseline.json`.
3. **Fails CI on any finding NOT in the baseline** — i.e. newly introduced
   dead code, unused dependency, unlisted import, etc.
4. Reports baseline entries that are now resolved, so the ledger is shrunk
   over time (`node scripts/knip-ratchet.mjs --write` after genuine removals).

## Why a baseline, not bare `knip` or `rules: warn`

`knip`'s static analysis is structurally blind to this codebase's patterns:
DI-container token resolution, dynamic imports, Next.js App Router, and
config-file-driven tooling deps (vitest/secretlint). Verified examples of
**false positives**: `apps/api/src/auth/bruteForceProtection.ts` (used by
`AdminAuthService`), the workers composed by `bootstrap.ts`. A bare `knip`
gate is therefore chronically red on ~500 findings that are largely not
real dead code.

Two wrong fixes were explicitly rejected:

- **Mass-delete ~500 symbols** — reckless: a large fraction are false
  positives; deleting them breaks DI/dynamic-wired production code.
- **`rules: warn`** — a time bomb: warnings fail nothing, so new dead code
  would also pass. It does not _prevent_ anything, which defeats the gate.

The ratchet is the standard pattern for adopting a strict analyzer on a
large legacy codebase. It is **not suppression**: the gate still prevents
all regressions, and the accepted debt is an explicit, committed,
reviewable ledger (`knip-baseline.json`) — the opposite of hidden.

## Rules for contributors

- **Never** regenerate the baseline to absorb a new finding. If CI reports a
  new finding: fix the dead code, or — if it is a proven false positive —
  correct `knip.json` config (add the real entry point) so knip traces it.
- **Do** regenerate (shrink) the baseline after genuinely removing dead code
  or fixing config: `node scripts/knip-ratchet.mjs --write`, commit the
  smaller `knip-baseline.json`.
- The baseline count is a debt metric. It must trend down, never up.

## Burn-down

`knip-baseline.json` currently tracks the pre-existing findings (mostly
unused exported types/exports in `apps/api` DI-wired layers and `apps/client`
barrels). Reduce it incrementally by: correcting per-workspace `entry` in
`knip.json` for DI/Next/worker reachability (removes false positives), and
deleting genuinely-unused exports/types (removing an unused `type`/`interface`
export is runtime-safe). Each reduction is a follow-up PR that shrinks the
ledger.

## The jscpd duplicate baseline

Carried over on 2026-10-17 from the CI-gate burn-down ledger, [`docs/development/ci-gate-debt-burndown.md`](https://github.com/edwardricardo/omni-post/blob/2d809195912280f2d11fe17acbf977b2ccf40bd8/docs/development/ci-gate-debt-burndown.md), which was removed from the repository that day (git history keeps it; the link is its last version); its knip and override sections were stale.

`pnpm check:duplicates` runs `scripts/testing/jscpd-baseline-gate.mjs`, which runs jscpd (5.4.1, a root devDependency) over `apps/` and `packages/` with `.jscpd.json`: TypeScript and TSX files, clones of at least 10 lines and 50 tokens, with tests, stories, `*.config.ts` and generated code (`**/generated/**`, `**/api-generated/**`, `**/*.generated.ts`) left out. `.jscpd-baseline.json` holds the accepted clones as fingerprints: 992 of them, with counts summing to 1,000, on 2026-10-17. With `failOnNewClones: 0` jscpd fails on any clone the baseline does not hold, and its console marks it `[NEW]`; a missing baseline fails too, and `failOnEmpty: true` fails a scan that reads no file.

- **What a fingerprint is.** A hash of the raw text of a clone's two fragments. It survives line shifts and file renames, but any edit inside a duplicated fragment, whitespace included, makes the clone new. Touching duplicated code therefore means removing the duplication, or rewriting the baseline in the same pull request for a reviewer to see.
- **Stale entries fail.** jscpd never reports a fingerprint whose committed count is above what the tree produces now, and while such an entry stays, an identical clone added back passes. So the gate runs jscpd a second time with `--update-baseline` into a scratch file, prints each stale entry by its hash with its committed and current counts, and exits 1 (Edward's decision of 2026-10-03). A current count above the committed one means the two runs disagree, and the gate fails closed.
- **The remedy** for both is `pnpm check:duplicates:update-baseline`, then committing the rewritten `.jscpd-baseline.json`. The sum of its counts is the debt metric: a pull request that removes a clone lowers it, and it never rises to absorb a new clone.
