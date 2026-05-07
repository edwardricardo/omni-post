# Turborepo Future Flags — Evaluation (PR-56)

## Context

OmniPost runs Turborepo `2.8.21` with a single root [turbo.json](../../turbo.json)
(no per-package overrides). The remediation backlog flagged 4 candidate
features for evaluation: `globalConfiguration`, `filterUsingTasks`,
`watchUsingTaskInputs`, and OTEL observability.

This doc evaluates each, maps it to the actual Turbo 2.x feature set,
and gives a recommendation: **adopt now**, **adopt later**, or
**not for us**.

Date: 2026-05-06. Re-evaluate when Turbo crosses the next minor or when
build/CI pain shifts.

## Current state

```text
turbo: 2.8.21
turbo.json: 1 file (root only — no per-package configs)
tasks: build, typecheck, lint, test, test:coverage, test:e2e, dev,
       mutation (8 task types pipelined)
features in use: globalEnv, globalDependencies, dependsOn, env, outputs,
                 cache, persistent
features available but NOT configured: extends (per-package), boundaries,
                                       tags, experimentalUI, --affected,
                                       turbo watch, OTEL metrics
```

## Flag-by-flag evaluation

### 1. `globalConfiguration` → Per-package `turbo.json` with `extends`

**What Turbo actually offers.** Each workspace package can define its own
`turbo.json` next to `package.json`, declaring overrides via:

```json
{
  "extends": ["//"],
  "tasks": {
    "build": { "outputs": ["dist/**", "schema.json"] }
  }
}
```

`extends: ["//"]` inherits from root. Stable since Turbo 2.0.

**OmniPost relevance.** All apps + packages currently share root config.
Per-package overrides would only pay off if:

- A specific app/package has materially different `outputs` / `inputs`
  patterns (none flagged today).
- A package has a long-lived task that doesn't fit the root pipeline
  (e.g. integration test seeds for `apps/api` that other apps don't run).

**Recommendation: ADOPT LATER (when needed).** No current pain point.
When `apps/api/tests/integration/**` outgrows the root pipeline (e.g.
needs different `cache` or `env` than other packages), introduce
`apps/api/turbo.json` then, not preemptively.

---

### 2. `filterUsingTasks` → `--affected` flag

**What Turbo actually offers.** The `--affected` flag (stable in 2.x)
filters task execution to packages whose source has changed between the
current branch and `main`. Equivalent to:

```bash
turbo run typecheck --affected
turbo run test --affected
```

It computes the change set via `git` + the dependency graph, so a change
to `packages/shared/src/types.ts` cascades to every package that
imports `@shared/types`.

**OmniPost relevance.** CI runs all 33 packages every push today.
Branch-only diffs (`refactor/remediation-v2.1`) often touch ~5-10
packages — running 33 is wasted CI time + cache misses.

Concrete numbers from this branch:

```text
typecheck full: 33 packages, ~1m11s cold, ~400ms cached (`>>> FULL TURBO`)
```

`--affected` would short-circuit the cold case dramatically when only a
few packages change — typical PR is 2-5 affected packages, dropping
cold typecheck to ~10-15s.

**Recommendation: ADOPT NOW for CI.** Wire `--affected` into
`.github/workflows/ci.yml` as the default, with a fallback for
`main`-targeted runs (where the merge commit's diff against itself is
empty — use a full run or compare to previous main commit).

Local dev keeps the existing `pnpm typecheck` / `pnpm test` (full +
cached). CI is where the speedup pays off.

**Migration sketch:**

- `pnpm typecheck` script unchanged (developer convenience).
- New script `typecheck:ci` → `turbo run typecheck --affected`.
- CI job replaces `pnpm typecheck` with `pnpm typecheck:ci`.
- Same pattern for `lint:ci`, `test:ci`.

---

### 3. `watchUsingTaskInputs` → `turbo watch`

**What Turbo actually offers.** `turbo watch <task>` (stable in 2.0+)
re-runs a task when any of its declared `inputs` change, respecting the
dependency graph. File-level watch with proper invalidation.

```bash
turbo watch dev          # already available
turbo watch test         # rerun affected tests on save
turbo watch typecheck    # incremental typecheck on save
```

**OmniPost relevance.** Today `pnpm dev` runs Fastify + workers via
`concurrently` (per `package.json`). It's working. But:

- **Test feedback loops**: `pnpm test --watch` works at vitest level but
  doesn't cascade through workspace dep graph. If you change
  `packages/shared/src/types.ts`, vitest in `apps/api` doesn't know
  to re-run unless you re-import. `turbo watch test` would.
- **Typecheck while editing**: developers use IDE tsserver which is
  fine for single-file feedback. `turbo watch typecheck` is overkill
  for daily editing but useful for `apps/api` ↔ `packages/shared`
  cross-cutting refactors.

**Recommendation: ADOPT LATER (opt-in dev).** Add to docs as a
documented option (`turbo watch test --filter=@apps/api`) but don't
replace existing scripts. Most devs will stick with vitest's native
watch + IDE. Cross-cutting refactor sessions benefit.

---

### 4. OTEL observability — `--experimental-otel-metrics-run-summary`

**What Turbo actually offers.** Turbo 2.8 has an experimental flag:

```bash
turbo run build --experimental-otel-metrics-run-summary
```

It emits run-level summary metrics to a configured OTEL endpoint. Not
yet stable — the flag itself carries `experimental` in the name.

There's also `--summary` (stable) which writes a JSON summary of the
run to `.turbo/runs/<id>.json`. Useful for forensics post-run, no OTEL
required.

**OmniPost relevance.** OmniPost has OTEL infrastructure (Jaeger
configured per `docker-compose.yml`, observability pkg via OpenTelemetry).
Turbo run metrics correlated with API request traces would be high
value (e.g. "this CI run spent 3m on the build step that produced no
artifact change" → cache miss diagnosis).

But the experimental flag may shape-change between minor versions. Risk
of churn if we wire it into CI now.

**Recommendation: ADOPT LATER (when stable).** Enable `--summary` (stable)
in CI today for visibility into run breakdowns. Wait on the experimental
OTEL flag until Turbo declares it stable (track Turbo release notes).

**Today action**: add `turbo run build --summary` to CI; archive
`.turbo/runs/*.json` as a CI artifact for failure forensics. Zero risk,
immediate visibility.

---

## Summary table

| Feature                                   | Status in 2.8.21 | Recommendation           | Pain it solves                                 |
| ----------------------------------------- | ---------------- | ------------------------ | ---------------------------------------------- |
| Per-package `turbo.json` (extends)        | Stable           | **Adopt later**          | None today; preempt when configs diverge       |
| `--affected` flag                         | Stable           | **Adopt now (CI)**       | CI runs all 33 packages on every PR push       |
| `turbo watch <task>`                      | Stable           | **Adopt later (opt-in)** | Cross-package watch during refactor sessions   |
| `--summary` (run summary JSON)            | Stable           | **Adopt now (CI)**       | Post-run forensics: which task took how long   |
| `--experimental-otel-metrics-run-summary` | Experimental     | **Adopt later**          | Correlate Turbo runs with platform OTEL traces |

## Follow-up tickets

- **PR-56-A** (~30 min): wire `--affected` into `.github/workflows/ci.yml`
  for `typecheck`, `lint`, `test` jobs. Add `--summary` flag. Archive
  `.turbo/runs/` as CI artifact.
- **PR-56-B** (~15 min): document `turbo watch <task>` in
  [docs/development/](../development/) as a developer convenience.
- **PR-56-C** (track only): revisit `--experimental-otel-metrics-run-summary`
  when Turbo releases it as stable. Subscribe to release notes.

No code changes commited as part of PR-56 — this doc is the deliverable.
