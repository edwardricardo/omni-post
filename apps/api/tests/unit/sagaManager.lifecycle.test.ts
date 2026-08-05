/**
 * @file sagaManager.lifecycle.test.ts
 * @description Tests for SagaManager - Saga Registration
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { SAGA_EVENTS } from "@shared/types/saga.js";
import {
  MockPrismaClient,
  MockRedis,
  MockEventService,
  TEST_ACCOUNT_ID,
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createSagaManager,
  createSimpleSagaDefinition,
  createMultiStepSagaDefinition,
} from "./sagaManager.test-helpers.js";
import { SagaManagerImpl } from "../../src/saga/SagaManager.js";

describe("SagaManager - Saga Registration", () => {
  let manager: SagaManagerImpl;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockRedis = createMockRedis();
    mockEventService = createMockEventService();
    manager = createSagaManager(mockPrisma, mockRedis, mockEventService);
  });

  it("should register saga definition successfully", () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const metrics = manager.getMetrics();
    expect(metrics.definitions.includes(definition.id)).toBeTruthy();
  });

  it("should throw error when registering duplicate saga definition", () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    expect(() => manager.registerSaga(definition)).toThrow(/already registered/);
  });

  it("should register multiple different saga definitions", () => {
    const definition1 = createSimpleSagaDefinition();
    const definition2 = createMultiStepSagaDefinition();

    manager.registerSaga(definition1);
    manager.registerSaga(definition2);

    const metrics = manager.getMetrics();
    expect(metrics.definitions.length).toBe(2);
    expect(metrics.definitions.includes(definition1.id)).toBeTruthy();
    expect(metrics.definitions.includes(definition2.id)).toBeTruthy();
  });
});

describe("SagaManager - Saga Lifecycle", () => {
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

  it("should start saga with valid definition and context", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {
      accountId: TEST_ACCOUNT_ID,
      correlationId: "test-corr-123",
      userId: "user-456",
      metadata: { source: "test" },
    });

    expect(instance.id).toBeTruthy();
    expect(instance.definitionId).toBe(definition.id);
    expect(instance.status).toBe("PENDING");
    expect(instance.currentStep).toBe(0);
    expect(instance.retryCount).toBe(0);
    expect(instance.context.correlationId).toBe("test-corr-123");
    expect(instance.context.userId).toBe("user-456");
  });

  it("should throw error when starting saga with unknown definition", async () => {
    await expect(manager.startSaga("unknown-saga", {})).rejects.toThrow(/not found/);
  });

  it("should emit saga started event on saga start", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    await manager.startSaga(definition.id, {
      accountId: TEST_ACCOUNT_ID,
      correlationId: "test-corr-123",
    });

    const startedEvents = mockEventService.publishedEvents.filter(
      (e) => e.type === SAGA_EVENTS.SAGA_STARTED
    );

    expect(startedEvents.length).toBe(1);
    expect(startedEvents[0]!.data.definitionId).toBe(definition.id);
    expect(startedEvents[0]!.data.correlationId).toBe("test-corr-123");
  });

  it("should increment active instances metric on saga start", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const metricsBefore = manager.getMetrics();
    const activeInstancesBefore = metricsBefore.activeInstances;

    await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    const metricsAfter = manager.getMetrics();
    expect(metricsAfter.activeInstances).toBe(activeInstancesBefore + 1);
  });
});

describe("SagaManager - State Persistence", () => {
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

  it("should persist saga instance to Redis on start", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    const key = `saga:${instance.id}`;
    const data = await mockRedis.get(key);

    expect(data).toBeTruthy();

    const parsed = JSON.parse(data!);
    expect(parsed.id).toBe(instance.id);
    expect(parsed.definitionId).toBe(definition.id);
  });

  it("should retrieve saga instance from Redis", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    const retrieved = await manager.getSaga(instance.id);

    expect(retrieved).toBeTruthy();
    expect(retrieved.id).toBe(instance.id);
    expect(retrieved.definitionId).toBe(instance.definitionId);
  });

  it("should return null for non-existent saga", async () => {
    const retrieved = await manager.getSaga("non-existent-saga-id");
    expect(retrieved).toBe(null);
  });
});

describe("SagaManager - Shutdown", () => {
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

  it("should shutdown gracefully", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    await manager.shutdown();

    const metrics = manager.getMetrics();
    expect(metrics.activeInstances).toBe(0);
    expect(metrics.definitions.length).toBe(0);
  });

  it("should persist running sagas as pending on shutdown", async () => {
    const definition = createMultiStepSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    await manager.shutdown();

    const data = await mockRedis.get(`saga:${instance.id}`);
    expect(data).toBeTruthy();
  });
});
