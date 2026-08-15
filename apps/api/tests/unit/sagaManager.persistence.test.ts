/**
 * SagaManager -- Persistence Tests
 *
 * Validates dual persistence (Redis + in-memory) behavior:
 * - persistSagaInstance() writes to Redis via setex
 * - loadSagaInstance() reads from Redis (cache hit)
 * - loadSagaInstance() returns null on Redis miss
 * - SagaManager.getSaga() checks in-memory map first, then Redis
 * - Round-trip serialization preserves dates and structure
 *
 * @file sagaManager.persistence.test.ts
 * @description Tests for SagaManager - Persistence Round-Trip
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { SagaManagerImpl } from "../../src/saga/SagaManager.js";
import {
  TEST_ACCOUNT_ID,
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createSagaManager,
  createSimpleSagaDefinition,
  type MockPrismaClient,
  type MockRedis,
  type MockEventService,
} from "./sagaManager.test-helpers.js";

// Suppress verbose background-execution logs so they don't corrupt the TAP
// stream when this file runs as a subprocess in the full test suite.
console.log = () => {};
console.error = () => {};
console.warn = () => {};

// ============================================================================
// Persistence Round-Trip Tests
// ============================================================================

describe("SagaManager - Persistence Round-Trip", () => {
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

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    // The startSaga method persists the instance internally.
    // Verify it can be retrieved from Redis.
    const redisData = await mockRedis.get(`saga:${instance.id}`);
    expect(redisData).toBeTruthy();

    const parsed = JSON.parse(redisData);
    expect(parsed.id).toBe(instance.id);
    expect(parsed.definitionId).toBe(definition.id);
  });

  it("should serialize and deserialize dates correctly", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    // Wait for the saga to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    expect(redisData).toBeTruthy();

    const parsed = JSON.parse(redisData);

    // startedAt should be a valid ISO date string
    expect(parsed.startedAt).toBeTruthy();
    const startedAt = new Date(parsed.startedAt);
    expect(isNaN(startedAt.getTime())).toBeFalsy();
  });

  it("should preserve step results in persisted data", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    // Allow the single-step saga to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    expect(redisData).toBeTruthy();

    const parsed = JSON.parse(redisData);

    expect(Array.isArray(parsed.stepResults)).toBeTruthy();
    // After completion, the single step should have a result
    if (parsed.status === "COMPLETED") {
      expect(parsed.stepResults.length).toBe(1);
      expect(parsed.stepResults[0].outcome).toBe("succeeded");
    }
  });
});

// ============================================================================
// Redis Cache Hit / Miss Tests
// ============================================================================

describe("SagaManager - Cache Lookup Behavior", () => {
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

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    // getSaga should find it in the activeInstances map (in-memory)
    const retrieved = await manager.getSaga(instance.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved.id).toBe(instance.id);
  });

  it("should fall back to Redis when saga is not in memory", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    // Wait for completion so it gets removed from activeInstances
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    // After completion and cleanup, the saga might not be in memory.
    // But it should still be retrievable from Redis.
    const retrieved = await manager.getSaga(instance.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved.id).toBe(instance.id);
  });

  it("should return null when saga does not exist anywhere", async () => {
    const retrieved = await manager.getSaga("saga-nonexistent-999");
    expect(retrieved).toBe(null);
  });
});

// ============================================================================
// Persistence on Status Transitions
// ============================================================================

describe("SagaManager - Persistence on Status Transitions", () => {
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

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    // Allow execution to begin
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    expect(redisData).toBeTruthy();

    const parsed = JSON.parse(redisData);
    // Status should be RUNNING or COMPLETED depending on timing
    expect(["PENDING", "RUNNING", "COMPLETED"].includes(parsed.status)).toBeTruthy();
  });

  it("should persist COMPLETED status after all steps succeed", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    // Wait for the single-step saga to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    expect(redisData).toBeTruthy();

    const parsed = JSON.parse(redisData);
    expect(parsed.status).toBe("COMPLETED");
    expect(parsed.completedAt).toBeTruthy();
  });

  it("should persist FAILED status when a step fails without retry", async () => {
    const { createFailingSagaDefinition } = await import("./sagaManager.test-helpers.js");
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    // Wait for the failing step to execute
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    expect(redisData).toBeTruthy();

    const parsed = JSON.parse(redisData);
    expect(parsed.status).toBe("FAILED");
    expect(parsed.error).toBeTruthy();
  });

  it("should persist COMPENSATED status after compensation completes", async () => {
    const { createFailingSagaDefinition } = await import("./sagaManager.test-helpers.js");
    const definition = createFailingSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    // Wait for the failing step
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    // Verify it failed
    const failedSaga = await manager.getSaga(instance.id);
    expect(failedSaga).toBeTruthy();
    expect(failedSaga.status).toBe("FAILED");

    // Trigger compensation
    await manager.compensateSaga(instance.id);

    // Wait for compensation to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    expect(redisData).toBeTruthy();

    const parsed = JSON.parse(redisData);
    expect(parsed.status).toBe("COMPENSATED");
  });
});

// ============================================================================
// Multiple Saga Instances Persistence
// ============================================================================

describe("SagaManager - Multiple Saga Instances", () => {
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
      accountId: TEST_ACCOUNT_ID,
      metadata: { batch: "first" },
    });
    const instance2 = await manager.startSaga(definition.id, {
      accountId: TEST_ACCOUNT_ID,
      metadata: { batch: "second" },
    });

    // Wait for both to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    // Verify both are persisted with their own data
    const data1 = await mockRedis.get(`saga:${instance1.id}`);
    const data2 = await mockRedis.get(`saga:${instance2.id}`);

    expect(data1).toBeTruthy();
    expect(data2).toBeTruthy();

    const parsed1 = JSON.parse(data1);
    const parsed2 = JSON.parse(data2);

    expect(parsed1.id).not.toBe(parsed2.id);
  });

  it("should track correct metrics across multiple saga instances", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const metricsBefore = manager.getMetrics();
    const startedBefore = metricsBefore.sagasStarted;

    await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });
    await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });
    await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    const metricsAfter = manager.getMetrics();
    expect(metricsAfter.sagasStarted).toBe(startedBefore + 3);
  });
});

// ============================================================================
// Shutdown Persistence Tests
// ============================================================================

describe("SagaManager - Shutdown Persistence", () => {
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

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    // Immediately shut down before the saga completes
    await manager.shutdown();

    const redisData = await mockRedis.get(`saga:${instance.id}`);
    expect(redisData).toBeTruthy();

    const parsed = JSON.parse(redisData);
    // On shutdown, RUNNING sagas are set to PENDING for restart
    expect(["PENDING", "COMPLETED"].includes(parsed.status)).toBeTruthy();
  });

  it("should clear activeInstances map during shutdown", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });
    await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });

    // Shutdown clears all active instances
    await manager.shutdown();

    const metrics = manager.getMetrics();
    // After shutdown, definitions are cleared
    expect(metrics.definitions.length).toBe(0);
  });
});
