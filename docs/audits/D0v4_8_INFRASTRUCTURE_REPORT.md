# D0v4-8 Infrastructure Full Audit — Reporte Final

**Sprint ID:** D0v4-8
**Fecha:** 2026-04-20
**Agente:** general-purpose
**Metodología:** §5.7 v3 (lectura directa, greps como localizadores) + §5.8 (binaria aplicada a schema + configs + CI) + §5.9 (sin DELETE sin Edward) + CP1 + CP0 EventStore deep-dive + supply chain audit + CLAUDE.md fitness functions audit
**Scope declarado:** infraestructura transversal — Prisma schema + migraciones, seeds, configs root, CI/CD, scripts, Docker, docs cross-check, fitness functions compliance
**Orden de ejecución:** CP0 EventStore → B1 Prisma schema + migrations → B2 Seeds → B3 Configs root → B4 CI/CD + scripts → B5 Docker + docs + CLAUDE.md fitness + síntesis D0-v4
**Estado:** ✅ Ejecutado — **ÚLTIMO sprint del tramo D0-v4**. Cierra 9 sprints / ~985 archivos / ~179K LOC auditados.

---

## §0. Front Matter — Contexto de cierre

D0v4-8 es el noveno y último sprint del tramo D0-v4. Llega después de D0v4-7 (packages) con el contexto completo de backend, workers, admin, client, packages. La infraestructura — schema, migraciones, seeds, configs root, CI, Docker, docs — se audita al final porque su evaluación honesta depende del contexto de qué la consume.

### Entradas recibidas

- **LATERAL_FINDINGS.md:** L-1..L-527 (post D0v4-7)
- **Reportes previos:** 8 reportes D0v4-0..7 en `docs/audits/`
- **Decisiones Edward CP0..CP5:** acumuladas inline (ver cabecera)
- **Numeración canónica asignada:** L-528..L-647 (120 findings nuevos)

### Entregables

1. Este reporte (`D0v4_8_INFRASTRUCTURE_REPORT.md`)
2. Extensión `LATERAL_FINDINGS.md` (L-528..L-647 + cross-sprint composite extensions)
3. Update `PLAN_MAESTRO.md` §6 — D0v4-8 ✅ + D0-v4 TRAMO CERRADO

---

## §1. Metodología aplicada

### 1.1 Frameworks invocados

| Framework                    | Aplicación en D0v4-8                                                        |
| ---------------------------- | --------------------------------------------------------------------------- |
| §5.7 v3 — localizadores grep | Template literals + dynamic paths auditados con patrón completo             |
| §5.8 — decisión binaria      | Aplicada a cada adapter/workflow/script: ACTIVE vs DEAD vs PLANNED          |
| §5.9 — no DELETE sin Edward  | 5 candidatos DEAD + 3 candidatos MARK_OBSOLETE → se quedan hasta revisión   |
| CP1 — checkpoint validation  | 5 CPs ejecutados (CP0 schema, CP1..CP5 uno por batch)                       |
| CP0 EventStore deep-dive     | Pieza central #1: stored_events + EventSnapshots + sagaCQRSBus              |
| Supply chain audit           | Actions SHA pinning check, secrets catalog, dependency update path          |
| CLAUDE.md fitness functions  | Pieza central #2: los 10 greps de §"Automated Compliance Checks" ejecutados |

### 1.2 Orden de batches

1. **CP0 EventStore deep-dive** — antes de B1, porque D0v4-7 (L-41 + L-42) dejó pendiente validación schema divergence REAL.
2. **B1 Prisma schema + migrations** — base de datos binaria: schema declarado vs migraciones aplicadas.
3. **B2 Seeds** — PRE-3B intact check + PII cleanup + RBAC double SoT.
4. **B3 Configs root** — tsconfig/ESLint/env/turbo/docker-compose/knip/vitest/stryker (~18 archivos).
5. **B4 CI/CD + scripts** — 7 workflows + dependabot + composite action + 9 scripts.
6. **B5 Docker + docs + CLAUDE.md fitness + síntesis** — Dockerfiles reales + docs policy + los 10 greps CLAUDE.md + recomendación cierre.

### 1.3 Ajustes metodológicos durante el sprint

- **B4 FALSE NEGATIVO corregido en B5:** B4 reportó "Dockerfiles missing" basado en grep incompleto. B5 validó con glob y encontró 7 Dockerfiles reales. Lección aplicada: glob + read directo antes de reportar absence.
- **CP0 resolvió L-41 + L-42 con evidencia binaria:** SQL raw comparado vs schema Prisma → divergencia REAL confirmada (no falso positivo).
- **CLAUDE.md fitness functions ejecutadas como pieza central:** §11 dedicada con los 10 greps + counts + análisis.

---

## §2. Inventario completo — Infrastructure files

Post-discovery B3 + B4 + B5 corrigieron estimaciones iniciales. Inventario real auditado:

### 2.1 Prisma (~12 archivos)

| Path                                          | LOC       | Rol                                    |
| --------------------------------------------- | --------- | -------------------------------------- |
| `infra/prisma/schema.prisma`                  | **3,330** | Single source of truth schema          |
| `infra/prisma/migrations/*/migration.sql` (5) | **3,799** | DB migration history                   |
| `infra/prisma/client.ts`                      | ~40       | PrismaClient singleton                 |
| `infra/prisma/index.ts`                       | ~20       | Barrel export                          |
| `infra/prisma/seed.ts`                        | **828**   | DB seed (users, permissions, demo)     |
| `infra/prisma/prisma.config.ts`               | ~25       | Seed bootstrap config                  |
| `infra/prisma/prisma.config.ts.bak2`          | ~25       | **Git-tracked backup** (L-531 / L-562) |
| `infra/prisma/migrations/migration_lock.toml` | 1         | Lock                                   |

**Subtotal:** ~8,100 LOC Prisma.

### 2.2 Configs root (~18 archivos, 964 LOC)

| Archivo                  | LOC              | Cobertura                                                        |
| ------------------------ | ---------------- | ---------------------------------------------------------------- |
| `package.json`           | 120              | Scripts + workspaces duplicado (L-571) + husky postinstall       |
| `pnpm-workspace.yaml`    | 15               | Duplicate `infra/prisma` entry (L-572)                           |
| `tsconfig.base.json`     | 85               | Strict TS + 29 path mappings (L-573/L-574/L-575)                 |
| `eslint.config.mjs`      | 180              | Flat config, missing 4 CLAUDE.md rules (L-576..L-579)            |
| `turbo.json`             | 60               | env not declared (L-581) + test outputs gap (L-582)              |
| `.env.example`           | 40               | **11 vars declared vs 80 used** (L-583)                          |
| `.env`                   | —                | **NOT root .env** — sólo apps/api/.env (L-591 CRITICAL)          |
| `.gitignore`             | 50               | Missing .bak pattern (L-589) + pnpm-lock.yaml.baseline (L-590)   |
| `.gitattributes`         | **MISSING**      | Line ending normalization ausente (L-587)                        |
| `CODEOWNERS`             | **MISSING**      | Code review routing ausente (L-588)                              |
| `knip.json`              | 45               | No declara ORPHAN packages (L-595)                               |
| `stryker.conf.mjs`       | 70               | Sandbox cleanup failed (L-594)                                   |
| `docker-compose.yml`     | 90               | No env_file, port bindings 0.0.0.0 (L-596/L-597)                 |
| `.husky/pre-commit`      | 10               | Only pre-commit hook — no commit-msg (L-592) no pre-push (L-593) |
| `lint-staged.config.mjs` | 15               | Minimal config                                                   |
| `prettier.config.mjs`    | 10               | Minimal                                                          |
| `vitest.config.*`        | **MISSING root** | Root vitest config ausente (L-599)                               |
| `.nvmrc` / engines       | N/A              | No root `.nvmrc`, engine declared en package.json                |

### 2.3 CI/CD (9 archivos, 2,515 LOC + dependabot + composite action)

| Workflow                                   | LOC | Status                                                            |
| ------------------------------------------ | --- | ----------------------------------------------------------------- | --- | ---------------------- |
| `.github/workflows/ci.yml`                 | 420 | Silent test skip fallback `                                       |     | true` (L-622 CRITICAL) |
| `.github/workflows/nightly.yml`            | 280 | password123 hardcoded (L-623 escalado)                            |
| `.github/workflows/security-testing.yml`   | 380 | **8 dead refs** (L-616 composite)                                 |
| `.github/workflows/performance.yml`        | 310 | Orphan chain → scripts/performance.ts que no existe (L-626/L-627) |
| `.github/workflows/production-ci.yml`      | 290 | `.eslintrc.security.js` missing (L-616 composite)                 |
| `.github/workflows/dependency-updates.yml` | 450 | Broken jq filters (L-616 composite) + PAT blast radius (L-621)    |
| `.github/workflows/cleanup.yml`            | 200 | Org account assumption (L-629)                                    |
| `.github/workflows/dependabot-auto.yml`    | 185 | Dependabot auto-merge — assignees literal (L-628)                 |
| `.github/dependabot.yml`                   | 60  | Assignees literal string `"{{team_lead}}"` (L-628)                |
| `.github/actions/setup-*/action.yml`       | 70  | Composite action, v1 internal                                     |
| **27 acciones sin SHA pinning**            | —   | `@master` / `@main` / tagged versions (L-616 composite)           |

### 2.4 Scripts (10 archivos)

| Script                        | LOC         | Status                                                |
| ----------------------------- | ----------- | ----------------------------------------------------- |
| `scripts/baseline-capture.ts` | 380         | **Compilation errors** (L-625)                        |
| `scripts/run-tests.sh`        | 45          | Shell orchestrator unit+integration                   |
| `scripts/backup-db.sh`        | 60          | DB backup                                             |
| `scripts/restore-db.sh`       | 55          | DB restore                                            |
| `scripts/performance.ts`      | **MISSING** | Referenced from performance.yml (L-626)               |
| `scripts/check-env.ts`        | 90          | Env validation                                        |
| `scripts/seed-demo.ts`        | 210         | **No compila** (L-624 mantener hasta revisión Edward) |
| `scripts/seed-fixtures.ts`    | 180         | **No compila** (L-624)                                |
| `scripts/generate-openapi.ts` | 75          | OpenAPI gen                                           |
| `.claude/run-*.sh` (3)        | ~40         | Local Claude helpers — no CI, no prod                 |

### 2.5 Docker (7 archivos — CORRECCIÓN B5 vs B4)

**B4 reportó "Dockerfiles missing" — FALSE NEGATIVE. B5 glob encuentra 7:**

| Path                                  | Rol                                                 |
| ------------------------------------- | --------------------------------------------------- |
| `apps/api/Dockerfile`                 | **Broken shared-base** (L-640 CRITICAL)             |
| `apps/workers/Dockerfile`             | Single-worker (L-642) — no multi-worker topology    |
| `apps/admin/Dockerfile`               | Next.js standalone                                  |
| `apps/client/Dockerfile`              | Next.js standalone                                  |
| `infra/docker/base.Dockerfile`        | Shared base — NOT referenced desde apps/api (L-640) |
| `infra/docker/migrate.Dockerfile`     | Prisma migrations run                               |
| `infra/docker/healthcheck.Dockerfile` | Healthcheck helper                                  |
| `.dockerignore`                       | **MISSING** (L-641)                                 |

### 2.6 Docs (14 subdirs reales — CORRECCIÓN vs CLAUDE.md declara 12)

`docs/` contiene: api/, frontend/, architecture/, development/, features/, reports/, security/, deployment/, technical/, product/, admin/, client/, **audits/**, **standards/**. CLAUDE.md §Documentation Policy lista 12 — **audits/ + standards/ no están documentados** (L-644 taxonomy drift). Root README.md también ausente (L-645).

### 2.7 Total auditado D0v4-8

**~145 archivos / ~12K LOC** cruzados contra los ~179K LOC de sprints anteriores para validar consistencia infrastructure ↔ código.

---

## §3. EventStore schema deep-dive — L-41 + L-42 RESOLUTION (pieza central #1)

CP0 resolvió la divergencia declarada en D0v4-2 L-41 (stored_events) y L-42 (EventSnapshots) con evidencia binaria.

### 3.1 L-41 stored_events — SCHEMA DIVERGENCE REAL

**Archivo:** `apps/api/src/events/EventStore.ts:62-88`

**Código (raw SQL CREATE TABLE dentro del método `initialize()`):**

```typescript
// EventStore.ts L62-88
async initialize(): Promise<void> {
  await this.prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS stored_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      aggregate_id UUID NOT NULL,
      aggregate_type VARCHAR(100) NOT NULL,
      event_type VARCHAR(200) NOT NULL,
      event_data JSONB NOT NULL,
      event_metadata JSONB,
      sequence_number BIGSERIAL NOT NULL,
      occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      correlation_id UUID,
      causation_id UUID,
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE(aggregate_id, sequence_number)
    )
  `);
  // ... indices similar pattern
}
```

**Schema Prisma declarado (`infra/prisma/schema.prisma` búsqueda binaria):**

**NINGÚN modelo `stored_events` declarado en `schema.prisma`.** La tabla se crea dinámicamente en runtime via `$executeRawUnsafe` si no existe.

**Divergencia confirmada:**

| Aspecto         | schema.prisma | stored_events (raw SQL)                      |
| --------------- | ------------- | -------------------------------------------- |
| Declaración     | **Ausente**   | `CREATE TABLE IF NOT EXISTS` en runtime      |
| Migración       | **No existe** | Inicialización lazy al primer `initialize()` |
| Tipo declarado  | N/A           | UUID + BIGSERIAL + JSONB                     |
| Relación outbox | N/A           | Lateral (no FK)                              |

**Impact:**

1. **Schema drift silent:** Prisma no conoce `stored_events`. `prisma migrate dev` no detecta la tabla.
2. **No migrations track:** cambios al schema de eventos no tienen rollback path.
3. **CQRS read model bypass:** queries contra `stored_events` requieren `$queryRawUnsafe` — no type-safe, no DX Prisma.
4. **Event sourcing incompleto:** es el pattern al 50% (store sí, replay + snapshots NO wired — ver L-42).

**Recomendación de fix (NO implementada — audit sólo):**

1. Declarar `model StoredEvent` en `schema.prisma` con columnas exactas.
2. Generar migration: `pnpm db:migrate dev --name add_stored_events`.
3. Remover `$executeRawUnsafe` de `EventStore.initialize()`.
4. Reemplazar raw queries por `prisma.storedEvent.findMany()` type-safe.

### 3.2 L-42 EventSnapshots — FULL_ORPHAN confirmado

**Archivo:** `apps/api/src/events/EventStore.ts:291-339`

**Código (métodos snapshot):**

```typescript
// EventStore.ts L291-339 (aprox)
async createSnapshot<T>(
  aggregateId: string,
  aggregateType: string,
  snapshot: T,
  sequenceNumber: number,
): Promise<void> {
  await this.prisma.$executeRawUnsafe(`
    INSERT INTO event_snapshots (aggregate_id, aggregate_type, snapshot_data, sequence_number, created_at)
    VALUES ($1, $2, $3::jsonb, $4, CURRENT_TIMESTAMP)
    ON CONFLICT (aggregate_id) DO UPDATE
    SET snapshot_data = EXCLUDED.snapshot_data,
        sequence_number = EXCLUDED.sequence_number
  `, aggregateId, aggregateType, JSON.stringify(snapshot), sequenceNumber);
}

async getSnapshot<T>(aggregateId: string): Promise<T | null> {
  const rows = await this.prisma.$queryRawUnsafe<Array<{ snapshot_data: T }>>(`
    SELECT snapshot_data FROM event_snapshots WHERE aggregate_id = $1
  `, aggregateId);
  return rows[0]?.snapshot_data ?? null;
}
```

**Consumer search (ripgrep cross-codebase):**

```
grep -rn "createSnapshot\|getSnapshot" apps/api/src/ packages/ --include="*.ts"
→ only matches inside apps/api/src/events/EventStore.ts itself
→ 0 production callers
```

**Status confirmado:** `createSnapshot` + `getSnapshot` + tabla `event_snapshots` → **FULL_ORPHAN**. Scaffolding para feature no-implementada. L-42 PROMOTED CRITICAL D0v4-8.

### 3.3 L-528 silent failure catch (nuevo CRITICAL)

**Archivo:** `apps/api/src/events/EventStore.ts:85-87`

```typescript
} catch (error) {
  // Table may already exist — silent fail
}
```

**Impact:** si CREATE TABLE falla por razones distintas a "tabla ya existe" (permissions, connection timeout, schema conflict), EventStore se inicializa **sin tabla** y el primer `append()` falla en runtime lejos del boot. Observability cero.

**Fix recomendado:** inspect error; solo swallow `42P07` (relation already exists); propagate el resto.

### 3.4 sagaCQRSBus vacío context (D0v4-7 L-63 refuerzo)

**Archivo:** `apps/api/src/index.ts:529-547`

```typescript
// apps/api/src/index.ts L529-547
const sagaCQRSBus = {
  send: async () => {
    /* empty */
  },
  publish: async () => {
    /* empty */
  },
  subscribe: () => ({ unsubscribe: () => {} }),
};
```

Confirmación D0v4-7 L-63: saga event sourcing pipeline scaffolding pero sagaCQRSBus está vacío en el composition root. Sin D0v4-8 cross-check esto no se valida — B5 confirma que el objeto real inyectado a sagaManager **es este vacío**.

**Conclusión §3:** EventStore está en **~40% implementación** — append funciona, snapshots y replay son scaffolding, schema drift real. Pieza central del audit: Event Sourcing NO es production-ready.

---

## §4. Prisma schema + migrations audit

### 4.1 Schema

`infra/prisma/schema.prisma`: **3,330 LOC**, **114 modelos**, **54 enums**.

**Baseline clean (L-542 positive):** 114 modelos consistentes, naming convention `@@map("snake_case")` uniforme, `@id @default(uuid())` patrón consistente.

### 4.2 Migraciones

5 migrations en `infra/prisma/migrations/`:

| Migration                                            | LOC   |
| ---------------------------------------------------- | ----- |
| `20260101000000_init/migration.sql`                  | 2,840 |
| `20260215000000_billing_gateways/migration.sql`      | 410   |
| `20260310000000_crisis_mode/migration.sql`           | 220   |
| `20260401000000_compliance_gdpr/migration.sql`       | 185   |
| `20260410000000_credential_encryption/migration.sql` | 144   |

**Total:** 3,799 LOC. **Drift schema↔migrations:** 0 (baseline clean).

### 4.3 Findings B1 destacados

- **L-528 CRITICAL** EventStore silent failure catch (ver §3.3)
- **L-538 CRITICAL** `Invoice.amount: Float` billing precision — Float para dinero es prohibición financiera
- **L-534 HIGH composite** unique NULL-trap (3 files: Post/Schedule/Comment)
- **L-535 HIGH composite** CHECK constraints composite (5+ fields)
- **L-536 HIGH** partial indexes missing soft-delete
- **L-529 MEDIUM** plan count discrepancy (schema vs seed)
- **L-530 MEDIUM** `prisma.config.ts` uses `npx` not `pnpm exec` (user feedback violation)
- **L-531 MEDIUM** `.bak` files git-tracked (`prisma.config.ts.bak2`)
- **L-532 MEDIUM** `SHADOW_DATABASE_URL` hardcoded password
- **L-533 LOW** generator no `previewFeatures`
- **L-537 LOW** rollback docs gap
- **L-539 MEDIUM** `DataBreachReport` FK gap
- **L-540 MEDIUM** `ConsentRecord` FK gap
- **L-541 LOW** Decimal precision inconsistency

### 4.4 Positives

- **L-542** Baseline schema clean, 114 modelos consistent naming
- **L-543** Cascade strategy correcta en mayoría de FKs
- **L-544** Enum coverage exhaustivo (54 enums, Permission = 17/17 intacto)

---

## §5. Seeds audit

### 5.1 PRE-3B Permission enum integrity

**Archivo:** `infra/prisma/seed.ts` (828 LOC).

**Check PRE-3B:** Permission enum 17/17 intacto en SUPER_ADMIN role binding. Validado binario contra `schema.prisma` Permission enum declaration. **PRE-3B intact.** ✅

### 5.2 PII cleanup list

**L-546 CRITICAL:** `ADMIN_PASSWORD` fallback weak — seed.ts asigna `process.env.ADMIN_PASSWORD ?? "password123"` al super-admin bootstrap. Si env no está set, password por defecto es hardcoded default. Production risk si alguien olvida set env.

**L-547 HIGH composite:** seed-mixing — bootstrap users + test users + demo accounts en mismo archivo sin gate `NODE_ENV`. Producción puede recibir demo accounts si seed corre inadvertidamente.

**L-551 MEDIUM:** test accounts un-gated (no `if (NODE_ENV !== 'production')` guard).

**L-549 LOW:** `dev-x` test user pattern — REEMPLAZAR por factory-based.

**L-552 LOW:** `console.log` en seed.ts — debería usar LoggerPort o script-level logger.

### 5.3 RBAC double source of truth

**L-545 CRITICAL escalado:** RBAC SUPER_ADMIN definido en **dos lugares**:

1. `infra/prisma/seed.ts` — seeds super-admin con 17 permissions hardcoded
2. `packages/shared/rbac/roles.ts` (o equiv) — declaración role→permissions mapping

Mantener sincronizados es manual. Divergence silent si una cambia.

### 5.4 Otros findings B2

- **L-553 MEDIUM MARK_OBSOLETE:** `multi-tenant-security.sql` en `infra/prisma/` — script legacy no referenciado, Edward decide mantener hasta revisión
- **L-554 LOW** snake_case mismatch en algún `@@map`
- **L-555 LOW** dangling doc ref `docs/performance-monitoring.md` no existe
- **L-556 MEDIUM** `@layer test-infrastructure` invalid en `test-utils` files
- **L-557 MEDIUM** wildcard exports `@infra/prisma` (barrel too broad)
- **L-558 LOW** postinstall reproducibility (`husky install` en postinstall crea drift)
- **L-559 MEDIUM** seed not in CI (no `pnpm db:seed` en workflow)
- **L-560 HIGH** zero test coverage seed.ts (828 LOC sin un solo test)
- **L-561 MEDIUM** event sourcing bypass en seed (escribe directo a tablas sin emitir events)
- **L-562 MEDIUM** `.bak` git-tracked (cross-ref L-531 B1, L-601 B3)
- **L-563..L-570 positives** (rbac binding completo, gdpr consent seed correcto, bcrypt hashing, etc.)

---

## §6. Configs root audit

### 6.1 Workspace declarations

- **L-571 LOW:** `package.json:workspaces` contiene `"packages/*"` dead config (npm-style) — pnpm lee `pnpm-workspace.yaml`. El campo `workspaces` en package.json es ignorado en pnpm — **dead config que confunde**.
- **L-572 MEDIUM:** `pnpm-workspace.yaml` duplicate `infra/prisma` entry.

### 6.2 TypeScript

- **L-573 LOW:** `tsconfig.base.json` tiene path mapping `@packages/providers/*` — convención drift (el resto es `@providers/*`).
- **L-574 HIGH:** `tsconfig.base.json` missing 6 package paths (`@adapters/db-prisma`, `@adapters/cache-redis`, `@monitoring/*`, `@observability/*`, `@shared/cqrs`, `@shared/rbac`).
- **L-575 MEDIUM:** project references 5/40 coverage — solo 5 de los ~40 packages con `tsconfig.json` declarados en `references`.

### 6.3 ESLint CLAUDE.md non-compliance composite

**L-576..L-579 HIGH composite** (Edward CP3): ESLint config omite 4 rules que CLAUDE.md exige:

1. **L-576** `no-console` missing — CLAUDE.md: "zero console.\* en production code"
2. **L-577** `no-restricted-imports` missing — CLAUDE.md: "Domain imports nothing external"
3. **L-578** `no-explicit-any` missing — CLAUDE.md: "Zero any en domain/application/infrastructure"
4. **L-579** `no-floating-promises` missing — CLAUDE.md implícito + TS strict

Composite conceptual: **ESLint no enforza lo que CLAUDE.md declara como no-go**. Fix path: add `eslint:recommended` + `@typescript-eslint/recommended-type-checked` + custom rules.

**L-580 LOW:** `eslint-config-prettier` not referenced en eslint.config.mjs.

### 6.4 Turbo

- **L-581 HIGH:** `turbo.json` `env` section no declarada — builds no recompilan cuando env vars cambian (cache stale risk).
- **L-582 MEDIUM:** `test` task no declara `outputs` — coverage reports se regeneran pero Turbo no los cachea.

### 6.5 Env hygiene drift

- **L-583 HIGH:** `.env.example` (root) declara **11 vars** — código usa **~80 vars**. 87% undocumented.
- **L-584 HIGH:** `apps/api/.env.example` tiene `TWITTER_*` vars — ghost (el provider es `x/*`, rename D0v4-0 no propagó a example).
- **L-585 MEDIUM:** ghost vars second tier (vars declaradas pero no consumidas — dead config).
- **L-586 HIGH:** double SoT `.env` — `.env` root + `apps/api/.env` con overlap y divergencia.
- **L-591 CRITICAL:** `apps/api/.env` is **git-tracked con secrets reales** (`DATABASE_URL`, `JWT_SECRET`, provider API keys). Revelado en `git status` como `M .env`. Seguridad de producción comprometida si repo es público.

### 6.6 Git + husky

- **L-587 LOW:** `.gitattributes` missing (no LF normalization cross-platform).
- **L-588 LOW:** `CODEOWNERS` missing (no review routing automation).
- **L-589 LOW:** `.gitignore` no pattern `*.bak`.
- **L-590 LOW:** `.gitignore` no `pnpm-lock.yaml.baseline`.
- **L-592 MEDIUM:** no `commit-msg` hook (no conventional commits enforcement).
- **L-593 MEDIUM:** no `pre-push` hook (no pre-push typecheck/test).

### 6.7 Docker compose

- **L-596 MEDIUM:** docker-compose.yml no `env_file` — envs hardcoded inline.
- **L-597 HIGH:** port bindings `0.0.0.0` — expone services a LAN (should be `127.0.0.1`).
- **L-598 LOW:** minio doc drift (referenced en compose, docs mencionan diferente puerto).

### 6.8 Tooling

- **L-594 MEDIUM:** stryker sandbox cleanup failed (ver repro en stryker logs).
- **L-595 HIGH compound L-366..L-370:** `knip.json` no declara ORPHAN packages que D0v4-7 encontró (4 adapters CRM/Storage/DO-Spaces/etc). knip debería reportar estos como orphan y no lo hace.
- **L-599 MEDIUM:** root `vitest.config.*` missing — cada workspace declara su propio, no hay config base compartido.
- **L-600 HIGH:** password123 triple match (inline `"password123"` en 3 files) — **escalado a L-623 CRITICAL en B4** cuando se encuentra sexto match en CI.
- **L-601 MEDIUM:** `.bak` both filesystem (cross-ref L-531/L-562).

### 6.9 Positives (L-602..L-615)

- **L-602** tsconfig strict true uniforme
- **L-603** no Biome (no tool proliferation)
- **L-604** Husky v9 (latest)
- **L-605** bcrypt en dependencies (not md5)
- **L-606** pnpm frozen-lockfile en scripts
- **L-607** prettier config minimal (no over-config)
- **L-608** `.editorconfig` present
- **L-609** `.nvmrc` present (node version lock)
- **L-610..L-615** minor positives (ver LATERAL_FINDINGS)

---

## §7. CI/CD audit

### 7.1 Overview

7 workflows + dependabot.yml + 1 composite action. Tamaño: 2,515 LOC YAML.

### 7.2 L-616 CRITICAL composite — CI/CD broken pipeline

(Edward CP4: absorbe L-617/L-618/L-619/L-620 individuales — **NO crear esos 4 separados**.)

**Sub-findings absorbidos:**

1. `security-testing.yml` — **8 dead refs** a scripts que no existen (`scripts/security-scan.sh`, `scripts/deps-audit.ts`, etc.)
2. `production-ci.yml` — referencia `.eslintrc.security.js` que no existe en el repo
3. Branch coverage — `Genesis` (current branch) NO es triggered por ningún workflow (`main`/`develop` only)
4. **27 acciones sin SHA pinning** — `actions/checkout@v4` mixed con `@master` y tagged — no pin → supply chain risk
5. `dependency-updates.yml` — jq filters broken (syntax inválido)

**Impact:** CI ejecuta pero es placebo — mucho workflow no hace lo que parece.

### 7.3 L-622 CRITICAL silent test skip

**Archivo:** `.github/workflows/ci.yml`

```yaml
# L~270-275
- name: Run tests
  run: pnpm test || true
```

`|| true` convierte CUALQUIER fallo de test en success. CI verde aun con 100% tests failing. **Safety net roto.**

### 7.4 L-623 CRITICAL password123 séxtuple

Composite cross-sprint. D0v4-8 B3 encontró 3 instances (L-600), D0v4-8 B4 añade 3 más:

1. `infra/prisma/seed.ts` (ADMIN_PASSWORD fallback)
2. `scripts/seed-demo.ts`
3. `apps/api/tests/integration/helpers/test-user.ts`
4. **`.github/workflows/ci.yml` — test env** (nuevo en B4)
5. **`.github/workflows/performance.yml` — k6 config** (nuevo)
6. **`.github/workflows/nightly.yml` — integration job** (nuevo)

**Séxtuple match.** Un attacker que vea cualquier repo leak tiene password de todos los environments dev + CI.

### 7.5 L-621 HIGH DEPENDENCY_UPDATE_TOKEN PAT blast radius

`dependency-updates.yml` usa Personal Access Token (PAT) con scope `repo` — blast radius incluye write a cualquier repo de la org/user. Debería ser deploy key o Actions-scoped GITHUB_APP token.

### 7.6 L-624 HIGH seed scripts no compilan

`scripts/seed-demo.ts` y `scripts/seed-fixtures.ts` no compilan con TS strict (tipos drift post-schema migrations). Edward decide mantener hasta revisión.

### 7.7 L-625 HIGH baseline-capture compilation errors

`scripts/baseline-capture.ts` (380 LOC) tiene 12 errores TS. Script orphan — no corre en CI. Mantener hasta revisión.

### 7.8 L-626 HIGH orphan chain performance/scripts

`.github/workflows/performance.yml` referencia `scripts/performance.ts` — archivo **no existe**. Workflow ejecuta pero el step falla silenciosamente (ver L-622).

### 7.9 L-627 HIGH performance/k6 dir missing

Misma workflow referencia `performance/k6/*.js` — directorio no existe.

### 7.10 L-628 HIGH dependabot assignees literal

`.github/dependabot.yml` tiene `assignees: ["{{team_lead}}"]` — literal string, no sustitución. Dependabot PRs asignan usuario llamado literalmente `{{team_lead}}`.

### 7.11 L-629 HIGH cleanup.yml org account assumption

`.github/workflows/cleanup.yml` asume org account (usa `${{ github.repository_owner }}` con permissions org-level). Repo under user account → workflow falla 403.

### 7.12 L-630 CRITICAL CLAUDE.md fitness functions ausentes CI

CLAUDE.md §"Automated Compliance Checks" declara 10 greps que "must stay at zero". **CERO de los 10 están wireados en CI.** Sin enforcement, la política está en documentación pero no en guardrails.

### 7.13 L-631..L-639 MEDIUM misc

Menor severity — secrets naming inconsistency, timeout defaults too high, artifact retention not set, etc. Ver LATERAL_FINDINGS.

---

## §8. Scripts + supply chain audit

### 8.1 Orphan scripts

- `scripts/performance.ts` — MISSING (L-626)
- `scripts/baseline-capture.ts` — COMPILE ERRORS (L-625)
- `scripts/seed-demo.ts` — COMPILE ERRORS (L-624)
- `scripts/seed-fixtures.ts` — COMPILE ERRORS (L-624)

4 de 9 scripts (~44%) están broken/missing.

### 8.2 Secrets catalog

9 secrets declarados en workflows:

1. `GITHUB_TOKEN` (auto-injected)
2. `DEPENDENCY_UPDATE_TOKEN` (L-621 PAT blast radius)
3. `SONAR_TOKEN` (security-testing.yml — workflow broken L-616)
4. `CODECOV_TOKEN`
5. `NPM_TOKEN` (publish pipeline)
6. `DOCKERHUB_USERNAME`
7. `DOCKERHUB_TOKEN`
8. `SLACK_WEBHOOK` (nightly.yml notifications)
9. `S3_DEPLOY_KEY` (infra deploy)

### 8.3 Action SHA pinning

27 action references cross-workflows. **0 SHA-pinned.** Distribución:

- `@v4` tag: 14 references (stable but not pinned)
- `@v3` tag: 8 references
- `@master` / `@main`: 5 references (supply chain risk — mutable ref)

---

## §9. Docker + deployment audit

### 9.1 Dockerfiles reales (CORRECCIÓN vs B4)

7 Dockerfiles existen (B4 FALSE NEGATIVE rectificado en B5):

| Dockerfile                            | Tamaño | Status                                       |
| ------------------------------------- | ------ | -------------------------------------------- |
| `apps/api/Dockerfile`                 | 45 LOC | **BROKEN** (L-640)                           |
| `apps/workers/Dockerfile`             | 38 LOC | Single-worker (L-642)                        |
| `apps/admin/Dockerfile`               | 55 LOC | OK                                           |
| `apps/client/Dockerfile`              | 55 LOC | OK                                           |
| `infra/docker/base.Dockerfile`        | 32 LOC | Shared base — **unused** by apps/api (L-640) |
| `infra/docker/migrate.Dockerfile`     | 28 LOC | Migrations — OK                              |
| `infra/docker/healthcheck.Dockerfile` | 15 LOC | Helper — OK                                  |

### 9.2 L-640 CRITICAL apps/api/Dockerfile broken shared-base

**Code (apps/api/Dockerfile L8):**

```dockerfile
FROM omnipost-base:latest AS builder
```

La imagen base `omnipost-base:latest` **no existe en ningún registry ni se construye en CI**. El `infra/docker/base.Dockerfile` tiene el código que debería construir esa imagen — pero ningún workflow hace `docker build -t omnipost-base:latest -f infra/docker/base.Dockerfile .`.

**Impact:** `docker build apps/api/Dockerfile` falla inmediatamente con `image not found`. API NO ES DEPLOYABLE via Docker sin fix manual.

### 9.3 L-641 HIGH .dockerignore missing

Root `.dockerignore` ausente → `docker build` copia `node_modules/`, `.env`, `.git/`, `coverage/` al build context. Build times 10x, image size bloated, secrets leakable.

### 9.4 L-642 HIGH Workers Dockerfile single-worker

`apps/workers/Dockerfile` define un ENTRYPOINT único (`node dist/index.js`) pero el inventario D0v4-3 identificó **3 workers** (publish, analytics, inbox). Producción necesita deploy de 3 containers separados con distintos `WORKER_TYPE` env — Dockerfile no lo parametriza. Actual behaviour: 1 worker corre los 3 tipos en serie (no paralelo).

### 9.5 L-65 topology cross-ref

D0v4-3 L-65 declaró "multi-worker topology PLANNED pero no arquitectura". B5 confirma: Dockerfile no soporta topology. Fix path = parametrizar ENTRYPOINT con env var `WORKER_TYPE`.

---

## §10. Docs cross-check

### 10.1 docs/ 14 subdirs vs CLAUDE.md 12

CLAUDE.md §Documentation Policy lista 12 subdirs:

```
api/, frontend/, architecture/, development/, features/, reports/,
security/, deployment/, technical/, product/, admin/, client/
```

Reality (glob `docs/*/`):

```
api/, frontend/, architecture/, development/, features/, reports/,
security/, deployment/, technical/, product/, admin/, client/,
audits/, standards/
```

**+2 subdirs no documentados:** `audits/` (este reporte vive aquí) y `standards/` (docs de code standards). L-644 taxonomy drift.

### 10.2 L-645 Root README.md missing

Repo root **no tiene README.md**. `ls /home/edward/projects/omni-post/ → package.json ... (no README)`. Onboarding nuevo contribuyente sin doc entry point.

### 10.3 L-646 LOW docs/standards filenames spaces

`docs/standards/React Component Standards.md` — espacios en filename. Breaks URL anchors, complicates `ls` + scripts. Rename a kebab-case.

---

## §11. CLAUDE.md Fitness Functions Results (pieza central #2)

CLAUDE.md §"Automated Compliance Checks (CI Fitness Functions)" declara 10 greps que "must stay at zero". B5 ejecutó los 10. Resultados:

### 11.1 Resultados de los 10 greps

| #   | Check                                          | Count | Status       | Nota                                              |
| --- | ---------------------------------------------- | ----- | ------------ | ------------------------------------------------- |
| 1   | Prisma singleton imports en routes             | 0     | ✅ PASS      | Sin violaciones                                   |
| 2   | Domain framework-free                          | 0     | ✅ PASS      | Sin prisma/fastify/redis/bullmq en domain/        |
| 3   | `any` en domain/application/infrastructure     | ~8    | ⚠️ FAIL-soft | Residuales encontrados (D0v4-1 L-12/L-13 tracked) |
| 4   | Raw throws en domain/application               | ~3    | ⚠️ FAIL-soft | PricingCalculator L-643 + 2 más (mismo scope)     |
| 5   | `@ts-ignore` / `@ts-nocheck` en production src | 0     | ✅ PASS      | Sin violaciones                                   |
| 6   | CQRS handlers touch Prisma                     | 0     | ✅ PASS      | Sin violaciones                                   |
| 7   | `randomUUID` en dedupeKey                      | 0     | ✅ PASS      | Sin violaciones (D0v4-2 ya remediado)             |
| 8   | Sprint references en source comments           | 0     | ✅ PASS      | Limpio (D0v4-0 ya barrió)                         |
| 9   | Files missing `@file` header                   | ~130  | ⚠️ FAIL-soft | L-388 + L-527 + L-298 composite extenso           |
| 10  | Invalid `@layer` values                        | **0** | ✅ PASS      | **L-298 RESOLVED D0v4-8**                         |

### 11.2 L-298 RESOLVED — validación D0v4-8

L-298 declaraba `@layer mismapping composite (~40 files admin)` con valores no-canónicos (`presentation`, `ui`, `component`). Fitness #10 count = 0 valida que el composite fue remediado durante D0v4-6/7 en sprints previos (aunque B5 sprint actual no remedió — verifica).

**Cross-ref con composite entry:** update a L-298 marca "RESOLVED validated D0v4-8 via fitness function #10".

### 11.3 Análisis de violations residuales

**Violations PASS-hard (7/10):** política de hexagonal + DI + CQRS + dedupeKey + tracking comments enforceada en el código real — sólido.

**Violations FAIL-soft (3/10):**

1. `any` 8 instances — bajo, pero fitness exige 0
2. `throw` 3 instances — domain/application tiene un puñado (PricingCalculator L-643 top offender)
3. `@file` missing ~130 files — composite largo L-298/L-388/L-527 cross-sprint

### 11.4 L-647 CRITICAL (escalado CP5) — fitness functions ausentes CI

Independiente de si counts son 0 hoy, **ninguno de los 10 greps corre en CI**. Mañana alguien añade `as any` y CI no lo detecta. **Política CLAUDE.md no está enforceada — sólo declarada.**

L-630 MEDIUM original → **escalado CRITICAL como L-647** post-CP5.

**Fix recomendado:** añadir workflow `.github/workflows/fitness.yml` que ejecute los 10 greps y falla si cualquier count > umbral (0 para los 7, umbrales transitorios para los 3 FAIL-soft).

---

## §12. Cross-ref con D0v4-0..7 (findings resolved/escalated)

### 12.1 Cross-sprint composite extensions

| Finding | Acción D0v4-8                                                                           |
| ------- | --------------------------------------------------------------------------------------- |
| L-14    | Cross-ref con billing L-538 + RBAC L-545 (provider architecture + domain multi-overlap) |
| L-260   | Add zero-test seed.ts L-560 + vitest config ausente L-599 (coverage gap composite)      |
| L-298   | **RESOLVED** — fitness #10 = 0 valida remediation cross-sprint                          |
| L-368   | Add PricingCalculator raw throws L-643 + Invoice Float L-538 (domain quality composite) |
| L-600   | **ESCALATED → L-623 CRITICAL** (password123 triple → séxtuple post-B4)                  |

### 12.2 Findings D0v4 sprint previos cruzados

- **L-41 + L-42 RESOLVED** via CP0 deep-dive (§3)
- **L-63 saga CQRS REAL** confirmado (apps/api/src/index.ts:529-547 vacío) — ver §3.4
- **L-65 workers topology PLANNED** confirmado via Dockerfile single-worker (§9.4 + L-642)
- **L-356 @core/threading** persists post-D0v4-8 (no scope B3 resolve)
- **L-366..L-370 adapters ORPHAN** sin declarar en knip.json (L-595 compound)
- **L-388** + **L-527** cross-sprint `@file` missing composite (ahora ~130 files)
- **L-473** monitor DEAD confirmed (circuit breaker central no wireado)
- **L-506** scaffolding DEAD confirmed

---

## §13. Clasificaciones finales D0v4-8

Aplicando §5.8 binaria a los componentes auditados en este sprint:

### 13.1 ACTIVE (producción sólida)

- Prisma schema + 5 migrations (baseline clean)
- Permission enum + RBAC bindings seed (PRE-3B intact)
- `pnpm db:migrate` pipeline dev
- `.husky/pre-commit` hook
- `docker-compose.yml` local dev infrastructure
- TypeScript strict + flat ESLint baseline

### 13.2 PLANNED

- EventStore `createSnapshot`/`getSnapshot` scaffolding (L-42)
- Event sourcing replay (apps/api/src/index.ts:529 sagaCQRSBus vacío)
- k6 performance testing (`performance/k6/` dir missing, workflow referenced)
- Multi-worker topology (L-65 + L-642)
- Fitness functions CI enforcement (L-647)

### 13.3 INFRASTRUCTURE_READY (existe pero requiere wire)

- `infra/docker/base.Dockerfile` (shared base existe, no wired en apps/api Dockerfile — L-640)
- `scripts/baseline-capture.ts` (existe, no compila — L-625)

### 13.4 LEGACY

- Raw SQL `CREATE TABLE IF NOT EXISTS stored_events` en EventStore.ts (legacy pre-Prisma pattern)
- `infra/prisma/multi-tenant-security.sql` (L-553 MARK_OBSOLETE)
- `workspaces` campo en package.json (L-571 dead config npm-style)

### 13.5 DEAD_CODE_CANDIDATE (Edward decide)

- `.bak` files git-tracked (3 instances — L-531/L-562/L-601)
- `scripts/seed-demo.ts` + `scripts/seed-fixtures.ts` (no compilan)
- `scripts/performance.ts` (missing, referenced)
- `security-testing.yml` (8 dead refs)

---

## §14. Plan consolidación pre-D2 propuesto

**7 sprints REMEDIATION** con effort total **~18-25 días**. Estos son **recomendaciones post-audit, NO implementación**.

| Sprint                   | Scope                                                                                    | Effort | Prioridad  |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------ | ---------- |
| REMEDIATION-1 Security   | L-591 .env git-tracked + L-623 password123 séxtuple + L-621 PAT + rotate secrets         | 3d     | **Week 1** |
| REMEDIATION-2 CI/CD      | L-616 broken pipeline + L-622 silent skip + L-630/L-647 fitness wire + L-626 performance | 2d     | **Week 1** |
| REMEDIATION-3 EventStore | L-41 schema decl + L-42 decision + L-528 error catch + L-63 saga bus wire                | 4d     | Week 2     |
| REMEDIATION-4 Billing    | L-538 Float→Decimal + L-643 throws + financial precision audit                           | 3d     | Week 2     |
| REMEDIATION-5 Docker     | L-640 shared-base wire + L-641 .dockerignore + L-642 multi-worker parametrize            | 2d     | Week 3     |
| REMEDIATION-6 Configs    | L-574/L-575/L-576..L-579 ESLint + L-581 turbo env + L-583/L-586 env drift                | 3d     | Week 3     |
| REMEDIATION-7 RBAC+Seeds | L-545 double SoT + L-546 ADMIN_PASSWORD + L-547 seed-mixing + L-560 coverage             | 3d     | Week 4     |

**Rutas alternativas discutidas en §15.8:**

- **(a)** Ejecutar los 7 sprints ANTES de D2 (lineal): ~18-25 días puros de remediation antes de avanzar
- **(b)** Ir directo a D2 sin remediation (aggressive): velocidad pero deuda compuesta
- **(c)** HÍBRIDO (recomendado): Week 1 crítico (REMEDIATION-1 + REMEDIATION-2), luego D2 arranca paralelo absorbiendo REMEDIATION-3..7 como sprints in-sprint

---

## §15. SÍNTESIS D0-v4 COMPLETA NARRATIVA (pieza central #3)

### §15.1 Contexto histórico — por qué D0-v4

D0-v4 nació en 2026-04-18 después del piloto D0 (backend routes). El piloto demostró que §5.8 (lectura directa) era metodología viable para inventario autoritativo, pero cubría solo ~3-5% del codebase. Las auditorías previas (D0, D0-v2) tenían contaminación por truncación silenciosa (PRE-3A/3C mitigaron parcialmente).

Edward decidió 2026-04-18 Camino 1: **D0-v4 completo como prerrequisito de D2**. 9 sprints secuenciales con review obligatoria entre cada uno. Criterio de cierre explícito en §9.4: inventario integral, clasificación rigurosa, LATERAL_FINDINGS poblado, base sólida para D2.

**Lo que motivó D0-v4:**

- Tranquilidad personal como feature — sin deadline, la perfección paraliza. El plan tenía que forzar cierres explícitos.
- Reconocer que ningún agente LLM mantiene foco útil sobre OmniPost completo en una sola pasada.
- Trabajo hecho con evidencia no se descarta — se consolida (ENDPOINT_AUDIT, CLIENT_LIB_HOOKS_AUDIT sobrevivieron).

### §15.2 Scope completo ejecutado

| Sprint    | Fecha      | Archivos | LOC aprox  |
| --------- | ---------- | -------- | ---------- |
| D0v4-0    | 2026-04-18 | ~60      | —          |
| D0v4-1    | 2026-04-20 | ~395     | ~60K       |
| D0v4-2    | 2026-04-20 | ~91      | ~18K       |
| D0v4-3    | 2026-04-20 | ~18      | ~4K        |
| D0v4-4    | 2026-04-20 | ~249     | ~35K       |
| D0v4-5    | 2026-04-20 | ~65      | ~12K       |
| D0v4-6    | 2026-04-20 | ~141     | ~18K       |
| D0v4-7    | 2026-04-20 | ~235     | ~54K (src) |
| D0v4-8    | 2026-04-20 | ~145     | ~12K       |
| **TOTAL** | —          | **~985** | **~179K**  |

### §15.3 Findings totales consolidated

**LATERAL_FINDINGS pre-D0v4-8:** L-1..L-527 (527 findings).
**LATERAL_FINDINGS post-D0v4-8:** L-1..L-647 (647 findings totales) + composite extensions.

**Distribución de severidad (aproximada):**

| Severidad | Count aprox | %      |
| --------- | ----------- | ------ |
| CRITICAL  | 13          | ~2%    |
| HIGH      | 120         | ~18.5% |
| MEDIUM    | 280         | ~43%   |
| LOW       | 230         | ~35.5% |
| Positives | ~60         | —      |

### §15.4 CRITICAL final list (13 items — narrativa cada uno)

1. **L-16** `SyncProviderCommentsUseCase.ts` — provider API calls dentro UoW (long-held transaction). Fix obligatorio D0v4-1.
2. **L-41** `stored_events` schema divergence REAL — raw SQL fuera de Prisma migrations (D0v4-8 §3.1).
3. **L-42** `EventSnapshots` FULL_ORPHAN — snapshots scaffolding sin consumer production (D0v4-8 §3.2).
4. **L-63** Saga CQRS event pipeline — sagaCQRSBus vacío en composition root (apps/api/src/index.ts:529-547).
5. **L-528** EventStore silent failure catch — tabla puede no existir y app boot silently (D0v4-8 §3.3).
6. **L-538** Invoice `Float` para dinero — billing precision broken (D0v4-8 B1).
7. **L-545** RBAC SUPER_ADMIN double source of truth (seed.ts + roles.ts).
8. **L-546** ADMIN_PASSWORD fallback weak (seed hardcoded default).
9. **L-591** `apps/api/.env` git-tracked con secrets reales (exposure si repo público).
10. **L-616** CI/CD broken pipeline composite (8 dead refs + missing config + Genesis branch + 27 unpinned actions + broken jq).
11. **L-622** `ci.yml` silent test skip (`|| true` turns red into green).
12. **L-623** password123 séxtuple match (3 pre-B4 + ci.yml + performance.yml + nightly.yml).
13. **L-640** apps/api/Dockerfile broken shared-base (image `omnipost-base:latest` nunca construida).

**+** adjacency: L-647 (L-630 escalated) — fitness functions ausentes CI. Si se cuenta separado → 14 CRITICAL.

### §15.5 Composites finales cross-sprint

| Composite | Scope final                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------- |
| **L-14**  | providers/ triple overlap + billing L-538 + RBAC L-545 (domain multi-overlap)                      |
| **L-260** | 87 mutations sin onError + seed.ts zero coverage + vitest config root ausente (error handling gap) |
| **L-298** | **RESOLVED D0v4-8** — fitness #10 = 0                                                              |
| **L-368** | opossum 3-way drift + circuit breaker central DEAD + PricingCalculator raw throws + Invoice Float  |
| **L-600** | **ESCALATED → L-623 CRITICAL** — password123 séxtuple                                              |
| **L-616** | CI/CD broken pipeline (composite nuevo D0v4-8)                                                     |

### §15.6 Sprints remediación propuestos (ver §14)

Resumen: 7 sprints ~18-25 días, prioridad security + CI/CD primero.

### §15.7 Estado producción-readiness HONEST

**40-50% dev excellent, ops/security deficitario.**

**Excellent (dev):**

- Hexagonal architecture ~85% compliant (domain framework-free ✅)
- CQRS pattern applied con handlers
- Unit of Work en 56 mutating use cases (CLAUDE.md compliance)
- TypeScript strict zero `any` en core (residual 8 FAIL-soft)
- Result<T, E> pattern uniform
- Test coverage 7,227 tests API

**Deficitario (ops/security):**

- **Secrets en repo** (L-591)
- **CI placebo** (L-616 + L-622)
- **Fitness functions ausentes** (L-647)
- **Docker broken** (L-640)
- **Multi-worker topology no deploy-ready** (L-642)
- **Event sourcing 40% wired** (L-41/L-42/L-63/L-528)

**Billing/Financial:**

- **Float para dinero** (L-538) → debe Decimal
- **Double SoT RBAC** (L-545)

**Testing mutation:**

- Stryker configurado, sandbox cleanup fails (L-594)
- ~130 files sin `@file` header (L-298/L-388/L-527 composite)

### §15.8 Recomendación cierre D0-v4 — Opción (c) HÍBRIDO

**Opción (a) Lineal — ejecutar 7 sprints REMEDIATION antes de D2:**

- PRO: baseline limpio antes de Standards Compliance
- CONTRA: 18-25 días puros sin avance producto. D2 bloqueado ~1 mes. Motivación riesgo.
- **Descartada.**

**Opción (b) Aggressive — ir directo a D2 sin remediation:**

- PRO: velocidad
- CONTRA: D2 ejecuta sobre base broken (CI placebo, secrets leaked, EventStore 40%). Deuda compuesta. Standards Compliance no significa nada si CI no enforza.
- **Descartada.**

**Opción (c) HÍBRIDO (recomendada):**

- **Week 1 (5 días):** REMEDIATION-1 Security (3d) + REMEDIATION-2 CI/CD (2d) en paralelo si posible
  - Cierra los CRITICAL security (L-591, L-623, L-621)
  - Wirea CLAUDE.md fitness functions CI (L-647)
  - Desbloquea safety net (L-622 fixed)
- **Week 2+:** D2 arranca baseline segura, absorbe REMEDIATION-3..7 como sprints in-sprint
  - REMEDIATION-3 EventStore + REMEDIATION-4 Billing se pueden meter dentro D3 (Data Integrity)
  - REMEDIATION-5 Docker + REMEDIATION-6 Configs se pueden meter dentro D6 (Pre-Production Cleanup)
  - REMEDIATION-7 RBAC+Seeds se puede meter dentro D5 (Security) naturalmente

**Trade-offs aceptados en (c):**

- CRITICAL security ya no bloquea — se cierra Week 1
- CRITICAL operational (EventStore, Billing, Docker) se cierra durante D2-D6 no antes
- Velocidad restaurada sin abandonar rigor

**Honestidad sobre la recomendación:**
(c) asume que Edward tiene capacidad de validar REMEDIATION-3..7 mientras D2 corre. Si no es realista, (a) es más seguro (más lento). Decisión final de Edward.

### §15.9 Next steps concretos (día 1 actions post-cierre D0-v4)

Si Edward aprueba (c) — día 1:

1. **Rotate secrets** — generar nuevos `DATABASE_URL`, `JWT_SECRET`, provider API keys
2. **Remove .env from git** — `git rm --cached apps/api/.env`, update `.gitignore`
3. **Replace password123 global** — generar passwords únicos por environment, set via CI secrets
4. **Wire CLAUDE.md fitness functions** — crear `.github/workflows/fitness.yml` con los 10 greps, umbrales iniciales [0,0,8,3,0,0,0,0,130,0] → descenderlos
5. **Fix L-622 silent skip** — remover `|| true` de `ci.yml`
6. **Pin actions SHA** — convert `@v4`/`@master` a SHA hash en los 27 action references

Entonces Week 2 D2 arranca con baseline.

---

## §16. Sign-off

**Sprint D0v4-8 cerrado 2026-04-20.**
**Tramo D0-v4 CERRADO.**
**Ready para decisión Edward sobre REMEDIATION Week 1.**

Agente: general-purpose
Reporte producido: `docs/audits/D0v4_8_INFRASTRUCTURE_REPORT.md`
LATERAL_FINDINGS extendido: L-528..L-647 + composite extensions a L-14/L-260/L-298-RESOLVED/L-368/L-600
PLAN_MAESTRO.md §6 actualizado: D0v4-8 ✅ + D0-v4 TRAMO CERRADO
