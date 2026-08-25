# Gate Adjudication — `ci-live-tier-integrity`

Branch `workstream/ci-live-tier-integrity` · base `main` @ `8e89b21f` · 20 findings adjudicated (1 BLOCKER, 10 CRITICAL, 6 WARNING, 3 SUGGESTION) plus 1 spec conflict I found myself. **19 AMENDED, 1 REFUSED.**

Every claim below that I rely on I re-verified against the tree; citations are `file:line` at `8e89b21f`.

---

# Part 1 — AMENDED DESIGN

## 0. What changed at the gate, in one paragraph

The original design was right about the diagnosis and right about the three levers. It was wrong about five mechanisms, and it left one whole half of the class open. The corrections: BullMQ's `getWorkersCount()` **cannot** implement the unknown-vs-zero distinction the design depends on; the worker's `/health/ready` **fails open**, so mounting the gate on it as written could return 200 with zero consumers; the fail-loud probe **could not tell a missing consumer from an unreachable or rate-limited API**, reintroducing the misdirection it exists to remove; `pr-integration` has **two** live consumers plus a third planned, so deleting it is not a shim removal but a breakage; and `SAGA_WAIT_POLL_MS` moves ~25 s of a ~60 s tail, not "the tail" — the repo's own SLO document already decomposes it. Beyond corrections, the gate is right that the change was closing one instance of a class while the enabling defect — **`run_batch` is skip-blind, and it is calling three unrun service-dependent tests green today** — sat one file over, in a file this change already edits.

---

## 1. The environment: a live consumer for every queue the publish pipeline enqueues to (R1)

### 1.1 The queue set is derived, not listed — **AMENDED AT GATE**

_Changed: added `PUBLISH_PIPELINE_QUEUES` as the single runtime source plus a static drift check. Driven by finding F4 (R1-d / R1.4 had no mechanism anywhere in the design or its commits)._

R1-d is normative and the original design satisfied it nowhere: it hardcoded the literal `publish` in three separate places. `QUEUE_NAMES` has 20 entries (`packages/adapters/queue-bullmq/src/constants.ts:8-64`) and `apps/workers/src/bootstrap.ts:63-67` starts exactly two consumers, so 18 queues have no worker-process consumer at all — add one to the publish pipeline tomorrow and the environment is silently short a consumer again, green gate and all.

Add to `packages/adapters/queue-bullmq/src/constants.ts`:

```ts
/**
 * Every queue the post-publishing pipeline enqueues to. THE source of the
 * required-consumer set: worker readiness, the live suite's precondition and
 * the CI boot gate all iterate this, so adding a queue to the pipeline adds a
 * consumer requirement by construction rather than by anyone remembering.
 */
export const PUBLISH_PIPELINE_QUEUES = [QUEUE_NAMES.PUBLISH] as const;
```

Verified single-producer premise: `SchedulePublishingJobsStep` is the pivot and the only producer of publish jobs (`packages/shared/src/saga.ts:658`, and its own comment at `:686-688`); it enqueues through the injected closure at `apps/api/src/saga/SagaIntegration.ts:290-315`, which closes over `this.config.queue`, bound once at `apps/api/src/index.ts:317` (`queueRegistry.forQueue(QUEUE_NAMES.PUBLISH)`) and passed at `:701`.

Two consumers of the constant at runtime (so drift is impossible in the happy path), one static check for the drift that runtime cannot see:

- **Static drift check (R1.4).** A test in the existing static-suite idiom (`apps/api/tests/unit/saga/sagaContextInvariants.static.test.ts` reads source and asserts on it) that (a) reads `apps/api/src/index.ts` and `apps/api/src/saga/SagaIntegration.ts`, collects every `QUEUE_NAMES.<X>` identifier inside the `new SagaIntegration({…})` construction block and the `forQueue(…)` call that feeds its `queue:` field, and asserts each is a member of `PUBLISH_PIPELINE_QUEUES`; and (b) reads `apps/workers/src/bootstrap.ts` and asserts the set of queue names it registers consumer-presence checkers for **equals** `PUBLISH_PIPELINE_QUEUES`. A queue added to the pipeline and not to the constant fails (a); a queue in the constant with no consumer in the workers fails (b).

### 1.2 The observable: broker-registered consumers, read through the port — **AMENDED AT GATE**

_Changed: `getWorkers()` replaces `getWorkersCount()`, and the four unbounded job-list fetches in `health()` become O(1) counts. Driven by findings F10 (the sentinel is invisible through `getWorkersCount`) and F21 (the scrape path was an unbounded fetch every 10 s)._

The fact is the client-name registration BullMQ maintains in Redis: a `Worker` duplicates its connection with a `connectionName` issued as `CLIENT SETNAME`, and the queue matches `CLIENT LIST` entries against `` `${prefix}:${base64(queueName)}` `` — for us `bull:cHVibGlzaA==`. It is a fact registered in the shared broker, not a self-report: false when the worker points at a different Redis, when its BullMQ connection never opened, and when the process is gone.

**`getWorkersCount()` cannot be used.** Verified in the installed `bullmq@5.58.9`:

```js
// dist/cjs/classes/queue-getters.js:334-346
async baseGetClients(matcher) {
  try { const clients = await client.client('LIST'); return this.parseClientList(clients, matcher); }
  catch (err) { if (!clientCommandMessageReg.test(err.message)) throw err;
                return [{ name: 'GCP does not support client list' }]; }
}
// :369-372
async getWorkersCount() { const workers = await this.getWorkers(); return workers.length; }
```

On a broker without `CLIENT LIST` the sentinel array has length 1, so `getWorkersCount()` returns the integer **1** — "there is a consumer", from a broker that answered nothing. `.length` discards the only field that reveals it. The design's own false-green mitigation was therefore unimplementable through the API it named. Use `getWorkers()` and inspect the name. (Narrow trigger, worth recording: the sentinel path is guarded by a regex matching only `ERR unknown command 'client'`, so an ACL denial rethrows and fails closed. The sentinel is the rarer case, and the only one that returns a wrong _number_ instead of an error.)

`packages/ports/src/QueuePort.ts` — `consumers` is **required**, so every double must state a value (that compile error is the drift check):

```ts
export type QueueHealth = {
  connected: boolean;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  /** Consumers registered for this queue in the broker's own client registry.
   *  `null` = the broker cannot answer (no CLIENT LIST) — UNKNOWN, never zero.
   *  Every consumer of this field fails closed on `null`. */
  consumers: number | null;
};
```

`packages/adapters/queue-bullmq/src/queue-adapter.ts`, inside the existing `healthBreaker` (`:115-128`):

```ts
const healthBreaker = createCircuitBreaker(async () => {
  await connection.ping();
  // O(1) counts. The previous getWaiting()/getActive()/getCompleted()/getFailed()
  // default to (start = 0, end = -1) — full job objects, then .length. The publish
  // queue configures no removeOnComplete (setupServices.ts:646-649), so `completed`
  // grows without bound; on the scrape path below that is an unbounded fetch every
  // 10 s inside a 5 s breaker timeout.
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);
  const workers = await queue.getWorkers();
  const consumers =
    workers.length === 1 && workers[0]?.name === GCP_CLIENT_LIST_SENTINEL ? null : workers.length;
  return { connected: true, waiting, active, completed, failed, consumers };
});
```

`packages/monitoring/health-checks/src/checkers/queue.ts` passes `consumers` through in `details` and **does not change `status`**. Deliberate and re-verified: `queue` is in the API's readiness criticals (`apps/api/src/health/healthRoutes.ts:264`), so flipping it would 503 the API's readiness for a _producer_ that is legitimately healthy with no consumers. The fact is reported; the policy lives with each consumer.

### 1.3 Worker readiness must fail CLOSED — **AMENDED AT GATE**

_Changed: worker readiness switches from filtering `checkAll()` to per-name `checkDependency()`. Driven by finding F9 — the design mounted the CI gate on the one readiness endpoint in the repo that fails open._

Verified. The worker's readiness computes unhealthy deps by **filtering** a report:

```ts
// apps/workers/src/bootstrap.ts:139-141
const report = await healthManager.checkAll();
const criticalDeps = ["database", "redis"];
const unhealthyDependencies = report.dependencies.filter(
  (d) => criticalDeps.includes(d.name) && d.status !== "healthy"
);
```

and `checkAll()` iterates **only registered checkers** (`packages/monitoring/health-checks/src/index.ts:161`). A name in `criticalDeps` with no matching registered checker contributes zero entries → `length === 0` → **200 "ready"**. Registration throwing inside a guard, registration ordered after `healthServer.listen`, or a rename drift between the `register("…")` literal and the `criticalDeps` literal all produce a green gate over zero consumers within ~2 s — and CI then proceeds into the three 120 s burns with a green readiness step in the log. Spec R1-b forbids exactly this. The API's equivalent is already fail-closed (`healthRoutes.ts:264-277` uses `checkDependency`, which returns `err("NOT_FOUND")` for an unknown name at `index.ts:120-123` → 503), so the repo contains both shapes and the design picked the unsafe one.

Amended worker readiness:

```ts
const criticalDeps = ["database", "redis", ...PUBLISH_PIPELINE_QUEUES.map((q) => `consumer:${q}`)];
const results = await Promise.all(criticalDeps.map((n) => healthManager.checkDependency(n)));
const unhealthy = criticalDeps.filter((_, i) => {
  const r = results[i];
  return !r || !r.ok || r.value.status !== "healthy"; // NOT_FOUND -> not ready
});
```

One `ConsumerPresenceHealthChecker(queuePort)` per entry in `PUBLISH_PIPELINE_QUEUES`, registered `critical: true`, built on the existing `healthRedis` connection (`bootstrap.ts:85-91` — finite retries, 5 s command timeout: exactly the right failure semantics for a probe) via the queue-bullmq registry, constructed in the composition root as canon requires. Verdict: `consumers === null` → **unhealthy** (unknown ≠ present); `consumers === 0` → unhealthy; `> 0` → healthy.

**What this readiness cannot detect** — carried in the checker's JSDoc, because a probe that overclaims is worse than none:

- A worker whose **processor is wedged** (blocked loop, lock held) — the client name stays registered. Registration is not throughput.
- A **paused** worker — still a named client.
- A worker consuming a _different_ queue — excluded by construction; the match is queue-scoped.
- **Stale registration** (**AMENDED AT GATE**, finding F14): `CLIENT LIST` reflects sockets Redis has not yet reaped. A host that disappears or a SIGSTOPped process keeps its entry until the TCP-keepalive reap (~300 s at Redis's default `timeout 0`). Negligible in CI (same runner, socket closes on exit); load-bearing for the alert in §4, where it is stated and priced.
- On `CLIENT LIST`-less brokers: `null` → fails the probe closed. Correct, but it means "unavailable", not "no consumer".

### 1.4 Booting the workers in CI

Same job (`test-integration`, `ci.yml:216-355`) — it already owns Postgres, Redis, migrations and seed, and the workers must share the _same_ Redis instance as the API or the consumer count is meaningless.

`apps/workers/package.json` gains, mirroring `apps/api/package.json:9` exactly:

```json
"dev:test": "cross-env NODE_ENV=test node --conditions development --import tsx src/bootstrap.ts"
```

`--conditions development` is load-bearing, not cosmetic: `apps/workers` consumes ~12 bare workspace specifiers whose `exports` point at `dist`, and CI never builds. `cross-env` is justified rather than copied: `NODE_ENV=test` must come **from the script**, because `apps/workers/src/config/env.ts:21-22` selects `.env.test` on it — without that, the script's behaviour depends on the caller's environment, which is the ambiguity being removed. `cross-env` is added to `apps/workers` devDependencies (present in `apps/api`, absent here).

New step after `Start API in background` (`:328-343`); env is that block minus `PORT` and `ENABLE_RATE_LIMITING` (neither is read by the workers' env schema, and `ENABLE_RATE_LIMITING` exists only for `integration:flows`), plus explicit `PLATFORM_ENCRYPTION_KEY` (required at `apps/workers/src/config/env.ts:62`, `min(32)`; `.env.test` already carries it, so this is belt-and-braces over the dotenv load). `METRICS_PORT` left unset → `3300` (`bootstrap.ts:114`), no clash with the API on 3000.

**Gate — AMENDED AT GATE** _(finding F23: a dead boot burned the full 120 s and reported the wrong thing)_:

```bash
pnpm --filter @apps/workers dev:test > "$RUNNER_TEMP/workers.log" 2>&1 &
echo "WORKERS_PID=$!" >> "$GITHUB_ENV"
timeout 120s bash -c '
  until curl -fsS http://localhost:3300/health/ready >/dev/null; do
    kill -0 '"$!"' 2>/dev/null || { echo "::error title=publish workers exited during boot::see workers.log"; exit 1; }
    sleep 2
  done'
```

120 s not 90 s: the worker boot constructs 11 provider adapters (`publishWorker.ts:52-64`), initialises OpenTelemetry first, and runs `verifyDatabaseAuth()` — a colder start than the API's, on a runner already hosting the API, Postgres and Redis. `main().catch(… process.exit(1))` (`bootstrap.ts:266-268`) means a boot failure exits immediately, so the liveness term converts a 120 s spin into an immediate named failure. The health server binds only after `startPublishWorker` is awaited (`:63` then `:222`), so the endpoint is a strong signal once reachable.

The API step gets the same log redirection. Both are dumped by an `if: always()` step inside `::group::` blocks, which also runs `kill -0 "$WORKERS_PID" || echo "::error title=publish worker exited during the run::…"`. This is a real recovery, not hygiene: the explore measured (§8.2) that the API's stdout stops appearing in the job log the moment the boot step ends, so today the entire failure window has zero server-side telemetry — which is why the CI-side chain had to be deduced from code plus a local reproduction. `API_PID` is recorded at `:343` today and read by **no** step; now both are.

**The job name `Integration Tests` does not change** — see §3.3.

Also folded into the workers commit, named in the commit body so it is not smuggled: delete `bootstrap.ts:40-41`'s `dotenv.config({ path: "../../.env" })`. It is dead and CWD-fragile — ESM hoists the `./config/env.js` import at `:56`, so `config/env.ts:22` has already loaded the correct file by absolute path before line 41 runs, and dotenv does not override. Its only live effect would be injecting variables _after_ `createEnv` validated, i.e. invisible to the typed `env` — the exact split the env canon exists to prevent. (`rg` confirms the only `process.env` read in `apps/workers/src` is `config/env.ts:21`.)

### 1.5 Mid-run death — **AMENDED AT GATE**

_Changed: the between-batch re-check moves to immediately before the saga-live batch. Driven by finding F12 — the design named `wait_for_api()`'s neighbourhood, which is `run-tests.sh:299-312`, i.e. **after** `integration:saga-live` at `:283-284` and after `flow` and `remaining`._

Three points, and an honest residual:

1. **Before the batches** — the suite's own precondition (§2).
2. **Immediately before `integration:saga-live`** (`run-tests.sh:283`) — a `assert_publish_consumers` shell helper, so a worker that died during `integration:routes` / `integration:flows` (~2–3 min of runtime) is named there instead of three budget burns later.
3. **After the run** — the `if: always()` PID check + log dump.

Residual, stated plainly: **nothing detects a crash inside a single 120 s test.** GitHub Actions has no concurrent watchdog within a job, and a supervisor process is more machinery than the exposure warrants. Worst case is bounded at one test's budget and named after the fact.

---

## 2. The fail-loud precondition (R2)

### 2.1 Where it lives, and what it asserts

A shared helper `assertPublishConsumers()` in `apps/api/tests/testUtils.ts`, beside `checkApiAvailable` (`:17-26`), called from `sagaCustomerFlow.test.ts`'s `before` next to the existing API assertion (`:96-100`). Not in the health endpoint (that is the _source_, not the assertion); not inline in the suite (the next worker-dependent suite would re-invent it).

The failure path is already wired to a red gate: an assertion in `before` makes node:test report the subtests **cancelled**, and `run_batch` treats `cancel > 0` as `FAIL` (`run-tests.sh:104`), dumps the batch output, and prints the dedicated explanation at `:352-353`. No new gate plumbing.

It iterates `PUBLISH_PIPELINE_QUEUES` and, per queue, reads `GET {BASE_URL}/health/dependency/queue` → `body.details.consumers`. The endpoint exists (`healthRoutes.ts:297-332`), is public and unprefixed (`index.ts:499-500` — the same surface `checkApiAvailable` uses), returns `details` verbatim (`:317`) and carries **no** zod response schema on that route (`:298`), so `details.consumers` is not serialization-stripped.

Rationale for reading it from the API rather than the worker's own `:3300`: the API is the process that is _up_ when the workers are down, so it reports a number rather than a connection refusal ambiguous with "worker health server not yet listening"; the test already has `BASE_URL` and needs no `bullmq`/`ioredis` import in a suite whose `after` is already delicate (`sagaCustomerFlow.test.ts:211-239`); and the same fact then serves ops through an endpoint that already exists. The worker's `/health/ready` consumes the same fact for the _CI gate_. One fact, one adapter method, two consumers, two policies.

### 2.2 Six causes, six messages — **AMENDED AT GATE**

_Changed: the single hardcoded "consumers=0 / start the workers" message becomes a six-way branch, with a bounded retry, and `checkApiAvailable` stops reading 429 as "down". Driven by findings F5, F13, F18, F15._

The original probe collapsed distinct causes into one sentence, reintroducing inside the new mechanism the "message four inference steps from the cause" problem R2-b was written to eliminate. Three of those causes are reachable and one is likely:

- **429 is not hypothetical.** `/health/dependency/queue` prefix-matches the `/health` rule — `{ path: "/health", config: RateLimitConfigs.HEALTH }` (`httpRateLimitPreHandler.ts:104`), matched by `if (url.startsWith(rule.path))` (`:123`), `HEALTH = { windowMs: 60_000, maxRequests: 120 }` (`:35`) — the limiter is registered globally under `env.ENABLE_RATE_LIMITING` (`index.ts:430-440`) which `ci.yml:340` sets to `"true"`, and `security.test.ts:89-107` deliberately bursts **120** requests at `${BASE_URL}/health` asserting on the 429 count, inside `integration:flows`, the batch that runs **immediately before** `integration:saga-live` (`run-tests.sh:274-285`).
- **Circuit-breaker / unreadable queue is reachable and correctly fail-closed.** `resilience.ts:21-24` gives the health breaker `{timeout: 5000, errorThresholdPercentage: 50, resetTimeout: 30000}` with no opossum fallback, so `queue-adapter.ts:186-196` returns `err("CONNECTION_ERROR")` → `checkers/queue.ts:29-36` returns `unhealthy` with **no** `details` → `healthRoutes.ts:318` replies 503 with no `details.consumers`.

Contract:

| Observation                                 | Verdict | Message names                                                                              |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| transport error / no response               | FAIL    | the API is unreachable at `<BASE_URL>` — not the workers                                   |
| HTTP 429                                    | FAIL    | the probe was rate-limited; the `/health` bucket is shared with `integration:flows`' burst |
| HTTP 503 / status `unhealthy`, no `details` | FAIL    | the queue's state could not be READ (broker or circuit breaker) — unknown, not zero        |
| `details.consumers === null`                | FAIL    | the broker cannot answer `CLIENT LIST` — unknown, not zero                                 |
| `details.consumers` absent                  | FAIL    | this API predates the consumer field — rebuild/restart it                                  |
| `details.consumers === 0`                   | FAIL    | **no process is consuming `<queue>`** — the worker-less case                               |

The zero-consumer message, and only that one, carries the remedy and the mechanism:

> No process is consuming the `publish` queue (queue health reports `consumers=0` at `<BASE_URL>`). The saga's wait step will park until the 30-minute horizon and every publish-now test will burn its full budget. Start the workers: `pnpm dev` (API + workers) or `pnpm dev:workers`. In CI this means the "Start workers in background" step did not run, or the worker exited — see `workers.log`.

**Bounded retry, inside R2-c's 5 s.** Per queue: `AbortSignal.timeout(2000)`, up to 2 attempts 500 ms apart, retrying only the transport/429/unreadable classes (never `consumers === 0`, which is decided). Worst case 4.5 s. The API probe and the consumer probes run **concurrently** (`Promise.all`), so two sequential 3 s timeouts cannot exceed R2-c's bound (finding F15).

**One pre-existing bug fixed in the same helper:** `checkApiAvailable()` returns `response.ok` (`testUtils.ts:21`), so a 429 reads as "API down" and the saga suite's _existing_ assertion at `:96-100` already goes red naming the wrong cause. `security.test.ts:45-47` gets this right (`return response.ok || response.status === 429`). Align it, with the comment stating why.

**Cost when the property holds (R2-f):** one concurrent round of `fetch`, ≤ 2 s.

---

## 3. The merge gate (R4)

### 3.1 Decision: the live tier runs on **every** PR. No path filter. `pr-integration` **stays** — **AMENDED AT GATE**

_Changed: the token is kept; only CI's selection changes. Driven by finding F16 — the design's "exactly one consumer" premise is false._

Verified: `pr-integration` has **two** live consumers and a third planned.

- `apps/api/tests/unit/saga/runTestsGate.behavior.test.ts:43` — `const TIER = "pr-integration";`, spawned into the real script at `:104`, with the docblock at `:39-41` stating the tier was chosen precisely because _"no scenario waits on `wait_for_api`'s curl loop"_. Deleting the token makes `run-tests.sh:40-46` exit 2 (`Unknown TIER`), failing all 7 scenarios. Retargeting them to `full-integration` sends each through `wait_for_api`'s 30 × 2 s loop against an API that is not running — **7 × 60 s added to the Vitest unit phase**, which lives in `Test Suite (shard 1)`, the job that _sets the merge-gate critical path_ at ~503 s.
- `openspec/changes/auth-rate-limit-integrity/design.md:119` — an in-flight change on this same branch plans its PR-tier gate on that admission.

So it is not a compatibility shim for our own one-caller token; it is a used tier naming a real slice (DB-only, no server), and the rework rule does not apply. **Keep it, keep the guard arm, change only which tier CI selects**, and amend its docblock to say CI no longer selects it.

### 3.2 Why unconditional, and the spec amendment it forces — **AMENDED AT GATE**

_Changed: R4-f / R4.2's "a non-matching change SHALL NOT pay for the tier" is amended to a measured-budget requirement. Driven by my own finding F-X: the design's unconditional choice contradicted a MERGE-BLOCKING spec scenario, and neither the design nor any review named the conflict._

The case against a path filter is sound and I keep it: a change can break the saga without touching a filtered path — `apps/api/src/config/env.ts:266` (the poll interval), `apps/api/src/infrastructure/container/**` (the DI that hands the engine its `QueuePort`), `infra/prisma/**` (the `SagaInstance` row shape), `run-tests.sh` itself, any `packages/ports` change. Worse, that failure mode _is_ the one being fixed: a gate that structurally cannot see the thing it gates. The repo already documents this exact class as measured — `run-tests.sh:8-13` names SMELL-74 and SMELL-75 as holes in a hand-maintained list. Adding a second hand-maintained list, to gate the batch that already got two merges through on empty evidence, proposes the disease as the cure.

But R4-f says a non-matching change "SHALL NOT pay for the tier" and R4.2 is `[ci-outcome] [MERGE-BLOCKING]`. Unconditional violates both as written. **The requirement's intent is cost containment, and unconditional achieves it more safely.** Amended text, which the implementer treats as authoritative:

> **R4-f (amended). Cost containment.** The live publish tier MAY run on every proposed change. Its added wall-clock SHALL be measured against the recorded baseline and SHALL NOT extend the merge-gate critical path by more than **60 s**. If it does, the reduced variant of R4-g SHALL be adopted, and the measurement recorded.
>
> **R4.2 (amended) `[ci-outcome]` `[MERGE-BLOCKING]`** — GIVEN a proposed change touching none of the enumerated areas, WHEN the pipeline runs, THEN the tier's result is reported (never absent), the change is not blocked by it, and the run's critical path is within 60 s of the recorded baseline.

R4-d ("the gate reports a value for every change") is then satisfied trivially, and R4.2's not-applicable branch is void.

**The honest numbers — AMENDED AT GATE** _(finding F19: the original margin was computed from two hand-picked runs)_. Across 8 PR runs the `Test Suite (shard 1) → Coverage Merge` chain ranges **478–584 s**. The corrected post-change Integration estimate is **466–496 s** (the original omitted worker boot and applied no runner tax to a homelab saga-live measurement). On the observed 478 s run, Integration at ~480 s _would_ have become the critical path. The claim to carry is therefore **"0 to ~30 s of added PR latency"**, not "~100 s of margin" — still an easy trade against two red merges, and it must be re-measured at acceptance (Task V2).

`ci.yml:221`'s `timeout-minutes: ${{ github.event_name == 'push' && 25 || 12 }}` becomes a flat **15**, not 25 (finding F23: flattening to 25 doubles time-to-red on a hang; the measured worst case is ~640 s, so 15 min covers it with margin).

### 3.3 R4.6 is a verified no-op, not an intent — **AMENDED AT GATE**

_Changed: R4.6 downgrades from `[intent]` to a verified fact plus a one-command re-verification. Driven by finding F20._

I verified it myself:

```
$ gh api repos/edwardricardo/omni-post/branches/main/protection \
    --jq '{contexts:.required_status_checks.contexts, enforce_admins:.enforce_admins.enabled}'
contexts: [… "Integration Tests" …]   enforce_admins: true
```

`Integration Tests` is **already** a required context with admin enforcement. **No branch-protection change is needed, and the job MUST NOT be renamed** — a rename silently un-requires the gate this change exists to install. R4.6 becomes: record that command and that expectation in the design and the runbook; a CI check is still not added, because reading branch protection needs admin scope `GITHUB_TOKEN` does not carry, and a check that 403s is worse than a stated procedure.

### 3.4 Blast radius, stated — **AMENDED AT GATE**

_Changed: added. Driven by finding F20's second half._

Promoting the tier makes five batches merge-blocking for the first time — `integration:routes`, `integration:flows`, `flow`, `remaining`, `production` — plus the `wait_for_api` rate-limiter interlock. Five push samples show them all clean (`routes 33/33`, `flows 69/69`, `flow 34/34`, `remaining 167/167`, `production 83`), but those are serialized `main` pushes; they have never been exercised as a PR gate. This is the intended consequence — the pre-merge gate should equal the post-merge gate — and it is the residual accepted in Part 2.

### 3.5 Why not a subset

Killed by measurement. The three worker-dependent tests are the **slowest** in the file (59.70 / 50.00 / 59.65 s with workers) against a whole-file wall of **170.3 s**. A subset saves ≈ 0 s and drops 11 tests, including every cross-tenant IDOR assertion (`sagaCustomerFlow.test.ts:426-549`). Retained only as R4-g's fallback if §3.2's 60 s budget is breached.

---

## 4. The gate that enables the whole class: `run_batch` is skip-blind — **AMENDED AT GATE, NEW SECTION**

_Added at gate. Driven by the BLOCKER (F1) and findings F2, F7._

This change's thesis is that a tier must not report a verdict it did not earn. The original design layered one assertion inside one suite on top of a gate that structurally tolerates the class everywhere else.

```bash
# run-tests.sh:104
if [ "$fail" -gt 0 ] || [ "$cancel" -gt 0 ] || [ "$runner_exit" -ne 0 ]; then
```

No skip term. `TOTAL_SKIP` is accumulated at `:97` and printed at `:322-323` and **gates nothing**; the final gate at `:339` omits it too. The author clearly reasoned about this failure mode — the `cancel` term and the zero-collect term both exist for it — and stopped one term short. It is live today: push run `31926262264` reports `production 83 tests 80 pass 0 fail 0 cancel 3 skip exit 0 [OK]` and `TOTAL: 796 tests, 790 pass, 3 fail, 0 cancel, 3 skip`. Three service-dependent tests that never ran, called green, in the very tier this change is repairing. Spec R2-d ("SHALL NOT be a skip") and R8-d already reach for this lever; the design never picked it up.

**The baseline is exactly 3, and all three are nameable and closable.**

1. `should check worker metrics` (`production.integration.test.ts:549`, guarded by `skipIfWorkerUnavailable` at `:203-207`) probes `const WORKERS_METRICS = "http://localhost:9100"` (`:18`, `:174`, `:553`). **The workers serve 3300** (`bootstrap.ts:114`, `.env.example:69`, `prometheus/prometheus.yml:50-57`, which names 9100 as node_exporter's port). It has always skipped, and under the unamended design it would **still** skip after the workers are booted — a test whose entire purpose is to verify the worker's metrics endpoint, silently vacuous in the same job that just started that worker. Fix: derive from `process.env.METRICS_PORT ?? 3300`. It then executes and passes.
   2 & 3. `skipIfAdminUnavailable` (`:195-201`, call sites `:510`, `:524`) probes whether `apps/admin` answers `status < 500`. **No workflow boots `apps/admin` for this job**, so these have never executed once. Per the rework rule, they are deleted along with the `adminAvailable` probe (`:156-171`), and "no tier boots the admin app" is filed as the owning follow-up. A test that has never run is not coverage.

**The gate term**, scoped exactly like the zero-collect term so a developer trimming locally is not blocked:

```bash
if [ -n "${TIER:-}" ] && [ "$skip" -gt 0 ] && [ "$status" = "OK" ]; then
  status="FAIL"; FAILED_BATCHES="$FAILED_BATCHES $name"
fi
```

plus the redundant count term in the final gate (`:339`), matching the deliberate defence-in-depth the file's own comment at `:329-337` demands, and a new `ERROR:` branch explaining that a skipped test in a tier-driven run is a service the tier did not provide. `runTestsGate.static.test.ts:213` pins the final condition's terms and must be extended; `runTestsGate.behavior.test.ts`'s stub prints a hardcoded `# skipped 0` and needs a `GATE_STUB_SKIP` env plus a scenario.

Verified baselines this must not break: PR tier run `31897704078` → `TOTAL: 396 tests, 396 pass, 0 fail, 0 cancel, 0 skip`. Push tier → 3 skips, all in `production`. After (1)–(3), both tiers are at **0 skip** and the gate can be hard-zero from day one.

---

## 5. The second instance of the class: a security suite that asserts nothing — **AMENDED AT GATE, NEW SECTION**

_Added at gate. Driven by CRITICAL finding F3. "Out of scope" is not available: no existing item owns it._

`security-testing.yml`'s `custom-security-tests` job (`:76-155`) has migrations and seed but **no API boot** — the `Start API in background` step at `:218-222` belongs to `dast-owasp-zap`, gated to `schedule`/`workflow_dispatch` (`:161`). `test:security` is `node --test tests/security.test.ts` (`apps/api/package.json:28`), and `security.test.ts:43-60` probes availability then guards **18** cases with `t.skip()`. Proof: run `31926262261`, job `95114233447` → `Skipping security tests - API not available at http://localhost:3000` … `tests 18 / pass 0 / skipped 18`, **job conclusion success**.

Identical shape, security surface, different workflow — and unlike the saga case there is no red signal at all, so nothing would ever surface it. The design's mechanism cannot reach it (different suite, different capability, and the skip pre-empts any assertion). It is not currently a required check, so fixing it blocks nothing.

Scoped narrowly, because I verified the blast radius: among the five suites that job runs, **only `security.test.ts` fetches a live API** — `auth.test.ts`, `rbac.test.ts`, `mfa.test.ts` contain no `fetch`/`BASE_URL`, and `test:ratelimit` is Vitest unit files. So:

1. Boot the API in `custom-security-tests`, readiness-gated, mirroring `ci.yml`'s pattern (~12 lines).
2. Replace `security.test.ts`'s availability-skip with one fail-loud precondition in `before`, and delete all 18 `if (!apiAvailable) t.skip()` guards. Mechanical, one pattern.
3. **A class-level static guard**, which is what makes this the class rather than the instance and which satisfies R4-c ("the mapping SHALL be data the gate reads"): derive the set of API-dependent suites (files under `apps/api/tests` matching `getBaseUrl|BASE_URL`), map `apps/api/package.json` scripts to the files they name, scan `.github/workflows/*.yml` for steps invoking those scripts, and assert every containing job has a step that boots an API. **It fails today on `security-testing.yml`**, which is precisely why it lands with the fix.

---

## 6. The observability of the outage (R5)

### 6.1 Not a new mechanism — a missing axis on an existing one

`prometheus/alerts/saga.yml:125-135` (`SagaWaitingRowsAccumulating`) already names this exact scenario in its description ("publish workers down or not consuming") — but its expression is `min_over_time(saga_waiting_rows[15m]) > 50`, `for: 10m`: **more than 50 sagas waiting continuously for ~25 minutes.** Volume-gated by construction; at this system's volume a total outage never trips it, and the cohort dies silently at the horizon, then surfaces as `SagaTimeoutSpike` (`> 3` in 10 m — still volume-gated, and only after the damage). No `up{}` or `absent()` rule exists anywhere in `prometheus/alerts/`.

Lowering that threshold is wrong on the merits, not merely weaker: `saga_waiting_rows` counts `RUNNING` rows with a scheduled re-entry, and a _healthy_ publish sits in that state for up to one poll interval. `min_over_time(...) > 0` is noisy on a busy system and silent on a quiet one — the wrong axis at every threshold.

### 6.2 The signal, published by the API

The observer must survive the outage: a worker-side gauge goes absent when workers die, and absence is ambiguous with a scrape misconfiguration. The API already holds the publish `QueuePort` (`index.ts:317`) and is up precisely when workers are not. (Confirming the point: `worker_queue_depth` (`workerMetrics.ts:181-185`) has **no producer at all** in production code — only `workerMetrics.test.ts` — and `worker_health_status` is set once at construction and once at subscribe and never flips. Neither could carry this.)

Two gauges in `apps/api/src/metrics/sagaRecoveryMetrics.ts` using the file's established scrape-time provider idiom (`getOrCreateGauge` + `collect`, `:36-49`; providers installed/detached by the lifecycle):

- `publish_queue_consumers` — registered consumers; **`-1` when the broker answers `null`**, so "unavailable" is never read as "zero".
- `publish_queue_waiting` — waiting depth from the same `health()` call.

One `health()` round trip per scrape, now **six O(1) Redis commands** rather than four unbounded list fetches (§1.2, finding F21).

### 6.3 The rules — **AMENDED AT GATE**

_Changed: added the `absent_over_time` companion; restated R5-b's ≤10-minute figure as the rule's own arithmetic, with the staleness term stated. Driven by findings F22 and F14._

```yaml
- alert: PublishQueueUnattended
  expr: max_over_time(publish_queue_consumers[5m]) == 0
    and max_over_time(publish_queue_waiting[5m]) > 0
  for: 5m
  labels: { severity: critical, component: publish }
  annotations:
    runbook: docs/runbooks/alert-saga-timeout.md

- alert: PublishQueueSignalMissing
  expr: absent_over_time(publish_queue_consumers[10m])
  for: 5m
  labels: { severity: warning, component: publish }
  annotations:
    runbook: docs/runbooks/alert-saga-timeout.md
```

- **Both terms in the first rule are required.** Consumers-only pages on a deliberate scale-to-zero with an empty queue. Waiting-only pages on an ordinary burst. Together they say exactly "work is queued and nobody is taking it" (R5-d).
- **`max_over_time` (a ceiling), not `min_over_time`.** Its siblings use the floor because they watch a level that should _drain_; here one scrape that saw a consumer proves attendance, so a zero ceiling is the honest "not once in five minutes". `-1` (unknown) fails `== 0` and stays silent (R5.2) — a broker that cannot answer must not page.
- **The second rule closes the design's own blind spot.** `max_over_time` over an _absent_ series yields no result, so if the API is down or the provider throws — the case closest to the incident — the first rule silently stops firing. The design rejected `absent()` as a mechanism for the primary signal (correctly: it is scrape-target liveness and cannot distinguish "up but not consuming _this_ queue") and then left its own series unguarded.
- **Window arithmetic, honestly stated.** 5 m lookback + `for: 5m` = the rule is satisfiable at **10 minutes**, one third of the 30-minute horizon (`packages/shared/src/saga.ts:1006`) and ~15 minutes ahead of `SagaWaitingRowsAccumulating`. R5.3's static test checks exactly that sum. **The end-to-end detection latency is larger and is not that number**: `evaluation_interval: 15s` and `scrape_interval: 10s` add ~25 s, and the broker's client-registry staleness (§1.3) can add up to ~300 s at Redis's default reap. Worst case ≈ **15 minutes**, still comfortably inside the horizon. Per project rule 2, the ≤10-minute figure is stated as the _rule's_ property (backed by R5.3) and the ~15-minute end-to-end bound is stated in the runbook and the metric help text as a measured bound, not as a guarantee.
- `SagaWaitingRowsAccumulating` gains one cross-reference line naming `PublishQueueUnattended` as its early-warning sibling; its expression, threshold and hold are **unchanged** (R5.4).
- Runbook: `docs/runbooks/alert-saga-timeout.md` (exists; already the destination for both saga rules), extended with a "no consumer" section carrying R5-e's operator meaning — affected sagas stay non-terminal for up to the horizon then terminalize under `reason="timeout"`, and **a terminal failure under that reason does NOT mean nothing was published**; check the provider before retrying anything.
- A row in `docs/observability/SLO.md` §Saga (the table at `:38-46`), which every existing rule has.

### 6.4 The limitation that is stated, not implied

`prometheus/prometheus.yml:11-18` has the entire `alerting:`/`alertmanagers:` block **commented out**, with its own note that "§4.2.b PENDING — sin esto, las rules se evalúan … pero no se envía notification push". Every alert in this repo is currently a rule, not a page. This change delivers a correct, tested rule on a correct series; the notification path is pre-existing debt owned by §4.2.b. The runbook section and the SLO row say **"evaluated; routing pending §4.2.b"** — so no green checkbox implies an operator will hear anything.

Testing follows the repo's established pattern, which is a static test reading the YAML, not promtool (`sagaContextInvariants.static.test.ts:1870-1944` already does this — `:1936` pins `min_over_time(saga_waiting_rows[\d+m])`, `:1938` pins `runbook:`): both rule blocks exist with their terms, `for:`, and `runbook:`; both gauges are declared with providers installed by the wiring; and a unit test reads `client.register.getSingleMetric("publish_queue_consumers")` against a stub `QueuePort` asserting `-1` on `null`.

---

## 7. Headroom, and the only permitted lever (R6) — **AMENDED AT GATE**

_Changed: the tail decomposition is corrected, the lever's magnitude is corrected, the trigger is reconciled to the spec's 80 s, and a second lever is named. Driven by findings F17 and F7-of-lens-3._

The original design modelled the tail as poll-quantized and pre-authorized `SAGA_WAIT_POLL_MS: "5000"` as the sole lever. The mechanism is more specific, and the repo already documents it.

**The measured 59.7 s decomposes as** (`docs/observability/SLO.md`, §"La cola de latencia": _"~60 s hasta un FAILED con la causa real, de los cuales ~30 s son ese intervalo"_):

| Term                                                                                                                       | Value                               | Moves with CPU? | Moves with the lever? |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------- | --------------------- |
| BullMQ job retries — `attempts: 3, backoff exponential delay 5000 jitter 0.5` (`setupServices.ts:646-649`)                 | ~15–25 s, overlapping the next term | no (timers)     | no                    |
| One wait-poll interval — the race between the completion event and the queue's state update                                | **~30 s** = `SAGA_WAIT_POLL_MS`     | no              | **yes → 5 s**         |
| Saga retry envelope — `retryPolicy {maxRetries: 3, backoffMs: 5000, exponential: true}` (`saga.ts:1007-1011`), 5 + 10 + 20 | **35 s**                            | no              | no                    |
| Retry-scan granularity (`SagaManagerLifecycle`, 5 s tick)                                                                  | ≤ 5 s per re-entry                  | no              | no                    |

Two consequences the design did not draw:

1. **The runner-speed risk is small.** The tail is dominated by _timers_, not compute. A slower runner adds only the compute fraction. That is why 59.70 s on a homelab is a reasonable predictor of a GitHub runner, and why the 120 s budget has real margin.
2. **The lever is real but bounded to ~25 s.** It moves one term, from 30 s to 5 s: worst case ≈ **40 s**. The floor without it is ≈ **35–40 s** (the saga retry envelope, which no CI-only setting may touch because it is the production definition). Lens 3 was right that the lever cannot move most of the tail; its "immovable 45–55 s floor" is off — the repo's own decomposition puts the poll term at ~30 s of the ~60 s.

**The rules, unchanged in intent, corrected in fact:**

- Ship **without** the lever. Measured headroom is 59.70 s against 120 s, and overriding up front would mean CI never exercises the real cadence.
- **Trigger: 80 s**, not 90 s — R6-e is normative ("more than two thirds of its budget"; two thirds of 120 000 ms = 80 000 ms) and the design's 90 s contradicted it. One number, in both documents.
- **First lever:** `SAGA_WAIT_POLL_MS: "5000"` in the **API boot step's env only** (`ci.yml:328-343`). Verified API-only: `apps/api/src/config/env.ts:266` (`min(1000).max(300_000).default(30_000)`), wired at `index.ts:710`; **absent** from `apps/workers/src/config/env.ts`. Inside the schema floor. Not the forbidden lever: budget, horizon and default all untouched, and the 30 s default stays pinned by `sagaContextInvariants.static.test.ts:1729-1731`.
- **Second lever, named because the first is bounded — AMENDED AT GATE:** if a case still exceeds 80 s with the poll at 5 000, the escalation is **R4-g's reduced variant plus a recorded measurement and an owner decision** — never the budget, never the horizon, never the default, and never the production retry policy. The design previously had no fallback past the first lever; that was a dead end at the exact point the decision matters.
- R6.3: per-case durations are already observable in the TAP output's `duration_ms`; the acceptance task reads them.

---

## 8. What this design cannot do

| Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Owner                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **The `nextRetryAt = NULL` engine defect.** `SagaManagerExecution.ts:515-545`: on first entry to the wait step `armedBefore` is always `undefined` (the pivot cleared it), so the persist-failure branch at `:527-530` restores `undefined`, leaving a durable `RUNNING` row the scan predicate `nextRetryAt: { lte: now, not: null }` can never select — while the log at `:535-539` claims "re-selected on the existing schedule". Verified in source; needs a DB write failure; bounded by the horizon.                                                                                                                                                                   | S3+S4 (`saga-engine-terminal-hygiene`), which already edits this file |
| **A worker registered but wedged or paused.** Readiness proves broker registration, not throughput. A throughput SLI (`rate(worker_jobs_completed_total)` against `publish_queue_waiting > 0`) would close it.                                                                                                                                                                                                                                                                                                                                                                                                                                                               | New follow-up; needs the dead-metric item below first                 |
| **`worker_queue_depth` and `setUnhealthy()` are dead** (`workerMetrics.ts:181-185, 443-445` — never called outside `workerMetrics.test.ts`). A metric surface tested but never produced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | New smell entry (`docs/reports/roadmap-detected-smells-backlog.md`)   |
| **No tier boots `apps/admin`** — the reason the two deleted admin probes had never executed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | New smell entry, filed by §4                                          |
| **The alert routes nowhere** (`prometheus.yml:11-18`), and **Prometheus targets are dev-compose addresses** (`:41, :57` use `host.docker.internal`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | §4.2.b, pre-existing                                                  |
| **`CLIENT LIST`-less managed Redis.** Readiness fails closed (`null` → not-ready) rather than false-green — correct, but unavailable. If this project ever moves to Memorystore, a worker heartbeat becomes the _required_ mechanism and §1.2's rejection of it reverses.                                                                                                                                                                                                                                                                                                                                                                                                    | Deployment-topology decision; noted in the checker's JSDoc            |
| **A crash inside a single test's 120 s window.** No concurrent supervisor exists in a GH Actions job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Accepted residual (§1.5)                                              |
| **SMELL-74 / SMELL-75.** The batch lists stay hand-maintained (`run-tests.sh:8-13`). This design removes the _tier_ blind spot and now the _skip_ blind spot; not the _list_ blind spot. — **AMENDED AT GATE** _(finding F8)_: nine live-API suites belong to no batch (`aiLocalizedRoutes`, `analyticsPremiumRoutes`, `analyticsStreamRoutes`, `customerLoginMfaE2e`, `inboxRoutes`, `mfaCustomer`, `repurposeRoutes`, `sendReplyGuardrail`, `trendRadarRoutes`, plus `universal-client-dashboard`), and every one of them calls `getBaseUrl`/`checkApiAvailable`. Whoever wires them inherits R1 and R2 rather than re-deriving them; the §6 note says so.                 | SMELL-75, filed OUT by the owner                                      |
| **The 36 untested route files.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Filed OUT by the owner                                                |
| **A live worker now consumes `publish.flow.test.ts`'s round-trip job** — **AMENDED AT GATE** _(finding F6)_: `apps/api/tests/publish.flow.test.ts:316-333` enqueues `{postId:"test-post-id", …}` into the real queue and asserts only `enqueueResult.ok`. Today nothing eats it; after the boot, a live worker picks it up, fails to resolve the post, and walks its retry path — error logs and a failed job that did not exist before, in the same job as `remaining` and `production`. Not obviously breaking, but unmodelled, and the local A/B measured only `sagaCustomerFlow`. Acceptance Task V1 measures the whole live tier with workers, not just the saga batch. | This change, at V1                                                    |
| **Whether 120 s is comfortable on a GH runner.** Unknowable until the first push run; the levers and the 80 s trigger are pre-authorized in §7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | This change, at V1                                                    |

---

# Part 2 — GATE DISPOSITION

| #   | Finding                                                                                     | Sev         | Disposition        | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------- | ----------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | `run_batch` is skip-blind; 3 unrun service-dependent tests called green today               | **BLOCKER** | **AMENDED**        | §4: tier-scoped skip term in `run_batch` + the final gate; baseline driven to 0 by fixing the 9100→3300 probe and deleting two never-executed admin probes                                                                                                                                                                                                                                                                                                                                                                                           |
| F2  | Worker-metrics test probes `:9100`; workers serve `:3300` — would still skip after the boot | CRITICAL    | **AMENDED**        | §4: derive from `METRICS_PORT ?? 3300`; lands in the same commit as the worker boot                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F3  | `security-testing.yml` runs a live-API suite with no API: 0 pass / 18 skipped, job green    | CRITICAL    | **AMENDED**        | §5: boot the API in that job, replace the 18 skips with one fail-loud precondition, and add a class-level static guard that fails today on that file                                                                                                                                                                                                                                                                                                                                                                                                 |
| F4  | R1-d / R1.4 (derived required-consumer set) had no mechanism                                | CRITICAL    | **AMENDED**        | §1.1: `PUBLISH_PIPELINE_QUEUES` as the single runtime source + a two-part static drift check                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F5  | The probe cannot tell "no consumer" from "API unreachable" / 429 — R2-b, R2-e               | CRITICAL    | **AMENDED**        | §2.2: six-way cause branch, bounded retry, and `checkApiAvailable`'s 429 blindness fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F6  | A live worker now eats `publish.flow.test.ts`'s round-trip job                              | WARNING     | **AMENDED**        | §8 + Task V1: the whole live tier is measured with workers, not just the saga batch                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F7  | Two admin-gated tests will now run on every PR and still assert nothing                     | WARNING     | **AMENDED**        | §4: deleted with the probe; "no tier boots the admin app" filed as the owning smell                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F8  | Nine unbatched live-API suites overlap SMELL-75                                             | SUGGESTION  | **AMENDED**        | §8: the overlap named, so SMELL-75's owner inherits R1/R2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F9  | Worker `/health/ready` fails **open** on an unregistered critical checker                   | CRITICAL    | **AMENDED**        | §1.3: per-name `checkDependency` (fail-closed, matching the API); RED test for the unregistered case, which R1.1 as written would not have caught                                                                                                                                                                                                                                                                                                                                                                                                    |
| F10 | `getWorkersCount()` discards the GCP sentinel → the `null` mitigation is unimplementable    | CRITICAL    | **AMENDED**        | §1.2: `getWorkers()` + explicit sentinel detection; verified in the installed `bullmq@5.58.9`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F11 | (duplicate of F4)                                                                           | CRITICAL    | **AMENDED**        | §1.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F12 | The between-batch re-check was placed **after** the batch it protects                       | WARNING     | **AMENDED**        | §1.5: moved to immediately before `run-tests.sh:283`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F13 | The failure message hardcodes "consumers=0 / start the workers" for three causes            | WARNING     | **AMENDED**        | §2.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F14 | Stale client registration unstated; R5-b's ≤10 min not backed end-to-end                    | WARNING     | **AMENDED**        | §1.3 + §6.3: staleness named as a blind spot; ≤10 min restated as the rule's arithmetic (R5.3), ~15 min stated as the measured end-to-end bound                                                                                                                                                                                                                                                                                                                                                                                                      |
| F15 | Two sequential 3 s probes exceed R2-c's 5 s worst case                                      | SUGGESTION  | **AMENDED**        | §2.2: concurrent probes, 2 s timeout, ≤ 4.5 s worst case                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F16 | `pr-integration` has a second consumer; deleting it costs ~7 min on the critical path       | CRITICAL    | **AMENDED**        | §3.1: the token stays (two live consumers + one planned in `auth-rate-limit-integrity`); only CI's selection changes                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F17 | The pre-authorized lever cannot move most of the tail; no second lever named                | CRITICAL    | **AMENDED**        | §7: corrected decomposition from the repo's own SLO doc (~30 s of ~60 s IS the poll); lever bounded to ~25 s; second lever named as R4-g + owner decision                                                                                                                                                                                                                                                                                                                                                                                            |
| F18 | The probe can go false-red via the queue circuit breaker, misdirecting the investigation    | CRITICAL    | **AMENDED**        | §2.2: the unreadable-queue case gets its own verdict and message; bounded retry inside R2-c                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F19 | Margin is ~0–30 s, not ~100 s, and can invert                                               | WARNING     | **AMENDED**        | §3.2: the honest number carried, plus a 60 s critical-path budget with R4-g as the escape                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F20 | Five batches silently become merge-blocking; R4.6's `[intent]` is weaker than the evidence  | WARNING     | **AMENDED**        | §3.3 (verified: `Integration Tests` is already required, `enforce_admins: true`; the job MUST NOT be renamed) + §3.4 (blast radius stated)                                                                                                                                                                                                                                                                                                                                                                                                           |
| F21 | The scrape-time gauge turns an unbounded fetch into a scheduled one every 10 s              | WARNING     | **AMENDED**        | §1.2: O(1) `get*Count()` in the health path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F22 | `max_over_time` over an absent series stops firing at the moment closest to the incident    | SUGGESTION  | **AMENDED**        | §6.3: `PublishQueueSignalMissing` companion rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F23 | Dead worker boot burns the 120 s gate; flat 25 min doubles time-to-red; fitness #27 scope   | SUGGESTION  | **AMENDED**        | §1.4 (`kill -0` inside the loop), §3.2 (flat **15**, not 25), Task C2b (widen #27 to `apps/workers/package.json` + `bootstrap.ts`, in lockstep with CLAUDE.md)                                                                                                                                                                                                                                                                                                                                                                                       |
| F-X | _(mine)_ Unconditional PR tier contradicts MERGE-BLOCKING R4-f / R4.2                       | CRITICAL    | **AMENDED (spec)** | §3.2: R4-f/R4.2 amended from "SHALL NOT execute" to a measured 60 s critical-path budget with R4-g as the fallback — the requirement's intent was cost containment, and unconditional achieves it more safely than a hand-maintained path list                                                                                                                                                                                                                                                                                                       |
| F-Y | _(mine)_ Lens 3's "immovable 45–55 s floor" for the tail                                    | —           | **REFUSED**        | The floor is the saga retry envelope, **35 s** (`saga.ts:1007-1011`, 5+10+20), not 45–55 s. The repo's own `docs/observability/SLO.md` §"La cola de latencia" decomposes the measured ~60 s as _"de los cuales ~30 s son ese intervalo [de poll]"_, and the job-retry term (`setupServices.ts:646-649`, ~15–25 s) overlaps the envelope rather than adding to it. The lever therefore lands the worst case at ~40 s, not ~45–55 s. The finding's **conclusion** (name a second lever) is accepted and amended in §7; only its arithmetic is refuted. |

### Residual risks accepted

| Residual                                                                                      | Why accepted                                                                                                                                                                                        | Owner                                     |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| A worker crash **inside** a single 120 s test is not detected while it happens                | No concurrent supervisor exists in a GH Actions job; a bespoke one is more machinery than the exposure warrants. Bounded at one test's budget, and named afterwards by the `if: always()` PID check | This change (§1.5)                        |
| Readiness proves **registration, not throughput** — a wedged or paused worker reads ready     | Registration is the only fact the broker itself holds; throughput needs a rate SLI, which needs the dead worker metrics fixed first                                                                 | New follow-up (§8)                        |
| Broker client-registry **staleness** widens end-to-end detection to ~15 min                   | Still half the 30-minute horizon; the alternative (controlling Redis's socket reap) is not ours to set. Stated in the runbook and the metric help rather than implied away                          | This change (§6.3)                        |
| `PublishQueueUnattended` **pages nobody** until Alertmanager is wired                         | Pre-existing for every rule in the repo; the runbook and SLO row say "evaluated; routing pending" so no checkbox implies otherwise                                                                  | §4.2.b                                    |
| Five batches become merge-blocking for the first time; live-tier flake now blocks every PR    | That is the intended consequence — the pre-merge gate should equal the post-merge gate. Five push samples show all five clean; R4-g is the escape if that stops being true                          | This change (§3.4)                        |
| PR latency **+0 to ~30 s**, and the Integration job may occasionally become the critical path | Measured; the alternative has already cost two red merges and a full diagnosis session. Budgeted at 60 s with R4-g as the fallback                                                                  | This change (§3.2)                        |
| `pr-integration` remains a tier CI no longer selects                                          | It has two live consumers and one planned; the docblock states CI's selection so it is not read as dead config                                                                                      | This change (§3.1)                        |
| The `nextRetryAt = NULL` defect ships unfixed                                                 | Needs a DB write failure, bounded by the horizon, and lives in a file another in-flight slice already edits                                                                                         | S3+S4 `saga-engine-terminal-hygiene` (§8) |

---

# Part 3 — TASKS

**Conventions.** `RED` = write the failing test first and record its failure. 🔐 = touches a sensitive path (`.github/workflows/**`, `CLAUDE.md`) and needs `omnipost-allow sensitive-edit` before the edit. ⚠️ = branch is `workstream/*`, so every non-trivial edit needs the plan-mode guard cleared (a `/root/.claude/plans/*.md` Read/Edit in the parent transcript, or Plan Mode activity) — the orchestrator does this once, up front. Local runs use `--pool=forks --no-file-parallelism` and `NODE_OPTIONS=--max-old-space-size=3072` per the LXC caps.

Four PRs. Each commit leaves lint / tsc / the 24 fitness greps / tests at 0/0.

---

## PR 1 — "the environment is real" (turns `main` green) · ~280 lines

### C1 — `feat(queue): report the publish queue's registered consumer count as queue health`

| Task    | Satisfies  | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Verified by                                                                                                                                                                                                           | RED? |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **1.1** | R1-b, R5-a | `packages/ports/src/QueuePort.ts`: `consumers: number \| null` **required** on `QueueHealth`, with the "null = unknown, never zero" JSDoc                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `tsc` fails everywhere a double omits it — that compile error **is** the drift check                                                                                                                                  | —    |
| **1.2** | R1-b, R5.2 | `packages/adapters/queue-bullmq/src/queue-adapter.ts`: `healthBreaker` calls `getWorkers()`, maps the `GCP does not support client list` sentinel → `null`, else `.length`; export the sentinel literal as a named constant                                                                                                                                                                                                                                                                                                                                                                       | **RED first**: unit test with a stubbed `Queue` returning (a) 2 real client rows → `consumers: 2`; (b) the sentinel row → `consumers: null`; (c) `[]` → `0`. (b) is the one that fails on a naive `getWorkersCount()` | ✅   |
| **1.3** | F21        | Same file: the four job-list fetches become `getWaitingCount()` / `getActiveCount()` / `getCompletedCount()` / `getFailedCount()`, in one `Promise.all`; comment states why (unbounded `completed`, 10 s scrape, 5 s breaker)                                                                                                                                                                                                                                                                                                                                                                     | **RED first**: a test asserting the health path issues no `getJobs`-shaped call (spy on the stub) and that counts still round-trip                                                                                    | ✅   |
| **1.4** | R1-b       | `packages/monitoring/health-checks/src/checkers/queue.ts`: widen the structural `QueueAdapter` type, pass `consumers` through in `details`; **status logic untouched**                                                                                                                                                                                                                                                                                                                                                                                                                            | **RED first**: `consumers` appears in `details`; `status` is `healthy` with `consumers: 0` and with `consumers: null` (the API is a producer)                                                                         | ✅   |
| **1.5** | —          | Update the doubles the required field breaks: `apps/api/tests/integration/helpers/bulkScheduleHarness.ts`, `apps/api/tests/unit/sagaIntegration.helpers.ts`, `apps/api/tests/unit/healthRoutes.test.ts`, `apps/api/tests/unit/application/{dispatchInboxSync,dispatchAnalyticsIngestion}.test.ts`, `apps/api/tests/unit/application/listening/DispatchMentionSearchUseCase.test.ts`, `packages/monitoring/health-checks/src/tenantHealth.ts`, `apps/admin/components/maintenance/QueueHealthPanel.tsx` + `apps/admin/app/[locale]/(dashboard)/maintenance/page.tsx` if they destructure the shape | `pnpm build` + `pnpm --filter @apps/api test` green                                                                                                                                                                   | —    |

Green on landing: purely additive data with no consumer yet.

### C2 — `feat(workers): gate worker readiness on the publish queue having a consumer`

| Task       | Satisfies          | Changes                                                                                                                                                                                                                                                                                                                               | Verified by                                                                                                                                                                                   | RED? |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **2.1**    | R1-d, R1.4         | `packages/adapters/queue-bullmq/src/constants.ts`: export `PUBLISH_PIPELINE_QUEUES = [QUEUE_NAMES.PUBLISH] as const` with the "single source" JSDoc                                                                                                                                                                                   | consumed in 2.2, 2.3, 5.1                                                                                                                                                                     | —    |
| **2.2**    | R1-a, R1-b         | New `ConsumerPresenceHealthChecker` (own file, `@file`/`@layer infrastructure`), with the four-item "cannot detect" JSDoc from §1.3 (wedged, paused, stale registration, `CLIENT LIST`-less)                                                                                                                                          | **RED first**: `consumers > 0` → healthy; `0` → unhealthy; `null` → unhealthy; port error → unhealthy                                                                                         | ✅   |
| **2.3**    | R1-b, R1-c, **F9** | `apps/workers/src/bootstrap.ts`: build the publish `QueuePort`(s) on `healthRedis` in the composition root, register one checker per `PUBLISH_PIPELINE_QUEUES` entry as `consumer:<queue>` `critical: true`, and **replace the `checkAll()`-filter readiness with per-name `checkDependency`** so an unregistered critical name → 503 | **RED first, three cases**: (a) 0 consumers → 503; (b) ≥1 → 200; (c) **the checker not registered at all → 503** — (c) fails on the pre-amendment filter shape and is the finding's own proof | ✅   |
| **2.4**    | —                  | Same file: delete the dead `dotenv.config({ path: "../../.env" })` at `:40-41`; commit body states the ESM-hoisting reason                                                                                                                                                                                                            | `rg "process\.env" apps/workers/src` still returns only `config/env.ts:21`; boot smoke-test unchanged                                                                                         | —    |
| **2.5**    | R1-c               | `apps/workers/package.json`: add `dev:test` (`cross-env NODE_ENV=test node --conditions development --import tsx src/bootstrap.ts`) + `cross-env` devDependency                                                                                                                                                                       | `pnpm --filter @apps/workers dev:test` boots against `.env.test` with no exported `NODE_ENV`                                                                                                  | —    |
| **2.6** 🔐 | R6, project rule 4 | Widen fitness **#27 Part A** to cover `apps/workers/package.json` and to select `src/bootstrap.ts` alongside `--test`/`seed.ts` — **in `.github/workflows/fitness.yml` and `CLAUDE.md` in the same commit** (the regex in the doc IS the regex in CI)                                                                                 | The widened grep returns 0 at branch tip and returns 1 if `--conditions development` is stripped from 2.5                                                                                     | —    |

Green on landing: workers are not in CI yet.

### C3 🔐 — `ci: boot apps/workers in the push tier, readiness-gated, with log capture`

| Task    | Satisfies  | Changes                                                                                                                                                                                                                                                                                               | Verified by                                                                                                      | RED? |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---- |
| **3.1** | R1-a, R1-c | `.github/workflows/ci.yml` only: the `Start workers in background` step (§1.4 env), the `:3300/health/ready` gate with the in-loop `kill -0` liveness term, both processes redirected to `$RUNNER_TEMP/*.log`, the `if: always()` dump + PID check. **Job name `Integration Tests` unchanged** (§3.3) | The acceptance signal is a push run: `integration:saga-live 14 tests 14 pass 0 fail 0 cancel 0 skip exit 0 [OK]` | —    |

**This is the commit that turns `main` green.** Nothing after it is required for that.

---

## PR 2 — "the gate cannot lie" · ~340 lines

### C4 — `fix(ci): a skipped test in a tier-driven run is a failure`

| Task    | Satisfies          | Changes                                                                                                                                                                                                                                                      | Verified by                                                                                                                                                                                                                                                                    | RED? |
| ------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| **4.1** | R2-d, R8-d, **F1** | `apps/api/scripts/run-tests.sh`: tier-scoped skip term in `run_batch` (`:104` region) + the redundant `TOTAL_SKIP` term in the final gate (`:339`) + a new `ERROR:` branch explaining that a skip in a tier-driven run is a service the tier did not provide | **RED first**, two tests: extend `runTestsGate.static.test.ts:198-218` to require a fourth term in the final condition; extend `runTestsGate.behavior.test.ts` with a `GATE_STUB_SKIP` env and a scenario asserting `exit 1` and the batch named on the `FAILED batches:` line | ✅   |
| **4.2** | **F2**             | `apps/api/tests/production.integration.test.ts`: `WORKERS_METRICS` derives from `process.env.METRICS_PORT ?? 3300` (`:18`, used at `:174`, `:553`)                                                                                                           | With PR 1 landed, `should check worker metrics` **executes and passes** instead of skipping                                                                                                                                                                                    | —    |
| **4.3** | **F7**             | Same file: delete `adminAvailable` (`:136`, `:156-171`), `skipIfAdminUnavailable` (`:195-201`) and its two call sites (`:510`, `:524`). Commit body: neither has ever executed; no tier boots `apps/admin`                                                   | `production` reports `0 skip`; `rg skipIf apps/api/tests/production.integration.test.ts` returns nothing                                                                                                                                                                       | —    |
| **4.4** | —                  | File "no tier boots the admin app" and "`worker_queue_depth` / `setUnhealthy()` have no producer" in `docs/reports/roadmap-detected-smells-backlog.md`                                                                                                       | Entries present with evidence lines                                                                                                                                                                                                                                            | —    |

Acceptance for C4: both tiers report `0 skip`, and reverting 4.2 alone makes the batch go **red** instead of green — that is the proof the term is load-bearing.

### C5 — `test(saga): fail loud in seconds when nothing is consuming the publish queue`

| Task    | Satisfies     | Changes                                                                                                                                                                                                                                                                                         | Verified by                                                                                                                                                                                                                                            | RED? |
| ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| **5.1** | R2-a…f, R1-d  | `apps/api/tests/testUtils.ts`: `assertPublishConsumers()` iterating `PUBLISH_PIPELINE_QUEUES`, six-way cause branch (§2.2), 2 s timeout × ≤2 attempts 500 ms apart, retrying only the indeterminate classes; and fix `checkApiAvailable` to treat 429 as available with the reason in a comment | **RED first**, six unit tests against a stubbed fetch — transport error, 429, 503-without-details, `consumers: null`, field absent, `consumers: 0` — each asserting its **own distinct message**; plus one asserting the happy path costs < 2 s        | ✅   |
| **5.2** | R2-a, R2.3    | `apps/api/tests/integration/sagaCustomerFlow.test.ts`: call it in `before` (`:96-100`) **concurrently** with the API check, before any fixture creation                                                                                                                                         | **RED first** (`[static]` R2.3): a test asserting the precondition call precedes the first `prisma.*.create` in the `before` body and that no case is conditionally skipped on a service                                                               | ✅   |
| **5.3** | R2-a, **F12** | `apps/api/scripts/run-tests.sh`: an `assert_publish_consumers` shell helper invoked **immediately before** the `integration:saga-live` batch (`:283`), not near `wait_for_api` (`:299-312`, which runs after it)                                                                                | **RED first**: extend the static gate suite to assert the helper's invocation line index is **less than** the saga-live batch's                                                                                                                        | ✅   |
| **5.4** | R2.1, R2-c    | —                                                                                                                                                                                                                                                                                               | **The A/B proof**: locally, API up + workers down, `TIER=full-integration` limited to the saga batch → fails in < 5 s with the queue named, batch terminates < 60 s, no fixture created, no `did not reach terminal state`. Recorded to the scratchpad | —    |

Must land **after** C3, or it reddens `main`.

### C6 🔐 — `ci: run the live integration tier on pull requests`

| Task    | Satisfies           | Changes                                                                                                                                                                                                                                                                                 | Verified by                                                                                   | RED? |
| ------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---- |
| **6.1** | R4-a, R4-d, R4-e    | `.github/workflows/ci.yml`: collapse `:311-322` and `:346-355` into one step with no `if:`; drop the `if: github.event_name == 'push'` from the API and worker boot steps; both events get `TIER: full-integration`; `timeout-minutes` flattened to **15**. **Job name unchanged.**     | The PR's own run executes `integration:saga-live` with workers booted                         | —    |
| **6.2** | R4-c, §3.1          | `apps/api/scripts/run-tests.sh`: **keep** `pr-integration` in the `case` arm and `run_db_batches`; amend the `TIER` docblock (`:32-38`) to state CI now selects `full-integration` on both events and that `pr-integration` remains for the gate-behaviour suite and local DB-only runs | `runTestsGate.behavior.test.ts` unchanged and green (7/7); no `wait_for_api` loop in its runs | —    |
| **6.3** | R4.6, F20           | `docs/runbooks/alert-saga-timeout.md` (or the change's README section): record the verified required-context list, the `gh api …/branches/main/protection` re-verification command, and **"do not rename the `Integration Tests` job"**                                                 | Command reproduces the contexts list containing `Integration Tests`                           | —    |
| **6.4** | R4-f (amended), F19 | Record the measured PR critical path before and after in the PR body                                                                                                                                                                                                                    | Δ ≤ 60 s, else invoke R4-g                                                                    | —    |

---

## PR 3 — "the class, not the instance" · ~180 lines

### C7 🔐 — `fix(ci): every workflow step that runs a live-API suite boots an API`

| Task    | Satisfies  | Changes                                                                                                                                                                                                                                                                                                         | Verified by                                                                                                       | RED? |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---- |
| **7.1** | R4-c, R2-b | **RED first**: a static test that derives the API-dependent suite set (`apps/api/tests/**` matching `getBaseUrl\|BASE_URL`), maps `apps/api/package.json` scripts → the files they name, scans `.github/workflows/*.yml` for steps invoking those scripts, and asserts each containing job has an API-boot step | It **fails on `security-testing.yml` at branch tip** — that failure is the finding's proof                        | ✅   |
| **7.2** | R1-c, R2-b | `.github/workflows/security-testing.yml`: add a readiness-gated `Start API in background` to `custom-security-tests` (`:76-155`), mirroring `ci.yml`'s pattern, with log capture                                                                                                                                | 7.1 goes green                                                                                                    | —    |
| **7.3** | R2-a, R2-d | `apps/api/tests/security.test.ts`: replace the availability-skip (`:43-60`) with one fail-loud `before` precondition; delete all 18 `if (!apiAvailable) t.skip()` guards (`:66…:430`)                                                                                                                           | The job reports **18 executed**, not `18 skipped`; `rg "t\.skip" apps/api/tests/security.test.ts` returns nothing | —    |

Independent of PR 4; may land in parallel.

---

## PR 4 — "the outage is visible" · ~260 lines

### C8 — `feat(metrics): publish the publish-queue attendance level and alert on an unattended queue`

| Task    | Satisfies              | Changes                                                                                                                                                                                                                                                                                                                                                 | Verified by                                                                                                                                                                                                                                                                                       | RED? |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **8.1** | R5-a, R5.1, R5.2, R5.6 | `apps/api/src/metrics/sagaRecoveryMetrics.ts`: `publish_queue_consumers` (−1 on `null`) and `publish_queue_waiting` gauges with scrape-time providers + `setPublishQueue*Provider`; wiring near `apps/api/src/index.ts:317`, detached on close                                                                                                          | **RED first**: unit tests via `client.register.getSingleMetric(...)` against a stub `QueuePort` — `consumers: 2` → 2; `null` → **−1**; `0` → 0; provider throwing does not fail the scrape                                                                                                        | ✅   |
| **8.2** | R5-b, R5-c, R5-d, R5-e | `prometheus/alerts/saga.yml`: `PublishQueueUnattended` + `PublishQueueSignalMissing` (§6.3); one cross-reference line added to `SagaWaitingRowsAccumulating`'s description, **its expression/threshold/hold untouched**                                                                                                                                 | **RED first** `[static]` (R5.3, R5.4, R5.5): both blocks exist with both terms, a `for:`, and a `runbook:`; lookback + hold = 10 m < ⅓ × 30 m; the new expression carries no count threshold; the pre-existing rule's `min_over_time(saga_waiting_rows[15m]) > 50` / `for: 10m` is byte-identical | ✅   |
| **8.3** | R5-e, R5.5             | `docs/runbooks/alert-saga-timeout.md`: a "no consumer on the publish queue" section — the ~15 min end-to-end bound including scrape and registry staleness, the `reason="timeout"` cohort, **"a terminal failure under that reason does not prove nothing was published; check the provider before retrying"**, and "evaluated; routing pending §4.2.b" | R5.5 static test asserts the runbook exists and contains those statements                                                                                                                                                                                                                         | ✅   |
| **8.4** | —                      | `docs/observability/SLO.md` §Saga: one row per the table's existing shape                                                                                                                                                                                                                                                                               | Row present, linking rule + runbook                                                                                                                                                                                                                                                               | —    |

---

## Final verification — proving it worked **for the right reason**

### V1 — `ci: acceptance run of the full live tier with workers` (after C3, re-run after C6)

Read from the push run's own log. **All six must hold together**; any one alone is satisfiable by a wrong fix.

1. `integration:saga-live` → `14 tests 14 pass 0 fail 0 cancel **0 skip** exit 0 [OK]`.
2. The three worker-dependent cases' `duration_ms` are each **< 80 000** (R6-e's two-thirds trigger). A pass at ~120 000 ms is **not** this property; a pass at > 80 000 ms invokes §7's first lever, not a budget change.
3. `TOTAL: … 0 cancel, **0 skip**` for the whole run — the skip gate from C4 is armed and the baseline is clean.
4. The `Start workers in background` step succeeded on `:3300/health/ready`, and `workers.log` shows `Worker subscribed. Awaiting jobs in 'publish'.`
5. `git diff main..HEAD` shows **no change** to: `packages/shared/src/saga.ts:1006` (horizon), `apps/api/src/config/env.ts:266` (poll default + `min(1000)` floor), the `waiting` branch at `saga.ts:811-815`, the three `120_000` budgets (`sagaCustomerFlow.test.ts:332, 363, 634`), or the count of cases in that file. **This is R6.1, and it is what separates "fixed" from "hidden".**
6. The batches beyond the saga one — `flow`, `remaining`, `production` — are green with a live worker now consuming `publish.flow.test.ts`'s round-trip job (§8, F6), and `workers.log` shows that job failing without collateral.

### V2 — the negative A/B, run locally, artifacts recorded

Same commit, same API, **only** variable = workers, mirroring the explore's Run A / Run B:

- **Workers down** → the batch fails in **< 5 s** with a message naming _no consumer on the `publish` queue_; batch wall **< 60 s** (against the measured 362.3 s today); no `did not reach terminal state`; no fixture rows created. This is R2.1, and it is the proof the precondition is not decoration.
- **Workers up** → 14/14, the three cases each < 80 000 ms.
- Both outputs written to the scratchpad and cited in the PR body, exactly as `runA-noworkers.txt` / `runB-withworkers.txt` were.

### V3 — the merge gate reports for the right reason (after C6)

- A trivial PR touching a saga surface: `Integration Tests` runs, executes `integration:saga-live`, and is **required** (`gh pr checks`). This is R4.1.
- A trivial PR touching nothing enumerated: the tier still runs and **reports**; the run's critical path is within **60 s** of the recorded baseline. This is amended R4.2 / R4-f — and if it is not, R4-g's reduced variant is adopted and the number recorded, never a path filter.

---

## Verdict

**Ready to implement.**

Nineteen of twenty findings are amended in the design above with a concrete mechanism and a test that would have caught the defect; the twentieth is refuted on the repo's own measured decomposition, and its actionable half is adopted anyway. The one spec conflict I found is amended explicitly, with its justification, so the implementer is not asked to satisfy a requirement the design contradicts.

Two things the orchestrator must arrange before Task C3:

- **Authorization tokens** for the 🔐 tasks — `.github/workflows/**` (C3, C6.1, C7.2) and `CLAUDE.md` + `fitness.yml` in lockstep (C2.6). Four requests, or one covering window.
- **The plan-mode guard** on this `workstream/*` branch, cleared once at the parent level.

And one honest caveat on the critical path: PR 1 alone turns `main` green. PRs 2–4 are what stop it going red again for the same reason, and PR 2's C4 is the one that closes the class rather than the instance — if anything in this plan is dropped for time, it must not be that.
