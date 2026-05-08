# OmniPost — Backend Standards

**Applies to:** `apps/api`, `apps/workers`, `packages/adapters/**`, `packages/core/**`, `packages/ports/**`, backend portions of `packages/shared/**`
**Stack:** Fastify 5, Node.js 24, TypeScript 6, Prisma (PostgreSQL), BullMQ (Redis), Zod
**Last updated:** 2026-04-18
**Version:** 1 (stub — expanded progressively)
**Transversal rules:** see `CODE_STANDARDS.md` for TypeScript, catch blocks, path conventions, code hygiene, dead code policy.

---

## Status of this document

This is a **stub** intended to provide D2 (Standards Compliance audit) with a minimum set of backend-specific rules to audit against. It covers the most critical conventions observed in the codebase. Expansion to full standard (commit conventions, service layering, DI patterns, test coverage minimums, etc.) is deferred to a dedicated sprint post-audit cycle.

**For audit purposes, all rules in `CODE_STANDARDS.md` apply to backend code.** This document adds backend-specific rules that go beyond transversal standards.

---

## 0. Pre-implementation Discovery (NON-NEGOTIABLE)

**Before creating or implementing ANY new backend artifact — service, use case, query, command, repository, adapter, port, entity, value object, aggregate, domain event, route, middleware, worker, saga, or DI token — you MUST execute the discovery checklist in `CODE_STANDARDS.md` §0.**

This rule is non-negotiable. The D0v4-1 backend audit (2026-04-20, `docs/audits/D0v4_1_BACKEND_SERVICES_REPORT.md`) found 6 duplications in backend code alone. No exceptions.

### 0.1 Backend-specific discovery checklist

In addition to `CODE_STANDARDS.md` §0.2, execute these searches before writing backend code:

#### Step B1 — Existing use case search

```bash
# By verb+domain
rg "^export class \w+UseCase" apps/api/src/application/ --type ts
rg "^export class \w+Query" apps/api/src/application/ --type ts

# By input/output shape
rg "(Input|Output|Command|Query).*\w+" apps/api/src/application/**/types.ts
```

Before adding a use case, confirm no existing UC handles the same input → output shape. If one exists but is a query and you need a command (or vice versa), extend the existing module, don't create a parallel one.

#### Step B2 — Repository port + adapter cross-reference

```bash
# List all domain ports
rg "^export (interface|abstract class)" apps/api/src/domain/repositories/ --type ts

# List all Prisma adapters
rg "^export class Prisma\w+Repository" apps/api/src/infrastructure/repositories/ --type ts
```

If your domain needs persistence, first check if a matching port already exists. 17 orphan ports (ports without adapters) were found in D0v4-1 `LATERAL_FINDINGS` L-3 — consult that list before declaring a new port.

#### Step B3 — Route path collision

```bash
# Verify the intended path is free
rg "fastify\.(get|post|put|patch|delete)\(\"?<your-path>" apps/api/src/ --type ts
```

`ENDPOINT_AUDIT.md` has the full inventory of 466+ registered endpoints. Grep it before adding a route.

#### Step B4 — DI token check

```bash
rg "TOKENS\.\w+" apps/api/src/infrastructure/container/types.ts
```

Before adding a `TOKENS.X`, verify X doesn't already exist under a different name. The container currently holds ~292 tokens — naming collisions happen.

#### Step B5 — Middleware existence

```bash
rg "^export (function|const) require\w+" apps/api/src/auth/ --type ts
rg "^export (function|const) \w+Middleware" apps/api/src/ --type ts
```

Before writing a new auth / validation / rate-limit middleware, confirm an equivalent doesn't exist in `apps/api/src/auth/` or `apps/api/src/middleware/`.

#### Step B6 — Saga / event / job cross-reference

```bash
rg "^export (interface|class) \w+(Event|Job|Step)" apps/api/src/ packages/shared/src/events/ --type ts
```

Events and job types are often declared in multiple places. Before adding a new one, verify the semantic intent isn't already covered.

### 0.2 Backend-specific anti-patterns (always prohibited)

In addition to `CODE_STANDARDS.md` §0.5:

- Creating a second service with the same dominant responsibility (e.g., the MFA duality in `auth/mfaService.ts` vs `admin/auth/MfaService.ts` — both in production).
- Creating a second use case that calls the same aggregate method with different input shape — extend the existing UC's input instead.
- Introducing a new repository interface when `domain/repositories/` already has one with the same entity target — extend the existing port.
- Copy-pasting saga step logic across sagas — extract to a shared step factory.
- Adding a new queue name without checking `packages/shared/src/queues/` — the queue registry is centralized.
- Wrapping stub methods in a new class "to hide the incomplete implementation" — finish or revive the existing class instead (e.g., `content/SyncEngineImpl` stubs vs `content/ConflictDetector` + `SyncScheduler` functional code, registered in LATERAL_FINDINGS L-11).

### 0.3 PR metadata for backend PRs

Every backend PR introducing a new artifact includes the `Discovery:` line specified in `CODE_STANDARDS.md` §0.3. Backend reviewers verify that:

1. The grep commands reported include the backend-specific steps above (B1–B6 as applicable).
2. If extending/refactoring an existing artifact, the chosen artifact is classified `ACTIVE` or `PARTIALLY_ACTIVE` (not `LEGACY` — LEGACY should be replaced, not extended further).
3. New DI tokens are accompanied by registration in `Container.ts`.

---

## 1. Route Registration

### 1.1 Path conventions

Backend routes register **without** the `/api/` prefix. This is enforced in `CODE_STANDARDS.md` §3.1.

**Historical context (2026-04-18):** inicialmente el codebase tenía un split ~60/40 (sin/con prefix) derivado de drift histórico — la cifra previamente declarada "461 de 471" era incorrecta (real: ~284 sin vs ~187 con prefix, confirmado por PRE-D2 §4.4 y D0-v4 Piloto §8). Sprint D0v4-0 (Opción α, 2026-04-18) estandarizó ~141 endpoints a convención sin prefix. Los 9 endpoints CQRS (`CQRSIntegration.ts`) que aún usan prefix están marcados como DEAD_CODE y pendientes de decisión §5.9 en Sprint D0v4-2.

```ts
// Correct
fastify.get("/admin/users", { preHandler: [requireAdminAuth] }, handler);
fastify.post("/webhooks/stripe", handler);
fastify.put("/accounts/:accountId/settings", { preHandler: [requireClientAuth] }, handler);

// Forbidden — causes PATH_MISMATCH with Next.js proxy strip
fastify.get("/api/admin/users", handler);
```

### 1.2 Route file organization

One route file per domain under `apps/api/src/<domain>/<domain>Routes.ts`:

```
apps/api/src/
├── accounts/accountRoutes.ts
├── admin/
│   ├── adminUserRoutes.ts
│   ├── accountLifecycleRoutes.ts
│   └── ...
├── auth/
│   ├── authRoutes.ts
│   ├── samlRoutes.ts
│   └── ...
└── billing/
    ├── adminBillingRoutes.ts
    ├── clientBillingRoutes.ts
    └── ...
```

**Rule:** each route file exports a single plugin function that receives `fastify` and registers all routes of its domain.

### 1.3 Route handler contract

Every route handler must:

1. Declare `preHandler` middlewares explicitly (auth, validation, rate limiting)
2. Validate input via Zod or TypeBox schema in `schema.body` / `schema.params` / `schema.querystring`
3. Declare response shape in `schema.response` for at least the success path
4. Use the `logger` from the context, not `console.*`

```ts
// Correct — minimal canonical handler
fastify.post(
  "/admin/accounts",
  {
    preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
    schema: {
      body: CreateAccountSchema,
      response: {
        201: AccountResponseSchema,
      },
    },
  },
  async (request, reply) => {
    const account = await accountService.create(request.body);
    request.log.info({ accountId: account.id }, "account created");
    reply.code(201).send(account);
  }
);
```

### 1.4 Forbidden patterns

- Route files >500 lines — split by sub-domain
- Handler functions >80 lines — extract to service layer
- Inline SQL or Prisma calls inside handlers — use repository/service layer
- `console.*` inside handlers — use `request.log` (Fastify logger)

---

## 2. Authentication & Authorization

### 2.1 Required middleware per route

Every route (except `/health/*`, `/webhooks/*`, public redirects) must declare an explicit auth middleware in `preHandler`:

- `requireAdminAuth` — for admin portal endpoints
- `requireClientAuth` — for customer-facing endpoints
- `requireSuperAdmin` — for highly privileged operations
- `integrationAuthMiddleware` — for third-party integration endpoints (Zapier, Make)

### 2.2 Permission checks

Role-based permission checks layer on top of auth:

```ts
preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE)];

// Multi-permission (all required)
preHandler: [
  requireAdminAuth,
  requireAllPermissions(Permission.AUDIT_READ, Permission.AUDIT_EXPORT),
];

// Ownership or permission (either)
preHandler: [
  requireAdminAuth,
  requireOwnershipOrPermission({
    resource: "account",
    permission: Permission.ACCOUNT_MANAGE,
  }),
];
```

### 2.3 Forbidden patterns

- Missing `preHandler` on non-public routes — audit findings historically (PLAN_MAESTRO §1.1 Saga fix) show this creates security gaps
- Inline auth checks in handler body (`if (user.role !== 'ADMIN')`) — use the middleware
- Hardcoded role string comparisons — use `Permission` enum

---

## 3. Data Layer

### 3.1 Prisma usage

- All DB access goes through the Prisma client injected via DI container
- No `PrismaClient` instantiation inside route handlers or services
- Use transactions (`prisma.$transaction`) for multi-table operations that must be atomic

### 3.2 Repository pattern

Domain logic lives in services (`apps/api/src/<domain>/<domain>Service.ts`). Persistence lives in repositories (`apps/api/src/<domain>/<domain>Repository.ts`). Route handlers orchestrate but do not implement either.

```ts
// Correct flow
// Route handler
async (request, reply) => {
  const result = await accountService.suspend(request.params.id, request.body);
  reply.send(result);
};

// accountService
async suspend(id: string, data: SuspendData) {
  const account = await this.accountRepo.findById(id);
  if (!account) throw new NotFoundError();
  await this.accountRepo.update(id, { status: "SUSPENDED", ...data });
  await this.eventBus.emit("account.suspended", { accountId: id });
  return { success: true };
}

// accountRepository
async findById(id: string) {
  return this.prisma.account.findUnique({ where: { id } });
}
```

### 3.3 Schema source of truth

- Prisma schema (`infra/prisma/schema.prisma`) is the source of truth for data shape
- Zod/TypeBox validation schemas for API input must **stay in sync** with Prisma models
- Cross-check is scope of D3 (Data Integrity audit)

---

## 4. Error Handling

### 4.1 Error types

Use domain error classes, not plain `Error`:

```ts
// Correct — domain errors
import { NotFoundError, ValidationError, UnauthorizedError } from "@packages/shared/errors";

throw new NotFoundError("Account not found");
throw new ValidationError("Invalid email format", { field: "email" });
throw new UnauthorizedError("Token expired");
```

Fastify error handler maps these to HTTP status codes (404, 400, 401) and response shapes.

### 4.2 Catch blocks

Per `CODE_STANDARDS.md` §2.3 — use `unknown` and narrow with `instanceof Error` or the centralized `getErrorMessage` helper.

### 4.3 Logging errors

Use `request.log.error` (Fastify) or the observability logger (`@packages/observability/logger`), not `console.error`:

```ts
try {
  await riskyOperation();
} catch (error) {
  request.log.error({ err: error, accountId: request.params.id }, "failed to process account");
  throw error;
}
```

---

## 5. Schema Validation

### 5.1 Input validation

Every endpoint that accepts a body/params/querystring must validate with Zod or TypeBox (`schema` property of Fastify route).

```ts
// Correct
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const CreateAccountSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  tier: z.enum(["STARTER", "GROWTH", "AGENCY"]),
});

fastify.post(
  "/admin/accounts",
  {
    schema: {
      body: zodToJsonSchema(CreateAccountSchema),
    },
  },
  async (request, reply) => {
    const data = CreateAccountSchema.parse(request.body); // still narrow with Zod for types
    // ...
  }
);
```

### 5.2 Response validation

Declare `schema.response` for at least the 200/201 success path. This validates the response shape in development and drives OpenAPI generation.

---

## 6. Workers (BullMQ)

### 6.1 Worker structure

Workers live in `apps/workers/` and follow the pattern:

```
apps/workers/src/
├── <queueName>Worker.ts      # worker entry + processor
└── queues/<queueName>Queue.ts # queue config + enqueue helpers
```

### 6.2 Job handler contract

- Job handlers must be idempotent — same job run twice produces same result
- Use structured logging with `jobId` and job data in every log line
- Never swallow errors — let BullMQ retry policy handle failures
- Set explicit `attempts` and `backoff` per queue

### 6.3 Forbidden patterns

- `console.log` in workers — use logger
- Direct Prisma calls — go through services
- Sleeping with `setTimeout` — use BullMQ `delay` option

---

## 7. Testing (backend)

See `CODE_STANDARDS.md` §6 for transversal minimums. Backend-specific:

### 7.1 Unit tests

- Services and repositories tested in isolation with Vitest
- Mock dependencies via DI container overrides, not `jest.mock`
- Coverage target: services ≥80%, repositories ≥60%

### 7.2 Integration tests

- Test routes end-to-end with Fastify `inject()` and a real Prisma test DB
- Test files co-located in `tests/integration/` parallel to `src/`
- Database resets between tests via `TRUNCATE` or transaction rollback

### 7.3 Contract tests

- Every endpoint with a response schema should have a test that validates the real response matches the declared schema
- Scope of D4 (Functional Conformity audit)

---

## 8. Dead code (backend-specific)

See `CODE_STANDARDS.md` §7 for general policy. Backend-specific cases:

- **DEAD_CODE integration classes** (e.g., `CQRSIntegration` — never instantiated) — keep pending client refactor decision, or delete in dedicated cleanup sprint
- **PLANNED modules** (e.g., `content/` — built but not wired) — DO NOT DELETE. See PLAN_MAESTRO §5 PLANNED category and LATERAL_FINDINGS entries
- **ORPHAN endpoints** (registered but no consumer) — triaged in D1 (ENDPOINT_AUDIT and D1_DECISIONS)

---

## 9. Summary Checklist (backend PR review)

Before merging any backend PR:

- [ ] Route registered without `/api/` prefix
- [ ] Explicit `preHandler` with auth middleware (unless public route)
- [ ] Input validated via Zod/TypeBox schema
- [ ] Response schema declared (at least success path)
- [ ] Logging via `request.log` or `@packages/observability/logger`, not `console.*`
- [ ] Zero `any` (see `CODE_STANDARDS.md` §2)
- [ ] Catch blocks narrow `unknown` (see `CODE_STANDARDS.md` §2.3)
- [ ] Domain error classes used, not plain `Error`
- [ ] Services and repositories separated (per §3.2)
- [ ] Handler function <80 lines
- [ ] Route file <500 lines
- [ ] Multi-table mutations wrapped in `prisma.$transaction`
- [ ] Tests cover new service logic (see §7)

---

## 10. Scope NOT covered in this stub

The following areas are intentionally out of scope for v1 stub and should be addressed in future iterations:

- Detailed DI container conventions (registering vs resolving, factory patterns)
- OpenAPI generation pipeline
- Webhook signature validation patterns (beyond "must be validated")
- Migration / seed file conventions
- Connection pooling and query optimization
- Rate limiting per-endpoint policy
- OpenTelemetry instrumentation conventions
- Specific patterns for each provider adapter (social networks, CRMs, storage)

For D2 audit, these scopes are either transversal (caught by `CODE_STANDARDS.md`) or deferred to later audit dimensions (D3 data integrity, D5 security, D7 tests).

---

## Changelog

| Date       | Change          | Rationale                                                                                            |
| ---------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| 2026-04-18 | Initial v1 stub | Provide D2 audit with backend-specific rules. Transversal rules consolidated in `CODE_STANDARDS.md`. |
