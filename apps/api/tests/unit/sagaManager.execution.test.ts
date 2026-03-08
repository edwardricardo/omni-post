import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SAGA_EVENTS } from "@shared/saga";
import { DomainEvent } from "@shared/events";
import {
  MockPrismaClient,
  MockRedis,
  MockEventService,
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createSagaManager,
  createSimpleSagaDefinition,
  createMultiStepSagaDefinition,
  createFailingSagaDefinition,
} from "./sagaManager.test-helpers.js";
import { SagaManagerImpl } from "../../src/saga/SagaManager";

describe("SagaManager - Saga Execution", { concurrency: 1 }, () => {
  let manager: SagaManagerImpl;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

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

  it("should execute simple single-step saga successfully", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 200));

    const sagaInstance = await manager.getSaga(instance.id);
    assert.ok(sagaInstance, "Saga instance should exist");
    assert.strictEqual(sagaInstance.status, "COMPLETED");
    assert.strictEqual(sagaInstance.currentStep, definition.steps.length);
  });

  it("should execute multi-step saga sequentially", async () => {
    const definition = createMultiStepSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 500));

    const sagaInstance = await manager.getSaga(instance.id);
    assert.ok(sagaInstance, "Saga instance should exist");
    assert.strictEqual(sagaInstance.status, "COMPLETED");
    assert.strictEqual(sagaInstance.stepResults.length, definition.steps.length);

    sagaInstance.stepResults.forEach((result, index) => {
      assert.strictEqual(result.success, true, `Step ${index} should have succeeded`);
    });
  });

  it("should emit step completed events for each successful step", async () => {
    const definition = createMultiStepSagaDefinition();
    manager.registerSaga(definition);

    await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 500));

    const stepCompletedEvents = mockEventService.publishedEvents.filter(
      (e) => e.type === SAGA_EVENTS.SAGA_STEP_COMPLETED
    );

    assert.strictEqual(stepCompletedEvents.length, definition.steps.length);
  });

  it("should pass context between steps with stepData", async () => {
    const definition = createMultiStepSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {
      metadata: { testValue: "shared-data" },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const sagaInstance = await manager.getSaga(instance.id);
    assert.ok(sagaInstance, "Saga instance should exist");
    assert.ok(sagaInstance.context.stepData["successful-step"]);
    assert.ok(sagaInstance.context.stepData["delayed-step"]);
  });

  it("should emit saga completed event on successful completion", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 200));

    const completedEvents = mockEventService.publishedEvents.filter(
      (e) => e.type === SAGA_EVENTS.SAGA_COMPLETED
    );

    assert.strictEqual(completedEvents.length, 1);
    assert.strictEqual(completedEvents[0]!.data.status, "COMPLETED");
  });

  it("should update metrics on saga completion", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const metricsBefore = manager.getMetrics();
    const completedBefore = metricsBefore.sagasCompleted;

    await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 200));

    const metricsAfter = manager.getMetrics();
    assert.strictEqual(metricsAfter.sagasCompleted, completedBefore + 1);
    assert.ok(metricsAfter.averageExecutionTime >= 0);
  });
});

describe("SagaManager - Saga Failure and Compensation", { concurrency: 1 }, () => {
  let manager: SagaManagerImpl;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

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

  it("should fail saga when step fails and no retry policy", async () => {
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 300));

    const _sagaInstance = await manager.getSaga(definition.id);
    const metrics = manager.getMetrics();
    assert.strictEqual(metrics.sagasFailed, 1);
  });

  it("should emit saga failed event on failure", async () => {
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 300));

    const failedEvents = mockEventService.publishedEvents.filter(
      (e) => e.type === SAGA_EVENTS.SAGA_FAILED
    );

    assert.ok(failedEvents.length > 0, "Should emit saga failed event");
  });

  it("should compensate saga when manually triggered", async () => {
    // Use a saga that naturally reaches FAILED state
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // Wait for the saga to fail (FailingStep causes failure)
    await new Promise((resolve) => setTimeout(resolve, 300));

    const sagaInstance = await manager.getSaga(instance.id);
    assert.ok(sagaInstance, "Saga instance should exist");
    assert.strictEqual(sagaInstance.status, "FAILED", "Saga should be in FAILED state");

    // Now trigger manual compensation on the naturally-failed saga
    await manager.compensateSaga(instance.id);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const compensatedEvents = mockEventService.publishedEvents.filter(
      (e) => e.type === SAGA_EVENTS.SAGA_COMPENSATION_COMPLETED
    );

    assert.ok(compensatedEvents.length > 0, "Should emit compensation completed event");
  });

  it("should throw error when compensating non-failed saga", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    await assert.rejects(
      async () => await manager.compensateSaga(instance.id),
      /not in a failed state/,
      "Should throw error when compensating non-failed saga"
    );
  });

  it("should update metrics on saga failure", async () => {
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    const metricsBefore = manager.getMetrics();
    const failedBefore = metricsBefore.sagasFailed;

    await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 300));

    const metricsAfter = manager.getMetrics();
    assert.strictEqual(metricsAfter.sagasFailed, failedBefore + 1);
  });
});

describe("SagaManager - Retry Logic", { concurrency: 1 }, () => {
  let manager: SagaManagerImpl;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

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

  it("should not retry when no retry policy is defined", async () => {
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 300));

    const stepFailedEvents = mockEventService.publishedEvents.filter(
      (e) => e.type === SAGA_EVENTS.SAGA_STEP_FAILED
    );

    assert.strictEqual(stepFailedEvents.length, 1);
  });
});

describe("SagaManager - Event Handling", { concurrency: 1 }, () => {
  let manager: SagaManagerImpl;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

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

  it("should handle domain events related to saga without throwing", async () => {
    const testEvent: DomainEvent = {
      id: "event-123",
      type: "publish.job.completed",
      version: 1,
      timestamp: new Date(),
      aggregateId: "job-123",
      aggregateType: "Job",
      data: { jobId: "job-123" },
      metadata: { source: "test", sagaId: "saga-123" },
    };

    await assert.doesNotReject(
      async () => await manager.handleEvent(testEvent),
      "handleEvent should complete without error for saga-related events"
    );
  });

  it("should ignore events without saga metadata without throwing", async () => {
    const publishedBefore = mockEventService.publishedEvents.length;

    const testEvent: DomainEvent = {
      id: "event-456",
      type: "publish.job.completed",
      version: 1,
      timestamp: new Date(),
      aggregateId: "job-456",
      aggregateType: "Job",
      data: { jobId: "job-456" },
      metadata: { source: "test" },
    };

    await assert.doesNotReject(
      async () => await manager.handleEvent(testEvent),
      "handleEvent should complete without error for non-saga events"
    );

    // Verify no saga-related events were emitted (event was ignored)
    const sagaEvents = mockEventService.publishedEvents
      .slice(publishedBefore)
      .filter((e) => e.type.startsWith("saga."));
    assert.strictEqual(
      sagaEvents.length,
      0,
      "No saga events should be emitted for non-saga events"
    );
  });
});

describe("SagaManager - Health Check", { concurrency: 1 }, () => {
  let manager: SagaManagerImpl;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

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

  it("should return healthy status with all dependencies available", async () => {
    const health = await manager.healthCheck();

    assert.strictEqual(health.status, "healthy");
    assert.strictEqual(health.details.database, true);
    assert.strictEqual(health.details.redis, true);
  });

  it("should include saga metrics in health check", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const health = await manager.healthCheck();

    assert.ok(health.details.definitionsRegistered >= 1);
    assert.ok(health.details.activeInstances >= 0);
  });
});

describe("SagaManager - Metrics", { concurrency: 1 }, () => {
  let manager: SagaManagerImpl;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

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

  it("should track sagas started metric", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const metricsBefore = manager.getMetrics();
    const startedBefore = metricsBefore.sagasStarted;

    await manager.startSaga(definition.id, {});

    const metricsAfter = manager.getMetrics();
    assert.strictEqual(metricsAfter.sagasStarted, startedBefore + 1);
  });

  it("should track active instances count", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const metricsBefore = manager.getMetrics();

    await manager.startSaga(definition.id, {});

    const metricsAfter = manager.getMetrics();
    assert.ok(metricsAfter.activeInstances >= metricsBefore.activeInstances);
  });

  it("should return registered definitions in metrics", async () => {
    const definition1 = createSimpleSagaDefinition();
    const definition2 = createMultiStepSagaDefinition();

    manager.registerSaga(definition1);
    manager.registerSaga(definition2);

    const metrics = manager.getMetrics();
    assert.ok(metrics.definitions.includes(definition1.id));
    assert.ok(metrics.definitions.includes(definition2.id));
  });
});
