# Contributing

Code standards and contribution guidelines for OmniPost development.

## Development Setup

```bash
# Clone and install
git clone <repository-url>
cd omni-post
pnpm install

# Start infrastructure
docker compose up -d

# Configure environment
cp .env.example .env

# Run migrations
pnpm db:migrate

# Start development
pnpm dev:api
```

## Code Standards

### TypeScript

**Strict Mode Required**:

- `strictNullChecks: true`
- `exactOptionalPropertyTypes: true`
- Target: ES2022

**Optional Properties**:

```typescript
// WRONG - assigns undefined explicitly
const obj = { ...existing, progress: undefined };

// CORRECT - conditional spreading
const obj = {
  ...existing,
  ...(progress !== undefined && { progress }),
};
```

**Result Pattern**:

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// Usage
const result = await service.createPost(data);
if (result.ok) {
  return result.value;
} else {
  throw new Error(result.error);
}
```

### Naming Conventions

| Type        | Convention  | Example            |
| ----------- | ----------- | ------------------ |
| Variables   | camelCase   | `userName`         |
| Constants   | UPPER_SNAKE | `API_BASE_URL`     |
| Components  | PascalCase  | `UserProfile`      |
| Files       | kebab-case  | `user-profile.tsx` |
| Directories | kebab-case  | `user-management/` |
| CSS Classes | kebab-case  | `.btn-primary`     |
| Database    | snake_case  | `user_id`          |
| Interfaces  | PascalCase  | `UserData`         |
| Enums       | PascalCase  | `UserRole`         |

### Unused Variables

Prefix with underscore:

```typescript
// Function parameter
function handler(_req: Request, res: Response) {}

// Destructuring
const { used, unused: _unused } = data;
```

## Architecture

### Hexagonal + DDD + CQRS + Event-Driven + Saga

```
Domain Layer (innermost)
    ↑ depends on nothing
    │
Application Layer
    ↑ depends on Domain
    │
Infrastructure Layer
    ↑ depends on Application (implements ports)
    │
Interface Layer (outermost)
    ↑ depends on Application
```

**Rule**: Dependencies always point inward.

### Directory Structure

```
apps/api/src/
├── domain/              # Business entities, value objects
├── application/         # Use cases, ports (interfaces)
├── infrastructure/      # Database, external APIs
└── interfaces/          # HTTP routes, middleware
```

## Testing

### Frameworks

Three frameworks with strict domain boundaries:

| Domain                                             | Framework    | Imports                                                                                               |
| -------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| Backend (API, providers, adapters, core, security) | `node:test`  | `import { describe, it, before, after } from "node:test"` + `import assert from "node:assert/strict"` |
| Frontend (admin components, client hooks)          | `vitest`     | `import { describe, it, expect, vi } from "vitest"` + `@testing-library/react`                        |
| E2E (admin auth, client publishing)                | `Playwright` | `import { test, expect } from "@playwright/test"`                                                     |

**Jest is NOT allowed.**

### Backend Pattern (node:test)

```typescript
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("Feature", () => {
  before(async () => {
    // One-time setup
  });

  beforeEach(async () => {
    // Per-test setup
  });

  after(async () => {
    // Cleanup
    await prisma.$disconnect();
  });

  it("should work correctly", async () => {
    const result = await service.method();
    assert.ok(result.ok);
    assert.strictEqual(result.value.name, "expected");
  });
});
```

### Frontend Pattern (vitest)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentUnderTest } from './ComponentUnderTest';

describe('ComponentUnderTest', () => {
  it('should render correctly', () => {
    render(<ComponentUnderTest title="Hello" />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

### Commands

```bash
# API tests (node:test)
pnpm --filter @apps/api test

# API with coverage
pnpm --filter @apps/api test:coverage

# API category
pnpm --filter @apps/api test:category:security

# Admin tests (vitest)
pnpm --filter @apps/admin test

# Client tests (vitest)
pnpm --filter @apps/client test

# E2E tests (Playwright)
pnpm --filter @apps/client test:e2e
pnpm --filter @apps/admin test:e2e
```

## Git Workflow

### Branch Naming

```
feature/add-user-auth
fix/login-redirect
refactor/post-service
docs/api-endpoints
```

### Commit Messages

```
feat: add user authentication
fix: resolve login redirect loop
refactor: extract post validation logic
docs: update API endpoint documentation
test: add integration tests for auth
chore: update dependencies
```

### Pre-commit Hooks

Husky runs automatically:

- ESLint with auto-fix
- Prettier formatting
- TypeScript type checking

## Code Quality

### ESLint

```bash
# Check
pnpm lint

# Auto-fix
pnpm lint:fix
```

### Prettier

```bash
# Format
pnpm format

# Check only
pnpm format:check
```

### Type Checking

```bash
# Check types
pnpm --filter @apps/api exec tsc --noEmit
```

## Pull Request Process

1. **Create branch** from `main`
2. **Implement changes** following standards
3. **Write tests** for new functionality
4. **Run checks**:
   ```bash
   pnpm lint
   pnpm format:check
   pnpm test
   ```
5. **Create PR** with description
6. **Address review** comments
7. **Merge** after approval

### PR Description Template

```markdown
## Summary

Brief description of changes.

## Changes

- Added X feature
- Fixed Y bug
- Refactored Z component

## Testing

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Screenshots

(if UI changes)
```

## Error Handling

### Never Bypass Problems

1. Research root cause
2. Find official solution
3. Implement proper fix
4. Document for future reference

### Result Type

```typescript
// Return Result, don't throw
async function createPost(data: CreatePostDTO): Promise<Result<Post, Error>> {
  try {
    const post = await repo.create(data);
    return { ok: true, value: post };
  } catch (error) {
    return { ok: false, error };
  }
}
```

## Security

### Secrets

- Never commit secrets
- Use environment variables
- Template files: `.env.example`, `app-secrets.yaml.template`

### Input Validation

- Validate all inputs with Zod
- Sanitize user content
- Check for injection patterns

### Authentication

- JWT tokens for API access
- MFA for admin users
- Session management with revocation

## Documentation

### Code Comments

Only where logic isn't self-evident:

```typescript
// Calculate engagement score using weighted average
// Likes: 1x, Comments: 2x, Shares: 3x
const score = likes + comments * 2 + shares * 3;
```

### API Documentation

OpenAPI specs generated from route schemas.

### Architecture Decisions

Document significant choices in code or ADRs.

---

<!-- markdownlint-disable-next-line MD036 -->

_Last updated: March 2026_
