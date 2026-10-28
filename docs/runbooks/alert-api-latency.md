# Runbook — `ApiLatencyP99High`

> Alert: `prometheus/alerts/api.yml`
> SLO: `docs/observability/SLO.md#api`

## Symptom

p99 HTTP request duration has exceeded 1000ms for more than 5min, sustained.

## What it detects

DB saturation, slow external dependencies, or an endpoint with a regression. The `http_duration_bucket` metric groups every endpoint — the spike may come from one specific endpoint.

## Step-by-step diagnosis

1. **Identify the affected endpoint**: open the Grafana `api-performance` dashboard → filter by path. Is it one specific endpoint (e.g., `/ai/generate-localized`)? Or every endpoint?
2. **Inspect recent deploys**: `git log --oneline --since="6 hours ago"`. Is there a recent deploy to main that may have introduced a regression?
3. **Check the Jaeger traces**: tracer.internal/search → filter the last 30min → find traces > 1s → identify the dominant span:
   - Slow DB span → DB locks / missing index / connection pool exhausted.
   - Slow provider span (OpenAI, Twitter, etc.) → upstream API down — check the `provider_publish_*` metrics + `https://status.<provider>.com`.
   - Slow internal compute → identify the function + profile it locally.
4. **Check the load**: `httpRequests` rate / what CPU/memory on the host?

## Remediation

By root cause:

- **DB-bound**: scale the Postgres connection pool (env `DATABASE_URL` + the `connection_limit` param). Add an index if one is missing. Re-run the query plan with `EXPLAIN ANALYZE`.
- **Provider-bound**: the circuit breaker (`packages/monitoring/circuit-breaker`) should open within 60s. If it is open and the alert persists, the fallback strategy may be letting load through to the provider. Disable the endpoint with a short-lived feature flag.
- **Internal compute**: roll back the recent deploy with `git revert <sha> && git push`. Investigate the root cause on a separate branch.
- **Genuine load**: scale apps/api horizontally. Verify the Redis cache hit rate — if it drops, warm the caches.

## When to escalate and when it is noise

- **Noise**: a 5min spike followed by automatic recovery (a one-off load, e.g., a cron job). If the alert closes in <10min and no user impact is reported, document + close.
- **Escalate**: the alert persists > 15min OR the `ApiErrorRateHigh` alert co-fires.

## Links

- Grafana dashboard: `api-performance.json` panel "Request duration p50/p95/p99"
- Jaeger UI: `tracer.internal`
- Metric: `http_duration_bucket{job="api"}`
- SLO target: API latency p99 < 1000ms (`docs/observability/SLO.md#api`)
