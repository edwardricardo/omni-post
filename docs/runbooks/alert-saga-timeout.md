# Runbook — `SagaTimeoutSpike`

> Alert: `prometheus/alerts/saga.yml`
> SLO: `docs/observability/SLO.md#saga`

## Symptom

More than 3 sagas were marked FAILED by timeout in the last 10min.

## Severity: CRITICAL

Saga timeout = a saga step hung > 30min (the default timeout). If pre-pivot → compensation runs. If post-pivot → an inconsistent state is possible. Critical.

## What it detects

The horizon is evaluated in TWO places, with a single implementation (`SagaManagerLifecycle.terminalizeIfPastHorizon`):

- the timeout checker (`saga-timeout-checker`, 60s poll) walks the sagas this process tracks;
- **and every advancer**: before moving a saga, the execution pass asks the same question. That covers the rows the process NEVER tracked (deferred by the boot ceiling, or loaded by id), which used to depend on the retry budget to end.

It compares `Date.now() - instance.startedAt` against `definition.timeout` and calls `failSaga(instance, "Saga timeout exceeded", "timeout")`. Parked rows and COMPENSATING rows have their own horizons (the operator window and the walk's liveness) and do NOT fall under this one.

**THE DOMINANT CAUSE CHANGED.** A step that waits on external work (the publish jobs) no longer spends retry budget: it answers `waiting`, re-arms every `SAGA_WAIT_POLL_MS` (default 30 s) and only ends by THIS horizon. Before, "workers down" died in ~35 s as `reason="step-failure"` and never reached this alert; now it is the most likely cause of a timeout spike, and it arrives half an hour after the real incident, with the whole cohort at once.

Common causes, in order of likelihood today:

- **BullMQ jobs enqueued but not processed (workers down or not consuming).** Look at `saga_waiting_rows` and its alert `SagaWaitingRowsAccumulating` first: if it was rising, the incident started there, ~30 min before this spike.
- A step waiting on HTTP to a provider that is down (no circuit breaker timeout, or a timeout that is too long).
- A DB deadlock in a transaction the step starts.
- The recovery scheduler crashed and the retries/polls were left unprocessed.

## The waiting population (look at this BEFORE the spike)

```sql
-- Sagas waiting on external work NOW: RUNNING with a scheduled re-entry.
-- retryCount = 0 => it is waiting; > 0 => it is retrying after real failures.
SELECT id, "definitionId", "currentStep", "retryCount", "nextRetryAt", "startedAt"
FROM "SagaInstance"
WHERE status = 'RUNNING' AND "nextRetryAt" IS NOT NULL
ORDER BY "startedAt";
```

The same population is in Prometheus as `saga_waiting_rows` (a gauge measured at scrape time). A level that rises and does not drain is work that is started and not finished; the scan pages 50 rows every 5 s, so above ~300 waiting sagas the poll latency starts to grow as well.

## No consumer on the `publish` queue (`PublishQueueUnattended`)

> Rules: `PublishQueueUnattended` (critical) and its companion `PublishQueueSignalMissing` (warning), in `prometheus/alerts/saga.yml`.
> **Routing pending §4.2.c**: today ALL the rules of this repo are EVALUATED but not delivered — the `alertmanagers:` block of `prometheus/prometheus.yml` is commented out. Nobody receives a push notification for this; someone has to look at it.

This is the early signal of the timeout spike described above, and it arrives before the damage.

**What it says exactly.** For 5 continuous minutes there was work enqueued in `publish` and the broker did NOT report, NOT ONCE, a consumer registered for that queue. Both terms are required: consumers alone would fire on a deliberate scale-to-zero with the queue empty, and queue depth alone would fire on any ordinary burst.

**Window.** Lookback 5m + `for: 5m` = the rule is satisfied at **10 minutes**, one third of the 30-minute horizon. The end-to-end latency is LARGER and is not that number: scrape and evaluation add ~25 s, and the broker's client registry can keep a vanished process until its socket reap (~5 min with the usual defaults). Measured worst case: **~15 minutes**, still half the horizon.

**What it does NOT prove.** Registration is not throughput. A wedged consumer (blocked loop, held lock) or a paused one stays registered, so this rule does not see it. Nor does it say anything about whether that consumer manages to publish: only that something is listening.

**`-1` is not zero.** `publish_queue_consumers` publishes `-1` when the count could NOT be read (the broker refuses `CLIENT LIST`, the port failed, or the provider is not installed). A Prometheus gauge has no null, and the rule fires on `== 0`: the negative sentinel fails that predicate on purpose, so that an unanswered question never pages as an outage. If you see `-1`, the problem is observability, not consumption.

**Reading for the operator — read before touching anything.** The affected sagas stay NON-terminal until the horizon and then terminalize under `reason="timeout"`. **A terminal failure under that reason does NOT prove that nothing was published**: the pivot already enqueued the jobs, and a worker that comes back may have drained them, or the provider may have received the post before the completion event was lost. Check the provider BEFORE retrying anything; a blind retry publishes twice.

**Handling.**

1. `curl -s localhost:3000/health/dependency/queue | jq .details` — `consumers: 0` confirms the outage; `null` means unknown, not zero.
2. Check that the workers process is alive and answers 200 on `/health/ready` (port `METRICS_PORT`, default 3300). Its readiness already requires one consumer per queue of the publish pipeline, so a 503 names the one that is missing.
3. If the workers are down: bring them up (`pnpm dev:workers`) and watch `publish_queue_waiting` drain. The parked sagas resume within one poll interval plus one scan tick — there is no need to re-trigger them by hand.
4. Only then, for the sagas that ALREADY terminalized under `reason="timeout"`, follow step 1 of "Remediation", with the check on the provider first.

If the rule that fires is `PublishQueueSignalMissing`, the problem is the OBSERVER, not the queue: the API that publishes the series is down or its scrape target is misconfigured. `PublishQueueUnattended` stops being evaluated, silently, in that state, which is exactly the moment closest to the incident.

## Step-by-step diagnosis

1. **Identify the affected sagas**: DB query:
   ```sql
   SELECT id, "definitionId", "currentStep", "errorMessage", "startedAt"
   FROM "SagaInstance"
   WHERE status = 'FAILED' AND "errorMessage" LIKE '%timeout%'
   ORDER BY "startedAt" DESC LIMIT 10;
   ```
2. **All the same `definitionId`?** If so, a regression in one specific saga. If not, an infra issue (DB/Redis/workers).
3. **All the same `currentStep`?** It identifies the step that hangs. Inspect its `execute()` source.
4. **Jaeger trace of the first saga**: search for a `saga.execute` span > 30min. Which descendant span is running when the timeout fires? (Probably a provider call or a DB query.)
5. **BullMQ queue depths**: `pnpm --filter @apps/api exec node --eval "..." -e "console.log(await queue.getJobCounts())"` — are there `active` jobs that are not being processed? Workers down?
6. **Recovery scheduler health**: is it running? `pnpm --filter @apps/api exec node` and check for the "Saga retry recovery scan" logs every 5s.

## Remediation

- **Step hanging on a provider call**: add a timeout to the provider's circuit breaker. Investigate the root cause (slow provider? expired auth?).
- **DB deadlock**: identify the query + add `SELECT FOR UPDATE NOWAIT` or reorder the locks. If it is frequent, review the isolation level.
- **Workers down**: restart the `apps/workers` pod. Investigate the OOM/crash logs. The sagas that were waiting were NOT lost: when the workers come back, their completion events advance them, and the poll picks up within one interval the ones that no longer have an event.
- **The latency tail is expected, not a bug**: when the completion event races the queue's state update, the saga waits one poll interval before it sees the outcome. If that is too much for your deployment, lower `SAGA_WAIT_POLL_MS` (minimum 1000) — at the cost of more queue reads per saga.
- **Recovery scheduler stuck**: restart `apps/api` (the lifecycle re-initializes in init()).

## Manual saga recovery

If the FAILED sagas are recoverable (a consistent state at the moment of the timeout), trigger them by hand:

```bash
# Identify the sagas:
psql -c "SELECT id FROM \"SagaInstance\" WHERE status = 'FAILED' AND \"errorMessage\" LIKE '%timeout%'"

# Re-trigger through the HTTP admin endpoint:
curl -X POST localhost:3000/admin/saga/<sagaId>/continue
```

If they are NOT recoverable (a broken state, e.g., post-pivot side effects already partially executed):

- Manual cleanup according to the saga: e.g., `post-publishing-saga` may require publishing the post by hand through the admin UI + marking the saga COMPENSATED.

## When to escalate

- 3+ distinct sagas timing out at the same time with the same `currentStep` → likely an infra/provider issue, not a saga bug.
- If no saga of the same type COMPLETED in the last 30min → the product is degraded; page on-call.

## Links

- Grafana: `business-metrics.json` panel "Sagas by status"
- Table: `SagaInstance` in Postgres
- Source: `apps/api/src/saga/SagaManagerLifecycle.ts` — `startTimeoutChecker` (task `saga-timeout-checker`) and `terminalizeIfPastHorizon` (the same horizon, asked by any advancer)
- Config: `SAGA_WAIT_POLL_MS` (`apps/api/src/config/env.ts`, default 30000)
- Related runbook: `chaos-saga-step-retry.md` (understand the retry/recovery flow)
- SLO: completion rate > 99% (`docs/observability/SLO.md#saga`)
