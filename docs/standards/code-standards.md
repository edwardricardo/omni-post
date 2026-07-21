# OmniPost — Code Standards (transversal)

**Applies to:** `apps/admin`, `apps/client`, `apps/api`, `apps/workers`, `packages/**`
**Stack baseline:** TypeScript 6, Node.js 24
**Last updated:** 2026-04-18
**Version:** 1

This document defines conventions that apply across the entire monorepo, independent of runtime (frontend/backend/worker). Frontend-specific and backend-specific rules live in `FRONTEND_STANDARDS.md` and `BACKEND_STANDARDS.md` respectively.

---

## 0. Pre-implementation Discovery (NON-NEGOTIABLE)

**Before creating or implementing ANY new artifact — class, function, hook, component, service, route, use case, repository, port, adapter, value object, entity, event, job, configuration, test helper, or utility — you MUST first verify that no equivalent or similar implementation already exists in the codebase.**

This rule is non-negotiable. It applies to every contributor (human or AI), every sprint, every PR, with no exceptions beyond the escape hatch in §0.4.

### 0.1 Why this rule exists

The D0v4-1 backend audit (2026-04-20, `docs/audits/D0v4_1_BACKEND_SERVICES_REPORT.md`) found **6 duplications accumulated over time**, each representing unmaintainable parallel paths, asymmetric-sync bugs, and DRY violations:

1. **MFA duality** — `auth/mfaService.ts` (OLD, 521 LOC, SHA-256, `passwordResetToken` field HACK) coexists with `admin/auth/MfaService.ts` (NEW, 244 LOC, argon2). **Both in production**; only OLD is wired in DI.
2. **`reports/` vs `custom-reports/`** — two parallel scheduled-report systems with overlapping entities, repos, and UCs.
3. **`content/SyncEngineImpl` stubs duplicating `content/ConflictDetector` + `content/SyncScheduler`** — identical method names, fully functional code in helpers, stubs in the main engine that never reference the helpers.
4. **`providers/providerRegistry` + `providers/providerCapabilityManager`** — `getProvidersByCapability` implemented twice with near-identical logic; two module-level singletons.
5. **Module-level cache pattern** repeated in `GetTopPerformersContextUseCase.ts:53` + `FetchTrendingTopicsUseCase.ts:36` without a shared `CachePort` abstraction.
6. **Three client-side `useProviders` hooks** (`apps/client/lib/hooks/useProviders.ts`, `apps/client/lib/api/hooks.ts` re-export, `apps/client/hooks/api/useChannels.ts:72-76`) — registered in `LATERAL_FINDINGS.md` 2026-04-17.

Every one of these would have been prevented by a mandatory discovery step before implementation. This never happens again.

### 0.2 Discovery checklist (mandatory before writing code)

Before writing a single line of new code, execute this checklist. Document the commands used in the PR (see §0.3).

#### Step 1 — Name search (conceptual)

Search for the conceptual name across all casings and naming styles:

```bash
# PascalCase / camelCase / kebab-case / SNAKE_CASE
rg -i "(Name|Concept|Thing)" --type ts --type tsx
rg "\b(nameOrConcept|name_or_concept|name-or-concept)\b" --type ts --type tsx
```

#### Step 2 — Responsibility search (verb+noun)

Search for the action on the domain object. Use synonyms:

```bash
# Examples for "schedule a post"
rg "(schedule|queue|defer|plan).*(Post|Publication|Content)" --type ts
```

#### Step 3 — Port / interface search

Search for an existing port that might already define the contract:

```bash
rg "^export (interface|abstract class) .*(Repository|Port|Service|Manager|Dispatcher)" \
   apps/api/src/domain/repositories/ packages/ports/ --type ts
```

#### Step 4 — Adapter / concrete class search

Search for an existing adapter or concrete class that might implement what you need:

```bash
rg "^export class \w+(Repository|Service|Adapter|Handler|Manager)" \
   apps/api/src/ packages/ --type ts
```

#### Step 5 — Hook / component search (frontend)

```bash
rg "^export (function|const) (use|[A-Z])" apps/admin/ apps/client/ --type tsx --type ts | \
   grep -E "(use[A-Z]|[A-Z]\w+\s*[:=])"
```

#### Step 6 — Inventory review

Check these living documents before implementing:

- `docs/product/MASTER_PLAN_ES.md` §5 — inventario absorbido (API surface, clasificaciones, known issues, infra-ready). Los antiguos `docs/audits/{ENDPOINT_AUDIT,D1_DECISIONS,LATERAL_FINDINGS,CLIENT_LIB_HOOKS_AUDIT}.md` se **borraron** en la limpieza de la Pre-Fase; sus hallazgos se rescataron a §5 con su ID `FN-*`/`SMELL-*`.
- `docs/product/FEATURE_TRACE_MATRIX_ES.md` — clasificación por capacidad + canon 2026.

Something classified as `PLANNED`, `INFRASTRUCTURE_READY`, `PARTIALLY_ACTIVE`, or `LEGACY` may already satisfy the need — extend or revive it, don't duplicate.

#### Step 7 — Package search

Before implementing a utility, search `packages/shared/`, `packages/api-common/`, `packages/ui/`, `packages/adapters/`:

```bash
rg "^export (function|const|class) <name>" packages/ --type ts
```

### 0.3 Required PR metadata

Every PR that introduces a new artifact MUST include a `Discovery:` line in the commit message (or PR description) with exactly one of:

- `Discovery: no equivalent found — grepped <patterns> across <paths>`
- `Discovery: extending <file>:<line> — <existing artifact> lacks <capability>`
- `Discovery: refactoring <file>:<line> into current work — previous impl was <state>`
- `Discovery: consolidating <file A> + <file B> into <new file> — see <doc reference>`
- `Discovery: escape hatch per §0.4 — <reason>, migration plan in <doc>`

**PRs without this line are rejected in code review.** No exceptions. This is how the rule gets teeth.

### 0.4 Escape hatch (only with explicit Edward approval)

Creating a parallel implementation is acceptable only in three documented cases:

1. **Planned migration** — documented in `docs/audits/` with owner, deadline, and delete plan for the old artifact (e.g., the MFA migration approved in Checkpoint 3 of D0v4-1).
2. **Controlled A/B experimentation** — behind a feature flag, with a consolidation date, tracked in `docs/features/`.
3. **Genuinely new abstraction layer** — a new port for a domain with no prior representation. Must be reviewed before implementation.

In all three cases, the PR description must link to the authorizing doc/decision. The `Discovery:` line uses the escape-hatch form.

### 0.5 Prohibited anti-patterns

The following are always violations, independent of urgency or apparent convenience:

- Creating a second service / hook / component with the same purpose "for speed"
- Copying and pasting existing code into a new file
- Introducing a parallel abstraction "because the existing one is confusing" — fix the existing one instead
- Leaving the old version in production while introducing a new version without a delete plan (creates `LEGACY` duality)
- Pattern replication in multiple sites without abstracting (e.g., the module-level cache pattern — see §0.1.5)

### 0.6 If you find something equivalent

Preferred actions, in order:

1. **Reuse** — use the existing implementation as-is.
2. **Extend** — add the missing capability to the existing artifact.
3. **Refactor** — refactor the existing artifact as part of the current work.
4. **Consolidate** — if multiple partial implementations exist, merge them into one before continuing.

### 0.7 Enforcement

- **Code review gate:** reviewers verify the `Discovery:` line is substantive (not `Discovery: none` or empty greps) and the approach chosen (reuse/extend/refactor/consolidate) matches what the code does.
- **CI fitness function (target):** detect new files with high filename similarity (Levenshtein) to existing files; flag for manual review.
- **Audit cadence:** quarterly grep for known duplication patterns registered in `LATERAL_FINDINGS.md`.

### 0.8 AI-agent specific guidance

AI agents working in this repository (Claude, Cursor, Copilot, etc.) must execute §0.2 steps explicitly and report findings in the user-facing message before writing any code. An agent that produces new code without evidence of discovery has violated this standard.

If the user requests "create X", the agent's first action is the discovery checklist; only after reporting findings (and receiving confirmation when an equivalent exists) does the agent proceed with implementation.

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

**Historical context:** initialmente el codebase tenía un split ~60/40 (sin/con prefix). La cifra previa "461 de 471" era incorrecta (real: ~284 sin vs ~187 con prefix, confirmado PRE-D2 §4.4 y D0-v4 Piloto §8). Sprint D0v4-0 (Opción α, 2026-04-18) estandarizó ~141 endpoints a convención sin prefix. Los 9 endpoints CQRS que aún usaban prefix (`CQRSIntegration.ts`) quedaron resueltos por eliminación: el módulo se confirmó dead code (nunca instanciado) y se removió del repo, cerrando la decisión pendiente §5.9. SSO fix previo (commit `7d16e66`, 8 endpoints) fue correcto pero por razón de coherencia de dominio, no por ser outlier.

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
