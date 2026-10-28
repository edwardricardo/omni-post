# OmniPost Documentation

OmniPost is a multi-channel social media content management system: content is written once and published to the 11 platforms of the `Provider` enum in `infra/prisma/schema.prisma` (X, Instagram, Facebook, YouTube, TikTok, Snapchat, Telegram, Pinterest, LinkedIn, Bluesky, Threads), each with an adapter under `packages/providers/`.

This page indexes the living documents under `docs/`. [`CLAUDE.md`](../CLAUDE.md) at the repository root holds the development commands, the project structure and the fitness checks.

## Start here

| Document                                                        | What it covers                                                                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Getting Started](development/getting-started.md)               | Setup, environment, Docker services, local storage, tracing and mail, Turborepo, git and pull requests, troubleshooting             |
| [Environment Variables](deployment/ENVIRONMENT_VARIABLES.md)    | Variable reference by category; Master Plan DEF-97 tracks the required ones it misses                                               |
| [Testing Infrastructure](development/TESTING_INFRASTRUCTURE.md) | Frameworks, reach, CI, the `node:test` runner, chaos, provider contract and end-to-end tests, gates that cannot fail, open findings |
| [Coding Standards](development/CODING_STANDARDS.md)             | TypeScript, Result, error handling, testing, naming, JSDoc (canon)                                                                  |
| [Governance](GOVERNANCE.md)                                     | The two roles, Product Owner and Maintainer, who holds each and since when, and where decisions are recorded                        |

Quick start, with the versions `package.json` pins (Node `>=26.12.1 <27`, pnpm 12.6.0):

```bash
pnpm install
cp .env.example .env   # fill in every value marked (required)
docker compose up -d   # PostgreSQL, Redis and the local services
pnpm db:up             # preflight: reaches the PostgreSQL and Redis of .env, starts nothing
pnpm db:migrate
pnpm dev               # API (port 3000) and workers; pnpm dev:admin (3100), pnpm dev:client (3200)
```

## Canon and architecture

The four canon documents are loaded into every agent session by `CLAUDE.md`.

| Document                                                           | What it covers                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [Architecture Canon](architecture/ARCHITECTURE_CANON.md)           | Hexagonal, DDD, CQRS, Unit of Work, saga, dependency injection    |
| [Coding Standards](development/CODING_STANDARDS.md)                | TypeScript, testing, naming, JSDoc                                |
| [Security Canon](security/SECURITY_CANON.md)                       | Secrets, environment, tenant isolation, rate limiting, CVE floors |
| [Logging Canon](observability/LOGGING_CANON.md)                    | Logger factories, background tasks, caching                       |
| [Normalization Roadmap](architecture/NORMALIZATION_ROADMAP.md)     | Cross-cutting architecture, security and DX work, with status     |
| [Bounded Contexts](architecture/BOUNDED_CONTEXTS.md)               | The core packages and what each context owns                      |
| [Admin and Customer Parity](architecture/ADMIN_CUSTOMER_PARITY.md) | Ledger of admin and customer behaviour that must match            |
| [Schema Conventions](architecture/schema-conventions.md)           | Prisma schema conventions                                         |
| [Caching](architecture/caching.md)                                 | Why one cache port with two adapters; the HTTP response cache     |
| [Logging](architecture/logging.md)                                 | Logger threat model and redaction                                 |
| [Secrets and Environment](architecture/secrets-and-env.md)         | Typed env modules, test environment, secret handling rationale    |
| [OpenAPI Migration](architecture/openapi-migration.md)             | Route schemas to OpenAPI to the generated TypeScript types        |
| [Service Level Objectives](observability/SLO.md)                   | SLOs and the Prometheus queries behind them                       |
| [React Standards](frontend/REACT_STANDARDS.md)                     | Story requirement and the map to the frontend rules               |
| [Frontend Standards](standards/frontend-standards.md)              | Detailed rules for `apps/admin` and `apps/client`                 |

## Security

| Document                                                                   | What it covers                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Security Architecture](architecture/SECURITY.md)                          | Authentication, MFA, RBAC, encryption, rate limiting, audit                    |
| [Authentication](security/AUTH.md)                                         | Cookie authentication for the admin and client apps                            |
| [Multi-Tenant Guards](security/MULTI_TENANT_GUARDS.md)                     | Tenant guard, row level security and the tenant-scoped model list              |
| [Multi-Tenant Audit 2026-05-27](security/MULTI_TENANT_AUDIT_2026-05-27.md) | Retrospective audit of the tenant-scoped adapters                              |
| [Secrets](security/SECRETS.md)                                             | Where every secret lives, how to rotate it, the database-stored classes A to E |
| [Secrets Rotation Runbook](security/T0A_SECRETS_ROTATION_RUNBOOK.md)       | The rotation procedure; not yet executed (SECRETS-ROTATION-GOLIVE)             |
| [Dependency Audit Policy](security/dependency-audit-policy.md)             | When an advisory may be ignored                                                |
| [Security Testing Framework](security/SECURITY_TESTING_FRAMEWORK.md)       | The `security/tests` suites; read its status note first                        |

## API

The route reference is generated: [`packages/shared/src/api-generated/types.gen.ts`](../packages/shared/src/api-generated/types.gen.ts) holds every registered method and path, and the running API serves the same OpenAPI document through Swagger. `docs/api/` keeps one hand-written page, the saga page below.

| Document                             | What it covers                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [API Reference](architecture/API.md) | Hand-written endpoint guide; Master Plan DEF-80 tracks the routes it describes that the generated table does not have |
| [Saga Orchestration](api/saga.md)    | Saga API and step classes                                                                                             |

## Development

| Document                                                                               | What it covers                                                   |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Testing Re-foundation](development/TESTING_REFOUNDATION.md)                           | Progress tracker of the testing re-foundation                    |
| [Testing Re-foundation Plan](development/TESTING_REFOUNDATION_PLAN.md)                 | Fixed plan of the testing re-foundation, phases 0–9              |
| [Testing Re-foundation Measurements](development/TESTING_REFOUNDATION_MEASUREMENTS.md) | Toolchain-lag and OSV measurements of the testing re-foundation  |
| [Foundation Practices](development/FOUNDATION_PRACTICES.md)                            | Practices the next application adopts from its first commit      |
| [Saga Test Suites](development/saga-test-suites.md)                                    | Running the saga test suites                                     |
| [Knip Baseline](development/knip-baseline.md)                                          | The dead-code gate and its ratchet; the jscpd duplicate baseline |
| [Env Backup and Restore](development/ENV_BACKUP.md)                                    | Backing up and restoring `.env`                                  |
| [Admin to Client Migration Guide](development/ADMIN_TO_CLIENT_MIGRATION_GUIDE.md)      | Admin fixes and patterns mapped to `apps/client`                 |
| [Technical Stack](technical/DEPENDENCIES.md)                                           | Stack reference with measured versions, updated with each change |

## Deployment

| Document                                                     | What it covers                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [Deployment Checklist](deployment/DEPLOYMENT_CHECKLIST.md)   | What an operator configures before a deployment and verifies after it  |
| [Environment Variables](deployment/ENVIRONMENT_VARIABLES.md) | Variable reference                                                     |
| [Image Build Model](deployment/image-build-model.md)         | How the `api` and `workers` images reach a production tree             |
| [Container Base Images](deployment/base-images.md)           | The images' distroless bases, their digest pins and what verifies them |

## Runbooks

| Document                                                                   | What it covers                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [API Error Rate](runbooks/alert-api-error-rate.md)                         | Alert `ApiErrorRateHigh`                                         |
| [API Latency](runbooks/alert-api-latency.md)                               | Alert `ApiLatencyP99High`                                        |
| [Outbox Lag](runbooks/alert-outbox-lag.md)                                 | Alert `OutboxLagHigh`                                            |
| [Saga Timeout](runbooks/alert-saga-timeout.md)                             | Alert `SagaTimeoutSpike`                                         |
| [Admin Refresh Token Replay](runbooks/alert-admin-refresh-token-replay.md) | Alert `AdminRefreshTokenReplayRejected`                          |
| [MFA Backup Code Reuse](runbooks/alert-mfa-backup-code-reuse.md)           | Alert `MfaBackupCodeReuseRejected`                               |
| [Chaos: Saga Step Retry](runbooks/chaos-saga-step-retry.md)                | Chaos scenario of a transient saga step failure                  |
| [Provider Contract Failure](runbooks/provider-contract-failure.md)         | A failing provider contract test; its nightly alert is not wired |

## Features

| Document                                                         | What it covers                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [Provider Capabilities](features/provider-capabilities.md)       | Capability matrix, per-provider details, authentication, rate limits, the adapter interface, adding a provider |
| [Billing Gateways](features/billing-gateways.md)                 | Payment gateways and country routing                                                                           |
| [Media Storage](features/media-storage.md)                       | Storage configuration, private access, health and upload limits                                                |
| [Bulk Scheduling Redesign](features/bulk-scheduling-redesign.md) | Post targeting model and bulk scheduling                                                                       |
| [Templates](features/templates.md)                               | Template engine, A/B testing, versioning                                                                       |
| [Webhook Ingest Wiring](features/WEBHOOK_INGEST_WIRING_ES.md)    | Wiring the inbound webhook ingestion pipeline                                                                  |

## Product and plan

| Document                                                                           | What it covers                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Master Plan](product/MASTER_PLAN_ES.md)                                           | The consolidated plan: every open item, its status and dashboard |
| [Feature Trace Matrix](product/FEATURE_TRACE_MATRIX_ES.md)                         | Each feature traced to the code that implements it               |
| [Competitive Analysis](product/COMPETITIVE_ANALYSIS_ES.md)                         | OmniPost against the 2026 market                                 |
| Investor brief ([EN](product/INVESTOR_EN.md), [ES](product/INVESTOR_ES.md))        | Investor overview                                                |
| Marketing ([EN](product/MARKETING_EN.md), [ES](product/MARKETING_ES.md))           | Marketing copy                                                   |
| [Full Repository Assessment 2026-06-29](audits/FULL_REPO_ASSESSMENT_2026-06-29.md) | The audit the Master Plan is built on                            |
| [Audit Methodology](audits/AUDIT_METHODOLOGY.md)                                   | Method of the full-repository audits                             |

## Reports

Live ledgers, updated as work lands:

| Document                                                              | What it holds                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| [Review Suggestions Book](reports/review-suggestions-book.md)         | Review suggestions kept for later, with their status |
| [Detected Smells Backlog](reports/roadmap-detected-smells-backlog.md) | Detected smells (SMELL-NN) and their verdicts        |
| [Unused Code Inventory](reports/UNUSED_CODE_INVENTORY.md)             | Unused code, classified, with its disposition        |

Dated evidence, cited by ADRs, fitness checks and the Master Plan:

| Document                                                            | What it records                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| [CI Cache Integrity Audit](reports/CI_CACHE_INTEGRITY_AUDIT.md)     | Integrity of the CI caches                              |
| [N-SEC-7 Disposition](reports/N_SEC_7_CLUSTER_B_MFA_DISPOSITION.md) | Disposition of the `workstream/cluster-b-mfa` commits   |
| [RLS Posture Red Baseline](reports/RLS_POSTURE_RED_BASELINE.md)     | Row level security observed failing before the app role |
| [Tenant RLS A/B Measurement](reports/TENANT_RLS_AB_MEASUREMENT.md)  | Tenant isolation measurement on the post trio           |

## Legal, compliance and support

The inventories under `legal/inventories/` and the support index and non-features pages are generated (`pnpm legal:inventory`, `pnpm support:index`) and checked in CI (`pnpm check:legal`, `pnpm check:support`); never edit them by hand.

| Document                                                                            | What it covers                                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Legal Facts Register](legal/README.md)                                             | How the register grows, its inventories and pending decisions                |
| [Processing Register](legal/REGISTER.md)                                            | Record of processing activities (GDPR art. 30)                               |
| [Personal Data Inventory](legal/inventories/personal-data.generated.md)             | Generated: database fields that may hold personal data                       |
| [Cookies and Storage Inventory](legal/inventories/cookies-and-storage.generated.md) | Generated: cookies and browser storage keys                                  |
| [OAuth Scopes Inventory](legal/inventories/oauth-scopes.generated.md)               | Generated: OAuth scopes requested per provider                               |
| [Subprocessors Inventory](legal/inventories/subprocessors.generated.md)             | Generated: third-party services the product sends data to                    |
| [Data Retention Calendar](compliance/RETENTION_CALENDAR.md)                         | Retention window per data type and the job that enforces it                  |
| [Support Documentation](support/README.md)                                          | Generated index: one page per feature, and where to look when a ticket opens |
| [Non-features and Coverage](support/NON_FEATURES.md)                                | Generated: every capability candidate and the support page that covers it    |
| [Support Page Template](support/_TEMPLATE.md)                                       | The template every support page follows                                      |

## Architecture decision records

ADRs live in [`technical/`](technical/) as `ADR-NNNN-*.md`; ADR-0001 holds the template. The number 0020 is used twice.

| ADR                                                                           | Decision                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [0001](technical/ADR-0001-agent-orchestration.md)                             | Agent orchestration engine and schema-validated provider substrate             |
| [0002](technical/ADR-0002-hexagonal-architecture.md)                          | Hexagonal architecture (ports and adapters) over modular Fastify               |
| [0003](technical/ADR-0003-domain-driven-design.md)                            | Domain-driven design: entities, value objects, aggregates, domain events       |
| [0004](technical/ADR-0004-cqrs-command-query-separation.md)                   | CQRS: command and query separation                                             |
| [0005](technical/ADR-0005-unit-of-work-asynclocalstorage.md)                  | Unit of Work with `PrismaUnitOfWork` and `AsyncLocalStorage`                   |
| [0006](technical/ADR-0006-result-type-over-throws.md)                         | `Result<T, E>` over thrown exceptions across layer boundaries                  |
| [0007](technical/ADR-0007-di-composition-root.md)                             | Dependency injection through the composition root                              |
| [0008](technical/ADR-0008-saga-pattern-richardson-azure.md)                   | Saga pattern aligned with Richardson and the Azure guidance                    |
| [0009](technical/ADR-0009-permission-enum-to-core-domain.md)                  | The `Permission` enum moves to `@core/domain/auth/`                            |
| [0010](technical/ADR-0010-ai-contracts-to-core-domain.md)                     | The AI contracts move to `@core/domain/ai/`                                    |
| [0011](technical/ADR-0011-application-services-to-core-workstream.md)         | Closure of the application-services-to-core workstream                         |
| [0012](technical/ADR-0012-fitness-functions-architecture-tests.md)            | Fitness functions as the architecture-test layer in CI                         |
| [0013](technical/ADR-0013-three-logger-factory-model.md)                      | The three-logger factory model and redaction                                   |
| [0014](technical/ADR-0014-multi-tenant-isolation-guards.md)                   | Multi-tenant isolation guards, three layers                                    |
| [0015](technical/ADR-0015-brute-force-protection-port-canon.md)               | Brute-force protection: one port and a Redis adapter                           |
| [0016](technical/ADR-0016-channel-canonical-post-targeting.md)                | Channel-canonical post targeting and the removal of `PublishingQueue`          |
| [0017](technical/ADR-0017-production-build-bundler.md)                        | Production build model: transpile-only, per-package `tsc` emit                 |
| [0018](technical/ADR-0018-dependency-freshness-canon.md)                      | Dependency freshness: latest stable, pinned exact, single version              |
| [0019](technical/ADR-0019-pnpm-11-migration.md)                               | The pnpm 11 migration                                                          |
| [0020](technical/ADR-0020-audit-actor-exclusive-arc.md)                       | Audit actor polymorphism through an additive exclusive arc                     |
| [0020](technical/ADR-0020-tenant-context-at-boundaries.md)                    | Tenant context established at entry boundaries                                 |
| [0021](technical/ADR-0021-trusted-proxy-peer-model.md)                        | Trusted-proxy peer model instead of hop counting                               |
| [0022](technical/ADR-0022-rls-enforcement-posture.md)                         | RLS enforcement posture: a non-owner `omnipost_app` role                       |
| [0023](technical/ADR-0023-unit-of-work-result-aware-transaction.md)           | `UnitOfWork.executeResultInTransaction`, a Result-aware transaction seam       |
| [0024](technical/ADR-0024-billing-currency-and-price-catalog.md)              | Billing currency and the per-currency price lists                              |
| [0025](technical/ADR-0025-payment-gateway-selection-and-country-routing.md)   | Payment gateways configured in Admin, routed by billing country                |
| [0026](technical/ADR-0026-non-payment-lifecycle.md)                           | Non-payment lifecycle: one billing-access state machine                        |
| [0027](technical/ADR-0027-consumer-sales-and-tax-handling.md)                 | Consumer sales and tax handling                                                |
| [0028](technical/ADR-0028-storage-configuration-and-media-access.md)          | Media storage: configured in Admin, private buckets, signed reads              |
| [0029](technical/ADR-0029-media-upload-limits.md)                             | Media upload limits                                                            |
| [0030](technical/ADR-0030-pricing-model.md)                                   | Pricing model: per connected channel, per workspace, prepaid terms             |
| [0031](technical/ADR-0031-domain-vocabulary.md)                               | Domain vocabulary: Organization, Workspace, Member, Channel                    |
| [0032](technical/ADR-0032-architecture-gate-dependency-cruiser.md)            | One architecture gate: dependency-cruiser with a shrink-only baseline          |
| [0033](technical/ADR-0033-layer-boundaries-and-composition-root-injection.md) | Layer boundaries: routes receive their dependencies from the composition root  |
| [0034](technical/ADR-0034-credential-model.md)                                | Credential model: placement, one encryption seam, key custody, rotation        |
| [0035](technical/ADR-0035-stories-part-of-creating-ui.md)                     | Stories are part of creating UI                                                |
| [0036](technical/ADR-0036-dependency-update-cadence.md)                       | Dependency update cadence: security immediate, a Tuesday window, 30-day budget |
| [0037](technical/ADR-0037-storybook-nextjs-vite-patch-for-next-16-4.md)       | A patched `@storybook/nextjs-vite` 10.6.1 for next 16.4                        |
| [0038](technical/ADR-0038-node-26-ahead-of-lts.md)                            | Node 26 ahead of its LTS date                                                  |
| [0039](technical/ADR-0039-decorative-demolition-coverage-exception.md)        | Decorative-test demolition: a coverage-floor descent under a ledger marker     |
| [0040](technical/ADR-0040-artifact-language-and-role-attribution.md)          | English as the only artifact language; artifacts name roles, never a person    |
