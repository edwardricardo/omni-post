/**
 * SagaIntegration — Publishing, Status & Control Route Tests
 *
 * Validates the HTTP route handlers registered by SagaIntegration for:
 * - Starting post-publishing sagas (input validation, context creation,
 *   scheduling, priority levels)
 * - Querying saga status and progress
 * - Continuing and compensating sagas via API
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
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

describe("SagaIntegration - Post Publishing Routes", () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;

  beforeEach(async () => {
    ({ integration, routes } = await buildIntegration());
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("should start post publishing saga with valid request", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    expect(handler).toBeTruthy();

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

    expect(result.success).toBeTruthy();
    expect(result.data.sagaId).toBeTruthy();
    expect(result.data.status).toBe("PENDING");
  });

  it("should validate required fields in post publishing request", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");

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
      expect.unreachable("Should throw validation error");
    } catch (error: any) {
      expect(error.message.includes("required")).toBeTruthy();
    }
  });

  it("should create saga context with user and request metadata", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");

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

    expect(saga).toBeTruthy();
    expect(saga.context.userId).toBe("user-123");
    expect(saga.context.metadata.source).toBe("API");
  });

  it("should support scheduled post publishing", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");

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

    expect(result.success).toBeTruthy();
    expect(result.data.sagaId).toBeTruthy();
  });

  it("should support priority levels for post publishing", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");

    const priorities = ["LOW", "NORMAL", "HIGH"] as const;

    for (const priority of priorities) {
      const result = await handler(makeStartRequest({ priority }), passthroughReply);
      expect(result.success).toBeTruthy();
    }
  });
});

// ============================================================================
// Saga Status Route Tests
// ============================================================================

describe("SagaIntegration - Saga Status Routes", () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;

  beforeEach(async () => {
    ({ integration, routes } = await buildIntegration());
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("should retrieve saga status by ID", async () => {
    const startHandler = routes.get("POST:/sagas/post-publishing/start");
    const startResult = await startHandler(makeStartRequest(), passthroughReply);

    const statusHandler = routes.get("GET:/sagas/:sagaId");
    const statusResult = await statusHandler(
      { params: { sagaId: startResult.data.sagaId } },
      passthroughReply
    );

    expect(statusResult.success).toBeTruthy();
    expect(statusResult.data.id).toBe(startResult.data.sagaId);
    expect("status" in statusResult.data).toBeTruthy();
    expect("progress" in statusResult.data).toBeTruthy();
  });

  it("should calculate saga progress percentage", async () => {
    const startHandler = routes.get("POST:/sagas/post-publishing/start");
    const startResult = await startHandler(makeStartRequest(), passthroughReply);

    const statusHandler = routes.get("GET:/sagas/:sagaId");
    const statusResult = await statusHandler(
      { params: { sagaId: startResult.data.sagaId } },
      passthroughReply
    );

    expect(typeof statusResult.data.progress === "number").toBeTruthy();
    expect(statusResult.data.progress >= 0 && statusResult.data.progress <= 100).toBeTruthy();
  });

  it("should return step results with saga status", async () => {
    const startHandler = routes.get("POST:/sagas/post-publishing/start");
    const startResult = await startHandler(makeStartRequest(), passthroughReply);

    // Allow background execution to complete at least the first steps.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const statusHandler = routes.get("GET:/sagas/:sagaId");
    const statusResult = await statusHandler(
      { params: { sagaId: startResult.data.sagaId } },
      passthroughReply
    );

    expect(Array.isArray(statusResult.data.stepResults)).toBeTruthy();
  });

  it("should throw error for non-existent saga", async () => {
    const handler = routes.get("GET:/sagas/:sagaId");

    try {
      await handler({ params: { sagaId: "non-existent-saga-id" } }, passthroughReply);
      expect.unreachable("Should throw not found error");
    } catch (error: any) {
      expect(error.message.includes("not found") || error.message.includes("Saga")).toBeTruthy();
    }
  });
});

// ============================================================================
// Saga Control Route Tests
// ============================================================================

describe("SagaIntegration - Saga Control Routes", () => {
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
    const startHandler = routes.get("POST:/sagas/post-publishing/start");
    const startResult = await startHandler(makeStartRequest(), passthroughReply);

    const continueHandler = routes.get("POST:/sagas/:sagaId/continue");
    const continueResult = await continueHandler(
      { params: { sagaId: startResult.data.sagaId } },
      passthroughReply
    );

    expect(continueResult.success).toBeTruthy();
    expect(continueResult.data.sagaId).toBe(startResult.data.sagaId);
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

    const compensateHandler = routes.get("POST:/sagas/:sagaId/compensate");
    const compensateResult = await compensateHandler(
      { params: { sagaId: failedSagaId } },
      passthroughReply
    );

    expect(compensateResult.success).toBeTruthy();
    expect(compensateResult.data.sagaId).toBe(failedSagaId);
    expect(compensateResult.data.compensationStarted).toBeTruthy();
  });
});
