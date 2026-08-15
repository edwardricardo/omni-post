# Runbook — Chaos scenario: saga step transient failure

> Tests: `apps/api/tests/chaos/saga-step-retry-recovery.test.ts` (retry recovery)
> and `apps/api/tests/chaos/sagaWaitAmplification.test.ts` (the three-state outcome).

## Invariante validada

Un saga step retryable que falla transiently (e.g., timeout HTTP, conflict de optimistic lock) debe ser **retomado por el recovery scheduler** y reach `COMPLETED` sin pérdida del saga, AÚN si el proceso muere entre intentos.

La invariante apoya en TRES propiedades del saga engine:

1. **Persistencia de retry state** — cuando un step falla (outcome `failed`) con retry policy en scope, `nextRetryAt` se persiste a `SagaInstance` (no in-memory setTimeout). Source: `apps/api/src/saga/SagaManagerExecution.ts`, rama `stepResult.outcome === "failed"` dentro de `runSagaSteps`.
2. **Recovery poll** — `SagaManagerLifecycle.startRetryRecoveryChecker()` registra una task que cada 5s busca `SagaInstance` con `status IN (RUNNING, PENDING)` y `nextRetryAt ≤ now`. Source: `apps/api/src/saga/SagaManagerLifecycle.ts`, task `saga-retry-recovery`.
3. **Resume from persisted state** — `executionEngine.executeSagaAsync(sagaId, trigger)` retoma el saga desde el step actual usando la `compensationData` previa.

Si CUALQUIERA de las 3 se rompe → este test falla → potencial data loss entre crashes.

## El contrato de outcomes (lo que cambió, y por qué el vocabulario viejo ya no aplica)

Un step responde **una de tres cosas**, y sólo una de ellas es un intento:

| Outcome     | Significa                               | Qué hace el engine                                                                                        |
| ----------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `succeeded` | el efecto ocurrió                       | avanza al siguiente step y limpia el bookkeeping de retry                                                 |
| `failed`    | no va a salir bien como están las cosas | gasta UN retry; agotado el presupuesto, compensa (pre-pivot) o falla (pivot en adelante)                  |
| `waiting`   | todavía no se decide (trabajo externo)  | **NO gasta retry**, no escribe error, no emite evento de step; re-arma el poll (`SAGA_WAIT_POLL_MS`, 30s) |

Consecuencias operativas que hay que tener presentes al diagnosticar:

- **`nextRetryAt` significa DOS cosas.** Un retry vencido y un poll re-armado usan la misma columna. El desempate es `retryCount`: en `0` la fila está ESPERANDO (el step no falló nunca), en `> 0` está reintentando después de fallas reales. La disposición de boot `nextRetryAt-owned-by-checker` cubre las dos.
- **Ya no existe el sobre de ~35 s.** Un publish cuyos jobs no terminan no muere por presupuesto agotado: espera, y termina por el horizonte del saga (30 min) si nadie lo avanza. Si buscabas "¿por qué esto tardó un minuto?", la respuesta suele ser un intervalo de poll, no un retry.
- **`success: false` ya no existe** como valor, ni `handleStepFailure()` como método (nunca existió: el manejo vive inline en `runSagaSteps`).

## Cómo correrlo manualmente

```bash
cd apps/api
NODE_OPTIONS="--max-old-space-size=3072" node --import tsx --conditions development --test \
  --test-force-exit tests/chaos/saga-step-retry-recovery.test.ts
```

Resultado esperado: 1 suite + 1 test verde en ~150ms.

NO requiere DB/Redis up — usa mocks del `tests/unit/sagaManager.test-helpers.ts`. La "chaos" aquí es ejercer el ciclo de retry-recovery con un step que falla deterministicamente N veces.

El segundo test chaos, `sagaWaitAmplification.test.ts`, corre igual (sin servicios) y pinea la aritmética del fan-out: cuatro canales que publican bien llegan a `COMPLETED` sin gastar un solo retry, y un canal que falla de verdad sigue gastando presupuesto y terminando en `FAILED`.

## Qué hacer si falla

### Caso 1: el test reach timeout sin alcanzar COMPLETED

Indica que el recovery scheduler NO está retomando el saga. Posibles causas:

1. **`nextRetryAt` no se persiste**: revisá la rama `failed` de `runSagaSteps` — persiste `nextRetryAt` junto con el step event, en la misma transacción tenant-scoped.
2. **El scheduler taskId cambió**: el test llama `scheduler.triggerTask("saga-retry-recovery")`. Si el id registrado cambió, actualizar el test.
3. **El recovery query no encuentra el saga**: `findMany({ where: { status: { in: ["RUNNING","PENDING"] }, nextRetryAt: { lte: now, not: null } } })` — verificar que la combinación `status` + `nextRetryAt` se persiste correctamente.

### Caso 2: el test reach COMPLETED pero `attempts < 3`

Indica que el saga COMPLETÓ sin pasar por el flujo de retry. Posibles causas:

1. **El step no está dentro del retry policy scope**: la definición de saga debe declarar `retryPolicy`.
2. **El step devuelve `waiting` donde debería devolver `failed`**: `waiting` NO gasta presupuesto, así que un step mal clasificado nunca reintenta — y peor, oculta una dependencia caída detrás de "todavía no terminó". La regla de autoría está en el docblock de `SagaStepResult`: `waiting` es lo que **se vuelve decidible volviendo a preguntar**; todo lo demás es `failed`, incluido "no pude observar".

### Caso 3: assertion `nextRetryAt should be cleared after success` falla

Indica que el saga COMPLETÓ pero `nextRetryAt` no se limpió. Posibles causas:

1. **El camino de éxito no limpia el marcador**: en `runSagaSteps`, el step `succeeded` hace `delete instance.nextRetryAt` antes de persistir.
2. **El saga COMPLETÓ via path distinto al retry-recovery** (ej. el step succedió en su primer intento). Verificar `attempts >= 3` en el assert anterior.

### Caso 4: la amplificación volvió (el test de fan-out se pone rojo)

`sagaWaitAmplification.test.ts` en rojo con `retryCount > 0` significa que el step de espera volvió a reportar "todavía no terminó" como una falla, o que el engine dejó de eximir `waiting` del presupuesto. Ese fue el defecto que hacía que un publish de 4 canales terminara `FAILED` con los 4 canales publicados: no lo parchees en el test.

## Referencias

- Source saga engine: `apps/api/src/saga/SagaManager.ts`, `SagaManagerLifecycle.ts`, `SagaManagerExecution.ts`.
- Contrato de outcomes: `packages/shared/src/saga.ts` (`SagaStepResult`), `docs/api/saga.md`.
- Test helpers: `apps/api/tests/chaos/chaos-helpers.ts`, `apps/api/tests/unit/sagaManager.test-helpers.ts`.
- Framework canon: `docs/architecture/chaos-testing.md`.
