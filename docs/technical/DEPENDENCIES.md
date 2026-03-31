# OmniPost — Technical Stack Reference

> This document describes the complete technical stack used in OmniPost development. It is intended for developers evaluating the project or onboarding to the team.

---

## Repository Structure

### Monorepo

| Tool       | Version | Purpose                                   |
| ---------- | ------- | ----------------------------------------- |
| pnpm       | 10.16.0 | Package manager with workspace support    |
| Turbo      | 2.8.21  | Monorepo build orchestration with caching |
| Node.js    | 24      | Runtime (latest LTS)                      |
| TypeScript | 6.0.2   | Language — strict mode throughout         |

### Workspace Overview

| Workspace              | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| apps/api               | Fastify backend — all business logic, 709 TS files |
| apps/client            | Next.js customer product — 45 pages                |
| apps/admin             | Next.js owner portal — 13 pages                    |
| apps/workers           | BullMQ background job workers — 6 active           |
| packages/ports         | Technology-free interface definitions              |
| packages/shared        | Shared types, events, CQRS primitives              |
| packages/adapters/\*   | Infrastructure adapters (10 packages)              |
| packages/providers/\*  | 10 social platform adapters + shared               |
| packages/ui            | Shared React components                            |
| packages/core          | Cross-cutting concerns (engine, threading)         |
| packages/monitoring    | Circuit breaker, health checks                     |
| packages/observability | Logger, OpenTelemetry instrumentation              |
| packages/api-common    | Shared route utilities, CSV export                 |
| infra/prisma           | Database schema, migrations, client                |

---

## Backend (apps/api)

### Core Framework

| Package                       | Version | Purpose                 | Why Chosen                                                    |
| ----------------------------- | ------- | ----------------------- | ------------------------------------------------------------- |
| fastify                       | 5.6.1   | HTTP server             | 2x Express throughput, native TypeScript, schema-first routes |
| fastify-plugin                | 5.0.1   | Plugin system           |                                                               |
| fastify-type-provider-zod     | 6.1.0   | Zod schema integration  | Type-safe request/response validation                         |
| @fastify/cors                 | 11.1.0  | CORS middleware         |                                                               |
| @fastify/cookie               | 11.0.2  | Cookie handling         | httpOnly cookies for auth sessions                            |
| @fastify/helmet               | 13.0.1  | Security headers        |                                                               |
| @fastify/swagger              | 9.7.0   | OpenAPI spec generation |                                                               |
| @fastify/websocket            | 11.2.0  | WebSocket support       | SSE notifications                                             |
| @fastify/rate-limit           | 10.3.0  | Rate limiting           | Per-route configurable                                        |
| @scalar/fastify-api-reference | 1.49.5  | API documentation UI    | Interactive Scalar docs                                       |

### Architecture

**Pattern:** Hexagonal Architecture (Ports and Adapters) + DDD + CQRS + Saga + Outbox

The domain layer imports nothing external — no Prisma, no Fastify, no Redis. Application use cases depend only on port interfaces. Infrastructure adapters implement those ports. This means swapping, adding, or removing a provider requires zero changes to business logic. The Post aggregate does not know if it's publishing to X or Bluesky.

**CQRS:** Commands (mutations) return `Result<T, Error>`, go through UnitOfWork, and dispatch domain events. Queries return DTOs directly from read-optimized repositories. Each can be scaled independently.

**Saga pattern:** Coordinates multi-step publishing across platforms. Each step is a local transaction with compensating actions.

**Outbox pattern:** Domain events are written to the outbox in the same DB transaction as the aggregate save. A relay process dispatches them to BullMQ queues.

### Database

| Package        | Version     | Purpose                | Why Chosen                           |
| -------------- | ----------- | ---------------------- | ------------------------------------ |
| @prisma/client | 7.4.1       | Generated query client | Type-safe queries from schema        |
| prisma         | 7.4.1       | ORM + migrations       | Migration tooling, introspection     |
| postgresql     | 16 (Docker) | Primary database       | ACID, JSON support, mature ecosystem |

**Schema size:** 98 models. This reflects actual business complexity: post publication across 10 providers with approvals, campaigns, recurring schedules, analytics ingestion, inbox sync, AI enrichment, billing, and referrals.

### Authentication

| Package              | Version | Purpose                          |
| -------------------- | ------- | -------------------------------- |
| jsonwebtoken         | 9.0.2   | JWT signing/verification         |
| argon2               | 0.44.0  | Password hashing (argon2id)      |
| @node-saml/node-saml | 5.1.0   | SAML 2.0 SSO                     |
| openid-client        | 6.8.2   | OpenID Connect (PKCE)            |
| otplib               | 12.0.1  | TOTP MFA                         |
| qrcode               | 1.5.4   | QR code generation for MFA setup |

**Two separate auth systems:**

- `AdminUser` — owner portal (SUPER_ADMIN, ADMIN, SUPPORT roles). Separate JWT secret, `admin-session` cookie.
- `CustomerUser` — customer product (OWNER, MANAGER, MEMBER, VIEWER roles). Separate JWT secret, `customer-session` cookie.
  A customer token cannot access admin routes by design — cryptographic separation, not just route separation.

### Queue / Background Jobs

| Package | Version | Purpose      | Why Chosen                                              |
| ------- | ------- | ------------ | ------------------------------------------------------- |
| bullmq  | 5.58.9  | Job queue    | Redis-backed, TypeScript-native, enterprise reliability |
| ioredis | 5.7.0   | Redis client | Required by BullMQ                                      |

**14 active queues:**

| Queue                 | Purpose                                        |
| --------------------- | ---------------------------------------------- |
| PUBLISH               | Post delivery to provider APIs                 |
| WEBHOOK_PROCESSING    | Inbound webhook event processing               |
| WEBHOOK_DEAD_LETTER   | Failed webhook permanent storage               |
| DEAD_LETTER_QUEUE     | General failed operations                      |
| INTEGRATION_EVENTS    | CQRS domain event dispatching                  |
| FAILED_OPERATIONS_DLQ | Circuit breaker failures                       |
| ANALYTICS_AGGREGATION | Analytics data ingestion (every 6h)            |
| REPORT_GENERATION     | Scheduled report generation                    |
| RECURRING_POSTS       | Recurring post creation from templates         |
| INBOX_SYNC            | Message polling from providers (every 30min)   |
| DETECT_REPURPOSE      | Autonomous high-performer detection            |
| GENERATE_REPURPOSE    | AI variant generation for repurposing          |
| TRIAGE_INBOX          | AI message classification and reply suggestion |
| TREND_RADAR           | Trending topic fetch and relevance scoring     |

### AI / LLM

| Package               | Version | Purpose           | Why Chosen                                     |
| --------------------- | ------- | ----------------- | ---------------------------------------------- |
| openai                | 6.33.0  | OpenAI API client | GPT-4 for content generation, primary provider |
| @google/genai         | 1.20.0  | Google Gemini API | Fast fallback, cost-efficient for simple tasks |
| (Perplexity via REST) | —       | Perplexity Sonar  | Web-aware predictions, no SDK needed           |

**Provider routing:** Automatic selection based on task type. Content generation routes to OpenAI. Predictions route to Perplexity. Fast tasks route to Gemini. Rate limiting per provider with intelligent fallback to next available.

### Email

| Package                 | Version | Purpose                                 |
| ----------------------- | ------- | --------------------------------------- |
| @react-email/components | 1.0.10  | Email template components (React-based) |
| @react-email/render     | 2.0.4   | Server-side HTML rendering              |
| (Resend via REST)       | —       | Email delivery (native fetch, no SDK)   |

### Payment

| Package                 | Version | Purpose                             |
| ----------------------- | ------- | ----------------------------------- |
| stripe                  | 21.0.1  | Stripe payment adapter              |
| @paddle/paddle-node-sdk | 3.6.1   | Paddle adapter (Merchant of Record) |

Both behind `IPaymentAdapter` port. Switching providers = one environment variable (`PAYMENT_PROVIDER=stripe` or `paddle`).

### Storage

| Package                       | Version | Purpose                     |
| ----------------------------- | ------- | --------------------------- |
| @aws-sdk/client-s3            | 3.894.0 | S3-compatible storage       |
| @aws-sdk/s3-presigned-post    | 3.894.0 | Direct upload presigning    |
| @aws-sdk/s3-request-presigner | 3.894.0 | Download URL presigning     |
| cloudinary                    | 2.0.0   | Alternative storage adapter |

### Validation

| Package              | Version  | Purpose                                           |
| -------------------- | -------- | ------------------------------------------------- |
| zod                  | 4.3.6    | Schema validation — TypeScript-native, composable |
| validator            | 13.15.15 | String validation utilities                       |
| isomorphic-dompurify | 2.28.0   | HTML sanitization                                 |

### Observability

| Package                                 | Version | Purpose                             |
| --------------------------------------- | ------- | ----------------------------------- |
| @opentelemetry/sdk-node                 | 0.214.0 | OpenTelemetry SDK                   |
| @opentelemetry/api                      | 1.9.1   | Tracing API                         |
| @opentelemetry/instrumentation-fastify  | 0.57.0  | Fastify auto-instrumentation        |
| @opentelemetry/instrumentation-http     | 0.214.0 | HTTP auto-instrumentation           |
| @opentelemetry/instrumentation-redis    | 0.62.0  | Redis auto-instrumentation          |
| @opentelemetry/exporter-prometheus      | 0.214.0 | Prometheus metrics export           |
| @opentelemetry/exporter-trace-otlp-http | 0.214.0 | OTLP trace export                   |
| pino                                    | 10.3.1  | High-performance structured logging |
| prom-client                             | 15.1.3  | Prometheus metrics client           |

### Resilience

| Package | Version | Purpose         |
| ------- | ------- | --------------- |
| opossum | 9.0.0   | Circuit breaker |

---

## Frontend — Customer Product (apps/client)

### Core

| Package    | Version | Purpose                                         |
| ---------- | ------- | ----------------------------------------------- |
| next       | 16.1.6  | React framework (App Router, server components) |
| react      | 19.2.4  | UI library                                      |
| react-dom  | 19.2.4  | DOM rendering                                   |
| typescript | 6.0.2   | Language                                        |

### Data Fetching & State

| Package                        | Version | Purpose                                               |
| ------------------------------ | ------- | ----------------------------------------------------- |
| @tanstack/react-query          | 5.90.2  | Server state management (caching, background refetch) |
| @tanstack/react-query-devtools | 5.90.2  | DevTools for debugging queries                        |
| zustand                        | 5.0.12  | Client state (notifications store)                    |

### UI Components

| Package                  | Version            | Purpose                                   |
| ------------------------ | ------------------ | ----------------------------------------- |
| tailwindcss              | 4.2.1              | Utility CSS framework                     |
| lucide-react             | 0.544.0            | Icon library                              |
| radix-ui                 | (via @packages/ui) | Accessible component primitives           |
| class-variance-authority | 0.7.0              | Component variant management              |
| recharts                 | 2.15.0             | Data visualization (analytics dashboards) |
| @emoji-mart/react        | 1.1.1              | Emoji picker                              |
| fuse.js                  | 7.0.0              | Client-side fuzzy search                  |

### Rich Text Editor

| Package                           | Version | Purpose                    |
| --------------------------------- | ------- | -------------------------- |
| @tiptap/core                      | 3.6.1   | Rich text editor framework |
| @tiptap/react                     | 3.6.1   | React integration          |
| @tiptap/starter-kit               | 3.6.1   | Basic editor features      |
| @tiptap/extension-character-count | 3.6.1   | Character counting         |
| @tiptap/extension-color           | 3.6.1   | Text color                 |
| @tiptap/extension-highlight       | 3.6.1   | Text highlighting          |
| @tiptap/extension-link            | 3.6.1   | Link handling              |
| @tiptap/extension-placeholder     | 3.6.1   | Placeholder text           |
| @tiptap/extension-text-style      | 3.6.1   | Text styling               |
| @tiptap/extension-typography      | 3.6.1   | Smart typography           |

### Utilities

| Package              | Version | Purpose                         |
| -------------------- | ------- | ------------------------------- |
| date-fns             | 4.1.0   | Date manipulation               |
| cronstrue            | 3.13.0  | Human-readable cron expressions |
| papaparse            | 5.5.3   | CSV parsing (bulk upload)       |
| @monaco-editor/react | 4.6.0   | Code editor (template editing)  |

---

## Frontend — Owner Portal (apps/admin)

Same core stack as apps/client (Next.js 16.1.6, React 19.2.4, Tailwind, Recharts). 13 pages focused on platform administration: accounts, subscriptions, pricing, security, compliance, audit logs, webhooks, executive dashboard.

---

## Background Workers (apps/workers)

6 active workers processing 14 queues:

| Worker                | Queue(s)                             | Concurrency | Schedule                  |
| --------------------- | ------------------------------------ | ----------- | ------------------------- |
| publishWorker         | PUBLISH                              | 5           | On-demand                 |
| analyticsIngestWorker | ANALYTICS_AGGREGATION                | 5           | Every 6 hours             |
| inboxSyncWorker       | INBOX_SYNC                           | 5           | Every 30 minutes          |
| repurposeWorker       | DETECT_REPURPOSE, GENERATE_REPURPOSE | 3/2         | After analytics ingestion |
| inboxTriageWorker     | TRIAGE_INBOX                         | 5           | After message ingestion   |
| trendRadarWorker      | TREND_RADAR                          | 3           | Every 2 hours             |

---

## Social Platform Adapters (packages/providers)

Each platform is a separate workspace package implementing `IProviderAdapter` from `packages/ports`. Adding platform 11 requires a new package — zero changes to core business logic.

| Platform    | SDK/Library                                    | Capabilities                                 |
| ----------- | ---------------------------------------------- | -------------------------------------------- |
| X (Twitter) | twitter-api-v2 1.27.0                          | Publish, analytics, inbox, threads           |
| Instagram   | Direct API (fetch)                             | Publish, stories, analytics, inbox, carousel |
| Facebook    | Direct API (fetch)                             | Publish, analytics, inbox                    |
| YouTube     | googleapis 160.0.0, google-auth-library 9.14.1 | Publish, analytics                           |
| TikTok      | axios 1.7.7                                    | Publish, analytics, hashtag discovery        |
| LinkedIn    | Direct API (fetch)                             | Publish, analytics, inbox                    |
| Pinterest   | Direct API (fetch)                             | Publish, analytics                           |
| Snapchat    | Direct API (fetch)                             | Publish, analytics                           |
| Telegram    | Direct API (fetch)                             | Publish, inbox                               |
| Bluesky     | @atproto/api 0.13.28                           | Publish, AT Protocol                         |

---

## Shared Packages

### packages/ports

Technology-free interface definitions. No runtime dependencies.

Defined ports: `IProviderAdapter`, `IPaymentAdapter`, `IEmailAdapter`, `ICrmAdapter`, `IStorageAdapter`, `IQueuePort`, `ICachePort`

### packages/shared

Dependencies: date-fns 4.1.0, handlebars 4.7.8

Contains: Result types (`ok()`, `err()`), domain event definitions, CQRS primitives, saga types, shared enums, provider configuration.

### packages/ui

Shared React components: Button, Dialog, Input, Label, Textarea, Tabs, Badge, Alert, Toast, Tooltip, Progress, Select, Switch, Slider, Checkbox, ScrollArea, Separator, Card, DropdownMenu, Avatar. Also includes TipTap content editor and emoji picker.

Built with: radix-ui 1.4.3, class-variance-authority 0.7.0, clsx 2.1.1, tailwind-merge 2.6.0.

---

## Testing

### Stack

| Package                        | Version | Purpose                              |
| ------------------------------ | ------- | ------------------------------------ |
| vitest                         | 4.0.18  | Test runner (Vite-based, native ESM) |
| @vitest/coverage-v8            | 4.0.18  | Coverage provider                    |
| @testing-library/react         | 16.1.0  | Component testing                    |
| @testing-library/dom           | 10.4.0  | DOM utilities                        |
| @testing-library/jest-dom      | 6.6.3   | Custom matchers                      |
| jsdom                          | 25.0.1  | Browser environment simulation       |
| @playwright/test               | 1.55.1  | E2E testing                          |
| @stryker-mutator/core          | 9.6.0   | Mutation testing                     |
| @stryker-mutator/vitest-runner | 9.6.0   | Vitest integration for Stryker       |
| @faker-js/faker                | 10.0.0  | Test data generation                 |

### Metrics

| Metric              | Value                                     |
| ------------------- | ----------------------------------------- |
| Test files          | 351                                       |
| Total tests         | 7,159                                     |
| Test failures       | 0                                         |
| Coverage thresholds | Lines 55%, Functions 55%, Branches 45%    |
| Mutation testing    | Stryker configured (break threshold: 52%) |

### Strategy

**Unit tests** (majority): In-memory repositories, mocked adapters. Every use case tested independently.

**Component tests**: React Testing Library for security-critical UI (role-based visibility in TeamMemberRow).

**E2E tests**: Playwright for auth flows and critical user journeys.

**Architecture boundary tests**: 7 grep-based CI fitness functions ensuring no layer violations.

---

## Code Quality

| Tool        | Version | Purpose                           |
| ----------- | ------- | --------------------------------- |
| eslint      | 9.36.0  | Static analysis (flat config, v9) |
| prettier    | 3.8.1   | Code formatting                   |
| husky       | 9.1.7   | Git hooks                         |
| lint-staged | 16.4.0  | Pre-commit staged file linting    |
| knip        | 6.1.0   | Dead code detection               |
| madge       | 8.0.0   | Circular dependency detection     |
| jscpd       | 4.0.8   | Copy-paste detection              |

### Standards

- Strict TypeScript (`strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`)
- Zero `any` in production code
- All use cases return `Result<T, E>` — no unhandled exceptions
- Exact version pinning — no `^` or `~` in any package.json
- Architecture boundaries enforced by CI fitness functions

---

## DevOps / Infrastructure

### Docker Compose Services

| Service    | Image                       | Port  | Purpose               |
| ---------- | --------------------------- | ----- | --------------------- |
| PostgreSQL | postgres:16                 | 5432  | Primary database      |
| Redis      | redis:7                     | 6379  | BullMQ queues + cache |
| Grafana    | grafana:11.2.2              | 3001  | Metrics dashboards    |
| Prometheus | prom/prometheus:v2.48.1     | 9090  | Metrics collection    |
| Jaeger     | jaegertracing/jaeger:latest | 16686 | Distributed tracing   |

### GitHub Actions Workflows (7)

1. **ci.yml** — Main CI: lint, test, build, security, provider tests, frontend tests
2. **security-testing.yml** — SAST (CodeQL), DAST, dependency scanning (daily at 2 AM UTC)
3. **performance.yml** — Performance testing with autocannon/loadtest
4. **nightly.yml** — Nightly builds
5. **production-ci.yml** — Production deployment checks
6. **dependency-updates.yml** — Automated dependency management
7. **cleanup.yml** — Cleanup tasks

### Required External Services

| Service          | Used By       | Purpose                       |
| ---------------- | ------------- | ----------------------------- |
| PostgreSQL       | API           | Primary database              |
| Redis            | API + Workers | BullMQ queues + cache         |
| S3-compatible    | API           | Media storage                 |
| Resend           | API           | Transactional email           |
| Stripe or Paddle | API           | Payment processing            |
| OpenAI           | API           | AI content generation (GPT-4) |
| Google Gemini    | API           | AI fallback provider          |
| Perplexity       | API           | Web-aware AI predictions      |

### Social Platform Registrations Required

X Developer Portal, Meta (Instagram + Facebook), Google (YouTube), TikTok for Developers, LinkedIn Developer, Pinterest Developers, Snapchat for Business, Telegram Bot API, Bluesky AT Protocol.

---

## Architecture Decision Records

### Why Hexagonal Architecture?

10 provider adapters, each with different APIs. Hexagonal means swapping, adding, or removing a provider requires no changes to business logic. The Post aggregate does not know if it is publishing to X or Bluesky. Adding platform 11 requires approximately 200 lines in a new adapter package.

### Why CQRS?

Read models optimized independently of write models. Analytics queries do not go through the same path as publishing commands. Each can be scaled independently. Queries bypass the domain layer and return DTOs directly.

### Why BullMQ over simpler alternatives?

Publishing a post to 10 platforms simultaneously, with retries, dead letter queues, and rate limiting per provider, requires enterprise queue infrastructure. Cron jobs would fail silently. BullMQ provides Redis-backed reliability with native TypeScript support.

### Why separate CustomerUser from AdminUser?

Platform owner (Edward) and customers are different user types with different permissions, different data access, and different security requirements. Separate JWT secrets, separate middleware, separate session cookies. A customer token cannot access admin routes by design.

### Why provider+account pricing instead of seats?

Users do not buy seats — they buy access to platforms. Aligning pricing with value delivered, not headcount. A 50-person agency with 1 social account pays the same as a 2-person team with 1 account. Volume discounts reward growth.

### Why 98 Prisma models?

Post publication across 10 providers with approvals, campaigns, recurring schedules, analytics ingestion, inbox sync, AI enrichment, billing, referrals, and autonomous features is not a simple CRUD app. The domain models reflect actual business complexity. The tradeoff: higher initial ceremony, lower long-term coupling.

---

## Development Setup

### Prerequisites

- Node.js 24
- pnpm 10.16.0+
- Docker (for PostgreSQL + Redis)

### Quick Start

```bash
git clone <repo>
cd omnipost
pnpm install
cp apps/api/.env.example apps/api/.env
# Fill in required environment variables
docker-compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

### Application Ports

| App        | Port  |
| ---------- | ----- |
| API        | 3000  |
| Admin      | 3100  |
| Client     | 3200  |
| Grafana    | 3001  |
| Prometheus | 9090  |
| Jaeger     | 16686 |
