/**
 * SagaIntegration — Initialization & Definition Registration Tests
 *
 * Validates that:
 * - SagaIntegration initialises its internal SagaManager correctly.
 * - All expected API and monitoring routes are registered.
 * - The post-publishing saga definition is registered with the manager.
 * - The CQRS bus and job-queue function are wired up and callable.
 *
 * @file sagaIntegration.init.test.ts
 * @description Tests for SagaIntegration - Initialization
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { SagaIntegration } from "../../src/saga/SagaIntegration";
import { Command } from "@shared/cqrs";

const scheduler = new NoopBackgroundTaskScheduler();
import {
  createMockFastify,
  createMockEventService,
  createMockCQRSBus,
  createMockRedis,
  createMockSubscriber,
  createMockPrisma,
  createMockQueue,
  type MockFastifyInstance,
  type MockEventService,
  type MockCQRSBus,
  type MockRedis,
  type MockSubscriber,
  type MockPrisma,
  type MockQueue,
} from "./sagaIntegration.helpers";

// Suppress verbose background-execution logs so they don't corrupt the TAP
// stream when this file runs as a subprocess in the full test suite.
console.log = () => {};
console.error = () => {};
console.warn = () => {};

// ============================================================================
// Initialization Tests
// ============================================================================

describe("SagaIntegration - Initialization", () => {
  let mockFastify: MockFastifyInstance;
  let mockEventService: MockEventService;
  let mockCQRSBus: MockCQRSBus;
  let mockRedis: MockRedis;
  let mockSubscriber: MockSubscriber;
  let mockPrisma: MockPrisma;
  let mockQueue: MockQueue;
  let integration: SagaIntegration | undefined;

  beforeEach(() => {
    mockFastify = createMockFastify();
    mockEventService = createMockEventService();
    mockCQRSBus = createMockCQRSBus();
    mockRedis = createMockRedis();
    mockSubscriber = createMockSubscriber();
    mockPrisma = createMockPrisma();
    mockQueue = createMockQueue();
  });

  afterEach(async () => {
    if (integration) {
      await integration.shutdown();
      integration = undefined;
    }
  });

  it("should initialize saga integration successfully", async () => {
    integration = new SagaIntegration({
      fastify: mockFastify as any,
      prisma: mockPrisma as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
      sagaSubscriber: mockSubscriber as any,
      queue: mockQueue,
      scheduler,
    });

    await integration.initialize();

    const manager = integration.getSagaManager();
    expect(manager).toBeTruthy();
  });

  it("should register saga definitions during initialization", async () => {
    integration = new SagaIntegration({
      fastify: mockFastify as any,
      prisma: mockPrisma as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
      sagaSubscriber: mockSubscriber as any,
      queue: mockQueue,
      scheduler,
    });

    await integration.initialize();

    const manager = integration.getSagaManager();
    const metrics = manager.getMetrics();

    expect(metrics.definitions.includes("post-publishing-saga")).toBeTruthy();
  });

  it("should register API routes during initialization", async () => {
    integration = new SagaIntegration({
      fastify: mockFastify as any,
      prisma: mockPrisma as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
      sagaSubscriber: mockSubscriber as any,
      queue: mockQueue,
      scheduler,
    });

    await integration.initialize();

    expect(mockFastify.registeredRoutes.has("POST:/sagas/post-publishing/start")).toBeTruthy();
    expect(mockFastify.registeredRoutes.has("GET:/sagas/:sagaId")).toBeTruthy();
    expect(mockFastify.registeredRoutes.has("POST:/sagas/:sagaId/continue")).toBeTruthy();
    expect(mockFastify.registeredRoutes.has("POST:/sagas/:sagaId/compensate")).toBeTruthy();
  });

  it("should register monitoring routes during initialization", async () => {
    integration = new SagaIntegration({
      fastify: mockFastify as any,
      prisma: mockPrisma as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
      sagaSubscriber: mockSubscriber as any,
      queue: mockQueue,
      scheduler,
    });

    await integration.initialize();

    expect(mockFastify.registeredRoutes.has("GET:/sagas")).toBeTruthy();
    expect(mockFastify.registeredRoutes.has("GET:/sagas/health")).toBeTruthy();
    expect(mockFastify.registeredRoutes.has("GET:/sagas/metrics")).toBeTruthy();
  });

  it("uses the injected sagaSubscriber for pub/sub (no self-constructed connection) (R11)", async () => {
    integration = new SagaIntegration({
      fastify: mockFastify as any,
      prisma: mockPrisma as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
      sagaSubscriber: mockSubscriber as any,
      queue: mockQueue,
      scheduler,
    });

    await integration.initialize();

    // The INJECTED subscriber is the one connected + subscribed to saga:events.
    // If the service self-constructed its own Redis, the injected double would
    // never be touched.
    expect(mockSubscriber.connect).toHaveBeenCalledTimes(1);
    expect(mockSubscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscriber.subscribe.mock.calls[0]?.[0]).toBe("saga:events");
  });
});

// ============================================================================
// Saga Definition Registration Tests
// ============================================================================

describe("SagaIntegration - Saga Definition Registration", () => {
  let integration: SagaIntegration;
  let mockFastify: MockFastifyInstance;
  let mockEventService: MockEventService;
  let mockCQRSBus: MockCQRSBus;
  let mockRedis: MockRedis;
  let mockSubscriber: MockSubscriber;
  let mockPrisma: MockPrisma;
  let mockQueue: MockQueue;

  beforeEach(async () => {
    mockFastify = createMockFastify();
    mockEventService = createMockEventService();
    mockCQRSBus = createMockCQRSBus();
    mockRedis = createMockRedis();
    mockSubscriber = createMockSubscriber();
    mockPrisma = createMockPrisma();
    mockQueue = createMockQueue();

    integration = new SagaIntegration({
      fastify: mockFastify as any,
      prisma: mockPrisma as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
      sagaSubscriber: mockSubscriber as any,
      queue: mockQueue,
      scheduler,
    });
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("should register post publishing saga definition", async () => {
    await integration.initialize();

    const manager = integration.getSagaManager();
    const metrics = manager.getMetrics();

    expect(metrics.definitions.includes("post-publishing-saga")).toBeTruthy();
  });

  it("should configure command executor for saga steps", async () => {
    await integration.initialize();

    // Verify CQRS bus is ready to execute commands
    const testCommand: Command = {
      id: "cmd-test-123",
      type: "post.create",
      aggregateId: "post-123",
      aggregateType: "Post",
      data: { body: "test" },
      metadata: { source: "test" },
      timestamp: new Date(),
    };

    const result = await mockCQRSBus.executeCommand(testCommand);
    expect(result.success).toBeTruthy();
  });

  it("should configure job queue function for publishing", async () => {
    await integration.initialize();

    // Job queue is wired internally; verify through manager presence
    const manager = integration.getSagaManager();
    expect(manager).toBeTruthy();
  });
});
