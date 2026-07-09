---
title: docs/ Inventory & Classification
description: Auto-generated inventory of all 229 markdown files under docs/. Source of truth for keep/merge/archive/delete decisions.
generated: 2026-05-10
---

# docs/ Inventory & Classification

> 229 files · 23 subdirectories · ~78K lines · generated 2026-05-10.
> Source: `head -25` of each `.md` + `stat` for mtime + topic pass for overlap detection.
> NO source docs were modified.

## Summary

| Tipo        |   Total | ACTIVE | SUPERSEDED |   STALE | DRAFT | INDEX |
| ----------- | ------: | -----: | ---------: | ------: | ----: | ----: |
| audit       |      47 |     19 |          1 |      27 |     0 |     0 |
| report      |      77 |      8 |          0 |      69 |     0 |     0 |
| session-log |      30 |      0 |          0 |      30 |     0 |     0 |
| plan        |      11 |      3 |          2 |       6 |     0 |     0 |
| guide       |      18 |      9 |          0 |       9 |     0 |     0 |
| spec        |      16 |     11 |          0 |       5 |     0 |     0 |
| runbook     |       7 |      5 |          0 |       2 |     0 |     0 |
| changelog   |       9 |      0 |          0 |       9 |     0 |     0 |
| index       |       6 |      5 |          0 |       1 |     0 |     6 |
| inventory   |       3 |      3 |          0 |       0 |     0 |     0 |
| ADR         |       1 |      1 |          0 |       0 |     0 |     0 |
| other       |       4 |      2 |          0 |       2 |     0 |     0 |
| **TOTAL**   | **229** | **66** |      **3** | **160** | **0** | **6** |

**Headline numbers:**

- KEEP: 90 files (canonical guides, specs, current runbooks, active audits, inventories)
- MERGE candidates: 41 files into 14 consolidated targets (~24K lines, ~31% of corpus)
- ARCHIVE: 95 files (historical session logs, sprint/update changelogs, superseded plans)
- DELETE: 3 files (exact-duplicate "ALREADY DONE" reports + 1 INDEX duplicate)

## By directory

### docs/ (root)

| File                        | Tipo  | Estado | Última señal      | Audiencia | Resumen                                                     | Solapamiento                                                   | Recomendación |
| --------------------------- | ----- | ------ | ----------------- | --------- | ----------------------------------------------------------- | -------------------------------------------------------------- | ------------- |
| [docs/README.md](README.md) | index | ACTIVE | mtime: 2026-05-08 | mixed     | OmniPost docs landing page, feature highlights and doc map. | overlaps with: docs/api/README.md, docs/architecture/README.md | KEEP          |

### docs/admin/

| File                                                                                | Tipo  | Estado | Última señal      | Audiencia | Resumen                                                                                                       | Solapamiento                                           | Recomendación                            |
| ----------------------------------------------------------------------------------- | ----- | ------ | ----------------- | --------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| [docs/admin/ACCESSIBILITY_IMPLEMENTATION.md](admin/ACCESSIBILITY_IMPLEMENTATION.md) | guide | ACTIVE | 2025-10-15        | dev       | WCAG 2.1 AA accessibility components implemented in admin app (SkipLink, FocusTrap, aria patterns, contrast). | —                                                      | KEEP                                     |
| [docs/admin/AUTH.md](admin/AUTH.md)                                                 | spec  | STALE  | mtime: 2026-03-08 | dev       | Server Actions + httpOnly cookies + backend JWT auth pattern used by admin app.                               | overlaps with: docs/security/AUTH.md, docs/api/auth.md | MERGE_INTO:docs/security/AUTH.md         |
| docs/admin/dashboard.md                                                             | guide | STALE  | mtime: 2026-03-08 | dev       | Admin dashboard features overview (Next.js 16 / React 19, real-time metrics, TanStack Query, port 3100).      | overlaps with: docs/frontend/admin-portal.md           | MERGE_INTO:docs/frontend/admin-portal.md |

### docs/admin/e2e/

| File                                                                      | Tipo    | Estado | Última señal      | Audiencia | Resumen                                                                             | Solapamiento                                         | Recomendación                       |
| ------------------------------------------------------------------------- | ------- | ------ | ----------------- | --------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------- |
| [docs/admin/e2e/FIRST_RUN_CHECKLIST.md](admin/e2e/FIRST_RUN_CHECKLIST.md) | runbook | ACTIVE | mtime: 2026-05-08 | qa        | First-run checklist for Playwright admin auth E2E (deps, docker, db, env, runtime). | overlaps with: docs/admin/e2e/QUICKSTART.md          | KEEP                                |
| [docs/admin/e2e/QUICKSTART.md](admin/e2e/QUICKSTART.md)                   | guide   | ACTIVE | mtime: 2026-05-08 | qa        | 5-minute quick-start for Playwright admin auth E2E tests.                           | overlaps with: docs/admin/e2e/FIRST_RUN_CHECKLIST.md | KEEP                                |
| [docs/admin/e2e/README.md](admin/e2e/README.md)                           | index   | ACTIVE | mtime: 2026-05-08 | qa        | Admin Playwright E2E auth suite documentation (17 tests, POM, helpers).             | —                                                    | KEEP                                |
| docs/admin/e2e/TEST_STRUCTURE.md                                          | spec    | STALE  | mtime: 2026-03-08 | qa        | Visual diagram of admin E2E test suite directory layout and POM files.              | overlaps with: docs/admin/e2e/README.md              | MERGE_INTO:docs/admin/e2e/README.md |

### docs/api/

| File                                              | Tipo  | Estado | Última señal      | Audiencia | Resumen                                                                                                 | Solapamiento                                                                    | Recomendación                           |
| ------------------------------------------------- | ----- | ------ | ----------------- | --------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| [docs/api/analytics.md](api/analytics.md)         | spec  | ACTIVE | mtime: 2026-04-13 | dev       | Engagement Analytics API reference: routes, services, ROI calc, thread analytics, SSE streaming.        | —                                                                               | KEEP                                    |
| [docs/api/auth.md](api/auth.md)                   | spec  | ACTIVE | mtime: 2026-04-13 | dev       | Auth/Authorization API: admin + customer JWT, MFA TOTP, SAML/OIDC SSO, brute-force, device fingerprint. | overlaps with: docs/security/AUTH.md, docs/admin/AUTH.md                        | KEEP                                    |
| [docs/api/billing.md](api/billing.md)             | spec  | ACTIVE | mtime: 2026-04-14 | dev       | Billing API: GatewayBillingService (Stripe ↔ Paddle switch), subscription lifecycle.                    | overlaps with: docs/reports/SPRINT_B_GATEWAY_SWITCHING_REPORT.md                | KEEP                                    |
| [docs/api/caching.md](api/caching.md)             | guide | ACTIVE | mtime: 2026-05-08 | dev       | Redis-based API response caching: per-endpoint TTLs, invalidation rules, 90%+ latency wins.             | overlaps with: docs/architecture/caching.md                                     | MERGE_INTO:docs/architecture/caching.md |
| [docs/api/compliance.md](api/compliance.md)       | spec  | ACTIVE | mtime: 2026-04-13 | dev       | Compliance API: GDPR/LGPD/CCPA/PIPEDA, DSAR lifecycle, breach reporting, compliance score (11 checks).  | overlaps with: docs/reports/SPRINT_C_COMPLIANCE_REPORT.md                       | KEEP                                    |
| [docs/api/content.md](api/content.md)             | spec  | ACTIVE | mtime: 2026-04-13 | dev       | Content API: post lifecycle (CRUD + schedule), content sync engine, platform-specific adaptation.       | —                                                                               | KEEP                                    |
| docs/api/cqrs.md                                  | guide | ACTIVE | mtime: 2026-04-01 | dev       | CQRS Integration Guide — CommandBus, QueryBus, handlers, saga integration.                              | overlaps with: docs/architecture/README.md (CQRS section)                       | KEEP                                    |
| docs/api/integration-examples.md                  | guide | ACTIVE | mtime: 2026-04-13 | dev       | Developer guide with code examples for API auth, CQRS, sagas, caching, real-time updates.               | —                                                                               | KEEP                                    |
| [docs/api/notifications.md](api/notifications.md) | spec  | ACTIVE | mtime: 2026-04-13 | dev       | Notifications, Inbox, Comments & Approvals API: SSE, social inbox, threaded comments, first-comment.    | —                                                                               | KEEP                                    |
| [docs/api/README.md](api/README.md)               | index | ACTIVE | mtime: 2026-05-08 | dev       | API documentation root: response format (`Result<T,E>`), health endpoints, links to subspecs.           | overlaps with: docs/architecture/API.md                                         | KEEP                                    |
| [docs/api/saga.md](api/saga.md)                   | spec  | ACTIVE | mtime: 2026-04-14 | dev       | Saga Orchestration API: SagaDefinition, SagaManager, post-publishing workflow.                          | overlaps with: docs/api/cqrs.md (saga section)                                  | KEEP                                    |
| [docs/api/social.md](api/social.md)               | spec  | ACTIVE | mtime: 2026-04-13 | dev       | Social platform integrations: provider registry, 11 adapters, capability scoring.                       | overlaps with: docs/architecture/PROVIDERS.md, docs/features/provider-system.md | KEEP                                    |
| [docs/api/webhooks.md](api/webhooks.md)           | spec  | ACTIVE | mtime: 2026-04-13 | dev       | Webhooks API: 8-provider inbound processor, signature verification, DLQ with retry/archival.            | overlaps with: docs/reports/SPRINT_D_DLQ_LIFECYCLE_REPORT.md                    | KEEP                                    |

### docs/architecture/

| File                                                                                        | Tipo  | Estado | Última señal      | Audiencia | Resumen                                                                                                       | Solapamiento                                                                        | Recomendación                        |
| ------------------------------------------------------------------------------------------- | ----- | ------ | ----------------- | --------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| [docs/architecture/API.md](architecture/API.md)                                             | spec  | ACTIVE | mtime: 2026-03-25 | dev       | API architecture overview (Fastify 5, TS 6, Prisma 7, BullMQ, Pino, Prometheus, circuit breaker, rate limit). | overlaps with: docs/api/README.md, docs/architecture/README.md                      | KEEP                                 |
| [docs/architecture/caching.md](architecture/caching.md)                                     | guide | ACTIVE | mtime: 2026-05-07 | dev       | Single source of truth: rationale behind CachePort + Redis/InMemory adapters; OWASP A07 motivation.           | overlaps with: docs/api/caching.md                                                  | KEEP                                 |
| [docs/architecture/CLIENT-APP.md](architecture/CLIENT-APP.md)                               | spec  | ACTIVE | mtime: 2026-03-25 | dev       | Client app architecture overview (Next.js 16, React 19, TanStack Query, port 3200).                           | overlaps with: docs/frontend/client-portal.md                                       | KEEP                                 |
| [docs/architecture/DATABASE.md](architecture/DATABASE.md)                                   | spec  | ACTIVE | mtime: 2026-05-08 | dev       | Postgres schema overview, ERD, Prisma 7.5, tables, relationships.                                             | overlaps with: docs/architecture/schema-conventions.md                              | KEEP                                 |
| [docs/architecture/db-performance-monitoring.md](architecture/db-performance-monitoring.md) | guide | ACTIVE | mtime: 2026-05-08 | ops       | DB performance monitoring & KPIs for Instagram features (query latency, index hits, buffer cache).            | overlaps with: docs/architecture/instagram-schema.md                                | KEEP                                 |
| docs/architecture/instagram-schema.md                                                       | spec  | ACTIVE | mtime: 2026-05-07 | dev       | Instagram-specific Prisma schema extensions (Stories, Reels) with multi-tenant isolation + perf indexes.      | overlaps with: docs/architecture/db-performance-monitoring.md                       | KEEP                                 |
| [docs/architecture/logging.md](architecture/logging.md)                                     | guide | ACTIVE | mtime: 2026-05-07 | dev       | Single source of truth on logger factories (apps/api + packages + browser + workers); redaction policy.       | —                                                                                   | KEEP                                 |
| [docs/architecture/observability.md](architecture/observability.md)                         | spec  | ACTIVE | mtime: 2026-05-08 | ops       | OTel + Jaeger + Prometheus + Grafana implementation for end-to-end observability across services.             | —                                                                                   | KEEP                                 |
| [docs/architecture/PROVIDERS.md](architecture/PROVIDERS.md)                                 | spec  | ACTIVE | mtime: 2026-05-08 | dev       | ProviderAdapter ports & adapters pattern, PlatformLimits, capability interface.                               | overlaps with: docs/features/provider-system.md, docs/api/social.md                 | KEEP                                 |
| [docs/architecture/README.md](architecture/README.md)                                       | index | ACTIVE | mtime: 2026-05-08 | dev       | Hexagonal + DDD + CQRS + Event-driven + Saga reference overview with diagrams.                                | overlaps with: docs/architecture/API.md                                             | KEEP                                 |
| [docs/architecture/schema-conventions.md](architecture/schema-conventions.md)               | guide | ACTIVE | mtime: 2026-05-07 | dev       | Prisma schema conventions (Decimal precision, composite NULL uniques, migration safety).                      | overlaps with: docs/architecture/DATABASE.md                                        | KEEP                                 |
| [docs/architecture/secrets-and-env.md](architecture/secrets-and-env.md)                     | guide | ACTIVE | mtime: 2026-05-08 | security  | Env / secret loader threat model + Zod fail-fast schema across apps/api / admin / client.                     | overlaps with: docs/security/SECRETS.md                                             | KEEP                                 |
| [docs/architecture/SECURITY.md](architecture/SECURITY.md)                                   | spec  | STALE  | mtime: 2026-03-08 | security  | Defense-in-depth overview (JWT, MFA, RBAC, session mgmt, audit).                                              | overlaps with: docs/security/OVERVIEW.md, docs/security/AUTH.md                     | MERGE_INTO:docs/security/OVERVIEW.md |
| [docs/architecture/TESTING.md](architecture/TESTING.md)                                     | spec  | ACTIVE | mtime: 2026-05-08 | qa        | Testing strategy: node:test + Vitest + Playwright + Stryker; coverage targets; mock factory patterns.         | overlaps with: docs/development/SMOKE_TESTS.md, docs/development/testing-backlog.md | KEEP                                 |
| docs/architecture/turborepo-future-flags-evaluation.md                                      | ADR   | ACTIVE | 2026-05-06        | dev       | Evaluation of Turborepo 2.x future flags (globalConfiguration, filterUsingTasks, OTEL); adopt/later/no.       | overlaps with: docs/development/turborepo.md                                        | KEEP                                 |

### docs/audits/

| File                                                          | Tipo      | Estado     | Última señal | Audiencia | Resumen                                                                                                                                 | Solapamiento                                                                               | Recomendación |
| ------------------------------------------------------------- | --------- | ---------- | ------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------- |
| docs/audits/CLAUDE_ALTERNATE_PLAN.md                          | plan      | SUPERSEDED | 2026-04-21   | dev       | Tier-by-complexity plan for 647 lateral findings; absorbed by REMEDIATION_ROADMAP.md v2.                                                | overlaps with: docs/audits/REMEDIATION_BATCHES.v1.md, docs/audits/REMEDIATION_ROADMAP.md   | ARCHIVE       |
| docs/audits/CLIENT_LIB_HOOKS_AUDIT.md                         | audit     | ACTIVE     | 2026-04-17   | dev       | Audit of apps/client/lib/hooks/: classify 5 hooks as LEGACY_WORKING/BROKEN_URLS; living doc.                                            | overlaps with: docs/audits/ENDPOINT_AUDIT.md                                               | KEEP          |
| docs/audits/D0_INVENTORY.md                                   | inventory | ACTIVE     | 2026-04-18   | dev       | D0 master inventory of 471 backend endpoints + classification; living doc replacing contaminated baseline.                              | overlaps with: docs/audits/ENDPOINT_AUDIT.md                                               | KEEP          |
| docs/audits/D0v4_0_RENAME_REPORT.md                           | report    | STALE      | 2026-04-18   | dev       | D0v4-0 rename sprint: standardized 141 endpoints to no-`/api/`-prefix; 30 backend + 18 frontend files modified.                         | overlaps with: docs/audits/PLAN_MAESTRO.md                                                 | ARCHIVE       |
| docs/audits/D0v4_1_BACKEND_SERVICES_REPORT.md                 | audit     | STALE      | 2026-04-20   | dev       | D0v4-1 backend services/use cases/repositories audit. 0 code changes; living doc.                                                       | overlaps with: docs/audits/PLAN_MAESTRO.md, docs/audits/LATERAL_FINDINGS.md                | ARCHIVE       |
| docs/audits/D0v4_2_MIDDLEWARES_DI_INFRA_REPORT.md             | audit     | STALE      | 2026-04-20   | dev       | D0v4-2 backend middlewares/DI container/infra audit; classification scheme ACTIVE/PARTIALLY_ACTIVE/INFRASTRUCTURE_READY/PLANNED/LEGACY. | overlaps with: docs/audits/PLAN_MAESTRO.md                                                 | ARCHIVE       |
| docs/audits/D0v4_3_WORKERS_REPORT.md                          | audit     | STALE      | 2026-04-20   | dev       | D0v4-3 workers (BullMQ jobs, adapters, idempotence, retries) audit.                                                                     | overlaps with: docs/audits/PLAN_MAESTRO.md                                                 | ARCHIVE       |
| docs/audits/D0v4_4_FRONTEND_CLIENT_PAGES_COMPONENTS_REPORT.md | audit     | STALE      | 2026-04-20   | dev       | D0v4-4 client frontend pages/layouts/components audit (249 files, 5 batches).                                                           | overlaps with: docs/audits/PLAN_MAESTRO.md                                                 | ARCHIVE       |
| docs/audits/D0v4_5_FRONTEND_CLIENT_HOOKS_REPORT.md            | audit     | STALE      | 2026-04-20   | dev       | D0v4-5 client hooks consolidation audit + TanStack v5 R1-R13 compliance.                                                                | overlaps with: docs/audits/CLIENT_LIB_HOOKS_AUDIT.md                                       | ARCHIVE       |
| docs/audits/D0v4_6_FRONTEND_ADMIN_REPORT.md                   | audit     | STALE      | 2026-04-20   | dev       | D0v4-6 admin frontend full audit (141 files).                                                                                           | overlaps with: docs/audits/PLAN_MAESTRO.md                                                 | ARCHIVE       |
| docs/audits/D0v4_7_PACKAGES_REPORT.md                         | audit     | STALE      | 2026-04-20   | dev       | D0v4-7 packages/\* full audit (36 packages, 309 files, 88,970 LOC).                                                                     | overlaps with: docs/audits/PLAN_MAESTRO.md                                                 | ARCHIVE       |
| docs/audits/D0v4_8_INFRASTRUCTURE_REPORT.md                   | audit     | STALE      | 2026-04-20   | dev       | D0v4-8 infrastructure audit (Prisma schema, migrations, configs, CI, Docker, fitness funcs); CLOSES D0-v4 tramo.                        | overlaps with: docs/audits/PLAN_MAESTRO.md                                                 | ARCHIVE       |
| docs/audits/D0_v4_PILOT_BACKEND_ROUTES.md                     | audit     | STALE      | 2026-04-18   | dev       | D0-v4 pilot: direct line-by-line read of 69 backend route files, 471 endpoints.                                                         | overlaps with: docs/audits/ENDPOINT_AUDIT.md, docs/audits/D0_INVENTORY.md                  | ARCHIVE       |
| docs/audits/D1_DECISIONS.md                                   | audit     | ACTIVE     | 2026-04-18   | mixed     | D1 endpoint ↔ UI mapping final decisions: 42 BUILD_UI, 10 DELETE, 40 KEEP_AS_INTERNAL, 12 RECLASSIFY_TO_PLANNED.                        | overlaps with: docs/audits/ENDPOINT_AUDIT.md                                               | KEEP          |
| docs/audits/ENDPOINT_AUDIT.md                                 | audit     | ACTIVE     | 2026-04-18   | dev       | Endpoint ↔ UI mapping audit v2 (471 endpoints classified CONSUMED/ORPHAN/PATH_MISMATCH); living doc.                                    | overlaps with: docs/audits/D0_INVENTORY.md, docs/audits/D1_DECISIONS.md                    | KEEP          |
| docs/audits/horizontal-v1/A1-apps-client-orphan-sweep.md      | audit     | ACTIVE     | 2026-05-08   | dev       | Horizontal audits workstream — A.1 client orphan sweep (344 files; trivial deletes in same PR).                                         | —                                                                                          | KEEP          |
| docs/audits/LATERAL_FINDINGS.md                               | inventory | ACTIVE     | 2026-05-08   | dev       | Master register of 647 lateral findings (L-1..L-647) discovered during D0 audit tramo; living doc.                                      | overlaps with: docs/audits/REMEDIATION_ROADMAP.md                                          | KEEP          |
| docs/audits/PLAN_MAESTRO.md                                   | plan      | ACTIVE     | 2026-04-21   | dev       | Master audit plan: 8 dimensions, criteria objective, deliverable per dimension; living guide for entire D0 tramo.                       | overlaps with: docs/audits/REMEDIATION_ROADMAP.md                                          | KEEP          |
| docs/audits/POST_REMEDIATION_BACKLOG.md                       | inventory | ACTIVE     | 2026-05-09   | dev       | Post-remediation backlog tracking 56+ palliative fixes (PR-1..PR-56) applied during roadmap execution.                                  | overlaps with: docs/audits/REMEDIATION_ROADMAP.md                                          | KEEP          |
| docs/audits/PRE_D2_ENDPOINT_CALIBRATION.md                    | audit     | STALE      | 2026-04-18   | dev       | PRE-D2 endpoint inventory delta after 16 commits post-D0v2; calibrates universe before D2.                                              | overlaps with: docs/audits/D0_INVENTORY.md                                                 | ARCHIVE       |
| docs/audits/REMEDIATION_BATCHES.v1.md                         | plan      | SUPERSEDED | 2026-04-21   | dev       | v1 plan mapping 647 findings to 11 batches B0..B10; explicitly self-declared SUPERSEDED by ROADMAP.md.                                  | overlaps with: docs/audits/REMEDIATION_ROADMAP.md, docs/audits/CLAUDE_ALTERNATE_PLAN.md    | ARCHIVE       |
| docs/audits/REMEDIATION_ROADMAP.md                            | plan      | ACTIVE     | 2026-04-21   | dev       | v2.1 hybrid roadmap — 647 findings in T0..T6 tiers with micro-batches; replaces v1 + CLAUDE_ALTERNATE_PLAN; THE working plan.           | overlaps with: docs/audits/REMEDIATION_BATCHES.v1.md, docs/audits/CLAUDE_ALTERNATE_PLAN.md | KEEP          |
| docs/audits/T5_T6_PARALLELIZATION_DECISION.md                 | plan      | ACTIVE     | 2026-05-06   | dev       | Analysis & recommendation: parallel Wave 1 of T5/T6 batches (T5-A, T5-C, T5-D, T5-G).                                                   | overlaps with: docs/audits/REMEDIATION_ROADMAP.md                                          | KEEP          |

### docs/client/

| File                                          | Tipo  | Estado | Última señal      | Audiencia | Resumen                                                                                                  | Solapamiento                                        | Recomendación                                   |
| --------------------------------------------- | ----- | ------ | ----------------- | --------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| [docs/client/editor.md](client/editor.md)     | spec  | STALE  | mtime: 2026-03-08 | dev       | Universal Content Editor (TipTap 3.6, multi-platform previews, scheduling, auto-save).                   | —                                                   | KEEP                                            |
| [docs/client/react-19.md](client/react-19.md) | guide | STALE  | mtime: 2026-02-28 | dev       | React 19 concurrent rendering features (automatic batching, transitions, deferredValue) examples in app. | overlaps with: docs/standards/frontend-standards.md | MERGE_INTO:docs/standards/frontend-standards.md |

### docs/client/e2e/

| File                                              | Tipo  | Estado | Última señal      | Audiencia | Resumen                                                                                     | Solapamiento                            | Recomendación |
| ------------------------------------------------- | ----- | ------ | ----------------- | --------- | ------------------------------------------------------------------------------------------- | --------------------------------------- | ------------- |
| [docs/client/e2e/README.md](client/e2e/README.md) | index | ACTIVE | mtime: 2026-05-08 | qa        | Client app Playwright E2E framework (multi-browser, a11y axe-core, visual regression, POM). | overlaps with: docs/admin/e2e/README.md | KEEP          |

### docs/deployment/

| File                                                                            | Tipo    | Estado | Última señal      | Audiencia | Resumen                                                                                   | Solapamiento                                                                  | Recomendación |
| ------------------------------------------------------------------------------- | ------- | ------ | ----------------- | --------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------- |
| docs/deployment/AWS.md                                                          | runbook | ACTIVE | mtime: 2026-03-27 | ops       | Production AWS deploy guide (Route 53, CloudFront, ALB, S3, ECS/EKS, RDS).                | overlaps with: docs/deployment/AZURE.md, docs/deployment/GCP.md               | KEEP          |
| docs/deployment/AZURE.md                                                        | runbook | ACTIVE | mtime: 2026-03-27 | ops       | Production Azure deploy (DNS, Front Door, App Service, Blob Storage).                     | overlaps with: docs/deployment/AWS.md, docs/deployment/GCP.md                 | KEEP          |
| docs/deployment/DIGITALOCEAN.md                                                 | runbook | ACTIVE | mtime: 2026-05-08 | ops       | Cost-effective DigitalOcean deploy (Droplet, Nginx, Spaces, recommended for early stage). | overlaps with: docs/deployment/AWS.md                                         | KEEP          |
| [docs/deployment/ENVIRONMENT_VARIABLES.md](deployment/ENVIRONMENT_VARIABLES.md) | spec    | ACTIVE | mtime: 2026-03-27 | ops       | Complete reference of every env var (required, default, per target).                      | overlaps with: docs/architecture/secrets-and-env.md, docs/security/SECRETS.md | KEEP          |
| docs/deployment/GCP.md                                                          | runbook | ACTIVE | mtime: 2026-03-27 | ops       | GCP deploy (Cloud DNS, Cloud CDN, Cloud Run, Cloud Storage).                              | overlaps with: docs/deployment/AWS.md, docs/deployment/AZURE.md               | KEEP          |
| [docs/deployment/LOCAL.md](deployment/LOCAL.md)                                 | runbook | ACTIVE | mtime: 2026-05-08 | dev       | Local dev setup (Docker, Node 24, pnpm 10.16, ffmpeg) with prerequisite versions.         | overlaps with: docs/development/getting-started.md                            | KEEP          |

### docs/development/

| File                                                                                                  | Tipo        | Estado | Última señal      | Audiencia | Resumen                                                                                                                      | Solapamiento                                                                     | Recomendación |
| ----------------------------------------------------------------------------------------------------- | ----------- | ------ | ----------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------- |
| docs/development/ACCOUNT_IMPROVEMENTS_REPORT.md                                                       | report      | STALE  | 2026-04-04        | dev       | Admin: Switch plan, grandfathering extend/reduce, provider add/remove, trial days remaining UI work.                         | overlaps with: docs/development/ADMIN\_\*\_REPORT.md (multiple)                  | ARCHIVE       |
| docs/development/ADMIN_BILLING_FIX_REPORT.md                                                          | report      | STALE  | 2026-04-02        | dev       | Admin billing fix: suspend account on Account table (not AdminUser), new PUT /status route, audit log.                       | overlaps with: docs/development/ADMIN\_\*\_REPORT.md                             | ARCHIVE       |
| docs/development/ADMIN_BUGS_I18N_REPORT.md                                                            | report      | STALE  | 2026-04-05        | dev       | Admin bug-fix + next-intl migration (3 bugs, custom i18n → next-intl 4.9).                                                   | overlaps with: docs/development/ADMIN\_\*\_REPORT.md                             | ARCHIVE       |
| docs/development/ADMIN_CLEANUP_REPORT.md                                                              | report      | STALE  | 2026-04-02        | dev       | Admin legacy cleanup: deleted apps/admin/app/page.tsx + cleaned root layout; route-group conflict.                           | overlaps with: docs/development/ADMIN\_\*\_REPORT.md                             | ARCHIVE       |
| docs/development/ADMIN_CODE_QUALITY_REPORT.md                                                         | report      | STALE  | 2026-04-03        | dev       | Admin code-quality audit (46 issues across design system, a11y, TS strict, data fetching, error handling, components, perf). | overlaps with: docs/development/ADMIN_UI_AUDIT_REPORT.md                         | ARCHIVE       |
| docs/development/ADMIN_COMPLETE_FIX_REPORT.md                                                         | report      | STALE  | 2026-04-06        | dev       | Admin complete fix report (5 backend + multiple frontend, MRR calc, subscription hooks).                                     | overlaps with: docs/development/ADMIN\_\*\_REPORT.md                             | ARCHIVE       |
| docs/development/ADMIN_FIX_REPORT.md                                                                  | report      | STALE  | 2026-04-04        | dev       | Admin fix report: P0 token refresh, settings 404, analytics 404, native modals, test suite.                                  | overlaps with: docs/development/ADMIN\_\*\_REPORT.md                             | ARCHIVE       |
| docs/development/ADMIN_GROUP1_REPORT.md                                                               | report      | STALE  | 2026-04-04        | dev       | Admin Group 1 fixes: trial bug, provider/account tier CRUD, AdminUser CRUD, RBAC, MFA self-service.                          | overlaps with: docs/development/ADMIN\_\*\_REPORT.md                             | ARCHIVE       |
| docs/development/ADMIN_GROUP2_REPORT.md                                                               | report      | STALE  | 2026-04-05        | dev       | Admin Group 2: test seed data (11 accounts, 6 subscription statuses) + dual Postgres fix.                                    | overlaps with: docs/development/ADMIN\_\*\_REPORT.md                             | ARCHIVE       |
| docs/development/ADMIN_INVESTIGATION_REPORT.md                                                        | report      | STALE  | 2026-04-04        | dev       | Admin investigation of 14 issues found during manual testing (read-only, zero code change).                                  | overlaps with: docs/development/ADMIN\_\*\_REPORT.md                             | ARCHIVE       |
| docs/development/ADMIN_RECOVERY_REPORT.md                                                             | report      | STALE  | 2026-04-06        | dev       | Admin recovery report: logout, role/user display, accounts CRUD, subscriptions, pricing CRUD post-incident.                  | overlaps with: docs/development/POST*INCIDENT*\*                                 | ARCHIVE       |
| docs/development/ADMIN_REDESIGN_REPORT.md                                                             | report      | STALE  | 2026-04-02        | dev       | Admin UI redesign: design system, Geist fonts, dual dark/light theme, 6 custom components built.                             | overlaps with: docs/development/ADMIN_UI_AUDIT_REPORT.md                         | ARCHIVE       |
| docs/development/ADMIN_REMAINING_FIX_REPORT.md                                                        | report      | STALE  | 2026-04-04        | dev       | Admin remaining fixes: grandfathering test data, bundle POST/DELETE, change-plan dialog.                                     | overlaps with: docs/development/ADMIN\_\*\_REPORT.md                             | ARCHIVE       |
| docs/development/ADMIN_SESSION_FULL_REPORT.md                                                         | session-log | STALE  | 2026-04-05        | dev       | Multi-day admin portal session: investigation, bugs, features, UI audit, code quality, i18n, data-loss incident recovery.    | overlaps with: ALL docs/development/ADMIN\_\*\_REPORT.md                         | ARCHIVE       |
| docs/development/ADMIN_SPRINT2_REPORT.md                                                              | report      | STALE  | 2026-04-10        | dev       | Admin Sprint 2 report verifying all features already implemented (S1–S7).                                                    | overlaps with: docs/development/ADMIN\_\*\_REPORT.md                             | DELETE        |
| [docs/development/ADMIN_TO_CLIENT_MIGRATION_GUIDE.md](development/ADMIN_TO_CLIENT_MIGRATION_GUIDE.md) | guide       | ACTIVE | mtime: 2026-05-08 | dev       | Mapping 10+ admin fixes to equivalent work needed in apps/client (Decimal wrap, AccessDenied, tw-animate-css, etc.).         | overlaps with: docs/audits/D0v4_4_FRONTEND_CLIENT_PAGES_COMPONENTS_REPORT.md     | KEEP          |
| docs/development/ADMIN_UI_AUDIT_REPORT.md                                                             | audit       | STALE  | 2026-04-03        | dev       | Admin UI audit: 47 issues across 5 severity levels, design tokens, PageHeader adoption, native dialogs removed.              | overlaps with: docs/development/ADMIN_CODE_QUALITY_REPORT.md                     | ARCHIVE       |
| docs/development/BILLING_COMPLIANCE_WEBHOOKS_DLQ_AUDIT.md                                             | audit       | STALE  | 2026-04-10        | dev       | Read-only audit of billing/compliance/webhooks/DLQ (6 billing models, GDPR enums, DLQ stats).                                | overlaps with: docs/api/billing.md, docs/api/compliance.md, docs/api/webhooks.md | ARCHIVE       |
| docs/development/CHANGEPLAN_DIALOG_INVESTIGATION.md                                                   | report      | STALE  | 2026-04-04        | dev       | Root cause of frozen ChangePlanDialog: missing `tw-animate-css` + Tailwind v4 source scanner bug on `bg-black/80`.           | overlaps with: docs/development/ADMIN_TO_CLIENT_MIGRATION_GUIDE.md               | ARCHIVE       |
| [docs/development/CLIENT_BACKLOG.md](development/CLIENT_BACKLOG.md)                                   | inventory   | STALE  | 2026-04-10        | dev       | Client app feature backlog (e.g. publishing queue monitor P1) deferred during code-first audit.                              | overlaps with: docs/reports/planning/next-sprint-backlog.md                      | KEEP          |
| [docs/development/contributing.md](development/contributing.md)                                       | guide       | ACTIVE | mtime: 2026-05-08 | dev       | Contributor setup: clone, install, docker, migrations, dev commands.                                                         | overlaps with: docs/development/getting-started.md                               | KEEP          |
| [docs/development/ENV_BACKUP.md](development/ENV_BACKUP.md)                                           | runbook     | ACTIVE | mtime: 2026-05-08 | ops       | `.env` backup/restore runbook after 2026-05-08 incident (lost root .env): gpg, secret-manager, manual options.               | overlaps with: docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md                     | KEEP          |
| [docs/development/getting-started.md](development/getting-started.md)                                 | guide       | ACTIVE | mtime: 2026-05-08 | dev       | Prerequisites + clone + install + Docker + env + migrate + dev quickstart.                                                   | overlaps with: docs/development/contributing.md, docs/deployment/LOCAL.md        | KEEP          |
| docs/development/POST_INCIDENT_DIAGNOSTIC.md                                                          | report      | STALE  | 2026-04-06        | dev       | Post-incident diagnostic: 15 areas classified CLEAN/CONTAMINATED after a data-loss event.                                    | overlaps with: docs/development/POST_INCIDENT_FIX_REPORT.md                      | ARCHIVE       |
| docs/development/POST_INCIDENT_FIX_REPORT.md                                                          | report      | STALE  | 2026-04-06        | dev       | Post-incident fixes: removed ProjectProvider, inbox/unread fetch, webhook design system migration.                           | overlaps with: docs/development/POST_INCIDENT_DIAGNOSTIC.md                      | ARCHIVE       |
| docs/development/SMOKE_TESTS.md                                                                       | guide       | ACTIVE | mtime: 2026-05-10 | qa        | Smoke E2E test suite (apps/api node:test, workers, admin & client Playwright); GH Actions integration.                       | overlaps with: docs/architecture/TESTING.md                                      | KEEP          |
| [docs/development/testing-backlog.md](development/testing-backlog.md)                                 | inventory   | STALE  | 2026-03-28        | qa        | Testing backlog: P1/P2/P3 items, 103 .todo() integration tests pending, E2E suites, mutation gaps.                           | overlaps with: docs/development/SMOKE_TESTS.md, docs/architecture/TESTING.md     | KEEP          |
| [docs/development/turborepo.md](development/turborepo.md)                                             | guide       | STALE  | mtime: 2026-03-04 | dev       | Turborepo overview: caching, filtered commands, build orchestration.                                                         | overlaps with: docs/architecture/turborepo-future-flags-evaluation.md            | KEEP          |

### docs/features/

| File                                                                        | Tipo      | Estado | Última señal      | Audiencia | Resumen                                                                                                         | Solapamiento                                                              | Recomendación                             |
| --------------------------------------------------------------------------- | --------- | ------ | ----------------- | --------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| [docs/features/advanced-analytics.md](features/advanced-analytics.md)       | spec      | STALE  | mtime: 2026-03-08 | dev       | Advanced analytics integration: cross-platform engine, rule-based prediction, ROI calc, business intel.         | overlaps with: docs/api/analytics.md, docs/features/analytics.md          | MERGE_INTO:docs/api/analytics.md          |
| [docs/features/analytics.md](features/analytics.md)                         | spec      | STALE  | mtime: 2026-03-09 | dev       | Phase 3 analytics features: campaign tagging, UTM/GA4, historical aggregation, exports, scheduled reports.      | overlaps with: docs/api/analytics.md, docs/features/advanced-analytics.md | MERGE_INTO:docs/api/analytics.md          |
| [docs/features/platform-expansion.md](features/platform-expansion.md)       | spec      | STALE  | mtime: 2026-03-09 | dev       | Phase 4: 4 new providers (Snapchat, Telegram, Pinterest, LinkedIn) + Slack/Teams + AI image + recurring posts.  | overlaps with: docs/features/provider-system.md, docs/api/social.md       | KEEP                                      |
| [docs/features/provider-capabilities.md](features/provider-capabilities.md) | inventory | STALE  | 2026-03-27        | dev       | Provider capabilities matrix for 10 providers (publish, schedule, analytics, comments, threading, media types). | overlaps with: docs/architecture/PROVIDERS.md, docs/api/social.md         | KEEP                                      |
| [docs/features/provider-system.md](features/provider-system.md)             | spec      | STALE  | mtime: 2026-02-28 | dev       | Provider System architecture: ports & adapters pattern, ProviderAdapter interface, key components.              | overlaps with: docs/architecture/PROVIDERS.md, docs/api/social.md         | MERGE_INTO:docs/architecture/PROVIDERS.md |
| [docs/features/social-inbox.md](features/social-inbox.md)                   | spec      | STALE  | mtime: 2026-03-06 | dev       | Phase 2 social inbox MVP: SocialMessageAggregate, conversation grouping, replies, status state machine.         | overlaps with: docs/api/notifications.md                                  | KEEP                                      |
| [docs/features/team-workflows.md](features/team-workflows.md)               | spec      | STALE  | mtime: 2026-03-05 | dev       | Phase 1 team workflows: TeamMember, ProjectMember, Notification, ApprovalRequest, PostComment data models.      | overlaps with: docs/api/notifications.md                                  | KEEP                                      |
| [docs/features/templates.md](features/templates.md)                         | spec      | ACTIVE | mtime: 2026-05-07 | dev       | Enhanced template system: Handlebars, A/B testing, version control, Monaco editor, perf analytics.              | —                                                                         | KEEP                                      |

### docs/frontend/

| File                                                        | Tipo | Estado | Última señal      | Audiencia | Resumen                                                                                                                      | Solapamiento                                                            | Recomendación |
| ----------------------------------------------------------- | ---- | ------ | ----------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------- |
| [docs/frontend/admin-portal.md](frontend/admin-portal.md)   | spec | ACTIVE | mtime: 2026-04-13 | dev       | Admin portal API reference: pages, components, hooks (TanStack Query), RBAC, AccessDenied, i18n next-intl.                   | overlaps with: docs/admin/dashboard.md, docs/architecture/CLIENT-APP.md | KEEP          |
| [docs/frontend/client-portal.md](frontend/client-portal.md) | spec | ACTIVE | mtime: 2026-04-13 | dev       | Client portal API reference: pages (33), composer, scheduler, inbox, analytics, AI, templates, settings, Instagram features. | overlaps with: docs/architecture/CLIENT-APP.md                          | KEEP          |

### docs/product/

| File                                                    | Tipo | Estado | Última señal      | Audiencia | Resumen                                                                                            | Solapamiento                                | Recomendación |
| ------------------------------------------------------- | ---- | ------ | ----------------- | --------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------- |
| [docs/product/INVESTOR_EN.md](product/INVESTOR_EN.md)   | spec | ACTIVE | mtime: 2026-05-08 | product   | Investor brief (English): market, product, AI moat, autonomous features, business model, GTM.      | overlaps with: docs/product/INVESTOR_ES.md  | KEEP          |
| [docs/product/INVESTOR_ES.md](product/INVESTOR_ES.md)   | spec | ACTIVE | mtime: 2026-05-08 | product   | Brief para inversionistas (Español): mercado, producto, IA, modelo de negocio, GTM.                | overlaps with: docs/product/INVESTOR_EN.md  | KEEP          |
| [docs/product/MARKETING_EN.md](product/MARKETING_EN.md) | spec | ACTIVE | mtime: 2026-03-27 | product   | Marketing brief (English): composer, scheduling, AI Brand Voice, social inbox, analytics, pricing. | overlaps with: docs/product/MARKETING_ES.md | KEEP          |
| [docs/product/MARKETING_ES.md](product/MARKETING_ES.md) | spec | ACTIVE | mtime: 2026-03-27 | product   | Brief de marketing (Español): compositor, programación, voz de marca AI, inbox social, analytics.  | overlaps with: docs/product/MARKETING_EN.md | KEEP          |

### docs/reports/

| File                                                    | Tipo   | Estado | Última señal | Audiencia | Resumen                                                                                                          | Solapamiento                                                                                   | Recomendación |
| ------------------------------------------------------- | ------ | ------ | ------------ | --------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------- |
| docs/reports/audit-universal-saas-features.md           | audit  | STALE  | 2026-04-14   | dev       | Audit of universal SaaS features (sessions, user mgmt, billing, RBAC) vs. industry-standard expectations.        | overlaps with: docs/reports/audits/\*                                                          | ARCHIVE       |
| docs/reports/RBAC_ERROR_HANDLING_REPORT.md              | report | STALE  | 2026-04-09   | dev       | RBAC error handling: ApiError class, AccessDenied component, 10 admin pages updated.                             | overlaps with: docs/reports/RBAC_PERMISSION_CLEANUP_REPORT.md, docs/reports/SPRINT_3_REPORT.md | ARCHIVE       |
| docs/reports/RBAC_PERMISSION_CLEANUP_REPORT.md          | report | STALE  | 2026-04-09   | dev       | RBAC permissions cleanup: 27 decorative permissions replaced with 16 real ones; 70 routes migrated.              | overlaps with: docs/reports/RBAC_ERROR_HANDLING_REPORT.md                                      | ARCHIVE       |
| docs/reports/SPRINT_3_REPORT.md                         | report | STALE  | 2026-04-09   | dev       | Sprint 3 admin portal report: DB-driven RBAC migration from hardcoded enum to Role/RolePermission tables.        | overlaps with: docs/reports/RBAC\_\*\_REPORT.md                                                | ARCHIVE       |
| docs/reports/SPRINT_A_DLQ_RETRY_ALL_REPORT.md           | report | STALE  | 2026-04-10   | dev       | Sprint A DLQ retry-all bug investigation: endpoint already implemented in 3 layers.                              | overlaps with: docs/reports/SPRINT_D_DLQ_LIFECYCLE_REPORT.md                                   | ARCHIVE       |
| docs/reports/SPRINT_AI_ARCH_REPORT.md                   | report | STALE  | 2026-04-14   | dev       | Sprint AI-ARCH: refactor AI service for BYOK + pool rate limiting, add Anthropic provider, remove singleton.     | overlaps with: docs/reports/SPRINT*SETTINGS*\*\_REPORT.md                                      | ARCHIVE       |
| docs/reports/SPRINT_B2_WEBHOOK_CHECKOUT_REPORT.md       | report | STALE  | 2026-04-11   | dev       | Sprint B.2: wire GatewayBillingService to Stripe/Paddle webhooks + client checkout flow.                         | overlaps with: docs/reports/SPRINT_B_GATEWAY_SWITCHING_REPORT.md                               | ARCHIVE       |
| docs/reports/SPRINT_B3_SURGICAL_FIXES_REPORT.md         | report | STALE  | 2026-04-11   | dev       | Sprint B.3: remove hardcoded billing fallback + webhook event deduplication.                                     | overlaps with: docs/reports/SPRINT_B_GATEWAY_SWITCHING_REPORT.md                               | ARCHIVE       |
| docs/reports/SPRINT_B_GATEWAY_SWITCHING_REPORT.md       | report | STALE  | 2026-04-10   | dev       | Sprint B: Stripe↔Paddle gateway switching with managed lifecycle, GatewayAdapterRegistry pattern.                | overlaps with: docs/api/billing.md                                                             | ARCHIVE       |
| docs/reports/sprint-billing-v2.md                       | report | STALE  | 2026-04-17   | dev       | Sprint BILLING-V2: dunning handler, Invoice model + API, cancellation email; closes 3 billing gaps.              | overlaps with: docs/api/billing.md                                                             | ARCHIVE       |
| docs/reports/SPRINT_C_COMPLIANCE_REPORT.md              | report | STALE  | 2026-04-11   | dev       | Sprint C: GDPR/LGPD/CCPA/PIPEDA compliance infra — 5 enums + 5 models + DSAR/breach/retention/score.             | overlaps with: docs/api/compliance.md                                                          | ARCHIVE       |
| docs/reports/SPRINT_CRYPTO_REPORT.md                    | report | STALE  | 2026-04-13   | dev       | Sprint CRYPTO: PlatformCredential + AccountCredential schema + EncryptionService (AES-256-GCM).                  | overlaps with: docs/security/SECRETS_DATABASE_INVENTORY.md, docs/security/SECRETS.md           | ARCHIVE       |
| docs/reports/SPRINT_D_DLQ_LIFECYCLE_REPORT.md           | report | STALE  | 2026-04-11   | dev       | Sprint D: OutboxEvent DLQ + WebhookDeadLetter archival/retention + admin dashboard metrics.                      | overlaps with: docs/api/webhooks.md                                                            | ARCHIVE       |
| docs/reports/SPRINT_DI2_PROCESSOR_WIRING_REPORT.md      | report | STALE  | 2026-04-11   | dev       | Sprint DI.2: wire GatewaySwitchProcessor BullMQ worker into server startup.                                      | overlaps with: docs/reports/SPRINT_B_GATEWAY_SWITCHING_REPORT.md                               | ARCHIVE       |
| docs/reports/SPRINT_DI_INJECTION_REFACTOR_REPORT.md     | report | STALE  | 2026-04-11   | dev       | Sprint DI: refactor 4 services + 3 routes from module-level prisma import to constructor injection.              | —                                                                                              | ARCHIVE       |
| docs/reports/SPRINT_JSDOC_G1_REPORT.md                  | report | STALE  | 2026-04-12   | dev       | Sprint JSDoc G1: domain layer — 40 files received @file headers, 7 cleaned of phase/migration refs.              | overlaps with: docs/reports/SPRINT_JSDOC_G2/G3/G4/P2_REPORT.md                                 | ARCHIVE       |
| docs/reports/SPRINT_JSDOC_G2_REPORT.md                  | report | STALE  | 2026-04-12   | dev       | Sprint JSDoc G2: application + CQRS layer — 36 files received @file headers.                                     | overlaps with: docs/reports/SPRINT_JSDOC_G1/G3/G4/P2_REPORT.md                                 | ARCHIVE       |
| docs/reports/SPRINT_JSDOC_G3_REPORT.md                  | report | STALE  | 2026-04-12   | dev       | Sprint JSDoc G3: infrastructure + lib layer — 49 files received @file headers.                                   | overlaps with: docs/reports/SPRINT_JSDOC_G1/G2/G4/P2_REPORT.md                                 | ARCHIVE       |
| docs/reports/SPRINT_JSDOC_G4_REPORT.md                  | report | STALE  | 2026-04-12   | dev       | Sprint JSDoc G4: remaining 233 files — completes monorepo @file coverage.                                        | overlaps with: docs/reports/SPRINT_JSDOC_G1/G2/G3/P2_REPORT.md                                 | ARCHIVE       |
| docs/reports/SPRINT_JSDOC_P2_REPORT.md                  | report | STALE  | 2026-04-12   | dev       | Sprint JSDoc P2: 889 @method + 260 @component + 155 @hook tags added across apps.                                | overlaps with: docs/reports/SPRINT_JSDOC_G1-G4_REPORT.md                                       | ARCHIVE       |
| docs/reports/SPRINT_M011_DEPRECATED_MIGRATION_REPORT.md | report | STALE  | 2026-04-13   | dev       | Sprint M-011: remove 5 deprecated billing methods, migrate 6 handlers to provider-based model.                   | overlaps with: docs/api/billing.md                                                             | ARCHIVE       |
| docs/reports/sprint-onboard.md                          | report | STALE  | 2026-04-17   | dev       | Sprint ONBOARD: welcome email, dashboard onboarding checklist, admin setup banner — 3 onboarding gaps closed.    | —                                                                                              | ARCHIVE       |
| docs/reports/sprint-password-management.md              | report | STALE  | 2026-04-17   | dev       | Sprint password mgmt: moved change-password from Security page to Admin Users table with dual logic.             | —                                                                                              | ARCHIVE       |
| docs/reports/sprint-sec-fix.md                          | report | STALE  | 2026-04-17   | dev       | Sprint SEC-FIX: IP allowlist enforced, CSRF in mutations, Sentry integrated in 4 apps — 3 security gaps closed.  | overlaps with: docs/security/OVERVIEW.md                                                       | ARCHIVE       |
| docs/reports/SPRINT_SETTINGS_A_REPORT.md                | report | STALE  | 2026-04-13   | dev       | Sprint SETTINGS-A: REST endpoints for encrypted platform credentials + BYOK AI keys + rate limit tracking.       | overlaps with: docs/reports/SPRINT_SETTINGS_B/C_REPORT.md, docs/api/auth.md                    | ARCHIVE       |
| docs/reports/SPRINT_SETTINGS_B_REPORT.md                | report | STALE  | 2026-04-14   | dev       | Sprint SETTINGS-B: admin settings UI consuming SETTINGS-A endpoints (overview, gateways, email, AI, storage).    | overlaps with: docs/reports/SPRINT_SETTINGS_A/C_REPORT.md                                      | ARCHIVE       |
| docs/reports/SPRINT_SETTINGS_C_REPORT.md                | report | STALE  | 2026-04-14   | dev       | Sprint SETTINGS-C: client AI BYOK settings page + 4 TanStack hooks.                                              | overlaps with: docs/reports/SPRINT_SETTINGS_A/B_REPORT.md                                      | ARCHIVE       |
| docs/reports/SPRINT_T_TESTS_REPORT.md                   | report | STALE  | 2026-04-12   | qa        | Sprint T retroactive tests: 357 test files / 7,228 tests passing; new tests for GatewayBilling, Compliance, etc. | overlaps with: docs/reports/testing/\*                                                         | ARCHIVE       |
| docs/reports/sprint-ux-polish.md                        | report | STALE  | 2026-04-17   | dev       | Sprint UX-POLISH: 6 QoL fixes (session timeout from DB, team invite email, avatars, profile update, banners).    | —                                                                                              | ARCHIVE       |

### docs/reports/audits/

| File                                                     | Tipo  | Estado | Última señal | Audiencia | Resumen                                                                                                                | Solapamiento                                                                                                     | Recomendación |
| -------------------------------------------------------- | ----- | ------ | ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------- |
| docs/reports/audits/account-model-audit-2026-03-29.md    | audit | STALE  | 2026-03-29   | dev       | Account model completeness audit (tenant fields, subscription, owner ref).                                             | overlaps with: docs/reports/audits/code-review-2026-03-29.md                                                     | ARCHIVE       |
| docs/reports/audits/app-separation-audit-2026-03-29.md   | audit | STALE  | 2026-03-29   | dev       | App separation audit: 70% of admin code belongs in client; 37 admin pages, 26 are product features.                    | overlaps with: docs/reports/sessions/sprint-0c-app-separation.md                                                 | ARCHIVE       |
| docs/reports/audits/audit-2-2026-03-28.md                | audit | STALE  | 2026-03-28   | dev       | Second deep audit: verifies A1-A7 fixes (auth, vulnerabilities, console.\*, Bluesky, schemas, any, UoW).               | overlaps with: docs/reports/audits/audit-remediation-2026-03-28.md, docs/reports/audits/deep-audit-2026-03-27.md | ARCHIVE       |
| docs/reports/audits/audit-remediation-2026-03-28.md      | audit | STALE  | 2026-03-28   | dev       | Audit remediation A1-A7 summary (security, mock data, schemas, any, tests, UoW, devDeps).                              | overlaps with: docs/reports/audits/deep-audit-2026-03-27.md                                                      | ARCHIVE       |
| docs/reports/audits/backend-auth-audit-2026-03-29.md     | audit | STALE  | 2026-03-29   | dev       | Backend & auth architecture audit: admin and client share Fastify and AdminUser table; need customer auth split.       | overlaps with: docs/reports/sessions/sprint-0-auth-foundation.md                                                 | ARCHIVE       |
| docs/reports/audits/code-first-audit-2026-04-10.md       | audit | STALE  | 2026-04-10   | dev       | Code-first audit: 69 route files, 428 endpoints, 200 OK on core 15, 3 prefix mismatches.                               | overlaps with: docs/reports/audits/code-first-audit-fixes-2026-04-10.md                                          | ARCHIVE       |
| docs/reports/audits/code-first-audit-fixes-2026-04-10.md | audit | STALE  | 2026-04-10   | dev       | Fixes for code-first audit: 9 unguarded endpoints, test roles cleanup, client contamination.                           | overlaps with: docs/reports/audits/code-first-audit-2026-04-10.md                                                | ARCHIVE       |
| docs/reports/audits/code-review-2026-03-29.md            | audit | STALE  | 2026-03-29   | dev       | Honest code review: substantial multi-channel CMS, gap between sprint claims and reality (mock reports, no ingestion). | overlaps with: docs/reports/audits/deep-audit-2026-03-27.md                                                      | ARCHIVE       |
| docs/reports/audits/conceptual-audit.md                  | audit | STALE  | 2026-03-10   | product   | Conceptual feature audit: 9 domains, % completion vs. mature social-media platform reference model.                    | overlaps with: docs/reports/audits/feature-decisions.md                                                          | KEEP          |
| docs/reports/audits/deep-audit-2026-03-27.md             | audit | STALE  | 2026-03-27   | dev       | Initial deep audit (post Phase 1-11 + U0-U6): 9 dimensions (static, security, DB, tests).                              | overlaps with: docs/reports/audits/audit-remediation-2026-03-28.md                                               | ARCHIVE       |
| docs/reports/audits/feature-decisions.md                 | audit | STALE  | 2026-03-10   | product   | Feature decisions: IMPLEMENT/HOMOLOGATE/DEFER blocks for non-fully-implemented capabilities.                           | overlaps with: docs/reports/audits/conceptual-audit.md                                                           | KEEP          |
| docs/reports/audits/legacy-audit-api-2026-04-03.md       | audit | STALE  | 2026-04-03   | dev       | Legacy code audit of apps/api: 27 issues found (2 CRITICAL, 8 HIGH), all fixed except enum-removal deferred.           | overlaps with: docs/reports/audits/legacy-audit-client-2026-04-03.md                                             | ARCHIVE       |
| docs/reports/audits/legacy-audit-client-2026-04-03.md    | audit | STALE  | 2026-04-03   | dev       | Legacy code audit of apps/client: 14 issues found, 1 HIGH (inbox AI triage unwired).                                   | overlaps with: docs/reports/audits/legacy-audit-api-2026-04-03.md                                                | ARCHIVE       |
| docs/reports/audits/preseparation-audit-2026-04-02.md    | audit | STALE  | 2026-04-02   | dev       | Pre-separation audit: 13 issues in client app from pre-separation era (~770 lines of dead admin code).                 | overlaps with: docs/reports/audits/preseparation-fix-2026-04-02.md                                               | ARCHIVE       |
| docs/reports/audits/preseparation-fix-2026-04-02.md      | audit | STALE  | 2026-04-02   | dev       | Pre-separation fix report: ProjectProvider rewritten, useAnalytics + analytics page rewritten.                         | overlaps with: docs/reports/audits/preseparation-audit-2026-04-02.md                                             | ARCHIVE       |
| docs/reports/audits/providers-baseline.md                | audit | STALE  | 2026-03-10   | dev       | Provider audit baseline: per-provider LOC + tests + method implementation matrix (9 providers).                        | overlaps with: docs/reports/audits/providers-gaps.md, docs/features/provider-capabilities.md                     | KEEP          |
| docs/reports/audits/providers-gaps.md                    | audit | STALE  | 2026-03-10   | dev       | Provider gap analysis: per-provider missing capabilities + API support (docs, polls, webhooks).                        | overlaps with: docs/reports/audits/providers-baseline.md, docs/features/provider-capabilities.md                 | KEEP          |
| docs/reports/audits/status-2026-05-06.md                 | audit | STALE  | 2026-05-06   | dev       | Dashboard of progress 2026-05-06: 40/87 batches closed, 43 backlog open, 7 NEEDS_EDWARD.                               | overlaps with: docs/reports/audits/status-2026-05-07.md                                                          | ARCHIVE       |
| docs/reports/audits/status-2026-05-07.md                 | audit | ACTIVE | 2026-05-07   | dev       | Dashboard of progress 2026-05-07: 40/87 batches closed, 42 backlog open, 19 NEEDS_EDWARD; latest snapshot.             | overlaps with: docs/reports/audits/status-2026-05-06.md                                                          | KEEP          |

### docs/reports/legacy/

Empty subdirectory (no .md files); contains non-md artifacts (.txt, .png). Skipped from inventory.

### docs/reports/mutations/

| File                                        | Tipo   | Estado | Última señal | Audiencia | Resumen                                                                                             | Solapamiento                                                           | Recomendación |
| ------------------------------------------- | ------ | ------ | ------------ | --------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------- |
| docs/reports/mutations/batch-2.md           | report | STALE  | 2026-03-18   | qa        | Mutant kill session Batch 2: bluesky 70%, snapchat 63%, client 56%, telegram 84%, workers 67%.      | overlaps with: docs/reports/mutations/batch-3.md, session-\*.md        | ARCHIVE       |
| docs/reports/mutations/batch-3.md           | report | STALE  | 2026-03-18   | qa        | Mutant kill session Batch 3: cache-redis 56%, storage-s3 35%, api-common 45%, linkedin 64%.         | overlaps with: docs/reports/mutations/batch-2.md, session-\*.md        | ARCHIVE       |
| docs/reports/mutations/session-a.md         | report | STALE  | 2026-03-19   | qa        | Mutant kill Session A: linkedin 77%, api-common 51%, cache-redis 56%, storage-s3 36% (failed).      | overlaps with: docs/reports/mutations/session-a2.md                    | ARCHIVE       |
| docs/reports/mutations/session-a2.md        | report | STALE  | 2026-03-19   | qa        | Mutant kill Session A Part 2: storage-s3 44%, cache-redis 58% — ceilings reached.                   | overlaps with: docs/reports/mutations/session-a.md                     | ARCHIVE       |
| docs/reports/mutations/session-b.md         | report | STALE  | 2026-03-19   | qa        | Mutant kill Session B: apps/api micro-batch execution, 321 new tests across billing/content/domain. | —                                                                      | ARCHIVE       |
| docs/reports/mutations/session-c.md         | report | STALE  | 2026-03-20   | qa        | Mutant kill Session C: 8 use-case directories with 76 new tests (usage, brand-voice, campaigns).    | —                                                                      | ARCHIVE       |
| docs/reports/mutations/session-d.md         | report | STALE  | 2026-03-20   | qa        | Mutant kill Session D: inbox + reports + domain factories + adapters (circuit breaker ceiling).     | —                                                                      | ARCHIVE       |
| docs/reports/mutations/session-e.md         | report | STALE  | 2026-03-20   | qa        | Session E: UI integration tests for apps/client hooks via @testing-library/react renderHook.        | —                                                                      | ARCHIVE       |
| docs/reports/mutations/stryker-expansion.md | report | STALE  | 2026-03-17   | qa        | Stryker mutation expansion: 26 configs across apps + packages; 56 test files migrated to Vitest.    | overlaps with: docs/reports/testing/testing-infrastructure-complete.md | KEEP          |
| docs/reports/mutations/tiktok-dlq.md        | report | STALE  | 2026-03-17   | qa        | Mutant kill session TikTok + DLQ: tiktok 74%, DLQ 68% (target met).                                 | —                                                                      | ARCHIVE       |

### docs/reports/planning/

| File                                                            | Tipo | Estado     | Última señal | Audiencia | Resumen                                                                                                | Solapamiento                                                                                    | Recomendación |
| --------------------------------------------------------------- | ---- | ---------- | ------------ | --------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------- |
| docs/reports/planning/legacy-api-verification-execution-plan.md | plan | STALE      | 2026-04-03   | dev       | Legacy API verification execution plan: 5 deferred items, dep-safe order; "@deprecated is not a fix".  | overlaps with: docs/reports/audits/legacy-audit-api-2026-04-03.md                               | ARCHIVE       |
| docs/reports/planning/master-development-plan.md                | plan | SUPERSEDED | 2026-03-25   | product   | Master development plan: 11 phases, baseline ~49% → target ~80%; superseded by validity-check results. | overlaps with: docs/reports/planning/plan-validity-check.md, plan-validity-check-phases-5-11.md | ARCHIVE       |
| docs/reports/planning/next-sprint-backlog.md                    | plan | STALE      | 2026-03-10   | product   | Post-implementation sprint backlog: deferred capabilities to review after Phase 11.                    | overlaps with: docs/audits/POST_REMEDIATION_BACKLOG.md, docs/development/CLIENT_BACKLOG.md      | KEEP          |
| docs/reports/planning/plan-validity-check.md                    | plan | STALE      | 2026-03-25   | product   | Master plan Phases 1-4 validity check: ALREADY DONE items; recommends starting from Phase 5.           | overlaps with: docs/reports/planning/master-development-plan.md                                 | ARCHIVE       |
| docs/reports/planning/plan-validity-check-phases-5-11.md        | plan | STALE      | 2026-03-25   | product   | Master plan Phases 5-11 validity check: ALL PHASES LARGELY COMPLETE.                                   | overlaps with: docs/reports/planning/master-development-plan.md, plan-validity-check.md         | ARCHIVE       |

### docs/reports/sessions/

| File                                                     | Tipo        | Estado | Última señal | Audiencia | Resumen                                                                                                                  | Solapamiento                                                                          | Recomendación |
| -------------------------------------------------------- | ----------- | ------ | ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------- |
| docs/reports/sessions/asset-tags-complete.md             | session-log | STALE  | 2026-03-25   | dev       | Asset Tags full impl: Prisma schema → domain → repos → use cases → DI → routes → admin UI → 70 tests.                    | overlaps with: docs/reports/sessions/asset-tags.md, asset-tags-phase2.md              | ARCHIVE       |
| docs/reports/sessions/asset-tags.md                      | session-log | STALE  | 2026-03-25   | dev       | Asset Tags Phase 1: schema + MediaAsset entity + 33 entity tests.                                                        | overlaps with: docs/reports/sessions/asset-tags-complete.md, asset-tags-phase2.md     | ARCHIVE       |
| docs/reports/sessions/asset-tags-phase2.md               | session-log | STALE  | 2026-03-25   | dev       | Asset Tags Phase 2: use cases + 37 tests done; infra/routes/UI pending.                                                  | overlaps with: docs/reports/sessions/asset-tags-complete.md, asset-tags.md            | ARCHIVE       |
| docs/reports/sessions/break-thresholds.md                | session-log | STALE  | 2026-03-17   | qa        | Stryker break thresholds: 34 configs updated using formula `floor(covered)-5`.                                           | overlaps with: docs/reports/mutations/stryker-expansion.md                            | ARCHIVE       |
| docs/reports/sessions/documentation-sprint-2026-03-28.md | session-log | STALE  | 2026-03-28   | dev       | Documentation sprint: inventory of 107 docs, classify ACCURATE/OUTDATED/PARTIAL/MISSING.                                 | overlaps with: docs/\_DOCS_INVENTORY.md (this doc, newer)                             | ARCHIVE       |
| docs/reports/sessions/multicloud-infrastructure.md       | session-log | STALE  | 2026-03-31   | ops       | Multi-cloud infrastructure: storage adapters (AWS, Azure, GCP, DO, Cloudinary) + deployment guides.                      | overlaps with: docs/deployment/\*.md                                                  | ARCHIVE       |
| docs/reports/sessions/platform-preview.md                | session-log | STALE  | 2026-03-25   | dev       | Platform Preview complete: all 10 providers covered in admin + client previews with correct char limits.                 | overlaps with: docs/features/provider-capabilities.md                                 | ARCHIVE       |
| docs/reports/sessions/prisma-db-fix.md                   | session-log | STALE  | 2026-03-31   | dev       | Prisma 7 db push fix: earlyAccess removed, env() vs process.env.X!, ?schema=public param; AdminUser seed.                | —                                                                                     | ARCHIVE       |
| docs/reports/sessions/routing-fix.md                     | session-log | STALE  | 2026-03-31   | dev       | Routing fix: admin /auth/login → /login (route groups), client root legacy redirect.                                     | —                                                                                     | ARCHIVE       |
| docs/reports/sessions/send-reply-di-wiring.md            | session-log | STALE  | 2026-03-25   | dev       | SendReply DI wiring: ProviderAdapterResolver registered, inline wrapper around getAdapter() in setupInboxUseCases.       | overlaps with: docs/reports/sessions/send-reply-wiring.md                             | ARCHIVE       |
| docs/reports/sessions/send-reply-wiring.md               | session-log | STALE  | 2026-03-25   | dev       | SendReply provider wiring: SendReplyUseCase now calls providerAdapter.postReply() with 5-provider matrix.                | overlaps with: docs/reports/sessions/send-reply-di-wiring.md                          | ARCHIVE       |
| docs/reports/sessions/session-f3.md                      | session-log | STALE  | 2026-03-24   | qa        | Session F3: PostAggregate (74 tests) + Posts use cases (40 tests) — 114 total.                                           | overlaps with: docs/reports/sessions/session-f4.md, f5.md                             | ARCHIVE       |
| docs/reports/sessions/session-f4.md                      | session-log | STALE  | 2026-03-25   | qa        | Session F4: 11 timed-out Stryker micro-batches re-run; 5 completed, 6 hit break.                                         | overlaps with: docs/reports/sessions/session-f3.md, f5.md                             | ARCHIVE       |
| docs/reports/sessions/session-f5.md                      | session-log | STALE  | 2026-03-25   | qa        | Session F5: break threshold fixes (D3 glob bug), IngestSocialMessage tests, nightly CI.                                  | overlaps with: docs/reports/sessions/session-f4.md, break-thresholds.md               | ARCHIVE       |
| docs/reports/sessions/sprint-0-auth-foundation.md        | session-log | STALE  | 2026-03-29   | dev       | Sprint 0 auth foundation: Account completion (slug, timezone, locale) + CustomerUser table (88 tests).                   | overlaps with: docs/reports/audits/backend-auth-audit-2026-03-29.md                   | ARCHIVE       |
| docs/reports/sessions/sprint-0c-app-separation.md        | session-log | STALE  | 2026-03-29   | dev       | Sprint 0C app separation: admin 37→12 pages, client 9→31 pages; 13 component groups copied.                              | overlaps with: docs/reports/audits/app-separation-audit-2026-03-29.md                 | ARCHIVE       |
| docs/reports/sessions/sprint-1-wave-1.md                 | session-log | STALE  | 2026-03-28   | dev       | Sprint 1 Wave 1: emoji picker, internal notes on inbox, Brand Kit, Zapier connector — 105 tests added.                   | overlaps with: docs/reports/sessions/sprint-2/sprint-3-wave-\*.md                     | ARCHIVE       |
| docs/reports/sessions/sprint-2-wave-2.md                 | session-log | STALE  | 2026-03-28   | dev       | Sprint 2 Wave 2: Make connector (integration platform generalization), multi-level approvals, tasks.                     | overlaps with: docs/reports/sessions/sprint-1/sprint-3-wave-\*.md                     | ARCHIVE       |
| docs/reports/sessions/sprint-3-wave-3.md                 | session-log | STALE  | 2026-03-29   | dev       | Sprint 3 Wave 3: @mention autocomplete, Google Drive import, SAML/SSO, OIDC, custom report builder.                      | overlaps with: docs/reports/sessions/sprint-1/sprint-2-wave-\*.md                     | ARCHIVE       |
| docs/reports/sessions/sprint-4-crm.md                    | session-log | STALE  | 2026-03-29   | dev       | Sprint 4 CRM integration: foundation + HubSpot adapter + Salesforce adapter; 54 tests.                                   | —                                                                                     | ARCHIVE       |
| docs/reports/sessions/sprint-5-complete-product.md       | session-log | STALE  | 2026-03-30   | dev       | Sprint 5 complete the product: Team Management, Campaigns, Asset Library, CRM Settings UI pages.                         | overlaps with: docs/reports/sessions/sprint-4-crm.md                                  | ARCHIVE       |
| docs/reports/sessions/sprint-6-ship-ready.md             | session-log | STALE  | 2026-03-30   | dev       | Sprint 6 ship-ready: email notifications, calendar week/day, shareable reports, usage dashboard, Stripe+Paddle billing.  | overlaps with: docs/reports/SPRINT_B_GATEWAY_SWITCHING_REPORT.md                      | ARCHIVE       |
| docs/reports/sessions/sprint-7-ai-differentiation.md     | session-log | STALE  | 2026-03-30   | dev       | Sprint 7 AI differentiation: analytics→AI bridge, platform-native variants, AI calendar generator.                       | overlaps with: docs/reports/SPRINT_AI_ARCH_REPORT.md                                  | ARCHIVE       |
| docs/reports/sessions/sprint-8-revenue-growth.md         | session-log | STALE  | 2026-03-30   | dev       | Sprint 8 revenue & growth: provider-based billing, integration marketplace, referral program.                            | overlaps with: docs/reports/SPRINT_B_GATEWAY_SWITCHING_REPORT.md                      | ARCHIVE       |
| docs/reports/sessions/sprint-9-autonomous.md             | session-log | STALE  | 2026-03-30   | dev       | Sprint 9 autonomous features: post repurposing, AI inbox assistant, trend radar.                                         | overlaps with: docs/reports/SPRINT_AI_ARCH_REPORT.md                                  | ARCHIVE       |
| docs/reports/sessions/sprint-gaps.md                     | session-log | STALE  | 2026-03-30   | dev       | Critical gaps sprint: analytics ingestion worker, custom reports real data, inbox sync, task UI, SSO settings.           | overlaps with: docs/reports/sessions/strategic-review.md                              | ARCHIVE       |
| docs/reports/sessions/strategic-review.md                | session-log | STALE  | 2026-03-30   | product   | Complete strategic review: ~75-80% of shippable platform, 10 providers, AI deep, 6 features need UI.                     | overlaps with: docs/reports/audits/conceptual-audit.md, feature-decisions.md          | KEEP          |
| docs/reports/sessions/surgical-verification.md           | session-log | STALE  | 2026-03-30   | qa        | Surgical verification: UpdatePricingConfig (grandfathering), referral conversion loop — each behavior verified.          | —                                                                                     | ARCHIVE       |
| docs/reports/sessions/test-coverage-audit.md             | session-log | STALE  | 2026-03-30   | qa        | Sprint Gaps → Sprint 8 test coverage audit: 16 test files, 100+ tests; 3 gaps filled (reports sharing, email, registry). | overlaps with: docs/reports/testing/\*                                                | ARCHIVE       |
| docs/reports/sessions/threads-provider.md                | session-log | STALE  | 2026-03-31   | dev       | Threads provider adapter: text/image/video/carousel + reply + insights via two-step publishing.                          | overlaps with: docs/architecture/PROVIDERS.md, docs/features/provider-capabilities.md | ARCHIVE       |

### docs/reports/testing/

| File                                                                                                          | Tipo  | Estado | Última señal | Audiencia | Resumen                                                                                                   | Solapamiento                                                  | Recomendación                           |
| ------------------------------------------------------------------------------------------------------------- | ----- | ------ | ------------ | --------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------- |
| docs/reports/testing/testing-audit-findings.md                                                                | audit | STALE  | 2026-03-24   | qa        | Raw testing audit findings: 1,300 src files, 511 tests, ~400 untested (31%).                              | overlaps with: docs/reports/testing/testing-classification.md | ARCHIVE                                 |
| docs/reports/testing/testing-classification.md                                                                | audit | STALE  | 2026-03-24   | qa        | Untested files classification: 233 unit / 349 integration / 264 E2E / 203 exempt / 10 blocked.            | overlaps with: docs/reports/testing/testing-audit-findings.md | ARCHIVE                                 |
| [docs/reports/testing/testing-infrastructure-complete.md](reports/testing/testing-infrastructure-complete.md) | guide | STALE  | 2026-03-25   | qa        | Complete testing infrastructure reference (Vitest 4 / node:test / Stryker 9.6 / GH Actions PR + nightly). | overlaps with: docs/architecture/TESTING.md                   | MERGE_INTO:docs/architecture/TESTING.md |

### docs/reports/updates/

| File                                      | Tipo      | Estado | Última señal | Audiencia | Resumen                                                                                              | Solapamiento                                                        | Recomendación |
| ----------------------------------------- | --------- | ------ | ------------ | --------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------- |
| docs/reports/updates/dependency-audit.md  | audit     | STALE  | 2026-03-26   | ops       | Dependency audit: 76 vulnerabilities (4 critical, 29 high), 79 outdated, 1 deprecated package.       | overlaps with: docs/reports/updates/dependency-update.md, u0..u6.md | ARCHIVE       |
| docs/reports/updates/dependency-update.md | changelog | STALE  | 2026-03-27   | ops       | U0–U6 dependency update sessions summary: 76 vulns → 34 (dev-only), 0 outdated, 0 deprecated.        | overlaps with: docs/reports/updates/u0..u6.md                       | KEEP          |
| docs/reports/updates/u0.md                | changelog | STALE  | 2026-03-26   | ops       | U0: Node.js v22 → v24.14.1 LTS + pnpm 10.16 → 10.33; 11 files updated.                               | overlaps with: docs/reports/updates/dependency-update.md            | ARCHIVE       |
| docs/reports/updates/u1.md                | changelog | STALE  | 2026-03-26   | ops       | U1: security patches (cloudinary, aws-sdk, axios, form-data, validator), 30+ files modified.         | overlaps with: docs/reports/updates/dependency-update.md            | ARCHIVE       |
| docs/reports/updates/u2.md                | changelog | STALE  | 2026-03-26   | ops       | U2: lucide-react 1.7.0, recharts 3.8.1 (Tooltip formatter type fix), pnpm 10.33; 8 files.            | overlaps with: docs/reports/updates/dependency-update.md            | ARCHIVE       |
| docs/reports/updates/u3.md                | changelog | STALE  | 2026-03-26   | ops       | U3: TypeScript 6.0.2 across 32 workspaces; moduleResolution `node`→`bundler`, baseUrl removal.       | overlaps with: docs/reports/updates/dependency-update.md            | ARCHIVE       |
| docs/reports/updates/u4.md                | changelog | STALE  | 2026-03-26   | ops       | U4: openai 5.22.0 → 6.33.0; zero source code changes needed.                                         | overlaps with: docs/reports/updates/dependency-update.md            | ARCHIVE       |
| docs/reports/updates/u5.md                | changelog | STALE  | 2026-03-26   | ops       | U5: fluent-ffmpeg replacement (archived) with `execFile` + ffmpeg CLI in Instagram/TikTok providers. | overlaps with: docs/reports/updates/dependency-update.md            | ARCHIVE       |
| docs/reports/updates/u6.md                | changelog | STALE  | 2026-03-27   | ops       | U6: @opentelemetry suite updated (core/resources/sdk-node/exporters/instrumentations).               | overlaps with: docs/reports/updates/dependency-update.md            | ARCHIVE       |

### docs/security/

| File                                                                                            | Tipo      | Estado | Última señal      | Audiencia | Resumen                                                                                                     | Solapamiento                                                                                     | Recomendación |
| ----------------------------------------------------------------------------------------------- | --------- | ------ | ----------------- | --------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------- |
| [docs/security/AUTH.md](security/AUTH.md)                                                       | spec      | STALE  | mtime: 2026-03-08 | security  | Two-tier auth (admin vs client) sharing Fastify backend: cookie names, security flags, Server Actions flow. | overlaps with: docs/api/auth.md, docs/admin/AUTH.md, docs/architecture/SECURITY.md               | KEEP          |
| [docs/security/OVERVIEW.md](security/OVERVIEW.md)                                               | spec      | ACTIVE | mtime: 2026-05-08 | security  | Security overview: JWT, MFA, RBAC, session mgmt — defense-in-depth strategies summary.                      | overlaps with: docs/architecture/SECURITY.md, docs/security/AUTH.md                              | KEEP          |
| [docs/security/SECURITY_TESTING_FRAMEWORK.md](security/SECURITY_TESTING_FRAMEWORK.md)           | index     | STALE  | mtime: 2026-03-08 | security  | Security testing framework directory: config, scripts, tests, ZAP, scan policies.                           | —                                                                                                | KEEP          |
| [docs/security/SECRETS_BYOK_FEASIBILITY.md](security/SECRETS_BYOK_FEASIBILITY.md)               | spec      | ACTIVE | mtime: 2026-05-08 | security  | BYOK feasibility study: 3 isolation levels (L1/L2/L3), schema/ops impact, compliance benefits.              | overlaps with: docs/security/SECRETS_KMS_MIGRATION.md, SECRETS_PRODUCTION_ARCHITECTURE.md        | KEEP          |
| [docs/security/SECRETS_DATABASE_INVENTORY.md](security/SECRETS_DATABASE_INVENTORY.md)           | inventory | ACTIVE | mtime: 2026-05-07 | security  | Every Prisma field that stores a secret/cred/password hash/OAuth token/HMAC/temp token (Class A-E).         | overlaps with: docs/security/SECRETS.md                                                          | KEEP          |
| [docs/security/SECRETS_KMS_MIGRATION.md](security/SECRETS_KMS_MIGRATION.md)                     | spec      | ACTIVE | mtime: 2026-05-08 | security  | KMS-backed envelope-encryption migration: 4 KMS options, re-wrap procedure, rollback plan.                  | overlaps with: docs/security/SECRETS_BYOK_FEASIBILITY.md, SECRETS_PRODUCTION_ARCHITECTURE.md     | KEEP          |
| [docs/security/SECRETS.md](security/SECRETS.md)                                                 | spec      | ACTIVE | mtime: 2026-05-08 | security  | Canonical reference: every secret with location, format, consumer, classification, rotation cadence.        | overlaps with: docs/security/SECRETS_DATABASE_INVENTORY.md, docs/architecture/secrets-and-env.md | KEEP          |
| [docs/security/SECRETS_PRODUCTION_ARCHITECTURE.md](security/SECRETS_PRODUCTION_ARCHITECTURE.md) | spec      | ACTIVE | mtime: 2026-05-08 | security  | Deployment-time secret delivery options per environment with trade-offs.                                    | overlaps with: docs/security/SECRETS_KMS_MIGRATION.md, SECRETS_BYOK_FEASIBILITY.md               | KEEP          |
| [docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md](security/T0A_SECRETS_ROTATION_RUNBOOK.md)       | runbook   | ACTIVE | mtime: 2026-05-07 | security  | Step-by-step Edward runbook for rotating all secrets exposed by L-591 (.env tracked in public repo).        | overlaps with: docs/development/ENV_BACKUP.md                                                    | KEEP          |

### docs/standards/

| File                                                                    | Tipo  | Estado | Última señal | Audiencia | Resumen                                                                                                                       | Solapamiento                                                                         | Recomendación |
| ----------------------------------------------------------------------- | ----- | ------ | ------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------- |
| [docs/standards/backend-standards.md](standards/backend-standards.md)   | guide | ACTIVE | 2026-04-20   | dev       | Backend standards (Fastify 5, Node 24, TS 6, Prisma, BullMQ, Zod) — pre-impl discovery non-negotiable; D0v4-1 audit basis.    | overlaps with: docs/standards/code-standards.md                                      | KEEP          |
| [docs/standards/code-standards.md](standards/code-standards.md)         | guide | ACTIVE | 2026-04-20   | dev       | Transversal code standards across monorepo: pre-impl discovery, TS conventions, catch blocks, dead code policy.               | overlaps with: docs/standards/backend-standards.md, frontend-standards.md, CLAUDE.md | KEEP          |
| [docs/standards/frontend-standards.md](standards/frontend-standards.md) | guide | ACTIVE | 2026-04-20   | dev       | Frontend standards v2 (Next.js 16, React 19.2, TS 6, Tailwind, shadcn/ui, TanStack Query v5) — supersedes REACT_STANDARDS v1. | overlaps with: docs/standards/code-standards.md, docs/client/react-19.md             | KEEP          |

### docs/technical/

| File                                                              | Tipo | Estado | Última señal      | Audiencia | Resumen                                                                                  | Solapamiento                                     | Recomendación |
| ----------------------------------------------------------------- | ---- | ------ | ----------------- | --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------- |
| [docs/technical/DEPENDENCIES_ES.md](technical/DEPENDENCIES_ES.md) | spec | ACTIVE | mtime: 2026-03-27 | dev       | Referencia stack tecnológico OmniPost (pnpm 10.16, Turbo 2.8, Node 24, TS 6.0, etc.).    | overlaps with: docs/technical/DEPENDENCIES.md    | KEEP          |
| [docs/technical/DEPENDENCIES.md](technical/DEPENDENCIES.md)       | spec | ACTIVE | mtime: 2026-03-27 | dev       | Complete technical stack reference (pnpm 10.16, Turbo 2.8, Node 24, TS 6.0, workspaces). | overlaps with: docs/technical/DEPENDENCIES_ES.md | KEEP          |

## Detected overlaps (by topic)

Lists groups of 2+ files that cover the same concept. Each group provides a recommendation.

### Topic: Caching architecture

- docs/architecture/caching.md (ACTIVE, 2026-05-07) — canonical "why" doc
- docs/api/caching.md (ACTIVE, 2026-05-08) — implementation details, perf numbers
- **Recommendation:** MERGE docs/api/caching.md → docs/architecture/caching.md as a §"API response caching" section. Keep one doc as source of truth.

### Topic: Auth (admin + client + API)

- docs/security/AUTH.md (STALE, mtime 2026-03-08) — two-tier overview
- docs/admin/AUTH.md (STALE, mtime 2026-03-08) — admin-specific Server Actions flow
- docs/api/auth.md (ACTIVE, mtime 2026-04-13) — full backend API reference
- docs/architecture/SECURITY.md (STALE, mtime 2026-03-08) — older defense-in-depth overview
- docs/security/OVERVIEW.md (ACTIVE, 2026-05-08) — current security overview
- **Recommendation:** MERGE docs/admin/AUTH.md + docs/architecture/SECURITY.md into docs/security/AUTH.md and docs/security/OVERVIEW.md. Keep docs/api/auth.md as the API reference.

### Topic: Master plan vs validity checks

- docs/reports/planning/master-development-plan.md (SUPERSEDED, 2026-03-25, 2,183 lines)
- docs/reports/planning/plan-validity-check.md (STALE) — phases 1-4 all done
- docs/reports/planning/plan-validity-check-phases-5-11.md (STALE) — phases 5-11 all done
- **Recommendation:** ARCHIVE all three. Phases 1-11 closed, validity checks confirmed. Active plan is docs/audits/REMEDIATION_ROADMAP.md.

### Topic: Remediation roadmap (3 parallel docs)

- docs/audits/REMEDIATION_BATCHES.v1.md (SUPERSEDED, 1,645 lines) — self-declared SUPERSEDED
- docs/audits/CLAUDE_ALTERNATE_PLAN.md (SUPERSEDED, 557 lines) — alternative tier plan, also absorbed
- docs/audits/REMEDIATION_ROADMAP.md (ACTIVE, 4,109 lines) — hybrid v2.1 — single source of truth
- **Recommendation:** ARCHIVE the two SUPERSEDED docs. Keep ROADMAP. (Saves ~2.2K lines.)

### Topic: Admin portal session reports (~20 docs covering the same April 2026 sprint)

- docs/development/ADMIN_BILLING_FIX_REPORT.md
- docs/development/ADMIN_BUGS_I18N_REPORT.md
- docs/development/ADMIN_CLEANUP_REPORT.md
- docs/development/ADMIN_CODE_QUALITY_REPORT.md
- docs/development/ADMIN_COMPLETE_FIX_REPORT.md
- docs/development/ADMIN_FIX_REPORT.md
- docs/development/ADMIN_GROUP1_REPORT.md
- docs/development/ADMIN_GROUP2_REPORT.md
- docs/development/ADMIN_INVESTIGATION_REPORT.md
- docs/development/ADMIN_RECOVERY_REPORT.md
- docs/development/ADMIN_REDESIGN_REPORT.md
- docs/development/ADMIN_REMAINING_FIX_REPORT.md
- docs/development/ADMIN_SESSION_FULL_REPORT.md (combined master report — 577 lines)
- docs/development/ADMIN_SPRINT2_REPORT.md (all-already-done, 62 lines — pure noise)
- docs/development/ADMIN_UI_AUDIT_REPORT.md
- docs/development/ACCOUNT_IMPROVEMENTS_REPORT.md
- docs/development/CHANGEPLAN_DIALOG_INVESTIGATION.md
- docs/development/POST_INCIDENT_DIAGNOSTIC.md
- docs/development/POST_INCIDENT_FIX_REPORT.md
- **Recommendation:** ARCHIVE all individual ADMIN\_\*\_REPORT.md (keep only ADMIN_SESSION_FULL_REPORT.md as the combined summary, then ARCHIVE that too once Edward confirms the work is behind us). DELETE ADMIN_SPRINT2_REPORT.md (every row says "ALREADY WORKING/DONE"). Saves ~2,100 lines.

### Topic: Sprint reports (April 2026 wave)

- 14 SPRINT\_\*.md files in docs/reports/ covering A/B/B2/B3/C/CRYPTO/D/DI/DI2/JSDOC_G1-G4/JSDOC_P2/M011/SETTINGS_A-C/T_TESTS
- 5 lower-case sprint-\*.md (billing-v2, onboard, password-management, sec-fix, ux-polish)
- **Recommendation:** ARCHIVE all 19. Each represents a closed sprint covered by active spec docs (docs/api/billing.md, docs/api/compliance.md, docs/security/SECRETS.md, etc.). Saves ~2,400 lines.

### Topic: Audit campaign D0-v4 (Apr 2026)

- docs/audits/D0v4_0_RENAME_REPORT.md
- docs/audits/D0v4_1_BACKEND_SERVICES_REPORT.md
- docs/audits/D0v4_2_MIDDLEWARES_DI_INFRA_REPORT.md
- docs/audits/D0v4_3_WORKERS_REPORT.md
- docs/audits/D0v4_4_FRONTEND_CLIENT_PAGES_COMPONENTS_REPORT.md
- docs/audits/D0v4_5_FRONTEND_CLIENT_HOOKS_REPORT.md
- docs/audits/D0v4_6_FRONTEND_ADMIN_REPORT.md
- docs/audits/D0v4_7_PACKAGES_REPORT.md
- docs/audits/D0v4_8_INFRASTRUCTURE_REPORT.md
- docs/audits/D0_v4_PILOT_BACKEND_ROUTES.md
- docs/audits/PRE_D2_ENDPOINT_CALIBRATION.md
- **Recommendation:** ARCHIVE all 11 once the 647 findings (now consolidated in LATERAL_FINDINGS.md + REMEDIATION_ROADMAP.md) are closed. The reports were the audit artifact; the working backlog is what matters going forward. Saves ~6,500 lines.

### Topic: Session-log March 2026 (15+ session reports)

- docs/reports/sessions/asset-tags.md / asset-tags-phase2.md / asset-tags-complete.md (3 in one feature)
- docs/reports/sessions/sprint-0-_ / sprint-0c-_ / sprint-1..9-\*.md (10 sprints)
- docs/reports/sessions/break-thresholds.md / session-f3-f5.md / multicloud-infrastructure.md / threads-provider.md / etc.
- **Recommendation:** ARCHIVE all 30 files in docs/reports/sessions/. They're historical session records; the canonical state lives in active spec docs (templates.md, multicloud is in deployment/\*, etc.). Saves ~2,200 lines.

### Topic: Mutation testing sessions

- docs/reports/mutations/batch-2.md, batch-3.md
- docs/reports/mutations/session-a/a2/b/c/d/e.md
- docs/reports/mutations/tiktok-dlq.md
- docs/reports/mutations/stryker-expansion.md (the master narrative)
- **Recommendation:** ARCHIVE 9 of 10 (keep stryker-expansion.md as the single canonical narrative). Saves ~800 lines.

### Topic: Dependency update sessions U0-U6

- docs/reports/updates/u0.md ... u6.md (7 files)
- docs/reports/updates/dependency-update.md (the summary)
- docs/reports/updates/dependency-audit.md (the initial audit)
- **Recommendation:** ARCHIVE u0..u6 (keep dependency-update.md as the consolidated summary). Saves ~700 lines.

### Topic: Status dashboards

- docs/reports/audits/status-2026-05-06.md (older)
- docs/reports/audits/status-2026-05-07.md (newer)
- **Recommendation:** ARCHIVE the May-06 snapshot. Keep latest only and regenerate going forward.

### Topic: Sprint planning / next sprint backlog

- docs/reports/planning/next-sprint-backlog.md (2026-03-10 review-after-Phase-11)
- docs/development/CLIENT_BACKLOG.md (P1 publishing queue monitor + similar)
- docs/audits/POST_REMEDIATION_BACKLOG.md (PR-1..PR-56, active living doc)
- **Recommendation:** KEEP all three but consider merging the older planning backlog into POST_REMEDIATION_BACKLOG once Edward confirms current relevance.

### Topic: Stack / dependencies

- docs/technical/DEPENDENCIES.md (English)
- docs/technical/DEPENDENCIES_ES.md (Spanish)
- **Recommendation:** KEEP both — bilingual is intentional. Consider a header note linking the two for sync.

### Topic: Investor / marketing briefs

- docs/product/INVESTOR_EN.md + INVESTOR_ES.md
- docs/product/MARKETING_EN.md + MARKETING_ES.md
- **Recommendation:** KEEP all four — bilingual product materials, no overlap with technical docs.

### Topic: Testing infrastructure

- docs/architecture/TESTING.md (current)
- docs/reports/testing/testing-infrastructure-complete.md (March 2026 snapshot)
- docs/reports/testing/testing-audit-findings.md + testing-classification.md (audit data, March 2026)
- docs/development/testing-backlog.md (backlog)
- docs/development/SMOKE_TESTS.md (smoke suite reference, May 2026)
- **Recommendation:** MERGE docs/reports/testing/testing-infrastructure-complete.md → docs/architecture/TESTING.md. ARCHIVE the audit-findings + classification snapshots. KEEP backlog + SMOKE_TESTS.

### Topic: Endpoint inventory

- docs/audits/D0_INVENTORY.md (master)
- docs/audits/ENDPOINT_AUDIT.md (471 endpoints classification, living doc)
- docs/audits/D1_DECISIONS.md (final decisions)
- docs/audits/D0_v4_PILOT_BACKEND_ROUTES.md (pilot read)
- docs/audits/PRE_D2_ENDPOINT_CALIBRATION.md (delta calibration)
- **Recommendation:** KEEP master + ENDPOINT_AUDIT + D1_DECISIONS as the living triad. ARCHIVE the pilot and calibration docs (consumed inputs).

## Archive / delete candidates

Files flagged `ARCHIVE` or `DELETE` listed with one-line justification.

| Path                                                            | Rec     | Why                                                                                                  |
| --------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| docs/audits/REMEDIATION_BATCHES.v1.md                           | ARCHIVE | Header self-declares SUPERSEDED by REMEDIATION_ROADMAP.md (2026-04-21). 1,645 lines.                 |
| docs/audits/CLAUDE_ALTERNATE_PLAN.md                            | ARCHIVE | Front-matter explicitly says "documento de referencia, preservado como insumo histórico". 557 lines. |
| docs/audits/D0v4_0_RENAME_REPORT.md                             | ARCHIVE | Closed rename sprint; output is the renamed code itself. 260 lines.                                  |
| docs/audits/D0v4_1_BACKEND_SERVICES_REPORT.md                   | ARCHIVE | Closed audit report; findings consolidated in LATERAL_FINDINGS + ROADMAP. 435 lines.                 |
| docs/audits/D0v4_2_MIDDLEWARES_DI_INFRA_REPORT.md               | ARCHIVE | Closed audit report; findings consolidated in LATERAL_FINDINGS + ROADMAP. 567 lines.                 |
| docs/audits/D0v4_3_WORKERS_REPORT.md                            | ARCHIVE | Closed audit report. 491 lines.                                                                      |
| docs/audits/D0v4_4_FRONTEND_CLIENT_PAGES_COMPONENTS_REPORT.md   | ARCHIVE | Closed audit report. 659 lines.                                                                      |
| docs/audits/D0v4_5_FRONTEND_CLIENT_HOOKS_REPORT.md              | ARCHIVE | Closed audit report. 739 lines.                                                                      |
| docs/audits/D0v4_6_FRONTEND_ADMIN_REPORT.md                     | ARCHIVE | Closed audit report. 1,886 lines (biggest savings).                                                  |
| docs/audits/D0v4_7_PACKAGES_REPORT.md                           | ARCHIVE | Closed audit report. 767 lines.                                                                      |
| docs/audits/D0v4_8_INFRASTRUCTURE_REPORT.md                     | ARCHIVE | Closed audit report (last of tramo). 958 lines.                                                      |
| docs/audits/D0_v4_PILOT_BACKEND_ROUTES.md                       | ARCHIVE | Pilot for the D0-v4 series; findings absorbed. 448 lines.                                            |
| docs/audits/PRE_D2_ENDPOINT_CALIBRATION.md                      | ARCHIVE | Pre-D2 calibration only; D2 absorbed it. 277 lines.                                                  |
| docs/development/ADMIN_BILLING_FIX_REPORT.md                    | ARCHIVE | Closed fix report; replaced by canonical docs/api/billing.md.                                        |
| docs/development/ADMIN_BUGS_I18N_REPORT.md                      | ARCHIVE | Closed fix report.                                                                                   |
| docs/development/ADMIN_CLEANUP_REPORT.md                        | ARCHIVE | Closed fix report.                                                                                   |
| docs/development/ADMIN_CODE_QUALITY_REPORT.md                   | ARCHIVE | Closed audit report; replaced by docs/standards/frontend-standards.md.                               |
| docs/development/ADMIN_COMPLETE_FIX_REPORT.md                   | ARCHIVE | Closed fix report.                                                                                   |
| docs/development/ADMIN_FIX_REPORT.md                            | ARCHIVE | Closed fix report.                                                                                   |
| docs/development/ADMIN_GROUP1_REPORT.md                         | ARCHIVE | Closed fix report.                                                                                   |
| docs/development/ADMIN_GROUP2_REPORT.md                         | ARCHIVE | Closed fix report.                                                                                   |
| docs/development/ADMIN_INVESTIGATION_REPORT.md                  | ARCHIVE | Closed investigation report.                                                                         |
| docs/development/ADMIN_RECOVERY_REPORT.md                       | ARCHIVE | Closed post-incident report.                                                                         |
| docs/development/ADMIN_REDESIGN_REPORT.md                       | ARCHIVE | Closed redesign report.                                                                              |
| docs/development/ADMIN_REMAINING_FIX_REPORT.md                  | ARCHIVE | Closed fix report.                                                                                   |
| docs/development/ADMIN_SESSION_FULL_REPORT.md                   | ARCHIVE | Combined session log of all admin work; outputs in product code.                                     |
| docs/development/ADMIN_SPRINT2_REPORT.md                        | DELETE  | Every row says "ALREADY IMPLEMENTED/DONE" — pure noise, not even a real report.                      |
| docs/development/ADMIN_UI_AUDIT_REPORT.md                       | ARCHIVE | Closed UI audit (47 issues resolved).                                                                |
| docs/development/ACCOUNT_IMPROVEMENTS_REPORT.md                 | ARCHIVE | Closed feature report.                                                                               |
| docs/development/BILLING_COMPLIANCE_WEBHOOKS_DLQ_AUDIT.md       | ARCHIVE | Closed audit absorbed by docs/api/billing.md + compliance.md + webhooks.md.                          |
| docs/development/CHANGEPLAN_DIALOG_INVESTIGATION.md             | ARCHIVE | Closed root-cause investigation.                                                                     |
| docs/development/POST_INCIDENT_DIAGNOSTIC.md                    | ARCHIVE | Closed post-incident diagnostic.                                                                     |
| docs/development/POST_INCIDENT_FIX_REPORT.md                    | ARCHIVE | Closed post-incident fix.                                                                            |
| docs/reports/RBAC_ERROR_HANDLING_REPORT.md                      | ARCHIVE | Closed RBAC sprint.                                                                                  |
| docs/reports/RBAC_PERMISSION_CLEANUP_REPORT.md                  | ARCHIVE | Closed RBAC cleanup.                                                                                 |
| docs/reports/SPRINT_3_REPORT.md                                 | ARCHIVE | Closed sprint.                                                                                       |
| docs/reports/SPRINT_A_DLQ_RETRY_ALL_REPORT.md                   | ARCHIVE | "Already implemented — no changes required" report.                                                  |
| docs/reports/SPRINT_AI_ARCH_REPORT.md                           | ARCHIVE | Closed sprint absorbed in canonical AI architecture docs.                                            |
| docs/reports/SPRINT_B\*\_REPORT.md (B, B2, B3)                  | ARCHIVE | Closed Stripe↔Paddle gateway switching sprints — replaced by docs/api/billing.md.                    |
| docs/reports/sprint-billing-v2.md                               | ARCHIVE | Closed billing-v2 sprint.                                                                            |
| docs/reports/SPRINT_C_COMPLIANCE_REPORT.md                      | ARCHIVE | Closed compliance sprint — replaced by docs/api/compliance.md.                                       |
| docs/reports/SPRINT_CRYPTO_REPORT.md                            | ARCHIVE | Closed encryption sprint — replaced by docs/security/SECRETS\*.md.                                   |
| docs/reports/SPRINT_D_DLQ_LIFECYCLE_REPORT.md                   | ARCHIVE | Closed DLQ sprint — replaced by docs/api/webhooks.md.                                                |
| docs/reports/SPRINT_DI2_PROCESSOR_WIRING_REPORT.md              | ARCHIVE | Closed DI wiring sprint.                                                                             |
| docs/reports/SPRINT_DI_INJECTION_REFACTOR_REPORT.md             | ARCHIVE | Closed DI refactor sprint.                                                                           |
| docs/reports/SPRINT_JSDOC_G1_REPORT.md                          | ARCHIVE | Closed JSDoc rollout.                                                                                |
| docs/reports/SPRINT_JSDOC_G2_REPORT.md                          | ARCHIVE | Closed JSDoc rollout.                                                                                |
| docs/reports/SPRINT_JSDOC_G3_REPORT.md                          | ARCHIVE | Closed JSDoc rollout.                                                                                |
| docs/reports/SPRINT_JSDOC_G4_REPORT.md                          | ARCHIVE | Closed JSDoc rollout.                                                                                |
| docs/reports/SPRINT_JSDOC_P2_REPORT.md                          | ARCHIVE | Closed @method/@component rollout.                                                                   |
| docs/reports/SPRINT_M011_DEPRECATED_MIGRATION_REPORT.md         | ARCHIVE | Closed deprecation migration.                                                                        |
| docs/reports/sprint-onboard.md                                  | ARCHIVE | Closed onboarding sprint.                                                                            |
| docs/reports/sprint-password-management.md                      | ARCHIVE | Closed password-management sprint.                                                                   |
| docs/reports/sprint-sec-fix.md                                  | ARCHIVE | Closed security-fix sprint — replaced by docs/security/OVERVIEW.md.                                  |
| docs/reports/SPRINT_SETTINGS_A_REPORT.md                        | ARCHIVE | Closed settings sprint.                                                                              |
| docs/reports/SPRINT_SETTINGS_B_REPORT.md                        | ARCHIVE | Closed settings sprint.                                                                              |
| docs/reports/SPRINT_SETTINGS_C_REPORT.md                        | ARCHIVE | Closed settings sprint.                                                                              |
| docs/reports/SPRINT_T_TESTS_REPORT.md                           | ARCHIVE | Closed retroactive test sprint.                                                                      |
| docs/reports/sprint-ux-polish.md                                | ARCHIVE | Closed UX polish sprint.                                                                             |
| docs/reports/audit-universal-saas-features.md                   | ARCHIVE | Closed audit; findings absorbed in active spec docs.                                                 |
| docs/reports/audits/account-model-audit-2026-03-29.md           | ARCHIVE | Closed model audit, predates current schema.                                                         |
| docs/reports/audits/app-separation-audit-2026-03-29.md          | ARCHIVE | Closed audit (separation completed in Sprint 0C).                                                    |
| docs/reports/audits/audit-2-2026-03-28.md                       | ARCHIVE | Closed verification round.                                                                           |
| docs/reports/audits/audit-remediation-2026-03-28.md             | ARCHIVE | Closed remediation summary.                                                                          |
| docs/reports/audits/backend-auth-audit-2026-03-29.md            | ARCHIVE | Closed auth audit — absorbed in docs/security/AUTH.md, docs/api/auth.md.                             |
| docs/reports/audits/code-first-audit-2026-04-10.md              | ARCHIVE | Closed code-first audit.                                                                             |
| docs/reports/audits/code-first-audit-fixes-2026-04-10.md        | ARCHIVE | Closed fixes for the above.                                                                          |
| docs/reports/audits/code-review-2026-03-29.md                   | ARCHIVE | One-time honest assessment; not a living doc.                                                        |
| docs/reports/audits/deep-audit-2026-03-27.md                    | ARCHIVE | Initial deep audit (precedes 2026-03-28 remediation).                                                |
| docs/reports/audits/legacy-audit-api-2026-04-03.md              | ARCHIVE | Closed legacy-code audit.                                                                            |
| docs/reports/audits/legacy-audit-client-2026-04-03.md           | ARCHIVE | Closed legacy-code audit.                                                                            |
| docs/reports/audits/preseparation-audit-2026-04-02.md           | ARCHIVE | Closed pre-separation audit.                                                                         |
| docs/reports/audits/preseparation-fix-2026-04-02.md             | ARCHIVE | Closed fix report.                                                                                   |
| docs/reports/audits/status-2026-05-06.md                        | ARCHIVE | Older status dashboard snapshot; supersede by status-2026-05-07.md.                                  |
| docs/reports/mutations/batch-2.md                               | ARCHIVE | Closed mutation session.                                                                             |
| docs/reports/mutations/batch-3.md                               | ARCHIVE | Closed mutation session.                                                                             |
| docs/reports/mutations/session-a.md                             | ARCHIVE | Closed mutation session.                                                                             |
| docs/reports/mutations/session-a2.md                            | ARCHIVE | Closed mutation session.                                                                             |
| docs/reports/mutations/session-b.md                             | ARCHIVE | Closed mutation session.                                                                             |
| docs/reports/mutations/session-c.md                             | ARCHIVE | Closed mutation session.                                                                             |
| docs/reports/mutations/session-d.md                             | ARCHIVE | Closed mutation session.                                                                             |
| docs/reports/mutations/session-e.md                             | ARCHIVE | Closed mutation session.                                                                             |
| docs/reports/mutations/tiktok-dlq.md                            | ARCHIVE | Closed mutation session.                                                                             |
| docs/reports/planning/legacy-api-verification-execution-plan.md | ARCHIVE | Closed exec plan; legacy work done.                                                                  |
| docs/reports/planning/master-development-plan.md                | ARCHIVE | SUPERSEDED — Phases 1-11 closed per validity-checks.                                                 |
| docs/reports/planning/plan-validity-check.md                    | ARCHIVE | Confirmation that phases 1-4 done; output captured.                                                  |
| docs/reports/planning/plan-validity-check-phases-5-11.md        | ARCHIVE | Confirmation that phases 5-11 done.                                                                  |
| docs/reports/sessions/\*.md (all 30 files)                      | ARCHIVE | Each is a one-time session log; canonical state lives in active spec docs.                           |
| docs/reports/testing/testing-audit-findings.md                  | ARCHIVE | Closed testing audit; data superseded by current Stryker reports.                                    |
| docs/reports/testing/testing-classification.md                  | ARCHIVE | Closed classification table; superseded by current backlogs.                                         |
| docs/reports/updates/u0.md..u6.md                               | ARCHIVE | Closed update sessions; canonical summary in dependency-update.md.                                   |
| docs/reports/updates/dependency-audit.md                        | ARCHIVE | Closed pre-update audit (76 vulns); current state is post-update.                                    |

**File-level DELETE candidates (3 total):**

| Path                                                     | Rec    | Why                                                                                                      |
| -------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| docs/development/ADMIN_SPRINT2_REPORT.md                 | DELETE | Every row says "ALREADY IMPLEMENTED" — confirms nothing was done in this sprint. 62 lines of pure noise. |
| docs/admin/e2e/TEST_STRUCTURE.md                         | DELETE | Visual directory tree, fully reproduced in docs/admin/e2e/README.md and the live filesystem. 433 lines.  |
| docs/reports/sessions/documentation-sprint-2026-03-28.md | DELETE | Older "doc inventory" sprint (87 docs), fully replaced by this `_DOCS_INVENTORY.md`.                     |

(Adjust upward to DELETE if Edward approves: the duplicate ADMIN\_\*\_REPORTS could collapse to a single bullet-list summary.)

## Methodology + caveats

- **Read scope.** `head -25` of every file via `stat`-batched `for f in $(find docs -name "*.md")` loop. For 6 ambiguous files (TOC-only / README) I read further.
- **Date signal.** ISO regex `20[0-9]{2}-[0-9]{2}-[0-9]{2}` applied to file body; if 0 matches found, fell back to filesystem `mtime`.
- **STALE.** mtime older than 2026-03-11 (60 days before today 2026-05-10) AND no in-file ISO date ≥ 2026-03-11. Note: many files have a recent mtime due to bulk JSDoc / formatting passes — the in-file date is the more honest signal.
- **SUPERSEDED.** Only flagged when the file's first 30 lines contain explicit "SUPERSEDED" or "superseded by" text. Two files self-declare (REMEDIATION_BATCHES.v1.md, CLAUDE_ALTERNATE_PLAN.md as historical) plus master-development-plan.md (implicitly by both validity-checks confirming phases done).
- **Overlap detection.** Per-subdirectory topic pass: grouped by inferred topic keyword (caching, auth, billing, etc.) and listed pairs/triples. Solapamiento column lists up to 3 paths per file; "Detected overlaps (by topic)" section consolidates by concept with a per-group recommendation.
- **Conservative defaults.** Files I couldn't confidently classify as DELETE are kept as KEEP (or ARCHIVE if clearly historical). The 3 explicit DELETE files are: an "all-already-done" sprint report, a visual directory tree fully reproduced elsewhere, and an old inventory sprint replaced by this very file.
- **Audience.** Primary audience inferred from content + path: docs/api/ → dev, docs/deployment/ → ops, docs/security/ → security, docs/product/ → product, docs/reports/testing/ + sessions related to tests → qa, docs/reports/audits/\* mixed but mostly dev.
- **Language match.** Spanish in `Resumen` for files written in Spanish (e.g. PLAN_MAESTRO.md, REMEDIATION_ROADMAP.md, sprint-onboard.md, INVESTOR_ES.md); English for the rest. Mixed docs use English.
- **Caveat on totals.** The Summary table totals sum to 229; "ACTIVE/SUPERSEDED/STALE/DRAFT/INDEX" counts add to 229. INDEX files (6) are also counted under their primary Tipo, so the INDEX column may overlap with index/guide rows.
- **What's NOT in this inventory.** Non-`.md` files in docs/ (e.g. `docs/reports/legacy/*.txt|.png`). They're outside the brief.
