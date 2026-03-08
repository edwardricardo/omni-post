import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SAGA_EVENTS } from "@shared/saga";
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
} from "./sagaManager.test-helpers.js";
import { SagaManagerImpl } from "../../src/saga/SagaManager";

describe("SagaManager - Saga Registration", { concurrency: 1 }, () => {
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
    assert.ok(metrics.definitions.includes(definition.id));
  });

  it("should throw error when registering duplicate saga definition", () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    assert.throws(
      () => manager.registerSaga(definition),
      /already registered/,
      "Should throw error for duplicate registration"
    );
  });

  it("should register multiple different saga definitions", () => {
    const definition1 = createSimpleSagaDefinition();
    const definition2 = createMultiStepSagaDefinition();

    manager.registerSaga(definition1);
    manager.registerSaga(definition2);

    const metrics = manager.getMetrics();
    assert.strictEqual(metrics.definitions.length, 2);
    assert.ok(metrics.definitions.includes(definition1.id));
    assert.ok(metrics.definitions.includes(definition2.id));
  });
});

describe("SagaManager - Saga Lifecycle", { concurrency: 1 }, () => {
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
      correlationId: "test-corr-123",
      userId: "user-456",
      metadata: { source: "test" },
    });

    assert.ok(instance.id, "Saga instance should have an ID");
    assert.strictEqual(instance.definitionId, definition.id);
    assert.strictEqual(instance.status, "PENDING");
    assert.strictEqual(instance.currentStep, 0);
    assert.strictEqual(instance.retryCount, 0);
    assert.strictEqual(instance.context.correlationId, "test-corr-123");
    assert.strictEqual(instance.context.userId, "user-456");
  });

  it("should throw error when starting saga with unknown definition", async () => {
    await assert.rejects(
      async () => await manager.startSaga("unknown-saga", {}),
      /not found/,
      "Should throw error for unknown saga definition"
    );
  });

  it("should emit saga started event on saga start", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    await manager.startSaga(definition.id, {
      correlationId: "test-corr-123",
    });

    const startedEvents = mockEventService.publishedEvents.filter(
      (e) => e.type === SAGA_EVENTS.SAGA_STARTED
    );

    assert.strictEqual(startedEvents.length, 1);
    assert.strictEqual(startedEvents[0]!.data.definitionId, definition.id);
    assert.strictEqual(startedEvents[0]!.data.correlationId, "test-corr-123");
  });

  it("should increment active instances metric on saga start", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const metricsBefore = manager.getMetrics();
    const activeInstancesBefore = metricsBefore.activeInstances;

    await manager.startSaga(definition.id, {});

    const metricsAfter = manager.getMetrics();
    assert.strictEqual(metricsAfter.activeInstances, activeInstancesBefore + 1);
  });
});

describe("SagaManager - State Persistence", { concurrency: 1 }, () => {
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

    const instance = await manager.startSaga(definition.id, {});

    const key = `saga:${instance.id}`;
    const data = await mockRedis.get(key);

    assert.ok(data, "Saga instance should be persisted to Redis");

    const parsed = JSON.parse(data!);
    assert.strictEqual(parsed.id, instance.id);
    assert.strictEqual(parsed.definitionId, definition.id);
  });

  it("should retrieve saga instance from Redis", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    const retrieved = await manager.getSaga(instance.id);

    assert.ok(retrieved, "Should retrieve saga instance");
    assert.strictEqual(retrieved.id, instance.id);
    assert.strictEqual(retrieved.definitionId, instance.definitionId);
  });

  it("should return null for non-existent saga", async () => {
    const retrieved = await manager.getSaga("non-existent-saga-id");
    assert.strictEqual(retrieved, null);
  });
});

describe("SagaManager - Shutdown", { concurrency: 1 }, () => {
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
    assert.strictEqual(metrics.activeInstances, 0);
    assert.strictEqual(metrics.definitions.length, 0);
  });

  it("should persist running sagas as pending on shutdown", async () => {
    const definition = createMultiStepSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    await manager.shutdown();

    const data = await mockRedis.get(`saga:${instance.id}`);
    assert.ok(data, "Saga should be persisted on shutdown");
  });
});
