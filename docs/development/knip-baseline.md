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
