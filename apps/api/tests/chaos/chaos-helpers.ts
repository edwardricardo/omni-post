/**
 * @file chaos-helpers.ts
 * @description Shared helpers para chaos tests (> 4.1 Normalization Roadmap).
 *   Establece el harness mínimo para inyectar fallas controladas en saga
 *   steps + verificar que el recovery scheduler (`startRetryRecoveryChecker`,
 *   poll 5s en runtime) recupera el saga a estado COMPLETED.
 *
 *   Reusa la infrastructure de unit tests existente (mock Prisma + Redis +
 *   EventService) en `tests/unit/sagaManager.test-helpers.ts`, pero expone
 *   el `NoopBackgroundTaskScheduler` para que los tests puedan manualmente
 *   `triggerTask("saga-retry-recovery")` y simular el tick del scheduler
 *   sin esperar 5s wall-clock por iteración.
 *
 *   Phase A1 establece el patrón. §4.1.b agrega escenarios outbox + BullMQ
 *   stalled. > 4.1.c agrega real-kill-9 chaos. > 4.1.d agrega CI nightly job.
 *
 * @layer infrastructure
 */
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { SagaManagerImpl } from "../../src/saga/SagaManager.js";
import type { SagaStep, SagaStepResult, SagaContext } from "@shared/saga";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  type MockPrismaClient,
  type MockRedis,
  type MockEventService,
} from "../unit/sagaManager.test-helpers.js";

export interface ChaosHarness {
  manager: SagaManagerImpl;
  scheduler: NoopBackgroundTaskScheduler;
  mockPrisma: MockPrismaClient;
  mockRedis: MockRedis;
  mockEventService: MockEventService;
  teardown: () => Promise<void>;
}

/**
 * Construye un harness chaos con saga manager + noop scheduler. El scheduler
 * es no-op por design — los tests llaman `scheduler.triggerTask("saga-retry-recovery")`
 * para forzar la iteración del recovery checker en momentos deterministas.
 */
export async function createChaosHarness(): Promise<ChaosHarness> {
  const mockPrisma = createMockPrisma();
  const mockRedis = createMockRedis();
  const mockEventService = createMockEventService();
  const scheduler = new NoopBackgroundTaskScheduler();

  const manager = new SagaManagerImpl({
    prisma: mockPrisma as never,
    redis: mockRedis as never,
    eventService: mockEventService as never,
    scheduler,
    enableMetrics: true,
  });

  await manager.initialize();

  return {
    manager,
    scheduler,
    mockPrisma,
    mockRedis,
    mockEventService,
    teardown: async () => {
      await manager.shutdown();
    },
  };
}

/**
 * @class TransientFailingStep
 * @description Saga step que falla las primeras `failuresBeforeSuccess`
 *   veces y luego succeeds. Cada falla retorna `success: false` con un
 *   error message — el saga manager debería persistir `nextRetryAt` y
 *   esperar el recovery scheduler para reintentar.
 *
 *   Patrón canónico para chaos testing de retry policy + recovery
 *   scheduler. La cuenta `attempts` es OBSERVABLE desde el test para
 *   asserting que el step fue invocado N veces.
 */
export class TransientFailingStep implements SagaStep {
  readonly id = "transient-failing-step";
  readonly name = "Transient Failing Step";

  public attempts = 0;

  constructor(private readonly failuresBeforeSuccess: number) {}

  async execute(context: SagaContext, _data?: unknown): Promise<SagaStepResult> {
    this.attempts += 1;
    if (this.attempts <= this.failuresBeforeSuccess) {
      return {
        success: false,
        error: `Transient failure ${this.attempts}/${this.failuresBeforeSuccess}`,
      };
    }
    context.stepData[this.id] = { executed: true, attempts: this.attempts };
    return {
      success: true,
      data: { stepId: this.id, attempts: this.attempts },
      compensationData: { stepId: this.id },
    };
  }

  async compensate(_context: SagaContext, _compensationData?: unknown): Promise<SagaStepResult> {
    return { success: true, data: { compensated: true } };
  }
}

/**
 * Poll `manager.getSaga(sagaId)` hasta que reach `targetStatus` o el timeout
 * expire. Entre polls, el caller debe llamar `scheduler.triggerTask(...)` para
 * forzar el tick del recovery checker — el wait helper solo observa.
 */
export async function waitForSagaStatus(
  manager: SagaManagerImpl,
  sagaId: string,
  targetStatus: string,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const pollMs = options.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const saga = await manager.getSaga(sagaId);
    if (saga?.status === targetStatus) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  const final = await manager.getSaga(sagaId);
  throw new Error(
    `Saga ${sagaId} did not reach status "${targetStatus}" within ${timeoutMs}ms. ` +
      `Final status: ${final?.status}, retryCount: ${final?.retryCount}`
  );
}
