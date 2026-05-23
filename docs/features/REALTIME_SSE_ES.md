# Realtime por SSE — diseño y plan (analytics + notifications)

> Estado: **diseñado, en implementación** (B3 de la migración prisma→DI).
> Reemplaza un WebSocket de analytics que nunca funcionó. Plan canon-grounded
> (transporte + auth + streaming verificados en web + runtime).

## Context — por qué (todo verificado en runtime, no suposición)

El "realtime" del repo estaba **roto de punta a punta**:

- **WS `RealtimeAnalyticsService`** (`apps/api/src/analytics/realtimeAnalytics.ts`): nunca cableado
  (`registerWebSocketRoutes` no se llama en ningún lado) y su auth usa el **dominio equivocado**
  (`JWT_ACCESS_SECRET` + `decoded.userId`, i.e. admin/account) en vez del customer
  (`CUSTOMER_JWT_SECRET` + `sub`/`accountId`).
- **Proxy Next** (client y admin): buffea todo SSE con `await upstream.text()` — en un stream
  infinito nunca resuelve → cuelga. (`apps/client/app/api/backend/[...path]/route.ts`,
  `apps/admin/app/api/backend/[...path]/route.ts`.)
- **`useNotificationStream`** conecta **directo** a `NEXT_PUBLIC_API_URL` con `withCredentials`,
  pero la cookie `customer-session` es `SameSite=lax` → no viaja cross-origin (`:3200`→`:3000`),
  y el backend ni lee cookie (exige Bearer) → 401 loop infinito.

Verificación runtime (API arriba en `localhost:3000`, proxy client `:3200`):
`/notifications/stream` con **Bearer header → 200 `text/event-stream`** (el backend SSE es correcto);
con cookie → 401; vía proxy → timeout (buffer). Login de prueba:
`agency-alpha-owner@test.omnipost.local` / `TestPassword123!`.

## Canon (fuentes externas)

- **Transporte:** SSE es lo recomendado para push unidireccional server→client de métricas
  (RxDB, Ably, freeCodeCamp). WebSocket es para bidireccional.
- **Auth browser:** `EventSource` y WebSocket **no pueden** setear headers Authorization → dependen
  de cookie/query. OWASP: token-en-query se loguea (evitar); WS requiere check de `Origin` (CSWSH).
- **Next App Router:** **sí** streamea SSE devolviendo el `ReadableStream` upstream
  (`new NextResponse(upstream.body, …)`) + `export const dynamic="force-dynamic"` + header
  `X-Accel-Buffering: no`. El buffering actual es solo por usar `.text()`.

## Arquitectura

SSE **same-origin vía proxy**: el browser hace `EventSource("/api/backend/…stream")` (mismo origen
que la app Next) → el proxy inyecta `Authorization: Bearer` desde la cookie httpOnly `customer-session`
(ya lo hace) → el backend usa `requireClientAuth` **estándar** (sin auth bespoke, sin leer cookie en
backend). Entrega cross-pod vía un broadcaster Redis pub/sub espejo de `NotificationBroadcaster`.
Se **retira** la capa WebSocket (migrar, no propagar).

Patrón homólogo de referencia: `apps/api/src/notifications/notificationRoutes.ts` (`/notifications/stream`)

- `apps/api/src/services/NotificationBroadcaster.ts`.

## Cambios por archivo

**Backend (`apps/api`)**

- CREATE `src/services/AnalyticsStreamBroadcaster.ts` — Redis pub/sub `analytics-stream:<accountId>`
  - Map local de callbacks SSE; expone el set de postIds watched (para acotar el poll).
- REFACTOR `src/analytics/realtimeAnalytics.ts` — WS→SSE poller. Borrar todo lo WS
  (`registerWebSocketRoutes`, `handle*`, `authenticateWebSocket` [el bug], `sendMessage`,
  `startConnectionCleaner`, `triggerUpdate`, `getConnectionStats`, `ConnectionManager`, Maps).
  Conservar `calculateEngagementRate`, `generateConnectionId`, `getCurrentMetrics`, delta vs CachePort
  (`realtime-metrics:`, 24h TTL), `RealtimeMetrics`, poll 30s. `updateAllMetrics` → fuente = posts
  watched; sink = `broadcaster.broadcast(metrics, accountId)`.
- MODIFY `src/analytics/analyticsRoutes.ts` — `GET /analytics/stream` (`requireClientAuth`), espejo de
  `streamNotifications`: `getProjectAccess(accountId, projectId)` (fix del bug), headers SSE, snapshot
  inicial, `broadcaster.subscribe` con filtro por postSet, heartbeat por conexión, cleanup on close.
- DI: TOKENS + registro singleton en `setupServices.ts`; resolución en el plugin de rutas (sin WS).

**Proxy (shared) — `apps/client/app/api/backend/[...path]/route.ts`**

- `export const dynamic="force-dynamic"`; si la respuesta upstream es `text/event-stream` →
  passthrough de `upstream.body` con `X-Accel-Buffering: no` (antes del `.text()`). JSON/auth intacto.
- Admin (`apps/admin/.../route.ts`): mismo patch → backlog SMELL-30 (fuera de scope B).

**Frontend (`apps/client`)**

- MODIFY `hooks/useNotificationStream.ts` — URL same-origin `/api/backend/notifications/stream`.
- CREATE `hooks/useAnalyticsRealtime.ts` — `EventSource("/api/backend/analytics/stream?projectId=…")`,
  reconnect, cleanup; cada delta → `queryClient.setQueryData(["analytics","dashboard",…], merge)`
  (sin store nuevo; el poll 30s de `useAnalytics` re-baselina).
- MODIFY `app/[locale]/dashboard/analytics/page.tsx` — `useAnalyticsRealtime(projectId)` + indicador "live".

## Verificación

`tsc` 0 · eslint 0 · vitest unit (service, broadcaster, proxy, hook) · node:test integration
(`/analytics/stream`: 401/403/200 `text/event-stream`) · **E2E smoke real** (login + `curl -N` al proxy
con cookie → `text/event-stream` + `data:` en ~1s) · gitleaks · prettier · appsec review (auth/SSE).
