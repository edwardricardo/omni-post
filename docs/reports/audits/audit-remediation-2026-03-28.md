# OmniPost Audit Remediation Report

Date: 2026-03-28
Sessions: A1 through A7

---

## Executive Summary

| Session | Title                                      | Issues Closed | Status |
| ------- | ------------------------------------------ | ------------- | ------ |
| A1      | Security: Auth + Vulnerabilities + Console | 3             | ✅     |
| A2      | Bluesky Registration + Mock Data           | 2             | ✅     |
| A3      | Route Schema Annotations (OpenAPI)         | 1             | ✅     |
| A4      | TypeScript `any` Elimination               | 1             | ✅     |
| A5      | Test Backlog Resolution                    | 1             | ✅     |
| A6      | Unit of Work Expansion                     | 1             | ✅     |
| A7      | DevDependency Updates                      | 1             | ✅     |

---

## A1 — Security

### Auth Middleware Audit

| Route Category              | Count            | Status        |
| --------------------------- | ---------------- | ------------- |
| Routes with auth middleware | 44               | ✅ Protected  |
| Routes intentionally public | 1 (healthRoutes) | ✅ Documented |
| Total route files           | 45               | 100% covered  |

16 route files were missing `authenticateMiddleware`. All now have per-endpoint `{ preHandler: [authenticateMiddleware] }` applied. Exceptions: `GET /providers` (discovery), `GET /r/:shortCode` (link redirect), all health endpoints.

### Vulnerability Count

| Severity  | Before A1 | After A1 | Delta   |
| --------- | --------- | -------- | ------- |
| Critical  | 5         | 2        | -3      |
| High      | 33        | 24       | -9      |
| Moderate  | 40        | 34       | -6      |
| Low       | 10        | 9        | -1      |
| **Total** | **88**    | **69**   | **-19** |

Overrides added: `form-data@4.0.5`, `fast-xml-parser@5.5.9`, `xmlhttprequest-ssl@4.0.0`. Remaining 2 critical are in transitive deps without patches (xmlhttprequest via jq, handlebars via next.js).

### ResendEmailAdapter

3 `console.*` calls replaced with `emailLogger` (Pino structured logging).

---

## A2 — Bluesky + Mock Data

### Bluesky Registration

Status: ✅ Registered
File: `apps/api/src/providers/providerRegistry.ts`
Providers registered: 10/10

### Mock Data Cleanup

File: `apps/api/src/trends/trendAnalysisService.ts`
Two large mock arrays (`mockTrends`, `mockPredictions`) replaced with `return []` pending real TikTok Research API integration.

### Regex lastIndex Bug Fix

Discovered and fixed a pre-existing bug in `enhancedValidator.ts` where regex patterns with `/g` flag had stale `lastIndex` when validating arrays. Added `pattern.lastIndex = 0` before each `.test()` call.

---

## A3 — Route Schema Annotations

| Metric                     | Before | After                                    |
| -------------------------- | ------ | ---------------------------------------- |
| Routes with OpenAPI schema | 0      | 44                                       |
| Routes without schema      | 45     | 1 (healthRoutes — tags added separately) |

All 44 authenticated route files now have `schema: { tags: ["Domain"], summary: "Description" }` on every endpoint. Scalar API docs at `/docs` now show categorized endpoints.

---

## A4 — TypeScript `any` Reduction

| Metric                   | Before | After                  |
| ------------------------ | ------ | ---------------------- |
| `any` in production code | 451    | 0 (4 in comments only) |
| Files modified           | 0      | ~120                   |

Every `any` was replaced property by property with the correct type:

- `Record<string, unknown>` for objects with dynamic keys
- Typed interfaces for webhook payloads, API responses, provider data
- `unknown` + type guards for catch clauses and opaque values
- Removed `: any` annotations from `.map()` callbacks (inferred from source)

---

## A5 — Test Backlog

| Classification              | Count | Action                               |
| --------------------------- | ----- | ------------------------------------ |
| CLASS D (conditional skips) | 37    | No change — correct behavior         |
| CLASS C (pending features)  | 73    | Documented in TESTING_BACKLOG.md     |
| CLASS B (needs infra)       | 5     | 4 moved to integration, 1 documented |

- 4 providerRegistry DB tests → `tests/integration/providerRegistry.db.test.ts`
- 1 SSE webhook test → documented as architectural limitation
- All documented in `docs/development/TESTING_BACKLOG.md`

---

## A6 — Unit of Work Expansion

| Metric                   | Before | After    |
| ------------------------ | ------ | -------- |
| Use cases with UoW       | 6      | 56       |
| Mutating use cases total | 56     | 56       |
| Coverage                 | 10.7%  | **100%** |

All 56 mutating use cases now use the Unit of Work pattern with `PrismaUnitOfWork` + `AsyncLocalStorage`. Pattern documented in CLAUDE.md as mandatory for all new mutating use cases.

### Batches Executed

| Batch | Domain                                  | Use Cases | Status |
| ----- | --------------------------------------- | --------- | ------ |
| 1     | TIER 1 (high risk — events)             | 6         | ✅     |
| 2     | Inbox                                   | 4         | ✅     |
| 3     | Campaigns                               | 4         | ✅     |
| 4     | Approvals + Comments                    | 6         | ✅     |
| 5     | Links + Assets                          | 8         | ✅     |
| 6     | Team + Recurring                        | 7         | ✅     |
| 7     | Notifications + FirstComment + External | 6         | ✅     |
| 8     | AI + BrandVoice + Reports + Usage       | 9         | ✅     |

---

## A7 — DevDependency Updates

| Package                          | From   | To     | Major?      |
| -------------------------------- | ------ | ------ | ----------- |
| eslint-plugin-react              | 7.37.2 | 7.37.5 | No          |
| turbo                            | 2.8.20 | 2.8.21 | No          |
| @typescript-eslint/eslint-plugin | 8.44.1 | 8.57.2 | No          |
| @typescript-eslint/parser        | 8.44.1 | 8.57.2 | No          |
| lint-staged                      | 16.2.0 | 16.4.0 | No          |
| loadtest                         | 8.0.9  | 8.2.1  | No          |
| prettier                         | 3.6.2  | 3.8.1  | No          |
| tsx                              | 4.20.5 | 4.21.0 | No          |
| @ast-grep/cli                    | 0.41.0 | 0.42.0 | No          |
| knip                             | 5.85.0 | 6.1.0  | Yes ✅      |
| eslint-plugin-react-hooks        | 5.1.0  | 7.0.1  | Yes ✅      |
| autocannon                       | 7.15.0 | 8.0.0  | Yes ✅      |
| eslint                           | 9.36.0 | 9.36.0 | **Blocked** |
| @eslint/js                       | 9.36.0 | 9.36.0 | **Blocked** |

ESLint 10 blocked by `eslint-plugin-react` incompatibility ([issue #3977](https://github.com/jsx-eslint/eslint-plugin-react/issues/3977)).

---

## Final System State

### Build and Test

| Check             | Result                              |
| ----------------- | ----------------------------------- |
| TypeScript build  | ✅ 0 errors                         |
| ESLint            | ✅ 0 errors, 0 warnings             |
| API unit tests    | ✅ 305 files, 6478 passed, 0 failed |
| Unpinned versions | 0                                   |

### Security

| Severity  | Before | After  |
| --------- | ------ | ------ |
| Critical  | 5      | 2      |
| High      | 33     | 24     |
| Moderate  | 40     | 34     |
| Low       | 10     | 9      |
| **Total** | **88** | **69** |

### Remaining Open Items

| Item                     | Reason                                                      | Next Action                |
| ------------------------ | ----------------------------------------------------------- | -------------------------- |
| ESLint 9→10              | eslint-plugin-react incompatible                            | Wait for plugin update     |
| 2 critical vulns         | xmlhttprequest (jq devDep), handlebars (next.js transitive) | No patch available         |
| 73 describe.todo() tests | Pending features (provider APIs, workers, React hooks)      | Implement when infra ready |
| Cache strategy expansion | 2 direct cache usage points                                 | Separate sprint            |

### Items Confirmed Closed

| Issue                     | Audit Finding | Resolution                        |
| ------------------------- | ------------- | --------------------------------- |
| Auth gaps in 16 routes    | A1            | All 44 routes protected           |
| 88→69 vulnerabilities     | A1            | pnpm overrides for 3 packages     |
| console.\* in production  | A1            | Replaced with Pino logger         |
| Bluesky not registered    | A2            | 10/10 providers registered        |
| Mock data in production   | A2            | Replaced with empty arrays        |
| Regex lastIndex bug       | A2            | Fixed with pattern.lastIndex=0    |
| 0/45 routes with schema   | A3            | 44/45 routes annotated            |
| 451 `any` types           | A4            | 0 in code (4 in comments)         |
| 5 CLASS B tests misplaced | A5            | Moved to integration + documented |
| 6/56 use cases with UoW   | A6            | 56/56 (100%) with UoW             |
| 14 outdated devDeps       | A7            | 12 updated, 2 blocked             |
