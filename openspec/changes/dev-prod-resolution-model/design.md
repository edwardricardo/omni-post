# Design — dev-prod-resolution-model

> Technical design. Reads: `proposal.md` (required) + the empirically-verified RCA.
> All mechanisms below were reproduced with `dist` deliberately absent. Additive, low rollback risk.

## Technical Approach

Three orthogonal, coordinated edits — each maps to one verified failure cluster:

| Mech          | Cluster          | Mechanism                                                                              | Covers                                       |
| ------------- | ---------------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| **B-CORE**    | B (Node runners) | conditional `exports` `development`→src + `--conditions development` on the invocation | `tsx` seed, `node:test` security/integration |
| **B-NEXT**    | B (Turbopack)    | build `@shared/types` dist before `next build` (Turbopack ignores conditions)          | `size-limit` CI job                          |
| **Cluster A** | A (tsc graph)    | exclude `vitest.config.ts` from the tsc/typecheck graph                                | `apps/client` `next build` typecheck         |

No single mechanism suffices: Turbopack cannot honor custom export conditions (vercel/next.js #78912), so the Node boundary and the Turbopack boundary need different fixes.

## Architecture Decisions

### Decision: conditional `exports` for the Node boundary (B-CORE)

**Choice**: Add a `development`→src branch FIRST, keep `default`→dist LAST, on all ~84 `exports`-bearing packages. Opt in via `--conditions development` on each source-mode command.
**Alternatives**: (a) universal tsconfig `paths` for all runners — rejected: `paths` is type/bundler-time only, raw Node/`tsx`/`node:test` ignore it for bare specifiers (the exact failure). (b) build-dist-first everywhere — rejected: slow inner loop, defeats source consumption. (c) `publishConfig` swap — rejected: packages are `private`, never published.
**Rationale**: One Node-resolver mechanism covers `tsx` + `node:test` at once. Node key order is significant (most-specific first, `default` always matches last); the four core conditions always apply, so the branch is strictly additive and inert without the flag — production keeps `default`→dist. `--conditions` on the invocation, NOT `NODE_OPTIONS` (GitHub Actions strips it from `GITHUB_ENV`; `tsx` #574 — `tsx` does not auto-read tsconfig `customConditions`). Node 24 honors `-C/--conditions` as a CLI flag (verify `process.allowedNodeEnvironmentFlags.has('--conditions')`).

### Decision: build-dist-first for `@shared/types` (B-NEXT), EXCLUDE it from B-CORE

**Choice**: Leave `@shared/types` `exports`/tsconfig pinned to dist (Option B); guarantee dist is built before `next build`.
**Alternatives**: source-resolve via condition — rejected: Turbopack ignores it and can't eat shared's NodeNext `.js` src specifiers (would also re-introduce fitness #26 risk).
**Rationale**: The only correct fix at the Turbopack boundary. Dockerfile already does this (`apps/{admin,client}/Dockerfile:73` `pnpm --filter @shared/types... build` precedes `next build:78`). Only the CI `size-limit` job lacks the ordering.

### Decision: config files out of every tsc graph (Cluster A)

**Choice**: Add `"vitest.config.ts"` to `apps/client/tsconfig.json` `exclude` (admin already excludes it). Package build tsconfigs stay `include: ["src/**/*"]`.
**Rationale**: A swept root `vitest.config.ts` drags in `vitest/config` + the cross-rootDir `../../vitest.shared.ts` from the monorepo root (no `vitest` there) → TS2307/TS6059/TS6307. Adding a `vitest` devDep alone is insufficient (api-errors already has it and still failed) — excluding the file is decisive.

## The codemod (B-CORE)

`scripts/migrations/add-development-condition.mjs` — idempotent; header carries `// canon-exception: migration:<ts>`.

- **Discovery**: enumerate workspace `package.json` with an `exports` object (84 files + `infra/prisma`).
- **dist↔src rule** (per entry, string OR `{...}.default`/`types`): derive src from dist by stripping `dist/` then mapping the extension — `dist/index.js`→`src/index.ts`, `dist/index.d.ts` (use as `types`), `dist/*`→`src/*`. The ONE exception: `infra/prisma` emits `dist/src/*`, so strip `dist/src/`→`src/` (`dist/src/index.js`→`src/index.ts`, `dist/src/extensions/*`→`src/extensions/*`, `dist/src/*`→`src/*`).
- **Rewrite shape** (object form, key order: `development` → `types` → `default`):
  - object entry `{ "types": T, "default": D }` → `{ "development": <src(D)>, "types": T, "default": D }`
  - string subpath entry `"./*": "./dist/*"` → `{ "development": "./src/*", "default": "./dist/*" }`
- **Idempotency**: if `development` already present on an entry, skip it.
- **Skip list**: packages with NO `exports` — `@packages/api-errors` (src-only, `main`/`types`→`./src/index.ts`, no dist) and any other src-only frontend pkg. **Exclude `@shared/types`** (B-NEXT boundary — must stay dist-only).

## File Changes

| File                                                                                                   | Action               | Description                                                                                           |
| ------------------------------------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `scripts/migrations/add-development-condition.mjs`                                                     | Create               | Idempotent codemod (above)                                                                            |
| ~84 `package.json` + `infra/prisma/package.json`                                                       | Modify (via codemod) | Add `development`→src branch, ordered first                                                           |
| `infra/prisma/package.json` `scripts.seed`                                                             | Modify               | `tsx --conditions development seed.ts`                                                                |
| `apps/api/scripts/run-tests.sh`                                                                        | Modify               | `node --conditions development --import tsx --test …` in `run_batch`                                  |
| `apps/api/package.json` `test:auth`/`test:rbac`/`test:security` (+ sibling `test:*` node:test scripts) | Modify               | Insert `--conditions development` after `node`                                                        |
| `.github/workflows/audit.yml` size-limit job (`Build apps`, L230-231)                                  | Modify               | `turbo run build --filter=@apps/admin --filter=@apps/client` (expands `^build`→`@shared/types#build`) |
| `apps/client/tsconfig.json` `exclude`                                                                  | Modify               | Add `"vitest.config.ts"`                                                                              |

`tsc -b` gotcha to encode in any prebuild note: incremental — a stale `tsconfig.build.tsbuildinfo` makes rebuild a no-op; CI clean checkout / turbo output-tracking is safe.

## What MUST NOT regress (and how preserved)

1. **Vitest alias→src** (`vitest.shared.ts buildWorkspaceAliases`): untouched — change is package.json `exports` + CLI flags only. Do NOT delete the alias (vitest collapse is an out-of-scope follow-up).
2. **Production**: `default`→dist unchanged; `development` inert without the flag (never passed in the runtime container).
3. **Fitness #26**: no relative `.js` imports added in frontend dirs — exports live in package.json, target backend/NodeNext pkgs.
4. **Next dev / `@shared/types`→dist (Option B)**: excluded from B-CORE; tsconfig dist mapping intact.
5. **Main "Build Check" `^build`**: only ADD ordering to size-limit; don't touch the working job.

## Testing Strategy (strict-TDD-shaped, LXC-safe)

| Scenario                                     | Approach                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node consumer resolves-from-src, dist absent | Move `dist` aside; `node --conditions development --import tsx seed.ts` → reaches `prisma.account.upsert` (P1001 DB-down OK, zero `MODULE_NOT_FOUND`). Security: `node --conditions development --import tsx --test --test-force-exit tests/security.test.ts` → 18 tests, 0 cancelled, 0 resolution errors. |
| Production default→dist intact               | Without `--conditions`, assert consumer still resolves `default`→dist (`development` inert).                                                                                                                                                                                                                |
| `@shared/types` dist built first             | Assert `packages/shared/dist/i18n/createRequestConfig.js` exists post size-limit build step.                                                                                                                                                                                                                |
| Cluster A                                    | `apps/client` typecheck no longer sweeps `vitest.config.ts` (`--listFilesOnly` excludes it).                                                                                                                                                                                                                |

Run single files with `--max-old-space-size` + `timeout` (9 GB cap; no `docker build`, no full suite).

## Sequencing / Rollback

1. Codemod (`exports` branches) → 2. wire `--conditions development` (seed, run-tests.sh, test:\* scripts) → 3. size-limit job ordering → 4. `apps/client` tsconfig exclude. Each step is independently verifiable and additive; revert any package.json via `git checkout`. Closure (out of this slice): ADR-0017 amendment + a CI/fitness guard for the two invariants.

## Open Questions

- [ ] Final codemod skip-list beyond `@packages/api-errors` + `@shared/types` — enumerate at apply (any other src-only `exports`-less pkg).
- [ ] Confirm Node 24 `--conditions` CLI support on the pinned runtime before relying on it (recommendation: inline-per-invocation, already chosen).
