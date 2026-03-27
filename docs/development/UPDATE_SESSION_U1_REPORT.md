# Update Session U1 — Security + Patches + Consolidation

Date: 2026-03-26

## Vulnerabilities Fixed

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

## Transitive Overrides Added

| Package           | Override Value | Fixes                                                    |
| ----------------- | -------------- | -------------------------------------------------------- |
| jws               | 4.0.1          | HMAC signature verification bypass                       |
| xmlhttprequest    | 1.8.0          | Arbitrary Code Injection (via jq)                        |
| flatted           | 3.4.2          | Prototype Pollution (via eslint>flat-cache)              |
| hono              | 4.12.9         | Timing attack + multiple CVEs (via prisma>@prisma/dev)   |
| @hono/node-server | 1.19.11        | Request smuggling (via prisma>@prisma/dev)               |
| effect            | 3.21.0         | Vulnerability (via prisma>@prisma/config)                |
| qs                | 6.15.0         | arrayLimit bypass DoS (via googleapis>googleapis-common) |
| rollup            | 4.60.0         | DOM Clobbering (via stryker>vitest>vite)                 |

## Consolidations Applied

| Package     | Before                                             | After                      |
| ----------- | -------------------------------------------------- | -------------------------- |
| TypeScript  | 5.0.4 (opentelemetry), 5.9.2 (rest)                | 5.9.2 everywhere           |
| Vitest      | ^3.2.4 (3 pkgs), ^4.1.0 (12 pkgs), 4.0.18 (3 pkgs) | 4.0.18 everywhere (pinned) |
| @types/node | 22.0.0, 22.5.0, 22.13.3, 24.5.2                    | 24.5.2 everywhere          |
| ioredis     | 5.7.0 (6 pkgs), 5.10.1 (0 pkgs)                    | 5.10.1 everywhere          |

## Patches Applied

| Package                          | From     | To       |
| -------------------------------- | -------- | -------- |
| fastify                          | 5.6.1    | 5.8.4    |
| prisma                           | 7.4.1    | 7.5.0    |
| @prisma/client                   | 7.4.1    | 7.5.0    |
| @prisma/adapter-pg               | 7.4.1    | 7.5.0    |
| bullmq                           | 5.58.9   | 5.71.1   |
| ioredis                          | 5.7.0    | 5.10.1   |
| @fastify/cors                    | 11.1.0   | 11.2.0   |
| @scalar/fastify-api-reference    | ^1.48.0  | 1.49.5   |
| @tanstack/react-query            | 5.90.2   | 5.95.2   |
| @tanstack/react-query-devtools   | 5.90.2   | 5.95.2   |
| @tiptap/\* (11 packages)         | 3.6.1    | 3.20.5   |
| @typescript-eslint/eslint-plugin | 8.44.1   | 8.57.2   |
| @typescript-eslint/parser        | 8.44.1   | 8.57.2   |
| @playwright/test                 | 1.55.1   | 1.58.2   |
| turbo                            | ^2.8.14  | 2.8.20   |
| tailwindcss                      | 4.2.1    | 4.2.2    |
| @tailwindcss/postcss             | 4.2.1    | 4.2.2    |
| validator                        | 13.15.15 | 13.15.26 |
| aws-sdk-client-mock              | ^4.1.0   | 4.1.0    |

## Pinning Applied

All updated versions changed from `^x.y.z` to exact `x.y.z` where applicable:

- vitest: 15 packages changed from `^3.2.4` or `^4.1.0` to `4.0.18`
- turbo: changed from `^2.8.14` to `2.8.20`
- @fastify/swagger: changed from `^9.7.0` to `9.7.0`
- @scalar/fastify-api-reference: changed from `^1.48.0` to `1.49.5`
- aws-sdk-client-mock: changed from `^4.1.0` to `4.1.0`

## Governance

- [x] engines field added to root package.json: `{ "node": ">=24", "pnpm": ">=10" }`
- [x] .nvmrc matches engines requirement (value: 24)
- [ ] packageManager pnpm version not updated (10.16.0 -> 10.33.0 requires corepack, deferred)

## Security Audit Comparison

| Severity  | Before | After  | Delta   |
| --------- | ------ | ------ | ------- |
| Critical  | 4      | 2      | -2      |
| High      | 29     | 12     | -17     |
| Moderate  | 33     | 16     | -17     |
| Low       | 10     | 4      | -6      |
| **Total** | **76** | **34** | **-42** |

## Build and Test Status

| Check               | Result                                         |
| ------------------- | ---------------------------------------------- |
| TypeScript build    | 0 errors, 9/9 tasks successful                 |
| API unit tests      | 305 files passed, 6,478 tests passed, 0 failed |
| All workspace tests | Pass                                           |

## Remaining Vulnerabilities (34)

The 34 remaining vulnerabilities are all **transitive** from dev tooling dependencies where overriding would cross major versions and break compatibility:

- **2 critical**: form-data v2.x via jq>jsdom>request (request is deprecated, no fix available)
- **12 high**: minimatch (depcheck, madge), picomatch (depcheck, stryker), vite (stryker), serialize-javascript (storybook), lodash (depcheck)
- **16 moderate**: Various via depcheck, madge, storybook, google-auth-library
- **4 low**: hono timing (prisma dev), qs (googleapis), form-data (jsdom)

These are primarily in dev-only tools (depcheck, madge, storybook, jq) and do not affect production runtime.

## Packages That Could Not Be Updated

| Package               | Reason                                                | Session |
| --------------------- | ----------------------------------------------------- | ------- |
| lucide-react          | Major 0.x -> 1.x — icon API changes                   | U2      |
| recharts              | Major 2.x -> 3.x — component API changes              | U2      |
| TypeScript            | 5.9.2 -> 6.0 major                                    | U3      |
| openai                | Major — AI orchestrator changes                       | U4      |
| fluent-ffmpeg         | Deprecated — needs replacement                        | U5      |
| @opentelemetry/\*     | Suite update — needs comprehensive testing            | U6      |
| pnpm (packageManager) | 10.16.0 -> 10.33.0 requires corepack SHA regeneration | U2      |
