# Service Level Objectives — OmniPost

> §4.2 Normalization Roadmap Phase A1. Targets consolidated from
> `apps/api/src/metrics/*.ts` comments + `performance/config/alert-rules.json`
>
> - implicit decisions in `BackgroundTaskScheduler` polling intervals.

## What is this doc for?

Every SLO target here has:

1. A Prometheus **metric** that measures it.
2. A Grafana **dashboard** that visualizes it.
3. An **alert rule** that fires when it is violated.
4. A **runbook** that says what to do when it is violated.

If a target does NOT have all 4 items wired, it is incomplete.

---

## API {#api}

| SLI                | Target                           | Metric                                                                         | Alert                                                                                 | Runbook                                                        |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Availability**   | 99.9% monthly uptime (~43min/mo) | `up{job="api"}`                                                                | TBD (§4.2.b)                                                                          | TBD                                                            |
| **Latency p99**    | < 1000ms (excludes 4xx)          | `histogram_quantile(0.99, rate(http_duration_bucket{job="api"}[5m]))`          | [ApiLatencyP99High](../runbooks/alert-api-latency.md) (`prometheus/alerts/api.yml`)   | [alert-api-latency.md](../runbooks/alert-api-latency.md)       |
| **Error rate 5xx** | < 1%                             | `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])` | [ApiErrorRateHigh](../runbooks/alert-api-error-rate.md) (`prometheus/alerts/api.yml`) | [alert-api-error-rate.md](../runbooks/alert-api-error-rate.md) |
| **Dashboard**      | —                                | —                                                                              | —                                                                                     | `grafana/dashboards/api-performance.json`                      |

**Notes:** The `ApiErrorRateHigh` alert fires at > 5% (not 1%) because the 1% SLO target is a monthly budget — the alert is an "immediately detectable spike". 5% sustained for 5min = ~3.6 hours/month of error budget consumed in a single afternoon.

---

## Saga {#saga}

| SLI                          | Target                                                | Metric                                                                                                                                                                       | Alert                                                                                                                                                      | Runbook                                                      |
| ---------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Completion rate**          | > 99% (COMPLETED vs FAILED \| COMPENSATED \| TIMEOUT) | `sagas_completed_total / sagas_started_total`                                                                                                                                | TBD (§4.2.b) — needs `SagaCompletionRateLow`                                                                                                               | TBD                                                          |
| **Timeout spikes**           | < 3 timeouts in 10min                                 | `increase(sagas_failed_total{reason="timeout"}[10m])`                                                                                                                        | [SagaTimeoutSpike](../runbooks/alert-saga-timeout.md) (`prometheus/alerts/saga.yml`)                                                                       | [alert-saga-timeout.md](../runbooks/alert-saga-timeout.md)   |
| **Duration p95**             | < 30s event-driven; < 90s when the event is lost      | `histogram_quantile(0.95, sum by (le, definition_id) (rate(sagas_duration_seconds_bucket[30m])))`                                                                            | TBD (§4.2.b)                                                                                                                                               | [alert-saga-timeout.md](../runbooks/alert-saga-timeout.md)   |
| **Recovery health**          | 0 outside a deploy window                             | `increase(saga_recovery_failures_total{stage=~"boot\|retry-scan\|timeout\|instance-load\|resume-row\|compensation\|rehydration\|mismatch\|event-dispatch\|wait-poll"}[10m])` | [SagaRecoveryLoopFailing](../security/MULTI_TENANT_GUARDS.md), [SagaTenantMismatch](../security/MULTI_TENANT_GUARDS.md) (`prometheus/alerts/saga.yml`)     | [MULTI_TENANT_GUARDS.md](../security/MULTI_TENANT_GUARDS.md) |
| **Parked backlog**           | 0 outside a restart window                            | `increase(saga_recovery_parked_total[10m])`                                                                                                                                  | [SagaParkedAtPivot](../security/MULTI_TENANT_GUARDS.md) (`prometheus/alerts/saga.yml`)                                                                     | [MULTI_TENANT_GUARDS.md](../security/MULTI_TENANT_GUARDS.md) |
| **Uncovered rows**           | 0 inherited rows outside the load ceiling             | `max(saga_recovery_deferred_rows)`                                                                                                                                           | [SagaBootLoadDeferred](../security/MULTI_TENANT_GUARDS.md) (`prometheus/alerts/saga.yml`)                                                                  | [MULTI_TENANT_GUARDS.md](../security/MULTI_TENANT_GUARDS.md) |
| **COMPENSATING undrained**   | 0 sustained ~15min (an ongoing walk does NOT count)   | `min_over_time(saga_compensating_orphans[10m])`                                                                                                                              | [SagaCompensatingOrphans](../security/MULTI_TENANT_GUARDS.md) (`prometheus/alerts/saga.yml`)                                                               | [MULTI_TENANT_GUARDS.md](../security/MULTI_TENANT_GUARDS.md) |
| **Waiting population**       | no sustained accumulation (~25min)                    | `min_over_time(saga_waiting_rows[15m])`                                                                                                                                      | [SagaWaitingRowsAccumulating](../runbooks/alert-saga-timeout.md) (`prometheus/alerts/saga.yml`)                                                            | [alert-saga-timeout.md](../runbooks/alert-saga-timeout.md)   |
| **Unattended publish queue** | 0 min with queued work and no consumer                | `max_over_time(publish_queue_consumers[5m]) == 0 and max_over_time(publish_queue_waiting[5m]) > 0` (`-1` = unknown, not zero)                                                | [PublishQueueUnattended](../runbooks/alert-saga-timeout.md), [PublishQueueSignalMissing](../runbooks/alert-saga-timeout.md) (`prometheus/alerts/saga.yml`) | [alert-saga-timeout.md](../runbooks/alert-saga-timeout.md)   |
| **Unfinished rollbacks**     | 0                                                     | `increase(sagas_failed_total{reason="compensation-expired"}[10m])`                                                                                                           | [SagaCompensationExpired](../security/MULTI_TENANT_GUARDS.md) (`prometheus/alerts/saga.yml`)                                                               | [MULTI_TENANT_GUARDS.md](../security/MULTI_TENANT_GUARDS.md) |
| **Dashboard**                | —                                                     | —                                                                                                                                                                            | —                                                                                                                                                          | `grafana/dashboards/business-metrics.json`                   |

**Notes:** The saga engine's critical invariant is validated in `apps/api/tests/chaos/saga-step-retry-recovery.integration.test.ts` (§4.1 Phase A1). If that test breaks in CI, the completion-rate SLO is at risk.

**Counters vs gauges.** The `*_total` series are EVENTS (something happened, once, and the total only grows). `saga_recovery_deferred_rows`, `saga_compensating_orphans` and `saga_waiting_rows` are GAUGES: they are LEVELS that each process measures again. Registering them as a counter would add up the same rows once per boot and would report a backlog of two as six after three restarts.

**The COMPENSATING lifecycle, and why its alert does NOT use `max()`.** The engine now persists `COMPENSATING` BEFORE it compensates anything, resumes that walk at boot (disposition `compensation-resumed`, never forward execution), saves the progress step by step in `compensationResults`, and leaves the row in `COMPENSATING` when the walk could not finish — instead of lying `COMPENSATED`. As a consequence, a non-zero gauge value during a startup is WORK IN PROGRESS, not a stuck backlog. That is why the gauge is measured AT SCRAPE TIME (a prom-client `collect` callback runs the COUNT when `/metrics` is rendered): a level published only at boot is blind to the rows that appear BETWEEN boots — which is precisely the population the automatic path creates — and it also stays stuck on an old value until the next restart. The alert asks for the window's FLOOR (`min_over_time`), which is > 0 only if the level never drained, sustained `for: 5m`: in total it fires ~15 minutes into a level that does not go down. A row that nobody advances anyway ends by TWO horizons, and either one is enough: the LIVENESS one (from its last `updatedAt` write, with a fresh re-read before acting) and the ABSOLUTE one (from the birth of the rollback — the durable `saga.compensation.started` event —, at 3 horizons, which is what keeps a crash loop from deferring termination by rewriting the row on every startup). It ends as `reason="compensation-expired"`, which reads "the rollback did not finish", not "the publication failed". Scope: the horizons only see rows the process TRACKS; a COMPENSATING row deferred by the load ceiling is covered by `SagaBootLoadDeferred` and the next boot.

**A step that WAITS spends no retry budget, and that changes the shape of two SLIs.** Before, a publish whose jobs did not finish died of an exhausted budget in ~35 s (5 + 10 + 20) and showed up as `sagas_failed_total{reason="step-failure"}`. Now the step answers `waiting`: it spends no retries, writes no error, emits no audit event, and re-arms on its own poll cadence (`SAGA_WAIT_POLL_MS`, default 30 s) until a worker event advances it or the saga's horizon ends it. Measured consequences, stated rather than discovered:

- **The latency tail.** The happy path does not change: the completion event advances the saga as soon as it arrives. When that event RACES the queue's state update (the job's last attempt already failed but the job is not yet in the `failed` set), the saga waits one poll interval before it can see the outcome — measured in this repo: ~60 s until a FAILED with the real cause, of which ~30 s are that interval. That is why the duration target tells the event-driven path apart from the one that pays the tail, instead of a single "< 30s" that the branch itself no longer meets.
- **The waiting population is now observable.** `saga_waiting_rows` (a gauge, measured at scrape time) counts the `RUNNING` rows with a scheduled re-entry. Without that series, a worker outage showed in NO metric until the whole cohort expired together half an hour later as `reason="timeout"`. `SagaWaitingRowsAccumulating` asks for the window's FLOOR, for the same reason as the COMPENSATING alert: a spike of work in progress is not a backlog.
- **A re-arm that cannot be persisted does NOT end the saga.** It is counted as `saga_recovery_failures_total{stage="wait-poll"}` and the row keeps the marker it already had: degraded bookkeeping is a degraded database, not a failed saga.

**Recovery vs parked — two distinct SLIs on purpose.** `saga_recovery_failures_total` counts work the engine could NOT complete (a loop that failed, a row it could not classify, an account that did not resolve). `saga_recovery_parked_total` counts DECISIONS it took correctly: rows cut at the pivot that it declines to resume. Adding the two series reports a design decision as a failure, which is exactly what motivated separating them.

---

## Outbox {#outbox}

| SLI                   | Target                                                              | Metric                                                 | Alert                                                                             | Runbook                                                |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Pending events**    | < 100 events steady-state                                           | `outbox_pending_events`                                | [OutboxLagHigh](../runbooks/alert-outbox-lag.md) (`prometheus/alerts/outbox.yml`) | [alert-outbox-lag.md](../runbooks/alert-outbox-lag.md) |
| **Time-to-publish**   | p99 < 30s                                                           | `outbox_publish_duration_seconds`                      | TBD (§4.2.b) — needs `OutboxPublishLatencyHigh`                                   | TBD                                                    |
| **Duplicate publish** | 0 on the failure-free path; rare only on crash-retry / lease-expiry | atomic claim + lease + `publishedAt IS NULL` predicate | — (absorbed by idempotent consumers)                                              | Manual investigation                                   |

**Notes:** The outbox relay is **at-least-once** transport. The atomic claim (`UPDATE ... FOR UPDATE SKIP LOCKED`) + the lease + the `publishedAt IS NULL` predicate prevent the double claim of a row with a live lease, and `markPublished` sets `publishedAt` **only after** `dispatch()` resolves (it never publishes without dispatching). A crash between the dispatch and the terminal mark, or a lease expiry during a slow dispatch, can produce a duplicate delivery; consumers are idempotent (canon: _"every consumer handler is idempotent"_), so the duplicate is absorbed downstream — in exchange for eliminating the silent loss. There is no relay-side dedupe through `OutboxInbox` any more (mechanism removed; the Prisma model stays inert until the deferred drop migration).

---

## Business {#business}

| SLI                      | Target          | Metric                                                 | Alert        | Source                                     |
| ------------------------ | --------------- | ------------------------------------------------------ | ------------ | ------------------------------------------ |
| **Post creation p99**    | < 1000ms        | `posts_creation_duration_seconds{quantile="0.99"}`     | TBD (§4.2.b) | `apps/api/src/metrics/businessMetrics.ts`  |
| **Publish success rate** | > 99%           | `provider_publish_success_total / (success + failure)` | TBD (§4.2.b) | `apps/api/src/metrics/businessMetrics.ts`  |
| **Posts published/day**  | (informational) | `rate(posts_published_total[1d])`                      | —            | `apps/api/src/metrics/businessMetrics.ts`  |
| **Dashboard**            | —               | —                                                      | —            | `grafana/dashboards/business-metrics.json` |

---

## Coverage status

| Service  | SLI tracked | Alert wired | Runbook | Dashboard |
| -------- | ----------- | ----------- | ------- | --------- |
| API      | 3/3         | 2/3         | 2/3     | ✅        |
| Saga     | 3/3         | 1/3         | 1/3     | partial   |
| Outbox   | 3/3         | 1/3         | 1/3     | partial   |
| Business | 3/3         | 0/3         | 0/3     | ✅        |

Phase A1 closes: 4 alerts + 4 runbooks + 1 SLO doc + Grafana provisioning.

Phase B (§4.2.b) closes the gaps: 6+ additional alerts (availability, completion rate, avg duration, publish latency, post-creation p99, publish success rate) + alertmanager wireup + Slack/PagerDuty notification routing.

## When to review this doc

- When a new SLI is added (a new alert, a new metric).
- When a target changes (a negotiation with product).
- When a runbook is updated.
- In post-mortems: was an SLO missing to detect this incident?

## References

- Prometheus rules: `prometheus/alerts/`
- Grafana dashboards: `grafana/dashboards/`
- Metrics source: `apps/api/src/metrics/`
- Workstream: `docs/architecture/NORMALIZATION_ROADMAP.md §4.2`
