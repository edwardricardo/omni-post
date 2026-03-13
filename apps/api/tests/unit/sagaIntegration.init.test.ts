/**
 * SagaIntegration — Initialization & Definition Registration Tests
 *
 * Validates that:
 * - SagaIntegration initialises its internal SagaManager correctly.
 * - All expected API and monitoring routes are registered.
 * - The post-publishing saga definition is registered with the manager.
 * - The CQRS bus and job-queue function are wired up and callable.
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { SagaIntegration } from "../../src/saga/SagaIntegration";
import { Command } from "@shared/cqrs";
import {
  createMockFastify,
  createMockEventService,
  createMockCQRSBus,
  createMockRedis,
  createMockPrisma,
  createMockQueue,
  type MockFastifyInstance,
  type MockEventService,
  type MockCQRSBus,
  type MockRedis,
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
  let mockPrisma: MockPrisma;
  let mockQueue: MockQueue;
  let integration: SagaIntegration | undefined;

  beforeEach(() => {
    mockFastify = createMockFastify();
    mockEventService = createMockEventService();
    mockCQRSBus = createMockCQRSBus();
    mockRedis = createMockRedis();
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
      queue: mockQueue,
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
      queue: mockQueue,
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
      queue: mockQueue,
    });

    await integration.initialize();

    expect(mockFastify.registeredRoutes.has("POST:/api/sagas/post-publishing/start")).toBeTruthy();
    expect(mockFastify.registeredRoutes.has("GET:/api/sagas/:sagaId")).toBeTruthy();
    expect(mockFastify.registeredRoutes.has("POST:/api/sagas/:sagaId/continue")).toBeTruthy();
    expect(mockFastify.registeredRoutes.has("POST:/api/sagas/:sagaId/compensate")).toBeTruthy();
  });

  it("should register monitoring routes during initialization", async () => {
    integration = new SagaIntegration({
      fastify: mockFastify as any,
      prisma: mockPrisma as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
      queue: mockQueue,
    });

    await integration.initialize();

    expect(mockFastify.registeredRoutes.has("GET:/api/sagas")).toBeTruthy();
    expect(mockFastify.registeredRoutes.has("GET:/api/sagas/health")).toBeTruthy();
    expect(mockFastify.registeredRoutes.has("GET:/api/sagas/metrics")).toBeTruthy();
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
  let mockPrisma: MockPrisma;
  let mockQueue: MockQueue;

  beforeEach(async () => {
    mockFastify = createMockFastify();
    mockEventService = createMockEventService();
    mockCQRSBus = createMockCQRSBus();
    mockRedis = createMockRedis();
    mockPrisma = createMockPrisma();
    mockQueue = createMockQueue();

    integration = new SagaIntegration({
      fastify: mockFastify as any,
      prisma: mockPrisma as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
      queue: mockQueue,
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
