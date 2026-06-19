# Tasks: knip-at-alias-resolution

> Fix for the `Code Quality (knip + jscpd + madge)` gate on **PR #91**
> (`workstream/next-dev-resolution` → main). Implemented as a **work-unit commit on that branch**
> — NOT a new PR, NOT stacked PRs. Tiny, config-only, single-line rollback. The `knip.json` apply is
> already DONE + verified; the remaining work is the backlog documentation entry.

## Review Workload Forecast

| Field                   | Value                                                                    |
| ----------------------- | ------------------------------------------------------------------------ |
| Estimated changed lines | ~6 (`knip.json`: +2 `paths` keys ≈ 2 lines; backlog `.md`: +1 table row) |
| 400-line budget risk    | None (well under budget)                                                 |
| Chained PRs recommended | No                                                                       |
| Suggested split         | Single commit on PR #91                                                  |
| Delivery strategy       | single commit (no exception needed)                                      |
| Chain strategy          | n/a                                                                      |

Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: None

**Why a single tiny commit:** the change is two `knip.json` `paths` keys (already applied + verified)
plus one backlog table row documenting the forgotten-features. There is nothing to split. Well within
the 400-line review budget.

### Suggested Work Units

| Unit | Goal                                                         | Likely PR     | Notes                                   |
| ---- | ------------------------------------------------------------ | ------------- | --------------------------------------- |
| 1    | `knip.json` `@/*` → `./*` mapping (apps/client + apps/admin) | PR #91 commit | **DONE** — applied + verified           |
| 2    | Backlog `SMELL-51` FORGOTTEN-FEATURE entry                   | PR #91 commit | Documentation; do NOT delete anything   |
| 3    | Verify the gate + no-regression                              | PR #91 commit | `pnpm check:dead-code` → RATCHET_EXIT=0 |

## Phase 0: Pre-flight (verification) [VERIFY]

- [x] 0.1 Confirm the root cause is `oxc-resolver` 11.20.0's ownership scoping (PR #1161), not a
      regression — verified against the official CHANGELOG. A live knip run with
      `oxc-resolver.resolveFileSync` monkeypatched captured the resolution path proving (a) disowned
      `*.test.tsx` get no aliases, (b) the per-dir cache propagates the ERR to non-test siblings.
- [x] 0.2 Confirm `baseUrl: "."` does NOT fix it (the failure is ownership via `exclude`, not the
      anchor) — tried, no effect. Recorded as a rejected alternative.

## Phase 1: Apply the knip-layer fix (Option 1) [MECHANICAL]

- [x] 1.1 **DONE + VERIFIED.** Added `paths: { "@/*": ["./*"] }` to `workspaces["apps/client"]` and
      `workspaces["apps/admin"]` in `knip.json`, mirroring each leaf tsconfig's `@/*` alias. Feeds knip's
      `ProjectPrincipal.addPaths` → `createCustomModuleResolver` `pathMappings` fallback (applied after
      `oxc-resolver` returns nothing, before the per-dir cache mislabels siblings).

## Phase 2: Backlog — record the forgotten-features (do NOT delete) [MECHANICAL]

- [x] 2.1 **DONE.** Added `SMELL-51` to `docs/reports/roadmap-detected-smells-backlog.md` (after the
      `SMELL-48` row): "FORGOTTEN-FEATURE: admin audit-logs + content-library pages pending product
      decision". Captures: `useAuditLogs` backend fully implemented (`apps/api/src/audit/auditRoutes.ts`
  - Prisma `model AuditLog` + `auditLogRetentionDays`); `useContentLibrary` calls real
    `/api/backend/posts`; both have hook + tests; only the admin page is missing; both from Genesis
    commit `5603de6b`. Verdict `PENDING`, close phase = product decision (wire pages OR keep tracked).
    **Nothing deleted.**

## Phase 3: Verification — gate green + no regression [VERIFY]

- [x] 3.1 **PROVEN.** `pnpm check:dead-code` → `RATCHET_EXIT=0`; all 12 false positives cleared
      (5 unresolved imports, 3 unused exports, 2 unused files, 2 unused types). [code-quality §cascade]
- [x] 3.2 **PROVEN.** The genuinely-unused `InviteTeamMemberInput` type is STILL flagged after the
      fix — the ratchet keeps biting real dead code (not a suppression). [code-quality §not-a-suppression]
- [x] 3.3 **PROVEN.** Zero build-break surface: Next 16/Turbopack and `tsc` never read `knip.json`;
      `@/*` → `./*` mirrors the leaf tsconfig; no `.js`-on-`.ts` imports added → fitness #26 = 0.
      [code-quality §zero-build-break]
- [x] 3.4 **CONFIRMED.** The two forgotten-feature hooks (and their tests, types, backend) remain
      present on disk after the change — no deletions; only `SMELL-51` documentation added.
      [code-quality §forgotten-features]

## Notes

- **Out of scope (do NOT do here):** delete `useAuditLogs.ts`/`useContentLibrary.ts`; pin
  `oxc-resolver` to 11.19.1; un-exclude test files from the leaf tsconfig; add a root `tsconfig.json`;
  wire the actual admin pages. See `design.md` for the per-alternative rejection rationale.
- **Rollback:** remove the two `paths` keys from `knip.json` (single mechanical revert). The backlog
  entry may stay (documents a real product decision; no CI/runtime coupling).
- **CI interaction:** the only gate touched is `Code Quality (knip + jscpd + madge)` (required check
  on `main`, `enforce_admins: true`); `jscpd`/`madge` and the 26 fitness functions are untouched.
