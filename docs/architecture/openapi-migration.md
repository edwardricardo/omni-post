# OpenAPI Auto-Gen Migration Guide

> Workstream: §3.1 Normalization Roadmap (Phase A1 closed; Phase B / §3.1.b PENDING).

## Summary

The Fastify backend (`apps/api`) emits an OpenAPI 3.0 spec through `@fastify/swagger`. The spec is transformed into canonical TypeScript types through `@hey-api/openapi-ts` and consumed by admin/client as importable types.

**Current pipeline:**

```
Route schema (Zod)
    ↓
fastify-type-provider-zod (jsonSchemaTransform)
    ↓
@fastify/swagger spec (OpenAPI 3.0 / JSON Schema)
    ↓
apps/api/scripts/dump-openapi-spec.ts  →  /tmp/omnipost-openapi.json
    ↓
@hey-api/openapi-ts (openapi-ts.config.ts)
    ↓
packages/shared/src/api-generated/{types.gen.ts, index.ts}
```

**Command to regenerate:** `pnpm generate:api-types`

Requires: PostgreSQL + Redis up (because `createApp()` connects). In CI, the test job's services provide them.

## Critical configuration (canon)

`fastify-type-provider-zod` v6+ requires THREE wirings — without all three, the spec emits raw Zod (`{ def: ... }`) and the generated types are `{[key:string]: unknown}`:

```typescript
// apps/api/src/index.ts
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  ZodTypeProvider,
} from "fastify-type-provider-zod";

const typedApp = app.withTypeProvider<ZodTypeProvider>();
typedApp.setValidatorCompiler(validatorCompiler); // 1️⃣
typedApp.setSerializerCompiler(serializerCompiler); // 2️⃣

await typedApp.register(fastifySwagger.default, {
  transform: jsonSchemaTransform, // 3️⃣ — without this the spec comes out wrong
  openapi: {/* ... */},
});
```

## Recipe for migrating a route to a Zod schema

**Before** (the current status quo of ~342 routes):

```typescript
const ProjectIdParamsSchema = z.object({ projectId: z.string().uuid() });

fastify.get(
  "/projects/:projectId",
  {
    preHandler: [requireClientAuth],
    schema: { tags: ["Projects"], summary: "Get project by ID" },
  },
  async (request, reply) => {
    const validated = await this.validateRequest(ctx, { params: ProjectIdParamsSchema });
    if (!validated.ok) return this.sendError(ctx, 400, "Invalid project ID");
    // ... handler body
  }
);
```

**After** (post-§3.1.b migration):

```typescript
const ProjectIdParamsSchema = z.object({ projectId: z.string().uuid() });
const ProjectResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  locale: z.string(),
  createdAt: z.string(),
});

fastify.get(
  "/projects/:projectId",
  {
    preHandler: [requireClientAuth],
    schema: {
      tags: ["Projects"],
      summary: "Get project by ID",
      params: ProjectIdParamsSchema,
      response: { 200: ProjectResponseSchema, 404: ErrorResponseSchema },
    },
  },
  async (request, reply) => {
    // request.params is typed from the params schema; no more manual validateRequest
    const { projectId } = request.params;
    // ... handler body
  }
);
```

Migrating one route takes ~5-15 min. The 342 remaining routes → §3.1.b (~50-60h total).

## Consumption from the frontend (admin/client)

The fetch client is not a separate package: the standalone `@hey-api/client-fetch` was removed on
2026-10-03 (decision D35 in `docs/development/TESTING_REFOUNDATION.md`), because npm deprecates it as
bundled inside `@hey-api/openapi-ts` since 0.73. The bundled plugin carries the same name: adding
`"@hey-api/client-fetch"` to `plugins` in `openapi-ts.config.ts` generates `client/` (which exports
`createClient`) and `client.gen.ts` next to `types.gen.ts` — measured against openapi-ts 0.97.3 on
2026-10-03. Pattern, once that plugin is enabled:

```typescript
// apps/admin/lib/api/typed-client.ts (NEW — §3.1.b)
import { createClient } from "@shared/api-generated/client";
import type { GetHealthData, GetHealthResponses } from "@shared/api-generated";

export const apiClient = createClient({
  baseUrl: "/api",
  credentials: "include",
});

// Typed call:
const { data, error } = await apiClient.get<GetHealthResponses>({ url: "/health" });
// `data.status` is: 'healthy' | 'degraded' | 'unhealthy' — type-narrowed.
```

Phase A1 does NOT wire admin/client yet — the wireup is §3.1.b once more routes are migrated (the 3 health endpoints are not consumed by the admin/client UI).

## Phase A1 (DONE) vs Phase B / §3.1.b (PENDING)

### Phase A1 — railroad + 3 endpoints

✅ **DONE:**

- `@hey-api/openapi-ts` v0.99.0 installed (pinned exact). It replaced 0.97.3 on 2026-10-04; from the same spec, 0.97.3 and 0.99.0 generate byte-identical types. `@hey-api/client-fetch` v0.13.1 was installed beside it
  and removed on 2026-10-03 (decision D35): deprecated, and bundled inside openapi-ts since 0.73.
- `openapi-ts.config.ts` at the repo root.
- `scripts/generate-api-types.ts` + `apps/api/scripts/dump-openapi-spec.ts`.
- `pnpm generate:api-types` script in the root package.json.
- `jsonSchemaTransform` added to the swagger plugin (the root cause of "empty types").
- `js-yaml` override removed (it forced v3 when modern consumers want v4).
- 3 health routes (`/health`, `/health/live`, `/health/ready`) migrated with complete Zod response schemas.
- `packages/shared/src/api-generated/{types.gen.ts, index.ts}` committed (414 typed paths, 3 with real response schemas, the rest with a `{[key:string]: unknown}` response awaiting migration).
- Stop hook compliance: the generator post-processes with `@file/@layer` JSDoc headers so they survive regenerations.

### Phase B / §3.1.b — PENDING

⏭ **Backlog:**

- Migrate the ~342 remaining routes to complete Zod schemas (params, query, body, response). Progressive work, one route file at a time.
- Wire admin `apps/admin/lib/api/typed-client.ts` + ≥1 typed call.
- Wire client `apps/client/lib/api/typed-client.ts` + ≥2 typed calls.
- Drift gate in CI: a step in `.github/workflows/ci.yml` that runs `pnpm generate:api-types` + fails if `git diff` shows changes in `packages/shared/src/api-generated/`. Blocked in this session by `omnipost-allow sensitive-edit` token intermittency — 10 LOC follow-up.

## Known caveats

- **Generator boot time**: ~80s because `createApp()` initializes Redis, BullMQ, Prisma, OTel, etc. No real DB writes are needed; the Redis runtime errors (timeouts) in the log are benign — the spec is dumped BEFORE those timeouts matter.
- **NODE_ENV=test recommended** when running locally, to skip non-critical inits.
- **The generator does NOT run in CI today** — Phase B/§3.1.b adds it.
- **The generated files carry `@file/@layer` JSDoc** (post-processed by the script). Do NOT edit by hand. A regeneration overwrites them.
