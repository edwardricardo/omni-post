# Coding Standards — TypeScript · Result · Error Handling · Testing · Naming · React · JSDoc

> Authoritative coding rules for omni-post. Auto-loaded via
> `@docs/development/CODING_STANDARDS.md` in CLAUDE.md.

**Owner:** Platform engineering
**Loaded:** every session (Claude Code `@`-import, depth 1)

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

## Error Handling

- Domain errors extend `DomainError` — never raw `Error` for business failures
- Infrastructure errors wrapped into domain/application errors before crossing layers
- Single global error handler in Fastify translates domain errors → HTTP status codes
- Every error response includes: `statusCode`, `message`, `correlationId`, `timestamp`
- Empty catch blocks: **zero tolerance** — log at minimum, rethrow if unrecoverable

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
- **Test env**: vitest auto-loads `.env.test` via the `setupFiles` hook (`apps/api/tests/setup-env.ts`, `apps/workers/tests/setup-env.ts`). On fresh clone, run `cp .env.test.example .env.test` and edit `DATABASE_URL` / `REDIS_URL` to point at your local infra. Full canon in [docs/architecture/secrets-and-env.md](../architecture/secrets-and-env.md) §Test environment.

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

| Value            | Use for                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`         | Entities, value objects, aggregates, domain events, repository interfaces, domain errors                                                                                                        |
| `application`    | Use cases, application services, application command/query handler classes (the use-case-like ones), command/query objects, DTOs                                                                |
| `infrastructure` | Adapters, repository implementations, routes, processors, BullMQ jobs, CQRS bus + bus dispatch handlers, saga engines, config, middleware, React components, hooks, pages, UI primitives, tests |

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

---

## How to extend

Adding or amending coding rules:

1. **New naming convention** → append a row to the Naming table; add a fitness regex if the convention is grep-able.
2. **New TypeScript pattern** → add to the §"exactOptionalPropertyTypes Patterns" or §"Zero-Tolerance Rules" subsection with a concrete example.
3. **New test framework rule** → update the §"Test Framework Rules" table + a backend or frontend pattern subsection.
4. **New `@layer` value** → forbidden. Three values total (`domain`, `application`, `infrastructure`). Amendments require an ADR.
5. **New mandatory artefact per sprint** → extend §"Mandatory Requirements for Every Sprint". Keep the bar high but realistic.
6. **Amending a rule** → ADR required (see ADR-0001 template). Update this doc with the new wording + link the ADR.

Companion fitness checks live in `CLAUDE.md §Automated Compliance Checks`:

- `#3` no `any` in domain/app/infra · `#4` no raw throws in domain/app · `#5` no `@ts-ignore` · `#8` no sprint/phase refs · `#9` @file header coverage · `#10` valid @layer values · `#12` @component on React components.
