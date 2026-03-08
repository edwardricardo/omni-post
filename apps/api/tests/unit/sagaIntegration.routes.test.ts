/**
 * SagaIntegration — Publishing, Status & Control Route Tests
 *
 * Validates the HTTP route handlers registered by SagaIntegration for:
 * - Starting post-publishing sagas (input validation, context creation,
 *   scheduling, priority levels)
 * - Querying saga status and progress
 * - Continuing and compensating sagas via API
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SagaIntegration } from "../../src/saga/SagaIntegration";
import {
  buildIntegration,
  makeStartRequest,
  passthroughReply,
  type MockRedis,
} from "./sagaIntegration.helpers";

// Suppress verbose background-execution logs so they don't corrupt the TAP
// stream when this file runs as a subprocess in the full test suite.
console.log = () => {};
console.error = () => {};
console.warn = () => {};

// ============================================================================
// Post Publishing Route Tests
// ============================================================================

describe("SagaIntegration - Post Publishing Routes", { concurrency: 1 }, () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;

  beforeEach(async () => {
    ({ integration, routes } = await buildIntegration());
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("should start post publishing saga with valid request", async () => {
    const handler = routes.get("POST:/api/sagas/post-publishing/start");
    assert.ok(handler, "Route handler should be registered");

    const request = {
      body: {
        postData: {
          body: "Test post content",
          channelIds: ["channel-1", "channel-2"],
          title: "Test Post",
        },
        priority: "NORMAL",
      },
      user: { id: "user-123", projectId: "project-456" },
      headers: { "user-agent": "test-agent" },
      ip: "127.0.0.1",
    };

    const reply = {
      status: (_code: number) => ({ send: (data: any) => data }),
      send: (data: any) => data,
    };

    const result = await handler(request, reply);

    assert.ok(result.success, "Should return success response");
    assert.ok(result.data.sagaId, "Should return saga ID");
    assert.strictEqual(result.data.status, "PENDING");
  });

  it("should validate required fields in post publishing request", async () => {
    const handler = routes.get("POST:/api/sagas/post-publishing/start");

    const request = {
      body: {
        postData: {
          // Missing body field
          channelIds: [],
        },
      },
      user: { id: "user-123" },
      headers: {},
      ip: "127.0.0.1",
    };

    const reply = {
      status: (_code: number) => ({ send: (data: any) => data }),
      send: (data: any) => data,
    };

    try {
      await handler(request, reply);
      assert.fail("Should throw validation error");
    } catch (error: any) {
      assert.ok(error.message.includes("required"), "Should have validation error message");
    }
  });

  it("should create saga context with user and request metadata", async () => {
    const handler = routes.get("POST:/api/sagas/post-publishing/start");

    const request = {
      body: {
        postData: {
          body: "Test post",
          channelIds: ["channel-1"],
        },
      },
      user: { id: "user-123", projectId: "project-456" },
      headers: { "user-agent": "Mozilla/5.0" },
      ip: "192.168.1.1",
    };

    const result = await handler(request, passthroughReply);

    const manager = integration.getSagaManager();
    const saga = await manager.getSaga(result.data.sagaId);

    assert.ok(saga, "Saga should exist");
    assert.strictEqual(saga.context.userId, "user-123");
    assert.strictEqual(saga.context.metadata.source, "API");
  });

  it("should support scheduled post publishing", async () => {
    const handler = routes.get("POST:/api/sagas/post-publishing/start");

    const scheduledDate = new Date(Date.now() + 3_600_000).toISOString();

    const request = {
      body: {
        postData: {
          body: "Scheduled post",
          channelIds: ["channel-1"],
          scheduledAt: scheduledDate,
        },
      },
      user: { id: "user-123", projectId: "project-456" },
      headers: {},
      ip: "127.0.0.1",
    };

    const result = await handler(request, passthroughReply);

    assert.ok(result.success, "Should create scheduled saga");
    assert.ok(result.data.sagaId);
  });

  it("should support priority levels for post publishing", async () => {
    const handler = routes.get("POST:/api/sagas/post-publishing/start");

    const priorities = ["LOW", "NORMAL", "HIGH"] as const;

    for (const priority of priorities) {
      const result = await handler(makeStartRequest({ priority }), passthroughReply);
      assert.ok(result.success, `Should handle ${priority} priority`);
    }
  });
});

// ============================================================================
// Saga Status Route Tests
// ============================================================================

describe("SagaIntegration - Saga Status Routes", { concurrency: 1 }, () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;

  beforeEach(async () => {
    ({ integration, routes } = await buildIntegration());
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("should retrieve saga status by ID", async () => {
    const startHandler = routes.get("POST:/api/sagas/post-publishing/start");
    const startResult = await startHandler(makeStartRequest(), passthroughReply);

    const statusHandler = routes.get("GET:/api/sagas/:sagaId");
    const statusResult = await statusHandler(
      { params: { sagaId: startResult.data.sagaId } },
      passthroughReply
    );

    assert.ok(statusResult.success, "Should return success");
    assert.strictEqual(statusResult.data.id, startResult.data.sagaId);
    assert.ok("status" in statusResult.data);
    assert.ok("progress" in statusResult.data);
  });

  it("should calculate saga progress percentage", async () => {
    const startHandler = routes.get("POST:/api/sagas/post-publishing/start");
    const startResult = await startHandler(makeStartRequest(), passthroughReply);

    const statusHandler = routes.get("GET:/api/sagas/:sagaId");
    const statusResult = await statusHandler(
      { params: { sagaId: startResult.data.sagaId } },
      passthroughReply
    );

    assert.ok(typeof statusResult.data.progress === "number");
    assert.ok(statusResult.data.progress >= 0 && statusResult.data.progress <= 100);
  });

  it("should return step results with saga status", async () => {
    const startHandler = routes.get("POST:/api/sagas/post-publishing/start");
    const startResult = await startHandler(makeStartRequest(), passthroughReply);

    // Allow background execution to complete at least the first steps.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const statusHandler = routes.get("GET:/api/sagas/:sagaId");
    const statusResult = await statusHandler(
      { params: { sagaId: startResult.data.sagaId } },
      passthroughReply
    );

    assert.ok(Array.isArray(statusResult.data.stepResults));
  });

  it("should throw error for non-existent saga", async () => {
    const handler = routes.get("GET:/api/sagas/:sagaId");

    try {
      await handler({ params: { sagaId: "non-existent-saga-id" } }, passthroughReply);
      assert.fail("Should throw not found error");
    } catch (error: any) {
      assert.ok(
        error.message.includes("not found") || error.message.includes("Saga"),
        `Expected not-found message, got: ${error.message}`
      );
    }
  });
});

// ============================================================================
// Saga Control Route Tests
// ============================================================================

describe("SagaIntegration - Saga Control Routes", { concurrency: 1 }, () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    ({ integration, routes, mockRedis } = await buildIntegration());
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("should continue saga execution via API", async () => {
    const startHandler = routes.get("POST:/api/sagas/post-publishing/start");
    const startResult = await startHandler(makeStartRequest(), passthroughReply);

    const continueHandler = routes.get("POST:/api/sagas/:sagaId/continue");
    const continueResult = await continueHandler(
      { params: { sagaId: startResult.data.sagaId } },
      passthroughReply
    );

    assert.ok(continueResult.success, "Should return success");
    assert.strictEqual(continueResult.data.sagaId, startResult.data.sagaId);
  });

  it("should handle saga compensation via API", async () => {
    // Inject a pre-built failed saga directly into the Redis mock so we can
    // test the compensate route without actually running a failing saga.
    const failedSagaId = "saga-test-failed-123";
    const failedSaga = {
      id: failedSagaId,
      definitionId: "post-publishing-saga",
      status: "FAILED",
      currentStep: 2,
      context: {
        sagaId: failedSagaId,
        correlationId: "corr-123",
        metadata: {},
        stepData: {},
        events: [],
      },
      stepResults: [{ success: true }, { success: false, error: "Test failure" }],
      compensationResults: [],
      startedAt: new Date().toISOString(),
      retryCount: 0,
    };

    await mockRedis.setex(`saga:${failedSagaId}`, 3_600, JSON.stringify(failedSaga));

    const compensateHandler = routes.get("POST:/api/sagas/:sagaId/compensate");
    const compensateResult = await compensateHandler(
      { params: { sagaId: failedSagaId } },
      passthroughReply
    );

    assert.ok(compensateResult.success, "Should return success");
    assert.strictEqual(compensateResult.data.sagaId, failedSagaId);
    assert.ok(compensateResult.data.compensationStarted);
  });
});
