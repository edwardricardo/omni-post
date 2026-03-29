# OmniPost Dependency Audit

Date: 2026-03-26

## Summary

| Category                                   | Count | Severity             |
| ------------------------------------------ | ----- | -------------------- |
| Security vulnerabilities — critical        | 4     | Fix immediately      |
| Security vulnerabilities — high            | 29    | Fix this week        |
| Security vulnerabilities — moderate        | 33    | Fix this sprint      |
| Security vulnerabilities — low             | 10    | Monitor              |
| Packages with major update available       | ~5    | Review before update |
| Packages with minor/patch update available | 79    | Safe to update       |
| Deprecated packages in use                 | 1     | Plan replacement     |
| Version scatter issues                     | 3     | Consolidate          |

## Node.js

| Current  | .nvmrc | Nightly CI | LTS Status                    |
| -------- | ------ | ---------- | ----------------------------- |
| v22.19.0 | 24     | 24         | v22 LTS active until Oct 2026 |

Note: Runtime is v22 but .nvmrc specifies v24. No `engines` field in root package.json.

## Security Vulnerabilities

### Critical (4)

| Package          | Vulnerability            | Path                                | Fix                    |
| ---------------- | ------------------------ | ----------------------------------- | ---------------------- |
| xmlhttprequest   | Arbitrary Code Injection | .>jq>xmlhttprequest                 | Upgrade jq or remove   |
| form-data 4.0.0  | Unsafe random boundary   | providers/tiktok>form-data          | Upgrade to >=4.0.4     |
| form-data <2.5.4 | Unsafe random boundary   | .>jq>jsdom>request>form-data        | Upgrade jq/jsdom chain |
| fast-xml-parser  | Regex injection bypass   | storage-s3>@aws-sdk>fast-xml-parser | Upgrade to >=5.3.5     |

### High (29) — Key items

| Package          | Vulnerability                      | Fix                   |
| ---------------- | ---------------------------------- | --------------------- |
| cloudinary 2.0.0 | Arbitrary Argument Injection       | Upgrade to >=2.7.0    |
| axios 1.7.7      | SSRF + Credential Leakage          | Upgrade to >=1.8.2    |
| jws 4.0.0        | HMAC Signature verification bypass | Upgrade to >=4.0.1    |
| protobufjs       | ReDoS                              | Upgrade transitive    |
| qs               | Prototype Pollution                | Upgrade transitive    |
| + 24 more        | Various                            | See pnpm audit output |

### Moderate (33) — Mostly transitive from Express, google-auth-library, jsdom

### Low (10) — hono timing, fast-xml-parser stack overflow, next HMR CSRF

## Major Framework Versions

| Package        | Current      | Latest  | Gap             | Notes                  |
| -------------- | ------------ | ------- | --------------- | ---------------------- |
| Next.js        | 16.1.6       | 16.1.7  | 1 patch         | HMR CSRF fix in 16.1.7 |
| React          | 19.2.4       | 19.2.4  | Current         |                        |
| Fastify        | 5.6.1        | 5.8.4   | 2 minor         | Safe to update         |
| Prisma         | 7.4.1        | 7.5.0   | 1 minor         | Safe to update         |
| TypeScript     | 5.0.4–5.9.2  | 6.0.2   | Major available | Evaluate TS 6          |
| Vitest         | 3.2.4–4.0.18 | 4.1.1   | Scatter + patch | Consolidate to 4.1.1   |
| BullMQ         | 5.58.9       | 5.71.1  | 12 patches      | Safe to update         |
| TanStack Query | 5.90.2       | 5.95.2  | 5 patches       | Safe to update         |
| Stryker        | 9.6.0        | 9.6.0   | Current         |                        |
| Turbo          | 2.8.14       | 2.8.20  | 6 patches       | Safe to update         |
| Zod            | 4.3.6        | 4.3.6   | Current         |                        |
| Tailwind CSS   | 4.2.1        | 4.2.2   | 1 patch         | Safe to update         |
| pnpm           | 10.16.0      | 10.16.0 | Current         |                        |

## Deprecated Packages Found

| Package       | Version     | Replacement                               | Used by                                 |
| ------------- | ----------- | ----------------------------------------- | --------------------------------------- |
| fluent-ffmpeg | 2.1.2–2.1.3 | @ffmpeg-installer/ffmpeg or direct binary | @providers/tiktok, @providers/instagram |

## Version Scatter Issues

| Package     | Versions Found                  | Recommendation                               |
| ----------- | ------------------------------- | -------------------------------------------- |
| TypeScript  | 5.0.4, 5.9.2                    | Consolidate to 5.9.2 (TS 6 is major — defer) |
| Vitest      | 3.2.4, 4.0.18                   | Consolidate to 4.1.1                         |
| @types/node | 22.0.0, 22.5.0, 22.13.3, 24.5.2 | Consolidate to 24.5.2                        |

## Packages Safe to Update (minor/patch)

| Package                 | From    | To       | Type                   |
| ----------------------- | ------- | -------- | ---------------------- |
| next                    | 16.1.6  | 16.1.7   | patch (security)       |
| fastify                 | 5.6.1   | 5.8.4    | minor                  |
| prisma / @prisma/client | 7.4.1   | 7.5.0    | minor                  |
| bullmq                  | 5.58.9  | 5.71.1   | patch                  |
| @tanstack/react-query   | 5.90.2  | 5.95.2   | patch                  |
| turbo                   | 2.8.14  | 2.8.20   | patch                  |
| tailwindcss             | 4.2.1   | 4.2.2    | patch                  |
| vitest                  | 4.0.18  | 4.1.1    | patch                  |
| cloudinary              | 2.0.0   | 2.9.0    | minor (security fix)   |
| @playwright/test        | 1.55.1  | 1.58.2   | minor                  |
| @tiptap/\*              | 3.6.1   | 3.20.5   | minor                  |
| @typescript-eslint/\*   | 8.44.1  | 8.57.2   | minor                  |
| lucide-react            | 0.544.0 | 1.7.0    | MAJOR — needs decision |
| @aws-sdk/\*             | 3.894.0 | 3.1017.0 | minor (security fix)   |
| @opentelemetry/\*       | 0.57.0  | 0.214.0  | minor (pre-1.0 semver) |

## Packages Requiring Decision (major version available)

| Package             | Current | Latest | Breaking Changes                               |
| ------------------- | ------- | ------ | ---------------------------------------------- |
| TypeScript          | 5.9.2   | 6.0.2  | New type system features, potential strictness |
| lucide-react        | 0.544.0 | 1.7.0  | Icon API may change, tree-shaking differences  |
| openai              | 5.22.0  | 6.33.0 | API client restructure                         |
| recharts            | 2.15.0  | 3.8.1  | Component API changes                          |
| google-auth-library | 9.14.1  | 10.6.2 | Auth flow changes                              |

## Subdependency Analysis

| Metric                          | Value   |
| ------------------------------- | ------- |
| Total packages in lockfile      | ~1,100+ |
| Packages with multiple versions | ~20     |
| Direct vulnerabilities          | ~10     |
| Transitive vulnerabilities      | ~66     |

Most vulnerabilities (66/76) are transitive — they come from dependencies of dependencies. The main chains:

- `jq > jsdom > request > form-data` — 3 vulns
- `@aws-sdk > fast-xml-parser` — 2 vulns
- `googleapis > google-auth-library` — multiple moderate
- `express` dev dep chain — multiple moderate

## Recommended Action Plan

| Priority | Action                                                  | Effort | Impact                 |
| -------- | ------------------------------------------------------- | ------ | ---------------------- |
| P0       | Upgrade next 16.1.6→16.1.7 (HMR CSRF fix)               | XS     | Security               |
| P0       | Upgrade cloudinary 2.0.0→2.9.0 (argument injection)     | XS     | Security               |
| P0       | Upgrade @aws-sdk/\* to latest 3.x (fast-xml-parser fix) | S      | Security               |
| P0       | Upgrade form-data in providers/tiktok                   | XS     | Security               |
| P1       | Consolidate TypeScript to 5.9.2 across all workspaces   | S      | Consistency            |
| P1       | Consolidate vitest to 4.1.1 across all workspaces       | S      | Consistency            |
| P1       | Consolidate @types/node to single version               | S      | Consistency            |
| P1       | Update fastify 5.6.1→5.8.4, prisma 7.4.1→7.5.0          | S      | Features + fixes       |
| P1       | Update bullmq, @tanstack/react-query, turbo, tailwind   | S      | Patch fixes            |
| P2       | Evaluate TypeScript 6.0 upgrade                         | M      | Major — needs testing  |
| P2       | Evaluate lucide-react 1.x upgrade                       | S      | Major — icon API       |
| P2       | Evaluate openai 6.x upgrade                             | M      | Major — AI integration |
| P3       | Replace fluent-ffmpeg (deprecated)                      | L      | Video processing       |
| P3       | Add engines field to root package.json                  | XS     | Governance             |
| P3       | Upgrade @opentelemetry/\* suite                         | M      | Observability          |
