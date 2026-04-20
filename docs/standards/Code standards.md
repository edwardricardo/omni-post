# OmniPost — Code Standards (transversal)

**Applies to:** `apps/admin`, `apps/client`, `apps/api`, `apps/workers`, `packages/**`
**Stack baseline:** TypeScript 6, Node.js 24
**Last updated:** 2026-04-18
**Version:** 1

This document defines conventions that apply across the entire monorepo, independent of runtime (frontend/backend/worker). Frontend-specific and backend-specific rules live in `FRONTEND_STANDARDS.md` and `BACKEND_STANDARDS.md` respectively.

---

## 1. TypeScript Compiler Configuration

Every `tsconfig.json` in the monorepo must extend `tsconfig.base.json` and inherit its strictness flags. Package-level overrides are allowed only to **add** strictness, never to relax it.

### 1.1 Required flags

The following flags are **mandatory** in `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true
  }
}
```

**What `strict: true` enables (all required):**

- `strictNullChecks`
- `noImplicitAny`
- `strictFunctionTypes`
- `strictBindCallApply`
- `strictPropertyInitialization`
- `noImplicitThis`
- `useUnknownInCatchVariables` — catch variables are `unknown`, not `any`
- `alwaysStrict`

### 1.2 Additional flags explained

**`noUncheckedIndexedAccess`** — accessing an array index or record key with unknown keys returns `T | undefined` instead of `T`. Forces explicit handling of absent values.

```ts
// With flag enabled, TypeScript catches:
const users: Record<string, User> = {};
const u = users["missing"]; // u: User | undefined
u.name; // ERROR — possibly undefined

// Correct:
if (u) u.name; // OK
const name = u?.name ?? "fallback"; // OK
```

**`exactOptionalPropertyTypes`** — differentiates `{ foo?: string }` (property may be absent) from `{ foo: string | undefined }` (property present with undefined).

**`noImplicitOverride`** — subclasses must use `override` keyword when overriding parent methods.

### 1.3 Forbidden configurations

- `"strict": false` in any tsconfig
- `"noImplicitAny": false` override anywhere
- `"skipLibCheck": false` is encouraged but not required (perf tradeoff)

---

## 2. Type Safety

### 2.1 Zero `any` rule

No `any` type in application code. This includes:

- Explicit annotations: `: any`, `Array<any>`, `Record<string, any>`, `Promise<any>`, `Map<K, any>`
- Type assertions: `as any`
- Implicit `any` is prevented by `noImplicitAny: true`

**Use instead:**

- **`unknown`** for truly unknown values (API responses before validation, catch variables)
- **Generics** for reusable logic
- **Union types** for known alternatives (`string | number`)
- **Proper domain types** imported from `packages/shared` or module types

### 2.2 Permitted exceptions

`any` is tolerated in these specific cases only, and each occurrence should have a brief comment explaining why:

- Test mocks where typing is expensive and value is internal: `jest.fn() as any`
- Third-party library gaps where correct types are unavailable and a wrapper is not feasible
- Generated code (Prisma outputs, OpenAPI clients) — wrap before exposing

All exceptions require the comment format:

```ts
// any-allowed: <reason>
const mockHandler = jest.fn() as any; // any-allowed: test mock, shape validated by runtime assertions
```

D2 audit will count `any` occurrences **without** this comment as violations.

### 2.3 Catch blocks — `unknown` + narrowing

With `useUnknownInCatchVariables: true`, the default type of catch variables is `unknown`. Narrowing is required before accessing properties.

**Standard pattern:**

```ts
try {
  await someOperation();
} catch (error) {
  // error is unknown
  if (error instanceof Error) {
    logger.error(error.message, { stack: error.stack });
  } else {
    logger.error(`Unknown error: ${String(error)}`);
  }
}
```

**Centralized helper** (recommended, lives in `packages/shared/src/errors.ts`):

```ts
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unknown error occurred";
}

export function getErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}
```

**Forbidden:**

```ts
catch (error: any) { ... }         // overrides unknown, violates §1.1
catch (error: Error) { ... }       // lies — catch can receive non-Error
```

### 2.4 Escape hatches

**`@ts-ignore`** — forbidden. Removes error without explanation.

**`@ts-expect-error`** — allowed only with a comment explaining why and a tracking ticket:

```ts
// @ts-expect-error -- library types are wrong, see JIRA-123
const result = thirdPartyFn(input);
```

If the error disappears later (library fixed types), TS will flag the unused `@ts-expect-error`, which is by design — remove it then.

**`@ts-nocheck`** — forbidden at file level. No exceptions.

### 2.5 Type assertions

Prefer type guards over `as` assertions:

```ts
// Correct — type guard
function isUser(value: unknown): value is User {
  return typeof value === "object" && value !== null && "id" in value && "email" in value;
}

const data = await fetchData();
if (isUser(data)) {
  data.id; // narrowed
}

// Acceptable — narrow cast after runtime check
const json = (await res.json()) as unknown;
if (isUser(json)) return json;

// Forbidden — blind assertion
const user = (await res.json()) as User; // no runtime check, hides errors
```

---

## 3. Path Conventions

### 3.1 Backend route registration

Backend routes register **without** the `/api/` prefix. The proxy handles the public-facing path.

```ts
// Correct
fastify.get("/admin/users", handler);
fastify.post("/webhooks/stripe", handler);

// Forbidden — causes PATH_MISMATCH bugs
fastify.get("/api/admin/users", handler);
```

**Historical context:** initialmente el codebase tenía un split ~60/40 (sin/con prefix). La cifra previa "461 de 471" era incorrecta (real: ~284 sin vs ~187 con prefix, confirmado PRE-D2 §4.4 y D0-v4 Piloto §8). Sprint D0v4-0 (Opción α, 2026-04-18) estandarizó ~141 endpoints a convención sin prefix. Los 9 endpoints CQRS (`CQRSIntegration.ts`) que aún usan prefix son DEAD_CODE pendiente de decisión §5.9. SSO fix previo (commit `7d16e66`, 8 endpoints) fue correcto pero por razón de coherencia de dominio, no por ser outlier.

### 3.2 Frontend fetch URLs

Frontend calls backend via Next.js proxy at `/api/backend/<path>`. The proxy strips `/api/backend/` and forwards to Fastify.

```ts
// Correct
fetch("/api/backend/admin/users");
fetch(`/api/backend/accounts/${accountId}/billing`);

// Forbidden — double prefix (maps to /api/<path>, not /admin/users)
fetch("/api/backend/api/admin/users");

// Forbidden — bypasses proxy, breaks auth injection
fetch("/api/admin/users"); // hits Next.js generic rewrite without auth handling
```

### 3.3 Path parameters

Always interpolate dynamic parts via template literals with explicit typing:

```ts
// Correct
fetch(`/api/backend/accounts/${accountId}/sessions`);

// Forbidden — string concatenation is fragile
fetch("/api/backend/accounts/" + accountId + "/sessions");
```

---

## 4. Code Hygiene

### 4.1 `console.*` in production code

**`console.log`, `console.debug`, `console.info`** — forbidden in production code paths. Use the observability logger (`@packages/observability/logger`).

```ts
// Forbidden
console.log("fetching data", userId);

// Correct
import { logger } from "@packages/observability/logger";
logger.info("fetching data", { userId });
```

**`console.warn`, `console.error`** — allowed only inside observability wrappers (logger adapters, error boundaries at top level). Anywhere else is a violation.

**Exceptions:**

- Test files (`*.test.*`, `*.spec.*`)
- Scripts in `scripts/` or `tools/`
- CLI entry points

### 4.2 `debugger` statements

Forbidden anywhere in the repo. D2 audit treats any `debugger;` as critical severity.

### 4.3 TODO / FIXME / XXX / HACK comments

Allowed only with an associated ticket in format `TODO(JIRA-123):` or `FIXME(#456):`:

```ts
// Correct
// TODO(OMNI-789): replace with tanstack-query once backend supports streaming

// Forbidden — no tracking, will be forgotten
// TODO: fix this
// FIXME
// XXX hack
```

Comments without tickets must be resolved or deleted before merging to main. D2 audit counts them as violations.

### 4.4 Commented-out code

Forbidden. Use git history for code archaeology. Commented-out blocks of 3+ lines that look like syntactically valid code are violations.

**Exception:** single-line examples in documentation comments (`/** ... */`) where the example is explicitly illustrative.

### 4.5 Empty catch blocks

Forbidden. Every catch must do **something**: log, rethrow, return a fallback, or explicitly document that swallowing is intentional with a comment.

```ts
// Forbidden
try { ... } catch (e) {}

// Correct — explicit intentional swallow
try { await cleanupNonCritical(); }
catch (e) { /* cleanup failure is non-blocking, see JIRA-123 */ }

// Correct — log and continue
try { ... } catch (e) { logger.warn("optional step failed", { error: getErrorMessage(e) }); }
```

---

## 5. File Organization (transversal)

### 5.1 File naming

| Type                   | Convention                    | Example                   |
| ---------------------- | ----------------------------- | ------------------------- |
| Class/Component        | `PascalCase.tsx`              | `StatCard.tsx`            |
| Function module        | `camelCase.ts`                | `useDashboardStats.ts`    |
| Utility / service      | `camelCase.ts`                | `formatCurrency.ts`       |
| Type-only module       | `camelCase.ts`                | `types.ts` or `domain.ts` |
| Config file            | `kebab-case` or tool-specific | `eslint.config.cjs`       |
| Route / page (Next.js) | tool-specific                 | `page.tsx`, `route.ts`    |

### 5.2 Import ordering

Every file imports in this order, with a blank line between groups:

1. **Runtime framework** — React, Next.js, Node built-ins (`react`, `next/navigation`, `node:fs`)
2. **External libraries** — npm packages (`@tanstack/react-query`, `fastify`, `zod`)
3. **Internal monorepo** — `@packages/*`, `@apps/*` aliases
4. **Relative imports** — `./`, `../`
5. **Type-only imports** last when separated (`import type { ... }`)

```ts
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { logger } from "@packages/observability/logger";

import { apiClient } from "@/lib/apiClient";
import { PageHeader } from "@/components/ui/PageHeader";

import type { DashboardStats } from "@packages/shared";
```

### 5.3 Constants extraction

Hardcoded strings, configuration objects, and lookup tables used inside components or functions must be extracted to module scope. Inline object literals recreated on every call/render are forbidden.

```ts
// Correct
const VARIANT_CLASSES: Record<Variant, string> = {
  success: "bg-green-100",
  error: "bg-red-100",
};

function Badge({ variant }: Props) {
  return <span className={VARIANT_CLASSES[variant]} />;
}

// Forbidden — recreates object every render
function Badge({ variant }: Props) {
  const classes = { success: "bg-green-100", error: "bg-red-100" };
  return <span className={classes[variant]} />;
}
```

---

## 6. Testing (transversal minimums)

Detailed testing rules live per-runtime in `FRONTEND_STANDARDS.md` and `BACKEND_STANDARDS.md`. The transversal minimums:

- Every new file that exports non-trivial logic has at least one test
- Test files colocate next to source (`foo.ts` + `foo.test.ts`) or live in a `tests/` folder parallel to `src/`
- `any` in tests follows §2.2 exception rules with `// any-allowed:` comment
- No `console.log` in tests either — use test runner output or `expect` assertions

---

## 7. Dead code policy

### 7.1 Definitions

**Dead code** — code with zero consumers anywhere in the monorepo, no plan to use, no historical reason to keep.

**Legacy code** — code with consumers but violating current standards. Migrate per standards, don't delete.

**Planned code** — code built but not yet integrated, with documented intent (see PLAN_MAESTRO §5 PLANNED category). Do not delete.

### 7.2 Deletion policy

Dead code must be deleted when identified during:

- Regular PR review
- Audit sprints (D1-D7)
- Pre-production cleanup (D6)

Before deleting, verify with §5.7 v3 methodology of `PLAN_MAESTRO.md`:

1. Literal path grep
2. Template literal grep
3. BASE constant grep
4. Count cross-check

All four must confirm zero consumers. If any returns a hit, classify as LEGACY or PLANNED, don't delete.

### 7.3 Deprecation before deletion

For code with uncertain consumers (e.g., published API endpoint), deprecate for one release cycle before removal:

```ts
/**
 * @deprecated Use `newFunction` instead. Removal planned for v2.0.
 */
export function oldFunction() { ... }
```

---

## 8. Git & Commit Conventions

(Scope limited — detailed commit rules live elsewhere if needed)

- Branch names: `feat/<short-description>`, `fix/<short-description>`, `chore/<short-description>`
- Commits: imperative mood ("Add X", not "Added X")
- Every doc created under `docs/audits/` or `docs/standards/` must be committed immediately — no "living documents untracked in git" (see LATERAL_FINDINGS 2026-04-17 entry)

---

## Summary checklist (for code review)

Before merging any PR that touches application code, verify:

- [ ] No new `any` without `any-allowed:` comment and justification
- [ ] All catch blocks narrow `unknown` with `instanceof Error` or helper
- [ ] No `@ts-ignore`; `@ts-expect-error` only with comment + ticket
- [ ] No `console.log` / `console.debug` in production paths
- [ ] No `debugger;` statements
- [ ] No TODO/FIXME without ticket reference
- [ ] No commented-out code blocks >3 lines
- [ ] No empty catch blocks
- [ ] Paths follow §3: backend no `/api/` prefix, frontend uses `/api/backend/`
- [ ] Imports grouped per §5.2
- [ ] Hardcoded constants extracted to module scope

---

## Changelog

| Date       | Change     | Rationale                                                                                                                                                                                                                          |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-18 | Initial v1 | Consolidate transversal rules extracted from REACT_STANDARDS.md (previously scattered). Integrate TS 2026 flags (noUncheckedIndexedAccess, exactOptionalPropertyTypes, useUnknownInCatchVariables) per Edward decision 2026-04-18. |
