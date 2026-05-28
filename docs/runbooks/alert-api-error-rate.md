# Runbook — `ApiErrorRateHigh`

> Alert: `prometheus/alerts/api.yml`
> SLO: `docs/observability/SLO.md#api`

## Síntoma

Tasa de respuestas HTTP 5xx ha excedido 5% por más de 5min sostenido.

## Severidad: CRITICAL

Esta alerta indica **user-facing failure**. Customers están viendo 5xx ahora.

## Diagnóstico paso-a-paso

1. **Captura volumen exacto**: Grafana `api-performance` → panel "5xx rate". Cuál es el porcentaje real ahora? Se está creciendo o estable?
2. **Identificar endpoint(s) afectado(s)**: filtrar por path. Si concentrado en uno (e.g., `/posts`), es regression de feature. Si distribuido, es infra (DB, Redis, downstream).
3. **Inspeccionar Sentry últimos 30min**: agrupar por exception type. ¿Hay un error nuevo? ¿O es spike de uno conocido?
4. **Logs apps/api**: `pnpm dev:api` host → `grep ERROR` últimos 30min. Stack traces apuntan a qué módulo?
5. **Inspeccionar deploys recientes**: ¿Hay deploy a main en las últimas 6 horas? Si sí, **rollback inmediato** + investigar.
6. **Verificar dependencias**:
   - Postgres: `pg_isready -h omnipost-infra`
   - Redis: `redis-cli -h omnipost-infra ping`
   - Health endpoints: `curl /health/ready`

## Remediation

- **Deploy regression**: `git revert <sha> && git push` → re-deploy. Investigar root cause aparte.
- **Postgres down/slow**: revisar `verifyDatabaseAuth` logs + Postgres logs. Scale connection pool.
- **Redis down**: `apps/api` debería degradar gracefully (no debería ser 5xx). Si genera 5xx, hay bug en error handling — fixear + redeploy.
- **External API failure** (provider HTTP 5xx propagated): el adapter debería absorber con circuit breaker. Si no, el adapter tiene bug.
- **OOM**: heap profile + restart pod. Investigar leak.

## Cuándo escalar

- Tasa > 10% sostenido > 10min → page on-call inmediato.
- Tasa < 10% pero `ApiLatencyP99High` co-fires → DB/infra issue probable.
- Si rollback no corrige → escalar a backend team lead.

## Links

- Grafana: `api-performance.json` panel "5xx rate by endpoint"
- Sentry: `sentry.io/organizations/omnipost/issues/?query=is:unresolved`
- Métricas: `http_requests_total{status=~"5.."}` / `http_requests_total`
- SLO: error rate < 1% (`docs/observability/SLO.md#api`)
