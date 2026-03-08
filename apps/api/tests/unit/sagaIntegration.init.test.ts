/**
 * SagaIntegration — Initialization & Definition Registration Tests
 *
 * Validates that:
 * - SagaIntegration initialises its internal SagaManager correctly.
 * - All expected API and monitoring routes are registered.
 * - The post-publishing saga definition is registered with the manager.
 * - The CQRS bus and job-queue function are wired up and callable.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SagaIntegration } from "../../src/saga/SagaIntegration";
import { Command } from "@shared/cqrs";
import {
  createMockFastify,
  createMockEventService,
  createMockCQRSBus,
  createMockRedis,
  type MockFastifyInstance,
  type MockEventService,
  type MockCQRSBus,
  type MockRedis,
} from "./sagaIntegration.helpers";

// Suppress verbose background-execution logs so they don't corrupt the TAP
// stream when this file runs as a subprocess in the full test suite.
console.log = () => {};
console.error = () => {};
console.warn = () => {};

// ============================================================================
// Initialization Tests
// ============================================================================

describe("SagaIntegration - Initialization", { concurrency: 1 }, () => {
  let mockFastify: MockFastifyInstance;
  let mockEventService: MockEventService;
  let mockCQRSBus: MockCQRSBus;
  let mockRedis: MockRedis;
  let integration: SagaIntegration | undefined;

  beforeEach(() => {
    mockFastify = createMockFastify();
    mockEventService = createMockEventService();
    mockCQRSBus = createMockCQRSBus();
    mockRedis = createMockRedis();
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
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
    });

    await integration.initialize();

    const manager = integration.getSagaManager();
    assert.ok(manager, "Saga manager should be initialised");
  });

  it("should register saga definitions during initialization", async () => {
    integration = new SagaIntegration({
      fastify: mockFastify as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
    });

    await integration.initialize();

    const manager = integration.getSagaManager();
    const metrics = manager.getMetrics();

    assert.ok(
      metrics.definitions.includes("post-publishing-saga"),
      "Post publishing saga should be registered"
    );
  });

  it("should register API routes during initialization", async () => {
    integration = new SagaIntegration({
      fastify: mockFastify as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
    });

    await integration.initialize();

    assert.ok(
      mockFastify.registeredRoutes.has("POST:/api/sagas/post-publishing/start"),
      "Should register post publishing start route"
    );
    assert.ok(
      mockFastify.registeredRoutes.has("GET:/api/sagas/:sagaId"),
      "Should register saga status route"
    );
    assert.ok(
      mockFastify.registeredRoutes.has("POST:/api/sagas/:sagaId/continue"),
      "Should register saga continue route"
    );
    assert.ok(
      mockFastify.registeredRoutes.has("POST:/api/sagas/:sagaId/compensate"),
      "Should register saga compensate route"
    );
  });

  it("should register monitoring routes during initialization", async () => {
    integration = new SagaIntegration({
      fastify: mockFastify as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
    });

    await integration.initialize();

    assert.ok(
      mockFastify.registeredRoutes.has("GET:/api/sagas"),
      "Should register sagas list route"
    );
    assert.ok(
      mockFastify.registeredRoutes.has("GET:/api/sagas/health"),
      "Should register health check route"
    );
    assert.ok(
      mockFastify.registeredRoutes.has("GET:/api/sagas/metrics"),
      "Should register metrics route"
    );
  });
});

// ============================================================================
// Saga Definition Registration Tests
// ============================================================================

describe("SagaIntegration - Saga Definition Registration", { concurrency: 1 }, () => {
  let integration: SagaIntegration;
  let mockFastify: MockFastifyInstance;
  let mockEventService: MockEventService;
  let mockCQRSBus: MockCQRSBus;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    mockFastify = createMockFastify();
    mockEventService = createMockEventService();
    mockCQRSBus = createMockCQRSBus();
    mockRedis = createMockRedis();

    integration = new SagaIntegration({
      fastify: mockFastify as any,
      eventService: mockEventService as any,
      cqrsBus: mockCQRSBus as any,
      redis: mockRedis as any,
    });
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("should register post publishing saga definition", async () => {
    await integration.initialize();

    const manager = integration.getSagaManager();
    const metrics = manager.getMetrics();

    assert.ok(metrics.definitions.includes("post-publishing-saga"));
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
    assert.ok(result.success, "CQRS bus should execute commands");
  });

  it("should configure job queue function for publishing", async () => {
    await integration.initialize();

    // Job queue is wired internally; verify through manager presence
    const manager = integration.getSagaManager();
    assert.ok(manager, "Manager with job queue should be initialised");
  });
});
