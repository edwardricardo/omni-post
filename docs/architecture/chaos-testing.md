# Chaos Testing — Canon (§4.1 Normalization Roadmap)

> Workstream: §4.1 Normalization Roadmap (Phase A1 closed; Phases B/C/D PENDING).

## 3 niveles de chaos testing

| Nivel             | Qué simula                                                                       | Tooling                                              | Cuándo corre         | Status hoy              |
| ----------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------- | ----------------------- |
| **L1 Simulated**  | Controlled failures inyectados en steps/handlers — recovery scheduler observable | `vitest` / `node:test` + mock infra + Noop scheduler | Cada PR (CI default) | ✅ saga retry (1 proof) |
| **L2 Real crash** | Process kill -9 mid-flight + restart + verify invariants persisted               | `child_process.spawn/kill` + real Postgres + Redis   | Nightly (caro)       | 🚧 §4.1.c PENDING       |
| **L3 Game-day**   | Production chaos (lat injection, DB failover, traffic spikes)                    | Gremlin / LitmusChaos / custom                       | Mensual (post-prod)  | ⏭ deferred (post-prod) |

Phase A1 entrega L1. Phases B/C/D agregan L2 + CI wiring.

L1 NO es un "atajo" — es el primer tier del Netflix Chaos Monkey playbook. La diferencia con L2 es la fidelidad del crash: L1 simula la CONSECUENCIA del crash (step failure + recovery), L2 simula el crash REAL (process death). Las invariantes que validamos son las mismas; L2 valida fidelidad de la simulación.

## Pattern: chaos harness (Phase A1)

`apps/api/tests/chaos/chaos-helpers.ts` expone:

- `createChaosHarness()`: construye `SagaManagerImpl` con mock Prisma/Redis/EventService + `NoopBackgroundTaskScheduler`. El scheduler es no-op por design — el test llama `scheduler.triggerTask(taskId)` para forzar iteraciones deterministas (sin esperar 5s wall-clock).
- `TransientFailingStep`: saga step que falla `N` veces y luego succeeds. Cada falla retorna `success: false` triggering retry policy.
- `waitForSagaStatus(manager, sagaId, target, options)`: poll helper con timeout.

Recipe del test:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createChaosHarness, TransientFailingStep, waitForSagaStatus } from "./chaos-helpers.js";

describe("Chaos: <scenario>", () => {
  let harness;
  before(async () => {
    harness = await createChaosHarness();
  });
  after(async () => {
    await harness.teardown();
  });

  it("<invariant>", async () => {
    const failingStep = new TransientFailingStep(2);
    harness.manager.registerSaga({
      /* ... steps: [failingStep, ...] */
    });
    const instance = await harness.manager.startSaga(/* ... */);

    // Trigger recovery scheduler iterations as needed.
    await harness.scheduler.triggerTask("saga-retry-recovery");

    await waitForSagaStatus(harness.manager, instance.id, "COMPLETED");
    assert.ok(failingStep.attempts >= 3);
  });
});
```

## Scenario backlog

### Phase A1 (DONE — 1 scenario)

- ✅ **Saga step transient failure → recovery scheduler retries**: `tests/chaos/saga-step-retry-recovery.test.ts`. Runbook: `docs/runbooks/chaos-saga-step-retry.md`.

### Phase B / §4.1.b (PENDING — 2 scenarios)

- 🚧 **Outbox relay crashea entre `SELECT FOR UPDATE` y mark PROCESSED** — verifica que el lease del claim expira + otro relay re-claim + se publica exactamente una vez. Helper a agregar: `createOutboxChaosHarness()`. Invariante: zero duplicate publish via `messageId` unique constraint.
- 🚧 **BullMQ worker stalled mid-job** — verifica que el stalled detection (`lockDuration` + `stalledInterval`) re-encola el job + verifica idempotency. Helper a agregar: simular stall via skipping `extendLock()` calls.

### Phase C / §4.1.c (PENDING — L2 real crash infra)

Real `kill -9` chaos vía `child_process.spawn` API server + signal handlers + invariant assertions persisted en DB real:

```typescript
const apiChild = spawn("pnpm", ["dev:api"], { ... });
await waitFor(() => apiHealthy());
const sagaId = await startSagaViaHttp();
await waitFor(() => sagaState(sagaId) === "step-2-running");
apiChild.kill("SIGKILL");
const apiChild2 = spawn("pnpm", ["dev:api"], { ... });
await waitFor(() => sagaState(sagaId) === "COMPLETED");
```

Costos: 30-60s por test, requires docker DB/Redis, complejo de mantener. ~6-10h trabajo. Estima cuando Phase B esté estable.

### Phase D / §4.1.d (PENDING — CI nightly)

`.github/workflows/chaos.yml`:

```yaml
on:
  schedule:
    - cron: "0 4 * * *" # 04:00 UTC nightly
  workflow_dispatch:

jobs:
  chaos-l1:
    # runs apps/api/tests/chaos/ (L1 fast, deterministic)
  chaos-l2:
    # runs L2 real-crash suite (only when L1 green)
```

Sentry/Slack alert on failure. Open GitHub issue automatically.

Bloqueado por `omnipost-allow sensitive-edit` token (mismo issue que §2.2.a-CI / §3.1.b CI gate / §3.2.d).

## Caveats

- **L1 timing**: NoOp scheduler + `triggerTask` evita wall-clock waits. Tests corren en ~150ms. Si en algún momento un L1 test toma > 1s, hay algo mal (probably real wall-clock wait sneaked in).
- **L1 vs unit tests**: el chaos test PARECE un unit test (mocks) pero la diferencia es el FLUJO ejercido — ejerce el lifecycle completo de retry+recovery vs un unit test que aserta una sola unidad.
- **L2 flakiness**: real-crash tests son notoriamente flakey. Documentar timeout ≥ 30s en cada uno. Si flake rate > 5% post-implementación, investigar root cause antes de "just retry CI".
- **Process kill -9 vs SIGTERM**: kill -9 NO da chance al proceso a flush state. SIGTERM sí. Los chaos tests deberían cubrir AMBOS (SIGKILL = worst case, SIGTERM = graceful shutdown).
