# Runbook — publish record and retraction alert telemetry

> Rules: `prometheus/alerts/publish-record.yml` — five rules over two groups.
> Unit tests for those rules: `prometheus/tests/publish-record.test.yml`
> (`promtool test rules prometheus/tests/publish-record.test.yml`).
> **NONE OF THESE FIVE PAGES ANYBODY TODAY, for two independent reasons.** Both are
> measured, and the first is the one the other runbooks in this directory do not mention:
>
> 1. **The rules are not loaded.** `docker-compose.yml:70` mounts only
>    `./prometheus/prometheus.yml` into the Prometheus container — `./prometheus/alerts` is
>    never mounted — so `rule_files: ["alerts/*.yml"]` matches zero files at runtime and
>    **no** rule in this repository is evaluated in the only deployment definition the
>    repository has. Backlog: SMELL-164.
> 2. **Routing is pending (§4.2.b).** Even once the rules load, the `alertmanagers:` block
>    of `prometheus/prometheus.yml` is commented out, so an evaluated alert appears in
>    `/api/v1/alerts` and sends no notification. Somebody has to look.
>
> Until the first is fixed, the sections below describe what an operator would see, not
> what an operator is being shown. Read them that way.

One runbook for five rules, following the `alert-saga-timeout.md` precedent where two
rules share one file. They describe one telemetry surface — did the record of what
happened get written, and did the customer get told — and an operator who lands on any of
them usually needs to read at least one of the others.

## What all five have in common, and the one thing none of them can tell you

Every rule here fires on `increase()` over a **labelled prom-client counter**, and a
labelled counter exposes **no series at all** until its first `inc`. A counter that has
never fired has nothing for `increase()` to evaluate, so the rule is quiet.

That quiet is correct — there is genuinely nothing to report — but it is **not coverage**.
These rules cannot distinguish "the bad thing never happened" from "the process that would
report it is gone". The api side has an observer guard for its attendance signal
(`PublishQueueSignalMissing`, `prometheus/alerts/saga.yml:170-179`, an `absent_over_time`
over a gauge that is published on every scrape). The workers' scrape has nothing of the
kind, and one cannot be built the same way over these counters: `absent_over_time` over a
counter that is legitimately absent would page from boot, every boot, forever. Building
the right guard is a backlog row (SMELL-162), not something to improvise during an
incident.

**Practical consequence.** If one of these rules has been silent for a suspiciously long
time, confirm the target is actually being scraped before concluding the system is
healthy: `up{job="workers"}` and `up{job="api-server"}` answer that, and they are the
series to check first.

---

## `PublishOutcomeUnrecorded` — critical

> `increase(worker_publish_outcome_unrecorded_total[10m]) > 0`, held 1m.
> Source: `apps/workers/src/metrics/workerMetrics.ts`, incremented from
> `apps/workers/src/publishOutcomeRecorder.ts`.

### What you are looking at

A provider accepted content and **nothing durable says so**. The worker tried to write the
channel publication record, the bounded compare-and-swap retry did not win, and no durable
path carried the outcome afterwards. Nothing will try again on its own.

**How far it got is not the same in every case**, and the `reason` label is what says so —
see step 1 below before you go looking for a dead-lettered job, because on one of the four
values there is no job to find.

The threshold is `> 0` on purpose. Every mechanism in the outcome path exists to keep this
series at zero, so the number is not a rate to tune — one increment is the event.

### What it means when it fires

The post may be **live on the platform** while the record says the channel is unresolved.
Everything built on the record is therefore wrong about this channel: the customer's post
status, the admin list, and the retraction alert cycle, which cannot ask about content it
does not know went out.

### What to check first

1. **The `reason` label. It says how far the path got, and therefore where the receipt
   still is.** The counter emits four values and they do not all mean the same thing to
   you. Three come from the failed-job listener
   (`apps/workers/src/publishOutcomeRecorder.ts:406-433`), which archives to the dead
   letter **before** it counts, so a dead-lettered job carrying the receipt does exist:
   - `exhausted` — the durable job spent its BullMQ attempts.
   - `unrecoverable` — the durable job's payload was refused as unparseable, so retrying
     could not change it.
   - `terminal` — the durable job finished failed short of its attempts.

   The fourth does not:
   - `undeliverable` — **no job was ever created.** It fires from a different exit
     (`publishOutcomeRecorder.ts:339-346`, reached at `:360`, `:376` and `:388`): the
     receipt failed its own parse before anything could be queued, or the inline write
     **and** the `record-publication-outcome` enqueue both failed, or a throw escaped. It
     increments the counter, it logs, and it queues **nothing** — so the dead letter queue
     is empty for it and step 3 below has no subject.

2. The ERROR log emitted beside the increment. It carries the post id, the channel id, the
   episode and the attempt, and it is the only place that names WHICH publication is
   stranded. **On `undeliverable` it is the only place the receipt exists at all**: the
   line reads `Publish outcome reached no durable path`, and that line plus its context and
   correlation id are everything a human has to settle the record from. That makes
   `undeliverable` the worse of the four, not the milder one.
3. The dead-lettered job in the `record-publication-outcome` queue — **on `exhausted`,
   `unrecoverable` or `terminal` only**. Its payload is the receipt that was never applied,
   including the published fragments for a thread.
4. Whether this is one event or a run. A single increment is one stranded channel. A run
   points at the write path itself — the database refusing the compare-and-swap, or the
   worker's tenant scope failing to bind — and in that case the log's correlation id leads
   to the actual fault.

### Remedy

**Do NOT re-drive the publish.** The provider call already succeeded; a second one
publishes the same content twice. That is the whole reason this counter exists rather than
a retry.

The repair is to apply the receipt so the record catches up with what the provider already
did. **Where you get the receipt follows the `reason` label:**

- `exhausted`, `unrecoverable`, `terminal` — from the dead-lettered job's payload.
- `undeliverable` — from the `Publish outcome reached no durable path` ERROR log line and
  its context. There is no payload to read, so the outcome has to be reconstructed from
  that line before anything can be applied.

Confirm against the provider first in either case — the receipt says what the worker
believed went out, and an operator settling a record by hand should be looking at the
platform, not only at the payload.

---

## `ThreadLiveFragmentsUnrecorded` — warning

> `increase(worker_errors_by_type_total{component="publisher",error_type="thread_live_fragments_unrecorded"}[10m]) > 0`, held 1m.
> Source: `apps/workers/src/publishHandler.ts` via `recordError`.

### What you are looking at

Fragments of a thread went out and the per-fragment `Tweet` rows that mirror them could
not be marked. Both arms of that failure feed this series: the repository answering not-ok,
and a raised error inside the row update.

### What it means when it fires

A **mirror drifted**, not an outcome lost — which is why this is a warning and
`PublishOutcomeUnrecorded` above is a critical. The channel publication record still holds
the ordered live set, so the retraction cycle knows exactly what to ask the customer to
remove. Before the record write existed, these rows were the only durable trace of what
had gone out, and that is why the failure was counted in the first place.

What drifts with it is anything still reading the per-fragment rows directly.

### What to check first

1. Whether this fired **together with** `PublishOutcomeUnrecorded` for the same post. If
   both did, treat the critical one as the incident; this one is a symptom of the same
   write path.
2. One event or a run. One is a bad write. A run is systematic — the same repository
   failing every time — and then the per-fragment rows are broadly unreliable, not just
   for one thread.

### Remedy

Nothing is stranded, so there is no urgent customer-facing act. Reconcile the rows against
the record's live set for the affected posts; the record is the authority, and the rows are
the copy that should be made to agree with it.

---

## `RetractionAlertContextDegraded` — warning

> `increase(retraction_alert_context_degraded_total[30m]) > 0`, held 5m.
> Source: `apps/api/src/metrics/retractionAlertMetrics.ts`, incremented from
> `apps/api/src/infrastructure/adapters/RetractionAlertContextAdapter.ts`.

### What you are looking at

A retraction alert went out naming a raw identifier where a human-readable title belonged.
The `field` label says which lookup degraded: `post`, `channel` or `account`.

The window here is wider than the two workers rules — 30 minutes of lookback and a 5 minute
hold — because the harm is cumulative rather than per event. One awkward message is not an
incident; a run of them is.

### What it means when it fires

The alert **is delivered**. The obligation to remove content exists whether or not a title
loads, and suppressing the alert because its wording degraded would be strictly worse than
sending it. What degrades is the customer's ability to act: "Post `3f2a…`" names nothing
they can recognise on their own dashboard, so they cannot find the thing they are being
asked to take down.

### What to check first

1. The `field` label. A degraded `post` is the worst of the three — that is the title the
   customer needs. A degraded `account` mostly affects the salutation.
2. Whether the rows the context adapter reads still exist **for the tenant raising the
   alert**. A lookup that returns nothing because the read is scoped to the wrong tenant
   degrades exactly like a missing row, and the two need opposite fixes.
3. The ERROR or WARN log beside the increment, for whether the lookup failed or simply
   found nothing.

### Remedy

Fix the lookup. Alerts already sent cannot be improved retroactively, and a second alert
for the same channel is not a correction — the alert consumer is idempotent and the
customer would read it as a second obligation. If a customer is confused by a degraded
alert already in their inbox, the answer is a human reply naming the post, not a re-raise.

---

## `RetractionAlertEventDeadLettered` — critical

> `increase(outbox_dead_lettered_total{event_type=~"PostChannelRetractionAlert(Raised|Resolved)"}[30m]) > 0`, held 5m.
> Source: `apps/api/src/metrics/outboxMetrics.ts`, incremented from
> `apps/api/src/infrastructure/outbox/OutboxRelay.ts`.

### What you are looking at

The outbox relay exhausted its retries on a retraction alert event and archived it to the
dead letter queue. **Nothing retries a dead-lettered row on its own.**

This rule exists because the terminus had no watcher. `OutboxLagHigh`
(`prometheus/alerts/outbox.yml`) reads a PENDING level, and a dead-lettered row has just
**left** that level — it stops being pending by being given up on. So the existing outbox
rule goes quiet at precisely the moment delivery becomes permanent failure.

The counter is incremented by the relay that **won** the archive. A lease-expiry race makes
the losing relay raise a unique-constraint violation over a row the winner already counted,
and the loser counts nothing — so this series is one per row, not one per attempt.

### What it means when it fires — and it depends on which of the two types

- **`PostChannelRetractionAlertRaised` dead-lettered.** Content is live on a platform, the
  channel is marked pending retraction, and **the customer was never asked to remove it**.
  The action window is counting down against somebody who does not know it exists. When it
  expires, the channel is finalized as excluded with cause `ACTION_WINDOW_EXPIRED` and the
  content is still up. This is the worse of the two.
- **`PostChannelRetractionAlertResolved` dead-lettered.** The customer already acted, or
  the window closed, and the standing alert they can no longer act on was never withdrawn.
  A customer is looking at an obligation that no longer exists.

### What to check first

1. Which event type, from the `event_type` label. The two need different conversations.
2. The dead-letter row: `docs/runbooks/alert-outbox-lag.md` names the admin surface, and
   `failureReason` on the row says why the consumer kept rejecting it.
3. Whether the consumer is rejecting **this payload** or **every payload**. The alert
   handler propagates a processing failure so the outbox redelivers, which is why an event
   can reach the dead letter at all; if the handler is broken generally, more events are
   about to follow this one and the handler is the incident.
4. `increase(outbox_dead_lettered_total[30m])` **without** the event-type selector. If
   other event types are dead-lettering at the same time, the relay or its consumers are
   the incident, and the retraction alert is one casualty among several.

### Remedy

**Replay from the dead letter queue. Do not raise a new alert.** The alert consumer is
idempotent by design, and raising a second alert for the same channel duplicates the
obligation from the customer's point of view — they see two requests to remove one thing.

Replay only after the reason the consumer rejected the payload is fixed; a replay into an
unchanged consumer dead-letters again and costs the retries a second time. If the event
cannot be replayed at all, the fallback is a human reaching the customer directly with the
post and channel from the dead-lettered payload, and then settling the channel through the
confirm act.

---

## `RetractionAlertEventRefused` — critical

> `increase(retraction_alert_refused_total[30m]) > 0`, held 5m.
> Source: `apps/api/src/metrics/retractionAlertMetrics.ts`, incremented from
> `apps/api/src/notifications/RetractionAlertEventHandler.ts` at `:87` and `:124`.

### What you are looking at

A retraction alert event arrived naming **too little to act on**, and the consumer refused
it before attempting any delivery. No alert went out.

**Read this section beside the one above it.** The operator-visible state is the same one
`RetractionAlertEventDeadLettered` describes, reached by a different path — and the
difference is what makes this the harder of the two to find, not the milder one.

### Why nothing else sees it

Both refusal sites count the refusal, log, and **return** — neither raises. The outbox
relay dispatches first and marks published on the next line
(`OutboxRelay.ts:132-133`), so a `dispatch()` that resolves is a row marked **PUBLISHED**.
The row is therefore indistinguishable from one whose alert was delivered, and both of the
watchers that would otherwise cover it are blind:

- **`RetractionAlertEventDeadLettered` cannot fire** — the row never dead-letters. There is
  no queued payload to replay and no `failureReason` to read.
- **`OutboxLagHigh` cannot fire** — the row stops being pending by _succeeding_, so it
  never accumulates lag.

Apart from this counter, the only trace is an ERROR log line. That is the whole of the
evidence, which is why the window is 30 minutes: the remedy is a question about a run of
these, not about one message, and the signal has to survive long enough for somebody to
look.

### What it means when it fires

Content may be **live on a platform**, the channel is marked pending retraction, and the
customer was **never asked to remove it**. The action window is counting down against
somebody who does not know it exists; when it expires the channel is finalized as excluded
with cause `ACTION_WINDOW_EXPIRED` and the content is still up.

This is critical for the same reason the dead-letter rule is, minus the consolation: there
is no dead letter to replay.

### What to check first

1. **The `reason` label. It names the FIRST field the payload did not carry**, in the
   order tenant, alert key, channel, project — so a payload missing two fields reports only
   the first. The four values do not send you to the same place:
   - **`missing-tenant`** — refused at `:87`, **before any tenant is bound**. This is the
     worst of the four to investigate: the event cannot say which customer is affected, so
     there is no account to scope a search to. Start from the `eventId` in the log line.
   - **`missing-alert-key`** — also `:87`. The tenant IS known, so the account scopes the
     search; what is missing is the idempotency key the alert cycle dedupes on.
   - **`missing-channel`** — refused at `:124`, inside the tenant context. The alert cannot
     say **where** the content is live, which is the one fact the customer needs.
   - **`missing-project`** — also `:124`. Refused rather than defaulted on purpose: an
     empty project id finds no member and no active config, so the delivery would have
     reported "no active config" — a sentence about the customer's setup for a fact about
     our own payload.
2. **The ERROR log line beside the increment**, which carries the `eventId` and the
   `eventType` and is the only place the refused event is identified at all. The two
   messages are `Retraction alert event is missing its tenant or its alert key` (`:87`) and
   `Retraction alert names no channel or no project` (`:124`).
3. **Whether one producer or every producer is affected.** Group the series by `reason`:
   a single value climbing alone points at one emit path that dropped one field; several
   values moving together points at the event construction itself.
4. **The outbox rows for those `eventId`s.** They will read PUBLISHED. Confirming that is
   what tells you the event is genuinely unrecoverable from the queue rather than still
   waiting somewhere.

### Remedy

**The remedy is upstream, at the producer. Do not replay, and do not raise a new alert.**

A replay is not available and would not help if it were: the row is already PUBLISHED, and
the payload is malformed rather than the delivery, so the same bytes are refused again by
the same check. Raising a fresh alert by hand is also wrong as a first move — the alert
consumer is idempotent by design and a second alert for a channel that later gets a correct
one duplicates the obligation from the customer's point of view.

1. Find the emit path that produced an event without that field and fix it there. A
   refusal is evidence about a **producer**, not about the consumer that caught it.
2. For the channels already stranded by refused events, settle them by hand: identify them
   from the `eventId`s in the logs, reach the customer directly with the post and channel,
   and then settle the channel through the confirm act — the same fallback the dead-letter
   section names for an unreplayable event.
3. Only once the producer is fixed will new alerts for those channels go out on their own.

---

## Links

- Rules: `prometheus/alerts/publish-record.yml`
- Rule unit tests: `prometheus/tests/publish-record.test.yml`
- Outbox lag and the dead-letter admin surface: `docs/runbooks/alert-outbox-lag.md`
- Publish queue attendance and the saga horizon: `docs/runbooks/alert-saga-timeout.md`
- Worker metric source: `apps/workers/src/metrics/workerMetrics.ts`
- Api metric sources: `apps/api/src/metrics/retractionAlertMetrics.ts`,
  `apps/api/src/metrics/outboxMetrics.ts`
