# Testing Strategy

## Overview

Comprehensive testing strategy for the multi-channel social media CMS using a triple testing approach:

- **API Testing**: Node.js native test runner (`node:test`) with `node:assert/strict` for backend services
- **Frontend Testing**: Vitest 3.2.4 + React Testing Library 16.1.0 for React 19 components (admin + client)
- **E2E Testing**: Playwright 1.55.1 for end-to-end user flows
- **Integration Testing**: Real database and Redis instances for end-to-end flow validation
- **Contract Testing**: Provider adapter compliance and interface validation

**Important**: Jest is NOT used anywhere in this project. See `docs/ADR-001-test-framework-strategy.md` for rationale.

## Current Technology Stack

### API Testing (Backend)

- **Test Runner**: Node.js native test runner (`node:test`) with `--test-force-exit`
- **Assertions**: `node:assert/strict` for type-safe assertions
- **Batch Runner**: `apps/api/scripts/run-tests.sh` for orchestrated batch execution
- **Database**: Real PostgreSQL with test isolation
- **Queue Testing**: BullMQ with Redis for background job validation
- **Environment**: Node.js ESM with TypeScript 5.9.2, tsx 4.20.5 for transpilation

### Frontend Testing (Admin + Client)

- **Test Runner**: Vitest 3.2.4 with jsdom environment
- **Testing Library**: React Testing Library 16.1.0 (React 19 compatible)
- **Mocking**: Vitest `vi` API for mocks and spies
- **DOM Simulation**: JSDOM 25.0.1 with comprehensive browser API mocks
- **Environment**: Next.js 16.1.6 with React 19.2.4

### E2E Testing

- **Framework**: Playwright 1.55.1
- **Scope**: Admin auth flows, content management, cross-page navigation

## Test Categories

### Unit Tests ✅ IMPLEMENTED

#### API Unit Tests

- **Authentication Services**: JWT, MFA, session management with argon2 password hashing
- **Provider Adapters**: X/Twitter API integration and content transformation
- **Business Logic**: Post creation, scheduling, threading algorithms
- **Utility Functions**: Schema validation with Zod 4.3.6, result patterns
- **Rate Limiting**: Endpoint protection and abuse prevention

#### Client Unit Tests

- **React Hooks**: Custom hooks for API integration with React Query 5.90.2
- **UI Components**: Radix UI 1.4.3 (unified package) with comprehensive interaction testing
- **State Management**: Context providers and reducers
- **Form Validation**: Client-side schema validation and error handling
- **Toast System**: Notification lifecycle and user feedback

### Integration Tests ✅ IMPLEMENTED

#### API Integration Tests

- **Complete Flows**: Authentication → Project creation → Post publishing
- **Database Operations**: Prisma 7.4.1 with real PostgreSQL transactions
- **Queue Processing**: BullMQ job lifecycle with Redis persistence
- **Provider Integration**: Real API calls to social media platforms (mocked in tests)
- **File Operations**: S3-compatible storage for media management

#### Client Integration Tests

- **API Client**: Full request/response cycle testing
- **Component Integration**: Parent-child component communication
- **Routing**: Next.js 16 App Router navigation and middleware
- **State Persistence**: localStorage and sessionStorage integration

### Contract Tests ✅ IMPLEMENTED

#### Provider Contracts

- **Adapter Interface**: Standardized provider API compliance
- **Content Transformation**: Platform-specific content formatting
- **Rate Limiting**: Provider-specific limits and retry logic
- **Error Handling**: Consistent error response formatting

#### Infrastructure Contracts

- **Database Repository**: Prisma ORM operation contracts
- **Queue Adapter**: BullMQ job processing contracts
- **Cache Adapter**: Redis caching strategy validation

### End-to-End Tests ✅ IMPLEMENTED

#### Critical User Journeys

- **Account Registration**: Email verification → Profile setup → Subscription
- **Content Publishing**: Draft creation → Review → Scheduling → Publication
- **Multi-Project Management**: Project switching and isolation
- **Threading Workflows**: Automatic and manual thread splitting
- **Media Workflows**: Upload → Processing → Attachment → Publishing

## Test Execution

### Prerequisites

```bash
# Start required services
pnpm db:up                    # PostgreSQL + Redis via Docker Compose

# Database setup
pnpm db:migrate              # Run Prisma migrations
pnpm db:seed                 # Seed test data

# Environment setup
cp apps/api/.env.example apps/api/.env
cp apps/client/.env.example apps/client/.env
```

### Test Commands

#### API Tests (Backend)

```bash
# Complete API test suite using tsx runner
pnpm --filter @apps/api test            # Run all API tests

# Individual test categories
pnpm --filter @apps/api test:plan       # Publication planning tests
pnpm --filter @apps/api test:adapters   # Provider adapter tests
pnpm --filter @apps/api test:media      # Media handling tests
pnpm --filter @apps/api test:schedule   # Scheduling flow tests
pnpm --filter @apps/api test:analytics  # Analytics collection tests
pnpm --filter @apps/api test:ratelimit  # Rate limiting tests

# Threading system tests
pnpm --filter @apps/api test:threading-planner    # Thread planning logic
pnpm --filter @apps/api test:threading-xprovider  # X/Twitter provider threading
pnpm --filter @apps/api test:threading-flow       # End-to-end threading

# Multi-project tests
pnpm --filter @apps/api test:multiproject         # Project isolation tests

# Security & Authentication tests
pnpm --filter @apps/api test:security             # Security validation
pnpm --filter @apps/api test:auth                 # Authentication flows
pnpm --filter @apps/api test:mfa                  # Multi-factor authentication
pnpm --filter @apps/api test:rbac                 # Role-based access control

# Account management tests
pnpm --filter @apps/api test:account-lifecycle    # Account creation/deletion
pnpm --filter @apps/api test:trial-period         # Trial period management

# Infrastructure tests
pnpm --filter @apps/api test:audit                # Audit logging
pnpm --filter @apps/api test:schema-utils         # Schema validation
pnpm --filter @apps/api test:provider-registry    # Provider registration

# Integration tests
pnpm --filter @apps/api test:category:integration # Multi-project + production API flows
```

#### Client Tests (Frontend)

```bash
# Complete client test suite using Vitest
pnpm --filter @apps/client test         # Run all client tests (vitest run)
pnpm --filter @apps/client test:ui      # Run tests with UI interface
pnpm --filter @apps/client test:coverage # Run tests with coverage report

# Test files (located in lib/api/__tests__/ and lib/templates/__tests__/)
pnpm --filter @apps/client vitest lib/api/__tests__/client.test.ts       # API client tests
pnpm --filter @apps/client vitest lib/api/__tests__/hooks.test.tsx       # React hooks tests
pnpm --filter @apps/client vitest lib/api/__tests__/context.test.tsx     # Context provider tests
pnpm --filter @apps/client vitest lib/api/__tests__/types.test.ts        # Type validation tests
pnpm --filter @apps/client vitest lib/templates/__tests__/templateEngine.test.ts  # Template engine
```

#### Admin Tests (Frontend)

```bash
# Complete admin test suite using Vitest
pnpm --filter @apps/admin test          # Run all admin tests (vitest run)
pnpm --filter @apps/admin test:watch    # Run tests in watch mode
pnpm --filter @apps/admin test:coverage # Run tests with coverage report
```

#### All Tests

```bash
# Run complete test suite (API only - configured in root package.json)
pnpm test                               # Runs API tests via root script

# Run specific app tests
pnpm --filter @apps/api test           # API backend tests (node:test)
pnpm --filter @apps/client test        # Client frontend tests (vitest)
pnpm --filter @apps/admin test         # Admin frontend tests (vitest)

# Type checking
pnpm --filter @apps/api run typecheck  # API TypeScript validation
pnpm --filter @apps/client run type-check # Client TypeScript validation
pnpm --filter @apps/admin run typecheck   # Admin TypeScript validation
```

## Test Framework Implementation

### API Test Framework (node:test)

**Test Runner**: Node.js native test runner via `node --import tsx --test --test-force-exit`

**Batch Runner** (`/home/edward/projects/omni-post/apps/api/scripts/run-tests.sh`)

The batch runner executes test files in separate Node.js processes, aggregates TAP output, and reports totals. Uses `--test-force-exit` to handle Prisma connection pool sockets.

```bash
# Batch execution with configurable concurrency and timeout
run_batch() {
  local name="$1"
  local concurrency="${CONCURRENCY:-4}"
  local timeout="${TIMEOUT:-30000}"
  # Runs: node --import tsx --test --test-force-exit --test-timeout=$timeout ...
}
```

#### Example API Test Pattern

```typescript
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("Auth Flow", () => {
  let authService: AuthService;

  before(async () => {
    // One-time setup
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("should register and login admin", async () => {
    const registerResult = await authService.registerAdmin(
      `admin-${Date.now()}@test.com`,
      "password123",
      "Test Admin",
      "ADMIN"
    );

    assert.ok(registerResult.ok, "Registration should succeed");

    const loginResult = await authService.login(
      { email: registerResult.value.email, password: "password123" },
      "127.0.0.1",
      "Test-User-Agent"
    );

    assert.ok(loginResult.ok, "Login should succeed");
    assert.strictEqual(loginResult.value.user.role, "ADMIN");
  });
});
```

### Frontend Test Framework (Vitest + React Testing Library)

**Vitest Configuration** (`/home/edward/projects/omni-post/apps/client/vitest.config.ts`)

```typescript
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./lib/api/__tests__/setup.ts"],
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/tests/e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
```

#### Example Frontend Test Pattern

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComponentUnderTest } from "./ComponentUnderTest";

describe("ComponentUnderTest", () => {
  it("should render correctly", () => {
    render(<ComponentUnderTest title="Hello" />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});
```

#### Example Hook Test Pattern

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProviders } from "./useProviders";

describe("useProviders", () => {
  it("should fetch providers list", async () => {
    const { result } = renderHook(() => useProviders());
    await waitFor(() => expect(result.current.data).toBeDefined());
  });
});
```

## Test Infrastructure

### Database Testing Strategy

#### Real Database with Isolation

- **Environment**: PostgreSQL 15 with dedicated test database
- **Connection Management**: Shared connections with proper cleanup
- **Data Strategy**: Unique identifiers per test run to prevent conflicts
- **Schema Management**: Prisma migrations run before test execution

```typescript
// Test data creation with unique identifiers
const accountResult = await ctx.repo.createAccount({
  email: `test-${Date.now()}@example.com`, // Unique per test run
  name: "Test Account",
  subscription: "PRO",
});
```

#### Database Configuration

```env
# Test environment variables
TEST_DATABASE_URL=postgresql://postgres:password123@localhost:5432/omnipostdb
TEST_REDIS_URL=redis://localhost:6379/1
```

### Queue and Background Job Testing

#### BullMQ Integration Testing

- **Real Redis Instance**: Redis 7-alpine for job persistence
- **Queue Health Checks**: Connection validation before test execution
- **Job Lifecycle Testing**: Enqueue → Process → Complete/Fail validation

```typescript
// Queue health validation
const queueHealth = await ctx.queue.health();
if (!queueHealth.ok) {
  throw new Error(`Queue health check failed: ${queueHealth.error}`);
}
```

### Mock Strategy

#### API Mocking (Client Tests)

- **Fetch Mocking**: Comprehensive endpoint response simulation
- **LocalStorage Mocking**: Persistent state simulation
- **Browser API Mocking**: ResizeObserver, IntersectionObserver, matchMedia

#### External Service Mocking (API Tests)

- **Provider APIs**: Social media platform API responses
- **File Storage**: S3-compatible storage operations
- **Email Services**: SMTP notification delivery

### React 19 Testing Patterns

#### Concurrent Features Testing

```typescript
// Transition and Suspense testing
it("should handle concurrent state updates", async () => {
  const { result } = renderHook(() => useTransition());
  const [isPending, startTransition] = result.current;

  await act(async () => {
    startTransition(() => {
      // Test concurrent state updates
    });
  });
});
```

**Server Components Testing** (Future Implementation)

- **RSC Serialization**: Component tree serialization validation
- **Streaming Testing**: Progressive loading and hydration
- **Server Action Testing**: Form submission and data mutations

## Test Configuration

### Environment Variables

**API Test Environment** (`.env.test`)

```env
# Database Configuration
DATABASE_URL=postgresql://postgres:password123@localhost:5432/omnipostdb
TEST_DATABASE_URL=postgresql://postgres:password123@localhost:5432/omnipostdb

# Redis Configuration
REDIS_URL=redis://localhost:6379
TEST_REDIS_URL=redis://localhost:6379/1

# API Configuration
NODE_ENV=test
PORT=3000
TEST_API_URL=http://localhost:3000

# Authentication
JWT_SECRET=test-secret-key-for-testing
MFA_ISSUER=SaaS-Prototype-Test

# Timeouts
TEST_TIMEOUT=10000
DB_TIMEOUT=5000
REDIS_TIMEOUT=3000
QUEUE_TIMEOUT=5000
```

#### Client Test Environment

```env
# Next.js Test Configuration
NODE_ENV=test
NEXT_PUBLIC_API_URL=http://localhost:3000

# Mock API Configuration
NEXT_PUBLIC_APP_ENV=test
```

### Test Execution Configuration

**API Test Settings** (`/home/edward/projects/omni-post/apps/api/tests/setup.ts`)

```typescript
export const TEST_CONFIG = {
  timeout: parseInt(process.env.TEST_TIMEOUT || "10000"),
  dbTimeout: parseInt(process.env.DB_TIMEOUT || "5000"),
  redisTimeout: parseInt(process.env.REDIS_TIMEOUT || "3000"),
  queueTimeout: parseInt(process.env.QUEUE_TIMEOUT || "5000"),
};

// Global timeouts
const GLOBAL_TIMEOUT = 30000; // 30 seconds total
const TEST_TIMEOUT = 10000; // 10 seconds per test
```

**Vitest Configuration** (`/home/edward/projects/omni-post/apps/client/vitest.config.ts`)

```typescript
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./lib/api/__tests__/setup.ts"],
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
```

## Continuous Integration

### Pre-commit Hooks (Husky + lint-staged)

**Configuration** (`package.json`)

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yaml,yml}": ["prettier --write"]
  }
}
```

#### Execution Flow

1. **ESLint**: Automated fixing and validation
2. **Prettier**: Code formatting enforcement
3. **Type Check**: TypeScript compilation validation (manual)
4. **Pre-commit Tests**: Fast smoke tests (optional)

### GitHub Actions CI Pipeline

**Workflow Configuration** (`.github/workflows/ci.yml`)

The CI pipeline uses a composite action (`.github/actions/setup-node-pnpm-cache`) for consistent Node.js + pnpm setup with caching across all jobs.

**CI Jobs** (8 parallel jobs):

| Job               | Purpose                                                                                                   | Services               |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| `lint-and-format` | ESLint, Prettier, full-monorepo TypeScript type check (`turbo run typecheck`)                             | None                   |
| `test`            | API unit tests + coverage, sharded 2-way (vitest `--shard` + blob reporter; thresholds skipped per shard) | PostgreSQL 15, Redis 7 |
| `coverage-merge`  | Merges shard blobs (`vitest run --mergeReports`) and enforces coverage thresholds on the combined data    | None                   |
| `test-packages`   | Deterministic monorepo package tests (`turbo run test` excluding @apps/api, @apps/admin, @apps/client)    | None                   |
| `test-frontend`   | Admin + Client vitest unit tests                                                                          | None                   |
| `build`           | Build all packages + admin app                                                                            | None                   |
| `security`        | pnpm audit for vulnerabilities                                                                            | None                   |
| `code-quality`    | knip (dead code) + jscpd (duplicates) + madge (circular deps)                                             | None                   |

### CI/CD Best Practices

#### Parallel Execution

- All 8 jobs run independently in parallel
- Lint/Format checks run independently of tests
- Build validation runs separately to catch compilation issues
- Security audit runs in parallel for vulnerability detection
- Provider tests require no external services (Tier 0)
- Frontend tests require no external services (Tier 0)

#### Dependency Caching

- pnpm store caching for faster dependency installation
- Docker layer caching for service images
- Node.js compilation caching for TypeScript builds

#### Fail-Fast Strategy

- Early termination on critical failures (lint errors, build failures)
- Timeout protection for hanging tests (15-minute test timeout)
- Health check validation for external services

#### Environment Isolation

- Dedicated test database per CI run
- Redis instance isolation with different DB numbers
- Clean environment setup for each job

## Test Coverage and Metrics

### Current Implementation Coverage

#### API Test Coverage (Backend)

- **Authentication & Security**: 100% critical path coverage
  - Login/logout flows, JWT validation, MFA implementation
  - Rate limiting, session management, RBAC
- **Core Business Logic**: 95%+ coverage
  - Post creation, scheduling, media management
  - Threading algorithms, provider adapters
- **Database Operations**: 90%+ coverage
  - Prisma repository patterns, transaction handling
  - Account lifecycle, project management
- **Queue Processing**: 85%+ coverage
  - BullMQ job lifecycle, error handling, retry logic
- **Integration Flows**: 80%+ coverage
  - End-to-end publishing workflows, multi-project isolation

#### Client Test Coverage (Frontend)

- **API Client**: 90%+ coverage
  - HTTP client, authentication handling, error management
- **React Hooks**: 85%+ coverage
  - Custom hooks, state management, side effects
- **UI Components**: 70%+ coverage
  - Component rendering, user interactions, props validation
- **Integration Tests**: 60%+ coverage
  - Component integration, routing, state persistence

### Coverage Tools and Reporting

**Vitest Coverage** (Client)

```bash
# Generate coverage report
pnpm --filter @apps/client test:coverage

# Coverage configuration in vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
  },
});
```

**Manual Coverage Tracking** (API)

```typescript
// Result pattern coverage validation
export function expectOk<T>(result: Result<T, any>): T {
  if (!result.ok) {
    throw new Error(`Expected Ok result, got Err: ${result.error}`);
  }
  return result.value;
}

export function expectErr<E>(result: Result<any, E>): E {
  if (result.ok) {
    throw new Error(`Expected Err result, got Ok: ${result.value}`);
  }
  return result.error;
}
```

### Performance Testing

#### API Performance Metrics

- **Response Time**: <200ms for simple endpoints, <1s for complex operations
- **Database Query Performance**: <50ms for indexed queries
- **Queue Processing**: <1s per job processing time
- **Memory Usage**: <500MB during test execution

**Load Testing Strategy** (Future Implementation)

```typescript
// Example load test structure
describe("Load Testing", () => {
  it("should handle 100 concurrent requests", async () => {
    const requests = Array(100)
      .fill(null)
      .map(() => apiClient.getHealth());

    const results = await Promise.all(requests);
    results.forEach((result) => {
      expect(result.ok).toBe(true);
    });
  });
});
```

### Security Testing

#### API Security Validation

- **Authentication Bypass**: Testing unauthorized access attempts
- **SQL Injection**: Prisma ORM provides built-in protection
- **XSS Prevention**: Input sanitization and output encoding
- **CSRF Protection**: Token-based request validation
- **Rate Limiting**: Endpoint abuse prevention

#### Example Security Test

```typescript
// Test unauthorized access
async function testUnauthorizedAccess(ctx: TestContext): Promise<void> {
  // Attempt to access protected endpoint without token
  const result = await fetch("/api/projects", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  expect(result.status).toBe(401);
}
```

## Test Quality Standards

### Test Execution Performance

#### Speed Targets

- **Unit Tests**: <100ms per test (API), <50ms per test (Client)
- **Integration Tests**: <5s per test
- **Full Test Suite**: <2 minutes (API), <1 minute (Client)
- **CI Pipeline**: <15 minutes total

#### Reliability Metrics

- **Flaky Test Rate**: <1% (target: 0%)
- **False Positive Rate**: <2%
- **Test Isolation**: 100% (no shared state between tests)

### Code Quality Integration

#### ESLint Rules for Tests

```json
{
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "prefer-const": "error",
    "no-var": "error"
  }
}
```

#### Test-Specific Standards

- **Naming**: Descriptive test names using "should + action + condition"
- **Assertions**: Single concern per test with clear error messages
- **Setup/Teardown**: Minimal, automated, and reliable
- **Documentation**: Tests serve as living documentation

### Example Test Structure

#### API Test Pattern

```typescript
// Authentication flow test
runTestWithSetup(
  "Admin Registration and Login Flow",
  async (ctx: TestContext) => {
    // Arrange
    const adminEmail = `admin-${Date.now()}@test.com`;
    const password = "SecurePassword123!";

    // Act - Registration
    const registerResult = await authService.registerAdmin(
      adminEmail,
      password,
      "Test Admin",
      "ADMIN"
    );

    // Assert - Registration success
    if (!registerResult.ok) {
      throw new Error(`Registration failed: ${registerResult.error}`);
    }

    // Act - Login
    const loginResult = await authService.login(
      { email: adminEmail, password },
      "127.0.0.1",
      "Test-User-Agent"
    );

    // Assert - Login success
    if (!loginResult.ok) {
      throw new Error(`Login failed: ${loginResult.error}`);
    }

    expect(loginResult.value.user.email).toBe(adminEmail);
    expect(loginResult.value.tokens.accessToken).toBeDefined();
  },
  8000
);
```

#### Client Test Pattern

```typescript
// React component test
describe("Toast System", () => {
  it("should display and auto-dismiss toast notifications", async () => {
    await runTestWithSetup(async () => {
      // Arrange
      const mockToast = createMockUseToast();

      // Act
      mockToast.addToast({
        type: "success",
        message: "Operation completed",
        duration: 1000,
      });

      // Assert
      expect(mockToast.toasts.length).toBe(1);
      expect(mockToast.toasts[0].message).toBe("Operation completed");

      // Wait for auto-dismiss
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(mockToast.toasts.length).toBe(0);
    });
  });
});
```

This comprehensive testing strategy ensures high code quality, reliability, and maintainability across the React 19.2.4 + Next.js 16.1.6 + Fastify 5.6.1 stack using node:test (API), Vitest (frontend), and Playwright (E2E).
