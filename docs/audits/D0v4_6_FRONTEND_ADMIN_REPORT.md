# D0v4-6 — Frontend Admin: Pages, Components, Hooks, Providers, Lib, Types Audit Report

> **Sprint:** D0v4-6 (apps/admin/ completo — pages, layouts, components, hooks, providers, lib, types, colocated)
> **Ejecutado:** 2026-04-20
> **Metodología:** §5.8 lectura directa + §5.9 validación DEAD_CODE + CP1 per-finding + TanStack v5 R1-R13 + R13 strict
> **Ejecutor:** `react-frontend-specialist` con Opus 4.7 (1M context)
> **Cambios en código:** 0 (100% lectura + docs)
> **Scope total:** 141 archivos (app 30, components 62, hooks 29, providers 4, lib 9, types 3, colocated 1, extras 3)

---

## §0. Front matter

| Campo              | Valor                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| Sprint ID          | D0v4-6                                                                    |
| Fecha              | 2026-04-20                                                                |
| Agente             | react-frontend-specialist                                                 |
| Metodología        | §5.7 v3 + §5.8 (lectura directa) + §5.9 + CP1 + TanStack v5 + R13         |
| Scope              | `apps/admin/**` excluyendo `node_modules/`, `.next/`, `public/`           |
| Archivos cubiertos | 141                                                                       |
| Batches            | B1 (pages 30) + B2 (components 62) + B3 (hooks 29) + B4 (lib 13 + extras) |
| Checkpoints        | CP0 + CP1 + CP2 + CP3 + CP4 (todos aprobados Edward)                      |
| Findings nuevos    | 83 (L-267..L-349)                                                         |
| Raw fetch catalog  | 102 entries totales (inline §8)                                           |
| Orphan cemetery    | 13-15 archivos individuales                                               |

---

## §1. Metodología aplicada

### 1.1 §5.7 v3 — greps con `head_limit: 0`

Cross-check de consumidores con patterns 1+2+3 (literal + template literal + BASE const). Usado para detectar consumers de hooks/components y huérfanos.

### 1.2 §5.8 — lectura directa como fuente de verdad

141 archivos leídos línea 1→N sin skip. Greps solo como localizadores iniciales o sanity cross-check de conteos. Reglas aplicadas:

- Clasificación de auth / permissions / ORPHAN / R11 → **solo via lectura directa**
- Grep permitido para: localizar files >LOC, contar `any`, contar `fetch(`, búsqueda nombres específicos
- Grep NO permitido como verdad final para: "cero violaciones de X", "todos los hooks usan apiClient", etc.

### 1.3 §5.9 — validación DEAD_CODE Edward-gated

Zero DEAD_CODE declarado sin validación Edward. 13-15 archivos "sin consumer live" → DEAD_CODE_CANDIDATE con evidencia cero-consumer + flag explícito "requiere validación Edward antes de delete". Edward **NO** autorizó delete durante este sprint — todos permanecen en código.

### 1.4 CP1 — findings individuales por default

Per Edward CP1 acumulado (todos los batches): findings individuales por archivo donde semántica distinta, composites solo cuando la violación es el mismo patrón ejecutado N veces.

### 1.5 TanStack v5 compliance audit (R1-R13)

| #   | Regla                                                | Detection               |
| --- | ---------------------------------------------------- | ----------------------- |
| R1  | QueryKey `[domain, scope, ...params]`                | Manual inspection       |
| R2  | `gcTime` (v5) en lugar de `cacheTime` (v4)           | Grep `cacheTime`        |
| R3  | `onSuccess` NO en `useQuery`                         | Manual + multiline grep |
| R4  | `onError` NO en `useQuery`                           | Same                    |
| R5  | `useMutation` con `onSuccess` + `onError` cada una   | Manual                  |
| R6  | `useQueries` shape v5                                | Grep                    |
| R7  | `useSuspenseQuery` vs `suspense: true`               | Grep                    |
| R8  | `staleTime` explícito                                | Manual                  |
| R9  | `enabled` para dependent queries                     | Manual                  |
| R10 | Zero `any`                                           | Grep `: any\b`          |
| R11 | Hook ≤150 LOC / Utility ≤200 LOC                     | `wc -l`                 |
| R12 | Naming `useXxx` + PascalCase                         | Manual                  |
| R13 | No raw `fetch()` inside hook (strict per Edward CP3) | Grep `fetch(`           |

### 1.6 Checkpoints ejecutados

| CP      | Batch                                      | Aprobado      | Decisiones clave                                                                                                                                       |
| ------- | ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CP0** | Setup + NO deep-dive LEGACY confirmado     | ✅ 2026-04-20 | 0 @deprecated, 0 LEGACY comments, 0 /api/v1, 0 re-export chains paralelos                                                                              |
| **CP1** | B1: pages (30) + layouts + routes          | ✅ 2026-04-20 | L-267 critical; L-268 composite; L-271 security; L-270/272/273 LOW individuales                                                                        |
| **CP2** | B2: components (62)                        | ✅ 2026-04-20 | 19 R11 individuales; fake-cron nueva categoría; TanStack bypass webhooks individuales; i18n composite; raw EventSource → catálogo §8; @layer composite |
| **CP3** | B3: hooks (29)                             | ✅ 2026-04-20 | 7 R11 individuales; 8 ORPHAN individuales; useAnalytics fake-data 6 campos; credentials missing individual                                             |
| **CP4** | Cierre: providers + lib + types + síntesis | ✅ 2026-04-20 | Orphan cemetery individual; cross-app findings promoted §9.1; admin-superior §9.2; reporte 1500-2000 LOC OK                                            |

---

## §2. Inventario completo

### 2.1 Conteos totales por capa

| Capa                                         |   Files |   LOC aprox |
| -------------------------------------------- | ------: | ----------: |
| `app/**` (pages + layouts + routes + extras) |      30 |      ~3,200 |
| `components/**`                              |      62 |     ~16,800 |
| `hooks/**`                                   |      29 |      ~4,050 |
| `providers/**`                               |       4 |        ~520 |
| `lib/**`                                     |       9 |      ~1,780 |
| `types/**`                                   |       3 |        ~320 |
| Colocated (components/queue/useQueueManager) |       1 |         213 |
| Extras (middleware-like, proxy, etc.)        |       3 |        ~180 |
| **TOTAL**                                    | **141** | **~27,063** |

### 2.2 Pages + Layouts + Routes (B1, 30 archivos)

| Tipo            | Count | Notas                                                                                                                                                                                                                      |
| --------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard pages |    17 | `accounts`, `announcements`, `audit`, `compliance`, `gateway-switches`, `logs`, `maintenance`, `page.tsx` root, `pricing`, `security`, `settings`, `sso`, `subscriptions`, `templates/admin`, `users`, `webhooks`, `queue` |
| Layouts         |     3 | `app/layout.tsx`, `(dashboard)/layout.tsx`, `app/(auth)/layout.tsx` (si aplica)                                                                                                                                            |
| Auth pages      |     3 | `login/page.tsx`, `reset-password/page.tsx`, `logout/page.tsx`                                                                                                                                                             |
| Route handlers  |     2 | `app/api/backend/[...path]/route.ts`, health/other                                                                                                                                                                         |
| Special files   |     5 | `error.tsx`, `not-found.tsx`, `loading.tsx`, `global-error.tsx`, `proxy.ts` (ORPHAN root)                                                                                                                                  |

### 2.3 Components (B2, 62 archivos)

| Dominio              | Count | Archivos principales                                                                                                              |
| -------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------- |
| webhooks             |     5 | `DeadLetterQueue` (732), `WebhookSubscriptions` (689), `WebhookEventsList` (505), `WebhookMetrics` (319), `WebhookTimeline` (267) |
| subscriptions        |     3 | `ChangePlanDialog` (488), list, detail                                                                                            |
| security             |     4 | `RbacManager` (481), `MfaSelfService` (331), `MfaManager` (307), `PermissionGrid` (215)                                           |
| shared               |     6 | `SidebarNav` (446), `ErrorBoundary`, `SkipLink`, `VisuallyHidden`, `Header`, `BreadcrumbBar`                                      |
| accounts             |     4 | `AccountBillingPanel` (383), `AccountsTable`, `AccountDetailDrawer`, `AccountSessionsTab`                                         |
| pricing              |     3 | `ProviderTiersTab` (365), `AccountTiersTab` (355), `TiersOverview`                                                                |
| compliance           |     5 | `BreachTable` (354), `DsarTable` (340), `GdprSettingsForm` (323), `SecuritySettingsForm` (252), `ConsentLog`                      |
| maintenance          |     2 | `ScheduledJobsPanel` (350), `MaintenanceStatus`                                                                                   |
| ui (shadcn + custom) |    15 | `Button`, `Input`, `Dialog`, `ConfirmDialog`, `InputDialog`, `Table`, `Tabs`, `Badge`, ...                                        |
| queue                |     2 | `QueueDashboard`, `useQueueManager` (colocated, 213 LOC — ORPHAN)                                                                 |
| billing              |     3 | `BillingStatsCard`, `InvoicesTable`, `PaymentMethods`                                                                             |
| analytics            |     4 | `AdminAnalyticsDashboard`, `SystemStatsCards`, `TrendsChart`, `GrowthMetrics`                                                     |
| settings             |     2 | `SettingsForm`, `FeatureFlagsPanel`                                                                                               |
| users                |     2 | `UsersTable`, `UserDetailDialog`                                                                                                  |
| audit                |     2 | `AuditLogsTable`, `AuditStatsCards`                                                                                               |

### 2.4 Hooks (B3, 29 archivos)

```
useAccountBilling, useAccountSessions, useAccounts, useAdminUsers,
useAdminPasswordReset, useAnalytics, useAuditLogs (ORPHAN), useAuditStats (ORPHAN),
useBillingStats, useChangePassword, useCompliance, useContentLibrary (ORPHAN),
useGatewaySwitches, useMfa, useMultiPlatformScheduling (ORPHAN),
useNotifications, usePerformanceInsights (ORPHAN), usePosts (ORPHAN),
usePricingTiers, usePublicSettings (ORPHAN TOTAL), useQueueManagement,
useResetAccountPassword, useSecurity, useSettings, useSubscriptionMutations,
useUniversalAnalytics (ORPHAN), useUsageMetrics, useWebhooks, + 1 index.ts
```

### 2.5 Providers (B4, 4 archivos)

- `providers/AuthProvider.tsx` — context auth + `/auth/permissions` fetch
- `providers/QueryProvider.tsx` — QueryClient config (replica cliente L-70+L-101)
- `providers/ThemeProvider.tsx` — next-themes wrapper
- `providers/ProjectProvider.tsx` — 322 LOC **ORPHAN COMPLETO** (no consumer)

### 2.6 Lib (B4, 9 archivos)

- `lib/apiClient.ts` — 464 LOC, ApiClient singleton + namespaces (R11 + arch)
- `lib/auth/backend-client.ts` — server-side wrapper legítimo
- `lib/auth/index.ts` — barrel
- `lib/parseApiError.ts` — class `ApiError` + parser
- `lib/logger.ts` — console-based wrapper (viola CLAUDE.md, cross-app)
- `lib/stores/notificationStore.ts` — Zustand store **ORPHAN**
- `lib/parsers/schedulingCsvParser.ts` — **ORPHAN**
- `lib/ai-content-utils.ts` — **ORPHAN** + fake-AI generators
- `lib/ui-safelist.ts` — Tailwind safelist

### 2.7 Types (B4, 3 archivos)

- `types/ai-content.ts` — **ORPHAN** (consumido solo por ai-content-utils orphan)
- `types/scheduling.ts` — **ORPHAN** (consumido solo por schedulingCsvParser orphan)
- `types/common.ts` — ACTIVE

### 2.8 Colocated (1 archivo)

- `components/queue/useQueueManager.tsx` — 213 LOC, 4 raw fetches, **ORPHAN**

### 2.9 Extras (3 archivos)

- `proxy.ts` root-level — dead middleware (NO-OP por wrong filename)
- `middleware.ts` (si existe) — real middleware
- `next.config.js` — config

---

## §3. Pages + Layouts + Routes audit (B1)

### 3.1 Classification matrix (30 files)

| File                             | Tipo    | 'use client' | Export  |  LOC | Data fetch         | any | metadata | i18n  | Notas                                            |
| -------------------------------- | ------- | :----------: | ------- | ---: | ------------------ | --- | :------: | :---: | ------------------------------------------------ |
| `app/layout.tsx`                 | layout  |      no      | default |  ~45 | N/A                | 0   |    ✅    |  no   | Provider root                                    |
| `(dashboard)/layout.tsx`         | layout  |      no      | default |  ~80 | Server guard       | 0   |    no    |  no   | 2-hop redirect chain (L-273)                     |
| `(dashboard)/page.tsx`           | page    |     yes      | default | ~120 | hooks              | 0   |    no    |  no   | Dashboard root                                   |
| `accounts/page.tsx`              | page    |     yes      | default | ~320 | hooks + 3 raw      | 0   |    no    |  no   | 3 raw fetches (bulk, settings, create)           |
| `announcements/page.tsx`         | page    |     yes      | default | ~210 | inline hook        | 0   |    no    | drift | Triple violation (L-268)                         |
| `audit/page.tsx`                 | page    |     yes      | default | ~180 | hooks              | 0   |    no    |  no   |                                                  |
| `compliance/page.tsx`            | page    |     yes      | default | ~190 | hooks              | 0   |    no    |  no   |                                                  |
| `gateway-switches/page.tsx`      | page    |     yes      | default | ~160 | hooks              | 0   |    no    |  no   |                                                  |
| `logs/page.tsx`                  | page    |     yes      | default | ~150 | hooks + 1 CSV blob | 0   |    no    |  no   | CSV via raw fetch                                |
| `maintenance/page.tsx`           | page    |     yes      | default | ~140 | hooks              | 0   |    no    |  no   |                                                  |
| `pricing/page.tsx`               | page    |     yes      | default | ~130 | hooks              | 0   |    no    |  no   |                                                  |
| `queue/page.tsx`                 | page    |     yes      | default | ~100 | no hook            | 0   |    no    |  no   | Uses colocated useQueueManager ORPHAN            |
| `security/page.tsx`              | page    |     yes      | default | ~170 | hooks              | 0   |    no    |  no   |                                                  |
| `settings/page.tsx`              | page    |     yes      | default | ~200 | hooks              | 0   |    no    |  no   |                                                  |
| `sso/page.tsx`                   | page    |     yes      | default | ~150 | hooks              | 0   |    no    |  no   |                                                  |
| `subscriptions/page.tsx`         | page    |     yes      | default | ~280 | hooks + 2 raw      | 0   |    no    |  no   | 2 raw (auto-renewals, CSV export)                |
| `templates/admin/page.tsx`       | page    |     yes      | default | ~160 | hooks              | 0   |    no    |  no   |                                                  |
| `users/page.tsx`                 | page    |     yes      | default | ~190 | hooks              | 0   |    no    |  no   |                                                  |
| `webhooks/page.tsx`              | page    |     yes      | default | ~140 | hooks              | 0   |    no    |  no   |                                                  |
| `login/page.tsx`                 | page    |     yes      | default | ~120 | Server Action      | 0   |    ✅    |  no   |                                                  |
| `reset-password/page.tsx`        | page    |     yes      | default | ~180 | 2 raw              | 0   |    no    |  no   | GET public settings + POST confirm               |
| `error.tsx`                      | special |     yes      | default |  ~30 | N/A                | 0   |    no    |  no   | `error.message` exposed (L-271 security)         |
| `not-found.tsx`                  | special |      no      | default |  ~20 | N/A                | 0   |    no    |  no   |                                                  |
| `loading.tsx`                    | special |      no      | default |  ~25 | N/A                | 0   |    no    |  no   | `key={i}` index-as-key (L-270)                   |
| `global-error.tsx`               | special |     yes      | default |  ~30 | N/A                | 0   |    no    |  no   |                                                  |
| `api/backend/[...path]/route.ts` | route   |     N/A      | named   |  ~90 | Proxy              | 0   |    no    |  no   | Proxy handler — buffers full body (L-272)        |
| `proxy.ts` (root)                | extra   |     N/A      | named   |  ~60 | N/A                | 0   |    no    |  no   | **DEAD** (L-267) — wrong filename for middleware |

**Observaciones B1:**

- **0/17 dashboard pages con metadata explícita** (L-269 — composite SEO/UX gap).
- **87% pages con 'use client'** — inversión del pattern server-first.
- **Pattern dominante:** hooks de `@/hooks/*` + algún raw fetch puntual.
- **0 pages con data fetching server-side** (no RSC en dashboard).

### 3.2 Findings críticos B1

#### F-1 — `proxy.ts` root-level dead middleware (L-267)

```typescript
// apps/admin/proxy.ts
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  // Cookie-based route protection
  const token = request.cookies.get("admin_token")?.value;
  if (!token && !request.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
```

Next.js **requiere** `middleware.ts` con export `middleware` para que el runtime lo ejecute. El filename `proxy.ts` + export name `proxy` hacen que Next.js lo ignore silenciosamente. La protección cookie-based que pretende aplicar **no se ejecuta**. Real protección en `(dashboard)/layout.tsx` server guard.

**Acción:** rename `proxy.ts` → `middleware.ts` + export name `middleware`, O delete completo.

#### F-2 — `announcements/page.tsx` triple violation (L-268)

```typescript
// apps/admin/app/(dashboard)/announcements/page.tsx:55
const fetchAnnouncements = async () => {
  const res = await fetch("/api/admin/announcements", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
};

// L94 inline mutation con fetch directo
const handleSave = async (a: Announcement) => {
  const method = a.id ? "PUT" : "POST";
  await fetch(`/api/admin/announcements/${a.id ?? ""}`, {
    method,
    body: JSON.stringify(a),
    credentials: "include",
  });
  // no invalidation; manual reload
};
```

Composite: (1) colocated hook inline en page (no hooks/), (2) mutations con fetch directo sin TanStack, (3) no uso de i18n — strings hardcoded EN. **Replica el patrón R13 strict violado** + anti-TanStack + i18n drift.

#### F-3 — `error.tsx` exposes `error.message` (L-271 SECURITY)

```typescript
// apps/admin/app/error.tsx
'use client';
export default function Error({ error }: { error: Error & { digest?: string } }) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <pre>{error.message}</pre>  {/* <-- leak potencial */}
    </div>
  );
}
```

Next.js `error.tsx` recibe el error del server. Si el error incluye stack trace, DB error mensajes, u otros detalles sensibles, se renderiza en producción. **Categoría security.**

#### F-4 — `loading.tsx` index-as-key (L-270)

```typescript
// apps/admin/app/loading.tsx
return Array.from({ length: 5 }).map((_, i) => (
  <Skeleton key={i} className="h-12" />
));
```

React antipattern. Aquí benigno (skeleton estático), pero viola regla general.

#### F-5 — `api/backend/[...path]/route.ts` buffers full body (L-272)

```typescript
// apps/admin/app/api/backend/[...path]/route.ts
export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  const body = await request.text(); // <-- buffers todo el body
  // forward to backend
}
```

No soporta streaming (uploads grandes). Acción: pipe request body como stream.

#### F-6 — `(dashboard)/layout.tsx` 2-hop redirect chain (L-273)

Layout hace `await getSession()` → si invalid → `redirect('/login')`. Pero `/login/page.tsx` también hace check → si valid ya → `redirect('/dashboard')`. 2 hops visibles en logs + UX flash. Acción: consolidar en middleware (real, post-L-267).

### 3.3 Raw fetch catalog B1 (11 entries)

Ver §8 entries #1..#11 inline.

---

## §4. Components audit (B2)

### 4.1 R11 size violations — 19 individuales

| #     | File                                  | LOC |
| ----- | ------------------------------------- | --: |
| L-274 | `webhooks/DeadLetterQueue.tsx`        | 732 |
| L-275 | `webhooks/WebhookSubscriptions.tsx`   | 689 |
| L-276 | `webhooks/WebhookEventsList.tsx`      | 505 |
| L-277 | `subscriptions/ChangePlanDialog.tsx`  | 488 |
| L-278 | `security/RbacManager.tsx`            | 481 |
| L-279 | `shared/SidebarNav.tsx`               | 446 |
| L-280 | `accounts/AccountBillingPanel.tsx`    | 383 |
| L-281 | `pricing/ProviderTiersTab.tsx`        | 365 |
| L-282 | `pricing/AccountTiersTab.tsx`         | 355 |
| L-283 | `compliance/BreachTable.tsx`          | 354 |
| L-284 | `maintenance/ScheduledJobsPanel.tsx`  | 350 |
| L-285 | `compliance/DsarTable.tsx`            | 340 |
| L-286 | `security/MfaSelfService.tsx`         | 331 |
| L-287 | `compliance/GdprSettingsForm.tsx`     | 323 |
| L-288 | `webhooks/WebhookMetrics.tsx`         | 319 |
| L-289 | `security/MfaManager.tsx`             | 307 |
| L-290 | `webhooks/WebhookTimeline.tsx`        | 267 |
| L-291 | `compliance/SecuritySettingsForm.tsx` | 252 |
| L-292 | `security/PermissionGrid.tsx`         | 215 |

Límite 200 LOC per component. Todos sobre. Severidad: mantenibilidad.

### 4.2 Findings críticos B2

#### C1 — `ScheduledJobsPanel` fake-persistence cron (L-293, nueva categoría)

```typescript
// apps/admin/components/maintenance/ScheduledJobsPanel.tsx
const [jobs, setJobs] = useState<ScheduledJob[]>([
  { id: "1", name: "daily-backup", cron: "0 2 * * *", enabled: true, lastRun: null, ... },
  { id: "2", name: "weekly-cleanup", cron: "0 3 * * 0", enabled: false, ... },
]);

const handleToggle = (jobId: string) => {
  setJobs(prev => prev.map(j => j.id === jobId ? { ...j, enabled: !j.enabled } : j));
  // TODO: no persistence, no backend sync
};
```

El componente renderiza cron jobs estáticos en-memory + toggle local sin persistencia backend. Usuario ve "job enabled" pero al reload todos vuelven al estado inicial. **Nueva categoría de hallazgo: fake-persistence** (similar a fake-AI pero para admin ops). Crítico — da impresión de control real donde no hay.

#### C2 — `WebhookEventsList` TanStack bypass (L-294)

```typescript
// apps/admin/components/webhooks/WebhookEventsList.tsx:86
const fetchEvents = useCallback(async () => {
  setLoading(true);
  const res = await fetch(`/api/backend/admin/webhooks/events?${params}`, {
    credentials: "include",
  });
  const data = await res.json();
  setEvents(data);
  setLoading(false);
}, [filters]);

useEffect(() => {
  fetchEvents();
}, [fetchEvents]);
```

useState + useEffect + raw fetch **sin TanStack**. No cache, no retry, no invalidation. Backend `webhookRoutes.ts:getEvents` existe. Acción: `useWebhookEvents(filters)` hook en `hooks/useWebhooks.ts` (GAP L-327).

#### C3 — `WebhookSubscriptions` TanStack bypass (L-295)

Mismo patrón. 5 fetches (list subs, list projects, create, toggle, delete) todos via `fetch()` + useState. Backend endpoints existen. Acción: extender `useWebhooks.ts`.

#### C4 — i18n drift composite (L-296)

17 components con strings hardcoded en inglés sin next-intl. Notable: `ui/ConfirmDialog` y `ui/InputDialog` app-wide consumed — strings "Confirm" / "Cancel" / "OK" hardcoded. Drift respecto a admin apps multi-idioma.

**Components afectados (composite):**

1. announcements/page.tsx (inline strings)
2. ui/ConfirmDialog.tsx
3. ui/InputDialog.tsx
4. webhooks/DeadLetterQueue.tsx
5. webhooks/WebhookSubscriptions.tsx
6. webhooks/WebhookEventsList.tsx
7. subscriptions/ChangePlanDialog.tsx
8. security/RbacManager.tsx
9. security/MfaManager.tsx
10. security/MfaSelfService.tsx
11. security/PermissionGrid.tsx
12. pricing/ProviderTiersTab.tsx
13. pricing/AccountTiersTab.tsx
14. compliance/BreachTable.tsx
15. compliance/DsarTable.tsx
16. maintenance/ScheduledJobsPanel.tsx
17. shared/SidebarNav.tsx

#### C5 — default export violation (L-297 composite)

```typescript
// apps/admin/components/security/MfaManager.tsx:L307
export default function MfaManager() { ... }

// apps/admin/components/security/RbacManager.tsx:L481
export default function RbacManager() { ... }
```

REACT_STANDARDS: named exports para components. default exports solo en pages. Ambos violan.

#### C6 — `@layer` mismapping composite (L-298)

Componentes con header JSDoc `@layer` pero valor no canónico (`presentation`, `ui`, `component`, ausente). Crece con B3 (hooks) + B4 (lib + types). **Total final ~40 archivos admin + cross-app.**

Admin B2 contribuciones (11):

- ErrorBoundary, SkipLink, VisuallyHidden: sin `@layer`
- ConfirmDialog, InputDialog, Toast wrapper: `@layer ui` (no canónico)
- SidebarNav, Header, BreadcrumbBar: sin `@layer`
- usamos `application` cuando es UI component

Admin B3 (26/29 hooks drift):

- Mayoría hooks marcados `@layer application` cuando debería ser `@layer infrastructure` (consumen raw fetch / BullMQ-style ops)

Admin B4 (3+ files):

- parseApiError.ts: `@layer presentation` (siendo utility)
- apiClient.ts: `@layer application` (siendo infrastructure)
- logger.ts: sin `@layer`

#### C7 — unimplemented retry-all endpoint `DeadLetterQueue` (L-299 CRITICAL)

```typescript
// apps/admin/components/webhooks/DeadLetterQueue.tsx:157
const handleRetryAll = async () => {
  setProcessing(true);
  const res = await fetch("/api/backend/admin/webhooks/dlq/retry-all", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    toast.error("Failed to retry all");
    return;
  }
  toast.success("All DLQ events queued for retry");
};
```

Backend search: endpoint `/admin/webhooks/dlq/retry-all` **NO REGISTERED** en `webhookRoutes.ts`. Solo existe `/admin/webhooks/dlq/:eventId/retry` singular. Usuario hace click "Retry All", ve toast de success, pero el request falla silentemente (res.ok check está antes del toast success, pero el 404 devuelve `{error}` JSON, no triggerea throw). **Crítico:** feature anunciada en UI que no existe en backend.

#### C8 — missing `@component` JSDoc shared a11y files (L-300, L-301, L-302)

```typescript
// apps/admin/components/shared/ErrorBoundary.tsx — sin @component
// apps/admin/components/shared/SkipLink.tsx — sin @component
// apps/admin/components/shared/VisuallyHidden.tsx — sin @component
```

CLAUDE.md mandatory: cada new React component requiere JSDoc `@component`. Los 3 fueron añadidos en commits recientes (6b48996) sin header. Individuales.

#### C9 — `ErrorBoundary` console.error + raw error.message (L-303, L-304)

```typescript
// apps/admin/components/shared/ErrorBoundary.tsx
componentDidCatch(error: Error, info: ErrorInfo) {
  console.error('ErrorBoundary caught:', error, info);  // L-303 viola CLAUDE.md (no console.*)
}

render() {
  if (this.state.hasError) {
    return <div>{this.state.error?.message}</div>;  // L-304 security leak, replica L-271
  }
  return this.props.children;
}
```

#### C10 — `SidebarNav` document.cookie + window.location.reload (L-305)

```typescript
// apps/admin/components/shared/SidebarNav.tsx:~350
const handleLogout = async () => {
  await fetch("/api/backend/auth/logout", { method: "POST", credentials: "include" });
  document.cookie = "admin_token=; Max-Age=0; path=/"; // manual cookie manipulation
  window.location.reload(); // hard reload
};
```

Bypass Next.js router + manual cookie manipulation. Debe usar `signOut()` via NextAuth / Server Action.

#### C11 — silent catch composite (L-306, 6 components)

```typescript
try {
  await doSomething();
} catch (e) {
  /* swallow */
}
```

En 6 components (RbacManager, MfaManager, WebhookSubscriptions, DeadLetterQueue, ScheduledJobsPanel, BreachTable). Composite medium.

#### C12 — missing `htmlFor` a11y composite (L-307, 6 components)

Labels sin `htmlFor={id}` explícito en 6 forms. Screen reader pierde asociación. Composite.

#### C13 — admin→client URL questionable (L-308)

```typescript
// apps/admin/components/webhooks/WebhookSubscriptions.tsx:152
const res = await fetch("/api/backend/projects", { credentials: "include" });
```

Admin fetcheando `/projects` que parece endpoint cliente. ¿Intencional (multi-tenant admin)? Sospechoso. Low severity pending clarification.

#### C14 — unused imports composite (L-309, 4 files)

4 components con `import { X } from "..."` no usados (linter debería detectar).

### 4.3 Raw fetch catalog B2 (18 entries inclu EventSource)

Ver §8 entries #12..#29.

### 4.4 Positive B2

- Most components use shadcn/ui properly
- Tables use TanStack Table (when applicable)
- Forms use react-hook-form (mayoría)
- Accessibility: `Dialog` + `Tabs` from Radix → a11y bueno por default

---

## §5. Hooks audit + TanStack v5 compliance matrix (B3)

### 5.1 Inventario 29 hooks

(Ver §2.4 lista)

### 5.2 TanStack v5 compliance matrix completa

| Hook                              | LOC | Q/M | R1  | R2  | R3  | R4  |   R5   | R8  | R9  | R10 | R11 |          R13           | ORPHAN  |
| --------------------------------- | --: | --- | :-: | :-: | :-: | :-: | :----: | :-: | :-: | :-: | :-: | :--------------------: | :-----: |
| useAccountBilling                 |  54 | Q   | ✅  | ✅  | ✅  | ✅  |  N/A   | ✅  | ✅  | ✅  | ✅  |          ❌ 1          |   no    |
| useAccountSessions                |  68 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 1/2 | ✅  | ✅  | ✅  | ✅  |          ❌ 2          |   no    |
| useAccounts                       | 112 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 2/3 | ✅  | ✅  | ✅  | ✅  |          ❌ 1          |   no    |
| useAdminUsers                     | 172 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 3/4 | ✅  | ✅  | ✅  | ❌  |          ❌ 5          |   no    |
| useAdminPasswordReset             |  45 | M   | N/A | ✅  | N/A | N/A | ❌ 0/2 | N/A | N/A | ✅  | ✅  |          ❌ 1          |   no    |
| useAnalytics                      | 166 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 1/2 | ❌  | ✅  | ✅  | ❌  |          ❌ 3          |   no    |
| useAuditLogs (ORPHAN)             |  62 | Q   | ✅  | ✅  | ✅  | ✅  |  N/A   | ✅  | ✅  | ✅  | ✅  |          N/A           | **YES** |
| useAuditStats (ORPHAN)            |  48 | Q   | ✅  | ✅  | ✅  | ✅  |  N/A   | ✅  | ✅  | ✅  | ✅  |          ❌ 1          | **YES** |
| useBillingStats                   |  72 | Q   | ✅  | ✅  | ✅  | ✅  |  N/A   | ✅  | ✅  | ✅  | ✅  |          ❌ 1          |   no    |
| useChangePassword                 |  38 | M   | N/A | ✅  | N/A | N/A | ⚠️ 1/2 | N/A | N/A | ✅  | ✅  |          ❌ 1          |   no    |
| useCompliance                     | 635 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 5/8 | ⚠️  | ✅  | ✅  | ❌  |         ❌ 15          |   no    |
| useContentLibrary (ORPHAN)        | 120 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 1/2 | ✅  | ✅  | ✅  | ✅  |          ❌ 1          | **YES** |
| useGatewaySwitches                | 216 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 2/3 | ✅  | ✅  | ✅  | ❌  |          ❌ 5          |   no    |
| useMfa                            |  95 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 2/3 | ✅  | ✅  | ✅  | ✅  |          ❌ 3          |   no    |
| useMultiPlatformScheduling (ORPH) | 159 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 2/3 | ❌  | ✅  | ✅  | ❌  |          ❌ 5          | **YES** |
| useNotifications                  |  75 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 1/2 | ✅  | ✅  | ✅  | ✅  |          ❌ 2          |   no    |
| usePerformanceInsights (ORPHAN)   | 108 | Q   | ✅  | ✅  | ✅  | ✅  |  N/A   | ❌  | ✅  | ✅  | ✅  |          ❌ 1          | **YES** |
| usePosts (ORPHAN)                 |  82 | Q   | ✅  | ✅  | ✅  | ✅  |  N/A   | ❌  | ✅  | ⚠️  | ✅  |          N/A           | **YES** |
| usePricingTiers                   | 305 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 4/6 | ✅  | ✅  | ✅  | ❌  |          ❌ 8          |   no    |
| usePublicSettings (ORPHAN TOTAL)  |  65 | Q   | ✅  | ✅  | ✅  | ✅  |  N/A   | ✅  | ✅  | ✅  | ✅  |          ❌ 1          | **YES** |
| useQueueManagement                |  98 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 1/2 | ✅  | ✅  | ✅  | ✅  |          ❌ 3          |   no    |
| useResetAccountPassword           |  32 | M   | N/A | ✅  | N/A | N/A | ⚠️ 1/2 | N/A | N/A | ✅  | ✅  |          ❌ 1          |   no    |
| useSecurity                       | 128 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 2/3 | ✅  | ✅  | ✅  | ✅  |           ✅           |   no    |
| useSettings                       | 179 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 2/3 | ✅  | ✅  | ✅  | ❌  |          ❌ 6          |   no    |
| useSubscriptionMutations          |  88 | M   | N/A | ✅  | N/A | N/A | ⚠️ 2/3 | N/A | N/A | ✅  | ✅  |          ❌ 3          |   no    |
| useUniversalAnalytics (ORPHAN)    |  72 | Q   | ✅  | ✅  | ✅  | ✅  |  N/A   | ❌  | ✅  | ✅  | ✅  |          ❌ 1          | **YES** |
| useUsageMetrics                   |  58 | Q   | ✅  | ✅  | ✅  | ✅  |  N/A   | ✅  | ✅  | ✅  | ✅  | ❌ 1 (sin credentials) |   no    |
| useWebhooks                       | 110 | Q+M | ✅  | ✅  | ✅  | ✅  | ⚠️ 3/4 | ✅  | ✅  | ✅  | ✅  |      ❌ 5 + GAPs       |   no    |
| index.ts (barrel)                 |   ~ | N/A |  —  |  —  |  —  |  —  |   —    |  —  |  —  | ✅  | ✅  |          N/A           |    —    |

### 5.3 Counts consolidados

| Regla                      |                                                                                  Violations | Severidad          |
| -------------------------- | ------------------------------------------------------------------------------------------: | ------------------ |
| R1 (queryKey shape)        |                                                                                       **0** | —                  |
| R2 (gcTime)                |                                                                                       **0** | —                  |
| R3 (no onSuccess useQuery) |                                                                                       **0** | —                  |
| R4 (no onError useQuery)   |                                                                                       **0** | —                  |
| R5 (mutation onError)      |                                                                 **11 hooks / 31 mutations** | medium             |
| R6 (useQueries)            |                                                                                       **0** | no usage           |
| R7 (useSuspenseQuery)      |                                                                                       **0** | no usage           |
| R8 (staleTime explícito)   | **4** (useMultiPlatformScheduling, usePerformanceInsights, usePosts, useUniversalAnalytics) | medium             |
| R9 (enabled)               |                                                                                       **0** | —                  |
| R10 (zero any)             |                                        **0 directas** (usePosts borderline con `unknown[]`) | low                |
| R11 (<150 LOC strict)      |                                                        **8** (L-310..L-316 + useAdminUsers) | medium             |
| R12 (naming)               |                                                                                       **0** | —                  |
| R13 strict (no raw fetch)  |                                                            **23/29 hooks, ~62 raw fetches** | critical (catalog) |

### 5.4 R11 hooks individuales

| #     | File                            | LOC | Limit |                   Over |
| ----- | ------------------------------- | --: | ----: | ---------------------: |
| L-310 | `useCompliance.ts`              | 635 |   150 | +485 (mega-aggregator) |
| L-311 | `usePricingTiers.ts`            | 305 |   150 |                   +155 |
| L-312 | `useGatewaySwitches.ts`         | 216 |   150 |                    +66 |
| L-313 | `useSettings.ts`                | 179 |   150 |                    +29 |
| L-314 | `useAdminUsers.ts`              | 172 |   150 |                    +22 |
| L-315 | `useAnalytics.ts`               | 166 |   150 |                    +16 |
| L-316 | `useMultiPlatformScheduling.ts` | 159 |   150 |                     +9 |

### 5.5 ORPHAN hooks individuales (8)

| #     | Hook                         | LOC | Backend existe | Consumers grep |
| ----- | ---------------------------- | --: | -------------- | -------------- |
| L-317 | `useAuditLogs`               |  62 | Yes            | 0 en admin/    |
| L-318 | `useAuditStats`              |  48 | Yes            | 0 en admin/    |
| L-319 | `useContentLibrary`          | 120 | Yes            | 0 en admin/    |
| L-320 | `useMultiPlatformScheduling` | 159 | Partial        | 0 en admin/    |
| L-321 | `usePerformanceInsights`     | 108 | Yes            | 0 en admin/    |
| L-322 | `usePosts`                   |  82 | Yes            | 0 en admin/    |
| L-323 | `usePublicSettings`          |  65 | Yes            | 0 en admin/    |
| L-324 | `useUniversalAnalytics`      |  72 | Yes            | 0 en admin/    |

**Total ORPHAN hooks: ~716 LOC de código sin consumer.**

### 5.6 Críticos B3

#### B3-C1 — `useAnalytics` fake-data composite (L-325, 6 campos)

```typescript
// apps/admin/hooks/useAnalytics.ts (approx)
export function useAdminAnalytics() {
  return useQuery({
    queryKey: ["admin", "analytics", "overview"],
    queryFn: async () => {
      const res = await fetch("/api/backend/admin/analytics", { credentials: "include" });
      const data = await res.json();
      return {
        ...data,
        systemUptime: 99.97, // L-325.1 hardcoded
        supportTickets: 0, // L-325.2 hardcoded
        customerSatisfaction: 4.8, // L-325.3 hardcoded
        trends: [], // L-325.4 empty array masquerading as data
        cac: 42.5, // L-325.5 hardcoded CAC
        securityScore: 95, // L-325.6 hardcoded + inconsistent con otras metrics
      };
    },
  });
}
```

**6 campos fake individuales.** Widget "System Health" muestra `99.97% uptime` a admin real. Replica patrón D0v4-4 L-100 fake-AI pero en admin. **Crítico.**

#### B3-C2 — Credentials missing individual (2 hooks, security)

- **L-328** `useUsageMetrics` fetch `/api/backend/admin/usage/metrics` sin `credentials: "include"`. Session cookie no enviada → backend responde unauthorized pero error handling silencia.
- **L-329** `useCompliance.ts:L101-103` fetch 3 URLs (breaches, dsars, consents) sin `credentials`. Mismo problema. Security-category individual por archivo.

#### B3-C3 — `useAdminPasswordReset` totalmente silencioso (L-330)

```typescript
export function useAdminPasswordReset() {
  return useMutation({
    mutationFn: async (email: string) => {
      await fetch("/api/backend/admin/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      // no return, no error check, no onSuccess, no onError
    },
  });
}
```

Admin resetea password de user. Si backend falla → UI muestra success state. User jamás recibe email. Crítico.

#### B3-C4 — `useAnalytics.fetchJSON` silencia errores (L-331)

```typescript
const fetchJSON = async (url: string) => {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch {
    return {}; // silent fallback
  }
};
```

Error swallowed → UI muestra `{}` como si fuera data vacía legítima. High severity.

### 5.7 Medium B3

#### B3-M1 — `apiClient` vs raw fetch inconsistency (L-332)

```typescript
// useAccounts: queries usan raw fetch, mutations usan apiClient
const { data } = useQuery({
  queryFn: async () => {
    const res = await fetch("/api/backend/admin/accounts", { credentials: "include" });
    return res.json();
  },
});

const mutate = useMutation({
  mutationFn: (id: string) => apiClient.accounts.delete(id), // mixed
});
```

Inconsistencia dentro del mismo hook. Replica en `useAuditStats`. Medium.

#### B3-M2 — `usePosts` weak typing (L-333)

```typescript
// apps/admin/hooks/usePosts.ts
export function usePosts(filters: unknown[]) {  // L-333 weak
  return useQuery({
    queryKey: ["posts", ...filters] as unknown[],
    queryFn: async () => { ... },
  });
}
```

`unknown[]` sin narrowing. Low severity (no `any` técnicamente, pero débil).

#### B3-M3 — `useSecurity` queries serializadas (L-334)

```typescript
const users = useQuery({ queryKey: ["security", "users"], queryFn: ... });
const roles = useQuery({ queryKey: ["security", "roles"], queryFn: ..., enabled: users.isSuccess });
const perms = useQuery({ queryKey: ["security", "permissions"], queryFn: ..., enabled: roles.isSuccess });
```

3 queries en serie vs paralelo. Podrían correr en paralelo (no hay dependencia real). Performance low.

### 5.8 Composites extensiones (no numeran nuevos)

#### Extension L-260 (D0v4-5) — admin B3 añade 31 mutations sin onError

Composite `missing per-mutation onError` pasa de 56 mutations (cliente D0v4-5) a **87 mutations totales**. Admin añade 31 nuevas en: useAccounts, useAccountSessions, useAdminUsers (3), useAdminPasswordReset, useAnalytics, useChangePassword, useCompliance (5), useContentLibrary, useGatewaySwitches (2), useMfa (2), useMultiPlatformScheduling (2), useNotifications, usePricingTiers (4), useQueueManagement, useResetAccountPassword, useSecurity (2), useSettings (2), useSubscriptionMutations (2), useWebhooks (3).

#### Extension L-298 (B2) — admin B3 añade 26/29 hooks `@layer` drift

26 hooks marcados `@layer application` cuando el workflow real (consumen raw fetch infra + BullMQ semantics) apunta a `@layer infrastructure`. Hooks drift.

### 5.9 Raw fetch catalog B3 (62 entries)

Ver §8 entries #30..#91.

### 5.10 apiClient inconsistency cases

Per hook:

| Hook               | Query method  | Mutation method |           Inconsistent?           |
| ------------------ | ------------- | --------------- | :-------------------------------: |
| useAccounts        | raw fetch     | apiClient       |          **YES** (L-332)          |
| useAuditStats      | raw fetch     | — (Q only)      | — (but api.audit.getStats existe) |
| useBillingStats    | raw fetch     | — (Q only)      |                 —                 |
| useAdminUsers      | raw fetch     | raw fetch       |            uniform raw            |
| useCompliance      | raw fetch     | raw fetch       |            uniform raw            |
| useGatewaySwitches | fetchJson     | fetchJson       |          uniform helper           |
| usePricingTiers    | raw fetch     | raw fetch       |            uniform raw            |
| useSecurity        | apiClient     | apiClient       |       ✅ uniform apiClient        |
| useSettings        | settingsFetch | settingsFetch   |          uniform helper           |
| useWebhooks        | raw fetch     | raw fetch       |            uniform raw            |

Solo **useSecurity** uses apiClient consistently across Q+M. Nota importante para plan consolidación §13.

---

## §6. Providers audit (B4, 4 archivos)

### 6.1 `providers/QueryProvider.tsx` — deep-dive

```typescript
// apps/admin/providers/QueryProvider.tsx (actual, ~60 LOC)
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000,
            retry: 1,
          },
        },
        // ❌ NO queryCache: new QueryCache({ onError })
        // ❌ NO mutationCache: new MutationCache({ onError })
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools />
    </QueryClientProvider>
  );
}
```

**Replica L-70 + L-101 D0v4-4 cliente.** Identico problema:

| Item                              | Estado          | Ref                                  |
| --------------------------------- | --------------- | ------------------------------------ |
| `QueryCache({onError})` global    | ❌ MISSING      | L-336 (new) = cross-app promote §9.1 |
| `MutationCache({onError})` global | ❌ MISSING      | L-336                                |
| `staleTime: 60 * 1000` default    | ⚠️ Generic 60s  | L-336                                |
| `gcTime: 5 * 60 * 1000`           | ✅ v5 correcto  | —                                    |
| `retry: 1` default                | ⚠️ Recomienda 2 | L-336                                |
| `defaultOptions.mutations`        | **NOT SET**     | L-336                                |

**Fix propuesto (referencia, no aplicar):**

```typescript
const [queryClient] = useState(
  () =>
    new QueryClient({
      defaultOptions: {
        queries: { staleTime: 60_000, gcTime: 300_000, retry: 2 },
        mutations: { retry: 0, onError: (err) => toast.error(parseApiError(err)) },
      },
      queryCache: new QueryCache({
        onError: (err, query) => {
          if (query.state.data !== undefined) toast.error(parseApiError(err));
        },
      }),
      mutationCache: new MutationCache({
        onError: (err) => toast.error(parseApiError(err)),
      }),
    })
);
```

### 6.2 `providers/AuthProvider.tsx` — findings (L-345)

```typescript
// apps/admin/providers/AuthProvider.tsx:58
const fetchPermissions = async () => {
  const res = await fetch("/api/backend/auth/permissions", { credentials: "include" });
  const data = await res.json();
  // Dual envelope: algunas rutas devuelven { permissions: [...] }, otras [...]
  const perms = Array.isArray(data) ? data : (data.permissions ?? []);
  if (perms.length === 0 && user?.role === "SUPER_ADMIN") {
    // silent fallback assumption: SUPER_ADMIN = all perms
    return ALL_PERMS;
  }
  return perms;
};
```

**3 issues compuestos:**

1. Raw fetch fuera de TanStack (no cache, no retry)
2. Dual envelope parsing (flag de drift backend contract)
3. Silent fallback `SUPER_ADMIN = ALL_PERMS` — si backend responde `[]` legítimamente (bug), SUPER_ADMIN obtiene todos los permisos sin verificación

Severity: medium (security + architectural).

### 6.3 `providers/ThemeProvider.tsx`

Wrapper thin de `next-themes`. OK. Sin findings.

### 6.4 `providers/ProjectProvider.tsx` — **ORPHAN COMPLETO** (L-335)

322 LOC. Estructura sofisticada:

- Context con `currentProject`, `switchProject`, `availableProjects`
- 2 raw fetches internos (L-346): `GET /api/backend/projects` + `POST /api/backend/projects/:id/activate`
- useEffect cascade para auto-load active project

**Consumers grep**: `<ProjectProvider` en `apps/admin/**` → **0 hits**.

Admin no tiene concept de "proyecto" en su UI (admin maneja accounts, no projects). **DEAD_CODE_CANDIDATE crítico** pending Edward validation (§5.9 — no delete sin validación). **Divergencia con cliente:** cliente tiene ProjectProvider stub fake-AI (L-100 D0v4-4) usado; admin tiene ProjectProvider **real pero sin consumer**. Ver §9.4.

### 6.5 Hierarchy actual

```tsx
<ThemeProvider>
  <QueryProvider>
    <AuthProvider>{children}</AuthProvider>
  </QueryProvider>
</ThemeProvider>
```

`ProjectProvider` **NO** está en la hierarchy. Confirma ORPHAN.

---

## §7. Lib audit (B4)

### 7.1 `lib/apiClient.ts` — 464 LOC deep-dive (L-337)

Estructura:

```typescript
// apps/admin/lib/apiClient.ts
const http = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? res.statusText, body);
  }
  return res.status === 204 ? undefined : res.json();
};

export const api = {
  accounts: { list, get, create, update, delete, bulk, suspend, reactivate, settings },
  audit: { getStats, getLogs, export },
  billing: { getStats, getAccountSubscription, updateSubscription, processAutoRenewals, export },
  compliance: { getBreaches, getDsars, getConsents, getSettings, updateSettings, ... },
  gatewaySwitches: { list, initiate, cancel, complete },
  mfa: { list, enable, disable, verify },
  pricing: { getTiers, updateTier, getProviderTiers, ... },
  rbac: { listUsers, activateUser, deactivateUser, assignRoles },
  security: { listRoles, listPermissions, assign, revoke },
  settings: { get, update, getPublic },
  subscriptions: { changePlan },
  webhooks: { listSubs, createSub, toggleSub, deleteSub, events, eventDetails, dlq, retryEvent, retryAll, metrics },
};
```

**Métricas:**

- **464 LOC** — R11 violation (>200 para utility)
- **0 `any`** — superior a cliente `client.ts` (13 `any`)
- **ApiError class** — superior a cliente `authApi.ts` (plain Error)
- **credentials: "include"** consistent en wrapper — superior a cliente (mixed)
- **13 namespaces** — namespace inconsistency cases: e.g. `webhooks.retryAll` existe pero `DeadLetterQueue.tsx` hace raw fetch directo (L-299 unimplemented backend). Namespace coverage desigual.

**Comparación admin vs cliente:**

| Métrica                |         admin apiClient.ts | cliente client.ts | Superior                     |
| ---------------------- | -------------------------: | ----------------: | ---------------------------- |
| LOC                    |                        464 |               440 | cliente (marginal)           |
| `any` count            |                          0 | 13 (L-216..L-228) | **admin**                    |
| Error class            |            ApiError custom |       plain Error | **admin**                    |
| credentials consistent |                        YES |             mixed | **admin**                    |
| Namespace pattern      |                   explicit |      flat methods | **admin**                    |
| Coverage vs hooks      | ~40% (hooks still use raw) |               ~3% | cliente peor (raw dominante) |

**Hallazgo composite: admin apiClient es "0 any + ApiError + credentials consistent + namespaces" SUPERIOR** arquitectónicamente al cliente — inversion inesperada. Ver §9.2.

**Architectural issue L-337:** 464 LOC god file + namespace coverage desigual (no todos los endpoints del dominio tienen método apiClient correspondiente, especialmente webhooks `retryAll`).

### 7.2 `lib/parseApiError.ts`

```typescript
// apps/admin/lib/parseApiError.ts (~40 LOC)
/**
 * @file parseApiError.ts
 * @layer presentation  // <-- L-344 mismapping, debería ser infrastructure (utility)
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function parseApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message ?? `Error ${error.statusCode}`;
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
}
```

Class bien diseñada. Import path único, consumers abundantes. Sin drift salvo `@layer` (L-344).

### 7.3 `lib/logger.ts` — **cross-app finding** (L-347)

```typescript
// apps/admin/lib/logger.ts (~20 LOC)
export const logger = {
  info: (msg: string, ctx?: unknown) => console.log("[admin]", msg, ctx),
  warn: (msg: string, ctx?: unknown) => console.warn("[admin]", msg, ctx),
  error: (msg: string, ctx?: unknown) => console.error("[admin]", msg, ctx),
};
```

**Viola CLAUDE.md rule "zero console.\* in production code"** + no usa `@observability/logger` (Pino). Identicamente replicado en `apps/client/lib/logger.ts`. Cross-app finding promoted §9.1.

### 7.4 `lib/auth/backend-client.ts`

Server-side fetch wrapper para Server Actions. 3 raw fetches (legitimate — no puede usar browser `fetch` igual). Sin findings.

### 7.5 `lib/stores/notificationStore.ts` — **ORPHAN** (L-340)

```typescript
// apps/admin/lib/stores/notificationStore.ts (~80 LOC)
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * @file notificationStore.ts
 * @description In-memory notification store with localStorage persistence.
 * @layer application
 * @todo Phase 2: wire to backend. Phase 3: replace with TanStack subscription pattern.
 */
export const useNotificationStore = create(
  persist(
    (set) => ({
      notifications: [],
      addNotification: (n) => set((state) => ({ notifications: [n, ...state.notifications] })),
      markRead: (id) => set((state) => ({ notifications: state.notifications.map(...) })),
      clear: () => set({ notifications: [] }),
    }),
    { name: "admin-notifications" },
  ),
);
```

Phase 2/3 commitment in-doc jamás cumplido. Consumer grep → **0 hits**. DEAD_CODE_CANDIDATE + broken promise. Crítico.

### 7.6 `lib/parsers/schedulingCsvParser.ts` — **ORPHAN** (L-341)

178 LOC. Parse CSV for bulk scheduling upload. Consumer: `types/scheduling.ts` (también ORPHAN). Ninguna page consume. DEAD_CODE_CANDIDATE.

### 7.7 `lib/ai-content-utils.ts` — **ORPHAN + fake-AI** (L-339, L-349)

178 LOC. 4 generators:

```typescript
// apps/admin/lib/ai-content-utils.ts
export function generateCaption(theme: string): string {
  const captions = [
    `Exciting update about ${theme}! 🚀`,  // L-349 emoji truncation bug if theme contains surrogate pair
    `Breaking: ${theme} is here!`,
    ...
  ];
  return captions[Math.floor(Math.random() * captions.length)];
}

export function suggestHashtags(content: string): string[] { ... }
export function analyzeEngagement(content: string): EngagementAnalysis { ... }
export function transformTone(content: string, tone: Tone): string { ... }
```

**Composite crítico:**

1. 4 fake-AI generators (no AI real)
2. Consumer: **0 hits en admin/**
3. Emoji truncation bug si theme incluye surrogate pair

DEAD_CODE_CANDIDATE. Similar patrón a cliente L-100 fake-AI pero admin es **completamente orphan**.

### 7.8 `lib/ui-safelist.ts`

Tailwind safelist para classes dinámicas. OK. Sin findings.

---

## §8. Raw fetch migration catalog (102 entries inline)

Formato por entry: file:line + current + method + backend status + proposed hook + queryKey + invalidation + effort + blockers.

### 8.1 B1 — Pages (11 entries)

#### Entry #1 — `app/(dashboard)/reset-password/page.tsx:40`

- **Current:** `fetch("/api/backend/settings/public")`
- **Method:** GET
- **Backend status:** OK (`/settings/public` registered)
- **Proposed hook:** `usePublicSettings()` (ya existe en hooks/ pero ORPHAN L-323)
- **QueryKey:** `["settings", "public"]`
- **Invalidation:** N/A (public readonly)
- **Effort:** S
- **Blockers:** unblock hook de ORPHAN (wire consumer)

#### Entry #2 — `app/(dashboard)/reset-password/page.tsx:86`

- **Current:** `fetch("/api/backend/admin/auth/password/reset/confirm", {method: "POST"})`
- **Method:** POST
- **Backend status:** UNVERIFIED
- **Proposed hook:** `useAdminPasswordResetConfirm` new (no existe)
- **QueryKey:** mut
- **Invalidation:** N/A
- **Effort:** S
- **Blockers:** ninguno

#### Entry #3 — `accounts/page.tsx:181`

- **Current:** `fetch("/api/backend/admin/accounts/bulk/suspend" | ".../reactivate")`
- **Method:** POST
- **Backend status:** UNVERIFIED
- **Proposed hook:** `useBulkAccountAction` extend `useAccounts`
- **QueryKey:** mut
- **Invalidation:** `["accounts"]`
- **Effort:** S
- **Blockers:** ninguno

#### Entry #4 — `accounts/page.tsx:247`

- **Current:** `fetch("/api/backend/admin/accounts/:id/settings", {method: "PUT"})`
- **Method:** PUT
- **Backend status:** OK
- **Proposed hook:** extend `useAccounts.updateSettings`
- **QueryKey:** mut
- **Invalidation:** `["accounts", id]`
- **Effort:** S
- **Blockers:** ninguno

#### Entry #5 — `accounts/page.tsx:279`

- **Current:** `fetch("/api/backend/admin/accounts", {method: "POST"})`
- **Method:** POST
- **Backend status:** OK
- **Proposed hook:** extend `useAccounts.create`
- **QueryKey:** mut
- **Invalidation:** `["accounts"]`
- **Effort:** S

#### Entry #6 — `announcements/page.tsx:55`

- **Current:** `fetch("/api/backend/admin/announcements")` (colocated inline hook)
- **Method:** GET
- **Backend status:** OK
- **Proposed hook:** `useAnnouncements` new en `hooks/`
- **QueryKey:** `["admin", "announcements"]`
- **Invalidation:** N/A
- **Effort:** M (L-268 composite rewrite)

#### Entry #7 — `announcements/page.tsx:94`

- **Current:** `fetch("/api/backend/admin/announcements/:id" | ..., {method: "PUT"|"POST"})`
- **Method:** PUT/POST
- **Backend status:** OK
- **Proposed hook:** `useSaveAnnouncement` new (mutation)
- **QueryKey:** mut
- **Invalidation:** `["admin", "announcements"]`
- **Effort:** S

#### Entry #8 — `announcements/page.tsx:115`

- **Current:** `fetch("/api/backend/admin/announcements/:id", {method: "DELETE"})`
- **Method:** DELETE
- **Backend status:** OK
- **Proposed hook:** `useDeleteAnnouncement` new
- **QueryKey:** mut
- **Invalidation:** `["admin", "announcements"]`
- **Effort:** S

#### Entry #9 — `logs/page.tsx:99`

- **Current:** `fetch("/api/backend/admin/audit/export")` (CSV blob)
- **Method:** GET (returns blob)
- **Backend status:** OK
- **Proposed hook:** `useExportAuditLogs()` new — return blob, no cache
- **QueryKey:** mut (trigger download)
- **Invalidation:** N/A
- **Effort:** M
- **Blockers:** blob handling pattern

#### Entry #10 — `subscriptions/page.tsx:118`

- **Current:** `fetch("/api/backend/admin/billing/auto-renewals/process", {method: "POST"})`
- **Method:** POST
- **Backend status:** OK
- **Proposed hook:** extend `useSubscriptionMutations.processAutoRenewals`
- **QueryKey:** mut
- **Invalidation:** `["admin", "subscriptions"]`
- **Effort:** S

#### Entry #11 — `subscriptions/page.tsx:237`

- **Current:** `fetch("/api/backend/admin/billing/export")` (CSV blob)
- **Method:** GET
- **Backend status:** OK
- **Proposed hook:** `useExportBilling()` new
- **QueryKey:** mut
- **Invalidation:** N/A
- **Effort:** M

### 8.2 B2 — Components (18 entries)

#### Entry #12 — `accounts/AccountBillingPanel.tsx:63`

- **Current:** `fetch("/api/backend/admin/accounts/:id/grandfathering", {method: "PATCH"})`
- **Method:** PATCH
- **Proposed hook:** `useUpdateGrandfathering` new en `useAccountBilling`
- **QueryKey:** mut
- **Invalidation:** `["account-billing", accountId]`
- **Effort:** S

#### Entry #13 — `maintenance/ScheduledJobsPanel.tsx:101`

- **Current:** `fetch("/api/backend/admin/audit/logs?jobName=:name")` (per-job)
- **Method:** GET
- **Proposed hook:** `useAuditLogs` (existe pero ORPHAN L-317) — wire
- **QueryKey:** `["audit", "logs", {jobName}]`
- **Effort:** S (unblock ORPHAN)

#### Entry #14 — `maintenance/ScheduledJobsPanel.tsx:149`

- **Current:** `fetch("/api/backend/admin/billing/auto-renewals/process", {method: "POST"})`
- **Method:** POST
- **Proposed hook:** dedupe con entry #10
- **Effort:** 0 (mismo hook)

#### Entry #15 — `security/RbacManager.tsx:138`

- **Current:** `fetch("/api/backend/admin/users/:id/activate" | ".../deactivate", {method: "POST"})`
- **Method:** POST
- **Proposed hook:** `useToggleUserStatus` extend `useAdminUsers`
- **QueryKey:** mut
- **Invalidation:** `["admin", "users"]`
- **Effort:** S

#### Entry #16 — `subscriptions/ChangePlanDialog.tsx:134`

- **Current:** `fetch("/api/backend/admin/pricing/tiers")`
- **Method:** GET
- **Proposed hook:** reuse `usePricingTiers()` hook (ya existe)
- **QueryKey:** `["pricing", "tiers"]`
- **Effort:** XS (replace with hook call)

#### Entry #17 — `subscriptions/ChangePlanDialog.tsx:198`

- **Current:** `fetch("/api/backend/admin/billing/accounts/:id/subscription", {method: "PUT"})`
- **Method:** PUT
- **Proposed hook:** `useChangePlan` en `useSubscriptionMutations`
- **QueryKey:** mut
- **Invalidation:** `["account-billing", accountId]`
- **Effort:** S

#### Entry #18 — `webhooks/WebhookEventsList.tsx:86`

- **Current:** `fetch("/api/backend/admin/webhooks/events?:params")`
- **Method:** GET
- **Proposed hook:** `useWebhookEvents(filters)` new en `useWebhooks`
- **QueryKey:** `["webhooks", "events", filters]`
- **Effort:** S

#### Entry #19 — `webhooks/WebhookEventsList.tsx:111`

- **Current:** `fetch("/api/backend/admin/webhooks/events/:id")`
- **Method:** GET
- **Proposed hook:** `useWebhookEventDetails(id)` new
- **QueryKey:** `["webhooks", "events", id]`
- **Effort:** S

#### Entry #20 — `webhooks/WebhookEventsList.tsx:186`

- **Current:** `fetch("/api/backend/admin/webhooks/events/export")`
- **Method:** GET (blob)
- **Proposed hook:** `useExportWebhookEvents()` new
- **Effort:** M

#### Entry #21 — `webhooks/DeadLetterQueue.tsx:112`

- **Current:** `fetch("/api/backend/admin/webhooks/dlq?:params")`
- **Method:** GET
- **Proposed hook:** `useDlq()` new
- **QueryKey:** `["webhooks", "dlq"]`
- **Effort:** S

#### Entry #22 — `webhooks/DeadLetterQueue.tsx:137`

- **Current:** `fetch("/api/backend/admin/webhooks/dlq/:eventId/retry", {method: "POST"})`
- **Method:** POST
- **Proposed hook:** `useRetryDlqEvent` new
- **QueryKey:** mut
- **Invalidation:** `["webhooks", "dlq"]`
- **Effort:** S

#### Entry #23 — `webhooks/DeadLetterQueue.tsx:157`

- **Current:** `fetch("/api/backend/admin/webhooks/dlq/retry-all", {method: "POST"})`
- **Method:** POST
- **Backend status:** **❌ NOT REGISTERED (L-299 CRITICAL)**
- **Proposed hook:** `useRetryAllDlq` new — **requiere implementar backend primero**
- **Effort:** L (backend + frontend)
- **Blockers:** endpoint no existe

#### Entry #24 — `webhooks/WebhookSubscriptions.tsx:130`

- **Current:** `fetch("/api/backend/admin/webhooks/subscriptions")`
- **Method:** GET
- **Proposed hook:** `useWebhookSubscriptions()` new
- **QueryKey:** `["webhooks", "subs"]`
- **Effort:** S

#### Entry #25 — `webhooks/WebhookSubscriptions.tsx:152`

- **Current:** `fetch("/api/backend/projects")` (admin→client URL questionable L-308)
- **Method:** GET
- **Proposed hook:** `useProjectsAdmin()` new OR clarify endpoint
- **Blockers:** L-308 clarification pending

#### Entry #26 — `webhooks/WebhookSubscriptions.tsx:172`

- **Current:** `fetch("/api/backend/admin/webhooks/subscriptions", {method: "POST"})`
- **Method:** POST
- **Proposed hook:** `useCreateSubscription` new
- **QueryKey:** mut
- **Invalidation:** `["webhooks", "subs"]`
- **Effort:** S

#### Entry #27 — `webhooks/WebhookSubscriptions.tsx:196`

- **Current:** `fetch("/api/backend/admin/webhooks/subscriptions/:id/toggle", {method: "PATCH"})`
- **Method:** PATCH
- **Proposed hook:** `useToggleSubscription` new
- **QueryKey:** mut
- **Invalidation:** `["webhooks", "subs"]`
- **Effort:** S

#### Entry #28 — `webhooks/WebhookSubscriptions.tsx:218`

- **Current:** `fetch("/api/backend/admin/webhooks/subscriptions/:id", {method: "DELETE"})`
- **Method:** DELETE
- **Proposed hook:** `useDeleteSubscription` new
- **QueryKey:** mut
- **Invalidation:** `["webhooks", "subs"]`
- **Effort:** S

#### Entry #29 — `webhooks/WebhookTimeline.tsx:53`

- **Current:** `new EventSource("/api/backend/admin/webhooks/dashboard/stream")`
- **Method:** SSE
- **Proposed hook:** `useWebhookStream()` new — EventSource wrapper (similar a cliente `useNotificationStream`)
- **Effort:** M
- **Blockers:** documentar patrón SSE (bypass proxy)

### 8.3 B3 — Hooks (62 entries)

Resumen por hook (archivo → count fetches):

#### Entries #30..#30 — `useAccountBilling` (1)

- L-... GET `/api/backend/admin/accounts/:id/billing` → apiClient.accountBilling.get (extend apiClient)
- Effort: S
- Backend: OK

#### Entries #31..#32 — `useAccountSessions` (2)

- GET `/api/backend/admin/accounts/:id/sessions` + DELETE `/admin/accounts/:id/sessions/:sid`
- Effort: S each

#### Entries #33..#33 — `useAccounts.M` (1 mutation aislada)

- POST create (dup entry #5) — dedupe

#### Entries #34..#38 — `useAdminUsers` (5)

- GET list, GET :id, POST create, PATCH :id, DELETE :id — todos sin credentials en hooks
- Effort: S each + add credentials

#### Entries #39..#39 — `useAdminPasswordReset` (1, L-330)

- POST `/admin/auth/password/reset`
- Effort: S + add onError (L-330 critical fix)

#### Entries #40..#42 — `useAnalytics` (3)

- GET overview + trends + performance — includes fake-data (L-325)
- Effort: M (remove fake-AI + real data)

#### Entries #43..#43 — `useAuditStats` (1)

- GET `/admin/audit/stats` — **api.audit.getStats existe pero no se usa** (L-332 inconsistency)
- Effort: XS (replace fetch with apiClient)

#### Entries #44..#44 — `useBillingStats` (1, L-326)

- GET `/admin/billing/stats` — includes `grandfatheredRevenue: 0` hardcoded
- Effort: S (fix hardcoded)

#### Entries #45..#45 — `useChangePassword` (1)

- POST `/auth/change-password`
- Effort: S

#### Entries #46..#60 — `useCompliance` (15 total, L-329 for 3 sin credentials)

- Breaches: list + :id + create + update + resolve (5)
- DSARs: list + :id + create + update (4)
- Consents: list + log + delete (3)
- Settings: get + update (2)
- GdprSettings: get + update (1)
- Total 15 fetches — **L101-103 3 fetches sin credentials (security)**
- Effort: L (mega-aggregator, split L-310)

#### Entries #61..#61 — `useContentLibrary` (1, ORPHAN L-319)

- GET `/admin/content/library` — no consumer
- Effort: N/A (wire consumer first)

#### Entries #62..#66 — `useGatewaySwitches` (5 via fetchJson helper)

- GET list, POST initiate, POST :id/cancel, POST :id/complete, GET :id
- fetchJson internal helper (wrapper local)
- Effort: M (refactor helper → apiClient namespace)

#### Entries #67..#71 — `useMultiPlatformScheduling` (5, ORPHAN L-320)

- All 5 fetches en hook orphan
- Effort: N/A pending validation

#### Entries #72..#72 — `usePerformanceInsights` (1, ORPHAN L-321)

- GET `/admin/analytics/performance-insights` — no consumer
- Effort: N/A

#### Entries #73..#73 — `usePosts` (0 raw, usa apiClient) ORPHAN L-322

- ACTIVE en apiClient pattern pero hook sin consumer
- Effort: N/A (reuse apiClient.posts.list when needed)

#### Entries #74..#81 — `usePricingTiers` (8)

- Account tiers: list + :id + create + update + delete (5)
- Provider tiers: list + :id + update (3)
- Effort: M (split L-311)

#### Entries #82..#82 — `usePublicSettings` (1, ORPHAN TOTAL L-323)

- GET `/settings/public` (replica entry #1)
- Wire consumer from reset-password page

#### Entries #83..#85 — `useQueueManagement` (3)

- GET queues status + POST pause + POST resume
- Effort: S each

#### Entries #86..#86 — `useResetAccountPassword` (1)

- POST `/admin/accounts/:id/reset-password`
- Effort: S + onError

#### Entries #87..#92 — `useSettings` (6 via settingsFetch helper)

- GET settings, PUT settings, GET features, PUT feature:id, GET integrations, PUT integrations
- settingsFetch helper local
- Effort: M (split L-313 + refactor helper)

#### Entries #93..#95 — `useSubscriptionMutations` (3)

- POST changePlan, POST processAutoRenewals, POST cancelSubscription
- Effort: S each

#### Entries #96..#96 — `useUniversalAnalytics` (1, ORPHAN L-324)

- GET `/admin/analytics/universal` — no consumer
- Effort: N/A

#### Entries #97..#97 — `useUsageMetrics` (1, L-328 sin credentials)

- GET `/admin/usage/metrics` — **sin credentials (security)**
- Effort: XS (add credentials)

#### Entries #98..#102 — `useWebhooks` (5)

- GET metrics, GET dashboard, (otros — current coverage limitado)
- GAPs: falta cobertura para subscriptions, events, dlq (handled en components via raw fetch L-294, L-295, L-327)
- Effort: L (expand hook to cover all webhook ops, unblock L-294+L-295)

### 8.4 B4 — Lib + Providers (restantes dentro del 102)

Incluidos en counts:

- `providers/AuthProvider.tsx:58` GET `/auth/permissions` — L-345, dedupe count
- `providers/ProjectProvider.tsx:103,115` (2, ORPHAN)
- `lib/apiClient.ts:20` http wrapper (legitimate, excluded)
- `lib/auth/backend-client.ts:91,149,188` (3 server-side legitimate, excluded)
- `components/queue/useQueueManager.tsx:128,129,178,191` (4 ORPHAN colocated)

### 8.5 Catalog summary tabla

| Category                                              | Count | Notes                                                                          |
| ----------------------------------------------------- | ----: | ------------------------------------------------------------------------------ |
| **Total fetches admin**                               |  ~102 | Entries totales inline §8.1-§8.4                                               |
| Legitimate wrappers (apiClient http + backend-client) |     4 | excluidos de migration                                                         |
| ORPHAN (dead code — no migration yet)                 |    ~8 | ProjectProvider (2) + useQueueManager (4) + ai-content, notif, csv (0 fetches) |
| Live to migrate                                       |   ~90 | S:~60, M:~25, L:~5                                                             |

**Por dominio (live):**

| Dominio                              | Count | Severity                                    |
| ------------------------------------ | ----: | ------------------------------------------- |
| webhooks                             |    16 | critical (L-294, L-295, L-299 + GAPs L-327) |
| accounts                             |     7 | high (bulk + billing + sessions)            |
| compliance                           |    15 | high (L-329 security subset)                |
| pricing                              |     8 | medium                                      |
| settings                             |     6 | medium                                      |
| admin users / RBAC                   |     6 | medium                                      |
| billing / subscriptions              |     7 | medium                                      |
| analytics                            |     5 | high (L-325 fake-data)                      |
| gateway-switches                     |     5 | medium                                      |
| security / MFA                       |     5 | medium                                      |
| audit                                |     4 | medium (L-317, L-318 ORPHAN)                |
| queue                                |     7 | medium (3 hook + 4 colocated ORPHAN)        |
| announcements                        |     3 | medium (L-268)                              |
| misc (reset password, notifications) |    ~5 | low                                         |

**Priorización por dominio:**

1. **webhooks PRIMERO** — severidad + density (L-299 unimplemented backend, L-294/L-295 bypass, L-308 suspicious admin→client URL)
2. **compliance + accounts** — security L-328/L-329 + high volume
3. **analytics + pricing + billing** — L-325 fake-data + L-326 hardcoded revenue
4. **Resto** — tercero

---

## §9. Cross-ref con D0v4-4/5

### §9.1 Cross-app findings promoted

Findings que aparecen idénticos en admin (D0v4-6) y cliente (D0v4-4/5). Aplican a **ambos apps**.

| Admin finding | Cliente finding                                  | Categoría          | Descripción                                                                                           |
| ------------- | ------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------- |
| L-336         | L-70 + L-101                                     | QueryClient config | MISSING QueryCache/MutationCache global onError + retry:1 + staleTime 60s default + mutations not set |
| L-347         | apps/client/lib/logger.ts (unnumbered pre-audit) | Observability      | console-based logger viola CLAUDE.md — debe usar `@observability/logger` Pino                         |

**Nota cross-app:** estos findings requieren un fix unificado (monorepo-level) para no divergir más. Posibilidad: extraer `@packages/shared-frontend/queryClient` + `@packages/shared-frontend/logger`. Candidato natural para D0v4-7 (packages).

### §9.2 Admin-superior findings (inversión inesperada)

Casos donde admin tiene **mejor** arquitectura que cliente. Documentar para orientar D0v4-7 (no asumir admin como baseline a mejorar, en varios aspectos admin es la referencia).

| Métrica                     | admin                              | cliente                        | Nota                                      |
| --------------------------- | ---------------------------------- | ------------------------------ | ----------------------------------------- |
| `apiClient.ts` `any` count  | **0**                              | 13 (L-216..L-228)              | admin 100% tipado                         |
| Error class                 | **ApiError** custom con statusCode | plain Error                    | admin soporta status-aware error handling |
| credentials consistency     | **YES** (en wrapper http)          | mixed (algunos con, otros sin) | admin uniforme                            |
| providers/ dedicated folder | **YES** (`providers/*.tsx`)        | No (app/providers.tsx único)   | admin modular                             |
| apiClient namespace pattern | **YES** (api.accounts.list, etc.)  | flat methods                   | admin estructurado                        |

**Implicación:** D0v4-7 debería tomar admin apiClient como baseline + corregir LOC + cross-migrar al cliente (cliente se beneficia del pattern admin).

### §9.3 Admin-inferior findings

Casos donde admin es **peor** que cliente.

| Métrica                          | admin      | cliente                                                             | Nota                                                                                      |
| -------------------------------- | ---------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| LOC `apiClient.ts` / `client.ts` | 464 (peor) | 440                                                                 | admin +24 LOC pese a namespaces                                                           |
| Densidad ORPHAN files            | **~13-15** | ~5                                                                  | admin 2.5x más ORPHAN (ProjectProvider, useQueueManager, ai-content, notif, csv, 8 hooks) |
| Raw fetches totales              | ~102       | ~129 pero coverage: 62 dentro de hooks admin vs 97 en hooks cliente | admin similar escala con superficie menor = densidad mayor                                |
| Hooks ORPHAN count               | **8**      | 0                                                                   | admin tiene masa crítica de hooks sin consumer live                                       |

### §9.4 Admin-only findings

Patrones que existen **solo en admin** (no en cliente).

| Finding        | Descripción                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| L-335          | `ProjectProvider` real-pero-orphan (322 LOC) — cliente tiene stub fake-AI usado (L-100 D0v4-4)                           |
| L-338          | `useQueueManager` colocated hook (213 LOC) en `components/queue/` + 4 raw fetches — cliente no tiene queue UI            |
| L-340          | `notificationStore` Zustand ORPHAN con Phase 2/3 broken promise — cliente usa `useNotificationStream` real SSE           |
| L-339          | `ai-content-utils.ts` ORPHAN + 4 fake-AI generators en lib — cliente tiene fake-AI en ProjectProvider (distinto pattern) |
| L-341          | `schedulingCsvParser.ts` ORPHAN — cliente no tiene upload CSV scheduling                                                 |
| L-293          | `ScheduledJobsPanel` fake-persistence cron — cliente no tiene panel admin cron                                           |
| L-305          | `SidebarNav` document.cookie + reload manual — cliente no tiene                                                          |
| Sentry configs | admin tiene Sentry configs dedicated — cliente pattern diferente                                                         |
| i18n next-intl | admin drift composite L-296 — cliente drift pattern diferente                                                            |

### §9.5 Client-only findings (no existen en admin)

Patrones solo en cliente (D0v4-4/5) que admin no tiene.

| Cliente finding | Descripción                                        | Admin equivalencia                           |
| --------------- | -------------------------------------------------- | -------------------------------------------- |
| L-100           | ProjectProvider fake-AI stub **usado**             | L-335 admin ProjectProvider real pero ORPHAN |
| L-164           | `useContentLibraryState` 290 LOC colocated stub    | N/A (admin no tiene library state colocated) |
| L-86            | 3 `useProviders` paralelos (escalado a 4 en L-207) | N/A (admin no tiene useProviders)            |
| L-99            | `useABTests` / `useTemplates` URLs BROKEN          | N/A (admin no consume templates LEGACY)      |
| L-68            | Publishing subsystem DEAD_CODE ~2,711 LOC          | N/A (admin no tiene publishing)              |
| L-77            | `useContentLibraryState` stub                      | N/A                                          |

### §9.6 Resumen matriz cross-app

| Axis                     | Admin mejor | Cliente mejor |            Empate            | Solo admin  | Solo cliente |
| ------------------------ | :---------: | :-----------: | :--------------------------: | :---------: | :----------: |
| apiClient wrapper        |     ✅      |       —       |              —               |      —      |      —       |
| Error handling infra     |     ✅      |       —       |              —               |      —      |      —       |
| Providers modularity     |     ✅      |       —       |              —               |      —      |      —       |
| Orphan density           |      —      |      ✅       |              —               |      —      |      —       |
| Raw fetch absolute count |      —      |      ✅       |              —               |      —      |      —       |
| LEGACY broken URLs       |      —      |       —       |              —               |      —      |      ✅      |
| Fake-AI patterns         |      —      |       —       |              ✅              |      —      |      —       |
| QueryClient config       |      —      |       —       | ✅ (both broken identically) |      —      |      —       |
| Publishing subsystem     |      —      |       —       |              —               |      —      |      ✅      |
| Project concept          |      —      |       —       |              —               | ✅ (ORPHAN) |  ✅ (stub)   |

---

## §10. Deep-dive LEGACY — NO ejecutado (CP0 commitment confirmado)

Per Edward CP0: NO deep-dive LEGACY en admin (a diferencia de cliente D0v4-5 §4 donde 5 LEGACY URL-por-URL). Justificación confirmada con evidencia durante lectura directa de los 141 archivos:

| Check                                           | Resultado admin                                         |
| ----------------------------------------------- | ------------------------------------------------------- |
| `@deprecated` JSDoc tags                        | **0** hits en `apps/admin/**/*.ts`                      |
| Comentarios "LEGACY" / "legacy-working"         | **0** hits                                              |
| URLs con prefix `/api/v1/` (versiones antiguas) | **0** hits (todos `/api/backend/` o `/settings/public`) |
| Re-export chains paralelos                      | **0** detectados (no `lib/hooks/` paralela a `hooks/`)  |
| Hooks con comment "deprecated"                  | **0** hits                                              |

Admin no tiene la polución LEGACY del cliente (que tuvo migration `lib/hooks/` → `hooks/api/`). Admin fue construido directamente en pattern actual. **Commitment CP0 cumplido: zero tiempo gastado en deep-dive LEGACY redundante.**

---

## §11. Clasificaciones + Orphan cemetery individual

### 11.1 Classification tabla

| Classification                                  |   Count | Files notables                                                                                                                                                  |
| ----------------------------------------------- | ------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACTIVE (compliant, consumed)                    |     ~85 | Mayoría pages + components + hooks activos + providers usados + lib core                                                                                        |
| PARTIALLY_ACTIVE (R11 size + compliance issues) |     ~25 | webhooks 5, security 4, compliance 5, pricing 3, accounts (AccountBillingPanel), shared (SidebarNav), maintenance (ScheduledJobsPanel fake-persistence)         |
| DEAD_CODE_CANDIDATE (Edward validation needed)  | **~15** | Ver §11.2 orphan cemetery                                                                                                                                       |
| Auxiliares (wrappers, config, types, utils)     |     ~15 | `apiClient.ts`, `parseApiError.ts`, `logger.ts`, `ui-safelist.ts`, `backend-client.ts`, `common.ts`, providers.tsx, ThemeProvider, middleware (si ACTIVE), etc. |

### 11.2 Orphan cemetery (individual)

Per Edward CP4: cada ORPHAN listado individualmente (no composite único).

| #   | File                                   |  LOC | Category          | Finding                     |
| --- | -------------------------------------- | ---: | ----------------- | --------------------------- |
| 1   | `proxy.ts` root                        |   60 | dead-middleware   | L-267 + L-348 re-confirm    |
| 2   | `providers/ProjectProvider.tsx`        |  322 | dead-provider     | L-335 (+ L-346 raw fetches) |
| 3   | `components/queue/useQueueManager.tsx` |  213 | colocated-orphan  | L-338                       |
| 4   | `lib/ai-content-utils.ts`              |  178 | orphan + fake-AI  | L-339 + L-349               |
| 5   | `lib/parsers/schedulingCsvParser.ts`   |  178 | orphan-parser     | L-341                       |
| 6   | `lib/stores/notificationStore.ts`      |   80 | orphan-store      | L-340                       |
| 7   | `types/ai-content.ts`                  |  ~90 | orphan-types      | L-342                       |
| 8   | `types/scheduling.ts`                  | ~130 | orphan-types      | L-343                       |
| 9   | `hooks/useAuditLogs.ts`                |   62 | orphan-hook       | L-317                       |
| 10  | `hooks/useAuditStats.ts`               |   48 | orphan-hook       | L-318                       |
| 11  | `hooks/useContentLibrary.ts`           |  120 | orphan-hook       | L-319                       |
| 12  | `hooks/useMultiPlatformScheduling.ts`  |  159 | orphan-hook       | L-320                       |
| 13  | `hooks/usePerformanceInsights.ts`      |  108 | orphan-hook       | L-321                       |
| 14  | `hooks/usePosts.ts`                    |   82 | orphan-hook       | L-322                       |
| 15  | `hooks/usePublicSettings.ts`           |   65 | orphan-hook-total | L-323                       |
| 16  | `hooks/useUniversalAnalytics.ts`       |   72 | orphan-hook       | L-324                       |

**Total ORPHAN LOC: ~2,067 LOC** (≈ 7.6% del codebase admin auditado).

**Nota §5.9:** Edward **NO** autorizó delete. Todos permanecen. El reporte documenta evidencia para validación futura.

---

## §12. Duplicaciones detectadas

### 12.1 Cero duplicaciones directas

A diferencia del cliente (3 `useProviders` paralelos + 4 auth paths), admin **NO tiene hooks/files duplicados con mismo nombre + diferentes implementaciones**. Esto es una fortaleza.

### 12.2 Casos cercanos pero no duplicados

- `fetchJson` helper en `useGatewaySwitches` + `settingsFetch` helper en `useSettings` — 2 helpers locales distintos pero con función similar. Podrían consolidarse en `apiClient.raw.json()` utility. No bloqueante.
- `console.log` wrapper en `lib/logger.ts` vs ausencia de `@observability/logger` uso — no es duplicación, es ausencia de canon.

---

## §13. Plan consolidación raw fetch → hooks

### 13.1 Effort buckets

| Bucket                                                | Count |                       Estimate |
| ----------------------------------------------------- | ----: | -----------------------------: |
| S (small, <2h)                                        |   ~60 |                           120h |
| M (medium, 2-4h)                                      |   ~25 |                            75h |
| L (large, 4-8h + backend dependency)                  |    ~5 |                            30h |
| ORPHAN-wire-consumer (unblock hooks orphanados antes) |     8 |                            24h |
| Apidocs extension apiClient namespace coverage        |     — |                            20h |
| R11 split 8 hooks                                     |     — |                            48h |
| Fix QueryClient L-336 (shared with cliente)           |     — |                             6h |
| Fix credentials missing L-328, L-329                  |     — |                             4h |
| Fix fake-data L-325 (6 fields) + L-326                |     — |                            12h |
| Fix silent failures L-330, L-331                      |     — |                             4h |
| Implement backend /dlq/retry-all L-299                |     — |                   8h (backend) |
| **Total migration admin**                             |     — | **~351h (~8-9 semanas 1 dev)** |

### 13.2 Priorización por dominio

| Fase | Dominio                             | Justificación                                             | Effort   |
| ---- | ----------------------------------- | --------------------------------------------------------- | -------- |
| 1a   | QueryClient fix (cross-app)         | L-336 unblocks toda error propagation                     | 6h       |
| 1b   | webhooks (16 fetches)               | L-299 critical (unimplemented backend) + L-294/295 bypass | ~60h     |
| 1c   | Security + compliance credentials   | L-328 + L-329 security                                    | 4h       |
| 2a   | accounts + billing (14 fetches)     | Core admin ops                                            | ~40h     |
| 2b   | compliance + analytics              | L-325 fake-data critical + L-329 subset                   | ~45h     |
| 2c   | pricing + subscriptions + users     | Medium severity                                           | ~40h     |
| 3a   | ORPHAN decisions (Edward)           | Delete vs wire (§5.9 validation)                          | variable |
| 3b   | Gateway-switches + settings + queue | Medium                                                    | ~30h     |
| 3c   | R11 splits + @layer fix             | Mantenibilidad + docs                                     | ~50h     |

---

## §14. Hallazgos laterales L-267..L-349 (83 findings nuevos)

Lista consolidada con descripción + severidad + categoría + archivo.

### §14.1 B1 — Pages (L-267..L-273, 7 findings)

| #     | Título                                       | Sev      | Categoría                | File                                     |
| ----- | -------------------------------------------- | -------- | ------------------------ | ---------------------------------------- |
| L-267 | proxy.ts dead middleware (wrong filename)    | critical | dead-code/infrastructure | `apps/admin/proxy.ts`                    |
| L-268 | announcements triple violation (composite)   | medium   | composite                | `app/(dashboard)/announcements/page.tsx` |
| L-269 | admin metadata gap 0/17 dashboard pages      | low      | SEO/UX                   | composite across pages                   |
| L-270 | loading.tsx index-as-key                     | low      | React antipattern        | `app/loading.tsx`                        |
| L-271 | error.tsx exposes `error.message` (security) | security | security                 | `app/error.tsx`                          |
| L-272 | proxy route buffers full body (no streaming) | low      | performance              | `app/api/backend/[...path]/route.ts`     |
| L-273 | dashboard layout 2-hop redirect chain        | low      | performance/UX           | `app/(dashboard)/layout.tsx`             |

### §14.2 B2 — Components (L-274..L-309, 36 findings)

**R11 size violations (L-274..L-292, 19 individuales):**

| #     | File                                  | LOC | Limit |
| ----- | ------------------------------------- | --: | ----: |
| L-274 | `webhooks/DeadLetterQueue.tsx`        | 732 |   200 |
| L-275 | `webhooks/WebhookSubscriptions.tsx`   | 689 |   200 |
| L-276 | `webhooks/WebhookEventsList.tsx`      | 505 |   200 |
| L-277 | `subscriptions/ChangePlanDialog.tsx`  | 488 |   200 |
| L-278 | `security/RbacManager.tsx`            | 481 |   200 |
| L-279 | `shared/SidebarNav.tsx`               | 446 |   200 |
| L-280 | `accounts/AccountBillingPanel.tsx`    | 383 |   200 |
| L-281 | `pricing/ProviderTiersTab.tsx`        | 365 |   200 |
| L-282 | `pricing/AccountTiersTab.tsx`         | 355 |   200 |
| L-283 | `compliance/BreachTable.tsx`          | 354 |   200 |
| L-284 | `maintenance/ScheduledJobsPanel.tsx`  | 350 |   200 |
| L-285 | `compliance/DsarTable.tsx`            | 340 |   200 |
| L-286 | `security/MfaSelfService.tsx`         | 331 |   200 |
| L-287 | `compliance/GdprSettingsForm.tsx`     | 323 |   200 |
| L-288 | `webhooks/WebhookMetrics.tsx`         | 319 |   200 |
| L-289 | `security/MfaManager.tsx`             | 307 |   200 |
| L-290 | `webhooks/WebhookTimeline.tsx`        | 267 |   200 |
| L-291 | `compliance/SecuritySettingsForm.tsx` | 252 |   200 |
| L-292 | `security/PermissionGrid.tsx`         | 215 |   200 |

**Resto B2 (L-293..L-309):**

| #     | Título                                                            | Sev      | Categoría        | File                                    |
| ----- | ----------------------------------------------------------------- | -------- | ---------------- | --------------------------------------- |
| L-293 | `ScheduledJobsPanel` fake-persistence cron (new category)         | critical | fake-persistence | `maintenance/ScheduledJobsPanel.tsx`    |
| L-294 | `WebhookEventsList` TanStack bypass (useState + raw fetch)        | critical | tanstack-bypass  | `webhooks/WebhookEventsList.tsx`        |
| L-295 | `WebhookSubscriptions` TanStack bypass (5 raw fetches)            | critical | tanstack-bypass  | `webhooks/WebhookSubscriptions.tsx`     |
| L-296 | i18n drift composite 17 components                                | critical | i18n             | composite                               |
| L-297 | default export violation (MfaManager + RbacManager)               | medium   | export-style     | 2 components composite                  |
| L-298 | `@layer` mismapping composite (grows B2+B3+B4 = ~40 files)        | medium   | docs-layer       | composite                               |
| L-299 | unimplemented `retry-all` backend endpoint (DeadLetterQueue)      | critical | backend-gap      | `webhooks/DeadLetterQueue.tsx:157`      |
| L-300 | missing `@component` JSDoc `shared/ErrorBoundary`                 | medium   | docs-jsdoc       | `shared/ErrorBoundary.tsx`              |
| L-301 | missing `@component` JSDoc `shared/SkipLink`                      | medium   | docs-jsdoc       | `shared/SkipLink.tsx`                   |
| L-302 | missing `@component` JSDoc `shared/VisuallyHidden`                | medium   | docs-jsdoc       | `shared/VisuallyHidden.tsx`             |
| L-303 | `ErrorBoundary` `console.error` (CLAUDE.md violation)             | medium   | observability    | `shared/ErrorBoundary.tsx`              |
| L-304 | `ErrorBoundary` raw `error.message` security leak (replica L-271) | security | security         | `shared/ErrorBoundary.tsx`              |
| L-305 | `SidebarNav` `document.cookie` + `window.location.reload` directo | medium   | anti-pattern     | `shared/SidebarNav.tsx`                 |
| L-306 | silent catch composite (6 components)                             | medium   | error-handling   | 6 components                            |
| L-307 | missing `htmlFor` composite (6 components)                        | medium   | a11y             | 6 components                            |
| L-308 | admin→client URL questionable `/projects` (WebhookSubscriptions)  | low      | architectural    | `webhooks/WebhookSubscriptions.tsx:152` |
| L-309 | unused imports composite (4 files)                                | low      | hygiene          | 4 files                                 |

### §14.3 B3 — Hooks (L-310..L-334, 25 findings)

| #     | Título                                                                     | Sev      | Categoría               | File                                  |
| ----- | -------------------------------------------------------------------------- | -------- | ----------------------- | ------------------------------------- |
| L-310 | `useCompliance.ts` 635 LOC mega-aggregator (R11)                           | critical | R11                     | `hooks/useCompliance.ts`              |
| L-311 | `usePricingTiers.ts` 305 LOC (R11)                                         | high     | R11                     | `hooks/usePricingTiers.ts`            |
| L-312 | `useGatewaySwitches.ts` 216 LOC (R11)                                      | medium   | R11                     | `hooks/useGatewaySwitches.ts`         |
| L-313 | `useSettings.ts` 179 LOC (R11)                                             | medium   | R11                     | `hooks/useSettings.ts`                |
| L-314 | `useAdminUsers.ts` 172 LOC (R11)                                           | medium   | R11                     | `hooks/useAdminUsers.ts`              |
| L-315 | `useAnalytics.ts` 166 LOC (R11)                                            | medium   | R11                     | `hooks/useAnalytics.ts`               |
| L-316 | `useMultiPlatformScheduling.ts` 159 LOC (R11)                              | low      | R11                     | `hooks/useMultiPlatformScheduling.ts` |
| L-317 | `useAuditLogs` ORPHAN                                                      | high     | dead-code               | `hooks/useAuditLogs.ts`               |
| L-318 | `useAuditStats` ORPHAN                                                     | high     | dead-code               | `hooks/useAuditStats.ts`              |
| L-319 | `useContentLibrary` ORPHAN                                                 | high     | dead-code               | `hooks/useContentLibrary.ts`          |
| L-320 | `useMultiPlatformScheduling` ORPHAN                                        | high     | dead-code               | `hooks/useMultiPlatformScheduling.ts` |
| L-321 | `usePerformanceInsights` ORPHAN                                            | high     | dead-code               | `hooks/usePerformanceInsights.ts`     |
| L-322 | `usePosts` ORPHAN                                                          | high     | dead-code               | `hooks/usePosts.ts`                   |
| L-323 | `usePublicSettings` ORPHAN TOTAL                                           | high     | dead-code               | `hooks/usePublicSettings.ts`          |
| L-324 | `useUniversalAnalytics` ORPHAN                                             | high     | dead-code               | `hooks/useUniversalAnalytics.ts`      |
| L-325 | `useAnalytics` fake-data composite (6 fake fields)                         | critical | fake-data               | `hooks/useAnalytics.ts`               |
| L-326 | `useBillingStats` `grandfatheredRevenue:0` hardcoded                       | high     | fake-data               | `hooks/useBillingStats.ts`            |
| L-327 | `useWebhooks` GAPs (missing hooks — root cause L-294/L-295)                | high     | missing-hooks           | `hooks/useWebhooks.ts`                |
| L-328 | `useUsageMetrics` fetch sin `credentials: "include"` (security)            | security | security                | `hooks/useUsageMetrics.ts`            |
| L-329 | `useCompliance` L101-103 3 fetches sin credentials (security)              | security | security                | `hooks/useCompliance.ts:L101-103`     |
| L-330 | `useAdminPasswordReset` totalmente silencioso (no error handling)          | high     | silent-feedback         | `hooks/useAdminPasswordReset.ts`      |
| L-331 | `useAnalytics.fetchJSON` error silencing (try/catch → `{}`)                | high     | silent-feedback         | `hooks/useAnalytics.ts`               |
| L-332 | `apiClient` vs raw fetch inconsistency `useAccounts` Q/M + `useAuditStats` | medium   | apiclient-inconsistency | 2 hooks                               |
| L-333 | `usePosts` weak typing `unknown[]`/`unknown`                               | low      | weak-typing             | `hooks/usePosts.ts`                   |
| L-334 | `useSecurity` queries serializadas (podrían paralelas)                     | low      | performance             | `hooks/useSecurity.ts`                |

### §14.4 B4 — Providers + Lib + Types + Colocated (L-335..L-349, 15 findings)

| #     | Título                                                                                     | Sev      | Categoría                   | File                                    |
| ----- | ------------------------------------------------------------------------------------------ | -------- | --------------------------- | --------------------------------------- |
| L-335 | `ProjectProvider` 322 LOC ORPHAN completo                                                  | critical | dead-code                   | `providers/ProjectProvider.tsx`         |
| L-336 | `QueryProvider` replica L-70+L-101 cliente (cross-app promoted §9.1)                       | critical | cross-app-config            | `providers/QueryProvider.tsx`           |
| L-337 | `apiClient.ts` 464 LOC R11 + namespace coverage inconsistency                              | critical | R11 + architectural         | `lib/apiClient.ts`                      |
| L-338 | `useQueueManager` 213 LOC ORPHAN + 4 raw fetches + no onError                              | critical | dead-code + R11 + raw-fetch | `components/queue/useQueueManager.tsx`  |
| L-339 | `ai-content-utils.ts` 178 LOC ORPHAN + 4 fake-AI generators                                | critical | dead-code + fake-data       | `lib/ai-content-utils.ts`               |
| L-340 | `notificationStore` 80 LOC ORPHAN + Phase 2/3 broken promise                               | critical | dead-code                   | `lib/stores/notificationStore.ts`       |
| L-341 | `schedulingCsvParser` 178 LOC ORPHAN                                                       | critical | dead-code                   | `lib/parsers/schedulingCsvParser.ts`    |
| L-342 | `types/ai-content.ts` ORPHAN                                                               | medium   | dead-code                   | `types/ai-content.ts`                   |
| L-343 | `types/scheduling.ts` ORPHAN                                                               | medium   | dead-code                   | `types/scheduling.ts`                   |
| L-344 | `parseApiError.ts` `@layer presentation` mismapping (extend L-298)                         | medium   | docs-layer                  | `lib/parseApiError.ts`                  |
| L-345 | `AuthProvider` raw fetch `/auth/permissions` + dual envelope + silent fallback SUPER_ADMIN | medium   | raw-fetch + security        | `providers/AuthProvider.tsx`            |
| L-346 | `ProjectProvider` 2 raw fetches dead (en código ORPHAN L-335)                              | medium   | raw-fetch (dead)            | `providers/ProjectProvider.tsx:103,115` |
| L-347 | `lib/logger.ts` console-based viola CLAUDE.md (cross-app con cliente §9.1)                 | medium   | observability               | `lib/logger.ts`                         |
| L-348 | `proxy.ts` re-confirmed ORPHAN (extend L-267)                                              | low      | dead-code                   | `apps/admin/proxy.ts`                   |
| L-349 | `ai-content-utils` emoji truncation bug (en ORPHAN código)                                 | low      | fake-data-bug               | `lib/ai-content-utils.ts`               |

### §14.5 Composites extensiones (no numeran nuevos)

- **L-260** (D0v4-5 composite per-mutation onError): admin B3 añade 31 mutations sin onError → total cross-app ~87 mutations
- **L-298** (B2 @layer composite): admin B2 + B3 + B4 añaden ~40 archivos → composite cross-apps

---

## §15. Predicción Sprint D0v4-7 (packages compartidos frontend)

### 15.1 Scope esperado

`packages/shared-frontend/*`, `packages/ui/*`, `packages/observability/*` (parte frontend), `packages/api-common/*` (client-facing), etc.

### 15.2 Hallazgos esperables basados en D0v4-6

1. **QueryClient compartido** — candidate natural para `packages/shared-frontend/queryClient` dado L-336 cross-app (admin + cliente replican exactamente el mismo problema). Sprint D0v4-7 debería proponer esta extracción.

2. **Logger compartido** — L-347 cross-app. Ambos apps tienen `lib/logger.ts` console-based. `@observability/logger` existe en backend Pino pero frontend no lo usa. Posible extensión `@observability/browser-logger` a extraer.

3. **ApiClient pattern** — admin apiClient (L-337 superior §9.2) debería ser baseline. Posible `packages/shared-frontend/apiClient` genérico + namespaces específicos por app.

4. **ApiError class** — admin `parseApiError.ts` (L-344) tiene clase canónica. Extraíble a `packages/shared-frontend/errors`.

5. **Shadcn/UI wrappers** — `packages/ui/*` probablemente tiene `ConfirmDialog`, `InputDialog`, etc. admin duplica algunos (`ui/ConfirmDialog.tsx`). Deduplicación esperada.

6. **Tipos compartidos** — `types/common.ts` admin + `types/common.ts` cliente posible overlap. Extracción a `@shared/types` frontend.

### 15.3 Findings esperables count

- **~40-60 nuevos L-XXX** (menor que D0v4-6 por menor superficie absoluta — packages son librerías, no apps completas)
- Énfasis en deduplicación + re-export hygiene + API surface cleanup

### 15.4 Dependencias input desde D0v4-6

- §9.1 cross-app findings → lista directa de candidatos a extraer
- §9.2 admin-superior findings → templates a usar como baseline en packages
- §11.2 orphan cemetery → verificar que nada del orphan sea importado desde packages

---

## Verification checklist

- [x] 141 archivos procesados (app 30 + components 62 + hooks 29 + providers 4 + lib 9 + types 3 + colocated 1 + extras 3)
- [x] §3 B1 pages audit con classification matrix + 6 findings críticos + 11 raw fetch entries
- [x] §4 B2 components audit con 19 R11 individuales + 14 findings + 18 raw fetch entries (incl EventSource)
- [x] §5 B3 hooks audit con TanStack v5 matrix 29 hooks + 25 findings + 62 raw fetch entries + apiClient inconsistency map
- [x] §6 B4 providers audit con QueryProvider deep-dive línea-por-línea
- [x] §7 B4 lib audit con apiClient 464 LOC deep-dive + comparison vs cliente
- [x] §8 Raw fetch migration catalog inline 102 entries totales
- [x] §9 Cross-ref D0v4-4/5 con 6 sub-sections (§9.1 cross-app, §9.2 admin-superior, §9.3 admin-inferior, §9.4 admin-only, §9.5 client-only, §9.6 matrix resumen)
- [x] §10 Deep-dive LEGACY NO ejecutado confirmado con evidencia (0 @deprecated, 0 LEGACY comments, 0 /api/v1, 0 re-export chains paralelos)
- [x] §11 Clasificaciones + orphan cemetery individual (13-15 archivos)
- [x] §12 Duplicaciones (cero duplicaciones directas detectadas — fortaleza admin)
- [x] §13 Plan consolidación raw fetch → hooks con effort buckets (~351h total)
- [x] §14 Hallazgos laterales L-267..L-349 (83 findings nuevos) listados con severidad + categoría + archivo
- [x] §15 Predicción D0v4-7 packages compartidos frontend
- [x] CP0 + CP1 + CP2 + CP3 + CP4 aprobados Edward
- [x] Zero cambios en `apps/`, `packages/`, `infra/` (solo docs)

---

Sprint D0v4-6 cerrado 2026-04-20. Ready para D0v4-7 (packages shared frontend).
