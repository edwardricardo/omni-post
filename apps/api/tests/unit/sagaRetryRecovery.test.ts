/**
 * @file sagaRetryRecovery.test.ts
 * @description Verifies that a failing-then-eligible-for-retry step persists
 *              `nextRetryAt` to the saga instance instead of relying on an
 *              in-process setTimeout. The persistence is what survives a
 *              process restart and lets the recovery checker resume the saga.
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, expect } from "vitest";
import {
  TEST_ACCOUNT_ID,
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createSagaManager,
  SuccessfulStep,
  FailingStep,
  type MockPrismaClient,
  type MockRedis,
  type MockEventService,
} from "./sagaManager.test-helpers.js";
import type { SagaManagerImpl } from "../../src/saga/SagaManager.js";

describe("Saga retry recovery (persisted nextRetryAt)", () => {
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;
  let manager: SagaManagerImpl;

  beforeEach(async () => {
    mockPrisma = createMockPrisma();
    mockRedis = createMockRedis();
    mockEventService = createMockEventService();
    manager = createSagaManager(mockPrisma, mockRedis, mockEventService);
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  it("persists nextRetryAt when a step fails with a retry policy in scope", async () => {
    manager.registerSaga({
      id: "retry-test-saga",
      name: "Retry Test Saga",
      version: "1.0",
      timeout: 60_000,
      retryPolicy: { maxRetries: 3, backoffMs: 1_000, exponential: false },
      steps: [new FailingStep(), new SuccessfulStep()],
    });

    const before = Date.now();
    const sagaInstance = await manager.startSaga("retry-test-saga", {
      accountId: TEST_ACCOUNT_ID,
      correlationId: "corr-retry-1",
      userId: "user-1",
    });

    await new Promise((r) => setTimeout(r, 250));

    const persisted = await manager.getSaga(sagaInstance.id);
    expect(persisted).toBeTruthy();
    expect(persisted!.status).toBe("RUNNING");
    expect(persisted!.retryCount).toBeGreaterThan(0);
    expect(persisted!.nextRetryAt).toBeTruthy();
    const nextAt = persisted!.nextRetryAt!.getTime();
    expect(nextAt).toBeGreaterThanOrEqual(before);
    expect(nextAt).toBeLessThanOrEqual(before + 5_000);
  });

  it("clears nextRetryAt once a step succeeds", async () => {
    manager.registerSaga({
      id: "retry-clear-saga",
      name: "Retry Clear Saga",
      version: "1.0",
      timeout: 60_000,
      retryPolicy: { maxRetries: 0, backoffMs: 0, exponential: false },
      steps: [new SuccessfulStep()],
    });

    const sagaInstance = await manager.startSaga("retry-clear-saga", {
      accountId: TEST_ACCOUNT_ID,
      correlationId: "corr-retry-2",
      userId: "user-2",
    });

    await new Promise((r) => setTimeout(r, 250));

    const persisted = await manager.getSaga(sagaInstance.id);
    expect(persisted).toBeTruthy();
    expect(persisted!.status).toBe("COMPLETED");
    expect(persisted!.nextRetryAt).toBeUndefined();
  });
});
