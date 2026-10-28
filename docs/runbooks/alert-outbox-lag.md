# Runbook — `OutboxLagHigh`

> Alert: `prometheus/alerts/outbox.yml`
> SLO: `docs/observability/SLO.md#outbox`

## Symptom

`outbox_pending_events > 100` for more than 5min, sustained.

## What it detects

The outbox relay should process events in <1s in steady state. Pending sustained > 100 indicates:

1. The relay crashed in the apps/api process.
2. Claim leases (5min) are not being released (an internal deadlock).
3. The downstream consumer (BullMQ) is saturated — the relay claims fine but the handlers are crashing.
4. A one-off load spike (e.g., a bulk operation) — it should resolve itself.

## Step-by-step diagnosis

1. **Exact count in the DB**:

   ```sql
   SELECT count(*), status FROM "OutboxEvent"
   WHERE status IN ('PENDING', 'CLAIMED') AND "createdAt" > NOW() - INTERVAL '1 hour'
   GROUP BY status;
   ```

   - If all are `PENDING` and zero are `CLAIMED`: the relay is not claiming → the relay process is down.
   - If many are `CLAIMED` with an old `claimedAt`: the leases are stuck. A lease expires in 5min and should recover by itself. If it does not, there is a bug.

2. **apps/api logs**: search for `"OutboxRelay"` over the last 30min. Are there repeated `"Outbox claim failed"` errors?

3. **Live processes**: the relay runs **in-process** through `BackgroundTaskScheduler.register("outbox-relay", ...)`. If apps/api is running, the relay SHOULD be running. `curl /health/detailed` → check whether the outbox dependency check appears.

4. **Downstream BullMQ queue depths**: if the handlers that consume from the outbox are saturated, the `messageId` unique constraint will prevent a re-publish, but the items will not be marked `PROCESSED`.

5. **Recently released code**: is there a recent change to `OutboxRelay.ts` or `OutboxClaimService.ts`? `git log apps/api/src/infrastructure/outbox/ --since="24 hours ago"`.

## Remediation

- **Relay process down**: restart `apps/api`. `OutboxClaimService` reclaims the leases automatically at boot.
- **Stuck CLAIMED leases**: if the restart does not clear them, clean them up by hand:
  ```sql
  UPDATE "OutboxEvent" SET status = 'PENDING', "claimedAt" = NULL
  WHERE status = 'CLAIMED' AND "claimedAt" < NOW() - INTERVAL '10 minutes';
  ```
- **Downstream BullMQ saturated**: scale the workers (e.g., the apps/workers pod count). Investigate whether a handler has a bug that crashes it while retries pile up.
- **One-off spike**: watch it for 10 more min. If it drops, document + close. If not, treat it as one of the causes above.

## When to escalate

- Pending > 1000 sustained > 15min → page on-call (data loss risk if Postgres runs out of storage).
- If after the restart the lag keeps rising instead of falling → a bug in the relay; escalate to backend.

## Links

- Grafana: `business-metrics.json` panel "Outbox pending events"
- Table: `OutboxEvent` in Postgres
- Source: `apps/api/src/infrastructure/outbox/OutboxRelay.ts`, `OutboxClaimService.ts`
- Metric: `outbox_pending_events` gauge
- SLO: pending < 100 steady-state, time-to-publish p99 < 30s (`docs/observability/SLO.md#outbox`)
