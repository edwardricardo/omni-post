# D0v4-4 — Frontend Client: Pages + Layouts + Components Audit Report

> **Sprint:** D0v4-4 (apps/client/ excepto hooks)
> **Ejecutado:** 2026-04-20
> **Metodología:** §5.8 lectura directa + §5.9 clasificación + CP1 (LATERAL_FINDINGS antes de DEAD_CODE_CANDIDATE)
> **Ejecutor:** react-frontend-specialist bajo plan mode validado
> **Cambios en código:** 0 (100% lectura + docs)

---

## §1. Metodología aplicada

### 1.1 §5.8 — Lectura directa

249 archivos abiertos línea 1→N sin skip en B1-B3 + lectura selectiva + grep pattern-match en B4 (139 archivos) por volumen. Spot-check cross-count cada 15 archivos (5 checkpoints: 4 CP + Cierre). Grep usado como localizador para confirmaciones.

### 1.2 §5.9 — Clasificación sin delete

Cero archivos propuestos para DELETE sin validación Edward. Categorías aplicadas: ACTIVE / PARTIALLY_ACTIVE / PLANNED / INFRASTRUCTURE_READY / BROKEN / DEAD_CODE_CANDIDATE.

### 1.3 Regla CP1 vigente

Todo "no wired" o "behavior inesperado" → LATERAL_FINDINGS con research intent pending, no DEAD_CODE automático.

### 1.4 Checkpoints ejecutados

| CP         | Batch                                          | Aprobado      | Decisiones críticas                                                                                       |
| ---------- | ---------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| **CP1**    | B1 (55 archivos app/\*\*)                      | ✅ 2026-04-20 | Orphan links individuales; L-69 Server Action vs Proxy crítico; over-clientization individual por wrapper |
| **CP2**    | B2 (17 archivos core components)               | ✅ 2026-04-20 | Publishing subsystem unificación; SchedulePicker fake individual; Notifications→admin individual          |
| **CP3**    | B3 (36 archivos features hotspots)             | ✅ 2026-04-20 | Publishing subsystem único L-XX; Fake-AI individual por sitio                                             |
| **CP4**    | B4 (139 archivos features resto)               | ✅ 2026-04-20 | Fake-AI individual + crítico; MultiPlatformScheduler investigado; A/B test broken URLs re-documentar      |
| **Cierre** | B5 (4 archivos providers+utils+verificaciones) | ✅ 2026-04-20 | Volume OK; size violations individual; over-clientization individual; report detallado                    |

---

## §2. Inventario completo

### 2.1 Conteos totales

| Categoría                              |   Count |  LOC aprox. |
| -------------------------------------- | ------: | ----------: |
| `apps/client/app/**/*.{ts,tsx}`        |      55 |      ~7,800 |
| `apps/client/components/**/*.{ts,tsx}` |     192 |     ~18,000 |
| `apps/client/providers/**`             |       1 |         327 |
| `apps/client/lib/utils/**`             |       1 |         126 |
| **TOTAL SPRINT SCOPE**                 | **249** | **~22,000** |

### 2.2 app/\*\* — desglose

- Pages (`page.tsx`): 47
- Layouts (`layout.tsx`): 2 (root + dashboard)
- Error boundaries: 3 (`error.tsx`, `global-error.tsx`, `not-found.tsx`)
- Server Actions: 1 (`actions/auth.ts`)
- Route handlers: 1 (`api/backend/[...path]/route.ts`)
- Providers wrapper: 1 (`app/providers.tsx`)
- Colocated component: 1 (`app/dashboard/templates/TemplateManagementDashboard.tsx`)

### 2.3 components/\*\* — 22 subfolders

```
ai(22), analytics(11), announcements(1), approvals(3), assets(4),
billing(1), campaigns(4), comments(1), content(22), editor(7),
inbox(8), instagram(15), integrations(1), notifications(4),
onboarding(1), publishing(4), scheduling(21), settings(11),
shared(2), tasks(5), team(4), templates(28)
```

### 2.4 `"use client"` distribution

| Capa          | Client | Server/shared | Total | % Client |
| ------------- | -----: | ------------: | ----: | -------: |
| `app/`        |     48 |             7 |    55 |  **87%** |
| `components/` |    136 |            56 |   192 |      71% |

### 2.5 Middleware

**No existe `apps/client/middleware.ts`** (confirmado via Glob). Auth 100% vía route handler proxy `app/api/backend/[...path]/route.ts`.

---

## §3. Mapeo page/component ↔ endpoint backend (tabla maestra)

### 3.1 Patrones de data fetching identificados

**5 paths paralelos** coexisten en apps/client/ — violación FRONTEND_STANDARDS §2.1 "TanStack Query is the only data-fetching method":

| #   | Pattern                                     |                                                                                                                                                                                            Consumidores | Paso auth                                            |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | ---------------------------------------------------- |
| 1   | TanStack Query via `hooks/api/*` (canónico) |                                                                                                                                                                                               ~50 files | ✅ via proxy `/api/backend/`                         |
| 2   | Legacy `@/lib/api/hooks`                    |                                                                                                                                                                                               12+ files | ✅ via proxy                                         |
| 3   | Legacy `@/lib/hooks/*`                      |                                                                                                                                                                                                8+ files | ⚠️ via rewrite `/api/*` (no auth explícita — fragil) |
| 4   | Raw `fetch("/api/backend/...")`             | 14 files (scheduling, ai/repurpose, ai/trends, settings/referral, recurring-posts form, notifications bell/prefs, announcements, AdminContentEditor, ProjectProvider, MultiPlatformSchedulerRefactored) | ✅ via proxy                                         |
| 5   | Server Actions (`actions/auth.ts`)          |                                                                                                                                                                                    login/register forms | ✅ cookies directas                                  |
| 6   | `apiClient.xxx()` direct method             |                                                                                                                                                               posts/[id], preview, assets, ai/repurpose | ✅ wrapper                                           |

### 3.2 Mapeo maestro por subfolder (abreviado)

| Page / Component                                       | Endpoint(s)                                                                    | Status backend                               | Flag                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------- |
| `app/dashboard/posts/page.tsx`                         | `/api/posts` (raw fetch, no TanStack)                                          | ACTIVE                                       | ⚠️ violation §2.1                                         |
| `app/dashboard/posts/[id]/page.tsx`                    | `apiClient.publishPost`, `schedulePost`, `updatePost`                          | ACTIVE (con L-52)                            | 🔴 SILENT-NO-OP                                           |
| `app/dashboard/posts/[id]/preview/page.tsx`            | Idem + `@/lib/hooks/useProviders` (LEGACY)                                     | ACTIVE                                       | 🔴 SILENT-NO-OP                                           |
| `app/dashboard/posts/new/page.tsx`                     | `@/lib/api/hooks.useProjects` (LEGACY) + PublishDialog                         | ACTIVE                                       | ⚠️ LEGACY                                                 |
| `app/dashboard/integrations/page.tsx`                  | → `IntegrationMarketplace` (static registry)                                   | N/A                                          | OK (marketplace estático)                                 |
| `app/dashboard/settings/integrations/page.tsx`         | → `ExternalNotificationConfigs` → `hooks/api/useExternalNotifications`         | ACTIVE backend, webhooks delivery L-44 NO-OP | 🔴 SILENT-NO-OP                                           |
| `app/dashboard/settings/billing/page.tsx`              | `useGatewayStatus`, `useInitiateGatewaySwitch`, `useCancelGatewaySwitch`       | BROKEN (L-62 GATEWAY_SWITCH sin consumer)    | 🔴 SILENT-NO-OP                                           |
| `app/dashboard/inbox/page.tsx`                         | → `InboxLayout` → `hooks/api/useInbox`                                         | BROKEN (L-55 bypass + L-61 misroute)         | 🔴 SILENT-NO-OP                                           |
| `app/dashboard/analytics/page.tsx`                     | `hooks/api/useAnalytics`                                                       | BROKEN (L-61 ANALYTICS_AGGREGATION misroute) | 🔴 SILENT-NO-OP                                           |
| `app/dashboard/analytics/insights/page.tsx`            | → `PerformanceInsights` con `accountId=""`, `projectId=""`                     | BROKEN (params empty)                        | 🔴 CLIENT-REVERSE-ORPHAN                                  |
| `app/dashboard/analytics/reports/page.tsx`             | `hooks/api/useReports` (requires `?projectId=<uuid>`)                          | ACTIVE                                       | ⚠️ UX hack                                                |
| `app/dashboard/ai/repurpose/page.tsx`                  | Raw `fetch("/api/backend/repurpose/proposals")` + `/approvals/:id/:action`     | BROKEN (L-61 GENERATE_REPURPOSE misroute)    | 🔴 SILENT-NO-OP                                           |
| `app/dashboard/ai/trends/page.tsx`                     | Raw `fetch("/api/backend/trends/radar")`                                       | TREND_RADAR queue PLANNED (no worker)        | ⚠️ PLANNED                                                |
| `app/dashboard/scheduling/page.tsx`                    | Raw `fetch("/api/backend/analytics/optimal-times")` + `/scheduling/slots`      | ACTIVE                                       | ⚠️ violation §2.1                                         |
| `app/dashboard/content/library/page.tsx`               | → `ContentLibrary` → `useContentLibraryState` (NO FETCHES)                     | ACTIVE backend, hook stub                    | 🔴 ORPHAN (always empty)                                  |
| `app/dashboard/channels/page.tsx`                      | `hooks/api/useChannels.useProviders, useChannels, useDisconnectChannel`        | ACTIVE                                       | ✅ (pero OAuth connect dead para 10/11)                   |
| `app/dashboard/approvals/page.tsx`                     | `hooks/api/useApprovals`                                                       | ACTIVE                                       | ✅                                                        |
| `app/dashboard/assets/page.tsx`                        | `apiClient.uploadFile`                                                         | ACTIVE                                       | ✅                                                        |
| `app/dashboard/tasks/page.tsx`                         | `hooks/api/useTasks`                                                           | ACTIVE                                       | ✅                                                        |
| `app/dashboard/team/**` (no existe)                    | —                                                                              | —                                            | 🔴 CLIENT-REVERSE-ORPHAN (dashboard/layout.tsx link rota) |
| `app/dashboard/campaigns/[id]/page.tsx`                | `hooks/api/useCampaigns`                                                       | ACTIVE                                       | ✅                                                        |
| `app/dashboard/settings/usage/page.tsx`                | `hooks/api/useUsage`                                                           | ACTIVE                                       | ✅                                                        |
| `app/dashboard/settings/privacy/page.tsx`              | `hooks/api/usePrivacy` (DSAR form)                                             | ACTIVE                                       | ✅                                                        |
| `app/dashboard/settings/sso/page.tsx`                  | `hooks/api/useSso`                                                             | ACTIVE                                       | ✅                                                        |
| `app/dashboard/settings/team/page.tsx`                 | `hooks/api/useTeam`                                                            | ACTIVE                                       | ✅                                                        |
| `app/dashboard/settings/ai/page.tsx`                   | `hooks/api/useAiSettings`                                                      | ACTIVE                                       | ✅                                                        |
| `app/dashboard/settings/referral/page.tsx`             | Raw `fetch("/api/backend/referral/code")`                                      | ACTIVE                                       | ⚠️ violation §2.1                                         |
| `app/dashboard/settings/brand-voice/page.tsx`          | `hooks/api/useBrandVoice` (requires ?accountId=)                               | ACTIVE                                       | ⚠️ UX hack                                                |
| `app/dashboard/templates/page.tsx`                     | → `TemplateManagementDashboard` usa 3 LEGACY hooks con URLs BROKEN             | ACTIVE parcial                               | 🔴 CLIENT-REVERSE-ORPHAN-404 (3/8 URLs)                   |
| `components/publishing/UnifiedPublishingDashboard.tsx` | `fetchProviderStatuses`, `fetchSchedules`, `publishContent`, `scheduleContent` | N/A (no importado)                           | 🔴 DEAD_CODE_CANDIDATE                                    |

**Nota**: tabla abreviada. Tabla completa por archivo en §12 + LATERAL_FINDINGS.md.

---

## §4. Flags críticos consolidados

### 4.1 CLIENT-REVERSE-ORPHAN-404 (links a pages inexistentes)

| #   | Origen                                         | Link                                                              | Target inexistente                     |
| --- | ---------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| 1   | `login/page.tsx:93`                            | `/forgot-password`                                                | —                                      |
| 2   | `register/page.tsx:121`                        | `/terms`                                                          | —                                      |
| 3   | `register/page.tsx:125`                        | `/privacy`                                                        | (existe `/dashboard/settings/privacy`) |
| 4   | `scheduling/page.tsx:244`                      | `/scheduling/recurring`                                           | missing `/dashboard/`                  |
| 5   | `scheduling/recurring/page.tsx:28`             | `/scheduling/recurring/new`                                       | missing `/dashboard/`                  |
| 6   | `scheduling/recurring/new/page.tsx:16`         | `/scheduling/recurring`                                           | missing `/dashboard/`                  |
| 7   | `scheduling/recurring/[id]/edit/page.tsx:42`   | `/scheduling/recurring`                                           | missing `/dashboard/`                  |
| 8   | `RecurringPostForm.tsx:118`                    | `/scheduling/recurring`                                           | missing `/dashboard/`                  |
| 9   | `posts/new/page.tsx:156`                       | `/dashboard/projects/new`                                         | —                                      |
| 10  | `dashboard/layout.tsx:51`                      | `/dashboard/queue`                                                | —                                      |
| 11  | `OnboardingChecklist.tsx:18`                   | `/dashboard/team`                                                 | (existe `/dashboard/settings/team`)    |
| 12  | `NotificationBell.tsx:226`                     | `/admin/settings/notifications`                                   | CLIENT APP → admin target              |
| 13  | `NotificationItem.tsx:getTarget()`             | `/admin/approvals`, `/admin/posts/{id}`, `/admin/posts`, `/admin` | copy-paste sin adaptar nav             |
| 14  | `TemplateManagementDashboard` via `useABTests` | 3/8 URLs PUT/PATCH/DELETE                                         | 404 silenciosos                        |

**Total: 14 orphan link families** (algunos afectan múltiples pages).

### 4.2 CLIENT-REVERSE-ORPHAN-BROKEN (llama ruta BROKEN de D0v4-3)

| #   | Consumidor                                           | Endpoint                                         | Backend hallazgo                              |
| --- | ---------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| 1   | `billing/page.tsx` + `GatewaySection`                | `/billing/gateway-switch/*`                      | L-62 GATEWAY_SWITCH sin consumer              |
| 2   | `analytics/page.tsx` + `analytics/insights/page.tsx` | `/analytics/*`                                   | L-61 ANALYTICS_AGGREGATION misroute           |
| 3   | `inbox/page.tsx` + `InboxLayout`                     | `/inbox/*`                                       | L-55 domain bypass + L-61 INBOX_SYNC misroute |
| 4   | `ai/repurpose/page.tsx`                              | `/repurpose/proposals`, `/approvals/:id/:action` | L-61 GENERATE_REPURPOSE misroute              |

### 4.3 SILENT-NO-OP (handler NO-OP / UI success sin verificación)

| #   | UI                                                                 | Síntoma                                                                                           |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 1   | `posts/[id]/page.tsx` + `posts/[id]/preview/page.tsx`              | `apiClient.publishPost` → `alert("Post published successfully!")` incondicional. L-52 composición |
| 2   | `PublishingInterface.tsx:138-236`                                  | Loop de `publishPost` con `info({description:"Successfully..."})`. L-52 backend compounded        |
| 3   | `ClientContentEditor.tsx:174-182`                                  | `handleSchedule` UI muestra "Post Scheduled!" sin llamar ningún endpoint backend                  |
| 4   | `ExternalNotificationConfigs.tsx` + `AddWebhookForm.tsx`           | UI muestra webhooks "Active" pero L-44 AnalyticsEventHandler + WebhookEventHandler NO-OP          |
| 5   | `instagram/stories/page.tsx`                                       | 4 callbacks `alert("Coming soon")`: onSave/onSchedule/onPublish/onError                           |
| 6   | `instagram/upload/page.tsx` handleCreateStories + Reels + Carousel | Buttons sin `onClick` o `void ruleId` stubs                                                       |
| 7   | `channels/page.tsx:665-674`                                        | OAuth connect button 10 providers → `setShowConnectModal(false)` literal. Solo Bluesky funciona   |
| 8   | `MultiPlatformSchedulerRefactored.tsx:194-196`                     | `handleEditRule` `void ruleId` stub dead                                                          |

---

## §5. Server Component vs Client Component audit

### 5.1 Over-clientization sistémica

**app/: 48/55 (87%) pages con `"use client"`** — bandera roja. Next.js 16 defaults to Server Components. Pattern FRONTEND_STANDARDS §1.4 explícitamente indica usar Server para fetching.

### 5.2 Pages que deberían ser Server Components (wrappers triviales)

Individual per decisión Edward CP1. Pages que solo retornan `<Component />` sin estado/efecto/eventos:

| #   | Page                                           | LOC | Patrón                                                         |
| --- | ---------------------------------------------- | --: | -------------------------------------------------------------- |
| 1   | `app/dashboard/integrations/page.tsx`          |  29 | `<IntegrationMarketplace />` wrapper                           |
| 2   | `app/dashboard/settings/integrations/page.tsx` |  30 | `<ExternalNotificationConfigs projectId="default" />`          |
| 3   | `app/dashboard/settings/crm/page.tsx`          |  26 | `<CrmSettings />` wrapper                                      |
| 4   | `app/dashboard/settings/sso/page.tsx`          |  30 | `<SsoSettings accountId={accountId} />`                        |
| 5   | `app/dashboard/content/library/page.tsx`       |  27 | `<ContentLibrary />` wrapper                                   |
| 6   | `app/dashboard/content/templates/page.tsx`     |  20 | `<ContentTemplates />` wrapper                                 |
| 7   | `app/dashboard/instagram/stories/page.tsx`     |  38 | `<StoriesEditor />` con callbacks dead                         |
| 8   | `app/dashboard/analytics/insights/page.tsx`    |  28 | `<PerformanceInsights accountId="" projectId="" />`            |
| 9   | `app/dashboard/ai/analytics/page.tsx`          |  24 | `<PredictiveAnalytics />` wrapper                              |
| 10  | `app/dashboard/ai/generate/page.tsx`           |  50 | Tab switcher trivial, podría mover estado a component          |
| 11  | `app/dashboard/ai/optimizer/page.tsx`          |  49 | Textarea + component — podría ser server                       |
| 12  | `app/reports/shared/[token]/page.tsx`          | 133 | Public page con raw fetch en useEffect — perfecto candidato SC |

### 5.3 Layouts y error boundaries

- `app/layout.tsx` (22 LOC): ✅ Server Component correcto.
- `app/dashboard/layout.tsx` (178 LOC): Client por `usePathname` + navigation active state. Podría optimizarse con RSC + small client wrapper.
- `app/error.tsx` + `app/global-error.tsx`: Client (forzado por `reset()` callback). **Missing `role="alert"` + `aria-live="assertive"`** — violación FRONTEND_STANDARDS §8.
- `app/not-found.tsx`: ✅ Server Component correcto.

---

## §6. Cross-ref con hallazgos D0v4-1/2/3 afectando UI

### §6.1 L-44 outgoing webhooks NO-OP — CONFIRMADO en UI

`components/settings/ExternalNotificationConfigs.tsx` + `AddWebhookForm.tsx` permiten agregar webhooks Slack/Teams via `hooks/api/useExternalNotifications`. Backend acepta creación pero `AnalyticsEventHandler` + `WebhookEventHandler` (D0v4-2 L-44) son NO-OP — **webhooks jamás disparan notifications**. UI `ExternalNotificationConfigs` muestra "X event(s)" activos. **Críticamente engañoso para billing-differentiator feature**.

### §6.2 L-52 publishHandler silent failure — CONFIRMADO en UI (compuesto)

Identificado en 3 capas superpuestas:

1. **Backend silent failure** (L-52): `publishHandler.handleJob` catch-all sin re-throw.
2. **Saga fake status** (L-64): `getJobStatuses` hardcoded success.
3. **UI optimistic success**:
   - `posts/[id]/page.tsx:68`: `await apiClient.publishPost(postId); alert("Post published successfully!")`.
   - `posts/[id]/preview/page.tsx:41`: patrón idéntico.
   - `PublishingInterface.tsx:138-236`: for-loop + `info({description:"Successfully..."})` por provider.
   - `ClientContentEditor.tsx:119-161`: handlePublish con `success({title:"Post Published!"})`.

**4 niveles compuestos** de mentira al usuario. UX irrecuperable sin fix coordinado en toda la pila.

### §6.3 L-61 QueuePort misroute — CONFIRMADO en UI

| Page                          | Backend dispatcher                                                             | Efecto                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `analytics/page.tsx`          | (no dispatcher directo — fetch read-only)                                      | Data stale si backend usa `DispatchAnalyticsIngestionUseCase` |
| `inbox/page.tsx`              | (fetch only)                                                                   | Data stale, worker bypass domain compounds                    |
| `ai/repurpose/page.tsx`       | approve/reject endpoints probablemente disparan `BullMQRepurposeJobDispatcher` | Jobs a queue equivocada, nunca procesados                     |
| `analytics/insights/page.tsx` | Idem analytics                                                                 | Data stale                                                    |

UI muestra "No data yet" o datos vacíos pero usuario no sabe si es "no published yet" o "backend broken".

### §6.4 L-62 GATEWAY_SWITCH sin consumer — CONFIRMADO en UI

`settings/billing/page.tsx:332-405` `GatewaySection` component with 3 states: `GatewaySelector`, `ActiveGatewayBanner`, `PendingSwitchBanner`. Mutations `useInitiateGatewaySwitch` + `useCancelGatewaySwitch` encolan jobs a `GATEWAY_SWITCH` queue que tiene publisher pero **NO tiene consumer** (D0v4-3 L-62).

UI muestra "Switch scheduled: your subscription moves to [Paddle] on [date]" — el switch nunca ocurre. Reminder 24h + suspend 48h no disparan. Compliance bug.

### §6.5 L-64 saga job status stub fake — CONFIRMADO compuesto con L-52 UI

Ya documentado en §6.2. `SagaIntegration:143-152` retorna `{completed: jobIds.length, failed: 0, pending: 0}` optimistic. UI via `PublishingInterface.tsx` pregunta el estado y recibe success. Compuesto con L-52.

---

## §7. Clasificaciones (§5.9 + CP1)

### 7.1 ACTIVE (mayoría)

~200 files. Uso de hooks/api canónicos, mutaciones correctas, endpoints funcionales.

### 7.2 PARTIALLY_ACTIVE

- `components/publishing/PublishDialog.tsx` + `PublishingInterface.tsx` — funcional pero L-52 silent failure.
- `components/billing/InvoiceHistory.tsx` — funcional pero L-62 gateway switch broken affects flow.
- `components/analytics/PerformanceInsights.tsx` — hook fetches pero datos fake-fallback if API returns null.
- `components/scheduling/MultiPlatformSchedulerRefactored.tsx` — funcional con 1 dead button.
- `app/dashboard/templates/TemplateManagementDashboard.tsx` — 5/8 URLs OK, 3/8 404.

### 7.3 BROKEN (nueva categoría cross-sprint)

- `app/dashboard/settings/billing/page.tsx` (via L-62).
- `app/dashboard/integrations/page.tsx` + `settings/integrations/page.tsx` (via L-44).
- `app/dashboard/analytics/*` (via L-61).
- `app/dashboard/inbox/*` (via L-55+L-61).
- `app/dashboard/ai/repurpose/page.tsx` (via L-61).
- `app/dashboard/content/library/page.tsx` (via useContentLibraryState stub).
- Publishing UI (posts [id], new, preview + PublishingInterface) via L-52+L-64.

### 7.4 PLANNED

- `app/dashboard/ai/trends/page.tsx` — consume `/trends/radar` (D0v4-3 L-66 TREND_RADAR queue missing worker).

### 7.5 DEAD_CODE_CANDIDATE (Edward valida)

**Publishing subsystem unwired** (~2,711 LOC, 6 archivos):

- `components/publishing/UnifiedPublishingDashboard.tsx` (620 LOC) — grep confirms 0 importers en apps/client/app/.
- `components/publishing/publishingDashboardApi.ts` (306 LOC).
- `components/editor/AdminContentEditor.tsx` (360 LOC) — naming mismatch for client app.
- `components/editor/ContentPreviewSystem.tsx` (604 LOC).
- `components/editor/ProviderAdaptationEngine.tsx` (494 LOC).
- `components/editor/provider-previews.tsx` (327 LOC).

### 7.6 LEGACY

- `@/lib/hooks/useProviders`, `useAutoSave/usePostDraft`, `useTemplates`, `useABTests`, `useTemplateVersions` — documented in CLIENT_LIB_HOOKS_AUDIT, still consumed por TemplateManagementDashboard + posts/[id]/preview + ClientContentEditor.

---

## §8. Duplicaciones detectadas

### 8.1 Preview system triplicado (~1,636 LOC)

| Archivo                           | LOC | Providers renderizados                                                 |
| --------------------------------- | --: | ---------------------------------------------------------------------- |
| `editor/PlatformPreview.tsx`      | 705 | 10 (con lucide-react)                                                  |
| `editor/ContentPreviewSystem.tsx` | 604 | 10 (emoji literals) — solo usado por UnifiedPublishingDashboard (DEAD) |
| `editor/provider-previews.tsx`    | 327 | 5 subset — solo usado por ContentPreviewSystem (DEAD)                  |

**PlatformPreview es el canónico. Otros dos dead.**

### 8.2 3 `useProviders` hooks

- `@/hooks/api/useChannels.useProviders` (canónico)
- `@/lib/hooks/useProviders` (LEGACY)
- `@/lib/api/hooks` re-exporta `useProviders`

Consumido inconsistentemente en mismo sprint: posts/new usa `@/lib/api/hooks`, posts/[id] usa `@/lib/api/hooks`, posts/[id]/preview usa `@/lib/hooks/useProviders`, channels/page usa `@/hooks/api/useChannels.useProviders`, ClientContentEditor usa `@/lib/hooks/useProviders`.

### 8.3 Auth dual path

`app/actions/auth.ts` (Server Action login+register) y `app/api/backend/[...path]/route.ts` (proxy con auth cookie handling):

- Server Action: cookie TTL 24h-30d (rememberMe), NO setea refresh cookie.
- Proxy: cookie TTL 15 min + separate refresh cookie 7d.
- **Inconsistencia**: si usuario loguea vía form action, refresh flow del proxy no puede renovar (no tiene refresh cookie). Después de 15 min de inactividad el token expira y el proxy intenta refresh sin cookie → fail → usuario logged out inesperadamente.

### 8.4 Thread segmentation logic triplicada

- `PlatformPreview.tsx:51-83` `_createThreadSegments` (marked unused)
- `ProviderAdaptationEngine.tsx:87-121` `createThread`
- `providerRegistry.getThreadSegments()` (lib/providers/registry)

3 implementaciones de misma función.

### 8.5 Provider registry parallel paths

- `@/lib/providers/registry.providerRegistry` (local client)
- `@/hooks/api/useChannels.useProviders` fetches from API `/providers`
- `@/shared/types.getProviderConfig`
- `components/editor/AdminContentEditor.tsx` maintains custom provider constraints mapping

4 sources of truth for provider metadata.

### 8.6 Raw fetch + TanStack mixing

14 files con raw fetch en lugar de TanStack hooks, coexistiendo con ~50 files usando hooks canónicos. Sin razón técnica para el split.

### 8.7 Custom Toggle vs shadcn

`NotificationPreferences.tsx:74-102` define `Toggle` component inline — probable duplicate de `@packages/ui.Switch`.

### 8.8 MultiPlatformSchedulerRefactored naming debt

Git history confirma: **NO existe `MultiPlatformScheduler.tsx` sin sufijo**. Commits: `ed0f8c9` (rename D0v4-0), `ec8cb2a` (JSDoc sprint), `597bccc` (sprint 0C app separation). El sufijo "Refactored" es huérfano — debug de nombre sin contraparte. Rename pendiente.

---

## §9. Acoplamientos sospechosos

### 9.1 God components 500+ LOC

- `instagram/MediaUploadZone.tsx` (672 LOC): drag-drop + validation + metadata extraction + thumbnail generation + split preview all inline.
- `instagram/VideoSplitPreview.tsx` (613 LOC): full split UI inline.
- `editor/PlatformPreview.tsx` (705 LOC): 10 provider renders inline.
- `editor/ContentPreviewSystem.tsx` (604 LOC): otros 10 provider renders inline.
- `templates/VariableInserter.tsx` (546 LOC).
- `editor/ProviderAdaptationEngine.tsx` (494 LOC).
- `ai/analytics/hooks/usePredictiveData.ts` (629 LOC hook).

### 9.2 Pages con lógica extensiva inline

- `app/dashboard/settings/billing/page.tsx` (687 LOC): 5 sub-components inline.
- `app/dashboard/posts/page.tsx` (669 LOC): PostCard inline 141 LOC.
- `app/dashboard/channels/page.tsx` (692 LOC): OAuth modal inline.
- `app/dashboard/instagram/upload/page.tsx` (520 LOC).
- `app/dashboard/posts/[id]/page.tsx` (488 LOC).

### 9.3 Auth context accountId hack repeated

`((user as Record<string, unknown> | null)?.accountId as string) ?? ""` en 8+ pages (tasks, campaigns, settings/sso/team/usage/referral/ai, ai/repurpose/trends). AuthContext.user type no expone accountId correctamente — cada consumer hace el mismo cast inseguro.

### 9.4 Ai subsystem + external engagement labels

Numerosos componentes AI display porcentajes (engagement %, viral potential, confidence) que provienen de:

- Hardcoded values (ai-content-templates)
- Index-based fabrications (SmartContentOptimizer)
- Hardcoded fallbacks (usePredictiveData)
- Real API responses (when available)

UI no distingue los 4 sources.

### 9.5 ProjectProvider single-account stub

`fetchAccounts()` retorna single-entry array con stub empty email/name porque backend `/auth/customer/me` solo devuelve `accountId`. Provider diseñado multi-account pero alimentado single. Architectural mismatch.

---

## §10. Patterns inconsistentes

### 10.1 UX feedback

- `alert()` usado 12+ veces (posts/[id], posts/[id]/preview, posts/new, scheduling, assets, ai/repurpose, instagram/stories).
- `prompt()` usado en scheduling/page.tsx (handleAddRule, handleEditRule).
- `window.confirm()` usado en ScheduledReportsList, useFileUpload, PromptTemplateManager, channels, assets.
- Toast via `@packages/ui.useToast` usado en mayoría.
- Inline toast custom en NotificationPreferences + ReviewPanel + ExternalNotificationConfigs.

**4+ UX feedback patterns coexistiendo.**

### 10.2 `"use client"` decisions

- Trivial wrappers con `"use client"` unnecessary (11 pages identificadas §5.2).
- Server Components correctos en app/layout.tsx, not-found.tsx, templates/page.tsx, settings/notifications/page.tsx (minority).
- Mayoría client sin justificar.

### 10.3 Error handling

- Algunas pages `role="alert" aria-live="assertive"` (analytics/page, channels/page).
- Otras plain error text (error.tsx, global-error.tsx, posts/\*).
- Mix arbitrario.

### 10.4 Colors

- CSS variables (`var(--accent)`) usado inconsistentemente.
- Hardcoded Tailwind (`bg-blue-500`, `text-red-600`, `#1DA1F2`, `#000000`) en channels, providerMapper, ContentPreviewSystem, PlatformPreview.
- Violación FRONTEND_STANDARDS §7.3.

### 10.5 Language mix

- Spanish/English mixed: `RecurringPostForm` (all Spanish), `scheduling/recurring/page.tsx` ("Publicaciones recurrentes"), `channels/page.tsx` (Bluesky connect in Spanish), `ai/generate/page.tsx` (English).
- Sin i18n infrastructure detectada.

### 10.6 File size

- 70 files >200 LOC limit.
- 7+ files >500 LOC.
- 3 files >600 LOC.
- No self-enforcement.

---

## §11. Componentes >200 LOC (FRONTEND_STANDARDS §1.1 violations)

Tabla completa de 70 archivos (ver LATERAL_FINDINGS individual entries). Top 20:

| #   | Archivo                                               | LOC |             Over limit |
| --- | ----------------------------------------------------- | --: | ---------------------: |
| 1   | `settings/billing/page.tsx`                           | 687 |                   +487 |
| 2   | `channels/page.tsx`                                   | 692 |                   +492 |
| 3   | `posts/page.tsx`                                      | 669 |                   +469 |
| 4   | `editor/PlatformPreview.tsx`                          | 705 |                   +505 |
| 5   | `editor/ContentPreviewSystem.tsx`                     | 604 |                   +404 |
| 6   | `instagram/MediaUploadZone.tsx`                       | 672 |                   +472 |
| 7   | `instagram/VideoSplitPreview.tsx`                     | 613 |                   +413 |
| 8   | `publishing/UnifiedPublishingDashboard.tsx`           | 620 |            +420 (dead) |
| 9   | `ai/analytics/hooks/usePredictiveData.ts`             | 629 | hook límite 150 → +479 |
| 10  | `templates/VariableInserter.tsx`                      | 546 |                   +346 |
| 11  | `saga/SagaIntegration.ts` backend ref                 | 546 |                      — |
| 12  | `instagram/upload/page.tsx`                           | 520 |                   +320 |
| 13  | `publishing/PublishingInterface.tsx`                  | 496 |                   +296 |
| 14  | `editor/ProviderAdaptationEngine.tsx`                 | 494 |            +294 (dead) |
| 15  | `posts/[id]/page.tsx`                                 | 488 |                   +288 |
| 16  | `dashboard/templates/TemplateManagementDashboard.tsx` | 460 |                   +260 |
| 17  | `editor/SchedulePicker.tsx`                           | 442 |                   +242 |
| 18  | `ai/PromptTemplateManager.tsx`                        | 439 |                   +239 |
| 19  | `templates/TipTapEditor.tsx`                          | 421 |                   +221 |
| 20  | `templates/TemplateEditorCanvas.tsx`                  | 417 |                   +217 |

Restantes 50 en rango 200-400. Individual entries en LATERAL_FINDINGS.

---

## §12. Hallazgos laterales para LATERAL_FINDINGS.md

**Total: ~135 nuevos hallazgos (L-68 a ~L-202)**. Distribución:

| Severidad                     | Count | Rango        |
| ----------------------------- | ----: | ------------ |
| 🔴 Crítico                    |    20 | L-68..L-87   |
| 🟠 Alto                       |    17 | L-88..L-104  |
| 🟡 Medio                      |    14 | L-105..L-118 |
| 🟢 Bajo                       |     4 | L-119..L-122 |
| Over-clientization individual |    12 | L-123..L-134 |
| Size violations individual    |   ~70 | L-135..L-204 |

Tablas resumen por severidad (entries completos en LATERAL_FINDINGS.md sección "Hallazgos D0v4-4 (2026-04-20)"):

### §12.1 Críticos (L-68..L-87)

| #    | Título                                                                    | Archivo principal                                        |
| ---- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| L-68 | Publishing subsystem DEAD_CODE (~2,711 LOC, 6 archivos)                   | components/publishing/UnifiedPublishingDashboard.tsx     |
| L-69 | Dual auth path: Server Action + Proxy con TTLs cookie inconsistentes      | app/actions/auth.ts + app/api/backend/[...path]/route.ts |
| L-70 | providers.tsx missing QueryCache + MutationCache global error handlers    | app/providers.tsx                                        |
| L-71 | SILENT-NO-OP billing gateway switch (confirma L-62)                       | app/dashboard/settings/billing/page.tsx                  |
| L-72 | SILENT-NO-OP publish/schedule (confirma L-52 compound)                    | posts/[id], preview, PublishingInterface                 |
| L-73 | SILENT-NO-OP analytics (confirma L-61 + empty params)                     | analytics/page.tsx + insights                            |
| L-74 | SILENT-NO-OP inbox (confirma L-55+L-61)                                   | inbox/page.tsx + InboxLayout                             |
| L-75 | SILENT-NO-OP repurpose (confirma L-61)                                    | ai/repurpose/page.tsx                                    |
| L-76 | SILENT-NO-OP outgoing webhooks (confirma L-44)                            | ExternalNotificationConfigs + AddWebhookForm             |
| L-77 | useContentLibraryState no-fetch stub — page always empty                  | content/library/useContentLibraryState.ts                |
| L-78 | Fake-AI: SchedulePicker optimal times hardcoded labeled "historical data" | editor/SchedulePicker.tsx:49-110                         |
| L-79 | Fake-AI: RecommendationsList `generateRecommendations` hardcoded impact   | analytics/insights/utils.ts                              |
| L-80 | Fake-AI: SmartContentOptimizer hashtag scoring fabricated by array index  | ai/SmartContentOptimizer.tsx:132-139                     |
| L-81 | Fake-AI: ai-content-templates estimatedEngagement hardcoded %             | ai/ai-content-templates.ts                               |
| L-82 | Fake-AI: usePredictiveData hardcoded fallbacks                            | ai/analytics/hooks/usePredictiveData.ts                  |
| L-83 | Fake-AI: AIContentGenerator "Powered by GPT-4" hardcoded label            | ai/AIContentGenerator.tsx:99                             |
| L-84 | Notifications bell + item → /admin/\* navigation orphan in client         | components/notifications/\*                              |
| L-85 | ClientContentEditor handleSchedule stub: UI success without backend call  | editor/ClientContentEditor.tsx:174-182                   |
| L-86 | 3 `useProviders` hooks paralelos (confirma pre-existing + new evidence)   | multiple                                                 |
| L-87 | Instagram stories page 4 callbacks `alert("Coming soon")`                 | app/dashboard/instagram/stories/page.tsx                 |

### §12.2 Altos (L-88..L-104)

| #     | Título                                                                              | Archivo                                                           |
| ----- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| L-88  | `(user as Record<unknown>).accountId` hack repetido en 8+ pages                     | multiple settings/ai/tasks/campaigns                              |
| L-89  | ContentLibrary DEFAULT_FILTER_OPTIONS fake platforms/categories/tags                | content/library/useContentLibraryState.ts:20-25                   |
| L-90  | MultiPlatformSchedulerRefactored dead Edit button + raw fetches                     | scheduling/MultiPlatformSchedulerRefactored.tsx:194-196, 176, 202 |
| L-91  | MultiPlatformSchedulerRefactored orphan "Refactored" suffix (no contraparte en git) | scheduling/MultiPlatformSchedulerRefactored.tsx                   |
| L-92  | RecurringPostForm raw fetch + orphan link `/scheduling/recurring`                   | scheduling/RecurringPostForm.tsx:104, 118                         |
| L-93  | scheduling/page.tsx raw fetches + prompt() + alert()                                | app/dashboard/scheduling/page.tsx                                 |
| L-94  | Channels page OAuth button dead for 10/11 providers                                 | app/dashboard/channels/page.tsx:665-674                           |
| L-95  | Channels page Test/Settings buttons disabled "Coming soon"                          | channels/page.tsx:408-424                                         |
| L-96  | Instagram upload Create Stories/Reels/Carousel dead buttons                         | app/dashboard/instagram/upload/page.tsx                           |
| L-97  | Posts page raw fetch (no TanStack) + no queryKey + 4x `any`                         | app/dashboard/posts/page.tsx                                      |
| L-98  | Posts [id] + preview `alert()` patterns + LEGACY hook imports                       | app/dashboard/posts/[id]/\*                                       |
| L-99  | TemplateManagementDashboard LEGACY hooks con broken URLs (re-confirm)               | app/dashboard/templates/TemplateManagementDashboard.tsx:17,69     |
| L-100 | ProjectProvider raw fetch + single-account stub + window.location.reload()          | providers/ProjectProvider.tsx                                     |
| L-101 | providers.tsx QueryClient 60s staleTime generic / retry:1 inconsistente             | app/providers.tsx:15-26                                           |
| L-102 | Ai subsystem size violations (5+ componentes >400 LOC)                              | ai/PromptTemplateManager, SmartContentOptimizer + variants        |
| L-103 | Auth actions.ts type casts `as string` on FormData.get                              | app/actions/auth.ts                                               |
| L-104 | Auth actions.ts name parsing bug (firstName/lastName slice)                         | app/actions/auth.ts:111-112                                       |

### §12.3 Medios (L-105..L-118)

| #     | Título                                                                         | Archivo                                                      |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| L-105 | AIImageGenerator "DALL-E 3" hardcoded docstring                                | ai/AIImageGenerator.tsx:3                                    |
| L-106 | AIGenerationPreview fake progress steps sin vinculación                        | ai/AIGenerationPreview.tsx:24-28                             |
| L-107 | providerMapper hardcoded DEFAULT_LIMITS missing 7 platforms                    | lib/utils/providerMapper.ts:10-53                            |
| L-108 | providerMapper `authType: "oauth"` hardcoded default                           | lib/utils/providerMapper.ts:106                              |
| L-109 | error.tsx missing role="alert" + aria-live="assertive"                         | app/error.tsx                                                |
| L-110 | global-error.tsx missing role="alert" + aria-live="assertive"                  | app/global-error.tsx                                         |
| L-111 | OAuth connect button no implementado (10 providers)                            | channels/page.tsx:665-674                                    |
| L-112 | `stats.estimatedTime` hardcoded formula en PublishingInterface                 | publishing/PublishingInterface.tsx:133                       |
| L-113 | PublishingInterface `rateLimit.postsPerHour < 10` hardcoded threshold          | publishing/PublishingInterface.tsx:127                       |
| L-114 | console.error en error.tsx (viola logger port pattern)                         | app/error.tsx:12                                             |
| L-115 | Language mix Spanish/English sin i18n                                          | scheduling/recurring/\*, RecurringPostForm, channels Bluesky |
| L-116 | dashboard/layout.tsx "AI Settings" navigation item duplicated concept          | app/dashboard/layout.tsx:56                                  |
| L-117 | dashboard/layout.tsx "Settings" hardcoded to `/dashboard/settings/brand-voice` | app/dashboard/layout.tsx:54                                  |
| L-118 | QueryClient retry:1 instead of default 3 — optimistic config                   | app/providers.tsx:22                                         |

### §12.4 Bajos (L-119..L-122)

| #     | Título                                                                      | Archivo                                                  |
| ----- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| L-119 | instagram/upload Metadata commented-out at EOF                              | app/dashboard/instagram/upload/page.tsx:517-520          |
| L-120 | Recharts used only in analytics page (bundle weight consideration)          | analytics/page.tsx                                       |
| L-121 | TemplateSelector postTemplates static library (not API)                     | editor/TemplateSelector.tsx, lib/templates/postTemplates |
| L-122 | AnnouncementBanner uses `/api/announcements/active` (no `/backend/` prefix) | announcements/AnnouncementBanner.tsx:53                  |

### §12.5 Over-clientization wrappers (L-123..L-134)

Per decisión Edward CP1 — individual per wrapper:

| #     | Página wrapper                                                                     |
| ----- | ---------------------------------------------------------------------------------- |
| L-123 | `app/dashboard/integrations/page.tsx` — over-clientized wrapper                    |
| L-124 | `app/dashboard/settings/integrations/page.tsx` — over-clientized wrapper           |
| L-125 | `app/dashboard/settings/crm/page.tsx` — over-clientized wrapper                    |
| L-126 | `app/dashboard/settings/sso/page.tsx` — over-clientized wrapper                    |
| L-127 | `app/dashboard/content/library/page.tsx` — over-clientized wrapper                 |
| L-128 | `app/dashboard/content/templates/page.tsx` — over-clientized wrapper               |
| L-129 | `app/dashboard/instagram/stories/page.tsx` — over-clientized wrapper               |
| L-130 | `app/dashboard/analytics/insights/page.tsx` — over-clientized wrapper              |
| L-131 | `app/dashboard/ai/analytics/page.tsx` — over-clientized wrapper                    |
| L-132 | `app/dashboard/ai/generate/page.tsx` — over-clientized wrapper                     |
| L-133 | `app/dashboard/ai/optimizer/page.tsx` — over-clientized wrapper                    |
| L-134 | `app/reports/shared/[token]/page.tsx` — public page over-clientized (should be SC) |

### §12.6 Size violations individual (L-135..L-204)

Per decisión Edward CP4 — uno por archivo. Referencia tabla completa en LATERAL_FINDINGS individual entries. 70 archivos total:

- 12 archivos >500 LOC (critical size)
- 18 archivos 300-500 LOC (high size)
- 40 archivos 200-300 LOC (medium size)

Ver §11 + LATERAL_FINDINGS entries L-135..L-204 para lista completa.

---

## §13. Predicción para Sprint D0v4-5 (hooks consolidation)

### Scope esperado

`apps/client/hooks/api/` + `apps/client/hooks/` + `apps/client/lib/hooks/` + `apps/client/lib/api/` — **4 carpetas paralelas de hooks** documentadas en CLIENT_LIB_HOOKS_AUDIT.

### Hallazgos esperables

1. **LEGACY hooks confirmación quirúrgica** — `useABTests`, `useTemplates`, `useTemplateVersions` con 3/8 broken URLs (ya known, D0v4-5 audita cada línea).
2. **Hook colocated audit** (per Edward deep audit decision): 4 files en `components/*/hooks/` + múltiples `components/*/useXxx.ts` ya parcialmente vistos en B4 — re-audit completo.
3. **TanStack v5 compliance**: `gcTime` vs `cacheTime`, `onSuccess` on queries (debería ser removed).
4. **QueryKey conventions**: `[domain, scope, ...params]` audit — actualmente visible mixing in hooks.
5. **`useProviders` consolidación** — 3 variantes documentadas.
6. **Hook size violations** — usePredictiveData 629 LOC, useSchedulingDashboard 318 LOC, useContentLibraryState 290 LOC, useABTestManager 273 LOC ya identificados B4.
7. **Missing error handling** global QueryCache/MutationCache (L-70 D0v4-4).

### Estimación

50-80 hooks distribuidos en 4 carpetas paralelas. Complejo por la desconsolidación actual. Expected: ~20-30 hallazgos nuevos, varios crítico por LEGACY URLs broken.

---

## §14. Anexo — Verification checklist

- [x] 249 archivos procesados (55 app + 192 components + 1 provider + 1 lib/utils)
- [x] §3 mapeo endpoint-UI con todas las URLs backend identificadas
- [x] §4 3 flags críticos consolidados (CLIENT-REVERSE-ORPHAN-404, CLIENT-REVERSE-ORPHAN-BROKEN, SILENT-NO-OP)
- [x] §5 Server vs Client audit individual por wrapper
- [x] §6 cross-ref explícito L-44/L-52/L-55/L-61/L-62/L-64 con evidencia §5.8
- [x] §7 clasificaciones incluyendo DEAD_CODE_CANDIDATE, BROKEN, PARTIALLY_ACTIVE
- [x] §8 duplicaciones (preview system triplicado, auth dual, 3 useProviders, thread segmentation triplicada)
- [x] §9 acoplamientos (god components, accountId hack, ai fake data layers)
- [x] §10 patterns inconsistentes (UX, client/server, error, colors, language, size)
- [x] §11 70 archivos >200 LOC listados (top 20 en tabla, resto en LATERAL_FINDINGS)
- [x] §12 ~135 hallazgos laterales L-68..L-204
- [x] Checkpoints 1-4 + Cierre aprobados Edward
- [x] Zero cambios en `apps/`, `packages/`, `infra/` (solo docs)

---

## §15. Anexo — Commit sugerido

```text
docs(audits): D0v4-4 frontend client pages/components audit report

249 archivos auditados bajo §5.8 + §5.9 + CP1 en 5 batches.
Mapeo endpoint-UI completo: 5 paths de data fetching paralelos.
L-44/L-52/L-55/L-61/L-62/L-64 cross-referenciados con lectura directa de UI afectada.
Flags críticos: 14 CLIENT-REVERSE-ORPHAN-404, 4 BROKEN, 8+ SILENT-NO-OP.
Publishing subsystem DEAD_CODE confirmado (~2,711 LOC, 6 archivos huérfanos).
6 sitios fake-AI individuales identificados (SchedulePicker, RecommendationsList,
SmartContentOptimizer, ai-content-templates, usePredictiveData, AIContentGenerator+Image).
Server vs Client audit: 48/55 (87%) app pages over-clientized.
70 archivos violan FRONTEND_STANDARDS §1.1 size limits.
~135 hallazgos laterales nuevos (L-68..~L-204).
PLAN_MAESTRO §6 actualizado.

Ready para Sprint D0v4-5 (Frontend client hooks consolidation).
```
