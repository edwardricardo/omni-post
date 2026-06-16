# Tasks: dev-prod-resolution-model

> Fix for red CI on **PR #91** (`workstream/next-dev-resolution` → main). Implemented as
> additional **work-unit commits on that branch** — NOT a new PR, NOT stacked PRs.
> Each phase below = one reviewable commit. Config-dominant, additive, reversible.

## Review Workload Forecast

| Field                   | Value                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~600-750 (~84 package.json × ~5 added lines each = ~420 mechanical + codemod ~120 + wiring/CI/tsconfig ~60) |
| 400-line budget risk    | High                                                                                                        |
| Chained PRs recommended | No                                                                                                          |
| Suggested split         | Single PR (#91 continuation) — `size:exception`                                                             |
| Delivery strategy       | exception-ok                                                                                                |
| Chain strategy          | size-exception                                                                                              |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

**Why size:exception (not chained):** This is the FIX for PR #91's red CI, authored as more commits on the existing dev-unblock branch. The bulk is ~84 identical additive codemod edits to `package.json` `exports` — splitting them into separate PRs adds zero review value (one codemod, one diff shape, repeated). A coherent resolution-model fix on an already-large dev-unblock PR. Review the codemod logic once; the 84 diffs are mechanically uniform.

### Suggested Work Units

| Unit | Goal                                                                  | Likely PR     | Notes                                     |
| ---- | --------------------------------------------------------------------- | ------------- | ----------------------------------------- |
| 1    | Codemod script (`add-development-condition.mjs`)                      | PR #91 commit | Mechanical-author + review the logic once |
| 2    | Run codemod on ~84 exports-bearing packages                           | PR #91 commit | Mechanical; verify diff shape             |
| 3    | Wire `--conditions development` (seed, run-tests.sh, test:\* scripts) | PR #91 commit | Mechanical                                |
| 4    | B-NEXT: size-limit job builds `@shared/types` first                   | PR #91 commit | Mechanical                                |
| 5    | Cluster A: `apps/client/tsconfig.json` exclude                        | PR #91 commit | Mechanical                                |
| 6    | Verification (acceptance scenarios, LXC-safe)                         | PR #91 commit | Needs verification                        |
| 7    | Closure: ADR-0017 amendment + invariant guard                         | PR #91 commit | Needs verification                        |

## Phase 0: Pre-flight (verification) [VERIFY]

- [x] 0.1 Confirm Node 24 honors `--conditions`/`-C` as a CLI flag: `node -e "console.log(process.allowedNodeEnvironmentFlags.has('--conditions'))"` → must print `true`. Blocks all of B-CORE if false. — GATE PASSED: Node v24.15.0, `has('--conditions')`=`true`, `node --conditions development -e ...` + `node -C development -e ...` both accepted.

## Phase 1: Codemod authoring (B-CORE) [MECHANICAL]

- [x] 1.1 Create `scripts/migrations/add-development-condition.mjs` — idempotent codemod with header `// canon-exception: migration:20260616`. Discovery: enumerate workspace `package.json` carrying an `exports` object. (depends 0.1)
- [x] 1.2 Implement dist↔src rule: strip `dist/` → map ext (`dist/index.js`→`src/index.ts`, `*.d.ts`→`types`, `dist/*`→`src/*`); `infra/prisma` exception: strip `dist/src/` → `src/` (`dist/src/extensions/*`→`src/extensions/*`).
- [x] 1.3 Implement rewrite shape, key order `development` → `types` → `default`; string subpath `"./*":"./dist/*"` → `{ "development":"./src/*", "default":"./dist/*" }`. Mirror on root `.` AND every subpath.
- [x] 1.4 Implement skip-list: src-only exports-less pkgs (`@packages/api-errors`, `@shared/types` boundary, any other src-only frontend pkg) + skip entries already carrying `development` (idempotency). Final skip-list (12): @shared/types (B-NEXT boundary); 7 src-only-exports (@adapters/crm-hubspot, @adapters/crm-salesforce, @adapters/storage-cloudinary, @observability/browser-logger, @providers/\_template, @packages/query-client, @packages/ui); 4 no-exports (@adapters/storage-azure, @adapters/storage-do-spaces, @adapters/storage-gcs, @packages/api-errors).

## Phase 2: Apply codemod (B-CORE) [MECHANICAL]

- [x] 2.1 Ran the codemod on the 77 dist-exports packages (78 dist-exports minus @shared/types) + `infra/prisma/package.json`. Diff shape verified: `development` first, `default` last (0 ordering violations / 153 entries), every subpath covered, @shared/types untouched, all 77 files pass prettier, all `development` src targets resolve to real files. Committed.

## Phase 3: Wire `--conditions development` (B-CORE) [MECHANICAL]

- [x] 3.1 `infra/prisma/package.json` `scripts.seed`: now `tsx --conditions development seed.ts`.
- [x] 3.2 `apps/api/package.json` `test:auth` / `test:rbac` / `test:security` + ALL sibling `node --import tsx --test` and `security/tests` `node --import tsx` scripts: inserted `--conditions development` after `node` (0 missing). NOTE: `dev` + `dump:openapi` use `node --env-file ... --import tsx` (run against built/served app or schema dump) — outside the failing-CI scope; flagged as latent follow-ups in apply-progress, not changed here.
- [x] 3.3 `apps/api/scripts/run-tests.sh`: added `--conditions development` to the single `node --import tsx --test` invocation in `run_batch` (covers every integration batch).

## Phase 4: B-NEXT — build dist first [MECHANICAL]

- [~] 4.1 DEFERRED (sensitive path — `.github/workflows/` blocked by pre_edit tripwire; needs orchestrator's `omnipost-allow sensitive-edit` token). EXACT diff authored in apply-progress notes. Dockerfile already builds shared first (apps/{admin,client}/Dockerfile L73 `pnpm --filter @shared/types... build` precedes `next build` L78 — VERIFIED, no change). B-NEXT mechanism empirically PROVEN: clean tsbuildinfo + `tsc -b tsconfig.build.json` regenerates `packages/shared/dist/i18n/createRequestConfig.js` (1590 bytes, exports `createRequestConfig`). turbo build.dependsOn=["^build"] confirmed → `turbo run build --filter=@apps/admin --filter=@apps/client` expands `@shared/types#build` first.

## Phase 5: Cluster A — config out of tsc graph [MECHANICAL]

- [x] 5.1 `apps/client/tsconfig.json`: added `"vitest.config.ts"` to `exclude` (matches `apps/admin` which already had it — the asymmetry was the Cluster-A cause). VERIFIED: `tsc -p tsconfig.json --noEmit --listFilesOnly` shows 0 vitest config/shared files in graph; full `tsc --noEmit` = 0 errors total (was failing TS2307 `Cannot find module 'vitest/config'` from `../../vitest.shared.ts`). Package build tsconfigs already scope `include: ["src/**/*"]` (api-errors confirmed in RCA) — no package change needed.

## Phase 6: Verification — acceptance scenarios (LXC-safe, dist-absent) [VERIFY]

- [x] 6.1 PROVEN. logger dist moved aside; `node --conditions development --import tsx seed.ts` (from infra/prisma) resolved `@observability/logger` from src and ran to `"Seed OK"` (DB was reachable — exceeded the P1001-DB-down bar); `rg -ic MODULE_NOT_FOUND` = 0. RED (no flag) = ERR_MODULE_NOT_FOUND. [module-resolution §seed]
- [x] 6.2 PROVEN. infra/prisma dist moved aside; with `--conditions development`, `@infra/prisma/extensions/tenantGuard.js` resolved from src (exports TenantContextMismatchError/MissingError/getTenantScopedModels/tenantGuardCheck/tenantGuardExtension). Full security node:test: `tests 18 / pass 0 / fail 0 / cancelled 0 / skipped 18` (18 skipped = no live API server — HTTP-dependent, not resolution); `rg -ic MODULE_NOT_FOUND` = 0. RED (no flag) = ERR_MODULE_NOT_FOUND. [§security node:test]
- [x] 6.3 PROVEN. dist restored; `import.meta.resolve('@infra/prisma/extensions/tenantGuard.js')` from apps/api: NO flag → DIST (`development` inert); WITH flag → SRC (development wins, ordered first). [§production unchanged]
- [x] 6.4 PROVEN. shared dist moved aside; cleaned stale `tsconfig.build.tsbuildinfo` (the `tsc -b` incremental no-op gotcha); `tsc -b tsconfig.build.json` regenerated `packages/shared/dist/i18n/createRequestConfig.js` (1590 bytes, `export function createRequestConfig`). Dockerfiles already build shared first. [build-pipeline §size-limit] NOTE: turbo `--force` alone did NOT emit because of the stale tsbuildinfo; CI's clean checkout has none so `turbo run build` is safe.
- [x] 6.5 PROVEN. `tsc -p tsconfig.json --noEmit --listFilesOnly` for apps/client shows 0 vitest config/shared files; full `tsc --noEmit` = 0 errors total (was TS2307 `vitest/config`). [§Cluster A]
- [x] 6.6 PROVEN. Vitest alias→src untouched & green: `vitest run tests/unit/providerService.test.ts` = `Test Files 1 passed / Tests 31 passed`, 0 resolution errors. Fitness #26 = 0. [build-pipeline §no-regress]

## Phase 7: Closure follow-ups (in-scope here) [VERIFY]

- [x] 7.1 Amended `docs/technical/ADR-0017-production-build-bundler.md`: status/date bumped (resolution-model revision 2026-06-16); §1 + §3b FALSE "dev resolves via paths" claims revised to point at the new §1c; added §1c "The dev/test/CI resolution model — a TWO-MECHANISM contract" (B-CORE conditional exports + `--conditions development`; B-NEXT build-dist-first for Turbopack; Cluster A config-out-of-tsc-graph; what-must-not-regress); added a "Revisit if" vitest-collapse follow-up; added 6 References (Node packages/cli, TS customConditions, tsx#574, next#78912, GH Actions NODE_OPTIONS). References this change.
- [~] 7.2 DEFERRED to orchestrator (edits `.github/workflows` — sensitive). Regex + intent AUTHORED in apply-progress notes below for wiring.
- [x] 7.3 Recorded OUT-OF-SCOPE: `@packages/api-common` ioredis-mock `No "Redis" export` is a separate vitest issue, tracked independently — NOT conflated here (noted in apply-progress).
