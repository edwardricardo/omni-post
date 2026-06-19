# Archive Report — dev-prod-resolution-model

> Closure record for the `dev-prod-resolution-model` SDD change. Archived 2026-06-19.

## Outcome

The dev/prod module-resolution gap introduced by ADR-0017's unconditional `exports`→`dist`
flip is closed. Transpile-only workspace packages now carry an additive `development`→`src`
branch (ordered before `default`, mirrored on every root and subpath export), and every
dev/test/CI source consumer (Prisma seed, the `test:auth`/`test:rbac`/`test:security`
`node:test` scripts, and `run-tests.sh`) opts in via `--conditions development` on the
command. The Turbopack boundary is handled separately: `@shared/types` stays dist-via-Option-B
tsconfig paths and its `dist` is guaranteed built before every `next build` (size-limit job +
Dockerfile build stage). The orthogonal Cluster-A fix excludes `vitest.config.ts` from the
app/package tsc graphs. Production resolution (`default`→`dist`) is byte-for-byte unchanged,
the `development` branch is inert unless requested, and all 26 CI fitness functions stay
hard-zero (fitness #26 included). The change shipped verified.

## Capabilities / specs applied

The change's two delta specs were folded into the cumulative living specifications:

- `build-pipeline` → `openspec/specs/build-pipeline/spec.md`
- `module-resolution` → `openspec/specs/module-resolution/spec.md`

## Merge reference

- PR: **#91** (rebase-merged into `main`)
- Branch: `workstream/next-dev-resolution`
- Date archived: **2026-06-19**
