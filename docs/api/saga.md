# Saga Orchestration API Reference

<!-- @file saga.md @description API reference for the Saga Orchestration system — endpoints, types, and the Post Publishing Saga workflow. @layer infrastructure -->

## Key File Locations

| File                                       | Description                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `packages/shared/src/saga.ts`              | Saga type definitions (SagaDefinition, SagaInstance, SagaStep, SagaContext) |
| `apps/api/src/saga/SagaManager.ts`         | Saga execution engine                                                       |
| `apps/api/src/saga/steps/`                 | Individual saga step implementations                                        |
| `apps/api/src/infrastructure/routes/saga/` | Saga route handlers                                                         |

---

## Core Types

```typescript
interface SagaDefinition {
  id: string;
  name: string;
  version: string;
  steps: SagaStep[];
  timeout?: number;
  retryPolicy?: RetryPolicy;
}

interface SagaInstance {
  id: string;
  definitionId: string;
  status: SagaStatus;
  currentStep: number;
  context: SagaContext;
  stepResults: SagaStepResult[];
  compensationResults: SagaStepResult[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  retryCount: number;
}

interface SagaStep<TData = unknown, TCompensationData = unknown> {
  id: string;
  name: string;
  execute(context: SagaContext, data?: TData): Promise<SagaStepResult>;
  compensate?(context: SagaContext, compensationData?: TCompensationData): Promise<SagaStepResult>;
}

// A step has THREE possible outcomes, and the discriminator is `outcome`.
// `waiting` means "not decided yet" — the step is waiting on external work.
type SagaStepResult =
  | { outcome: "succeeded"; data?: unknown; compensationData?: unknown }
  | { outcome: "failed"; error: string; compensationData?: unknown }
  | { outcome: "waiting"; reason: string };

interface SagaContext {
  sagaId: string;
  correlationId: string;
  userId?: string;
  metadata: Record<string, unknown>;
  stepData: Record<string, unknown>;
  events: DomainEvent[];
}
```

---

## Step Outcomes — succeeded, failed, waiting

A step answers one of three things, and the engine treats each differently:

| Outcome     | Meaning                                     | What the engine does                                                                                                |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `succeeded` | The step's effect landed                    | Advances to the next step, clears the retry bookkeeping                                                             |
| `failed`    | The step will not succeed as it stands      | Spends one retry; when the budget runs out, compensates (pre-pivot) or fails (pivot/post-pivot)                     |
| `waiting`   | The step is not decided YET (external work) | Spends NO retry, records no error, stays on the same step, re-arms the poll (`SAGA_WAIT_POLL_MS`, default **30 s**) |

Why `waiting` is its own outcome and not a failure with a friendly message: the
publish wait step reports "the channels are still going" every time a sibling
channel's completion event re-enters it. While that shared the failure value, an
N-channel publish spent one retry per sibling event — measured, a four-channel
publish reached `FAILED` with all four channels successfully published, and the
customer was told their post failed. `waiting` removes the retry budget as the
bound on a waiting step; the saga's own timeout horizon remains the bound, so a
step that never stops waiting still terminalizes.

`waiting` writes no step event: one audit line per channel check is noise, not
history. It is also never persisted as a step FAILURE, so a saga in flight never
reads as a saga that failed.

**"Could not observe" is `failed`, never `waiting`.** An unreadable queue is not
evidence that work is still in progress, so a job-status read that fails ends
the step with a cause and the retry policy bounds it — the ~35 s envelope it
always had — instead of parking the saga on a poll for half an hour.

**What this costs the caller, stated rather than discovered.** The happy path is
unchanged: a worker completion event advances the saga as soon as it arrives.
But when that event races the queue's own state update — the job's last attempt
has failed and the job is not yet in the failed set — the saga waits up to ONE
poll interval before it can observe the outcome. Measured on this repo's dev
environment: ~60 s to a terminal FAILED carrying the real cause, of which ~30 s
is that interval. A publish whose event never arrives at all is bounded by the
saga horizon (30 min) and terminalizes there under `reason="timeout"`.
Deployments whose publish jobs are fast can lower `SAGA_WAIT_POLL_MS`; the trade
is more queue reads per waiting saga.

A status reader sees the same vocabulary per step — `succeeded`, `failed`,
`waiting` — plus `not-reached` for an index the saga never wrote.
`not-reached` is the ENDPOINT's word only: a step that never ran produces no
engine-side result to classify, and giving it the same word as `waiting` would
rebuild at the boundary the ambiguity this contract deletes.

**One advancer per saga, IN-PROCESS.** The boot pass, the retry scan, worker
events, the operator endpoints and the start path all funnel through the same
entry point, which allows only one execution of a given saga at a time in THIS
process. A dispatch arriving mid-run is coalesced into a single trailing pass,
so an event is never lost and N simultaneous events never become N executions.
This guard is in-process by construction and says nothing about concurrent
replicas: the deployment remains single-replica, and cross-process ownership is
the row-claim work that `saga-crash-recovery` owns.

---

## Saga Status Values

| Status         | Description                                       |
| -------------- | ------------------------------------------------- |
| `PENDING`      | Saga created, execution not yet started           |
| `RUNNING`      | Saga is actively executing steps                  |
| `COMPLETED`    | All steps executed successfully                   |
| `FAILED`       | A step failed; may trigger compensation           |
| `COMPENSATING` | Compensation steps are executing in reverse order |
| `COMPENSATED`  | All compensation steps completed                  |

---

## API Endpoints

### Start Post Publishing Saga

- **Method:** `POST`
- **URL:** `/api/sagas/post-publishing/start`
- **Auth:** Required

**Request Body:**

```json
{
  "definitionId": "post-publishing-saga",
  "context": {
    "correlationId": "string",
    "userId": "string",
    "metadata": {
      "postData": {
        "title": "string",
        "content": "string",
        "channelIds": ["channel-1", "channel-2"]
      }
    }
  }
}
```

**Response (201):**

```json
{
  "sagaId": "saga-post-publishing-abc123",
  "status": "PENDING",
  "startedAt": "2024-01-15T10:00:00Z"
}
```

---

### Get Saga Status

- **Method:** `GET`
- **URL:** `/api/sagas/:sagaId`
- **Auth:** Required

Returns the full `SagaInstance` object with sanitized context (sensitive metadata removed).

**Response (200):** `SagaInstance` | **404** if not found.

---

### Continue Saga

- **Method:** `POST`
- **URL:** `/api/sagas/:sagaId/continue`
- **Auth:** Required

Resumes execution of a saga that is in `PENDING` or `RUNNING` status. Used for event-driven progression (e.g., after a publishing job completes).

**Response (200):** Updated `SagaInstance`.

---

### Compensate Saga

- **Method:** `POST`
- **URL:** `/api/sagas/:sagaId/compensate`
- **Auth:** Required

Triggers compensation for a saga. Executes compensating actions in reverse step order for all successfully completed steps that define a `compensate` method.

**Response (200):** Updated `SagaInstance` with `status: "COMPENSATED"`.

---

### List Sagas

- **Method:** `GET`
- **URL:** `/api/sagas`
- **Auth:** Required

Query parameters: `status`, `definitionId`, `limit`, `offset`.

**Response (200):** Paginated list of `SagaInstance` summaries.

---

### Saga Health

- **Method:** `GET`
- **URL:** `/api/sagas/health`
- **Auth:** Required (`saga:read`)

Returns system health for the saga subsystem.

---

### Saga Metrics

- **Method:** `GET`
- **URL:** `/api/sagas/metrics`
- **Auth:** Required (`saga:read`)

**Response (200):**

```json
{
  "totalSagas": 1250,
  "activeSagas": 3,
  "completedSagas": 1200,
  "failedSagas": 15,
  "compensatedSagas": 32,
  "averageExecutionTime": "2.4s",
  "successRate": 0.96
}
```

---

## Post Publishing Saga — 5 Steps

The post-publishing saga orchestrates end-to-end post publication across social media channels.

### Step 1: Validate Post Data

- **Step ID:** `validate-post-data`
- **Execute:** Validates required fields (body, channelIds), character limits, media, and channel compatibility. Stores validated data in `context.stepData`.
- **Compensate:** None (validation is side-effect-free).

### Step 2: Create Post Entity

- **Step ID:** `create-post`
- **Execute:** Issues a `post.create` CQRS command using validated data from Step 1. Stores `postId` and `version` in context.
- **Compensate:** Issues a `post.delete` command to remove the created post. Idempotent -- skips if no `postId` exists.

### Step 3: Schedule Publishing Jobs

- **Step ID:** `schedule-publishing-jobs`
- **Execute:** Creates a BullMQ publishing job per channel. Stores `jobIds` and `channelCount` in context.
- **Compensate:** Cancels all queued jobs by their stored `jobIds`. Tolerates individual cancellation failures.

### Step 4: Wait for Publishing Completion

- **Step ID:** `wait-publishing-completion`
- **Execute:** Polls job statuses. Fails if any jobs are still pending or if any jobs failed. Stores completion stats.
- **Compensate:** None (read-only check).

### Step 5: Update Post Status

- **Step ID:** `update-post-status`
- **Execute:** Issues a `post.update` command setting status to `PUBLISHED` (all jobs succeeded) or `FAILED`. Stores previous status for compensation.
- **Compensate:** Reverts the post status to its previous value (`DRAFT`) and clears `publishedAt`.

---

## Execution Flow

1. Client calls `POST /api/sagas/post-publishing/start` with post data.
2. SagaManager creates a `SagaInstance` (status `PENDING`), persists it, publishes `SAGA_STARTED` event.
3. Steps execute sequentially. Each successful step advances `currentStep`.
4. **On `waiting`:** the saga stays on the same step with its retry budget intact and re-arms the poll; a worker completion event advances it sooner.
5. **On success:** Status becomes `COMPLETED`.
6. **On failure:** retries are spent per the retry policy; when the budget runs out the saga transitions to `COMPENSATING` (pre-pivot) and finally `COMPENSATED`, or to `FAILED` at or after the pivot, where forward recovery is the only canon-valid direction.
7. Terminal statuses (`COMPLETED`, `FAILED`, `COMPENSATED`) are guarded against re-execution.

---

## Prometheus Metrics

| Metric                                 | Type      | Labels                               | Description               |
| -------------------------------------- | --------- | ------------------------------------ | ------------------------- |
| `saga_execution_duration_seconds`      | Histogram | `definition_id`, `status`            | Total saga execution time |
| `saga_step_execution_duration_seconds` | Histogram | `definition_id`, `step_id`, `status` | Per-step execution time   |
| `saga_compensation_rate`               | Gauge     | `definition_id`                      | Rate of compensations     |
| `active_sagas_total`                   | Gauge     | `definition_id`, `status`            | Currently active sagas    |

---

## Event-Driven Progression

Sagas can advance via domain events rather than synchronous polling:

- **`post.publishing.job.completed`** — Triggers `continueSaga()` for sagas waiting on that job.
- **`external.service.timeout`** — Triggers `compensateSaga()` for affected running sagas matched by `correlationId`.
