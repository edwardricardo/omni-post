# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Apply these rules to every file you create or modify. No exceptions.**

---

## Development Commands

### Core Commands

- `pnpm dev` - Start API and workers concurrently
- `pnpm dev:api` - Start API server only (port 3000)
- `pnpm dev:workers` - Start workers only
- `pnpm dev:admin` - Start admin interface only
- `pnpm build` - Build all packages
- `pnpm test` - Run API tests
- `pnpm lint` - Run ESLint with TypeScript support
- `pnpm lint:fix` - Auto-fix ESLint issues
- `pnpm format` - Format code with Prettier
- `pnpm format:check` - Check code formatting

### Database Commands

- `pnpm db:up` - Start PostgreSQL and Redis via Docker Compose
- `pnpm db:studio` - Open Prisma Studio
- `pnpm db:migrate` - Run Prisma migrations
- `pnpm db:seed` - Seed database with test data

> **MANDATORY:** When a task includes Prisma schema changes, **always** run `pnpm db:up` first to start PostgreSQL + Redis, then run the migration. Never skip a migration because "DB is not running" — start it.

### Test Commands (API)

- `pnpm --filter @apps/api test` - Run unit tests with Vitest
- `pnpm --filter @apps/api test:unit:watch` - Run unit tests in watch mode
- `pnpm --filter @apps/api test:unit:coverage` - Run unit tests with coverage report
- `pnpm --filter @apps/api test:all` - Run all tests (Vitest unit + node:test integration)
- `pnpm --filter @apps/api test:integration` - Run integration tests only (requires DB + Redis)
- `cd apps/api && pnpm exec stryker run` - Mutation testing (Stryker + vitest-runner, perTest)

---

## Project Structure

```text
apps/
  api/        - Fastify REST API server
  workers/    - BullMQ background job processors
  admin/      - Admin dashboard (Next.js)
  client/     - Client dashboard (Next.js)
infra/
  prisma/     - Database schema, migrations, and client
packages/
  ports/      - Port interfaces (technology-free)
  shared/     - Shared types, events, CQRS, saga definitions
  providers/  - Social platform adapters (x, instagram, facebook, youtube, tiktok)
  adapters/   - Infrastructure adapters (cache-redis, db-prisma, queue-bullmq, storage-s3, etc.)
  ui/         - Shared React components
  api-common/ - Base route handler, CSV export
  monitoring/ - Circuit breaker, health checks
  observability/ - OpenTelemetry instrumentation
```

### Technology Stack

- **Backend**: TypeScript, Fastify, Prisma ORM
- **Database**: PostgreSQL with Redis for queues/caching
- **Frontend**: Next.js, React, Tailwind CSS, Radix UI
- **Testing**: node:test (API), Vitest (frontend), Playwright (E2E)
- **Monitoring**: Prometheus metrics, Pino structured logging, OpenTelemetry
- **Storage**: S3-compatible storage for media files

### Workspace Configuration

- **pnpm workspaces** with TypeScript project references
- **ESLint v9 flat config** with TypeScript support, React plugins
- **Prettier** for code formatting
- **Husky + lint-staged** for pre-commit quality checks
- **GitHub Actions CI** for automated testing and quality gates
- Shared TypeScript configuration in `tsconfig.base.json`
- Path mapping: `@ports/core`, `@infra/prisma`, `@shared/types`, etc.

### Environment Setup

- Requires `.env` file (copy from `.env.example`)
- PostgreSQL and Redis via `docker-compose.yml`
- Database URL: `postgresql://postgres:password123@localhost:5432/omnipostdb`
- Redis URL: `redis://localhost:6379`

---

## Documentation Policy

**All project documentation lives under `/docs/`.** Never create `.md` files in `apps/`, `packages/`, `infra/`, or any other directory. The only exceptions are `CLAUDE.md` (root) and `.claude/` configuration files.

### `/docs/` Structure

| Directory            | Content                                                         |
| -------------------- | --------------------------------------------------------------- |
| `docs/api/`          | REST API reference (endpoints, services, types)                 |
| `docs/frontend/`     | Frontend portals (admin-portal, client-portal, REACT_STANDARDS) |
| `docs/architecture/` | System design and architectural decisions                       |
| `docs/development/`  | Developer guides, contributing, migration guides                |
| `docs/features/`     | Feature specifications and design docs                          |
| `docs/reports/`      | Sprint reports and session logs                                 |
| `docs/security/`     | Security policies and audits                                    |
| `docs/deployment/`   | Infrastructure and deployment guides                            |
| `docs/technical/`    | Technical deep-dives and ADRs                                   |
| `docs/product/`      | Product requirements and roadmap                                |
| `docs/admin/`        | Admin-specific operational docs                                 |
| `docs/client/`       | Client-facing documentation                                     |

---

## Architecture — Hexagonal (Ports & Adapters)

**Dependency direction is always inward. Outer layers import inner. Never the reverse.**

```text
Routes → Application → Domain ← (never imports from) → Infrastructure
```

- `domain/` imports **nothing** external — no Prisma, no Fastify, no Redis, no BullMQ, no SDKs
- `application/` imports **domain only** — no concrete adapters, no infrastructure classes
- `infrastructure/` imports application + domain + external libs
- Routes import **use cases only** — never repositories, never Prisma directly
- **Never** `import { prisma } from "@infra/prisma"` in a route file — resolve from DI: `fastify.container.resolve(TOKENS.XRepository)`
- Ports (interfaces) live in `packages/ports/` — technology-free names (`PostRepository` not `PrismaPostPort`)
- Concrete adapters are instantiated **only** in the DI composition root (`Container.ts`)

---

## Domain-Driven Design

**The domain speaks business language. If a domain expert wouldn't recognize the word, rename it.**

### Entities

- Identity via typed Value Object: `PostId` not `string`
- State changes through methods only: `post.scheduleForPublishing(time)` not `post.status = 'SCHEDULED'`
- No repository, service, or adapter references inside an entity
- Enforce invariants inside the entity method — not in the use case

### Value Objects

- All properties `readonly` — no setters, ever
- Validate on construction, throw domain error on invalid input
- Equality by value, not reference
- Wrap primitives: `new ShortCode('abc123')` not bare `string`

### Aggregates

- Reference other aggregates **by ID only**: `channelId: ChannelId` not `channel: Channel`
- Aggregate root is the only public entry point — no direct child mutation from outside
- Collect domain events internally — dispatch only after persistence (via Unit of Work)
- Never call a repository or service from inside the aggregate

### Domain Events

- Past tense names: `PostPublished`, `CrisisModeEntered`
- Immutable payload, no methods beyond constructor
- Always carry: `aggregateId`, `occurredAt: Date`
- Extend base `DomainEvent` class

### Repositories (Ports)

- Return **domain objects** — never raw Prisma types outside infrastructure
- `findById` returns `Result<T, NotFoundError>` — never `T | null`
- Command repo (`PostRepository`) is separate from query repo (`PostQueryRepository`)
- No DTOs in or out — that is the use case's job

---

## CQRS

**Commands change state. Queries read state. Never mix.**

### Commands

- Return `Result<void, DomainError>` or `Result<EntityId, DomainError>` — never a full object graph
- Load aggregate → call aggregate method → save via repo via Unit of Work
- Zero `findMany`, `select`, or read operations inside command handlers
- State changes go through the aggregate — never `repository.update({ field: value })` directly

### Queries

- Return typed **DTOs** — never domain objects
- Zero `save`, `create`, `update`, `delete` calls — not even incidentally
- Zero domain events emitted
- May bypass domain layer and query read model directly via `PostQueryRepository`

### CQRS Bus

- CQRSBus handlers delegate to Application layer use cases — **never** call `prisma.*` directly
- One implementation only — the Application layer use cases. No parallel Prisma path.

---

## Unit of Work

**Every mutating use case MUST use UoW. No exceptions for new code.**

All 56 mutating use cases in the project use Unit of Work. New mutating use cases
must follow the same pattern. Queries (read-only) do not need UoW.

```typescript
// Required pattern for ALL mutating use cases:
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

export class MyUseCase {
  constructor(
    private readonly someRepository: SomeRepository,
    private readonly unitOfWork?: UnitOfWork // LAST param, optional for tests
  ) {}

  async execute(input: Input): Promise<Result<Output, UseCaseError>> {
    // Validation, domain logic...

    const doWork = async (): Promise<Result<Output, UseCaseError>> => {
      // ALL repo writes + event dispatch go here
      await this.someRepository.save(aggregate);
      return ok(output);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<Output, UseCaseError> = ok(undefined) as Result<Output, UseCaseError>;
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "...",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
```

### UoW Rules

- **Never** write to a repository outside of `executeInTransaction` in production code
- **Never** put external API calls (provider APIs, email, etc.) inside the transaction — only DB writes
- UoW parameter is `optional` for backward compatibility in unit tests
- DI container MUST pass `container.resolve<UnitOfWork>(TOKENS.UnitOfWork)` to every mutating use case
- `PrismaUnitOfWork` uses `AsyncLocalStorage` — repositories auto-detect the active transaction via `PrismaUnitOfWork.getTransactionClient()`

---

## Event-Driven Architecture

- Domain event → Outbox write — **in the same DB transaction** as the aggregate save
- Outbox relay uses `SELECT FOR UPDATE SKIP LOCKED` — no double-dispatch
- After dispatch, mark event `PROCESSED` atomically
- Integration events carry **only** primitive-serializable data — no domain objects in BullMQ payloads
- Every consumer handler is **idempotent** — processing twice = same result as processing once
- Every dispatched event type has a registered schema version

---

## Saga Pattern

- Each saga step is a local transaction — commits independently
- Compensating transactions exist for every compensable step — **no no-op compensations**
- Compensation is **idempotent and retryable**
- Compensations execute in **reverse order** of forward steps
- DedupeKey is **deterministic**: `saga-${sagaId}-${stepIndex}` — never append `randomUUID()`
- Guard against re-execution of terminal sagas:

  ```typescript
  if (["COMPLETED", "FAILED", "COMPENSATED"].includes(saga.status)) return;
  ```

- Saga state (including jobIds from scheduling steps) persisted between steps for compensation use

---

## TypeScript Strict Mode

**`exactOptionalPropertyTypes: true` is active. Treat the compiler as a collaborator.**

### Zero-Tolerance Rules

- **Zero `any`** in domain, application, and infrastructure layers — use proper interfaces, generics, or `unknown` + type guard
- **Zero `throw`** in domain/application — use `Result<T, DomainError>` for all fallible operations
- **Zero `@ts-ignore`** or `@ts-nocheck` in production source
- **Zero `!.`** non-null assertions in domain/application — handle nullability explicitly
- Optional properties: never assign `undefined` — omit the key instead
- Error catch variables: type as `unknown`, narrow with `instanceof`
- `as const` + union types preferred over `enum`

### exactOptionalPropertyTypes Patterns

```typescript
// WRONG - assigns undefined explicitly
const obj = { ...existing, progress: undefined, error: errorMsg };

// CORRECT - conditional spreading
const obj = {
  ...existing,
  status,
  ...(progress !== undefined && { progress }),
  ...(error !== undefined && { error }),
};
```

### Array Operations & Null Safety

```typescript
// Always check for undefined after destructuring
const [item] = array.splice(index, 1);
if (item) {
  item.property; // Safe
}
```

### React State Updates with Optional Properties

```typescript
// CORRECT
setState((prev) =>
  prev.map((item) => ({
    ...item,
    ...(optionalProp !== undefined && { optionalProp }),
  }))
);
```

### Hook Dependency Arrays & Function Ordering

```typescript
// Declare functions BEFORE using in dependency arrays
const helperFunction = useCallback(() => {}, []);

useEffect(() => {
  helperFunction();
}, [helperFunction]);
```

---

## Result Type

**All fallible operations return `Result<T, E>` — never throw across layer boundaries.**

```typescript
// Domain error hierarchy
DomainError
  ├── ValidationError
  ├── InvariantError
  └── NotFoundError

// Use case signature
execute(command: CreatePostCommand): Promise<Result<PostId, DomainError>>

// Never:
execute(command: CreatePostCommand): Promise<Post>  // hides failure
```

- Use `ok()` and `err()` helpers from `@shared/types`
- Narrow with `if (!result.ok)` before accessing `.value`

---

## Dependency Injection

- **130+ tokens** — every new dependency gets a `TOKENS.MY_DEPENDENCY` symbol
- Registration in `Container.ts` composition root only
- Lifecycle: repositories → singleton, use cases → singleton, UoW → **transient**
- No `new ConcreteClass()` inside domain or application constructors
- Allowed `new` in domain: Value Objects from primitives, Domain Events — nothing else

---

## Error Handling

- Domain errors extend `DomainError` — never raw `Error` for business failures
- Infrastructure errors wrapped into domain/application errors before crossing layers
- Single global error handler in Fastify translates domain errors → HTTP status codes
- Every error response includes: `statusCode`, `message`, `correlationId`, `timestamp`
- Empty catch blocks: **zero tolerance** — log at minimum, rethrow if unrecoverable

---

## Logging & Observability

- Use `@observability/logger` (Pino) — zero `console.*` in production code
- **Domain layer: zero logging** — it is an infrastructure concern
- Application layer: `WARN` or `ERROR` only
- Logger injected via `LoggerPort` — never imported as a concrete class
- Every log entry carries: `correlationId`, `layer`, `operation`
- Correlation ID propagated to: logger → domain events → outbox → BullMQ job data → error responses
- OTel SDK initialized as **first import** in entry points (`index.ts`) — before Fastify, before Prisma

---

## Background Tasks

**All recurring work MUST be registered via `BackgroundTaskScheduler` — never call `setInterval` / `setTimeout` directly in backend production code.**

The scheduler lives at `packages/observability/background-scheduler/` and is wired into DI as `TOKENS.BackgroundTaskScheduler`. It applies `.unref()` by default, wraps callbacks with try/catch + logger, tracks in-flight async work, and is torn down on SIGINT/SIGTERM via `scheduler.shutdownAll()`.

- **Register:** `scheduler.register(taskId, callback, intervalMs, options?)` — `taskId` is a stable string constant (one per task, one per class, not a UUID unless the task is per-connection), `callback` may be sync or async, errors go through `options.onError` or the injected logger.
- **Unregister:** `scheduler.unregister(taskId)` on teardown (`stop()` / `shutdown()` / `destroy()` / `onClose` hook / request `close` event).
- **Use `critical: true`** only when the task must NOT let the process exit while still running (rare — default is safer).
- **Use `immediate: true`** when the first execution must fire synchronously instead of after one interval.
- **Libraries in `packages/`** accept `scheduler?: BackgroundTaskScheduler` as an **optional** dependency to stay pure when consumed outside the DI graph. The app's composition root passes the scheduler explicitly.
- **Workers** (apps/workers) construct their own `DefaultBackgroundTaskScheduler` and call `scheduler.shutdownAll()` in their `SIGINT`/`SIGTERM` handlers.
- **Tests** inject a `NoopBackgroundTaskScheduler` and fire callbacks manually via `noopScheduler.triggerTask(taskId)` when the test needs to exercise the task body.

The only legitimate raw `setInterval` call in the entire backend is inside `DefaultBackgroundTaskScheduler` itself. The CI fitness grep blocks new occurrences.

---

## Testing

**Write the test first. If you can't write a test for it, reconsider the design.**

### TDD Cycle

- **Red**: write a failing test that describes the behavior
- **Green**: write the minimum code to pass it
- **Refactor**: clean up without breaking the test

### Test Quality Rules

- **AAA pattern**: Arrange / Act / Assert — one behavior per test
- Naming: `'returns X when Y given Z'` — behavior, not implementation
  - `'returns PostNotFoundError when post does not exist'`
  - Never: `'calls repository.findById'`
- `beforeEach(() => { /* reset mocks */ })` in every suite
- Zero `console.log` in test files
- Zero `.only()` or `.skip()` committed
- Async tests always `await` — no floating promises

### Mock Factories (Required Pattern)

```typescript
// Never inline magic values in tests
const makePost = (overrides?: Partial<Post>): Post => ({
  id: PostId.create("post-uuid-001"),
  status: PublishStatus.DRAFT,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});
```

### Zero Cancelled Tests

**Cancelled tests are bugs. Investigate and fix every one — never ignore them.**

A cancelled test means one of:

- The test file doesn't use the correct test framework (`describe`/`it` from `node:test`) — rewrite or delete it
- A prior test leaked resources (open handles, timers, DB connections) causing `--test-force-exit` to kill pending tests — fix the leak
- A module resolution error (`ERR_MODULE_NOT_FOUND`) crashed the process before tests ran — fix the import or build dependency

The target is **0 cancelled** on every run. If you find cancelled tests, diagnose the root cause and fix it before moving on.

### Coverage Targets

| Layer                   | Minimum |
| ----------------------- | ------- |
| Domain                  | 90%     |
| Application use cases   | 85%     |
| Infrastructure adapters | 70%     |
| Route handlers          | 70%     |
| Provider adapters       | 75%     |

### Test Framework Rules

**Three frameworks, strict domain boundaries. Jest is NOT allowed.**

| Domain                                                    | Framework    | Imports                                                                        |
| --------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------ |
| Backend unit tests (`apps/api/tests/unit/`)               | `vitest`     | `import { describe, it, expect, vi } from "vitest"` + `assert`                 |
| Backend integration tests (`apps/api/tests/integration/`) | `node:test`  | `import { describe, it, before, after } from "node:test"` + `assert`           |
| Frontend (admin components, client hooks)                 | `vitest`     | `import { describe, it, expect, vi } from "vitest"` + `@testing-library/react` |
| E2E (admin auth, client publishing)                       | `Playwright` | `import { test, expect } from "@playwright/test"`                              |

### Backend Unit Test Pattern (Vitest)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

describe("Feature Name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Specific Functionality", () => {
    it("returns expected result when given valid input", async () => {
      const result = await serviceUnderTest.method(testData);
      assert.ok(result.ok, "Operation should succeed");
      assert.strictEqual(result.value.property, expectedValue);
    });
  });
});
```

### Backend Integration Test Pattern (node:test)

```typescript
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("Integration Feature", () => {
  before(async () => {
    /* one-time setup — DB, Redis, etc. */
  });
  after(async () => {
    /* cleanup */
  });

  it("works with real services", async () => {
    const result = await serviceUnderTest.method(testData);
    assert.ok(result.ok, "Operation should succeed");
  });
});
```

### Running Tests

- Unit tests: `pnpm --filter @apps/api test` (runs Vitest)
- Unit tests with coverage: `pnpm --filter @apps/api test:unit:coverage`
- All tests (unit + integration): `pnpm --filter @apps/api test:all` (runs `scripts/run-tests.sh`)
- Integration tests only: `pnpm --filter @apps/api test:integration`
- Mutation testing: `cd apps/api && pnpm exec stryker run` (Stryker with vitest-runner, `coverageAnalysis: 'perTest'`)
- **Integration tests need real services**: Start PostgreSQL and Redis with `pnpm db:up` before running tests that use Prisma or Redis. Never skip tests because services are down — start them.

---

## Naming Conventions

| Element             | Convention                              | Example                  |
| ------------------- | --------------------------------------- | ------------------------ |
| Variables/Functions | `camelCase`                             | `getUserData()`          |
| Constants           | `UPPER_SNAKE_CASE`                      | `MAX_RETRY_ATTEMPTS`     |
| Classes             | `PascalCase`                            | `CreatePostUseCase`      |
| Interfaces          | `PascalCase` (no `I` prefix)            | `PostRepository`         |
| Types               | `PascalCase`                            | `UserId`                 |
| Domain Events       | `PascalCase`, past tense                | `PostPublished`          |
| Commands            | `PascalCase` + `Command`                | `CreatePostCommand`      |
| Queries             | `PascalCase` + `Query`                  | `GetPostQuery`           |
| Use Cases           | `PascalCase` + `UseCase`                | `CreatePostUseCase`      |
| Port interfaces     | `PascalCase` + `Repository`/`Port`      | `PostRepository`         |
| Adapters            | Infra prefix + Port name                | `PrismaPostRepository`   |
| DI tokens           | `UPPER_SNAKE_CASE` in `TOKENS`          | `TOKENS.POST_REPOSITORY` |
| Queue names         | `UPPER_SNAKE_CASE` constant             | `QUEUES.PUBLISH`         |
| Zod schemas         | `camelCase` + `Schema`                  | `createPostSchema`       |
| Enums (if needed)   | `PascalCase`, values `UPPER_SNAKE_CASE` | `JobStatus.RUNNING`      |
| Files (utilities)   | `kebab-case.ts`                         | `api-client.ts`          |
| Files (React)       | `PascalCase.tsx`                        | `UserProfile.tsx`        |
| Directories         | `kebab-case`                            | `shared-components/`     |
| CSS Classes         | `kebab-case`                            | `.data-table-header`     |
| Database            | `snake_case` (Prisma schema)            | `created_at`             |

### Unused Variables

- Prefix with underscore: `_unusedParam`
- Destructured: `{ propName: _propName }`
- Active variables: never use underscore prefix

---

## React Component Standards

> Full React standards: `docs/frontend/REACT_STANDARDS.md`

- Function Declaration Order:
  1. State declarations (useState)
  2. Refs (useRef)
  3. Callback functions (useCallback) — declare before use
  4. Effects (useEffect) — must come after functions they depend on
  5. Render helpers
  6. Return JSX
- Dependencies: All functions used in hooks must be in dependency arrays
- Named exports for components, default exports only for pages
- Import order: React → External libs → Internal packages → Relative imports
- No circular dependencies

---

## Mandatory Requirements for Every Sprint

**Every prompt that creates or modifies production code MUST include both of these — no exceptions:**

### 1. Tests (mandatory)

Every new or modified class, method, or function requires tests in the same sprint:

- **New service / use case** → unit tests with mock factory pattern (`apps/api/tests/unit/`)
- **New route / endpoint** → integration test with real HTTP request (`apps/api/tests/integration/`)
- **New React component** → Vitest component test with `@testing-library/react`
- **New hook** → Vitest hook test
- **Modified method** → update existing tests to cover new behavior

Tests are never deferred to a later sprint. A sprint that produces code without tests
is incomplete regardless of TypeScript compiling cleanly.

### 2. JSDoc (mandatory)

Every new file and every new public method requires JSDoc in the same sprint:

- **New file** → `@file/@description/@layer` header
- **New public method** → `@method/@description/@param/@returns`
- **New React component** → `@component` with key props documented
- **New hook** → `@hook` with return value documented

---

## Documentation

Every file gets a JSDoc header — **no exceptions, including index files, types files, and barrel exports.**

```typescript
/**
 * @file create-post.use-case.ts
 * @description Orchestrates post creation: validates input, constructs aggregate,
 *              persists via repository, dispatches PostCreated event via outbox.
 * @layer application
 */
```

Every public class method gets:

```typescript
/**
 * @method execute
 * @description Creates a new post aggregate and persists it transactionally.
 * @param command - Validated creation parameters
 * @returns Result<PostId> on success, ValidationError or InvariantError on failure
 */
```

### @layer Standard Values

**Use exactly these three values — no variations, no new values. The rule applies to every `.ts` and `.tsx` file in `apps/` and `packages/`, including tests, frontend components, hooks, pages, UI primitives, config files, and barrel exports. No exceptions.**

| Value            | Use for                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`         | Entities, value objects, aggregates, domain events, repository interfaces, domain errors                                                        |
| `application`    | Use cases, application services, handlers, command/query objects, DTOs                                                                          |
| `infrastructure` | Adapters, repository implementations, routes, processors, BullMQ jobs, config, middleware, React components, hooks, pages, UI primitives, tests |

### Mapping by context

Resolve ambiguity by path. When a file could fit two layers, pick by this table:

| Path                                                                                              | @layer           |
| ------------------------------------------------------------------------------------------------- | ---------------- |
| `apps/api/src/domain/`, `packages/shared/`, `packages/ports/` (pure contracts, no framework deps) | `domain`         |
| `apps/api/src/application/`                                                                       | `application`    |
| `apps/api/src/infrastructure/`, `apps/api/src/**/*Routes.ts`, `apps/api/src/**/*Processor.ts`     | `infrastructure` |
| `apps/workers/src/`                                                                               | `infrastructure` |
| `apps/admin/`, `apps/client/` (pages, components, hooks, stores, lib)                             | `infrastructure` |
| `packages/ui/` (UI primitives)                                                                    | `infrastructure` |
| `packages/adapters/`, `packages/providers/` (hexagonal adapters)                                  | `infrastructure` |
| `packages/monitoring/`, `packages/observability/` (cross-cutting)                                 | `infrastructure` |
| `packages/api-common/` (shared HTTP helpers)                                                      | `infrastructure` |
| Tests (`**/tests/**`, `**/*.test.ts`, `**/*.test.tsx`)                                            | `infrastructure` |

**Examples:**

- `GatewayBillingService.ts` → `@layer application`
- `PrismaPostRepository.ts` → `@layer infrastructure`
- `billingWebhookRoutes.ts` → `@layer infrastructure`
- `GatewaySwitchProcessor.ts` → `@layer infrastructure`
- `Post.ts` (entity) → `@layer domain`
- `PostRepository.ts` (interface) → `@layer domain`
- `PaymentAdapter.ts` (port contract in `packages/ports/`) → `@layer domain`
- `CampaignList.tsx` (React component) → `@layer infrastructure`
- `useCampaigns.ts` (React hook) → `@layer infrastructure`
- `dashboard/page.tsx` (Next.js page) → `@layer infrastructure`
- `postRoutes.test.ts` (unit test) → `@layer infrastructure`

**Forbidden variations:** `test`, `integration`, `unit`, `testing`, `presentation`, `page`, `hooks`, `ui`, `client-components`, `client-hooks`, `client-pages`, `client-state`, `client-lib`, `client-tests`, `ports`, `provider`, `test-infrastructure`, `infrastructure (routes)`, `routes`, `service`, `handler` — always normalize to one of `domain` / `application` / `infrastructure`.

### React component JSDoc — Storybook autodocs integration

React components get `@component` **in addition to** `@layer infrastructure`. The two tags answer different questions: `@layer` locates the file in the hexagonal architecture (always `infrastructure` for UI); `@component` marks the file as a React component for readers and grep-based tooling.

Storybook `addon-docs` reads **two places** to populate the autodocs page:

1. The **component function's preceding JSDoc block** → used as the long-form component description.
2. **JSDoc comments above each prop in the props `interface`** → used as the per-prop description in the Controls panel.

`@param` tags on the component function are **redundant and ignored** by `react-docgen-typescript`. Put prop descriptions on the interface, not the function.

**Canonical template:**

```tsx
/**
 * @file CampaignList.tsx
 * @description List view of campaigns with filter/sort controls and inline actions.
 * @component CampaignList
 * @layer infrastructure
 */

interface CampaignListProps {
  /** Account whose campaigns will be listed. Required. */
  accountId: string;
  /** When true, shows archived campaigns mixed with active ones. Default: false. */
  includeArchived?: boolean;
  /** Fired after the user triggers archive/unarchive on any row. */
  onChange?: (campaignId: string) => void;
}

/**
 * Renders a paginated list of campaigns for an account, with inline archive,
 * duplicate, and analytics actions. Filters persist in the URL query string.
 */
export function CampaignList({ accountId, includeArchived = false, onChange }: CampaignListProps) {
  // ...
}
```

Gotchas documented during T1-F research:

- Storybook `react-docgen-typescript` has a known limitation (issues [#21007](https://github.com/storybookjs/storybook/issues/21007), [#30767](https://github.com/storybookjs/storybook/issues/30767)): when a component is imported from a pnpm workspace package via the package root, autodocs may miss prop descriptions. If this happens, import from the source path (`@packages/ui/src/ComponentName`) instead of the package root (`@packages/ui`).
- Next.js 15 App Router components that use `useRouter` from `next/navigation` require `parameters.nextjs.appDirectory: true` in the Storybook `preview.tsx`.
- Storybook ignores `@defaultValue` ([issue #21192](https://github.com/storybookjs/storybook/issues/21192)). Express defaults via TypeScript parameter defaults instead (`prop = false`).

### Storybook port convention

Each app runs its own Storybook on a dedicated port to avoid collisions during parallel development:

- `apps/client`: `6006`
- `apps/admin`: `6007`

`packages/ui` does **not** run its own Storybook; its stories are picked up by the client Storybook via a cross-package glob in `apps/client/.storybook/main.ts`. This avoids dual-maintenance of addons/preview configuration.

### Comment Quality Rules

- Comments explain **why**, not **what** — the code already shows what
- No references to sprint numbers, implementation phases, or development timeline
- No comments like "Added in Sprint X", "Part of Phase Y", "TODO: done" — these belong in git history, not source code
- Inline comments only when the logic is genuinely non-obvious
- All comments in **English**

All comments in **English**.

---

## Automated Compliance Checks (CI Fitness Functions)

These must stay at zero. If your change breaks any of these, fix it before committing:

```bash
# 1. No Prisma singleton imports in routes
grep -rn "import { prisma" apps/api/src/ --include="*routes*" | wc -l

# 2. Domain layer is framework-free
grep -rn "prisma\|fastify\|redis\|bullmq" apps/api/src/domain/ --include="*.ts" | wc -l

# 3. No `any` in domain/application/infrastructure
grep -rn ": any\b\|as any\b\|<any>" \
  apps/api/src/domain/ apps/api/src/application/ apps/api/src/infrastructure/ \
  --include="*.ts" | grep -v "// any" | wc -l

# 4. No raw throws in domain/application
grep -rn "throw " apps/api/src/domain/ apps/api/src/application/ \
  --include="*.ts" | wc -l

# 5. No @ts-ignore in production source
grep -rn "@ts-ignore\|@ts-nocheck" apps/api/src/ packages/*/src/ \
  --include="*.ts" | wc -l

# 6. CQRS handlers don't touch Prisma directly
grep -rn "prisma\." apps/api/src/cqrs/handlers/ --include="*.ts" | wc -l

# 7. No randomUUID in dedupeKey
grep -rn "dedupeKey.*randomUUID\|dedupeKey.*Math.random" \
  apps/api/src/ packages/ --include="*.ts" | wc -l

# 8. No sprint references in source comments (repo-wide, excluding test sandboxes)
grep -rn "Part of Sprint\|Phase.*Sprint\|Sprint [0-9]" apps/ packages/ \
  --include="*.ts" --include="*.tsx" | \
  grep -vE "node_modules|dist|\.next|\.stryker-tmp|\.stryker|reports/mutation" | wc -l

# 9. No files missing @file header (all repo, target: 0).
# Excludes Next.js auto-generated `next-env.d.ts` (regenerated on every build,
# see https://nextjs.org/docs/app/api-reference/config/typescript — "should not be edited").
grep -rL "@file" apps/ packages/ --include="*.ts" --include="*.tsx" | \
  grep -v "node_modules\|dist\|\.next\|\.stryker\|reports/mutation\|next-env\.d\.ts" | wc -l

# 10. No invalid @layer values (all repo, only domain/application/infrastructure)
grep -rn "@layer" apps/ packages/ --include="*.ts" --include="*.tsx" | \
  grep -v "node_modules\|dist\|\.next\|\.stryker\|reports/mutation" | \
  grep -v "@layer application\|@layer domain\|@layer infrastructure" | wc -l

# 11. No raw setInterval in backend (scheduler-adapter excepted)
grep -rnE "setInterval\(" apps/api/src apps/workers/src packages/ --include="*.ts" | \
  grep -v "default-scheduler\|node_modules\|dist\|\.test\.\|/tests/\|/\.stryker-tmp/\|eslint\.config\|DANGEROUS_STRINGS" | wc -l

# 12. Every React component file carries an @component tag.
# Scan component directories and fail if any canonical component .tsx lacks @component.
# Excludes hooks (use*.tsx) and helper modules (camelCase exports, not PascalCase components).
for f in $(find apps/admin/components apps/client/components packages/ui/src/components \
  -type f -name "*.tsx" 2>/dev/null | grep -v "\.stories\.\|\.test\.\|\.next"); do
  basename=$(basename "$f")
  # Skip hooks — use*.tsx follow the hook convention, document them with @hook, not @component.
  case "$basename" in use*) continue;; esac
  # Skip helper modules that don't export any PascalCase component.
  if ! grep -qE "^export (default )?(function|const) [A-Z]" "$f"; then continue; fi
  grep -q "@component" "$f" || echo "MISSING @component: $f"
done | wc -l
```

---

## Problem-Solving Standards

**CRITICAL: NEVER bypass problems or create workarounds.** Always fix the root cause.

1. **Research First**: Understand root cause and official solution
2. **Implement Proper Solution**: Apply the correct, standards-compliant fix
3. **Avoid Workarounds**: Never create temporary patches
4. **Fix Problems Immediately**: When you detect a problem, fix it before proceeding

**3+ Consecutive Errors Rule**: When 3 or more consecutive errors are encountered:

1. STOP the current task immediately
2. Enter planning mode
3. Create a systematic plan to find root problems
4. Use parallel subagents to fix issues
5. Only then continue with the previous task

### Multi-Agent Strategy

Use specialized agents for different problem domains:

- `software-architect-mvp` for workspace/dependency analysis
- `qa-testing-strategist` for compilation audits and testing
- `fastify-backend-developer` for import/dependency fixes
- `nextjs-frontend-developer` for TypeScript compliance fixes
- `postgresql-schema-architect` for database type issues
- `performance-optimizer` for Result type and async patterns

### Code Quality Gates

- ESLint: Must pass with zero errors, zero warnings
- Prettier: All files must be formatted
- TypeScript: Must compile with zero errors
- All CI fitness functions must pass
- **Fix ALL errors found** — both new and pre-existing. Never skip or defer an error because "it was already there". Every build/lint/test run must end at zero errors.

---

## Communication

Always communicate what you are doing or trying to do. This allows the user to decide properly if that is what they want.
