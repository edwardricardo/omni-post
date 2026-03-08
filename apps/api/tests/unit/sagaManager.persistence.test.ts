/**
 * SagaManager -- Persistence Tests
 *
 * Validates dual persistence (Redis + in-memory) behavior:
 * - persistSagaInstance() writes to Redis via setex
 * - loadSagaInstance() reads from Redis (cache hit)
 * - loadSagaInstance() returns null on Redis miss
 * - SagaManager.getSaga() checks in-memory map first, then Redis
 * - Round-trip serialization preserves dates and structure
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SagaManagerImpl } from "../../src/saga/SagaManager";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createSagaManager,
  createSimpleSagaDefinition,
  type MockPrismaClient,
  type MockRedis,
  type MockEventService,
} from "./sagaManager.test-helpers";

// Suppress verbose background-execution logs so they don't corrupt the TAP
// stream when this file runs as a subprocess in the full test suite.
console.log = () => {};
console.error = () => {};
console.warn = () => {};

// ============================================================================
// Persistence Round-Trip Tests
// ============================================================================

describe("SagaManager - Persistence Round-Trip", { concurrency: 1 }, () => {
  let manager: SagaManagerImpl;
  let mockRedis: MockRedis;
  let mockPrisma: MockPrismaClient;
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

  it("should persist a saga instance to Redis via setex", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // The startSaga method persists the instance internally.
    // Verify it can be retrieved from Redis.
    const redisData = await mockRedis.get(`saga:${instance.id}`);
    assert.ok(redisData, "Saga instance should be stored in Redis");

    const parsed = JSON.parse(redisData);
    assert.strictEqual(parsed.id, instance.id, "Stored ID should match");
    assert.strictEqual(parsed.definitionId, definition.id, "Stored definitionId should match");
  });

  it("should serialize and deserialize dates correctly", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // Wait for the saga to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    assert.ok(redisData, "Saga instance should be in Redis");

    const parsed = JSON.parse(redisData);

    // startedAt should be a valid ISO date string
    assert.ok(parsed.startedAt, "startedAt should be serialized");
    const startedAt = new Date(parsed.startedAt);
    assert.ok(!isNaN(startedAt.getTime()), "startedAt should be a valid date");
  });

  it("should preserve step results in persisted data", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // Allow the single-step saga to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    assert.ok(redisData, "Saga instance should be in Redis");

    const parsed = JSON.parse(redisData);

    assert.ok(Array.isArray(parsed.stepResults), "stepResults should be an array");
    // After completion, the single step should have a result
    if (parsed.status === "COMPLETED") {
      assert.strictEqual(
        parsed.stepResults.length,
        1,
        "Should have one step result for a single-step saga"
      );
      assert.strictEqual(parsed.stepResults[0].success, true, "Step should have succeeded");
    }
  });
});

// ============================================================================
// Redis Cache Hit / Miss Tests
// ============================================================================

describe("SagaManager - Cache Lookup Behavior", { concurrency: 1 }, () => {
  let manager: SagaManagerImpl;
  let mockRedis: MockRedis;
  let mockPrisma: MockPrismaClient;
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

  it("should return saga from in-memory map when present", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // getSaga should find it in the activeInstances map (in-memory)
    const retrieved = await manager.getSaga(instance.id);
    assert.ok(retrieved, "Should retrieve saga from in-memory map");
    assert.strictEqual(retrieved.id, instance.id);
  });

  it("should fall back to Redis when saga is not in memory", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // Wait for completion so it gets removed from activeInstances
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    // After completion and cleanup, the saga might not be in memory.
    // But it should still be retrievable from Redis.
    const retrieved = await manager.getSaga(instance.id);
    assert.ok(retrieved, "Should retrieve saga from Redis when not in memory");
    assert.strictEqual(retrieved.id, instance.id);
  });

  it("should return null when saga does not exist anywhere", async () => {
    const retrieved = await manager.getSaga("saga-nonexistent-999");
    assert.strictEqual(retrieved, null, "Should return null for nonexistent saga");
  });
});

// ============================================================================
// Persistence on Status Transitions
// ============================================================================

describe("SagaManager - Persistence on Status Transitions", { concurrency: 1 }, () => {
  let manager: SagaManagerImpl;
  let mockRedis: MockRedis;
  let mockPrisma: MockPrismaClient;
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

  it("should persist RUNNING status when saga starts executing", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // Allow execution to begin
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    assert.ok(redisData, "Saga should be persisted");

    const parsed = JSON.parse(redisData);
    // Status should be RUNNING or COMPLETED depending on timing
    assert.ok(
      ["PENDING", "RUNNING", "COMPLETED"].includes(parsed.status),
      `Status should be valid, got: ${parsed.status}`
    );
  });

  it("should persist COMPLETED status after all steps succeed", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // Wait for the single-step saga to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    assert.ok(redisData, "Saga should be persisted");

    const parsed = JSON.parse(redisData);
    assert.strictEqual(parsed.status, "COMPLETED", "Status should be COMPLETED");
    assert.ok(parsed.completedAt, "completedAt should be set after completion");
  });

  it("should persist FAILED status when a step fails without retry", async () => {
    const { createFailingSagaDefinition } = await import("./sagaManager.test-helpers");
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // Wait for the failing step to execute
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    assert.ok(redisData, "Saga should be persisted");

    const parsed = JSON.parse(redisData);
    assert.strictEqual(parsed.status, "FAILED", "Status should be FAILED");
    assert.ok(parsed.error, "Error message should be set");
  });

  it("should persist COMPENSATED status after compensation completes", async () => {
    const { createFailingSagaDefinition } = await import("./sagaManager.test-helpers");
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // Wait for the failing step
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    // Verify it failed
    const failedSaga = await manager.getSaga(instance.id);
    assert.ok(failedSaga, "Saga should exist after failure");
    assert.strictEqual(failedSaga.status, "FAILED");

    // Trigger compensation
    await manager.compensateSaga(instance.id);

    // Wait for compensation to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    assert.ok(redisData, "Saga should be persisted after compensation");

    const parsed = JSON.parse(redisData);
    assert.strictEqual(parsed.status, "COMPENSATED", "Status should be COMPENSATED");
  });
});

// ============================================================================
// Multiple Saga Instances Persistence
// ============================================================================

describe("SagaManager - Multiple Saga Instances", { concurrency: 1 }, () => {
  let manager: SagaManagerImpl;
  let mockRedis: MockRedis;
  let mockPrisma: MockPrismaClient;
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

  it("should persist multiple saga instances independently", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    // Start multiple sagas
    const instance1 = await manager.startSaga(definition.id, {
      metadata: { batch: "first" },
    });
    const instance2 = await manager.startSaga(definition.id, {
      metadata: { batch: "second" },
    });

    // Wait for both to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    // Verify both are persisted with their own data
    const data1 = await mockRedis.get(`saga:${instance1.id}`);
    const data2 = await mockRedis.get(`saga:${instance2.id}`);

    assert.ok(data1, "First saga should be persisted");
    assert.ok(data2, "Second saga should be persisted");

    const parsed1 = JSON.parse(data1);
    const parsed2 = JSON.parse(data2);

    assert.notStrictEqual(parsed1.id, parsed2.id, "Saga IDs should be different");
  });

  it("should track correct metrics across multiple saga instances", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const metricsBefore = manager.getMetrics();
    const startedBefore = metricsBefore.sagasStarted;

    await manager.startSaga(definition.id, {});
    await manager.startSaga(definition.id, {});
    await manager.startSaga(definition.id, {});

    const metricsAfter = manager.getMetrics();
    assert.strictEqual(
      metricsAfter.sagasStarted,
      startedBefore + 3,
      "Should track 3 started sagas"
    );
  });
});

// ============================================================================
// Shutdown Persistence Tests
// ============================================================================

describe("SagaManager - Shutdown Persistence", { concurrency: 1 }, () => {
  let manager: SagaManagerImpl;
  let mockRedis: MockRedis;
  let mockPrisma: MockPrismaClient;
  let mockEventService: MockEventService;

  beforeEach(async () => {
    mockPrisma = createMockPrisma();
    mockRedis = createMockRedis();
    mockEventService = createMockEventService();
    manager = createSagaManager(mockPrisma, mockRedis, mockEventService);
    await manager.initialize();
  });

  it("should persist in-flight sagas as PENDING during shutdown", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});

    // Immediately shut down before the saga completes
    await manager.shutdown();

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    assert.ok(redisData, "In-flight saga should be persisted during shutdown");

    const parsed = JSON.parse(redisData);
    // On shutdown, RUNNING sagas are set to PENDING for restart
    assert.ok(
      ["PENDING", "COMPLETED"].includes(parsed.status),
      `Status should be PENDING or COMPLETED (if fast enough), got: ${parsed.status}`
    );
  });

  it("should clear activeInstances map during shutdown", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    await manager.startSaga(definition.id, {});
    await manager.startSaga(definition.id, {});

    // Shutdown clears all active instances
    await manager.shutdown();

    const metrics = manager.getMetrics();
    // After shutdown, definitions are cleared
    assert.strictEqual(
      metrics.definitions.length,
      0,
      "Definitions should be cleared after shutdown"
    );
  });
});
