# Apply Progress — dev-prod-resolution-model

> SDD apply executor output. Change on PR #91, branch `workstream/next-dev-resolution`.
> First (and only) apply batch — no previous apply-progress. Strict TDD mode active
> (config-dominant change; "tests" = the resolution acceptance scenarios, each run
> RED→GREEN with dist deliberately absent).

## Status: done (in-scope phases 0-6 + 7a/7c). Two follow-ups deferred to orchestrator (sensitive `.github/workflows` path).

## Commits made (work-unit commits on the branch, NOT pushed)

| SHA        | Phase | Subject                                                                      |
| ---------- | ----- | ---------------------------------------------------------------------------- |
| `a551e3ba` | 1-2   | build(exports): add development->src condition to 77 transpile-only packages |
| `6428d0ab` | 3     | build(test): pass --conditions development to source-mode node/tsx runners   |
| `256a17ea` | 5     | build(client): exclude vitest.config.ts from tsconfig (Cluster A)            |
| `f5f91987` | 7a    | docs(adr-0017): codify two-mechanism dev/test/CI resolution model (§1c)      |

Branch base for this work: `d6a3be90`. Diffstat vs base: 82 files, +756/-118.

## Phase-by-phase

- **0 GATE — PASS.** Node v24.15.0; `process.allowedNodeEnvironmentFlags.has('--conditions')` = `true`; `node --conditions development -e ...` and `node -C development -e ...` both accepted. B-CORE valid.
- **1-2 Codemod — DONE.** `scripts/migrations/add-development-condition.mjs` (idempotent, header `// canon-exception: migration:20260616`, `@file`/`@layer infrastructure`). Discovery enumerates workspace `package.json` with `exports`. dist→src rule: `dist/`→`src/`, `.js`→`.ts`; infra/prisma exception `dist/src/`→`src/`. Rewrite shape: `development`→`types`→`default` (default LAST); string subpath `"./*":"./dist/*"`→`{development:"./src/*",default:"./dist/*"}`; mirrored on root + every subpath. Idempotency: skips entries already carrying `development`. Ran on `packages`+`infra`: **77 packages rewritten** (78 dist-exports minus @shared/types), 12 skipped. Diff verified: 153 development entries, 0 ordering/target violations, @shared/types untouched, all 77 pass prettier, all dev src targets resolve to real files.
  - **Final skip-list (12):** @shared/types (B-NEXT boundary); 7 src-only-exports (@adapters/crm-hubspot, @adapters/crm-salesforce, @adapters/storage-cloudinary, @observability/browser-logger, @providers/\_template, @packages/query-client, @packages/ui); 4 no-exports (@adapters/storage-azure, @adapters/storage-do-spaces, @adapters/storage-gcs, @packages/api-errors). Apps + root also have no exports → skipped.
- **3 Wire `--conditions development` — DONE.** infra/prisma `seed`→`tsx --conditions development seed.ts`; apps/api ALL `node --import tsx --test` + `security/tests` `node --import tsx` scripts now `node --conditions development --import tsx` (0 missing); `apps/api/scripts/run-tests.sh` `run_batch` invocation now `node --conditions development --import tsx --test ...` (covers every integration batch).
- **4 B-NEXT — DEFERRED-WITH-DIFF (sensitive path).** See "Deferred work" below. Mechanism PROVEN; Dockerfiles already build shared first (no change).
- **5 Cluster A — DONE.** `apps/client/tsconfig.json` `exclude` += `"vitest.config.ts"` (matches apps/admin). VERIFIED: 0 vitest config/shared files in typecheck graph; `tsc --noEmit` = 0 errors.
- **6 Verification — ALL GATES PASS** (see "Acceptance evidence").
- **7a ADR-0017 amendment — DONE** (`f5f91987`). §1c added; §1/§3b false claims revised; Revisit-if + References updated.
- **7b CI/fitness guard — DEFERRED-WITH-REGEX** (sensitive path). See "Deferred work".
- **7c OUT-OF-SCOPE recorded:** `@packages/api-common` Package Tests failure (`[vitest] No "Redis" export on the ioredis mock`) is a SEPARATE vitest bug, unrelated to dist-resolution. Tracked independently — NOT conflated with this change.

## Acceptance evidence (strict-TDD RED→GREEN, LXC-safe: single file, --max-old-space-size, timeout, dist-absent)

| Gate                           | Command (actual)                                                                                                                                    | Result                                                                                                                                                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 seed from src              | `mv packages/observability/logger/dist aside; cd infra/prisma; node --conditions development --import tsx seed.ts`                                  | **GREEN**: resolved @observability/logger from src, ran to `"Seed OK"` (DB reachable → exceeded the P1001 bar); `rg -ic MODULE_NOT_FOUND` = 0. RED (no flag) = ERR_MODULE_NOT_FOUND.                                                                                    |
| 6.2 security node:test subpath | `mv infra/prisma/dist aside; cd apps/api; NODE_ENV=test node --conditions development --import tsx --test --test-force-exit tests/security.test.ts` | **GREEN**: `tests 18 / pass 0 / fail 0 / cancelled 0 / skipped 18` (18 skipped = no live API server, HTTP-dependent, NOT resolution); `@infra/prisma/extensions/tenantGuard.js` resolved from src; `rg -ic MODULE_NOT_FOUND` = 0. RED (no flag) = ERR_MODULE_NOT_FOUND. |
| 6.3 production unchanged       | `cd apps/api; node --conditions development? import.meta.resolve('@infra/prisma/extensions/tenantGuard.js')`                                        | NO flag → **DIST** (development inert); WITH flag → **SRC** (development ordered first wins).                                                                                                                                                                           |
| 6.4 shared dist built first    | `mv packages/shared/dist aside; rm tsconfig.build.tsbuildinfo; cd packages/shared; tsc -b tsconfig.build.json`                                      | `dist/i18n/createRequestConfig.js` regenerated (1590 bytes, `export function createRequestConfig`). GOTCHA confirmed: turbo `--force` alone no-op'd on stale tsbuildinfo; CI clean checkout has none.                                                                   |
| 6.5 Cluster A                  | `cd apps/client; tsc -p tsconfig.json --noEmit --listFilesOnly` + `tsc --noEmit`                                                                    | 0 vitest config/shared files in graph; **0 errors total** (was TS2307 `vitest/config`).                                                                                                                                                                                 |
| 6.6 no-regress                 | `cd apps/api; vitest run tests/unit/providerService.test.ts`; fitness #26 grep                                                                      | vitest alias→src still green: `Test Files 1 passed / Tests 31 passed`, 0 resolution errors; fitness #26 = 0.                                                                                                                                                            |

Dist dirs restored after each scenario; final `git status` clean (only `?? .atl/ openspec/`).

## Fitness / 0-defect

- #26 (.js-on-.ts frontend) = **0**.
- #8 (sprint/phase refs) = **0** repo-wide and in the new codemod.
- #5 (@ts-ignore) = **0**.
- Tripwire #1/#6 (time-bomb / phase words) clean in the new `.mjs`; canon-exception marker `migration:20260616` is a valid scenario.
- All 78 changed `package.json` files validate as JSON.
- All 4 commits passed pre-commit (gitleaks, prettier, secretlint).

---

## Deferred work — orchestrator must wire (sensitive `.github/workflows` path blocked by pre_edit tripwire; needs `omnipost-allow sensitive-edit` token)

### (4.1) B-NEXT — size-limit job builds @shared/types first

File: `.github/workflows/audit.yml`, job `size-limit` (~L230-231), step `Build apps`.

EXACT diff to apply:

```yaml
# Use turbo (not pnpm --filter) so the build task's dependsOn:["^build"]
# expands @shared/types#build BEFORE the Next apps. The Next apps consume
# @shared/types as dist (Option B — Turbopack cannot honor custom export
# conditions), so packages/shared/dist MUST exist before next build, or
# apps/admin/i18n/request.ts -> @shared/types/i18n/createRequestConfig
# misses. See change dev-prod-resolution-model.
- name: Build apps
  run: pnpm exec turbo run build --filter=@apps/admin --filter=@apps/client
  env:
    NEXT_TELEMETRY_DISABLED: "1"
```

Replaces the single line `run: pnpm --filter @apps/admin --filter @apps/client build`
(keep the surrounding `- name: Build apps` / `env:` block). Verified: `turbo.json`
`build.dependsOn = ["^build"]`, turbo 2.9.16 available, @shared/types `build` =
`tsc -b tsconfig.build.json`. Dockerfiles (apps/{admin,client}/Dockerfile L73)
already build shared first — NO Dockerfile change.

### (7.2) CI/fitness-style guard for the two invariants

Two regex assertions (mirror into a new fitness check or a CI step). Both should be
**hard-zero** of violations:

**(a) Every source-mode `node --import tsx --test` invocation passes `--conditions development`.**
Find any node:test runner missing the flag (should be 0):

```bash
# Scan package.json scripts + run-tests.sh for `node ... --import tsx --test`
# (or `--import tsx` in security/tests) WITHOUT `--conditions development`.
grep -rnE "node ([^|&]*)--import tsx" \
  apps/api/package.json apps/api/scripts/run-tests.sh infra/prisma/package.json \
  | grep -E -- "--test|security/tests|seed\.ts" \
  | grep -v -- "--conditions development" \
  | grep -vE "\"dev\":|dump:openapi" \
  | wc -l   # expect 0
```

Note the two intentional exclusions: `apps/api` `dev` (`node --env-file ... --import tsx src/index.ts`)
and `dump:openapi` run against a built/served app or a schema-dump tool, NOT the
failing-CI source surfaces. They are latent candidates (they DO resolve bare
workspace specifiers) — flag for a future pass if they ever run against an unbuilt
tree in CI; out of THIS change's named scope.

**(b) Every `next build` in CI depends on `@shared/types#build`.**
Assert the size-limit job uses turbo (which expands `^build`) — guard against a
regression back to `pnpm --filter @apps/... build`:

```bash
# In .github/workflows/audit.yml the size-limit "Build apps" step must NOT use a
# bare `pnpm --filter @apps/... build` (no shared-dist guarantee). Expect 0.
grep -nE "pnpm --filter @apps/(admin|client)( --filter @apps/(admin|client))* build" \
  .github/workflows/audit.yml | wc -l   # expect 0 after the 4.1 fix
```

(The main "Build Check" job in `ci.yml` already runs `pnpm build` = `turbo run build`
with `dependsOn:["^build"]` — leave it intact.)

When wiring these into the fitness suite, follow CLAUDE.md §"Extending the suite"
(3 coordinated edits: CLAUDE.md regex + `.github/workflows/fitness.yml` step +
verify count=0 on the tip).

## Out-of-scope follow-ups (do NOT do in this change)

1. Collapse vitest onto `ssr.resolve.conditions` + retire `buildWorkspaceAliases` — separate, independently-verified change; keep the alias as fallback.
2. `@packages/api-common` ioredis-mock `No "Redis" export` — separate vitest bug, tracked independently.
3. `apps/api` `dev` + `dump:openapi` source-mode `node --import tsx` consumers — latent `--conditions development` candidates outside this change's named scope.
