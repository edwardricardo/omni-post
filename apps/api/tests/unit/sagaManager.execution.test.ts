import { describe, it, beforeEach, afterEach, expect } from "vitest";
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

describe("SagaManager - Saga Execution", () => {
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
    expect(sagaInstance).toBeTruthy();
    expect(sagaInstance.status).toBe("COMPLETED");
    expect(sagaInstance.currentStep).toBe(definition.steps.length);
  });

  it("should execute multi-step saga sequentially", async () => {
    const definition = createMultiStepSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 500));

    const sagaInstance = await manager.getSaga(instance.id);
    expect(sagaInstance).toBeTruthy();
    expect(sagaInstance.status).toBe("COMPLETED");
    expect(sagaInstance.stepResults.length).toBe(definition.steps.length);

    sagaInstance.stepResults.forEach((result, _index) => {
      expect(result.success).toBe(true);
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

    expect(stepCompletedEvents.length).toBe(definition.steps.length);
  });

  it("should pass context between steps with stepData", async () => {
    const definition = createMultiStepSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {
      metadata: { testValue: "shared-data" },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const sagaInstance = await manager.getSaga(instance.id);
    expect(sagaInstance).toBeTruthy();
    expect(sagaInstance.context.stepData["successful-step"]).toBeTruthy();
    expect(sagaInstance.context.stepData["delayed-step"]).toBeTruthy();
  });

  it("should emit saga completed event on successful completion", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 200));

    const completedEvents = mockEventService.publishedEvents.filter(
      (e) => e.type === SAGA_EVENTS.SAGA_COMPLETED
    );

    expect(completedEvents.length).toBe(1);
    expect(completedEvents[0]!.data.status).toBe("COMPLETED");
  });

  it("should update metrics on saga completion", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const metricsBefore = manager.getMetrics();
    const completedBefore = metricsBefore.sagasCompleted;

    await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 200));

    const metricsAfter = manager.getMetrics();
    expect(metricsAfter.sagasCompleted).toBe(completedBefore + 1);
    expect(metricsAfter.averageExecutionTime >= 0).toBeTruthy();
  });
});

describe("SagaManager - Saga Failure and Compensation", () => {
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
    expect(metrics.sagasFailed).toBe(1);
  });

  it("should emit saga failed event on failure", async () => {
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 300));

    const failedEvents = mockEventService.publishedEvents.filter(
      (e) => e.type === SAGA_EVENTS.SAGA_FAILED
    );

    expect(failedEvents.length > 0).toBeTruthy();
  });

  it("should compensate saga when manually triggered", async () => {
    // Use a saga that naturally reaches FAILED state
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // Wait for the saga to fail (FailingStep causes failure)
    await new Promise((resolve) => setTimeout(resolve, 300));

    const sagaInstance = await manager.getSaga(instance.id);
    expect(sagaInstance).toBeTruthy();
    expect(sagaInstance.status).toBe("FAILED");

    // Now trigger manual compensation on the naturally-failed saga
    await manager.compensateSaga(instance.id);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const compensatedEvents = mockEventService.publishedEvents.filter(
      (e) => e.type === SAGA_EVENTS.SAGA_COMPENSATION_COMPLETED
    );

    expect(compensatedEvents.length > 0).toBeTruthy();
  });

  it("should throw error when compensating non-failed saga", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    await expect(manager.compensateSaga(instance.id)).rejects.toThrow(/not in a failed state/);
  });

  it("should update metrics on saga failure", async () => {
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    const metricsBefore = manager.getMetrics();
    const failedBefore = metricsBefore.sagasFailed;

    await manager.startSaga(definition.id, {});

    await new Promise((resolve) => setTimeout(resolve, 300));

    const metricsAfter = manager.getMetrics();
    expect(metricsAfter.sagasFailed).toBe(failedBefore + 1);
  });
});

describe("SagaManager - Retry Logic", () => {
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

    expect(stepFailedEvents.length).toBe(1);
  });
});

describe("SagaManager - Event Handling", () => {
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

    await expect(manager.handleEvent(testEvent)).resolves.not.toThrow();
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

    await expect(manager.handleEvent(testEvent)).resolves.not.toThrow();

    // Verify no saga-related events were emitted (event was ignored)
    const sagaEvents = mockEventService.publishedEvents
      .slice(publishedBefore)
      .filter((e) => e.type.startsWith("saga."));
    expect(sagaEvents.length).toBe(0);
  });
});

describe("SagaManager - Health Check", () => {
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

    expect(health.status).toBe("healthy");
    expect(health.details.database).toBe(true);
    expect(health.details.redis).toBe(true);
  });

  it("should include saga metrics in health check", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const health = await manager.healthCheck();

    expect(health.details.definitionsRegistered >= 1).toBeTruthy();
    expect(health.details.activeInstances >= 0).toBeTruthy();
  });
});

describe("SagaManager - Metrics", () => {
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
    expect(metricsAfter.sagasStarted).toBe(startedBefore + 1);
  });

  it("should track active instances count", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const metricsBefore = manager.getMetrics();

    await manager.startSaga(definition.id, {});

    const metricsAfter = manager.getMetrics();
    expect(metricsAfter.activeInstances >= metricsBefore.activeInstances).toBeTruthy();
  });

  it("should return registered definitions in metrics", async () => {
    const definition1 = createSimpleSagaDefinition();
    const definition2 = createMultiStepSagaDefinition();

    manager.registerSaga(definition1);
    manager.registerSaga(definition2);

    const metrics = manager.getMetrics();
    expect(metrics.definitions.includes(definition1.id)).toBeTruthy();
    expect(metrics.definitions.includes(definition2.id)).toBeTruthy();
  });
});
