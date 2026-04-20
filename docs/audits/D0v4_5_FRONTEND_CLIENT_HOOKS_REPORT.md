# D0v4-5 — Frontend Client: Hooks Consolidation Audit Report

> **Sprint:** D0v4-5 (apps/client/ hooks — 4 carpetas paralelas + colocated + QueryClient + raw fetch catalog)
> **Ejecutado:** 2026-04-20
> **Metodología:** §5.8 lectura directa + §5.9 + CP1 + TanStack v5 compliance audit R1-R13 + deep-dive LEGACY URL-por-URL
> **Ejecutor:** `react-frontend-specialist` con Opus 4.7 (1M context)
> **Cambios en código:** 0 (100% lectura + docs)

---

## §1. Metodología aplicada

### 1.1 §5.8 lectura directa

57 archivos leídos línea 1→N sin skip en CP0-B1-B2-B3 + grep targeted para volumen. Spot-check cross-count cada 15 hooks.

### 1.2 §5.9 + CP1

Zero DEAD_CODE declarado sin validación Edward. Todo "no wired" → LATERAL_FINDINGS con research intent.

### 1.3 TanStack v5 compliance audit (R1-R13)

13 reglas evaluadas por hook:

| #   | Regla                                                | Detection               |
| --- | ---------------------------------------------------- | ----------------------- |
| R1  | QueryKey `[domain, scope, ...params]`                | Manual inspection       |
| R2  | `gcTime` (v5) en lugar de `cacheTime` (v4)           | Grep `cacheTime`        |
| R3  | `onSuccess` NO en `useQuery`                         | Manual + multiline grep |
| R4  | `onError` NO en `useQuery`                           | Same                    |
| R5  | `useMutation` con `onSuccess` + `onError`            | Manual                  |
| R6  | `useQueries` shape v5                                | Grep                    |
| R7  | `useSuspenseQuery` vs `suspense: true`               | Grep                    |
| R8  | `staleTime` explícito                                | Manual                  |
| R9  | `enabled` para dependent                             | Manual                  |
| R10 | Zero `any`                                           | Grep `: any\b`          |
| R11 | Hook ≤150 LOC / Utility ≤200 LOC                     | `wc -l`                 |
| R12 | Naming `useXxx` + PascalCase                         | Manual                  |
| R13 | No raw `fetch()` inside hook — strict per Edward CP3 | Grep `fetch(`           |

### 1.4 Deep-dive LEGACY obligatorio (CP0)

5 hooks LEGACY con tabla URL-por-URL verificada contra backend `templateRoutes.ts` + `providerRoutes.ts`.

### 1.5 Checkpoints ejecutados

| CP         | Batch                                                    | Aprobado      | Decisiones                                                                                                                                            |
| ---------- | -------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CP0**    | Setup + 5 deep-dive LEGACY                               | ✅ 2026-04-20 | L-XX useAutoSave stub crítico; CLIENT_LIB_HOOKS_AUDIT histórico mantenido; 2 `any` LEGACY individuales                                                |
| **CP1**    | B1: `hooks/api/` (31) + `hooks/` (3)                     | ✅ 2026-04-20 | R11 12 individual; R13 path inconsistency 3 individual; mutations sin onError compuesto L-70; useInbox bug crítico; estimatedEngagement 75 nuevo L-XX |
| **CP2**    | B2: `lib/hooks/` (5) + `lib/api/` (6) + `authApi.ts` (1) | ✅ 2026-04-20 | 13 client.ts `any` individual; 4 paths useProviders nuevo; 3 paths auth nuevo; naming conflict individual; providers.ts filename individual           |
| **CP3**    | B3: 9 hooks colocated components/\*                      | ✅ 2026-04-20 | R13 strict; composite L-99 nuevo                                                                                                                      |
| **Cierre** | QueryClient + raw fetch catalog + síntesis               | ✅ 2026-04-20 | Volume ~60 OK; catalog inline; R13 agrupado; report 1200-1500 LOC                                                                                     |

---

## §2. Inventario completo

### 2.1 Conteos totales

| Capa                                                                 |  Files |        LOC |
| -------------------------------------------------------------------- | -----: | ---------: |
| `apps/client/hooks/api/**` canónico                                  |     31 |     ~3,800 |
| `apps/client/hooks/**` no-api                                        |      3 |       ~312 |
| `apps/client/lib/hooks/**` LEGACY                                    |      5 |       ~871 |
| `apps/client/lib/api/**` (wrapper + helpers + types)                 |      6 |       ~924 |
| `apps/client/components/*/use*.ts` (9) + `components/*/hooks/**` (0) |      9 |     ~2,328 |
| `apps/client/lib/auth/authApi.ts` (auth wrapper)                     |      1 |        258 |
| `apps/client/app/providers.tsx` (QueryClient config)                 |      1 |         40 |
| **TOTAL**                                                            | **56** | **~8,533** |

### 2.2 `hooks/api/` canónico (31 hooks)

```
useAIContentGeneration, useAIImages, useAIPromptTemplates, useAiSettings,
useAnalytics, useApprovals, useAssets, useBilling, useBrandVoice,
useCampaigns, useChannels, useComments, useContentCalendar,
useContentLibrary, useCrm, useExternalNotifications, useInbox,
useMultiPlatformScheduling, useOnboarding, usePerformanceInsights,
usePlatformVariants, usePrivacy, useRecurringPosts, useReports,
useScheduledPosts, useSso, useTasks, useTeam, useUniversalAnalytics,
useUsage, useUsageMetrics
```

### 2.3 `hooks/` no-api (3 hooks)

- `useNotificationStream.ts` (87 LOC) — SSE EventSource wrapper (bypass proxy intentionally)
- `useFocusTrap.ts` (63 LOC) — pure React hook, WCAG 2.4.3
- `useAIContentGenerator.ts` (163 LOC) — composite hook

### 2.4 `lib/hooks/` LEGACY (5 hooks)

- `useABTests.ts` (230 LOC) — 3/8 URLs BROKEN
- `useTemplates.ts` (172 LOC) — 3/5 URLs BROKEN
- `useTemplateVersions.ts` (137 LOC) — 1/4 URLs BROKEN
- `useProviders.ts` (125 LOC) — LEGACY variant (1 de 4 paths)
- `useAutoSave.ts` (207 LOC) — LEGACY_WORKING_STUB (simulated save)

### 2.5 `lib/api/` (6 files)

- `client.ts` (440 LOC) — `ApiClient` singleton wrapper (R11 violation + 13 `any`)
- `hooks.ts` (173 LOC) — wrapper hooks + LEGACY re-export
- `context.tsx` (55 LOC) — `ApiProvider` + `useApi` context
- `index.ts` (35 LOC) — barrel con naming conflict
- `providers.ts` (55 LOC) — **solo types** (misleading filename)
- `types.ts` (212 LOC) — canonical types + ApiError class (R11 viol + 3 `any`)

### 2.6 Colocated hooks `components/*/use*.ts` (9)

| #   | Archivo                                                      | LOC | Tipo                             |
| --- | ------------------------------------------------------------ | --: | -------------------------------- |
| 1   | `components/templates/useABTestManager.ts`                   | 273 | State mgmt                       |
| 2   | `components/templates/useTemplateVersionControl.ts`          | 281 | State mgmt                       |
| 3   | `components/content/library/useContentLibraryState.ts`       | 290 | State mgmt (L-77 stub)           |
| 4   | `components/content/templates/useTemplateData.ts`            | 127 | Data fetching (1 fetch)          |
| 5   | `components/scheduling/useSchedulingDashboard.ts`            | 318 | Data + state                     |
| 6   | `components/ai/analytics/hooks/usePredictiveData.ts`         | 629 | Data fetching (4 fetches, L-140) |
| 7   | `components/instagram/stories/hooks/useFileUpload.ts`        | 135 | Upload mgmt                      |
| 8   | `components/instagram/stories/hooks/useKeyboardShortcuts.ts` |  49 | Event listeners                  |
| 9   | `components/instagram/stories/hooks/useStoryManagement.ts`   |  91 | State mgmt                       |

---

## §3. Hooks únicos vs duplicados

### 3.1 Resumen

| Métrica                                      |                                                            Valor |
| -------------------------------------------- | ---------------------------------------------------------------: |
| Hooks únicos (dedup por propósito)           |                                                              50+ |
| Grupos duplicados confirmados                |                                       1 (`useProviders` 4 paths) |
| Re-exports (misma implementación vía barrel) | 2 (`useProviders` x2, `useApiProviders` → `useProviders` rename) |

### 3.2 `useProviders` — 4 paths paralelos

| #   | Import path                                                  | Underlying impl                             | Return shape                                                                           | Consumers                                                                       |
| --- | ------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | `@/hooks/api/useChannels.useProviders`                       | `fetch("/api/providers")` directo           | `Provider[]` simple                                                                    | 1 (channels page)                                                               |
| 2   | `@/lib/hooks/useProviders.useProviders`                      | LEGACY — fetch + `providerRegistry` helpers | `{providers, providerConfigs, validateContent, getOptimalTimes, supportsFeature, ...}` | 4 (posts/[id]/preview, ClientContentEditor, PublishDialog, PublishingInterface) |
| 3   | `@/lib/api/hooks.useProviders` (re-export de #2)             | Same as #2                                  | Same                                                                                   | 0 direct                                                                        |
| 4   | `@/lib/api/index.useProviders` (rename de `useApiProviders`) | `apiClient.getProviders()`                  | `{ok, providers, total}`                                                               | 0 known direct                                                                  |

**L-86 actualizado a 4 paths, 2 implementaciones, 3 return shapes.**

---

## §4. Deep-dive LEGACY — URLs broken por hook (CP0)

### 4.1 `lib/hooks/useABTests.ts`

| #   | Línea | Operación | Método | URL usada                                                         | Backend                                                   | Status            | Evidencia               |
| --- | ----: | --------- | ------ | ----------------------------------------------------------------- | --------------------------------------------------------- | ----------------- | ----------------------- |
| 1   |   L55 | list      | GET    | `/api/projects/${projectId}/templates/ab-tests?status=`           | `/projects/:projectId/templates/ab-tests`                 | ✅ OK             | `templateRoutes.ts:160` |
| 2   |   L67 | create    | POST   | `/api/projects/${projectId}/templates/ab-tests`                   | `/projects/:projectId/templates/ab-tests`                 | ✅ OK             | `templateRoutes.ts:168` |
| 3   |   L83 | update    | PUT    | `/api/ab-tests/${test.id}`                                        | ❌ NOT REGISTERED                                         | 🔴 **BROKEN_404** | —                       |
| 4   |   L99 | start     | POST   | `/api/projects/${projectId}/templates/ab-tests/${testId}/start`   | `/projects/:projectId/templates/ab-tests/:testId/start`   | ✅ OK             | `templateRoutes.ts:177` |
| 5   |  L111 | pause     | POST   | `/api/projects/${projectId}/templates/ab-tests/${testId}/pause`   | ❌ NOT REGISTERED                                         | 🔴 **BROKEN_404** | Solo start+stop         |
| 6   |  L123 | stop      | POST   | `/api/projects/${projectId}/templates/ab-tests/${testId}/stop`    | `/projects/:projectId/templates/ab-tests/:testId/stop`    | ✅ OK             | `templateRoutes.ts:186` |
| 7   |  L135 | delete    | DELETE | `/api/ab-tests/${testId}`                                         | ❌ NOT REGISTERED                                         | 🔴 **BROKEN_404** | —                       |
| 8   |  L145 | results   | GET    | `/api/projects/${projectId}/templates/ab-tests/${testId}/results` | `/projects/:projectId/templates/ab-tests/:testId/results` | ✅ OK             | `templateRoutes.ts:195` |

**Resumen:** 5/8 OK, **3/8 BROKEN_404**. Consumer: `TemplateManagementDashboard.tsx:17,69`. Impacto UX: Update/Pause/Delete A/B test silently fail.

### 4.2 `lib/hooks/useTemplates.ts`

| #   | Línea | Operación | Método | URL usada                                | Backend                                              | Status                      | Evidencia                           |
| --- | ----: | --------- | ------ | ---------------------------------------- | ---------------------------------------------------- | --------------------------- | ----------------------------------- |
| 1   |   L37 | list      | GET    | `/api/projects/${projectId}/templates`   | `/projects/:projectId/templates`                     | ✅ OK                       | `templateRoutes.ts:34`              |
| 2   |   L46 | create    | POST   | `/api/projects/${projectId}/templates`   | `/projects/:projectId/templates`                     | ✅ OK                       | `templateRoutes.ts:52`              |
| 3   |   L71 | update    | PUT    | `/api/templates/${templateId}`           | ❌ Solo `/projects/:projectId/templates/:templateId` | 🔴 **BROKEN_PATH_MISMATCH** | Falta prefix `/projects/:projectId` |
| 4   |   L87 | delete    | DELETE | `/api/templates/${templateId}`           | ❌ Solo con prefix                                   | 🔴 **BROKEN_PATH_MISMATCH** | —                                   |
| 5   |   L97 | duplicate | POST   | `/api/templates/${templateId}/duplicate` | ❌ Solo con prefix                                   | 🔴 **BROKEN_PATH_MISMATCH** | —                                   |

**Resumen:** 2/5 OK, **3/5 BROKEN_PATH_MISMATCH**. Consumer: `TemplateManagementDashboard.tsx:16`. Impacto UX: Edit/Delete/Duplicate template retornan 404.

### 4.3 `lib/hooks/useTemplateVersions.ts`

| #   | Línea | Operación | Método | URL usada                                                                          | Backend                                                                  | Status            | Evidencia               |
| --- | ----: | --------- | ------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------- | ----------------------- |
| 1   |   L32 | list      | GET    | `/api/projects/${projectId}/templates/${templateId}/versions`                      | `/projects/:projectId/templates/:templateId/versions`                    | ✅ OK             | `templateRoutes.ts:110` |
| 2   |   L45 | create    | POST   | `/api/projects/${projectId}/templates/${templateId}/versions`                      | `/projects/:projectId/templates/:templateId/versions`                    | ✅ OK             | `templateRoutes.ts:119` |
| 3   |   L61 | restore   | POST   | `/api/projects/${projectId}/templates/${templateId}/versions/${versionId}/restore` | `/projects/:projectId/templates/:templateId/versions/:versionId/restore` | ✅ OK             | `templateRoutes.ts:128` |
| 4   |   L74 | delete    | DELETE | `/api/template-versions/${versionId}`                                              | ❌ NOT REGISTERED                                                        | 🔴 **BROKEN_404** | Backend solo GET/POST   |

**Resumen:** 3/4 OK, **1/4 BROKEN_404**. Consumer: `TemplateManagementDashboard.tsx:19`. Impacto UX: Delete version silently fails.

### 4.4 `lib/hooks/useProviders.ts` (LEGACY variant)

| #   | Línea | Operación | Método | URL usada        | Backend      | Status | Evidencia               |
| --- | ----: | --------- | ------ | ---------------- | ------------ | ------ | ----------------------- |
| 1   |   L48 | list      | GET    | `/api/providers` | `/providers` | ✅ OK  | `providerRoutes.ts:251` |

**Resumen:** 1/1 OK. **Pero hook duplicado**: 4 paths paralelos (ver §3.2 + L-207). Consumers: 4 (posts/[id]/preview, ClientContentEditor, PublishDialog, PublishingInterface).

**Hallazgo adicional L9**: `config: Record<string, any>` → R10 violation.

### 4.5 `lib/hooks/useAutoSave.ts`

**URLs HTTP:** 0. Hook es pure localStorage + delegación.

| Op                             | Descripción                                                 | Status                                                    |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------- |
| localStorage save L42          | `localStorage.setItem(draftKey, ...)`                       | ✅ Local OK                                               |
| localStorage load L59          | `localStorage.getItem(draftKey)`                            | ✅ Local OK                                               |
| **Simulated backend save L84** | `await new Promise((resolve) => setTimeout(resolve, 500));` | 🔴 **STUB** — comment explícito "simulate a backend save" |
| Delegated publish L188         | Via `usePostDraft` → `useCreatePost`/`useUpdatePost`        | Depends                                                   |

**Resumen:** 0 URLs directas pero **hallazgo crítico L-205 nuevo**: `useAutoSave.performSave` nunca llama backend real. Drafts solo en localStorage. **Data loss risk** si usuario cambia device o clear cache.

Consumer live (1): `ClientContentEditor.tsx:19` (via `usePostDraft`).

**R10 violation L16**: `onSave?: (success: boolean, error?: any) => void` — `any` en signature.

### 4.6 Resumen LEGACY totales

| Hook                  | URLs OK |       URLs BROKEN | Consumers | Classification                |
| --------------------- | ------: | ----------------: | --------: | ----------------------------- |
| `useABTests`          |       5 |           3 (404) |         1 | LEGACY_BROKEN                 |
| `useTemplates`        |       2 | 3 (path mismatch) |         1 | LEGACY_BROKEN                 |
| `useTemplateVersions` |       3 |           1 (404) |         1 | LEGACY_BROKEN                 |
| `useProviders`        |       1 |                 0 |         4 | LEGACY_WORKING (duplicado)    |
| `useAutoSave`         |       0 |            0 stub |         1 | LEGACY_WORKING_STUB           |
| **Total**             |  **11** |       **7 (39%)** |     **8** | 3 BROKEN + 2 WORKING variants |

---

## §5. TanStack v5 compliance audit

### 5.1 Summary matrix por categoría

| Capa                    | R1  | R2  | R3  | R4  |           R5           |       R8        | R9  |   R10   |   R11   |     R12     | R13 strict |
| ----------------------- | :-: | :-: | :-: | :-: | :--------------------: | :-------------: | :-: | :-----: | :-----: | :---------: | :--------: |
| `hooks/api/` (31)       | ✅  | ✅  | ✅  | ✅  |      ⚠️ 6 missing      | ⚠️ ~10 implicit | ✅  |   ✅    |  ❌ 12  |     ✅      |   ❌ 97    |
| `hooks/` no-api (3)     | ✅  | ✅  | ✅  | ✅  |           ✅           |       N/A       | ✅  |   ✅    |  ⚠️ 1   |     ✅      |     ✅     |
| `lib/hooks/` LEGACY (5) | ✅  | ✅  | ✅  | ✅  | ❌ all missing onError |       ✅        | ✅  |  ❌ 2   |  ❌ 2   |    ❌ 18    |
| `lib/api/` (6)          | N/A | N/A | N/A | N/A |           ⚠️           |       N/A       | N/A |  ❌ 18  |  ❌ 5   | ❌ hooks.ts |
| Colocated (9)           | N/A | N/A | N/A | N/A |          N/A           |       N/A       | N/A |   ✅    |  ❌ 5   |     ✅      |    ❌ 5    |
| **Total violations**    |  0  |  0  |  0  |  0  |        **~56**         |     **~10**     |  0  | **20+** | **25+** |      0      |  **~120**  |

### 5.2 R11 Size violations (21 hooks >limit)

| #   | File                                                   | LOC | Limit | Over |
| --- | ------------------------------------------------------ | --: | ----: | ---: |
| 1   | `components/ai/analytics/hooks/usePredictiveData.ts`   | 629 |   150 | +479 |
| 2   | `lib/api/client.ts`                                    | 440 |   200 | +240 |
| 3   | `hooks/api/useInbox.ts`                                | 321 |   150 | +171 |
| 4   | `components/scheduling/useSchedulingDashboard.ts`      | 318 |   150 | +168 |
| 5   | `components/content/library/useContentLibraryState.ts` | 290 |   150 | +140 |
| 6   | `components/templates/useTemplateVersionControl.ts`    | 281 |   150 | +131 |
| 7   | `hooks/api/useBilling.ts`                              | 274 |   150 | +124 |
| 8   | `components/templates/useABTestManager.ts`             | 273 |   150 | +123 |
| 9   | `lib/auth/authApi.ts`                                  | 258 |   200 |  +58 |
| 10  | `hooks/api/useTasks.ts`                                | 254 |   150 | +104 |
| 11  | `hooks/api/useSso.ts`                                  | 249 |   150 |  +99 |
| 12  | `lib/hooks/useABTests.ts`                              | 230 |   150 |  +80 |
| 13  | `hooks/api/useAssets.ts`                               | 224 |   150 |  +74 |
| 14  | `lib/api/types.ts`                                     | 212 |   200 |  +12 |
| 15  | `lib/hooks/useAutoSave.ts`                             | 207 |   150 |  +57 |
| 16  | `hooks/api/useCampaigns.ts`                            | 201 |   150 |  +51 |
| 17  | `hooks/api/useAIPromptTemplates.ts`                    | 177 |   150 |  +27 |
| 18  | `hooks/api/useMultiPlatformScheduling.ts`              | 165 |   150 |  +15 |
| 19  | `hooks/api/useApprovals.ts`                            | 165 |   150 |  +15 |
| 20  | `hooks/useAIContentGenerator.ts`                       | 163 |   150 |  +13 |
| 21  | `hooks/api/useTeam.ts`                                 | 159 |   150 |   +9 |
| 22  | `hooks/api/usePerformanceInsights.ts`                  | 152 |   150 |   +2 |
| 23  | `lib/hooks/useTemplates.ts`                            | 172 |   150 |  +22 |

### 5.3 R10 `any` violations (20+ individuales)

**`lib/api/client.ts` (13 any):**

- L141, L149, L159, L286, L298, L334, L348, L359, L369, L410, L430 (x2, x3)

**`lib/api/types.ts` (3 any):**

- L76 `details?: Record<string, any>` (ProviderHealth)
- L166 `ApiResponse<T = any>` (generic default)
- L192 `public details?: any` (ApiError)

**`lib/api/hooks.ts` (2 any):**

- L32 `queryKeys.posts(filters?: any)`
- L158 `metadata?: any` en UseMutationOptions

**`lib/hooks/useProviders.ts` (1 any):**

- L16 `config: Record<string, any>` (Provider interface)

**`lib/hooks/useAutoSave.ts` (1 any):**

- L16 `onSave?: (success: boolean, error?: any) => void`

### 5.4 R13 strict violations (agrupado, per Edward CP3)

| Grupo                                                 |          Count | Ejemplo típico                                      |
| ----------------------------------------------------- | -------------: | --------------------------------------------------- |
| `hooks/api/` raw fetch dentro de queryFn/mutationFn   |             97 | `useInbox.ts:87` `fetch("/api/backend/inbox?...")`  |
| `lib/hooks/` LEGACY raw fetch                         |             18 | Ya URL-por-URL en §4                                |
| Colocated hooks raw fetch                             |              5 | `useTemplateData.ts:38` + `usePredictiveData.ts` x4 |
| `hooks/api/` con path inconsistency (sin `/backend/`) | 3 (individual) | `useChannels.ts:56,105` + `useBilling.ts:260`       |
| **Total R13**                                         |        **123** |                                                     |

### 5.5 R5 Mutation handlers missing onError

~50 mutations en `hooks/api/` + 10 en LEGACY + 6 en wrappers tienen `onSuccess` pero NO `onError` per-mutation. Combinado con L-70 (no global MutationCache onError) → errores silenciosos. Ver L-260.

---

## §6. QueryClient config audit (L-70 + L-101)

### 6.1 Estado actual `app/providers.tsx`

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 60s
      gcTime: 5 * 60 * 1000, // 5min (v5 OK)
      retry: 1, // ⚠️ L-101 (recomienda 2)
    },
  },
  // ❌ NO queryCache: new QueryCache({ onError })
  // ❌ NO mutationCache: new MutationCache({ onError })
});
```

Provider hierarchy: `QueryClientProvider → ApiProvider → AuthProvider → children + Toaster + ReactQueryDevtools`

### 6.2 Findings

| Item                              | Estado          | L-XX           |
| --------------------------------- | --------------- | -------------- |
| `QueryCache({onError})` global    | ❌ MISSING      | L-70 (D0v4-4)  |
| `MutationCache({onError})` global | ❌ MISSING      | L-70 (D0v4-4)  |
| `staleTime` default 60s           | ⚠️ Generic      | L-101 (D0v4-4) |
| `gcTime` default 5min             | ✅ Correcto v5  | —              |
| `retry: 1` default                | ⚠️ Recomienda 2 | L-101 (D0v4-4) |
| `defaultOptions.mutations`        | **NOT SET**     | L-260 nuevo    |

---

## §7. Raw fetch migration catalog

### 7.1 Clasificación 129 fetches totales

| Categoría                                                             |      Count | Acción                                                               |
| --------------------------------------------------------------------- | ---------: | -------------------------------------------------------------------- |
| A. R13 strict — raw fetch dentro de `hooks/api/`                      |         97 | Refactor: replace `fetch()` internos por `apiClient` wrapper methods |
| B. Migration candidates (fuera de hooks, deberían ser hooks)          |     **32** | Create/extend TanStack hook (inline catalog abajo)                   |
| C. Dead subsystem L-68                                                |          5 | Delete con L-68 cleanup (publishing/publishingDashboardApi.ts)       |
| D. LEGACY hooks (CP0 §4)                                              |         18 | Retire via LEGACY → canonical migration                              |
| E. ClientTemplateEngine class (no hook)                               |          4 | N/A — internal template processor                                    |
| F. Wrappers (apiClient.request, authApi.request, proxy route handler) | (excluded) | Legitimate fetch infrastructure                                      |

### 7.2 Migration catalog Categoría B (32 entries inline)

| #   | File:Line                                                        | Current URL                                      | Method     | Proposed hook                                                              | QueryKey / Invalidation                        | Effort   |
| --- | ---------------------------------------------------------------- | ------------------------------------------------ | ---------- | -------------------------------------------------------------------------- | ---------------------------------------------- | -------- |
| 1   | `components/ai/SmartContentOptimizer.tsx:84`                     | `${API_URL}/ai/smart-analysis`                   | POST       | `useSmartAnalysis` new en `hooks/api/useAI.ts`                             | mutation: `["ai", "analyses"]`                 | M        |
| 2   | `components/settings/crm/CrmConnectionCard.tsx:45`               | dynamic `connectUrl`                             | GET        | Keep (OAuth redirect)                                                      | N/A                                            | doc only |
| 3   | `components/scheduling/MultiPlatformSchedulerRefactored.tsx:176` | `/scheduling/rules`                              | POST       | `useCreateSchedulingRule` en `useMultiPlatformScheduling`                  | mut: `["scheduling", "rules"]`                 | S        |
| 4   | `components/scheduling/MultiPlatformSchedulerRefactored.tsx:202` | `/scheduling/rules/:id/toggle`                   | PATCH      | `useToggleSchedulingRule` en `useMultiPlatformScheduling`                  | mut: `["scheduling", "rules"]`                 | S        |
| 5   | `components/scheduling/SchedulingDashboardSidebar.tsx:68`        | `/campaigns?projectId=`                          | GET        | Extend `useCampaigns(projectId)`                                           | query: `["campaigns", projectId]`              | S        |
| 6   | `components/scheduling/SchedulingDashboardSidebar.tsx:77`        | `/team?projectId=`                               | GET        | Extend `useTeamMembers(projectId)`                                         | query: `["team", projectId]`                   | S        |
| 7   | `components/scheduling/RecurringPostForm.tsx:104`                | `/recurring-posts` dynamic                       | POST/PATCH | `useCreateRecurringPost` / `useUpdateRecurringPost` en `useRecurringPosts` | mut                                            | M        |
| 8   | `components/notifications/NotificationPreferences.tsx:55`        | `/notifications/preferences`                     | GET        | `useNotificationPreferences` new                                           | query: `["notifications", "preferences"]`      | S        |
| 9   | `components/notifications/NotificationPreferences.tsx:62`        | `/notifications/preferences`                     | PUT        | `useSaveNotificationPreferences` new                                       | mut                                            | S        |
| 10  | `components/notifications/NotificationBell.tsx:27`               | `/notifications?limit=`                          | GET        | `useNotifications(limit)` new                                              | query: `["notifications", "list", limit]`      | S        |
| 11  | `components/notifications/NotificationBell.tsx:34`               | `/notifications/unread-count`                    | GET        | `useNotificationUnreadCount` new                                           | query: `["notifications", "unread-count"]`     | S        |
| 12  | `components/notifications/NotificationBell.tsx:41`               | `/notifications/mark-all-read`                   | POST       | `useMarkAllRead` new                                                       | mut                                            | S        |
| 13  | `components/notifications/NotificationBell.tsx:46`               | `/notifications/:id/read`                        | PATCH      | `useMarkNotificationRead` new                                              | mut                                            | S        |
| 14  | `components/editor/AdminContentEditor.tsx:109`                   | `/auth/connections/:projectId`                   | GET        | Dead (L-68)                                                                | N/A                                            | delete   |
| 15  | `components/announcements/AnnouncementBanner.tsx:53`             | `/api/announcements/active` (NO /backend/)       | GET        | `useActiveAnnouncements` new + fix path                                    | query: `["announcements", "active"]`           | S        |
| 16  | `app/actions/auth.ts:34`                                         | `${apiUrl}/auth/customer/login` (Server Action)  | POST       | Keep/consolidate via proxy (L-69+L-208)                                    | architectural                                  | M        |
| 17  | `app/actions/auth.ts:115`                                        | `${apiUrl}/auth/customer/register` Server Action | POST       | Idem #16                                                                   | architectural                                  | M        |
| 18  | `app/actions/auth.ts:141`                                        | `${apiUrl}/auth/customer/login` auto-login       | POST       | Idem #16                                                                   | architectural                                  | M        |
| 19  | `app/dashboard/ai/repurpose/page.tsx:44`                         | `/repurpose/proposals?accountId=`                | GET        | `useRepurposeProposals(accountId)` new                                     | query: `["repurpose", "proposals", accountId]` | S        |
| 20  | `app/dashboard/ai/repurpose/page.tsx:60`                         | `/approvals/:id/:action`                         | POST       | `useApproveRepurpose` new                                                  | mut                                            | S        |
| 21  | `app/dashboard/ai/trends/page.tsx:43`                            | `/trends/radar?accountId=`                       | GET        | `useTrendRadar(accountId)` new                                             | query: `["trends", "radar", accountId]`        | S        |
| 22  | `app/dashboard/settings/referral/page.tsx:33`                    | `/referral/code?accountId=`                      | GET        | `useReferralCode(accountId)` new                                           | query                                          | S        |
| 23  | `app/dashboard/scheduling/recurring/[id]/edit/page.tsx:26`       | `/recurring-posts/:id`                           | GET        | `useRecurringPost(id)` extend `useRecurringPosts`                          | query                                          | S        |
| 24  | `app/dashboard/scheduling/page.tsx:47`                           | `/analytics/optimal-times`                       | GET        | Unify `useOptimalTimes()` (ya en `useMultiPlatformScheduling`)             | query                                          | S        |
| 25  | `app/dashboard/scheduling/page.tsx:72`                           | `/scheduling/slots`                              | GET        | `useScheduleSlots()` (existe)                                              | query                                          | S        |
| 26  | `app/dashboard/scheduling/page.tsx:100`                          | `/scheduling/slots/bulk`                         | POST       | `useBulkCreateSchedules` (existe)                                          | mut                                            | S        |
| 27  | `app/dashboard/scheduling/page.tsx:145`                          | `/scheduling/slots`                              | POST       | `useCreateSchedule` (existe)                                               | mut                                            | S        |
| 28  | `app/dashboard/scheduling/page.tsx:176`                          | `/scheduling/slots/:id`                          | PATCH      | `useUpdateSchedulingSlot` new                                              | mut                                            | S        |
| 29  | `app/dashboard/scheduling/page.tsx:198`                          | `/scheduling/slots/:id`                          | DELETE     | `useDeleteSchedulingSlot` new                                              | mut                                            | S        |
| 30  | `app/dashboard/posts/page.tsx:71`                                | `/api/posts` (NO /backend/)                      | GET        | `usePosts` (existe en `lib/api/hooks`) + fix path                          | query                                          | M        |
| 31  | `app/dashboard/channels/page.tsx:100`                            | `/channels/bluesky/connect`                      | POST       | `useBlueskyConnect` new en `useChannels`                                   | mut                                            | S        |
| 32  | `app/reports/shared/[token]/page.tsx:34`                         | `/reports/public/:token`                         | GET        | `useSharedReport(token)` new (public)                                      | query                                          | S        |

### 7.3 Effort consolidado

| Bucket                                          | Count |                       Estimate |
| ----------------------------------------------- | ----: | -----------------------------: |
| S (small, <2h)                                  |    24 |                            48h |
| M (medium, 2-4h)                                |     7 |                            28h |
| Dead/Document                                   |     1 |                           0.5h |
| Architectural auth consolidation (L-69+L-208)   |     — |                           +16h |
| R13 refactor `hooks/api/` internal (97 fetches) |     — |                           +80h |
| LEGACY retirement + consumer migration          |     — |                           +40h |
| **Total migration effort**                      |     — | **~213h (~5-6 semanas 1 dev)** |

### 7.4 Hooks a crear nuevos

**9 new hook files + 5 extensions** a hooks existentes:

- `useAI` group — smart-analysis
- `useNotifications` + `useNotificationPreferences` + `useMarkAllRead` + `useMarkNotificationRead` (4 new hooks probably grouped)
- `useAnnouncements`
- `useRepurpose`
- `useTrendRadar`
- `useReferral`
- `useSharedReport`
- Extend `useChannels` (Bluesky connect)
- Extend `useMultiPlatformScheduling` (rules CRUD)
- Extend `useCampaigns` / `useTeam` (by projectId)
- Extend `useRecurringPosts` (singular)

---

## §8. Cross-ref con D0v4-4 + D0v4-1/2/3

### 8.1 Cross-ref D0v4-4 hooks-related

| D0v4-4 finding                                      | Status D0v4-5                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| L-70 providers.tsx missing QueryCache/MutationCache | **CONFIRMED + ampliado** — mutations sin onError en ~56 sitios   |
| L-77 useContentLibraryState stub                    | **CONFIRMED** — 0 URLs, no fetch                                 |
| L-86 3 `useProviders` paralelos                     | **UPGRADED to 4 paths** (nuevo L-207)                            |
| L-99 TemplateManagementDashboard LEGACY URLs broken | **CONFIRMED quirúrgicamente** — 7/18 URLs broken total en LEGACY |
| L-101 QueryClient config staleTime/retry            | **CONFIRMED** — también `defaultOptions.mutations` NOT SET       |
| L-140 usePredictiveData 629 LOC + 4 raw fetches     | **CONFIRMED** — R11 + R13                                        |
| L-164 useContentLibraryState 290 LOC                | **CONFIRMED** — R11 violation                                    |
| L-166 useSchedulingDashboard 318 LOC                | **CONFIRMED** — R11                                              |
| L-179 useABTestManager 273 LOC                      | **CONFIRMED** — R11                                              |
| L-191 useTemplateVersionControl 281 LOC             | **CONFIRMED** — R11                                              |

### 8.2 Cross-ref D0v4-1 backend services

Hooks D0v4-5 consumen endpoints D0v4-1 auditados. Correspondencias verificadas en §4 deep-dive (templateRoutes + providerRoutes). Resto de endpoints (inbox, tasks, approvals, scheduling, etc.) consumidos vía correct `/api/backend/` paths — sin broken detectado en deep-dive B1/B2.

### 8.3 Cross-ref D0v4-3 workers (L-52, L-61, L-62)

Los hooks **no originan directly** los jobs broken. UI dispara jobs via mutations que llegan al backend. Los hooks correspondientes (`useInitiateGatewaySwitch`, `useCancelGatewaySwitch`, `useAnalytics`, `useInboxConversations`, etc.) son **correctos en cliente** pero llegan a backend broken. **Hook layer no causa L-52/L-61/L-62**; las rotas están en workers.

---

## §9. Clasificaciones

| Classification                                     | Count | Hooks                                                                                                                                |
| -------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------ |
| ACTIVE (canonical, working, TanStack v5 compliant) |    28 | Most hooks/api + useNotificationStream + useFocusTrap                                                                                |
| PARTIALLY_ACTIVE (size violations only)            |    12 | useInbox, useBilling, useTasks, etc.                                                                                                 |
| LEGACY_WORKING (duplicated)                        |     2 | `lib/hooks/useProviders` (1 de 4), `lib/api/hooks.useProviders` re-export                                                            |
| LEGACY_WORKING_STUB                                |     1 | `lib/hooks/useAutoSave`                                                                                                              |
| LEGACY_BROKEN (URLs broken)                        |     3 | `useABTests`, `useTemplates`, `useTemplateVersions`                                                                                  |
| PARTIALLY_ACTIVE (colocated stub)                  |     1 | `useContentLibraryState`                                                                                                             |
| DEAD_CODE_CANDIDATE                                |     0 | —                                                                                                                                    |
| Auxiliares (wrappers, config, types)               |     9 | `client.ts`, `hooks.ts`, `context.tsx`, `index.ts`, `providers.ts`, `types.ts`, `authApi.ts`, `providers.tsx`, component state hooks |

**Zero DEAD_CODE_CANDIDATE** en hooks. Todos tienen consumers live.

---

## §10. Duplicaciones detectadas

### 10.1 `useProviders` — 4 paths (ver §3.2)

Ya documentado. L-207 nuevo.

### 10.2 `useApiProviders` rename a `useProviders` en `lib/api/index.ts`

`lib/api/index.ts:31` renombra `useApiProviders` → `useProviders`. Pero `lib/api/hooks.ts:173` también exporta `useProviders` (LEGACY). **Naming conflict en misma carpeta** — ambos exports conviven. L-210 nuevo.

### 10.3 Auth dual path (L-69 upgraded)

- `app/actions/auth.ts` Server Action direct
- `app/api/backend/[...path]/route.ts` proxy intercept
- `lib/auth/authApi.ts` → via proxy

3 paths para login (L-69 era 2). L-208 nuevo.

### 10.4 `providers.ts` misleading filename

`lib/api/providers.ts` (55 LOC) contiene **solo types** (no API client) pese a nombre. L-211 nuevo.

### 10.5 Error handling inconsistent

`lib/api/client.ts` lanza `ApiError` (class custom). `lib/auth/authApi.ts` lanza plain `Error`. Inconsistent. L-209 nuevo.

---

## §11. Plan consolidación LEGACY → canónico

### 11.1 Fase 1 (prioridad crítica) — 3-4 semanas

1. **Fix QueryClient config** (L-70, L-101):
   - Add `QueryCache({onError: (e) => toast.error(...)})` global.
   - Add `MutationCache({onError: (e) => toast.error(...)})` global.
   - Review `retry: 1` → `retry: 2`.
   - Effort: 4h.

2. **Fix useAutoSave stub** (L-205):
   - Wire real backend save via `apiClient.updatePost` / draft endpoint.
   - Effort: 6h + tests.

3. **Fix useInbox.markMessageRead silent failure** (L-206):
   - Add `res.ok` check + invalidate unread count.
   - Effort: 2h.

4. **LEGACY retirement**:
   - Migrate TemplateManagementDashboard → canonical hooks (create new `useABTestsCanonical` or use `hooks/api/useABTests` if needed).
   - Migrate 4 useProviders consumers → `@/hooks/api/useChannels.useProviders`.
   - Migrate usePostDraft → new `useAutoSave` canonical.
   - Delete `lib/hooks/*.ts` (5 files).
   - Effort: 20h.

### 11.2 Fase 2 (alta) — 4-6 semanas

5. **Create 32 raw fetch migration hooks** (§7.2 catalog).
   - Effort: 76h.

6. **R13 refactor internal** (`hooks/api/` 97 fetches → apiClient methods):
   - Implies extending `ApiClient` class with missing methods.
   - Effort: 80h.

7. **Auth consolidation** (L-69 + L-208):
   - Choose single path: recommend `authApi` via proxy + Server Actions delegate to `authApi`.
   - Effort: 12h.

### 11.3 Fase 3 (medio) — 2-3 semanas

8. **Split large hooks** (R11 violations):
   - 21 hooks refactor por responsabilidad.
   - Effort: 60h.

9. **Fix `any` types** (20+ violations):
   - Define missing types.
   - Effort: 8h.

10. **Rename `providers.ts` → `providerTypes.ts`** (L-211):
    - Effort: 30min.

11. **Fix naming conflict useProviders in lib/api** (L-210):
    - Effort: 2h.

### 11.4 Total estimate

- Fase 1: ~32h (~1 semana 1 dev)
- Fase 2: ~168h (~4-5 semanas 1 dev)
- Fase 3: ~70h (~2 semanas 1 dev)
- **Total: ~270h (~7-8 semanas 1 dev)**

---

## §12. Hallazgos laterales para LATERAL_FINDINGS.md

**Total: ~62 nuevos hallazgos (L-205 a ~L-266)**. Distribución:

| Severidad                              | Count | Rango        |
| -------------------------------------- | ----: | ------------ |
| 🔴 Crítico                             |     6 | L-205..L-210 |
| 🟠 Alto                                |     5 | L-211..L-215 |
| 🟡 Medio (client.ts any + types + R11) |    31 | L-216..L-246 |
| 🟡 Medio (R13 grouped + otros)         |     8 | L-247..L-254 |
| 🟢 Bajo                                |    12 | L-255..L-266 |

**Tabla resumen por severidad:**

### §12.1 Críticos (L-205..L-210)

| #     | Título                                                                                                       | Archivo                                               |
| ----- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| L-205 | useAutoSave stub — simulated backend save (`setTimeout(500)`) — drafts solo en localStorage — data loss risk | `lib/hooks/useAutoSave.ts:84`                         |
| L-206 | useInbox.markMessageRead silent failure — no `res.ok` check + no invalidation                                | `hooks/api/useInbox.ts:170-172, 317-321`              |
| L-207 | `useProviders` 4 paths paralelos (upgrade L-86)                                                              | multiple                                              |
| L-208 | Auth 3 paths paralelos (upgrade L-69)                                                                        | `actions/auth.ts`, `[...path]/route.ts`, `authApi.ts` |
| L-209 | Error handling inconsistent `lib/api/client.ts` usa `ApiError`, `lib/auth/authApi.ts` usa plain Error        | 2 wrappers                                            |
| L-210 | Naming conflict `useProviders` entre `lib/api/index.ts:31` y `lib/api/hooks.ts:173`                          | `lib/api/*`                                           |

### §12.2 Altos (L-211..L-215)

| #     | Título                                                                                                               | Archivo                             |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| L-211 | `lib/api/providers.ts` misleading filename — solo types, no API client                                               | `lib/api/providers.ts`              |
| L-212 | `lib/api/client.ts` 440 LOC god file — ApiClient singleton con 30+ métodos                                           | `lib/api/client.ts`                 |
| L-213 | useAIContentGenerator `estimatedEngagement: 75` hardcoded en `mapApiTemplate` L39 (new fake-AI site)                 | `hooks/useAIContentGenerator.ts:39` |
| L-214 | State management hooks (useABTestManager + useTemplateVersionControl) cadena a LEGACY mutations — composite con L-99 | `components/templates/*`            |
| L-215 | useBilling.useCheckout + useBillingPortal `window.location.href = url` anti-pattern en onSuccess                     | `hooks/api/useBilling.ts:197, 224`  |

### §12.3 Medios — `client.ts` `any` individuales (L-216..L-228)

Per Edward CP2 "individual":

| #     |     Línea | Context                                                  |
| ----- | --------: | -------------------------------------------------------- |
| L-216 |      L141 | `addPostMedia` return `Promise<ApiResponse<any>>`        |
| L-217 |  L149-156 | `createPostThread` return `ApiResponse<any>`             |
| L-218 |      L159 | `getPostThread` return `ApiResponse<any>`                |
| L-219 |  L286-295 | `getBestPostingTimes` return `ApiResponse<any>`          |
| L-220 |  L298-311 | `getContentPerformance` return `ApiResponse<any>`        |
| L-221 |  L334-345 | `publishPost` return `Promise<ApiResponse<any>>`         |
| L-222 |  L348-356 | `schedulePost` return `Promise<ApiResponse<any>>`        |
| L-223 |  L359-363 | `cancelScheduledPost` return `Promise<ApiResponse<any>>` |
| L-224 |      L369 | `uploadFile` `metadata?: any`                            |
| L-225 |      L410 | `generateContent` `metadata?: any`                       |
| L-226 |      L430 | `analyzeContent` `analysis: any`                         |
| L-227 |      L430 | `analyzeContent` `score?: number`                        |
| L-228 | L141 body | `addPostMedia` media type loose                          |

### §12.4 Medios — otros `any` individuales (L-229..L-234)

| #     | Línea | Archivo                     | Context                                         |
| ----- | ----: | --------------------------- | ----------------------------------------------- |
| L-229 |   L76 | `lib/api/types.ts`          | `ProviderHealth.details?: Record<string, any>`  |
| L-230 |  L166 | `lib/api/types.ts`          | `ApiResponse<T = any>` generic default          |
| L-231 |  L192 | `lib/api/types.ts`          | `ApiError.details?: any`                        |
| L-232 |   L32 | `lib/api/hooks.ts`          | `queryKeys.posts(filters?: any)`                |
| L-233 |  L158 | `lib/api/hooks.ts`          | `UseMutationOptions metadata?: any`             |
| L-234 |   L16 | `lib/hooks/useProviders.ts` | `Provider.config: Record<string, any>` (LEGACY) |
| L-235 |   L16 | `lib/hooks/useAutoSave.ts`  | `onSave error?: any` (LEGACY)                   |

### §12.5 Medios — R11 size violations individuales (L-236..L-258)

**23 hooks/files >LOC limit** (per Edward CP1 individual):

| #     | File                            |              LOC |
| ----- | ------------------------------- | ---------------: |
| L-236 | `usePredictiveData.ts`          |              629 |
| L-237 | `lib/api/client.ts`             | 440 (also L-212) |
| L-238 | `useInbox.ts`                   |              321 |
| L-239 | `useSchedulingDashboard.ts`     |              318 |
| L-240 | `useContentLibraryState.ts`     |              290 |
| L-241 | `useTemplateVersionControl.ts`  |              281 |
| L-242 | `useBilling.ts`                 |              274 |
| L-243 | `useABTestManager.ts`           |              273 |
| L-244 | `authApi.ts`                    |              258 |
| L-245 | `useTasks.ts`                   |              254 |
| L-246 | `useSso.ts`                     |              249 |
| L-247 | `useABTests.ts`                 |              230 |
| L-248 | `useAssets.ts`                  |              224 |
| L-249 | `types.ts`                      |              212 |
| L-250 | `useAutoSave.ts`                |              207 |
| L-251 | `useCampaigns.ts`               |              201 |
| L-252 | `useAIPromptTemplates.ts`       |              177 |
| L-253 | `useTemplates.ts`               |              172 |
| L-254 | `useMultiPlatformScheduling.ts` |              165 |
| L-255 | `useApprovals.ts`               |              165 |
| L-256 | `useAIContentGenerator.ts`      |              163 |
| L-257 | `useTeam.ts`                    |              159 |
| L-258 | `usePerformanceInsights.ts`     |              152 |

### §12.6 R13 agrupado (L-259..L-261)

Per Edward CP Cierre "R13 strict agrupado":

| #     | Título                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-259 | R13 strict: 97 raw `fetch()` inside `hooks/api/` queryFn/mutationFn — should use `apiClient` wrapper methods                                            |
| L-260 | Missing per-mutation `onError` handlers across ~56 mutations — composite with L-70 (no MutationCache global)                                            |
| L-261 | Path inconsistency: 3 hooks en `hooks/api/` usan `/api/*` sin `/backend/` prefix (bypass auth injection) — `useChannels.ts:56,105`, `useBilling.ts:260` |

### §12.7 Bajos (L-262..L-266)

| #     | Título                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------- |
| L-262 | `useChannels.disconnectChannel` L105 usa `/api/channels/:id` sin `/backend/` — path inconsistency                 |
| L-263 | `lib/api/index.ts:31` rename `useApiProviders as useProviders` sin documentation — confusion potential            |
| L-264 | `useBilling.useMyInvoices:260` path `/api/billing/invoices` sin `/backend/` prefix                                |
| L-265 | `useNotificationStream` SSE bypass proxy (intencional, documentado L7-9) — OK pero noted                          |
| L-266 | `useAIContentGenerator` composite complexity — mezcla local state + 2 hooks internos + fallback hardcoded (L-213) |

---

## §13. Predicción Sprint D0v4-6 (admin frontend)

### Scope esperado

`apps/admin/` completo — pages + components + hooks + providers. 5º sprint (después de D0v4-4/5 que cerraron client).

### Hallazgos esperables

1. **Admin hooks paralelos**: similar fragmentación `apps/admin/hooks/api/` vs `apps/admin/lib/api/hooks/` vs colocated.
2. **LEGACY hooks en admin**: posible mirror de client LEGACY (ABTests, Templates).
3. **Admin dashboard widgets**: many static/hardcoded data (fake-AI pattern).
4. **QueryClient config admin**: probable mismo L-70 pattern (no global error handlers).
5. **Admin routes consume same backend endpoints** — cross-ref final con D0v4-1 routes.

### Estimación

- ~90 archivos admin (pages+components+hooks)
- 3-5 días calendario
- ~25-35 hallazgos nuevos L-267+

---

## §14. Anexo — Verification checklist

- [x] 56 archivos procesados (54 hooks + 2 wrappers; plus QueryClient config)
- [x] §4 5 deep-dive LEGACY tables URL-por-URL completas
- [x] §5 TanStack v5 matrix compilada (R1-R13)
- [x] §6 QueryClient config audit
- [x] §7 Raw fetch migration catalog (32 inline + clasificación 129 total)
- [x] §8 cross-ref D0v4-1/2/3/4
- [x] §9 clasificaciones asignadas
- [x] §10 duplicaciones (4 useProviders, naming conflict, providers.ts filename, auth 3 paths)
- [x] §11 plan consolidación LEGACY → canónico con effort (~270h)
- [x] §12 hallazgos laterales L-205..~L-266 (~62 nuevos)
- [x] §13 predicción D0v4-6
- [x] CP0 + CP1 + CP2 + CP3 + Cierre aprobados Edward
- [x] Zero cambios en `apps/`, `packages/`, `infra/` (solo docs)

---

## §15. Anexo — Commit sugerido

```text
docs(audits): D0v4-5 frontend client hooks audit report

54 hooks auditados bajo §5.8 + §5.9 + CP1 + TanStack v5 compliance en 3 batches + CP0 deep-dive.
Inventario 4 carpetas paralelas + 9 colocated + QueryClient config + raw fetch catalog.

5 LEGACY deep-dive URL-por-URL: 7/18 URLs broken (39%).
TanStack v5 compliance: R1-R4 + R6 + R7 + R9 + R10 (canonical) + R12 pass.
R11 size violations: 23 hooks/files >limit.
R13 strict: 123 raw fetches (97 in hooks/api internal + 18 LEGACY + 5 colocated + 3 path-inconsistency).
20+ `any` violations in wrappers.

QueryClient config: MISSING QueryCache + MutationCache global error handlers (L-70 confirmed).

Raw fetch migration catalog: 32 candidates → new/extended hooks proposals inline.
Plan consolidación LEGACY → canónico: 3 fases, ~270h effort total.

~62 hallazgos laterales nuevos (L-205..L-266).
PLAN_MAESTRO §6 actualizado.

Ready para Sprint D0v4-6 (Frontend admin).
```
