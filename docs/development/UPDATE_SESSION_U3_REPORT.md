# Update Session U3 — TypeScript 6.0

Date: 2026-03-26

## Status: COMPLETE

## TypeScript Version

| Workspace                 | From      | To                                             |
| ------------------------- | --------- | ---------------------------------------------- |
| apps/api                  | (hoisted) | 6.0.2 (added as explicit devDep + @types/node) |
| apps/admin                | 5.9.2     | 6.0.2                                          |
| apps/client               | 5.9.2     | 6.0.2                                          |
| apps/workers              | 5.9.2     | 6.0.2                                          |
| packages/\* (28 packages) | 5.9.2     | 6.0.2                                          |

## Breaking Changes Encountered and Fixed

### 1. `moduleResolution: "node"` deprecated (TS5101)

**Error:** `Option 'moduleResolution' with value 'node' is deprecated and will stop functioning in TypeScript 7.0.`

**Fix:** Changed `"moduleResolution": "node"` to `"moduleResolution": "bundler"` in `tsconfig.base.json`. The project uses ESM with tsx (esbuild-based), so `bundler` is the correct resolution strategy. `apps/client` already used `bundler`.

### 2. `baseUrl` deprecated (TS5101)

**Error:** `Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0.`

**Fix:** Removed `"baseUrl": "."` from all 13 tsconfig.json files. Converted all `paths` entries to use `./` prefix for explicit relative resolution (e.g., `"packages/shared/src/index.ts"` → `"./packages/shared/src/index.ts"`).

**Files modified:** tsconfig.base.json, apps/admin/tsconfig.json, apps/client/tsconfig.json, and all 10 provider tsconfig.json files.

### 3. `types` default changed to `[]` (TS2688, TS2591)

**Error:** `Cannot find type definition file for 'node'`, `Cannot find name 'Buffer'`, `Cannot find name 'process'`, `Cannot find namespace 'NodeJS'`.

**Fix:** Added `"types": ["node"]` to tsconfig.base.json and `packages/shared/tsconfig.json`. Added `@types/node@24.5.2` as devDependency to all 24 packages that needed it (those inheriting `types: ["node"]` from base need the actual type definitions installed).

### 4. `noUncheckedSideEffectImports` default changed to `true`

**Error:** `Cannot find module or type declarations for side-effect import of './globals.css'` in apps/client.

**Fix:** Added `"noUncheckedSideEffectImports": false` to `apps/client/tsconfig.json`. Only 2 CSS imports affected (`globals.css` in layout.tsx and storybook preview). Next.js handles CSS resolution at runtime; TS doesn't need to validate these.

### 5. `rootDir` inference change (TS5011)

**Error:** `The common source directory is '..'. The 'rootDir' setting must be explicitly set.` in `@packages/ui`.

**Fix:** Changed `@packages/ui` build from `tsc --build` to `tsc --noEmit` (UI package is consumed as source via exports, no emit needed). Removed `outDir` and added `noEmit: true` to its tsconfig.

### 6. Tooltip formatter type change (recharts 3.x interaction)

**Error:** `Type '(value: number) => [string, string]' is not assignable to type 'Formatter<ValueType, NameType>'` — recharts 3.x `formatter` value parameter is `ValueType | undefined`.

**Fix:** Added `typeof value === "number"` guard in analytics page Tooltip formatter.

## ESLint Fixes (371 pre-existing warnings resolved)

The `.stryker-tmp/` directories were not excluded from ESLint's scope. After adding the ignore pattern, 371 remaining warnings were found in test files (all pre-existing, exposed by the stryker exclusion revealing them):

| Warning Type                                                  | Count   | Fix Applied                                   |
| ------------------------------------------------------------- | ------- | --------------------------------------------- |
| `'t' is defined but never used` (unused Vitest test context)  | 317     | Renamed `(t)` → `(_t)` in 43 test files       |
| Unused imports (`expect`, `beforeEach`, `vi`, `assert`, etc.) | 34      | Removed unused imports from import statements |
| Unused variables (`stores`, `r`, `err`, `provider`, etc.)     | 20      | Prefixed with `_` or removed                  |
| **Total**                                                     | **371** | **~80 files modified**                        |

## Additional Pinning Applied

31 dependency entries across 18 files had `^` prefixes removed (some were reverted by intermediate operations and re-pinned):

- **vitest**: Consolidated to `4.0.18` across 15 packages (was mix of `^3.2.4` and `^4.1.0`)
- **turbo**: `^2.8.14` → `2.8.20`
- **@fastify/swagger**: `^9.7.0` → `9.7.0`
- **@scalar/fastify-api-reference**: `^1.48.0` → `1.49.5`
- **argon2**: `^0.44.0` → `0.44.0`
- **@fastify/rate-limit**: `^10.3.0` → `10.3.0`
- **zustand**: `^5.0.11` → `5.0.11`
- And 7 more entries across admin, bluesky, root packages

## tsconfig Changes Summary

| File                          | Changes                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tsconfig.base.json            | moduleResolution→bundler, removed baseUrl, added types:["node"], paths prefixed with ./, removed esModuleInterop+allowSyntheticDefaultImports (restored by agent for safety) |
| packages/shared/tsconfig.json | Added types:["node"]                                                                                                                                                         |
| packages/ui/tsconfig.json     | Changed to noEmit:true, removed outDir/rootDir                                                                                                                               |
| apps/client/tsconfig.json     | Added noUncheckedSideEffectImports:false                                                                                                                                     |
| apps/admin/tsconfig.json      | Removed baseUrl                                                                                                                                                              |
| 10 provider tsconfigs         | Removed baseUrl                                                                                                                                                              |
| packages/ui/package.json      | Build script: tsc --build → tsc --noEmit                                                                                                                                     |

## @types/node Added To

24 packages received `@types/node@24.5.2` as a new devDependency:

- apps/api, apps/workers
- packages/shared, packages/ports, packages/core, packages/core/threading
- packages/ui, packages/api-common
- packages/monitoring/circuit-breaker, packages/monitoring/health-checks
- packages/observability/logger
- All 10 provider packages
- All 7 adapter packages

## Build and Test Status

| Check             | Result                                         |
| ----------------- | ---------------------------------------------- |
| TypeScript build  | 0 errors, 9/9 tasks successful                 |
| API unit tests    | 305 files passed, 6,478 tests passed, 0 failed |
| ESLint            | 0 errors, 0 warnings                           |
| Unpinned versions | 0                                              |

## Decisions Made

No DECISION REQUIRED blocks were triggered. All breaking changes had clear fixes:

- `moduleResolution: "bundler"` was the obvious choice (already used by apps/client, compatible with tsx/esbuild)
- `baseUrl` removal was straightforward (prefix paths with `./`)
- `types: ["node"]` + installing `@types/node` everywhere resolved type resolution
- `noUncheckedSideEffectImports: false` scoped only to apps/client (CSS imports)

## Peer Dependency Warnings (non-blocking)

| Package                                  | Peer Dependency           | Status                                         |
| ---------------------------------------- | ------------------------- | ---------------------------------------------- |
| @typescript-eslint/utils 8.57.2          | typescript >=4.8.4 <6.0.0 | Works fine, awaiting @typescript-eslint update |
| madge 8.0.0                              | typescript ^5.4.4         | Dev tool only, works fine                      |
| tsconfck 3.1.6 (via vite-tsconfig-paths) | typescript ^5.0.0         | Works fine                                     |

## Packages That Could Not Be Updated

Carried forward from U2:

| Package           | Reason                                     | Session |
| ----------------- | ------------------------------------------ | ------- |
| openai            | Major — AI orchestrator changes            | U4      |
| fluent-ffmpeg     | Deprecated — needs replacement             | U5      |
| @opentelemetry/\* | Suite update — needs comprehensive testing | U6      |
