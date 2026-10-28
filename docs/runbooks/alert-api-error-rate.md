# Runbook — `ApiErrorRateHigh`

> Alert: `prometheus/alerts/api.yml`
> SLO: `docs/observability/SLO.md#api`

## Symptom

The rate of HTTP 5xx responses has exceeded 5% for more than 5min, sustained.

## Severity: CRITICAL

This alert indicates a **user-facing failure**. Customers are seeing 5xx right now.

## Step-by-step diagnosis

1. **Capture the exact volume**: Grafana `api-performance` → panel "5xx rate". What is the real percentage now? Is it growing or stable?
2. **Identify the affected endpoint(s)**: filter by path. If it is concentrated on one (e.g., `/posts`), it is a feature regression. If it is spread out, it is infrastructure (DB, Redis, downstream).
3. **Inspect Sentry for the last 30min**: group by exception type. Is there a new error? Or is it a spike of a known one?
4. **apps/api logs**: `pnpm dev:api` host → `grep ERROR` over the last 30min. Which module do the stack traces point to?
5. **Inspect recent deploys**: is there a deploy to main in the last 6 hours? If so, **roll back immediately** + investigate.
6. **Check the dependencies**:
   - Postgres: `pg_isready -h omnipost-infra`
   - Redis: `redis-cli -h omnipost-infra ping`
   - Health endpoints: `curl /health/ready`

## Remediation

- **Deploy regression**: `git revert <sha> && git push` → re-deploy. Investigate the root cause separately.
- **Postgres down/slow**: review the `verifyDatabaseAuth` logs + the Postgres logs. Scale the connection pool.
- **Redis down**: `apps/api` should degrade gracefully (it should not be a 5xx). If it produces 5xx, there is a bug in the error handling — fix it + redeploy.
- **External API failure** (provider HTTP 5xx propagated): the adapter should absorb it with a circuit breaker. If it does not, the adapter has a bug.
- **OOM**: heap profile + restart the pod. Investigate the leak.

## When to escalate

- Rate > 10% sustained > 10min → page on-call immediately.
- Rate < 10% but `ApiLatencyP99High` co-fires → a DB/infra issue is likely.
- If the rollback does not fix it → escalate to the backend team lead.

## Links

- Grafana: `api-performance.json` panel "5xx rate by endpoint"
- Sentry: `sentry.io/organizations/omnipost/issues/?query=is:unresolved`
- Metrics: `http_requests_total{status=~"5.."}` / `http_requests_total`
- SLO: error rate < 1% (`docs/observability/SLO.md#api`)
