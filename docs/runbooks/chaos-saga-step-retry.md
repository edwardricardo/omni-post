# Runbook — Chaos scenario: saga step transient failure

> Workstream: §4.1 Normalization Roadmap Phase A1.
> Test: `apps/api/tests/chaos/saga-step-retry-recovery.test.ts`

## Invariante validada

Un saga step retryable que falla transiently (e.g., timeout HTTP, conflict de optimistic lock) debe ser **retomado por el recovery scheduler** y reach `COMPLETED` sin pérdida del saga, AÚN si el proceso muere entre intentos.

La invariante apoya en TRES propiedades del saga engine:

1. **Persistencia de retry state** — cuando un step falla con retry policy en scope, `nextRetryAt` se persiste a `SagaInstance` (no in-memory setTimeout). Source: `apps/api/src/saga/SagaManagerExecution.ts`.
2. **Recovery poll** — `SagaManagerLifecycle.startRetryRecoveryChecker()` registra una task que cada 5s (configurable via `scheduler`) busca `SagaInstance` con `status=RUNNING` y `nextRetryAt ≤ now`. Source: `apps/api/src/saga/SagaManagerLifecycle.ts:380-408`.
3. **Resume from persisted state** — `executionEngine.executeSagaAsync(sagaId)` retoma el saga desde el step actual usando la `compensationData` previa.

Si CUALQUIERA de las 3 se rompe → este test falla → potencial data loss entre crashes.

## Cómo correrlo manualmente

```bash
cd apps/api
NODE_OPTIONS="--max-old-space-size=3072" node --import tsx --test tests/chaos/saga-step-retry-recovery.test.ts
```

Resultado esperado: 1 suite + 1 test verde en ~150ms.

NO requiere DB/Redis up — usa mocks del `tests/unit/sagaManager.test-helpers.ts`. La "chaos" aquí es ejercer el ciclo de retry-recovery con un step que falla deterministicamente N veces.

## Qué hacer si falla

### Caso 1: el test reach timeout (3000ms) sin alcanzar COMPLETED

Indica que el recovery scheduler NO está retomando el saga. Posibles causas:

1. **`nextRetryAt` no se persiste**: revisa `SagaManagerExecution.handleStepFailure()` — debería persistir `nextRetryAt` con `prisma.sagaInstance.update({ where: { id }, data: { nextRetryAt: ... } })`.
2. **El scheduler taskId cambió**: el test llama `scheduler.triggerTask("saga-retry-recovery")`. Si el taskId en `SagaManagerLifecycle.ts:382` cambió, actualizar el test.
3. **El recovery query no encuentra el saga**: `findMany({ where: { status: "RUNNING", nextRetryAt: { lte: now, not: null } } })` — verificar que la combinación `status` + `nextRetryAt` se persiste correctamente.

### Caso 2: el test reach COMPLETED pero `attempts < 3`

Indica que el saga COMPLETÓ sin pasar por el flujo de retry. Posibles causas:

1. **El step no está dentro del retry policy scope**: la definición de saga debe declarar `retryPolicy` en el saga o en el step.
2. **Step `success: false` no triggea retry**: revisar `SagaManagerExecution.handleStepFailure()` — debe interpretar `success: false` como retryable cuando hay policy.

### Caso 3: assertion `nextRetryAt should be cleared after success` falla

Indica que el saga COMPLETÓ pero `nextRetryAt` no se limpió. Posibles causas:

1. **`clearRetryState()` no se llama en path de éxito**: revisar `SagaManagerExecution.handleStepSuccess()`.
2. **El saga COMPLETÓ via path distinto al retry-recovery** (ej. el step succedió en su primer intento sin que retry-recovery se involucrara). Verificar `attempts >= 3` en el assert anterior.

## Referencias

- Source saga engine: `apps/api/src/saga/SagaManager.ts`, `SagaManagerLifecycle.ts`, `SagaManagerExecution.ts`.
- Test helpers: `apps/api/tests/chaos/chaos-helpers.ts`, `apps/api/tests/unit/sagaManager.test-helpers.ts`.
- Framework canon: `docs/architecture/chaos-testing.md`.
- Roadmap: `docs/architecture/NORMALIZATION_ROADMAP.md` §4.1.
