# Sprint 3 Report — Admin Portal

**Periodo:** 2026-04-07 → 2026-04-09
**Branch:** Genesis
**Commits:** `f97183e` → `6329817`
**Alcance:** 96 archivos modificados, +6,550 / -3,632 lineas

---

## Commit 1: DB-driven RBAC — `f97183e`

### Problema

El sistema RBAC estaba hardcodeado: un `AdminRole` enum (`SUPER_ADMIN | ADMIN | SUPPORT`) con un mapa estático `RolePermissions` en código. No se podían crear roles custom, modificar permisos sin despliegue, ni gestionar la asignación de permisos desde la UI.

### Solucion

Migración completa a un modelo RBAC almacenado en base de datos con gestión administrativa desde el frontend.

#### Backend — Modelo de datos

| Tabla            | Campos clave                                                  | Relaciones                        |
| ---------------- | ------------------------------------------------------------- | --------------------------------- |
| `Role`           | `name`, `description`, `level` (1-99), `isSystem`, `isActive` | → RolePermission[], → AdminUser[] |
| `RolePermission` | `roleId`, `permission` (string)                               | → Role                            |

- `AdminUser.role` cambiado de enum a relación FK con `Role`
- Migración custom: crea tablas, siembra 3 roles de sistema con sus permisos, migra usuarios existentes, elimina enum `AdminRole`

#### Backend — Servicios

**RbacService** (refactorizado):

- Lee permisos desde DB con cache in-memory de 60 segundos
- `hasPermission()`, `hasAnyPermission()`, `hasAllPermissions()` ahora async
- Toda la cadena de middleware actualizada para `await` las verificaciones

**RoleManagementService** (nuevo):

- `createRole()` — valida nombre UPPER_SNAKE_CASE, nivel 1-99, unicidad
- `updateRole()` — permite editar descripción y nivel (no nombre en roles de sistema)
- `setRolePermissions()` — reemplaza permisos atómicamente con validación
- `deleteRole()` — solo roles custom sin usuarios asignados

**4 endpoints nuevos** (SUPER_ADMIN only):

- `POST /api/admin/rbac/roles` — crear rol
- `PUT /api/admin/rbac/roles/:id` — actualizar rol
- `PUT /api/admin/rbac/roles/:id/permissions` — asignar permisos
- `DELETE /api/admin/rbac/roles/:id` — eliminar rol

#### Restricciones de seguridad

| Rol               | Editar nombre | Editar permisos  |      Eliminar      | Asignar a usuarios |
| ----------------- | :-----------: | :--------------: | :----------------: | :----------------: |
| SUPER_ADMIN       |      No       | No (siempre ALL) |         No         |  Máximo 1 usuario  |
| ADMIN (sistema)   |      No       |        Si        |         No         |         Si         |
| SUPPORT (sistema) |      No       |        Si        |         No         |         Si         |
| Custom            |      Si       |        Si        | Solo si 0 usuarios |         Si         |

#### Frontend — 3 componentes nuevos/refactorizados

**RbacManager** (refactorizado):

- Lista roles con badge de tipo (System/Custom)
- Crear roles custom via CreateRoleDialog
- Eliminar roles custom (con confirmación)
- Editar descripción inline
- Gestión de usuarios: asignar/cambiar rol

**PermissionGrid** (nuevo):

- Checkbox grid organizado por categoría (Accounts, Billing, Users, Security, System)
- Dirty detection: botón Save solo aparece cuando hay cambios
- Roles de sistema editables, SUPER_ADMIN readonly (gris, todos marcados)

**CreateRoleDialog** (nuevo):

- Campos: nombre (auto-uppercase, validación UPPER_SNAKE_CASE), descripción, nivel (1-99)
- Validación client-side + feedback de errores del servidor

#### Infraestructura de testing

- `mockPrisma.ts` expandido con soporte para `Role` y `RolePermission`
- `seedSystemRoles.ts` helper para tests que necesitan roles
- `adminTestHelper.ts` actualizado para generar tokens con roleId
- Tipo `AdminRole` ampliado de union literal a `string` en toda la codebase

#### Archivos modificados: 40

| Capa                       | Archivos |
| -------------------------- | -------- |
| Prisma schema + migración  | 3        |
| Backend servicios          | 7        |
| Backend rutas + middleware | 6        |
| Frontend componentes       | 4        |
| Tests + helpers            | 9        |
| Shared types               | 2        |
| Seed data                  | 1        |

---

## Commit 2: Recharts, Executive→Analytics, SSR fix — `6329817`

### A. Sistema de Charts con Recharts

#### Problema

Recharts 2.15.0 estaba instalado pero no se usaba. Todas las "visualizaciones" eran divs CSS con puntos de color, barras de porcentaje, y progress bars — no graficos reales.

#### Solucion

5 componentes de chart reutilizables + 1 hook de colores + integración en 4 páginas.

**Componentes creados** en `apps/admin/components/charts/`:

| Componente           | Recharts base                                     | Usado en                                           |
| -------------------- | ------------------------------------------------- | -------------------------------------------------- |
| `DonutChart`         | PieChart + Pie + Cell + Legend + Tooltip          | Dashboard (suscripciones), Analytics               |
| `HorizontalBarChart` | BarChart (layout=vertical) + Bar + Cell           | Dashboard (revenue), Webhook Metrics (event types) |
| `StackedBarChart`    | BarChart + Bar (stackId) + Legend                 | Webhook Timeline (success/failed)                  |
| `TrendAreaChart`     | AreaChart + Area (linearGradient) + CartesianGrid | Analytics (tendencias)                             |
| `ChartEmptyState`    | —                                                 | Fallback cuando data=[]                            |

**`useChartColors` hook** (`hooks/useChartColors.ts`):

- Recharts usa SVG con atributos `fill`/`stroke` inline — no puede consumir `var(--success)` directamente
- El hook resuelve CSS custom properties a valores concretos via `getComputedStyle`
- Re-calcula cuando cambia el tema (dark/light)
- Incluye `subscriptionColors` mapeado: `ACTIVE→success`, `TRIALING→warning`, etc.

**Páginas integradas:**

| Página                                | Chart anterior           | Chart nuevo                                   |
| ------------------------------------- | ------------------------ | --------------------------------------------- |
| Dashboard — Subscription Distribution | Divs con puntos de color | DonutChart interactivo con legend             |
| Dashboard — Revenue Breakdown         | Lista de texto           | HorizontalBarChart con formato `$X,XXX`       |
| Webhooks — Timeline                   | Divs con height%         | StackedBarChart (success verde / failed rojo) |
| Webhooks — Event Types                | Progress bars CSS        | HorizontalBarChart                            |

### B. Fix SSR: `getComputedStyle is not defined`

#### Problema

`useChartColors` llamaba `getComputedStyle(document.documentElement)` directamente en el cuerpo del `useMemo`. Next.js 16 intenta renderizar en servidor primero — `getComputedStyle` y `document` no existen en SSR, causando crash con fallback a client rendering en **todas** las páginas que usan charts (Dashboard, Analytics, Webhooks).

#### Archivos afectados

- `apps/admin/app/(dashboard)/page.tsx` — Dashboard
- `apps/admin/app/(dashboard)/analytics/page.tsx` — Analytics
- `apps/admin/components/webhooks/WebhookTimeline.tsx` — Webhooks
- `apps/admin/components/charts/HorizontalBarChart.tsx`
- `apps/admin/components/charts/StackedBarChart.tsx`
- `apps/admin/components/charts/TrendAreaChart.tsx`

#### Solucion

```
resolveVar() → typeof window === "undefined" guard
useChartColors() → useState(mounted) + useEffect para activar solo client-side
                 → FALLBACK colors estáticos para SSR
```

- SSR recibe colores fallback (hex estáticos) → no crash
- Primer render client-side: `mounted=true` → resuelve CSS variables reales del DOM
- Cambio de tema: `useMemo` re-computa por dependencia en `theme`

### C. Rename Executive → Analytics

#### Problema

La página `executive` fue eliminada del frontend, pero el backend mantenía todos los nombres internos como `Executive*`: clases, rutas, schemas, tags, y el endpoint `/api/admin/executive/metrics`. Inconsistencia entre frontend (Analytics) y backend (Executive).

#### Alcance del rename

**API — Clases renombradas:**

| Antes                         | Después                       |
| ----------------------------- | ----------------------------- |
| `ExecutiveRouteHandler`       | `AnalyticsRouteHandler`       |
| `ExecutiveDashboardHandler`   | `AnalyticsDashboardHandler`   |
| `ExecutiveComplianceHandler`  | `AnalyticsComplianceHandler`  |
| `ExecutiveAccountHandler`     | `AnalyticsAccountHandler`     |
| `ExecutiveMetricsQuerySchema` | `AnalyticsMetricsQuerySchema` |

**API — Ruta cambiada:**

```
GET /api/admin/executive/metrics → GET /api/admin/analytics/metrics
```

**API — Archivos renombrados:**

| Antes                            | Después                          |
| -------------------------------- | -------------------------------- |
| `ExecutiveHandlers.ts`           | `AnalyticsHandlers.ts`           |
| `ExecutiveDashboardHandlers.ts`  | `AnalyticsDashboardHandlers.ts`  |
| `ExecutiveComplianceHandlers.ts` | `AnalyticsComplianceHandlers.ts` |
| `ExecutiveAccountHandlers.ts`    | `AnalyticsAccountHandlers.ts`    |
| `executiveRoutes.ts`             | `analyticsRoutes.ts`             |
| `executiveSchemas.ts`            | `analyticsSchemas.ts`            |
| `executiveRoutes.test.ts`        | `analyticsRoutes.test.ts`        |

**Frontend:**

| Archivo                                  | Cambio                                          |
| ---------------------------------------- | ----------------------------------------------- |
| `hooks/api/useAnalytics.ts`              | URL `/executive/metrics` → `/analytics/metrics` |
| `tests/unit/hooks/useAnalytics.test.tsx` | URL en assertions actualizada                   |

**Otros:**

- Export `executiveRoutes` → `analyticsRoutes` (ya coincide con import en `index.ts`)
- Schema tags `["Admin Executive"]` → `["Admin Analytics"]`
- `routeName` en cada handler: `"executive-*"` → `"analytics-*"`
- Log messages: `"Fetching executive dashboard metrics"` → `"Fetching analytics dashboard metrics"`
- Comments y JSDoc actualizados en todos los archivos

### D. Limpieza de archivos huérfanos

| Archivo eliminado                               | Razón                                   |
| ----------------------------------------------- | --------------------------------------- |
| `app/(dashboard)/executive/page.tsx`            | Página reemplazada por analytics        |
| `hooks/api/useExecutive.ts`                     | Hook reemplazado por useAnalytics       |
| `hooks/__tests__/useNotificationStream.test.ts` | Test huérfano — hook no existe          |
| `tests/unit/hooks/useExecutive.test.tsx`        | Test del hook eliminado                 |
| `apps/api/tests/unit/executiveRoutes.test.ts`   | Reemplazado por analyticsRoutes.test.ts |
| `apps/api/src/admin/Executive*.ts` (4 archivos) | Renombrados a Analytics\*               |
| `apps/api/src/admin/executive*.ts` (2 archivos) | Renombrados a analytics\*               |

### E. Mejoras adicionales en Sprint 3

Incluidas en el mismo commit por estar en el working tree:

- **i18n expandido**: +720 keys EN, +736 keys ES en messages/\*.json
- **AuthProvider**: nuevo provider de autenticación para admin
- **UI compacta**: 13 páginas admin refactorizadas con design tokens CSS
- **Sidebar**: navegación actualizada (executive → analytics)
- **Webhooks**: 5 sub-componentes reescritos (Metrics, Events, Subscriptions, Timeline, DeadLetterQueue)
- **Pricing**: tier toggles cambiados de Badge a switch visual (`role="switch"`)

---

## Métricas de calidad

| Métrica                   | Valor                    |
| ------------------------- | ------------------------ |
| TypeScript errors (API)   | 0                        |
| TypeScript errors (Admin) | 0                        |
| ESLint errors             | 0                        |
| ESLint warnings           | 0                        |
| Tests API                 | 351 files, 7,128 passing |
| Archivos nuevos           | 18                       |
| Archivos eliminados       | 13                       |
| Archivos modificados      | 65                       |
| Total lineas cambiadas    | +6,550 / -3,632          |

---

## Resumen ejecutivo

Estos 2 commits transforman el admin de un portal con RBAC hardcodeado y charts decorativos a un sistema con:

1. **RBAC configurable** — roles y permisos gestionados desde la UI, almacenados en DB, con cache y restricciones de seguridad
2. **Visualizaciones reales** — 5 componentes Recharts reutilizables integrados en Dashboard y Webhooks
3. **Nomenclatura consistente** — Executive→Analytics alineado entre frontend y backend
4. **SSR estable** — hooks protegidos contra APIs del browser inexistentes en servidor
5. **Código limpio** — 13 archivos huérfanos eliminados, 0 errores en build/lint/tests
