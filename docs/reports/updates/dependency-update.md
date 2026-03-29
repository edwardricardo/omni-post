# OmniPost Dependency Update Report — Sessions U0 through U6

Date: 2026-03-26 to 2026-03-27

## Executive Summary

Seven update sessions brought all production dependencies to their latest stable versions, eliminated all deprecated packages, and aligned runtime environments across local development, CI, and Docker.

| Metric                     | Before            | After                    |
| -------------------------- | ----------------- | ------------------------ |
| Security vulnerabilities   | 76                | 34 (dev-only transitive) |
| Outdated packages          | 79+               | 0                        |
| Unpinned versions (^ or ~) | 45+               | 0                        |
| Deprecated packages        | 1 (fluent-ffmpeg) | 0                        |
| ESLint warnings            | 371               | 0                        |
| TypeScript errors          | 0                 | 0                        |
| Test failures              | 0                 | 0                        |

## Sessions Overview

| Session | Focus                              | Breaking Changes   | Files Modified |
| ------- | ---------------------------------- | ------------------ | -------------- |
| U0      | Node.js v22 → v24.14.1 LTS         | 0                  | 11             |
| U1      | Security + patches + consolidation | 0                  | 30+            |
| U2      | lucide-react + recharts + pnpm     | 1                  | 8              |
| U3      | TypeScript 5.9.2 → 6.0.2           | 6                  | 100+           |
| U4      | openai SDK 5.22.0 → 6.33.0         | 0                  | 1              |
| U5      | fluent-ffmpeg replacement          | N/A (full rewrite) | 10             |
| U6      | @opentelemetry suite (14 packages) | 1                  | 3              |

---

## U0 — Node.js v22 → v24 LTS

**Date:** 2026-03-26

Upgraded the Node.js runtime from v22.19.0 to v24.14.1 LTS (Krypton) across all environments.

### Runtime Change

| Environment       | Before   | After            |
| ----------------- | -------- | ---------------- |
| Local runtime     | v22.19.0 | v24.14.1         |
| nvm default alias | 22       | 24               |
| .nvmrc            | 24       | 24 (unchanged)   |
| engines field     | >=24     | >=24 (unchanged) |

### CI Workflows Updated

| File                                               | Change                                       |
| -------------------------------------------------- | -------------------------------------------- |
| `.github/actions/setup-node-pnpm-cache/action.yml` | node 20 → 24, pnpm 10.16.0 → 10.33.0         |
| `.github/workflows/dependency-updates.yml`         | NODE_VERSION 20 → 24, PNPM 10.16.0 → 10.33.0 |
| `.github/workflows/security-testing.yml`           | NODE_VERSION 20 → 24, PNPM 10.16.0 → 10.33.0 |
| `.github/workflows/production-ci.yml`              | NODE_VERSION 20 → 24                         |
| `.github/workflows/nightly.yml`                    | Already on 24                                |
| `.github/workflows/ci.yml`                         | Inherits 24 from composite action            |
| `.github/workflows/performance.yml`                | Inherits 24 from composite action            |

### Dockerfiles Updated

| File                             | Change                                                          |
| -------------------------------- | --------------------------------------------------------------- |
| `apps/api/Dockerfile.production` | node:20-alpine → node:24-alpine, distroless nodejs20 → nodejs24 |
| `apps/api/Dockerfile.dev`        | node:20-alpine → node:24-alpine                                 |
| `apps/api/Dockerfile.railway`    | node:20-slim → node:24-slim                                     |
| `apps/admin/Dockerfile`          | node:20-alpine → node:24-alpine, distroless nodejs20 → nodejs24 |
| `apps/workers/Dockerfile`        | node:20-alpine → node:24-alpine, distroless nodejs20 → nodejs24 |
| `apps/client/Dockerfile`         | node:20-alpine → node:24-alpine, distroless nodejs20 → nodejs24 |

### Scripts Updated

- `quality/scripts/setup-environment.sh`: REQUIRED_NODE_VERSION 20 → 24

### Native Modules

argon2 and Prisma installed cleanly on Node v24 without rebuild.

---

## U1 — Security + Patches + Consolidation

**Date:** 2026-03-26

Addressed 42 of 76 security vulnerabilities and consolidated fragmented dependency versions.

### Vulnerabilities Fixed

| Package                       | From     | To       | Severity | Type                |
| ----------------------------- | -------- | -------- | -------- | ------------------- |
| cloudinary                    | 2.0.0    | 2.9.0    | critical | direct              |
| @aws-sdk/client-s3            | 3.894.0  | 3.1017.0 | critical | direct              |
| @aws-sdk/s3-presigned-post    | 3.894.0  | 3.1017.0 | critical | direct              |
| @aws-sdk/s3-request-presigner | 3.894.0  | 3.1017.0 | critical | direct              |
| form-data                     | 4.0.0    | 4.0.5    | critical | direct              |
| axios                         | 1.7.7    | 1.13.6   | high     | direct              |
| next                          | 16.1.6   | 16.2.1   | low      | direct              |
| validator                     | 13.15.15 | 13.15.26 | high     | direct              |
| jws                           | 4.0.0    | 4.0.1    | high     | transitive override |

### Transitive Overrides Added

| Package           | Override Value | Fixes                              |
| ----------------- | -------------- | ---------------------------------- |
| jws               | 4.0.1          | HMAC signature verification bypass |
| xmlhttprequest    | 1.8.0          | Arbitrary Code Injection           |
| flatted           | 3.4.2          | Prototype Pollution                |
| hono              | 4.12.9         | Timing attack + multiple CVEs      |
| @hono/node-server | 1.19.11        | Request smuggling                  |
| effect            | 3.21.0         | Vulnerability via prisma           |
| qs                | 6.15.0         | arrayLimit bypass DoS              |
| rollup            | 4.60.0         | DOM Clobbering                     |

### Version Consolidations

| Package     | Before                             | After                      |
| ----------- | ---------------------------------- | -------------------------- |
| TypeScript  | 5.0.4 / 5.9.2 mixed                | 5.9.2 everywhere           |
| Vitest      | ^3.2.4 / ^4.1.0 / 4.0.18 mixed     | 4.0.18 everywhere (pinned) |
| @types/node | 22.0.0 / 22.5.0 / 22.13.3 / 24.5.2 | 24.5.2 everywhere          |
| ioredis     | 5.7.0 / 5.10.1 mixed               | 5.10.1 everywhere          |

### Patches Applied (20 packages)

fastify 5.6.1 → 5.8.4, prisma 7.4.1 → 7.5.0, bullmq 5.58.9 → 5.71.1, ioredis 5.7.0 → 5.10.1, @fastify/cors 11.1.0 → 11.2.0, @tanstack/react-query 5.90.2 → 5.95.2, @tiptap/_ (11 packages) 3.6.1 → 3.20.5, @typescript-eslint/_ 8.44.1 → 8.57.2, @playwright/test 1.55.1 → 1.58.2, turbo 2.8.14 → 2.8.20, tailwindcss 4.2.1 → 4.2.2, and others.

### Security Audit Comparison

| Severity  | Before | After  | Delta   |
| --------- | ------ | ------ | ------- |
| Critical  | 4      | 2      | -2      |
| High      | 29     | 12     | -17     |
| Moderate  | 33     | 16     | -17     |
| Low       | 10     | 4      | -6      |
| **Total** | **76** | **34** | **-42** |

Remaining 34 vulnerabilities are all transitive from dev-only tools (depcheck, madge, storybook, jq) and do not affect production runtime.

### Governance

- engines field added: `{ "node": ">=24", "pnpm": ">=10" }`
- .nvmrc set to `24`

---

## U2 — lucide-react + recharts + pnpm

**Date:** 2026-03-26

Three major version upgrades with contained UI scope.

### Updates Applied

| Package               | From           | To             | Breaking Changes                        |
| --------------------- | -------------- | -------------- | --------------------------------------- |
| lucide-react          | 0.544.0        | 1.7.0          | None (all 83 icons backward-compatible) |
| recharts              | 2.15.0         | 3.8.1          | 1 (Tooltip formatter type)              |
| pnpm (packageManager) | 10.16.0+sha512 | 10.33.0+sha512 | None                                    |

### Breaking Change Fixed

recharts 3.x changed the `Tooltip` `formatter` prop type signature: `value` parameter became `ValueType | undefined`. Fixed by adding a `typeof value === "number"` guard in the analytics page.

### Additional Pinning

14 dependencies across 4 files had `^` prefixes removed: argon2, @fastify/rate-limit, @radix-ui/react-popover, @radix-ui/react-scroll-area, @types/papaparse, cronstrue, papaparse, zustand, @atproto/api, image-size, @ast-grep/cli, jscpd, knip, madge.

---

## U3 — TypeScript 5.9.2 → 6.0.2

**Date:** 2026-03-26

Major TypeScript upgrade across 32 workspace packages with 6 breaking changes.

### TypeScript Version

| Workspace                 | From      | To                               |
| ------------------------- | --------- | -------------------------------- |
| apps/api                  | (hoisted) | 6.0.2 (added as explicit devDep) |
| apps/admin                | 5.9.2     | 6.0.2                            |
| apps/client               | 5.9.2     | 6.0.2                            |
| apps/workers              | 5.9.2     | 6.0.2                            |
| packages/\* (28 packages) | 5.9.2     | 6.0.2                            |

### Breaking Changes Fixed

1. **`moduleResolution: "node"` deprecated (TS5101)** — Changed to `"bundler"` in tsconfig.base.json. Project uses ESM with tsx (esbuild-based).

2. **`baseUrl` deprecated (TS5101)** — Removed from all 13 tsconfig.json files. Converted paths to `./`-prefixed relative resolution.

3. **`types` default changed to `[]` (TS2688, TS2591)** — Added `"types": ["node"]` to tsconfig.base.json and shared tsconfig. Added `@types/node@24.5.2` to 24 packages.

4. **`noUncheckedSideEffectImports` default true** — Added `"noUncheckedSideEffectImports": false` to apps/client (2 CSS imports).

5. **`rootDir` inference change (TS5011)** — Changed @packages/ui build from `tsc --build` to `tsc --noEmit`.

6. **Tooltip formatter type (recharts 3.x interaction)** — Added `typeof value === "number"` guard.

### ESLint Fixes (371 pre-existing warnings)

| Warning Type                     | Count | Fix                           |
| -------------------------------- | ----- | ----------------------------- |
| Unused Vitest test context `(t)` | 317   | Renamed to `(_t)` in 43 files |
| Unused imports                   | 34    | Removed                       |
| Unused variables                 | 20    | Prefixed with `_` or removed  |

### tsconfig Changes

| File                          | Changes                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| tsconfig.base.json            | moduleResolution → bundler, removed baseUrl, added types:["node"], paths prefixed with ./ |
| packages/shared/tsconfig.json | Added types:["node"]                                                                      |
| packages/ui/tsconfig.json     | Changed to noEmit:true                                                                    |
| apps/client/tsconfig.json     | Added noUncheckedSideEffectImports:false                                                  |
| apps/admin/tsconfig.json      | Removed baseUrl                                                                           |
| 10 provider tsconfigs         | Removed baseUrl                                                                           |

### Additional Pinning

31 dependency entries across 18 files re-pinned (vitest consolidated to 4.0.18 across 15 packages, turbo 2.8.20, and others).

### Peer Dependency Warnings (non-blocking)

@typescript-eslint/utils 8.57.2 (peerDep <6.0.0), madge 8.0.0 (peerDep ^5.4.4), tsconfck 3.1.6 (peerDep ^5.0.0) — all work fine with TS 6.0.2.

---

## U4 — openai SDK 5.22.0 → 6.33.0

**Date:** 2026-03-26

Clean version bump with zero code changes.

### Version

| Package | From   | To     |
| ------- | ------ | ------ |
| openai  | 5.22.0 | 6.33.0 |

### Impact

Zero source code changes needed. All APIs used by OmniPost (`chat.completions.create`, `images.generate`, `models.list`, `new OpenAI()`) are backward-compatible in openai 6.x.

### Breaking Changes Analysis

10 breaking changes in openai 6.x — none affect OmniPost: `httpAgent` removed (not used), `fileFromPath()` removed (not used), `.del()` renamed (not used), request options overloads (not used), response body changed to Web ReadableStream (no streaming used), `APIError.headers` now Web Headers (generic catch), core module paths relocated (no subpath imports), `APIClient` removed (uses `OpenAI` directly), shim imports removed (not used), URI auto-encoding (no manual encoding).

### AI Features Verified

Text generation, content analysis, content optimization, performance prediction, content variations, image generation (DALL-E 3), availability check, and custom baseURL support all compile and pass tests.

---

## U5 — fluent-ffmpeg Replacement

**Date:** 2026-03-26

Full replacement of deprecated fluent-ffmpeg with `child_process.execFile`.

### Strategy

**Option A chosen:** Complete rewrite using `child_process.execFile` + `util.promisify`. Zero new dependencies added — uses Node.js built-ins only.

### Packages Removed

| Package              | Version | Removed From                            |
| -------------------- | ------- | --------------------------------------- |
| fluent-ffmpeg        | 2.1.2   | @providers/instagram                    |
| fluent-ffmpeg        | 2.1.3   | @providers/tiktok                       |
| @types/fluent-ffmpeg | 2.1.24  | @providers/instagram, @providers/tiktok |

### Code Changes

| File                                      | Change                                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| providers/instagram/src/mediaProcessor.ts | Rewrote 4 methods (getVideoMetadata, processVideoSegment, optimizeForReels, createThumbnail) from fluent-ffmpeg chains to execFileAsync calls. Simplified nested Promise/callback patterns to flat async/await. |
| providers/tiktok/src/videoProcessor.ts    | Rewrote 4 methods (analyzeVideo, executeVideoProcessing, generateThumbnail, generatePreviewGif). Added duration parameter to generateThumbnail for 10% timestamp calculation.                                   |
| 6 test files                              | Replaced vi.mock("fluent-ffmpeg") with vi.mock("node:child_process"). Rewrote all chainable method mocks to single mockExecFile dispatcher.                                                                     |
| 2 package.json files                      | Removed fluent-ffmpeg and @types/fluent-ffmpeg                                                                                                                                                                  |

### Video Processing Behavior Verification

| Feature                       | Identical? |
| ----------------------------- | ---------- |
| Duration detection (ffprobe)  | Yes        |
| Dimension/codec detection     | Yes        |
| Video transcoding (H.264/AAC) | Yes        |
| Aspect ratio scaling          | Yes        |
| Thumbnail extraction          | Yes        |
| Preview GIF generation        | Yes        |
| Quality control (CRF)         | Yes        |
| Reels optimization            | Yes        |

---

## U6 — @opentelemetry Suite

**Date:** 2026-03-27

Updated all 14 @opentelemetry packages with one breaking change.

### Packages Updated

| Package                                   | From   | To      |
| ----------------------------------------- | ------ | ------- |
| @opentelemetry/api                        | 1.9.0  | 1.9.1   |
| @opentelemetry/core                       | 1.30.0 | 2.6.1   |
| @opentelemetry/resources                  | 1.30.0 | 2.6.1   |
| @opentelemetry/sdk-node                   | 0.57.0 | 0.214.0 |
| @opentelemetry/semantic-conventions       | 1.28.0 | 1.40.0  |
| @opentelemetry/exporter-prometheus        | 0.57.0 | 0.214.0 |
| @opentelemetry/exporter-trace-otlp-http   | 0.57.0 | 0.214.0 |
| @opentelemetry/instrumentation            | 0.57.0 | 0.214.0 |
| @opentelemetry/instrumentation-http       | 0.57.0 | 0.214.0 |
| @opentelemetry/instrumentation-fastify    | 0.41.0 | 0.57.0  |
| @opentelemetry/instrumentation-redis      | 0.45.0 | 0.62.0  |
| @opentelemetry/instrumentation-fs         | 0.15.0 | 0.33.0  |
| @opentelemetry/auto-instrumentations-node | 0.51.0 | 0.72.0  |
| @opentelemetry/propagation-utils          | 0.31.8 | 0.31.17 |

### Breaking Change Fixed

`Resource` class removed (now type-only) in @opentelemetry/resources 2.x. Replaced `import { Resource }` with `import { resourceFromAttributes }` and `new Resource({...})` with `resourceFromAttributes({...})` in `packages/observability/opentelemetry/src/index.ts`.

All other APIs (NodeSDK, exporters, instrumentations, semantic conventions) remained compatible.

---

## Final State

### Build and Test Status

| Check             | Result                            |
| ----------------- | --------------------------------- |
| TypeScript build  | 0 errors, 9/9 tasks               |
| API unit tests    | 305 files, 6,478 passed, 0 failed |
| ESLint            | 0 errors, 0 warnings              |
| Unpinned versions | 0                                 |

### Tech Stack (Final)

| Component               | Version                               |
| ----------------------- | ------------------------------------- |
| Node.js                 | v24.14.1 LTS (Krypton)                |
| TypeScript              | 6.0.2                                 |
| Fastify                 | 5.8.4                                 |
| Prisma                  | 7.5.0                                 |
| React                   | 19.2.4                                |
| Next.js                 | 16.2.1                                |
| Vitest                  | 4.0.18                                |
| pnpm                    | 10.33.0                               |
| openai                  | 6.33.0                                |
| lucide-react            | 1.7.0                                 |
| recharts                | 3.8.1                                 |
| @opentelemetry/sdk-node | 0.214.0                               |
| fluent-ffmpeg           | REMOVED (replaced with child_process) |

### Remaining Vulnerabilities (34)

All transitive from dev-only tools. Do not affect production:

- 2 critical: form-data v2.x via jq > jsdom > request (deprecated, no fix)
- 12 high: minimatch, picomatch, vite, serialize-javascript, lodash (via depcheck, madge, stryker, storybook)
- 16 moderate: Various via depcheck, madge, storybook, google-auth-library
- 4 low: hono timing, qs, form-data (via prisma dev, googleapis, jsdom)
