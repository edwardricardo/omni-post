# Runbook — `ApiLatencyP99High`

> Alert: `prometheus/alerts/api.yml`
> SLO: `docs/observability/SLO.md#api`

## Síntoma

p99 HTTP request duration ha excedido 1000ms por más de 5min sostenido.

## Qué detecta

Saturación de DB, dependencias externas lentas, o algún endpoint con regression. La métrica `http_duration_bucket` agrupa todos los endpoints — el spike puede venir de un endpoint específico.

## Diagnóstico paso-a-paso

1. **Identificar el endpoint afectado**: abrir Grafana `api-performance` dashboard → filtrar por path. ¿Es un endpoint específico (e.g., `/ai/generate-localized`)? ¿O todos los endpoints?
2. **Inspeccionar deploys recientes**: `git log --oneline --since="6 hours ago"`. Hay deploy a main reciente que pueda haber introducido regression?
3. **Verificar Jaeger traces**: tracer.internal/search → filtrar últimos 30min → encontrar trazas > 1s → identificar el span dominante:
   - DB span lento → DB locks / missing index / connection pool exhausted.
   - Provider span lento (OpenAI, Twitter, etc.) → upstream API down — check `provider_publish_*` metrics + `https://status.<provider>.com`.
   - Internal compute lento → identificar la función + profile local.
4. **Verificar carga**: `httpRequests` rate / qué CPU/memory en host?

## Remediation

Por causa raíz:

- **DB-bound**: scale Postgres connection pool (env `DATABASE_URL` + `connection_limit` param). Add index si falta. Re-run query plan con `EXPLAIN ANALYZE`.
- **Provider-bound**: el circuit breaker (`packages/monitoring/circuit-breaker`) debería abrir en 60s. Si está abierto y la alerta persiste, el fallback strategy puede estar dejando passar carga al provider. Disable el endpoint vía feature flag temporal.
- **Internal compute**: rollback el deploy reciente vía `git revert <sha> && git push`. Investigar root cause en branch separada.
- **Carga genuina**: scale apps/api horizontally. Verify Redis cache hit rate — si baja, calentar caches.

## Cuándo escalar vs cuándo es ruido

- **Ruido**: spike de 5min seguido de auto-recovery (carga puntual, e.g., job cron). Si la alert se cierra en <10min y no hay user impact reportado, document + close.
- **Escalar**: alerta persiste > 15min OR alerta `ApiErrorRateHigh` co-fires.

## Links

- Grafana dashboard: `api-performance.json` panel "Request duration p50/p95/p99"
- Jaeger UI: `tracer.internal`
- Métrica: `http_duration_bucket{job="api"}`
- SLO target: API latency p99 < 1000ms (`docs/observability/SLO.md#api`)
