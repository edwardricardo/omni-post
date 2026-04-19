# Sprint Report: SEC-FIX — Security Hardening

## Resumen

Tres gaps de seguridad identificados en el audit cerrados:

1. IP allowlist ahora se enforce via middleware (antes era dead code)
2. CSRF tokens se validan en todos los mutations admin (antes solo en refresh)
3. Sentry integrado en las 4 apps (API, workers, admin, client)

---

## Archivos creados (7)

| Archivo                                          | Lineas | Descripcion                                                                       |
| ------------------------------------------------ | ------ | --------------------------------------------------------------------------------- |
| `apps/api/src/security/ipAllowlistMiddleware.ts` | 122    | Middleware con cache 60s, CIDR matching via ipaddr.js, X-Forwarded-For extraction |
| `apps/api/src/security/csrfMiddleware.ts`        | 70     | Valida X-CSRF-Token header contra AdminSession en DB                              |
| `apps/api/src/observability/sentryInit.ts`       | 70     | Init condicional de Sentry, lee DSN de MONITORING credentials                     |
| `apps/admin/sentry.client.config.ts`             | 18     | Sentry browser-side para admin                                                    |
| `apps/admin/sentry.server.config.ts`             | 15     | Sentry server-side para admin                                                     |
| `apps/client/sentry.client.config.ts`            | 18     | Sentry browser-side para client                                                   |
| `apps/client/sentry.server.config.ts`            | 15     | Sentry server-side para client                                                    |

## Archivos modificados (5)

| Archivo                                         | Cambio                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/index.ts`                         | +trustProxy:true, +IP allowlist onRequest hook, +CSRF preHandler hook, +Sentry init from MONITORING credentials |
| `apps/api/src/lib/errors/errorHandler.ts`       | +captureError() en errores 5xx (no-operacionales)                                                               |
| `apps/admin/app/api/backend/[...path]/route.ts` | +Forward cookie admin-csrf como header X-CSRF-Token                                                             |
| `apps/admin/next.config.mjs`                    | +withSentryConfig wrapper                                                                                       |
| `apps/client/next.config.mjs`                   | +withSentryConfig wrapper                                                                                       |

## Tests (2 archivos, 22 tests)

| Archivo                         | Tests | Cobertura                                                                                  |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| `ipAllowlistMiddleware.test.ts` | 12    | disabled/empty permite, exact IP, CIDR, block 403, exempt routes, cache, X-Forwarded-For   |
| `csrfMiddleware.test.ts`        | 10    | skip GET/HEAD/OPTIONS, skip exempt, missing 403, mismatch 403, match permite, no-auth skip |

---

## Detalle tecnico

### IP Allowlist

- Lee `SecuritySettings.ipAllowlistEnabled` + `ipAllowlist` de DB
- Cache de 60s (evita query en cada request)
- Soporta IPs exactas y CIDR notation via `ipaddr.js`
- `trustProxy: true` configurado en Fastify para X-Forwarded-For
- Excluye: `/health`, `/metrics`, `/api/settings/public`, login, password reset
- Solo aplica a rutas `/admin/*`

### CSRF

- Opcion implementada: **Forward en proxy** (Option B del plan)
- El proxy Next.js lee cookie httpOnly `admin-csrf` y la forwarda como header `X-CSRF-Token`
- Backend valida header contra `AdminSession.csrfToken` en DB
- Skip: GET/HEAD/OPTIONS (safe methods), login, refresh, password reset
- Sin cambios en el frontend — el proxy maneja todo transparentemente

### Sentry

- **API/Workers**: DSN desde BD (MONITORING > sentryDsn via PlatformCredentialService)
- **Admin/Client**: DSN desde env var (`NEXT_PUBLIC_SENTRY_DSN`) — limitacion de Next.js build-time
- Solo captura errores 5xx (no-operacionales) — 4xx no se reportan a Sentry
- Idempotente — llamar initSentry() multiples veces es seguro
- Deshabilitado en `NODE_ENV=test`
- Filtro: errores ECONNREFUSED/ENOTFOUND no se envian (ruido de red)

---

## Verificacion

- API build: 0 errores TS
- Admin build: 0 errores TS
- Client build: 0 errores TS
- Security tests: 22/22 passed
- trustProxy configurado en index.ts
- CSRF forwarding en proxy verificado
