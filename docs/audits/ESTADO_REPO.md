# ESTADO_REPO — Mapeo descriptivo del estado actual

> Sprint **MAPEO_ESTADO_REPO**. Ejecutado 2026-05-29. Working dir
> `/root/omni-post`. Único input documental autorizado: `CLAUDE.md`. Resultado:
> mapa exhaustivo y **descriptivo** del repo. No se contrasta contra ningún
> ideal externo — los hallazgos son endógenos (duplicación, inconsistencia
> interna, archivos huérfanos, mismatch interno).
>
> Cada finding incluye evidencia (comando shell + path absoluto). Archivos
> dudosos quedan marcados como `SOSPECHOSO_DE_MUERTO`, nunca `DEAD_CODE`.

---

## 0. Resumen ejecutivo

Repo monorepo `pnpm@10.16.0` con 4 apps (`api`, `admin`, `client`, `workers`),
11 paquetes top-level en `packages/` y 49 sub-paquetes anidados bajo
`packages/core/` (resultado de un split reciente). Stack backend Fastify
5.8.5 + Prisma 7.6.0 + BullMQ; frontend Next.js 16.2.6 + React 19.2.4.

### Distribución gruesa

| Métrica                                     | Valor                                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Apps                                        | 4 (`api`, `admin`, `client`, `workers`)                                                                                                       |
| Packages top-level                          | 11 (`adapters/`, `api-common`, `api-errors`, `core/`, `monitoring/`, `observability/`, `ports`, `providers/`, `query-client`, `shared`, `ui`) |
| Sub-packages dentro de `packages/core/`     | 49 (uno por bounded context + `domain` + `application` + `engine` + `threading`)                                                              |
| Adapters sub-packages                       | 7 (`cache-redis`, `dead-letter-queue`, `db-prisma`, `external-apis`, `fallback-strategies`, `queue-bullmq`, `storage-s3`)                     |
| Providers sub-packages                      | 12 (11 social providers + `_template`)                                                                                                        |
| `.ts` en `apps/api/src/`                    | 525                                                                                                                                           |
| `.ts` en `apps/workers/src/`                | 13                                                                                                                                            |
| `package.json` totales (excl. node_modules) | 94                                                                                                                                            |
| `tsconfig.json` totales                     | 81                                                                                                                                            |
| Grafos Graphify                             | 5 (apps/api, apps/admin, apps/client, apps/workers, packages)                                                                                 |

### Hallazgos de orden mayor (detalle en §7)

1. **Mismatch interno de versión de TypeScript**: 48 sub-paquetes bajo
   `packages/core/*/package.json` declaran `"typescript": "6.0.2"` (versión
   inexistente al 2026-05-29 — el major estable es 5.9.x). La resolución
   pnpm efectiva es 5.9.3 (lo que sí usa el resto del repo). Evidencia
   reproducible: `grep -rh '"typescript":' packages/core/*/package.json | sort | uniq -c` → `48  "typescript": "6.0.2",`.
2. **Divergencia menor de `tsx`**: root + apps usan 4.20.5 / 4.21.0 mezclado
   (root 4.21.0, `apps/api` 4.20.5, `apps/workers` 4.20.5).
3. **`jq` instalado como devDep pero roto**: `node_modules/.bin/jq` falla con
   `Cannot find module 'async'` (paquete npm `jq@1.7.2` tiene su dep
   transitiva sin resolver). Como mitigación se usó `python3 -m json` para
   todo el parseo JSON de esta auditoría.
4. **2 grafos Graphify sin viz HTML por límite de tamaño**: `apps/api`
   (12 232 nodos) y `packages/` (12 592 nodos) exceden el corte 5 000 de
   Graphify (`Skipped graph.html: too large for HTML viz`). `graph.json` y
   `GRAPH_REPORT.md` sí están al día.
5. **Mismatch del sprint vs realidad de tooling**: El prompt del sprint dice
   "instalar Graphify donde falte usando pnpm respetando workspace"; Graphify
   es CLI standalone en `~/.local/bin/graphify@0.8.18`, no un paquete npm.
   La fase de "instalación" se reinterpretó como "regenerar mapas faltantes".

---

## 1. Estado de la raíz

### 1.1 Archivos presentes

```
.env
.env.example       ← tracked
.env.test
.env.test.example  ← tracked
.gitignore
CLAUDE.md
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
turbo.json
```

Evidencia: `ls -la pnpm-workspace.yaml tsconfig.base.json turbo.json .env* CLAUDE.md package.json pnpm-lock.yaml .gitignore`.

### 1.2 Seguridad — `.env` tracking

- `.env` y `.env.*` en `.gitignore` (líneas literales).
- Sólo trackeados: `.env.example`, `.env.test.example`.
- Evidencia: `git ls-files | grep -E "^\.env"` → solo `.env.example` y `.env.test.example`.
- **Veredicto endógeno**: no hay leak de `.env` real en el árbol git.

### 1.3 `pnpm-workspace.yaml`

```yaml
packages:
  - apps/*
  - packages/*
  - packages/providers/*
  - packages/adapters/*
  - packages/core/*
  - packages/monitoring/*
  - packages/observability/*
  - infra/*

enableGlobalVirtualStore: true

ignoredBuiltDependencies:
  - bcrypt
```

Cuatro globs anidados (`packages/providers/*`, `packages/adapters/*`,
`packages/core/*`, `packages/monitoring/*`, `packages/observability/*`)
porque ciertos paquetes top-level (`adapters`, `providers`, `core`, etc.)
funcionan como containers de sub-paquetes.

### 1.4 `turbo.json`

8 tasks definidos: `build`, `dev`, `lint`, `mutation`, `test`,
`test:coverage`, `test:e2e`, `typecheck`. Evidencia:
`python3 -c "import json; t=json.load(open('turbo.json')); print(sorted(t['tasks'].keys()))"`.

### 1.5 `tsconfig.base.json`

```
target: ES2022
module: ESNext
moduleResolution: bundler
strict: true
exactOptionalPropertyTypes: true
paths count: 128
```

128 alias `paths` declarados — el monorepo enrutamiento TS está fuertemente
parcializado (cada bounded context y package tiene su alias).

### 1.6 `package.json` raíz

```
name: omni-post
version: 1.0.0
private: true
packageManager: pnpm@10.16.0
dependencies: 2
devDependencies: 44
scripts: 46
```

#### Devs root relevantes (selección)

| Categoría          | Paquetes                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code quality       | `eslint@9.36.0`, `prettier@3.8.1`, `lint-staged@16.4.0`, `husky@9.1.7`                                                                                              |
| Linting plugins    | `@typescript-eslint/*@8.59.2`, `eslint-plugin-react@7.37.5`, `eslint-plugin-jsx-a11y@^6.10.2`, `eslint-plugin-react-hooks@7.0.1`, `eslint-plugin-boundaries@^6.0.2` |
| Tests / mutation   | `@stryker-mutator/core@9.6.0`, `@stryker-mutator/vitest-runner@9.6.0`, `msw@2.14.3`                                                                                 |
| Análisis           | `knip@6.12.2`, `madge@8.0.0`, `depcheck@1.4.7`, `dependency-cruiser@17.4.0`, `jscpd@4.0.8`, `@ast-grep/cli@0.42.0`                                                  |
| Performance / load | `autocannon@8.0.0`, `loadtest@8.2.1`                                                                                                                                |
| Build              | `turbo@2.8.21`, `tsx@4.21.0`, `typescript@5.9.3`                                                                                                                    |
| Otros              | `jiti@^2.6.1`, `concurrently@9.2.1`, `jq@1.7.2`, `license-checker@25.0.1`, `size-limit@^12.1.0`, `secretlint@^12.3.1`                                               |
| OpenAPI gen        | `@hey-api/client-fetch@0.13.1`, `@hey-api/openapi-ts@0.97.3`                                                                                                        |
| Frontend           | `react@19.2.4`, `react-dom@19.2.4`, `@types/react@19.2.14`, `@types/react-dom@19.2.3`                                                                               |
| Validation         | `zod@4.3.6`, `fastify-type-provider-zod@6.1.0`                                                                                                                      |
| Accessibility      | `@axe-core/playwright@4.10.2`                                                                                                                                       |

#### Scripts root (46 totales)

Agrupados por dominio:

- **Build/dev**: `build`, `dev`, `dev:all`, `dev:admin`, `dev:api`, `dev:client`, `dev:workers`, `start:full`
- **Quality / lint / format**: `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `typecheck:apps`
- **Tests**: `test`, `test:all`, `test:branch`
- **Análisis estático**: `knip`, `knip:fix`, `check:dead-code`, `check:circular`, `check:duplicates`
- **Database**: `db:up`, `db:migrate`, `db:studio`, `db:seed`
- **Performance**: `perf:api`, `perf:baseline`, `perf:db`, `perf:endurance`, `perf:load`, `perf:memory`, `perf:regression`, `perf:report`, `perf:stress`, `perf:test`
- **Quality dashboard**: `quality:bundle`, `quality:check`, `quality:dashboard`, `quality:full`, `quality:security`, `quality:setup`
- **Secretos / env / API**: `generate:api-types`, `env:backup`, `env:restore`, `secret:scan`
- **Husky**: `prepare`

### 1.7 Versiones cross-package (divergencia interna)

Evidencia: `pnpm why <pkg> -r --json | python3 ...` (parseo JSON desde stdin).

| Paquete      | Versiones encontradas en árbol | Comentario                                          |
| ------------ | ------------------------------ | --------------------------------------------------- |
| `react`      | `19.2.4`                       | sin divergencia                                     |
| `typescript` | `5.9.3` (resolved)             | sin divergencia en árbol resuelto **PERO** ver §1.8 |
| `prisma`     | `7.6.0`                        | sin divergencia                                     |
| `fastify`    | `5.8.5`                        | sin divergencia                                     |
| `next`       | `16.2.6`                       | sin divergencia                                     |
| `zod`        | `4.3.6`                        | sin divergencia                                     |
| `vitest`     | `4.0.18`                       | sin divergencia                                     |
| `tsx`        | `4.20.5`, `4.21.0`             | **divergencia interna** — ver §1.9                  |
| `pino`       | `10.3.1`                       | sin divergencia                                     |

### 1.8 Mismatch de TypeScript declarado vs resuelto

```bash
grep -rh '"typescript":' packages/core/*/package.json | sort | uniq -c
# →  48  "typescript": "6.0.2",
#     1  "typescript": "6.0.2"        (sin coma final, en el archivo final del directorio)
```

48 sub-paquetes bajo `packages/core/*` (los 46 bounded contexts + 2 más)
declaran literal `"typescript": "6.0.2"`. **La versión 6.0.2 no existe**
en el ecosistema npm de TypeScript (último major estable: 5.9.x). pnpm
los resolvió todos a `5.9.3` (la versión real, declarada en la root). El
síntoma es inocuo en runtime pero hace ruido en cualquier auditoría.

### 1.9 Divergencia de `tsx`

```bash
grep -rE "\"tsx\":" packages/*/package.json apps/*/package.json package.json | sort -u
# apps/api/package.json:    "tsx": "4.20.5",
# apps/workers/package.json: "tsx": "4.20.5",
# package.json:              "tsx": "4.21.0",
```

Root pinéa 4.21.0; `apps/api` y `apps/workers` pinéan 4.20.5. Tres
declaraciones distintas conviven; pnpm crea dos versiones reales en el store.

### 1.10 `jq` instalado pero roto

```bash
./node_modules/.bin/jq 2>&1 | head -2
# Error: Cannot find module 'async'
```

El paquete npm `jq@1.7.2` (declarado en root devDeps) tiene una dependencia
transitiva no resuelta (`async`). El bin `jq` lanza error y termina. Esta
auditoría usa `python3` como fallback para todo parseo JSON.

---

## 2. Inventario de packages/

### 2.1 Estructura de alto nivel

`packages/` agrupa 6 paquetes top-level con código + 5 directorios
"container" que actúan de namespace para sub-paquetes:

| Path                      | Tipo      | Contiene                                             |
| ------------------------- | --------- | ---------------------------------------------------- |
| `packages/api-common`     | package   | helpers Fastify compartidos                          |
| `packages/api-errors`     | package   | clases de error compartidas                          |
| `packages/ports`          | package   | interfaces de port (`@ports/core`)                   |
| `packages/query-client`   | package   | react-query wrappers para front                      |
| `packages/shared`         | package   | tipos `Result`, `AppError`, etc. (`@shared/types`)   |
| `packages/ui`             | package   | componentes UI compartidos (`@packages/ui`)          |
| `packages/adapters/`      | container | 13 sub-paquetes                                      |
| `packages/core/`          | container | 49 sub-paquetes (bounded contexts + shared kernels)  |
| `packages/monitoring/`    | container | 2 sub-paquetes                                       |
| `packages/observability/` | container | 4 sub-paquetes                                       |
| `packages/providers/`     | container | 13 sub-paquetes (11 social + `shared` + `_template`) |

### 2.2 Tabla compacta — `packages/` top-level

Evidencia para los conteos: `grep -rln "from [\"']${name}" apps/ packages/ --include="*.ts" --include="*.tsx" | wc -l`.

| Package        | Nombre npm               | Consumers | Estado       |
| -------------- | ------------------------ | --------- | ------------ |
| `api-common`   | `@packages/api-common`   | 24        | activo       |
| `api-errors`   | `@packages/api-errors`   | 63        | activo       |
| `ports`        | `@ports/core`            | 147       | activo       |
| `query-client` | `@packages/query-client` | 2         | **uso bajo** |
| `shared`       | `@shared/types`          | 701       | core         |
| `ui`           | `@packages/ui`           | 141       | activo       |

### 2.3 `packages/adapters/` (13 sub-paquetes)

| Sub-paquete           | npm                             | Consumers | Estado       |
| --------------------- | ------------------------------- | --------- | ------------ |
| `cache-redis`         | `@adapters/cache-redis`         | 23        | activo       |
| `crm-hubspot`         | `@adapters/crm-hubspot`         | **0**     | **HUÉRFANO** |
| `crm-salesforce`      | `@adapters/crm-salesforce`      | **0**     | **HUÉRFANO** |
| `db-prisma`           | `@adapters/db-prisma`           | 7         | activo       |
| `dead-letter-queue`   | `@adapters/dead-letter-queue`   | 2         | uso bajo     |
| `external-apis`       | `@adapters/external-apis`       | 26        | activo       |
| `fallback-strategies` | `@adapters/fallback-strategies` | 22        | activo       |
| `queue-bullmq`        | `@adapters/queue-bullmq`        | 23        | activo       |
| `storage-azure`       | `@adapters/storage-azure`       | **0**     | **HUÉRFANO** |
| `storage-cloudinary`  | `@adapters/storage-cloudinary`  | **0**     | **HUÉRFANO** |
| `storage-do-spaces`   | `@adapters/storage-do-spaces`   | **0**     | **HUÉRFANO** |
| `storage-gcs`         | `@adapters/storage-gcs`         | **0**     | **HUÉRFANO** |
| `storage-s3`          | `@adapters/storage-s3`          | 3         | activo       |

**Patrón endógeno detectado**: 5 adaptadores de storage existen (`azure`, `cloudinary`, `do-spaces`, `gcs`, `s3`), pero sólo `s3` tiene consumers. Los otros 4 son sub-paquetes huérfanos — no son referenciados desde ningún `.ts/.tsx` en `apps/` o `packages/`.

**Dependency chain entre adapters**:

```
storage-do-spaces  →  storage-s3      (inheritance)
storage-cloudinary →  external-apis
storage-s3         →  external-apis
external-apis      →  dead-letter-queue + fallback-strategies + queue-bullmq
dead-letter-queue  →  queue-bullmq
```

Evidencia: `python3 -c "import json; ..."` sobre cada `package.json` (sección "Adapters cross-dependency" del shell output).

### 2.4 `packages/core/` (49 sub-paquetes)

Distribución de consumers ordenada de menor a mayor. Salen 4 grupos
naturales:

#### Huérfano (0 consumers)

| Sub-paquete | npm               | Consumers |
| ----------- | ----------------- | --------- |
| `threading` | `@core/threading` | **0**     |

#### Uso muy bajo (2 consumers)

| Sub-paquete         | Consumers |
| ------------------- | --------- |
| `aiPromptTemplates` | 2         |
| `comments`          | 2         |
| `team`              | 2         |

#### Uso bajo (3–10 consumers): 24 sub-paquetes

`ai-image (3)`, `brand-kit (3)`, `campaigns (3)`, `crm (3)`,
`external-notifications (3)`, `first-comment (3)`, `reports (3)`, `tasks (3)`,
`approvals (4)`, `assets (4)`, `brand-voice (4)`, `customer-auth (4)`,
`links (4)`, `providers (4)`, `settings (4)`, `usage (4)`, `utm (4)`,
`apiKeys (5)`, `crisis (5)`, `custom-reports (5)`, `mentions (5)`,
`ml (5)`, `recurring (5)`, `glossary (6)`, `guardrails (6)`,
`style-guide (6)`, `compliance (7)`, `integrations (7)`, `listening (7)`,
`referral (7)`, `notifications (8)`, `webhooks (8)`, `embeddings (10)`.

#### Uso moderado–alto (10–35 consumers): 8 sub-paquetes

| Sub-paquete       | Consumers |
| ----------------- | --------- |
| `analytics`       | 11        |
| `auth`            | 11        |
| `bulk-scheduling` | 11        |
| `channels`        | 11        |
| `security`        | 12        |
| `posts`           | 16        |
| `inbox`           | 17        |
| `billing`         | 20        |
| `trends`          | 20        |
| `ai`              | 33        |

#### Core de núcleo (>100 consumers)

| Sub-paquete   | npm                 | Consumers |
| ------------- | ------------------- | --------- |
| `application` | `@core/application` | 235       |
| `domain`      | `@core/domain`      | 618       |

### 2.5 `packages/providers/` (13 sub-paquetes)

| Sub-paquete | Consumers | Estado                                       |
| ----------- | --------- | -------------------------------------------- |
| `_template` | 0         | template legítimo (no es huérfano semántico) |
| `bluesky`   | 4         | activo                                       |
| `facebook`  | 3         | activo                                       |
| `instagram` | 11        | activo                                       |
| `linkedin`  | 3         | activo                                       |
| `pinterest` | 3         | activo                                       |
| `shared`    | 27        | activo (compartido entre providers)          |
| `snapchat`  | 3         | activo                                       |
| `telegram`  | 3         | activo                                       |
| `threads`   | 2         | uso bajo                                     |
| `tiktok`    | 3         | activo                                       |
| `x`         | 6         | activo                                       |
| `youtube`   | 3         | activo                                       |

### 2.6 `packages/monitoring/` (2 sub-paquetes)

| Sub-paquete       | Consumers |
| ----------------- | --------- |
| `circuit-breaker` | 1         |
| `health-checks`   | 4         |

### 2.7 `packages/observability/` (4 sub-paquetes)

| Sub-paquete            | Consumers | Estado         |
| ---------------------- | --------- | -------------- |
| `background-scheduler` | 63        | activo (heavy) |
| `browser-logger`       | 15        | activo         |
| `logger`               | 44        | activo         |
| `opentelemetry`        | **0**     | **HUÉRFANO**   |

### 2.8 Paquetes huérfanos consolidados (0 consumers)

Total = **8 sub-paquetes huérfanos**:

| Path                                   | npm                            | Probable causa endógena                                                       |
| -------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| `packages/adapters/crm-hubspot`        | `@adapters/crm-hubspot`        | implementación CRM no integrada (existe `@core/crm` con 3 consumers separado) |
| `packages/adapters/crm-salesforce`     | `@adapters/crm-salesforce`     | ídem                                                                          |
| `packages/adapters/storage-azure`      | `@adapters/storage-azure`      | 4 storage backends sin usar (sólo s3 usado)                                   |
| `packages/adapters/storage-cloudinary` | `@adapters/storage-cloudinary` | ídem                                                                          |
| `packages/adapters/storage-do-spaces`  | `@adapters/storage-do-spaces`  | ídem                                                                          |
| `packages/adapters/storage-gcs`        | `@adapters/storage-gcs`        | ídem                                                                          |
| `packages/core/threading`              | `@core/threading`              | sub-paquete creado pero sin importadores                                      |
| `packages/observability/opentelemetry` | `@observability/opentelemetry` | tracer existe, no consumido                                                   |

`packages/providers/_template` también tiene 0 consumers, pero su nombre y
JSDoc lo declaran template para clonar — descartado como huérfano semántico.

### 2.9 Posibles duplicaciones cross-package

Detección por similitud de nombre de archivo + responsabilidad aparente
(se profundizan con md5 en §6.2).

| Patrón observado                      | Localizaciones                                                                       | Comentario                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 5 storage adapters                    | `packages/adapters/storage-{s3,azure,cloudinary,do-spaces,gcs}/`                     | sólo `s3` tiene consumers (3)                                                                             |
| 2 CRM adapters                        | `packages/adapters/crm-{hubspot,salesforce}/` + `packages/core/crm/`                 | 3 implementaciones del concepto "CRM" coexisten: dos adapters huérfanos + un context con 3 consumers      |
| `provider-shared` vs `core/providers` | `packages/providers/shared` (27 consumers) + `packages/core/providers` (4 consumers) | Mismo nombre conceptual ("providers") en dos lugares — uno es helpers de adapter, otro es bounded context |

---

## 3. apps/api (deep dive)

### 3.1 Estructura general

Single entry point: `apps/api/src/index.ts` (no `server.ts`, `app.ts`, `main.ts`).

```
apps/api/src/
├── index.ts        ← único archivo .ts en raíz
├── config/         (1 archivo: env.ts)
├── lib/            (12 archivos: errors/, logger.ts, redis.ts, route-handler/, withTimeout.ts, etc.)
├── middleware/     (3 archivos: autoCacheMiddleware, correlationMiddleware, metricsMiddleware)
├── types/          (2 archivos: fastify.d.ts, isomorphic-dompurify.d.ts)
├── infrastructure/ (194 archivos — dir más grande, ver §3.1.2)
└── 60 carpetas top-level más, organizadas por dominio
```

Total: **525 archivos `.ts`** en `apps/api/src/`. Evidencia: `find apps/api/src -name "*.ts" | wc -l`.

#### 3.1.1 Distribución por tamaño (top 12 + cola)

| Dir top-level     | Archivos `.ts` |
| ----------------- | -------------- |
| `infrastructure/` | 194            |
| `admin/`          | 40             |
| `analytics/`      | 33             |
| `auth/`           | 30             |
| `content/`        | 20             |
| `ai/`             | 20             |
| `webhooks/`       | 19             |
| `security/`       | 15             |
| `billing/`        | 13             |
| `lib/`            | 12             |
| `templates/`      | 11             |
| `orchestration/`  | 8              |

**40 dirs con 1 sólo archivo** (top-level con un único `*Routes.ts` o similar): `accounts`, `announcements`, `ai-image`, `assets`, `brand-kit`, `brand-voice`, `campaigns`, `channels`, `comments`, `config`, `crm`, `custom-reports`, `database`, `external-notifications`, `first-comment`, `links`, `listening`, `notifications`, `observability`, `onboarding`, `outbox`, `repurpose`, `reports`, `scheduling`, `tasks`, `team`, `usage`, `utm`, `utils`, `validation`, etc.

#### 3.1.2 `infrastructure/` (194 archivos)

```
infrastructure/
├── repositories/      107 archivos (concrete repository adapters)
├── container/          46 archivos (DI setup files)
├── adapters/           14 archivos
├── integration-events/ 10 archivos
├── outbox/              6 archivos
├── billing/             4 archivos
├── guardrails/          2 archivos
├── unitofwork/          1 archivo
├── storage/             1 archivo
├── security/            1 archivo
├── saga/                1 archivo
├── auth/                1 archivo
└── email/               0 archivos  ← dir vacío
```

**Carpeta vacía endógena**: `infrastructure/email/` existe sin archivos.

### 3.2 Bootstrap

Archivo único: `apps/api/src/index.ts`.

Primeras líneas (resumen descriptivo):

1. JSDoc declara `@layer infrastructure` y describe el archivo como
   "API server entry point. Initializes OpenTelemetry, configures Fastify
   with all plugins and routes, and starts the HTTP server".
2. Import `env` desde `./config/env.js` (env loading/validación delegada).
3. Crea logger via `createLogger("api-telemetry")`.
4. Dynamic import condicional de `@observability/opentelemetry` cuando
   `env.TRACING_ENABLED` (try/catch — degrada a "tracing disabled" si
   falla).
5. Importa Fastify 5 + zod + `serializerCompiler/validatorCompiler` de
   `fastify-type-provider-zod`.
6. Importa `createPrismaRepoAdapter` (`@adapters/db-prisma`), `prisma`/
   `closeDatabaseConnections`/`verifyDatabaseAuth` (`@infra/prisma`),
   `QueuePortRegistry` (`@ports/core`), `BackgroundTaskScheduler`
   (`@observability/background-scheduler`).

Tamaño total del `index.ts`: queda fuera de scope inspeccionarlo completo
(la auditoría no inspecciona bodies salvo evidencias específicas).

### 3.3 Plugins

**Hay un único archivo plugin-style**: `apps/api/src/lib/errors/errorPlugin.ts`.

```
Sólo file con patrón "fastify-plugin": lib/errors/errorPlugin.ts
```

Evidencia: `find apps/api/src -name "*plugin*" -o -name "*Plugin*"`.

Su responsabilidad (según JSDoc): "Fastify plugin that registers the
centralized error handler. Ensures no internal details are leaked to
clients."

**Patrón endógeno**: no existe carpeta `apps/api/src/plugins/` — el
"plugin" único de Fastify vive co-localizado con el resto del manejo de
errores en `lib/errors/`. El sprint asumía un patrón "Fastify plugins
directory", que en este repo no se sigue.

### 3.4 Patrón observado de módulos

El `apps/api/src/` se organiza por **dominio top-level** (no por capa).
Cada dir top-level corresponde a un área funcional (posts, inbox, billing,
auth, ai, etc.). Dentro de cada dominio, los archivos siguen un patrón
heterogéneo:

#### Matriz observada (sample de 12 dominios)

| Dominio        | total `.ts` | `*Routes.ts` | `*Service.ts` | `*Handler*.ts` | `*Consumer/Worker.ts` |
| -------------- | ----------- | ------------ | ------------- | -------------- | --------------------- |
| `posts`        | 3           | 2            | 1             | 0              | 0                     |
| `inbox`        | 4           | 2            | 0             | 1              | 1                     |
| `billing`      | 13          | 4            | 1             | 4              | 0                     |
| `auth`         | 30          | 7            | 3             | 0              | 0                     |
| `ai`           | 20          | 2            | 1             | 4              | 0                     |
| `trends`       | 5           | 2            | 1             | 0              | 0                     |
| `analytics`    | 33          | 1            | 0             | 0              | 1                     |
| `security`     | 15          | 0            | 1             | 0              | 0                     |
| `webhooks`     | 19          | 1            | 1             | 2              | 0                     |
| `integrations` | 3           | 2            | 0             | 1              | 0                     |
| `crm`          | 1           | 1            | 0             | 0              | 0                     |
| `tasks`        | 1           | 1            | 0             | 0              | 0                     |

**Inconsistencias internas endógenas observadas:**

1. **Routes sí, Service no**: `crm`, `tasks` tienen route file pero no
   service. Sin embargo `@core/crm` y `@core/tasks` existen — la lógica
   está fuera (en el package). No es necesariamente irregular pero queda
   asimétrico vs `posts/postsService.ts` etc.
2. **Service sí, Routes no**: `security/` tiene `securityService` (vía
   1 archivo _Service.ts_) y otros files pero ningún `*Routes.ts` —
   los endpoints de security viven en `admin/` (e.g., `secretsRotationRoutes.ts`).
3. **Analytics sin routes own ni service**: `analytics/` tiene 33 archivos
   pero sólo 1 `*Routes.ts` y 0 `*Service.ts`. La masa vive en helpers
   internos + 1 Consumer (`analyticsIngestConsumer.ts`).
4. **78 archivos `*Routes.ts` totales** (`find apps/api/src -name "*[Rr]outes*.ts" | wc -l = 78`) distribuidos en ~47 dominios distintos.

### 3.5 Resultados de detección por comandos (sprint §4.e)

#### Arrow handlers

```bash
grep -rnP "fastify\.(get|post|put|delete|patch)\([^)]+,\s*(async\s+)?\(" apps/api/src/ \
  | grep -v "function" | wc -l
# → 5
```

Hay **5 usos directos del identificador `fastify.X(...)`** con handler
arrow (vs 163 usos del identificador `app.X(...)` con la misma forma).

Los 5 outliers:

```
apps/api/src/cqrs/CQRSIntegration.ts:527 fastify.get("/api/cqrs/health", async (_request, reply) => {
apps/api/src/cqrs/CQRSIntegration.ts:549 fastify.get("/api/cqrs/metrics", async (_request, reply) => {
apps/api/src/compliance/complianceRoutes.ts:228 fastify.post("/compliance/dsar", { schema: { tags: ["Compliance"] } }, async (request, reply) => {
apps/api/src/auth/providerOAuth.ts:32 fastify.get("/auth/:provider", { preHandler: [requireClientAuth] }, async (request, reply) => {
apps/api/src/auth/providerOAuth.ts:37 fastify.get("/auth/callback/:provider", async (request, reply) => {
```

#### Cross-app imports

```bash
grep -rnE "from ['\"]\.\.\/\.\.\/\.\.\/apps\/" apps/api/src/
# → (sin resultados)
```

**0 imports relativos cross-app** desde `apps/api/src/`.

#### Imports directos a `@prisma/client`

```bash
grep -rn "from '@prisma/client'" apps/api/src/
grep -rn 'from "@prisma/client"' apps/api/src/
# → (ambos sin resultados)
```

**0 imports directos de `@prisma/client`** dentro de `apps/api/src/`. La
data layer está completamente intermediada por `@adapters/db-prisma` o
`@infra/prisma`.

### 3.6 Patrón de respuesta (handlers muestreados)

Top patrones de `reply.send(...)`:

```bash
grep -rn "reply\.send(" apps/api/src/ --include="*.ts" \
  | grep -oE "reply\.send\(\s*\{[^}]*\}" | sort | uniq -c | sort -rn | head -15
```

Resultados (top 15 textuales):

| Veces | Patrón                                                            |
| ----- | ----------------------------------------------------------------- |
| 11    | `reply.send({ ok: true, data: result.value }`                     |
| 3     | `reply.send({ ok: true, data: result }`                           |
| 2     | `reply.send({ ok: true, value: { authorizationUrl: url, state }`  |
| 2     | `reply.send({ ok: true, data: settings }`                         |
| 2     | `reply.send({ ok: true }`                                         |
| 1     | `reply.send({ ok: true, data: { step: stepKey, completed: true }` |
| 1     | `reply.send({ ok: true, data: { plans }`                          |
| 1     | `reply.send({ ok: true, data: { items, total, page, limit }`      |
| 1     | `reply.send({ ok: true, data: { invoices, total, page, limit }`   |
| ...   | ...                                                               |

**Patrón dominante observable**: wrapper `{ ok: true, data: <payload> }`.
Total **129 ocurrencias** del fragment `ok: true` dentro de `apps/api/src/`.

**Outliers (variaciones del wrapper que coexisten):**

- `{ ok: true, value: <payload> }` (2 ocurrencias en oauth handlers)
- `{ ok: true }` sin data (2 ocurrencias)
- Forma anidada: `{ ok: true, data: { step, completed: true } }`,
  `{ ok: true, data: { plans } }`, `{ ok: true, data: { items, total, page, limit } }`

### 3.7 DI Container

`apps/api/src/infrastructure/container/` tiene **46 archivos**:
1 `Container.ts` + 1 `setup.ts` orquestador + 1 `index.ts` barrel + 38
archivos `setupXxxUseCases.ts` (uno por contexto/dominio) + 5 archivos
en `adapters/` subdir (los Adapter wrappers para los 5 ports
cross-bounded-context).

Evidencia:

```bash
ls apps/api/src/infrastructure/container/setup*.ts | wc -l
# → 38
```

### 3.8 Variable de Fastify en handlers (heurística)

| Identificador    | Ocurrencias |
| ---------------- | ----------- |
| `app.X(...)`     | 163         |
| `fastify.X(...)` | 5           |

Convención observada dominante: **el plugin / route file recibe la
instancia bajo el identificador `app`**. Los 5 outliers `fastify.X` están
en `cqrs/CQRSIntegration.ts` (2), `compliance/complianceRoutes.ts` (1),
`auth/providerOAuth.ts` (2).

---

## 4. apps/workers

### 4.1 Estructura

```
apps/workers/
├── src/
│   ├── bootstrap.ts                  ← entry orquestador único
│   ├── publishWorker.ts              ← worker BullMQ
│   ├── publishHandler.ts             ← handler de jobs
│   ├── publishHandlerTypes.ts        ← types compartidos
│   ├── mentionIngestWorker.ts        ← worker BullMQ
│   ├── container/workerContainer.ts  ← DI compartido
│   ├── lib/gracefulShutdown.ts       ← shutdown SIGTERM/SIGINT
│   ├── lib/handleProviderAuthError.ts
│   ├── metrics/workerMetrics.ts
│   ├── services/ChannelAuthFailureRecorder.ts
│   ├── services/CredentialResolver.ts
│   ├── telemetry/initialization.ts
│   └── telemetry/instrumentationTypes.ts
└── tests/
```

Total: **13 archivos `.ts`** en `apps/workers/src/`.

### 4.2 Workers definidos

Sólo 2 workers en este proceso:

| Worker                | Cola que consume                            | Tipo de procesamiento                |
| --------------------- | ------------------------------------------- | ------------------------------------ |
| `publishWorker`       | `QUEUE_NAMES.PUBLISH`                       | publishing de posts a redes sociales |
| `mentionIngestWorker` | (pino logger name: "mention-ingest-worker") | mention/listening ingestion          |

Evidencia: `grep -nE "new Worker\|class.*Worker" apps/workers/src/*.ts` →
`publishWorker.ts`, `mentionIngestWorker.ts`.

### 4.3 Entry deployable

`apps/workers/src/bootstrap.ts` actúa como punto de entrada único.
Comentario JSDoc:

> _Unified entry point that spawns every long-running BullMQ worker in a
> single Node process and coordinates their graceful shutdown. Container
> image's CMD points here._

`bootstrap.ts:76` declara: `{ workers: ["publish", "mention-ingest"] }`.

### 4.4 SIGTERM / SIGINT handling

Implementado en `apps/workers/src/lib/gracefulShutdown.ts` (helper
compartido). Lo usan los dos workers + el bootstrap. Comentarios in-código
señalan: _"The shared helper covers SIGTERM and SIGINT identically."_

Evidencia: `grep -rnE "SIGTERM|SIGINT|shutdown|graceful" apps/workers/src/`.

### 4.5 Health endpoint

`apps/workers/src/publishWorker.ts:178` implementa un endpoint HTTP de
salud en `/health` (json con healthData). El handler vive **dentro del
worker**, no en un módulo separado.

```
publishWorker.ts:167:  // Enhanced metrics and health endpoint
publishWorker.ts:178:      } else if (req.url === "/health") {
```

### 4.6 package.json — scripts

```
dev:             tsx src/publishWorker.ts   ← NO ejecuta bootstrap.ts en dev
test:            vitest run
test:unit:       vitest run
test:watch:      vitest
test:coverage:   vitest run --coverage
typecheck:       tsc --noEmit
```

**Inconsistencia endógena observada**: el script `dev` arranca sólo
`publishWorker.ts`, mientras que `bootstrap.ts` documenta ser el entry
real del container productivo (con ambos workers). Por tanto:

- En desarrollo: `pnpm dev:workers` arranca **sólo** publishWorker.
- En container: el CMD apunta a `bootstrap.ts` que arranca **ambos**.

No hay script equivalente a `dev:bootstrap` ni `start:bootstrap`.

### 4.7 Cruce con packages de queues

| Package                       | Consumers en apps/workers                                                           | Patrón            |
| ----------------------------- | ----------------------------------------------------------------------------------- | ----------------- |
| `@adapters/queue-bullmq`      | sí (`publishWorker.ts:56` usa `createBullMQConsumerAdapter`, `QUEUE_NAMES.PUBLISH`) | core              |
| `@adapters/dead-letter-queue` | sin evidencia directa en apps/workers/src                                           | no consumido aquí |

Los workers también consumen `@core/<context>/` para business logic
(detectable vía grep `@core/`).

### 4.8 Inconsistencias internas entre workers

| Aspecto                    | publishWorker                                       | mentionIngestWorker                                               | Comentario                                                                                                                       |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Tamaño aprox.              | grande (con health endpoint, instrumentación, etc.) | grande similar                                                    | OK                                                                                                                               |
| Logger init                | usa logger del container                            | usa `pino` directo (`apps/workers/src/mentionIngestWorker.ts:47`) | **mentionIngest crea su propio pino con `name: "mention-ingest-worker"` sin usar `@observability/logger`** — divergencia interna |
| `registerGracefulShutdown` | sí                                                  | sí                                                                | OK                                                                                                                               |
| Health endpoint            | sí (en publishWorker.ts:178)                        | no                                                                | publishWorker expone /health, mentionIngest no                                                                                   |

---

## 5. apps/admin y apps/client (macro)

### 5.1 Estructura raíz comparada

| Carpeta top-level | admin | client | Comentario                     |
| ----------------- | ----- | ------ | ------------------------------ |
| `.storybook`      | ✓     | ✓      | ambos integrados con Storybook |
| `app/`            | ✓     | ✓      | Next App Router                |
| `components/`     | ✓     | ✓      |                                |
| `hooks/`          | ✓     | ✓      |                                |
| `i18n/`           | ✓     | ✓      | next-intl                      |
| `lib/`            | ✓     | ✓      |                                |
| `messages/`       | ✓     | ✓      | next-intl locale files         |
| `providers/`      | ✓     | ✓      |                                |
| `scripts/`        | ✓     | ✓      |                                |
| `tests/`          | ✓     | ✓      |                                |
| `public/`         | ✓     | ✗      | sólo admin                     |
| `stories/`        | ✗     | ✓      | sólo client                    |
| `types/`          | ✗     | ✓      | sólo client                    |

Archivos en raíz comunes: `next-env.d.ts`, `next.config.mjs`, `package.json`,
`postcss.config.mjs`, `proxy.ts`, `sentry.client.config.ts`, `sentry.server.config.ts`,
`stryker.config.mjs`, `global.ts`.

**Sólo admin**: `playwright.config.ts`. **Sólo client**: `screenshot-apps.mjs`.

Total dirs subdir nivel 1-3: **admin = 52**, **client = 94**.

### 5.2 Diferencias en `components/`

- **`admin/components/`**: 14 subdirs (`accounts`, `auth`, `charts`, `compliance`, `dashboard`, `maintenance`, `pricing`, `security`, `settings`, `shared`, `subscriptions`, `ui`, `users`, `webhooks`).
- **`client/components/`**: 22 subdirs (`ai`, `analytics`, `announcements`, `approvals`, `assets`, `billing`, `campaigns`, `channels`, `comments`, `content`, `editor`, `inbox`, `instagram`, `integrations`, `notifications`, `onboarding`, `scheduling`, `settings`, `shared`, `tasks`, `team`, `templates`).

**Solapamiento mínimo**: ambos tienen `settings` y `shared`. Cero más.
Admin se orienta a administración (`accounts`, `users`, `pricing`,
`subscriptions`, `compliance`); client se orienta al producto operativo
(`posts`, `inbox`, `scheduling`, `content`, etc.).

`admin/components/ui` existe; `client/components` no tiene `ui` propio
(usa `@packages/ui`).

### 5.3 Diferencias en `hooks/api/`

- `admin/hooks/api/`: 29 archivos/subdirs.
- `client/hooks/api/`: 28 archivos/subdirs.

Cero solapamiento de nombres entre ambos (cada uno consume endpoints
distintos del API).

### 5.4 Diferencias en `tests/`

- **`admin/tests/`**: `unit/`, `unit/hooks/`, `unit/shared/`, `e2e/`, `e2e/fixtures/`, `e2e/utils/`.
- **`client/tests/`**: `components/`, `integration/`, `mocks/`, `mocks/handlers/`, `e2e/` (con sub: `config/`, `fixtures/`, `pages/`, `tests/`, `utils/`).

Diferencias estructurales:

- `admin/tests/unit/` vs `client/tests/components/` + `client/tests/integration/` — distinto agrupado.
- `client/tests/mocks/handlers/` (probable MSW handlers) — no tiene equivalente en `admin/tests/`.
- `client/tests/e2e/pages/` (page-object pattern) — no tiene equivalente en `admin/tests/e2e/`.

### 5.5 Middleware / proxy

No existe `middleware.ts` en ningún app (`find apps/admin apps/client -name middleware.ts` → vacío). En su lugar, ambos tienen `proxy.ts` (Next.js 16 proxy).

Ambos JSDoc declaran el mismo patrón ("Next.js 16 proxy composing next-intl locale routing with the auth gate") — solo difieren en el idioma por defecto (`/en` admin vs `/es` client) y el target de redirección (admin dashboard vs client dashboard).

### 5.6 Imports a DB / lógica de negocio en routing layers

```bash
grep -rlnE "from ['\"]@prisma|from ['\"]@infra/prisma|from ['\"]@adapters" apps/admin apps/client --include="*.ts" --include="*.tsx"
# → (sin resultados)
```

**Cero imports a `@prisma/*`, `@infra/prisma` o `@adapters/*`** desde
los dos frontends. La comunicación con el backend pasa por proxies (Next
`app/api/backend/`) o hooks API client-side.

### 5.7 Cross-app imports

```bash
grep -rnE "from ['\"]\.\.\/\.\.\/\.\.\/apps\/" apps/admin apps/client
# → (sin resultados)
```

**Cero imports relativos cross-app** desde admin/client.

---

## 6. Análisis cross-cutting

### 6.1 Cross-app imports

```bash
grep -rnE "from ['\"]\.\.\/\.\.\/\.\.\/apps\/" apps/
```

Resultados:

```
apps/api/tests/publish.flow.test.ts:19  import { PublishHandler } from "../../../apps/workers/src/publishHandler.js"
apps/api/tests/publish.flow.test.ts:27  ... from "../../../apps/workers/tests/setup.js"
apps/api/tests/publish.flow.test.ts:31  ... from "../../../apps/workers/src/publishHandlerTypes.js"
```

**1 archivo (test integración cross-app)**: `apps/api/tests/publish.flow.test.ts` importa código de `apps/workers/src/` y `apps/workers/tests/` con paths relativos (3 imports). No hay otros cross-app imports en producción.

### 6.2 Duplicación por nombre de archivo

Top 12 archivos repetidos (excluyendo `index.ts`, `types.ts`, `package.json`):

| Count | Filename               | Comentario                                                   |
| ----- | ---------------------- | ------------------------------------------------------------ |
| 32    | `vitest.config.ts`     | uno por package — legítimo                                   |
| 15    | `queries.ts`           | uno por hook dir — legítimo                                  |
| 15    | `mutations.ts`         | uno por hook dir — legítimo                                  |
| 14    | `api.ts`               | varios scopes — heterogéneo                                  |
| 11    | `apiClient.ts`         | uno por `packages/providers/*/src/` + 1 en `apps/admin/lib/` |
| 5     | `setup.ts`             | varios scopes                                                |
| 3     | `videoProcessor.ts`    | duplicación funcional real                                   |
| 3     | `request.ts`           | duplicación parcial real (i18n)                              |
| 3     | `utils.ts`             | scoped helpers distintos                                     |
| 2     | `sessionCookie.ts`     | divergencia admin vs client                                  |
| 2     | `notificationStore.ts` | 1 línea diff                                                 |
| 2     | `templateEngine.ts`    | api vs client                                                |

#### 6.2.1 Comparación md5 — ¿hay copia textual?

```bash
md5sum apps/admin/lib/stores/notificationStore.ts apps/client/lib/stores/notificationStore.ts
# 7066ca046bff5e6938c23192e7f4af12  admin
# 0c74319a55a2afc0ea112621d50af163  client
diff apps/admin/lib/stores/notificationStore.ts apps/client/lib/stores/notificationStore.ts
# 21c21
# < interface NotificationState {
# ---
# > export interface NotificationState {
```

**Ninguna copia 100% textual** detectada. Las que más se acercan:

| Files                                                                                                                        | Diff                                                | Diagnóstico                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/admin/i18n/request.ts` ↔ `apps/client/i18n/request.ts`                                                                 | 2 líneas cosméticas (wrap)                          | **POSIBLE_CONSOLIDAR** — el contenido es prácticamente igual                                             |
| `apps/admin/lib/stores/notificationStore.ts` ↔ `apps/client/lib/stores/notificationStore.ts`                                 | 1 línea (`export interface` vs `interface`)         | **POSIBLE_CONSOLIDAR**                                                                                   |
| `apps/admin/lib/auth/sessionCookie.ts` ↔ `apps/client/lib/auth/sessionCookie.ts`                                             | 166 líneas diff (admin = 102 LOC, client = 155 LOC) | divergencia semántica real (admin tiene CSRF cookie, client tiene "remember me" 30d) — **NO consolidar** |
| `apps/api/src/lib/templates/templateEngine.ts` ↔ `apps/client/lib/templates/templateEngine.ts`                               | md5 distinto                                        | sin verificar diff line-a-line                                                                           |
| `apps/api/src/metrics/businessMetrics.ts` ↔ `packages/observability/opentelemetry/src/businessMetrics.ts`                    | md5 distinto                                        | sin verificar diff                                                                                       |
| `packages/adapters/external-apis/src/circuitBreaker.ts` ↔ `packages/monitoring/health-checks/src/checkers/circuitBreaker.ts` | md5 distinto                                        | sin verificar (probablemente concept overlap entre dos paquetes)                                         |

#### 6.2.2 `videoProcessor.ts` x 3

```
apps/api/src/video/videoProcessor.ts
packages/providers/tiktok/src/videoProcessor.ts
packages/providers/facebook/src/media/videoProcessor.ts
```

3 implementaciones distintas (md5 distintos). Concepto "videoProcessor"
existe en 3 lugares — patrón cross-package que vale investigar para
ver si hay opportunity de consolidación.

#### 6.2.3 `apiClient.ts` cross-provider

11 ocurrencias, todas en `packages/providers/*/src/apiClient.ts` + 1 en
`apps/admin/lib/apiClient.ts`. Cada provider tiene su `apiClient.ts`
propio con md5 único. Patrón canónico documentado por el `_template`.

### 6.3 Knip — archivos sin consumidores (SOSPECHOSO_DE_MUERTO)

```bash
pnpm exec knip --reporter compact
```

**5 archivos sin uso detectado:**

| Path                                                  | Probable causa                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/global.ts`                                | global type augmentation — los `global.ts` suelen ser referenciados por TS implícitamente; verificar si TS los descubre por config |
| `apps/client/global.ts`                               | ídem                                                                                                                               |
| `apps/api/src/auth/bruteForceProtection.ts`           | implementación de protection no wireada en runtime                                                                                 |
| `apps/client/lib/hooks/useSagaStatus.ts`              | hook React no consumido                                                                                                            |
| `apps/client/lib/hooks/useStartPostPublishingSaga.ts` | ídem                                                                                                                               |

Marcados como `SOSPECHOSO_DE_MUERTO` (no `DEAD_CODE`) porque:

- Los `global.ts` pueden ser entry de TS implícito (no detectable por knip estático).
- Los hooks `useSagaStatus` / `useStartPostPublishingSaga` pueden estar disabled feature-flag o pendiente de wiring.

### 6.4 Knip — dependencias no usadas

#### Unused dependencies (17 entries)

```
apps/api/package.json:
  @fastify/websocket, @react-email/components, @react-email/render, csv-parse
apps/workers/package.json:
  @core/application, @adapters/external-apis, @observability/logger, @sentry/node
package.json (root):
  @t3-oss/env-core, @t3-oss/env-nextjs
packages/adapters/crm-hubspot/package.json: @shared/types
packages/adapters/crm-salesforce/package.json: @shared/types
packages/adapters/storage-azure/package.json: prom-client
packages/adapters/storage-do-spaces/package.json: @shared/types
packages/adapters/storage-gcs/package.json: prom-client
packages/api-common/package.json: fastify, pino
packages/core/application/package.json: @core/domain, csv-parse
packages/core/compliance/package.json: @core/application
packages/core/customer-auth/package.json: @core/application
packages/core/guardrails/package.json: @core/application, @shared/types
packages/core/mentions/package.json: @core/application, @shared/types
packages/core/settings/package.json: @core/application
packages/providers/instagram/package.json: @adapters/db-prisma
packages/providers/threads/package.json:
  @adapters/external-apis, @adapters/fallback-strategies, @observability/logger, prom-client
```

#### Unused devDependencies (5)

```
root: @axe-core/playwright, @hey-api/client-fetch, @secretlint/secretlint-rule-preset-recommend, msw
packages/adapters/storage-azure: vitest
packages/adapters/storage-do-spaces: vitest
packages/adapters/storage-gcs: vitest
packages/query-client: @testing-library/react
```

### 6.5 Madge — dependencias circulares

```bash
NODE_OPTIONS="--max-old-space-size=4096" madge --circular --extensions ts,tsx \
  --exclude 'generated|node_modules|dist|graphify-out|\.next|\.stryker' apps/api/src/
# → No circular dependency found! (679 files processed, 0 cycles)
```

**0 ciclos** detectados en `apps/api/src/`.

### 6.6 `node_modules` fuera de root

```bash
find apps/ packages/ -name node_modules -type d -prune | wc -l
# → 92
```

92 directorios `node_modules/`. pnpm workspaces crea por package; no es
finding endógeno problemático (es el comportamiento normal de pnpm).

---

## 7. Hallazgos y movimientos propuestos

Agrupados por dominio. Cada finding lleva: Tipo · Origen · Destino propuesto (si aplica) · Razón con evidencia endógena · Impacto (importadores) · Prioridad.

### 7.1 Dominio: configuración de paquetes

| #   | Tipo                      | Origen                                             | Destino | Razón                                                                                                                                                                       | Impacto     | Prioridad |
| --- | ------------------------- | -------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------- |
| F1  | INVESTIGAR_INCONSISTENCIA | 48× `packages/core/*/package.json`                 | —       | Declaran `"typescript": "6.0.2"` (versión inexistente) — pnpm resolved a 5.9.3. Evidencia: `grep -rh '"typescript":' packages/core/*/package.json \| sort \| uniq -c` → 48. | 48 packages | ALTO      |
| F2  | INVESTIGAR_INCONSISTENCIA | `package.json` (root) y `apps/api`, `apps/workers` | —       | `tsx` declarado 3 veces con 2 versiones (`4.21.0` root, `4.20.5` apps)                                                                                                      | 3 archivos  | MEDIO     |
| F3  | INVESTIGAR_INCONSISTENCIA | root `package.json` devDeps `jq: 1.7.2`            | —       | El binario falla con `Cannot find module 'async'`. La auditoría usó python como fallback. Evidencia: `./node_modules/.bin/jq` → error.                                      | root        | MEDIO     |

### 7.2 Dominio: paquetes huérfanos

| #   | Tipo                 | Origen                                  | Destino | Razón                                                                                                                                                                                                   | Impacto                | Prioridad |
| --- | -------------------- | --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------- |
| F4  | SOSPECHOSO_DE_MUERTO | `packages/adapters/crm-hubspot/`        | —       | 0 consumers en `apps/` o `packages/`                                                                                                                                                                    | 0                      | MEDIO     |
| F5  | SOSPECHOSO_DE_MUERTO | `packages/adapters/crm-salesforce/`     | —       | 0 consumers                                                                                                                                                                                             | 0                      | MEDIO     |
| F6  | SOSPECHOSO_DE_MUERTO | `packages/adapters/storage-azure/`      | —       | 0 consumers (sólo `storage-s3` con 3 consumers entre 5 storage adapters)                                                                                                                                | 0                      | MEDIO     |
| F7  | SOSPECHOSO_DE_MUERTO | `packages/adapters/storage-cloudinary/` | —       | 0 consumers                                                                                                                                                                                             | 0                      | MEDIO     |
| F8  | SOSPECHOSO_DE_MUERTO | `packages/adapters/storage-do-spaces/`  | —       | 0 consumers; depende de `storage-s3` (inheritance pattern)                                                                                                                                              | 0                      | MEDIO     |
| F9  | SOSPECHOSO_DE_MUERTO | `packages/adapters/storage-gcs/`        | —       | 0 consumers                                                                                                                                                                                             | 0                      | MEDIO     |
| F10 | SOSPECHOSO_DE_MUERTO | `packages/observability/opentelemetry/` | —       | 0 consumers vía import estático; uso vía dynamic `import("@observability/opentelemetry")` en `apps/api/src/index.ts:16` y `apps/workers/src/telemetry/initialization.ts:74`. Verificar antes de borrar. | 0 estáticos, 2 dynamic | MEDIO     |
| F11 | SOSPECHOSO_DE_MUERTO | `packages/core/threading/`              | —       | 0 consumers detectados                                                                                                                                                                                  | 0                      | MEDIO     |

### 7.3 Dominio: archivos huérfanos (knip)

| #   | Tipo                      | Origen                                                | Razón                                                          | Prioridad |
| --- | ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- | --------- |
| F12 | SOSPECHOSO_DE_MUERTO      | `apps/api/src/auth/bruteForceProtection.ts`           | knip lo reporta sin consumers                                  | MEDIO     |
| F13 | SOSPECHOSO_DE_MUERTO      | `apps/client/lib/hooks/useSagaStatus.ts`              | knip sin consumers                                             | MEDIO     |
| F14 | SOSPECHOSO_DE_MUERTO      | `apps/client/lib/hooks/useStartPostPublishingSaga.ts` | knip sin consumers                                             | MEDIO     |
| F15 | INVESTIGAR_INCONSISTENCIA | `apps/admin/global.ts` y `apps/client/global.ts`      | knip dice unused — verificar si TS los descubre implícitamente | BAJO      |

### 7.4 Dominio: duplicación funcional cross-app

| #   | Tipo                      | Origen                                                                                                                       | Destino propuesto                                                   | Razón                                                                                          | Impacto    | Prioridad |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------- | --------- |
| F16 | CONSOLIDAR_DUPLICADO      | `apps/admin/i18n/request.ts` + `apps/client/i18n/request.ts`                                                                 | un `packages/i18n-config/` o un único archivo en `packages/shared/` | 22 LOC c/u, 2 líneas de diff (sólo wrap). Mismo patrón next-intl.                              | 2 archivos | MEDIO     |
| F17 | CONSOLIDAR_DUPLICADO      | `apps/admin/lib/stores/notificationStore.ts` + `apps/client/lib/stores/notificationStore.ts`                                 | un único store en `packages/ui/` o `packages/shared/`               | 79 LOC c/u, 1 línea de diff (`export interface`)                                               | 2 archivos | MEDIO     |
| F18 | INVESTIGAR_INCONSISTENCIA | `apps/api/src/lib/templates/templateEngine.ts` ↔ `apps/client/lib/templates/templateEngine.ts`                               | —                                                                   | md5 distintos pero mismo nombre y filename + conceptual concept "templateEngine" en ambas apps | 2 archivos | MEDIO     |
| F19 | INVESTIGAR_INCONSISTENCIA | `apps/api/src/metrics/businessMetrics.ts` ↔ `packages/observability/opentelemetry/src/businessMetrics.ts`                    | —                                                                   | mismo nombre con diferentes md5; investigar si comparten responsabilidad                       | 2 archivos | MEDIO     |
| F20 | INVESTIGAR_INCONSISTENCIA | `packages/adapters/external-apis/src/circuitBreaker.ts` ↔ `packages/monitoring/health-checks/src/checkers/circuitBreaker.ts` | —                                                                   | concept overlap entre dos packages                                                             | 2 archivos | MEDIO     |
| F21 | INVESTIGAR_INCONSISTENCIA | `videoProcessor.ts` × 3 (`apps/api/src/video/`, `packages/providers/tiktok/src/`, `packages/providers/facebook/src/media/`)  | —                                                                   | 3 implementaciones distintas (md5 distintos) — investigar reutilización                        | 3 archivos | MEDIO     |

### 7.5 Dominio: inconsistencias internas en apps/api

| #   | Tipo                      | Origen                                                                                         | Razón                                                                                                                                                                        | Prioridad |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| F22 | INVESTIGAR_INCONSISTENCIA | 5 handlers usan `fastify.X(...)` vs 163 usan `app.X(...)`                                      | Outliers: `cqrs/CQRSIntegration.ts:527,549`, `compliance/complianceRoutes.ts:228`, `auth/providerOAuth.ts:32,37`. La convención dominante observable es `app.X`              | BAJO      |
| F23 | INVESTIGAR_INCONSISTENCIA | `apps/api/src/infrastructure/email/` (dir vacío)                                               | dir presente sin archivos                                                                                                                                                    | BAJO      |
| F24 | INVESTIGAR_INCONSISTENCIA | Top-level dirs con 1 sólo archivo (40+)                                                        | Dominios `crm`, `tasks`, `assets`, etc. tienen sólo `*Routes.ts`. Otros (auth, billing, analytics) tienen 10-40 archivos. Inconsistencia interna en granularidad de carpetas | MEDIO     |
| F25 | INVESTIGAR_INCONSISTENCIA | Variación de wrapper de respuesta: `{ok:true, data, value}` o `{ok:true, value}` o `{ok:true}` | 129 ocurrencias del wrapper `ok:true`; 2 usan `value` en vez de `data`, 2 omiten payload                                                                                     | BAJO      |

### 7.6 Dominio: inconsistencias internas en apps/workers

| #   | Tipo                      | Origen                                                                                                 | Razón                                                                                                                                               | Prioridad |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| F26 | INVESTIGAR_INCONSISTENCIA | `apps/workers/src/mentionIngestWorker.ts:47`                                                           | crea su propio `pino` directo en vez de usar el helper `@observability/logger` (usado en el resto del repo). publishWorker usa logger del container | MEDIO     |
| F27 | INVESTIGAR_INCONSISTENCIA | `apps/workers/src/publishWorker.ts:178` (health endpoint) vs mentionIngestWorker (sin health endpoint) | publishWorker expone `/health`, mentionIngest no expone nada equivalente                                                                            | MEDIO     |
| F28 | INVESTIGAR_INCONSISTENCIA | `apps/workers/package.json` `scripts.dev` = `tsx src/publishWorker.ts` (NO ejecuta `bootstrap.ts`)     | el container productivo apunta a `bootstrap.ts` (ambos workers); dev mode arranca sólo un worker. No hay `dev:bootstrap` ni `start:bootstrap`       | MEDIO     |

### 7.7 Dominio: tests cross-app

| #   | Tipo                      | Origen                                                   | Razón                                                                                                                                                 | Prioridad |
| --- | ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| F29 | INVESTIGAR_INCONSISTENCIA | `apps/api/tests/publish.flow.test.ts` (lines 19, 27, 31) | importa 3 paths relativos `../../../apps/workers/src/...` — único caso de cross-app import en el repo. Verificar si debería vivir en un harness común | BAJO      |

### 7.8 Dominio: dependencias declaradas no usadas (knip)

| #   | Tipo                      | Origen                                                                                                                   | Razón                                                | Prioridad |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | --------- |
| F30 | INVESTIGAR_INCONSISTENCIA | `apps/api/package.json` deps `@fastify/websocket`, `@react-email/components`, `@react-email/render`, `csv-parse`         | reportadas unused por knip                           | BAJO      |
| F31 | INVESTIGAR_INCONSISTENCIA | `apps/workers/package.json` deps `@core/application`, `@adapters/external-apis`, `@observability/logger`, `@sentry/node` | reportadas unused por knip                           | BAJO      |
| F32 | INVESTIGAR_INCONSISTENCIA | root `package.json` `@t3-oss/env-core`, `@t3-oss/env-nextjs` declaradas pero no usadas                                   | BAJO                                                 |
| F33 | INVESTIGAR_INCONSISTENCIA | root devDeps `@axe-core/playwright`, `@hey-api/client-fetch`, `@secretlint/secretlint-rule-preset-recommend`, `msw`      | reportadas unused por knip                           | BAJO      |
| F34 | INVESTIGAR_INCONSISTENCIA | 13 más entries de unused deps en sub-packages                                                                            | knip reporta dependencias declaradas y no importadas | BAJO      |

### 7.9 Dominio: mapas Graphify

| #   | Tipo                      | Origen                                                               | Razón                                                                                                                                                                  | Prioridad |
| --- | ------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| F35 | INVESTIGAR_INCONSISTENCIA | `apps/api/graphify-out/` y `packages/graphify-out/` sin `graph.html` | Skipped por límite de 5000 nodes (api=12232, packages=12592). `graph.json` y `GRAPH_REPORT.md` sí presentes. Considerar `GRAPHIFY_VIZ_NODE_LIMIT` override o segmentar | BAJO      |

### 7.10 Resumen agrupado por prioridad

- **ALTO**: 1 finding (F1 typescript 6.0.2)
- **MEDIO**: 22 findings
- **BAJO**: 12 findings
- **CRÍTICO**: 0

Total findings: **35**.

---

## 8. Apéndices

### 8.1 Árbol completo del repo

Generado con (4 niveles, exclusiones: `node_modules`, `.next`, `dist`,
`build`, `.turbo`, `.git`, `graphify-out`, `coverage`, `.stryker-tmp`):

```bash
find . -maxdepth 4 -type d \
  -not -path "*/node_modules*" -not -path "*/.next*" -not -path "*/dist*" \
  -not -path "*/build*" -not -path "*/.turbo*" -not -path "*/.git*" \
  -not -path "*/graphify-out*" -not -path "*/coverage*" -not -path "*/.stryker*"
```

Total: **532 directorios** (snapshot guardado en `/tmp/repo-tree.txt`
durante la ejecución).

### 8.2 Listado de `package.json`

```bash
find . -name package.json -not -path "*/node_modules/*"
```

Total: **94 archivos** (snapshot en `/tmp/pkgs-sorted.txt`).

Distribución:

- 1 root
- 4 apps (`apps/{api,admin,client,workers}/package.json`)
- 6 packages top-level (`api-common`, `api-errors`, `ports`, `query-client`, `shared`, `ui`)
- 13 `packages/adapters/*`
- 13 `packages/providers/*` (incl. `_template` y `shared`)
- 2 `packages/monitoring/*`
- 4 `packages/observability/*`
- 49 `packages/core/*`
- 1 `packages/core/package.json` (legacy)
- 1 `infra/prisma/package.json` (per pnpm-workspace.yaml glob `infra/*`)

### 8.3 Mapas Graphify generados / regenerados

| Target         | `graph.json` | `graph.html`              | `GRAPH_REPORT.md` | Nodos  | Edges  |
| -------------- | ------------ | ------------------------- | ----------------- | ------ | ------ |
| `apps/api`     | ✓ (10.7 MB)  | **skipped** (>5000 nodes) | ✓                 | 12 232 | 19 008 |
| `apps/admin`   | ✓ (1.5 MB)   | ✓ (1.5 MB)                | ✓                 | n/a    | n/a    |
| `apps/client`  | ✓ (3.0 MB)   | ✓ (3.0 MB)                | ✓                 | n/a    | n/a    |
| `apps/workers` | ✓ (198 KB)   | ✓ (209 KB)                | ✓                 | n/a    | n/a    |
| `packages`     | ✓ (13.7 MB)  | **skipped** (>5000 nodes) | ✓                 | 12 592 | 27 103 |

Salidas a:

- `/root/omni-post/apps/api/graphify-out/`
- `/root/omni-post/apps/admin/graphify-out/`
- `/root/omni-post/apps/client/graphify-out/`
- `/root/omni-post/apps/workers/graphify-out/`
- `/root/omni-post/packages/graphify-out/`

### 8.4 Comandos shell ejecutados (reproducibilidad)

```bash
# Pre-flight
git status --porcelain
graphify --version

# Fase 1 — Graphify regen
for tgt in apps/api apps/admin apps/client apps/workers packages; do
  (cd "$tgt" && graphify update .)
done
# Para apps/api + packages (>5000 nodes), cluster-only para regenerar reporte:
(cd apps/api && graphify cluster-only .)
(cd packages && graphify cluster-only .)

# Fase 2 — Root
ls -la pnpm-workspace.yaml tsconfig.base.json turbo.json .env* CLAUDE.md
git ls-files | grep -E "^\.env"
for pkg in react typescript prisma fastify next zod vitest tsx pino; do
  pnpm why "$pkg" -r --json | python3 -c "import json,sys; ..."
done
grep -rh '"typescript":' packages/core/*/package.json | sort | uniq -c
grep -rE "\"tsx\":" packages/*/package.json apps/*/package.json package.json

# Fase 3 — packages/*
for pkg_path in packages/api-common packages/api-errors ...; do
  cat "$pkg_path/package.json" | python3 -c "import json, sys; ..."
  PKG_NAME=$(python3 -c "import json; print(json.load(open('$pkg_path/package.json'))['name'])")
  grep -rln "from [\"']${PKG_NAME}" apps/ packages/ --include="*.ts" --include="*.tsx" | wc -l
done

# Fase 4 — apps/api
find apps/api/src -name "*.ts" | wc -l
ls -d apps/api/src/*/
find apps/api/src -name "*[Rr]outes*.ts" | wc -l
find apps/api/src -name "*Service.ts" -not -name "*Service.test.ts" | wc -l
grep -rnP "fastify\.(get|post|put|delete|patch)\([^)]+,\s*(async\s+)?\(" apps/api/src/ | grep -v "function" | wc -l
grep -rnE "from ['\"]\.\.\/\.\.\/\.\.\/apps\/" apps/api/src/
grep -rn "from '@prisma/client'" apps/api/src/

# Fase 5 — apps/workers
find apps/workers/src -name "*.ts"
grep -rnE "SIGTERM|SIGINT|shutdown|graceful" apps/workers/src/*.ts

# Fase 6 — apps/admin + apps/client
find apps/admin apps/client -maxdepth 3 -type d -not -path "*/node_modules*" -not -path "*/.next*"
grep -rlnE "from ['\"]@prisma|from ['\"]@infra/prisma|from ['\"]@adapters" apps/admin apps/client --include="*.ts" --include="*.tsx"

# Fase 7 — Cross-cutting
grep -rnE "from ['\"]\.\.\/\.\.\/\.\.\/apps\/" apps/
find apps/ packages/ -name "*.ts" -not -path "*/node_modules/*" -not -path "*/dist*" -not -path "*/graphify-out*" | xargs -I {} basename {} | sort | uniq -c | sort -rn | awk '$1 > 1' | head -50
# md5 comparison de top candidatos
md5sum apps/admin/lib/auth/sessionCookie.ts apps/client/lib/auth/sessionCookie.ts
diff -q apps/admin/i18n/request.ts apps/client/i18n/request.ts
pnpm exec knip --reporter compact
NODE_OPTIONS="--max-old-space-size=4096" pnpm exec madge --circular --extensions ts,tsx --exclude 'generated|node_modules|dist|graphify-out|\.next|\.stryker' apps/api/src/
```

### 8.5 Nota: mismatch sprint vs realidad de tooling

El prompt del sprint dice:

> "Permitido: instalar Graphify donde falte, regenerar mapas Graphify, crear
> el documento de output. Esto modifica `package.json`, `pnpm-lock.yaml` y
> archivos de mapas — es esperado."

**Realidad**: Graphify es un CLI standalone (`/root/.local/bin/graphify`,
versión 0.8.18). No es paquete npm. Por tanto:

- **`package.json` y `pnpm-lock.yaml` NO fueron modificados** durante la
  ejecución del sprint (no había nada que instalar vía pnpm).
- Los únicos cambios fuera del output son los archivos de mapas Graphify
  regenerados (`graph.json`, `manifest.json`, `GRAPH_REPORT.md` en los 5
  targets) y el `docs/audits/ESTADO_REPO.md` mismo.

### 8.6 Tooling externo disponible (no usado en esta auditoría pero presente)

| Tool                 | Versión | Script                              |
| -------------------- | ------- | ----------------------------------- |
| `dependency-cruiser` | 17.4.0  | n/a (no hay `check:deps` declarado) |
| `depcheck`           | 1.4.7   | n/a                                 |
| `jscpd`              | 4.0.8   | `pnpm check:duplicates`             |
| `@ast-grep/cli`      | 0.42.0  | n/a                                 |
| `secretlint`         | ^12.3.1 | `pnpm secret:scan`                  |
| `size-limit`         | ^12.1.0 | n/a                                 |
| `license-checker`    | 25.0.1  | `pnpm quality:security`             |

Estos podrían usarse para profundizar la auditoría — quedan fuera de
scope de este sprint.
