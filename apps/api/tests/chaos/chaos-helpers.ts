/**
 * @file chaos-helpers.ts
 * @description Shared helpers for chaos tests. Establishes the minimal harness
 *   to inject controlled failures into saga steps and verify the recovery
 *   scheduler (`startRetryRecoveryChecker`, polling at 5 s in runtime) drives
 *   the saga to COMPLETED.
 *
 *   Reuses the existing unit-test infrastructure (mock Prisma + Redis +
 *   EventService) from `tests/unit/sagaManager.test-helpers.ts`, but exposes
 *   the `NoopBackgroundTaskScheduler` so tests can manually
 *   `triggerTask("saga-retry-recovery")` and simulate the scheduler tick
 *   without waiting 5 s wall-clock per iteration.
 *
 * @layer infrastructure
 */
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { SagaManagerImpl } from "../../src/saga/SagaManager.js";
import type { SagaStep, SagaStepResult, SagaContext } from "@shared/types/saga.js";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  type MockPrismaClient,
  type MockRedis,
  type MockEventService,
} from "../unit/sagaManager.test-helpers.js";

/** Account every harness saga is owned by — a saga without one is a corrupted row. */
const CHAOS_ACCOUNT_ID = "acc-chaos-0000-4000-8000-000000000001";

export interface ChaosHarness {
  manager: SagaManagerImpl;
  scheduler: NoopBackgroundTaskScheduler;
  /** The tenant every saga started through this harness belongs to. */
  accountId: string;
  mockPrisma: MockPrismaClient;
  mockRedis: MockRedis;
  mockEventService: MockEventService;
  teardown: () => Promise<void>;
}

/**
 * Builds a chaos harness with a saga manager + noop scheduler. The scheduler is
 * a no-op by design — tests call `scheduler.triggerTask("saga-retry-recovery")`
 * to force the recovery checker's iteration at deterministic moments.
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
    accountId: CHAOS_ACCOUNT_ID,
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
 * @description Saga step that fails the first `failuresBeforeSuccess` times and
 *   then succeeds. Each failure returns the `failed` outcome with an error
 *   message — the saga manager should persist `nextRetryAt` and wait for the
 *   recovery scheduler to retry.
 *
 *   Canonical pattern for chaos testing of the retry policy + recovery
 *   scheduler. The `attempts` count is OBSERVABLE from the test so it can
 *   assert the step was invoked N times.
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
        outcome: "failed",
        error: `Transient failure ${this.attempts}/${this.failuresBeforeSuccess}`,
      };
    }
    context.stepData[this.id] = { executed: true, attempts: this.attempts };
    return {
      outcome: "succeeded",
      data: { stepId: this.id, attempts: this.attempts },
      compensationData: { stepId: this.id },
    };
  }

  async compensate(_context: SagaContext, _compensationData?: unknown): Promise<SagaStepResult> {
    return { outcome: "succeeded", data: { compensated: true } };
  }
}

/**
 * Polls `manager.getSaga(sagaId)` until it reaches `targetStatus` or the timeout
 * expires. Between polls the caller must call `scheduler.triggerTask(...)` to
 * force the recovery checker's tick — this wait helper only observes.
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
