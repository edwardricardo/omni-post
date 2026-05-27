# OpenAPI Auto-Gen Migration Guide

> Workstream: §3.1 Normalization Roadmap (Phase A1 closed; Phase B / §3.1.b PENDING).

## Resumen

El backend Fastify (`apps/api`) emite un spec OpenAPI 3.0 vía `@fastify/swagger`. El spec se transforma a tipos TypeScript canónicos via `@hey-api/openapi-ts` y se consume desde admin/client como tipos importables.

**Pipeline actual:**

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

**Comando para regenerar:** `pnpm generate:api-types`

Requiere: PostgreSQL + Redis up (porque `createApp()` se conecta). En CI los services del job test los proveen.

## Configuración crítica (canon)

`fastify-type-provider-zod` v6+ requiere TRES wirings — sin los tres, el spec emite Zod raw (`{ def: ... }`) y los tipos generados son `{[key:string]: unknown}`:

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
  transform: jsonSchemaTransform, // 3️⃣ — sin esto el spec queda mal
  openapi: {
    /* ... */
  },
});
```

## Recipe para migrar una ruta a Zod schema

**Antes** (status quo actual de ~342 rutas):

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

**Después** (post-§3.1.b migration):

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
    // request.params está tipado desde params schema; no más validateRequest manual
    const { projectId } = request.params;
    // ... handler body
  }
);
```

Migración por ruta toma ~5-15 min. La 342 routes restantes → §3.1.b (~50-60h total).

## Consumo desde frontend (admin/client)

`@hey-api/client-fetch` ya está instalado. Patrón:

```typescript
// apps/admin/lib/api/typed-client.ts (NEW — §3.1.b)
import { createClient } from "@hey-api/client-fetch";
import type { GetHealthData, GetHealthResponses } from "@shared/api-generated";

export const apiClient = createClient({
  baseUrl: "/api",
  credentials: "include",
});

// Llamado tipado:
const { data, error } = await apiClient.get<GetHealthResponses>({ url: "/health" });
// `data.status` es: 'healthy' | 'degraded' | 'unhealthy' — type-narrowed.
```

Phase A1 NO wire admin/client aún — el wireup es §3.1.b una vez que más rutas estén migradas (3 health endpoints no son consumed por UI de admin/client).

## Phase A1 (DONE) vs Phase B / §3.1.b (PENDING)

### Phase A1 — railroad + 3 endpoints

✅ **DONE:**

- `@hey-api/openapi-ts` v0.97.3 + `@hey-api/client-fetch` v0.13.1 instalados (pinned exact).
- `openapi-ts.config.ts` en repo root.
- `scripts/generate-api-types.ts` + `apps/api/scripts/dump-openapi-spec.ts`.
- `pnpm generate:api-types` script en root package.json.
- `jsonSchemaTransform` agregado al swagger plugin (root cause de "tipos vacíos").
- `js-yaml` override removido (forzaba v3 cuando consumers modernos quieren v4).
- 3 health routes (`/health`, `/health/live`, `/health/ready`) migradas con response schemas Zod completos.
- `packages/shared/src/api-generated/{types.gen.ts, index.ts}` committed (414 paths tipados, 3 con response schemas reales, los demás con response `{[key:string]: unknown}` esperando migración).
- Stop hook compliance: el generator post-procesa con `@file/@layer` headers JSDoc para que sobreviva regens.

### Phase B / §3.1.b — PENDING

⏭ **Backlog:**

- Migrar las ~342 rutas restantes a Zod schemas completos (params, query, body, response). Trabajo progresivo, por route file.
- Wirear admin `apps/admin/lib/api/typed-client.ts` + ≥1 call typed.
- Wirear client `apps/client/lib/api/typed-client.ts` + ≥2 calls typed.
- Gate de drift en CI: step en `.github/workflows/ci.yml` que corre `pnpm generate:api-types` + falla si `git diff` muestra cambios en `packages/shared/src/api-generated/`. Bloqueado en esta sesión por `omnipost-allow sensitive-edit` token intermittency — 10 LOC follow-up.

## Caveats conocidos

- **Boot time del generator**: ~80s porque `createApp()` inicializa Redis, BullMQ, Prisma, OTel, etc. No se necesita real DB writes; los runtime errors de Redis (timeouts) en el log son benignos — el spec se dumpea ANTES de que esos timeouts importen.
- **NODE_ENV=test recomendado** al correr local para skip de inits no críticos.
- **El generator NO corre en CI hoy** — Phase B/§3.1.b lo agrega.
- **Los archivos generados llevan `@file/@layer` JSDoc** (post-procesado por el script). NO editar a mano. Regen sobrescribe.
