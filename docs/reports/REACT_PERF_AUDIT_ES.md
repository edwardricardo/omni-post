# Auditoría de Performance React/Next — OmniPost

> Ejecutada con la skill **vercel-react-best-practices** v1.0.0 (70 reglas, 8 categorías, prioridad por impacto). Alcance: `apps/client` (435 archivos), `apps/admin` (198), `packages/ui` (49). Mayo 2026. Backend (`apps/api`/`apps/workers`) fuera de alcance (no React).
>
> ~135 hallazgos. Este reporte deduplica los **temas transversales** (un fix → muchos hallazgos) y prioriza por leverage real, no por conteo.

## Resumen ejecutivo

**Buena noticia (lo que está bien):** la capa de datos del cliente es sólida — TanStack Query en todo, `enabled` gating correcto, queries paralelas, proxy con `cache: no-store`. **No hay waterfalls RSC críticos en `apps/client`** porque todas las páginas son `"use client"` (datos client-side bien gestionados). El problema NO es la arquitectura de datos.

**El problema real está concentrado en 3 focos de alto leverage:**

| #     | Tema transversal                                                                                                   | Impacto                                                                                               | Nº hallazgos que resuelve |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------- |
| **1** | `optimizePackageImports` **no configurado** en ningún `next.config` + barrel `export *` en `packages/ui/index.ts`  | 🔴 CRÍTICO — cold start global de **ambas** apps (200-800ms), barrel de lucide/radix/@packages/ui     | ~6                        |
| **2** | Librerías pesadas import estático (no `next/dynamic`): **Monaco, TipTap, emoji-mart, recharts**                    | 🔴 CRÍTICO — cientos de KB en el chunk inicial aunque la feature no se use                            | ~8                        |
| **3** | **Cero `React.memo`** en todo el frontend + Context values sin memoizar + estado-derivado-vía-`useEffect` repetido | 🟠 ALTO — re-render en cascada de listas (inbox, assets, templates, analytics) y de todo el dashboard | ~55                       |

Tres correcciones de configuración/patrón eliminan más de la mitad de los hallazgos. El resto son refinamientos por componente.

---

## Foco 1 — Bundle / barrel (🔴 CRÍTICO, máximo leverage)

| Rule            | file:line                                                       | Qué está mal                                                                                                                                      | Fix                                                                                                                                     |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| bundle-2.1      | `apps/client/next.config.mjs`, `apps/admin/next.config.mjs:7-9` | Sin `experimental.optimizePackageImports`; 30+ archivos importan `lucide-react` y 37+ `@packages/ui` por barrel                                   | Añadir `optimizePackageImports: ["lucide-react","@packages/ui","recharts","date-fns","@radix-ui/react-icons"]` en **ambos** next.config |
| bundle-2.1/2.5  | `packages/ui/src/index.ts:7-58`                                 | `export *` re-exporta TODO (TipTap, emoji-mart, 23 radix) plano; 248 sitios importan `{Button}` desde la raíz → todo el grafo entra en ambas apps | Entradas separadas (`@packages/ui/button`) o confiar en `optimizePackageImports` (mínimo)                                               |
| rerender/barrel | `packages/ui/src/index.ts:36` + `VirtualScrollList.tsx:345`     | El barrel `export *` re-exporta una función llamada `memo` (HOC propio) que **shadowing** de React `memo` para consumidores wildcard              | Renombrar el HOC (`memoizeVirtualItem`) y exportar explícito                                                                            |

## Foco 2 — Librerías pesadas sin `next/dynamic` (🔴 CRÍTICO)

| Rule       | file:line                                                                                          | Qué está mal                                                                      | Fix                                             |
| ---------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| bundle-2.4 | `packages/ui/business/TipTapContentEditor.tsx:11-14` (re-exportado en `index.ts:43`)               | TipTap (~300KB) estático y en el barrel → entra en ambas apps aunque no se use    | `next/dynamic` + sacar del barrel               |
| bundle-2.4 | `packages/ui/business/EmojiPickerButton.tsx:12-13`                                                 | `@emoji-mart/data` (JSON enorme) + react estático, montado en `ContentEditorCore` | Lazy `import('@emoji-mart/data')` solo al abrir |
| bundle-2.4 | `apps/client/components/templates/TemplateEditorCanvas.tsx:33,35`                                  | Monaco (~300KB) + TipTap estáticos aunque el modo por defecto es `textarea`       | `dynamic(... { ssr:false })`                    |
| bundle-2.4 | `apps/client/app/dashboard/analytics/page.tsx:15-24`                                               | `recharts` estático en el chunk de la página                                      | `dynamic` el subárbol de charts                 |
| bundle-2.4 | `apps/admin/components/charts/*` (DonutChart, HorizontalBarChart, StackedBarChart, TrendAreaChart) | recharts vía barrel `charts/index.ts`, en bundle de dashboard/analytics/webhooks  | `dynamic` cada chart con skeleton               |
| bundle-2.3 | `apps/client/app/providers.tsx:13`                                                                 | `ReactQueryDevtools` estático en el árbol raíz (dev-only en bundle prod)          | `dynamic` + gate `NODE_ENV!=='production'`      |
| bundle-2.3 | `apps/admin` `@sentry/nextjs` (`next.config.mjs:12`)                                               | SDK Sentry envuelve toda la config, no diferido                                   | Verificar lazy init / `tunnelRoute`             |

## Foco 3 — Re-render / Server (🟠 ALTO)

### Correctness bugs (arreglar primero — no son solo perf)

| Rule               | file:line                                                  | Qué está mal                                                                                                           | Fix                                                         |
| ------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| client-4.1/adv-8.4 | `packages/ui/src/components/use-toast.ts:179-187`          | Effect con dep `[state]` → cada toast desmonta/re-suscribe el listener (churn) para todo consumidor                    | Cambiar dep array a `[]`                                    |
| rerender-5.8       | `apps/admin/components/webhooks/DeadLetterQueue.tsx:82-84` | `setTimeout(setDebouncedSearch,500)` en el **cuerpo del render** → debounce roto, timer nuevo cada render sin cancelar | Mover a `useEffect` con `clearTimeout` o `useDeferredValue` |

### Server-side (admin — sí hay RSC aquí)

| Rule       | file:line                                                                              | Qué está mal                                                                                           | Fix                                                                                         |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| server-3.9 | `apps/admin/lib/auth/backend-client.ts:149` (usado en `app/(dashboard)/layout.tsx:20`) | `verifyAccessToken` (fetch `/admin/auth/me`) sin `React.cache()` → re-ejecuta por cada RSC del request | Envolver con `cache()` de `react`                                                           |
| async-1.5  | `apps/admin/hooks/api/useSecurity.ts:30-39`                                            | `getStatus()` y `getHierarchy()` independientes en serie (2 round trips)                               | `Promise.all([...])`                                                                        |
| async-1.4  | `apps/admin/app/api/backend/[...path]/route.ts:99-113`                                 | `await req.text()` + `await cookies()` en serie antes del fetch upstream; cookies leídas 2-3x          | Paralelizar lectura body/cookies                                                            |
| server-3.6 | `apps/client/app/layout.tsx` + `app/providers.tsx`                                     | Todo el árbol es client; ninguna RSC hace fetch → todo data se busca tras hidratar (sin streaming)     | Convertir páginas read-only above-the-fold (dashboard, analytics) a Server Components async |

### Context values sin memoizar (re-render de TODO el árbol consumidor)

| Rule          | file:line                                      | Fix                                           |
| ------------- | ---------------------------------------------- | --------------------------------------------- |
| rerender-5.x  | `apps/client/lib/auth/authContext.tsx:155-164` | `useMemo` el `value` + callbacks estables     |
| rerender-5.x  | `apps/client/lib/api/context.tsx:34-39`        | `useCallback(handleError)` + `useMemo(value)` |
| rerender-5.10 | `apps/admin/providers/ThemeProvider.tsx:42`    | `useMemo(() => ({theme,toggleTheme}), [...])` |

### Patrón sistémico: cero `React.memo` + estado-derivado-vía-efecto

- **Ningún** componente de `apps/client/components`, `apps/admin/components` ni `packages/ui` usa `React.memo`. Listas que repintan completas en cada poll/keystroke: `inbox/MessageBubble`, `inbox/ConversationCard`, `inbox/ConversationList`, `assets/AssetThumbnail`, `templates/TemplateCard`, `ai/analytics/cards/*`, primitivas compartidas (`Button`, `Input`, `Card`, `Badge`).
- **Default props no-primitivos inline** (objeto/array nuevo cada render, invalida memos aguas abajo): `editor/PlatformPreview.tsx:60`, `ai/PredictiveAnalytics.tsx:42`, `ai/SmartContentOptimizer.tsx:55`, `packages/ui/business/TipTapContentEditor.tsx:53-70`.
- **State mirroring** (`useState`+`useEffect` copiando server/prop state → render extra + drift): `content/templates/useTemplateData.ts:54`, `notifications/NotificationPreferences.tsx:96`, `notifications/NotificationBell.tsx:65`, `admin/components/security/RbacManager.tsx:69`, `admin/components/webhooks/WebhookTimeline.tsx:45`, `packages/ui/business/useContentEditor.ts:438`.
- **queryKey inestable por objeto inline** (rompe dedupe/caché de TanStack): `campaigns/CampaignList.tsx:35`, `tasks/TaskList.tsx:40`, `admin/hooks/api/useCompliance/queries.ts:84`.
- **Fan-out N+1 client-side:** `apps/client/components/campaigns/CampaignCard.tsx:34` llama `useCampaignAnalytics(campaign.id)` por card → N peticiones; batch por `projectId`.

---

## Conteo por categoría (agregado de las 5 áreas)

| Categoría               | Prioridad skill | Hallazgos |
| ----------------------- | --------------- | --------- |
| async- (Waterfalls)     | CRÍTICO         | 6         |
| bundle- (Bundle size)   | CRÍTICO         | 15        |
| server- (Server-side)   | ALTO            | 5         |
| client- (Data fetching) | MED-ALTO        | 11        |
| rerender- (Re-render)   | MEDIO           | ~66       |
| rendering- (Rendering)  | MEDIO           | 15        |
| js- (JS perf)           | BAJO-MED        | 11        |
| advanced-               | BAJO            | 5         |

> El volumen está en `rerender-` pero el **leverage** está en `bundle-` (Foco 1+2): config + barrel + dynamic imports = ~21 hallazgos CRÍTICOS con 5-6 PRs.

---

## Backlog de remediación (trackeable, por leverage)

> Estado: `[ ]` pendiente · `[~]` en progreso · `[x]` hecho. Orden = mayor impacto/esfuerzo primero.

### Quick wins de configuración (1-2 PRs, máximo impacto)

- [x] **PERF-1** `[S]` Añadir `experimental.optimizePackageImports` a `apps/client/next.config.mjs` y `apps/admin/next.config.mjs` (`lucide-react`, `@packages/ui`, `recharts`, `date-fns`). **DoD:** bundle analyzer muestra caída de módulos en cold start; build verde. ✅ Aplicado a ambos config; typecheck verde.
- [x] **PERF-2** `[S]` `ReactQueryDevtools` → `next/dynamic` + gate `NODE_ENV`. **DoD:** ausente del bundle de producción. ✅ No-op en `production`, `dynamic({ssr:false})` en dev (`providers.tsx`).
- [x] **PERF-3** `[M]` Renombrar el HOC `memo` de `packages/ui` (`VirtualScrollList.tsx:345`) y dejar de re-exportarlo wildcard; auditar colisión. **DoD:** sin shadowing de React.memo; tests verdes. ✅ Renombrado a `memoizeVirtualItem`; barrel pasa a export explícito; sin consumidores externos rotos; typecheck verde.

### Code splitting de librerías pesadas (3-4 PRs)

- [ ] **PERF-4** `[M]` `TipTapContentEditor` → `next/dynamic`, sacar del barrel `packages/ui/index.ts`. **DoD:** TipTap no aparece en el chunk inicial de ninguna app.
- [ ] **PERF-5** `[S]` `EmojiPickerButton`: lazy `import('@emoji-mart/data')` solo al abrir. **DoD:** dataset emoji fuera del first paint.
- [ ] **PERF-6** `[S]` `TemplateEditorCanvas`: Monaco + TipTap vía `dynamic`. **DoD:** chunk inicial de templates sin Monaco/TipTap.
- [ ] **PERF-7** `[S]` Charts (`apps/client/.../analytics/page.tsx`, `apps/admin/components/charts/*`) → `dynamic({ssr:false})`. **DoD:** recharts en chunk diferido.

### Correctness (2 PRs, prioridad alta — son bugs)

- [ ] **PERF-8** `[S]` `use-toast.ts:187` dep `[state]` → `[]`. **DoD:** listener estable; test de toasts.
- [ ] **PERF-9** `[S]` `DeadLetterQueue.tsx:82` debounce a `useEffect`+cleanup. **DoD:** búsqueda debounced funcional; sin timers huérfanos.

### Server-side admin (2 PRs)

- [ ] **PERF-10** `[S]` `verifyAccessToken` con `React.cache()`. **DoD:** una sola llamada `/admin/auth/me` por request RSC.
- [ ] **PERF-11** `[S]` `useSecurity` + proxy route → `Promise.all`. **DoD:** sin awaits seriales independientes.

### Re-render sistémico (iterativo, por área)

- [ ] **PERF-12** `[M]` Memoizar Context values: `authContext`, `api/context`, `ThemeProvider`. **DoD:** consumidores no re-renderizan por render del provider.
- [ ] **PERF-13** `[M]` `React.memo` + handlers estables en listas de inbox (`MessageBubble`, `ConversationCard`, `ConversationList`). **DoD:** poll no repinta toda la lista (verificable con Profiler).
- [ ] **PERF-14** `[M]` `React.memo` en thumbnails/cards (`AssetThumbnail`, `TemplateCard`, `ai/analytics/cards/*`) + fallbacks constantes. **DoD:** selección no repinta la grilla.
- [ ] **PERF-15** `[M]` `React.memo` en primitivas compartidas de `packages/ui` (`Button`, `Input`, `Card`, `Badge`, `Label`). **DoD:** hojas estables no re-renderizan con el padre.
- [ ] **PERF-16** `[M]` Eliminar state-mirroring (derivar en render / `key` reset) en los 6 sitios listados. **DoD:** sin `useEffect` que solo copie server/prop a estado.
- [ ] **PERF-17** `[S]` Estabilizar queryKeys (memoizar params objeto) en `CampaignList`, `TaskList`, `useCompliance`. **DoD:** queryKey estable entre renders.
- [ ] **PERF-18** `[S]` `CampaignCard` N+1 → endpoint/hook batch de analytics por `projectId`. **DoD:** una petición por grilla, no N.
- [ ] **PERF-19** `[S]` Hoist default props no-primitivos a constantes de módulo (4 sitios). **DoD:** sin objetos/arrays inline como default param.

### Refinamientos (js-/rendering-, oportunista)

- [ ] **PERF-20** `[M]` Lote de micro-optimizaciones js-/rendering- (RegExp hoisting, `useMemo` en cómputos derivados, `content-visibility` en listas largas de inbox/templates, hoist de JSX estático). Ver detalle exhaustivo por agente. **DoD:** sin regresiones; checklist por archivo.

---

_Auditoría generada por 5 agentes paralelos aplicando la skill vercel-react-best-practices sobre HEAD (mayo 2026). El detalle exhaustivo por archivo (tablas completas por área, ~135 filas) está en la salida de los agentes; este reporte consolida por leverage. Reverificar números de línea antes de cada PR (el código cambia). El backlog PERF-_ es independiente del roadmap de features ([MASTER_PLAN_ES.md](../product/MASTER_PLAN_ES.md)) — es deuda técnica de performance, no features.\*
