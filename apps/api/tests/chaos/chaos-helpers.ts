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
import { until } from "@packages/vitest-shared/determinism";
import { SagaManagerImpl } from "../../src/saga/SagaManager.js";
import type { SagaStep, SagaStepResult, SagaContext, SagaInstance } from "@shared/types/saga.js";
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
 * @description Builds a chaos harness with a saga manager + noop scheduler. The scheduler is
 *   a no-op by design — tests call `scheduler.triggerTask("saga-retry-recovery")`
 *   to force the recovery checker's iteration at deterministic moments.
 * @returns The initialized harness, with the doubles it wired and its teardown.
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

  /**
   * @method execute
   * @description Counts the attempt, fails while the attempt count is within
   *   `failuresBeforeSuccess`, then succeeds and records its step data.
   * @param context - The saga context whose step data the success writes.
   * @param _data - Unused step input.
   * @returns A `failed` outcome for the scripted failures, then `succeeded`.
   */
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

  /**
   * @method compensate
   * @description Compensates unconditionally: the chaos scenarios exercise the forward retry, not
   *   the undo.
   * @param _context - Unused saga context.
   * @param _compensationData - Unused compensation data.
   * @returns A `succeeded` outcome.
   */
  async compensate(_context: SagaContext, _compensationData?: unknown): Promise<SagaStepResult> {
    return { outcome: "succeeded", data: { compensated: true } };
  }
}

/**
 * @description Polls `manager.getSaga(sagaId)` until it reaches `targetStatus` or the timeout
 *   expires, and on timeout names the status and the retry count it last read. Between polls the
 *   caller must call `scheduler.triggerTask(...)` to force the recovery checker's tick: this wait
 *   helper only observes.
 * @param manager - The saga manager whose saga is read.
 * @param sagaId - The saga to observe.
 * @param targetStatus - The status the wait ends on.
 * @param options - `timeoutMs` (default 5000) and `pollMs`, the pause between reads (default 50).
 */
export async function waitForSagaStatus(
  manager: SagaManagerImpl,
  sagaId: string,
  targetStatus: string,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<void> {
  let last: SagaInstance | null = null;
  await until(
    async () => {
      last = await manager.getSaga(sagaId);
      return last?.status === targetStatus;
    },
    {
      description: () =>
        `saga ${sagaId} to reach status "${targetStatus}" ` +
        `(last status: ${last?.status}, retryCount: ${last?.retryCount})`,
      timeoutMs: options.timeoutMs ?? 5000,
      intervalMs: options.pollMs ?? 50,
    }
  );
}
