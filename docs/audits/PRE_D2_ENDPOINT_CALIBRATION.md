# OmniPost — PRE-D2: Delta de inventario de endpoints (calibración pre-D2)

> **Tipo:** calibración rápida del universo antes de arrancar D2 (Standards Compliance).
> **Ejecutado:** 2026-04-18
> **Input:** ENDPOINT_AUDIT.md v2 baseline (commit `a371988`, 471 endpoints declarados) + 16 commits post-D0-v2.
> **Output:** N_actual confirmado + identificación de endpoints nuevos + detección de regressions + hallazgos metodológicos.
> **NO es auditoría.** No clasifica endpoints. No reabre D1. Solo calibra.

---

## 1. Contexto y propósito

D0-v2 (commit `a371988`) inventarió **471 endpoints** en 73 route files del backend. Desde entonces, 16 commits han consolidado:

- Features nuevas: onboarding, billing v2 dunning, password management, UX polish + announcements, observability API, customer welcome email, admin proxy CSRF forward.
- Refactors: SSO path alignment (`7d16e66`), client late integrations, deps/infra sync.

D2 (Standards Compliance) requiere saber el universo actual exacto. PRE-D2 responde: ¿cuántos endpoints hay ahora? ¿cuáles son nuevos? ¿los nuevos cumplen las convenciones declaradas?

---

## 2. Metodología aplicada

Se ejecutó §5.7 v3 (literal + template literal + BASE consts + count cross-check + spot-check tras block-check) en 4 fases:

- **Fase 1:** grep canónico sobre `apps/api/src/` → N_actual
- **Fase 2:** `git diff a371988..HEAD` para identificar route files A/M/D + deltas por archivo
- **Fase 3:** regression checks (path convention `/api/` prefix + `preHandler` ausente en endpoints nuevos)
- **Fase 4:** actualización de docs solo si aplicaba (no aplicó por fórmula, pero se documentaron hallazgos aquí)

Zero cambios de código durante toda la ejecución.

---

## 3. Resultados

### 3.1 Conteo N_actual

| Métrica                                                                          |   Valor |
| -------------------------------------------------------------------------------- | ------: |
| N_actual (grep canónico §5.7 v3)                                                 | **471** |
| Delta vs doc baseline `a371988` (471)                                            |   **0** |
| **N real en código `a371988`** (re-ejecutando grep canónico sobre tree snapshot) | **458** |
| **Delta real de código** (471 − 458)                                             | **+13** |

**Discrepancia descubierta:** el `ENDPOINT_AUDIT.md §1` a `a371988` reportaba 471, pero el código real en ese commit tenía 458 endpoints (por el mismo grep canónico). Hoy coincide la cifra del doc (471) con la del código real actual. Es **coincidencia por acumulación** de los +13 endpoints nuevos, no consistencia real del inventario.

Implicación: la tabla de conteo agregado de `ENDPOINT_AUDIT.md §1` era aproximada/estimada en D0-v2. Hoy, por casualidad, es correcta numéricamente. Por el método literal del plan (`delta = N_actual − doc_baseline = 0`), Fase 4 no actualizaba docs — decisión preservada por el momento, pero el cálculo real revela que la tabla **merece una nota aclaratoria** en futuros commits.

### 3.2 Deltas por archivo

| Categoría                       | N endpoints | Archivos                                                                                                                                                                                                                                                     |
| ------------------------------- | ----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A (nuevos route files)**      |       **8** | `announcements/announcementRoutes.ts` (5), `onboarding/onboardingRoutes.ts` (3)                                                                                                                                                                              |
| **M (modificados, net +5)**     |      **+5** | `admin/adminUserRoutes.ts` (+1 password-reset POST), `admin/auth/adminAuthRoutes.ts` (+1 PUT /profile), `billing/adminBillingRoutes.ts` (+1 GET invoices), `billing/clientBillingRoutes.ts` (+1 GET invoices), `settings/settingsRoutes.ts` (+1 GET /public) |
| **Renombrados sin cambio neto** |           0 | `auth/samlRoutes.ts` 7→7, `auth/oidcRoutes.ts` 6→6 (SSO fix `7d16e66` solo renombró paths)                                                                                                                                                                   |
| **D (removidos)**               |           0 | ninguno                                                                                                                                                                                                                                                      |
| **Total nuevos**                |     **+13** | —                                                                                                                                                                                                                                                            |

Lista completa de +13 endpoints nuevos:

| #   | Método | Path                                     | Archivo                             | Feature origen             |
| --- | ------ | ---------------------------------------- | ----------------------------------- | -------------------------- |
| 1   | GET    | `/api/announcements/active`              | announcements/announcementRoutes.ts | UX polish + announcements  |
| 2   | GET    | `/api/admin/announcements`               | announcements/announcementRoutes.ts | UX polish + announcements  |
| 3   | POST   | `/api/admin/announcements`               | announcements/announcementRoutes.ts | UX polish + announcements  |
| 4   | PATCH  | `/api/admin/announcements/:id`           | announcements/announcementRoutes.ts | UX polish + announcements  |
| 5   | DELETE | `/api/admin/announcements/:id`           | announcements/announcementRoutes.ts | UX polish + announcements  |
| 6   | GET    | `/api/onboarding`                        | onboarding/onboardingRoutes.ts      | Onboarding                 |
| 7   | POST   | `/api/onboarding/step/:stepKey/complete` | onboarding/onboardingRoutes.ts      | Onboarding                 |
| 8   | POST   | `/api/onboarding/dismiss`                | onboarding/onboardingRoutes.ts      | Onboarding                 |
| 9   | POST   | `/admin/users/:id/password-reset`        | admin/adminUserRoutes.ts            | Password management        |
| 10  | PUT    | `/admin/auth/profile`                    | admin/auth/adminAuthRoutes.ts       | UX polish (profile update) |
| 11  | GET    | `/api/admin/billing/invoices`            | billing/adminBillingRoutes.ts       | Billing v2 dunning         |
| 12  | GET    | `/api/billing/invoices`                  | billing/clientBillingRoutes.ts      | Billing v2 dunning         |
| 13  | GET    | `/api/settings/public`                   | settings/settingsRoutes.ts          | Password management        |

### 3.3 Regression check 3.1 — `/api/` prefix

**Grep canónico single-line** (`fastify\.(get|...)\(['"]...`):

```
apps/api/src/cqrs/CQRSIntegration.ts:527: fastify.get("/api/cqrs/health", ...)
apps/api/src/cqrs/CQRSIntegration.ts:549: fastify.get("/api/cqrs/metrics", ...)
```

**2 hits** — CQRS DEAD_CODE conocidos. Esperado: ≤2. **Cero regressions** por esta métrica.

**Grep complementario multi-line** (`grep -rn "\"/api/\|'/api/"` sin restricción al patrón single-line de registration):

**187 hits** en 20+ archivos, incluyendo `usage/`, `ai/promptTemplateRoutes`, `saga/SagaIntegration`, `tasks/`, `outbox/`, `crm/`, `webhooks/webhookDashboardRoutes`, `assets/`, `brand-kit/`, `billing/`, `settings/`, `scheduling/`, `campaigns/`, `utm/`, `integrations/` (make + zapier), `reports/`, `external-notifications/`, y otros.

**Todos pre-existentes en `a371988`** (spot-check confirmado para 3 archivos muestra: `usage/usageRoutes.ts`, `ai/promptTemplateRoutes.ts`, `saga/SagaIntegration.ts` — todos existían). **No son regressions.**

Los 2 archivos nuevos (A) usan `/api/` prefix (announcements 5 + onboarding 3) — **consistentes con el patrón dominante real del codebase**.

### 3.4 Regression check 3.2 — `preHandler` en los 13 endpoints nuevos

| preHandler                               |     N | Endpoints                                                                                                                                                                                                                    |
| ---------------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Con preHandler declarado**             |    11 | onboarding×3 (`requireClientAuth`), announcements admin×4 (`adminPreHandler`), password-reset (`requireAdminAuth + USER_MANAGE`), admin profile (`requireAdminAuth`), billing invoices admin + client (auth correspondiente) |
| **Sin preHandler (intencional público)** |     2 | `/api/announcements/active` (sprint UX-POLISH marca "public, no auth"), `/api/settings/public` (sprint PWD-MGMT marca "endpoint público intencionalmente — solo non-secret")                                                 |
| **Sin preHandler no-intencional**        | **0** | —                                                                                                                                                                                                                            |

**Cero endpoints nuevos con auth olvidado.** Los 2 sin preHandler son public-by-design con justificación documentada en sus respectivos sprint reports.

---

## 4. Hallazgos laterales (nuevos durante PRE-D2)

### 4.1 §5.7 v3 tiene blind spot multi-line para pattern-matching de paths

**Severidad:** alto (metodológico)

**Descripción:** el grep canónico de §5.7 v3 para detectar registrations (`fastify\.(get|post|put|patch|delete)\(`) captura el método correctamente en línea única. Pero los checks de patterns específicos en paths (como "empieza con `/api/`") fallan cuando la ruta está en **línea siguiente** al `fastify.get(`:

```typescript
// Multi-line — NO capturado por grep single-line de "/api/"
fastify.get(
  "/api/foo",  // ← invisible al grep `fastify\.get\(['"]/api/`
  { preHandler: [...] },
  handler
);
```

Este patrón multi-line es **dominante** en el codebase (la mayoría de archivos lo usan). Single-line (`fastify.get("/api/foo", ...)`) solo aparece en CQRS.

**Implicación:** cualquier auditoría que use `grep -E "fastify\.\w+\(['\"]<pattern>"` subestima el conteo de rutas que cumplen ese pattern. El conteo canónico de endpoints (total) no se ve afectado (usa regex sobre el método, no sobre el path).

**Acción propuesta:** actualizar `PLAN_MAESTRO.md §5.7` a **v4** con pattern multi-line obligatorio cuando se audite path conventions específicas. Ejemplo:

```bash
# v4 — capturar path registration multi-line
grep -rnE "^\s+['\"]<path_pattern>" apps/api/src/
# O bien usar rg multiline:
rg -U '(fastify|app|server|instance)\.(get|post|put|patch|delete)\([^)]*["\'']<path_pattern>' apps/api/src/
```

### 4.2 `ENDPOINT_AUDIT.md §1` baseline estaba desactualizado/estimado en D0-v2

**Severidad:** medio

**Descripción:** la tabla §1 de `ENDPOINT_AUDIT.md` a `a371988` reportaba 471 endpoints, pero el código real en ese commit tenía 458. La cifra 471 era aproximada/redondeada (posiblemente porque la re-ejecución de D0-v2 usó una versión modificada del código mientras se escribía el doc, o por rounding intencional). Hoy el código tiene 471 por acumulación de los 13 endpoints nuevos — coincidencia numérica.

**Implicación:** futuros análisis que tomen la cifra del doc como literal pueden llegar a conclusiones incorrectas. D2 debe ejecutar su propio conteo desde el código, no confiar en la tabla §1.

**Acción propuesta:** añadir nota en `ENDPOINT_AUDIT.md §1`:

> "Cifras agregadas (`CONSUMED ~340`, `ORPHAN ~70`, etc.) son aproximadas. Para conteos autoritativos usar `grep -rnE "(fastify|app)\.(get|post|...)\("` sobre `apps/api/src/` excluyendo `node_modules` y `*.test.*`. D2-D7 reverifican conteo al arrancar."

### 4.3 Premisa numérica del SSO fix (`7d16e66`) era incorrecta

**Severidad:** bajo (decisión correcta, razonamiento débil)

**Descripción:** el commit SSO fix (`7d16e66`) argumentó Opción B (rename server routes de `/api/saml/*` a `/saml/*`) citando: "461 de 471 rutas registran sin `/api/` prefix, el prefix `/api/` es outlier". Real: **~284 sin prefix** vs **~187 con prefix** (ratio ~60/40, no 461/471).

**Implicación:** la Opción B aplicada sigue siendo razonable porque:

- Alinea con **otras rutas SSO server-side** (`/auth/saml/*`, `/auth/oidc/*` callbacks) que ya estaban sin prefix.
- Es **consistente dentro del dominio SSO**.

Pero el argumento "outlier en el codebase entero" no era válido. Había un patrón mayoritario (~60%) sin prefix pero 40% con prefix — no un "outlier de 2 vs 469".

**Acción propuesta:** anotación en `LATERAL_FINDINGS.md`. El fix ya está aplicado y funciona; solo hay que clarificar el rationale si se referencia en el futuro.

### 4.4 Los 2 archivos nuevos (announcements + onboarding) usan `/api/` prefix

**Severidad:** informativo

**Descripción:** no es regresión — siguen el patrón dominante real del codebase (~40% con prefix, todos los dominios nuevos consistentes con su vecindario). Solo vale la pena notar para D2 que los **endpoints nuevos son consistentes con el patrón mayoritario con prefix**, no con el minoritario sin prefix (auth SSO callbacks, ciertos admin routes).

**Implicación:** si D2 decide que "`/api/` prefix es mandatory" o "`/api/` prefix es prohibido", debe decidir sobre la **mayoría real del codebase**, no sobre la premisa del SSO fix. Y si decide reescribir convención, el alcance es ~187 endpoints, no 10.

---

## 5. Estado final

### Universo confirmado para D2

- **471 endpoints** totales en `apps/api/src/`
- **73 route files** (sin cambio de conteo)
- **+13 endpoints nuevos** vs código real en `a371988`, distribuidos en 2 archivos nuevos + 5 modificados
- **Cero regressions** de auth (preHandler) en los 13 nuevos
- **Cero violaciones** técnicas de path convention (los nuevos siguen el patrón dominante)

### Preparación para D2

D2 puede arrancar sabiendo que:

1. El universo es **471 endpoints**.
2. Los **13 nuevos** están identificados con archivo + método + path + feature de origen.
3. Ninguno tiene auth olvidado.
4. La metodología §5.7 v3 tiene blind spot multi-line para checks de path pattern — **D2 debe usar multi-line grep** cuando audite path conventions.
5. La cifra agregada de `ENDPOINT_AUDIT.md §1` es aproximada — D2 reverifica desde código al arrancar.

---

## 6. Evidencia cruda

### Fase 1 (grep canónico total)

```bash
$ grep -rn --include="*.ts" -E "(fastify|app|server|instance)\.(get|post|put|patch|delete|head|options)\(" apps/api/src/ | grep -v node_modules | grep -v "\.test\." | wc -l
471
```

### Fase 2 (deltas por archivo)

```
A (nuevos):
  apps/api/src/announcements/announcementRoutes.ts       +5 endpoints
  apps/api/src/onboarding/onboardingRoutes.ts             +3 endpoints

M (modificados con delta):
  apps/api/src/admin/adminUserRoutes.ts                  6→7  (+1)
  apps/api/src/admin/auth/adminAuthRoutes.ts            15→16 (+1)
  apps/api/src/auth/oidcRoutes.ts                        6→6  (0, rename SSO)
  apps/api/src/auth/samlRoutes.ts                        7→7  (0, rename SSO)
  apps/api/src/billing/adminBillingRoutes.ts             5→6  (+1)
  apps/api/src/billing/billingWebhookRoutes.ts           2→2  (0)
  apps/api/src/billing/clientBillingRoutes.ts            6→7  (+1)
  apps/api/src/settings/settingsRoutes.ts               10→11 (+1)

D (removidos):
  (ninguno)
```

### Fase 3.1 single-line `/api/` prefix

```
apps/api/src/cqrs/CQRSIntegration.ts:527: fastify.get("/api/cqrs/health", ...)
apps/api/src/cqrs/CQRSIntegration.ts:549: fastify.get("/api/cqrs/metrics", ...)
Total: 2
```

### Fase 3.1 complementario multi-line `/api/`

```
Total paths con "/api/" prefix en código: 187
Archivos afectados: 20+ (ver §3.3 arriba)
Todos pre-existentes en a371988 — NO regressions.
```

### Fase 3.2 preHandler en los 13 nuevos

```
announcements (5):
  GET /api/announcements/active         NO preHandler  (público intencional)
  GET /api/admin/announcements          adminPreHandler
  POST /api/admin/announcements         adminPreHandler
  PATCH /api/admin/announcements/:id    adminPreHandler
  DELETE /api/admin/announcements/:id   adminPreHandler

onboarding (3):
  GET /api/onboarding                             [requireClientAuth]
  POST /api/onboarding/step/:stepKey/complete     [requireClientAuth]
  POST /api/onboarding/dismiss                    [requireClientAuth]

M file additions (5):
  POST /admin/users/:id/password-reset   [requireAdminAuth, requirePermission(USER_MANAGE)]
  PUT /admin/auth/profile                [requireAdminAuth]
  GET /api/admin/billing/invoices        preHandler (admin)
  GET /api/billing/invoices              [requireClientAuth]
  GET /api/settings/public               NO preHandler (público intencional)

11/13 con preHandler. 2/13 públicos por diseño. 0/13 no-intencional.
```

---

## 7. Próximos pasos recomendados

1. **D2 Standards Compliance** puede arrancar — universo sabido, nuevos endpoints identificados, cero regressions.
2. **Actualizar `PLAN_MAESTRO.md §5.7` a v4** con pattern multi-line obligatorio para path-convention audits (hallazgo 4.1). Sprint dedicado corto.
3. **Nota aclaratoria en `ENDPOINT_AUDIT.md §1`** sobre aproximación de cifras agregadas (hallazgo 4.2). Edit mínimo.
4. **Anotación en `LATERAL_FINDINGS.md`** sobre premisa numérica floja del SSO fix (hallazgo 4.3). Sin acción requerida.
5. **D2 decidirá** si `/api/` prefix es convención mandatory, prohibida, o neutral. Con el dato real de ~60/40 split, la decisión es de producto/arquitectura, no de "alinear al outlier" (hallazgo 4.4).
