# Proposal: Tenant-Context Runtime Coverage Harness

## Why

ADR-0020 (`docs/technical/ADR-0020-tenant-context-at-boundaries.md` §Consequences) mandates that context completeness be enforced by a **runtime boundary-coverage test**, because static presence-checks only prove a seam function is _mentioned_, not that every reachable enrolled-model surface is covered. The reachability audit (engram `tenant-guard/reachability-blast-radius`) found ~40 context-less surfaces — several throwing `TenantContextMissingError` on live paths today (integration auth, SSO, billing/provider webhooks, admin surfaces, background consumers, silently-dead scheduler ticks).

## What Changes

Build the harness FIRST, before any seam fix:

1. A node:test integration suite that boots the real app (`createApp()`), enumerates every entry point per boundary class, drives each with the credentials of its auth-binder tier, and **empirically observes** which surfaces raise `TENANT_CONTEXT_MISSING` — via a `diagnostics_channel` publish added to the guard (observes even swallowed throws).
2. A machine-readable blast-radius report + a committed per-surface allowlist that acts as a two-way ratchet (new throw = fail; stale entry = fail). Remediation slices shrink the allowlist to empty, at which point the harness IS the permanent regression net.
3. Registry reconciliation + static leaf census as the completeness oracle for classes the runtime cannot enumerate.

**This slice observes only. It fixes no seam, swaps no client, adds no context binding.**

## Non-Goals

- No `withTenantContext`/`withSystemContext` seams (later slices, per boundary class).
- No saga guarded-client swap, no workers-deployable guard (raw-bypass surfaces are excluded/flagged, not probed — probing them today is a false green).
- No CI fitness wire for the future context-seam grep (baseline documented; wire flips when the seam exists, per the fitness-extension protocol).

## Rollback Plan

Delete `apps/api/tests/integration/tenantContextCoverage/` and revert the three behavior-neutral observation seams (guard diagnostics publish, `createApp` observer param, scheduler read accessors). Zero production behavior depends on any of them — each is a no-op when unobserved.

## Fitness Function Interactions

- Touches none of #1–#27 (all harness code lives under `tests/`, which every check excludes; `process.env` reads in tests are exempt from #16).
- Production touches are additive no-ops: `tenantGuard.ts` (publish before throw), `index.ts` `createApp(options?)`, `default-scheduler.ts` accessors — none match any fitness regex.
- Scaffolds (does not wire) the future "boot callbacks wrapped in context seam" grep.

## Delivery

Single PR (test infra + fitness scaffolding, no production behavior change), stacked on `workstream/cluster-c-tenant-context-boundaries`.

Review Workload Forecast:

- Estimated authored lines: ~700–900 (dominated by test infra; generated report/allowlist snapshots excluded from authored count).
- Decision needed before apply: Yes
- Chained PRs recommended: No (the harness is one cohesive, non-splittable unit; a partial harness asserts nothing)
- 400-line budget risk: High — `size:exception` recommended for this single PR.
