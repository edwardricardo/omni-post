/**
 * SagaIntegration — Publishing, Status & Control Route Tests
 *
 * Validates the HTTP route handlers registered by SagaIntegration for:
 * - Starting post-publishing sagas (input validation, context creation,
 *   scheduling, priority levels)
 * - Querying saga status and progress
 * - Continuing and compensating sagas via API
 *
 * @file sagaIntegration.routes.test.ts
 * @description Tests for SagaIntegration - Post Publishing Routes
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { SagaIntegration } from "../../src/saga/SagaIntegration.js";
import {
  buildIntegration,
  makeStartRequest,
  passthroughReply,
  TEST_CHANNEL_IDS,
  TEST_CUSTOMER_ID,
  TEST_ACCOUNT_ID,
  type MockRedis,
} from "./sagaIntegration.helpers.js";

const makeAuthedStatusRequest = (sagaId: string) => ({
  params: { sagaId },
  customerUser: {
    id: TEST_CUSTOMER_ID,
    accountId: TEST_ACCOUNT_ID,
    roleId: "role-owner",
    roleName: "OWNER",
    permissions: [],
  },
});

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

    const result = await handler(
      makeStartRequest({ body: "Test post content", title: "Test Post" }),
      passthroughReply
    );

    expect(result.success).toBeTruthy();
    expect(result.data.sagaId).toBeTruthy();
    expect(result.data.status).toBe("PENDING");
  });

  it("should validate required fields in post publishing request", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");

    // Missing body content for a from-scratch publish-now request
    const request = makeStartRequest({ mode: "publish-now" });
    request.body = {
      mode: "publish-now",
      projectId: request.body.projectId,
      channelIds: [TEST_CHANNEL_IDS[0]!],
      // No postId, no body — triggers refinement failure
    };

    await expect(handler(request, passthroughReply)).rejects.toThrowError(
      /Invalid saga start body/
    );
  });

  it("should create saga context with user and request metadata", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");

    const result = await handler(makeStartRequest({ body: "Test post" }), passthroughReply);

    const manager = integration.getSagaManager();
    const saga = await manager.getSaga(result.data.sagaId);

    expect(saga).toBeTruthy();
    expect(saga!.context.userId).toBe(TEST_CUSTOMER_ID);
    expect(saga!.context.metadata.source).toBe("customer-api");
  });

  it("should support scheduled post publishing", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");

    const result = await handler(
      makeStartRequest({
        mode: "schedule",
        body: "Scheduled post",
        channelIds: [TEST_CHANNEL_IDS[0]!],
      }),
      passthroughReply
    );

    expect(result.success).toBeTruthy();
    expect(result.data.sagaId).toBeTruthy();
    expect(result.data.mode).toBe("schedule");
  });

  it("should accept all three modes (draft, schedule, publish-now)", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");

    const draftResult = await handler(
      makeStartRequest({ mode: "draft", body: "Draft content" }),
      passthroughReply
    );
    expect(draftResult.success).toBeTruthy();

    const scheduleResult = await handler(
      makeStartRequest({ mode: "schedule", body: "Schedule content" }),
      passthroughReply
    );
    expect(scheduleResult.success).toBeTruthy();

    const publishNowResult = await handler(
      makeStartRequest({ mode: "publish-now", body: "Publish now content" }),
      passthroughReply
    );
    expect(publishNowResult.success).toBeTruthy();
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
      makeAuthedStatusRequest(startResult.data.sagaId),
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
      makeAuthedStatusRequest(startResult.data.sagaId),
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
      makeAuthedStatusRequest(startResult.data.sagaId),
      passthroughReply
    );

    expect(Array.isArray(statusResult.data.stepResults)).toBeTruthy();
  });

  it("should throw error for non-existent saga", async () => {
    const handler = routes.get("GET:/sagas/:sagaId");

    await expect(
      handler(makeAuthedStatusRequest("non-existent-saga-id"), passthroughReply)
    ).rejects.toThrowError(/Saga.*not found|not found.*Saga/i);
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

  /** Builds a FAILED saga row in the Redis mock, optionally owned by an account. */
  const seedFailedSaga = async (sagaId: string, accountId?: string): Promise<void> => {
    const failedSaga = {
      id: sagaId,
      definitionId: "post-publishing-saga",
      status: "FAILED",
      currentStep: 2,
      ...(accountId !== undefined && { accountId }),
      context: {
        sagaId,
        correlationId: `corr-${sagaId}`,
        ...(accountId !== undefined && { accountId }),
        metadata: {},
        stepData: {},
        events: [],
      },
      stepResults: [{ success: true }, { success: false, error: "Test failure" }],
      compensationResults: [],
      startedAt: new Date().toISOString(),
      retryCount: 0,
    };

    await mockRedis.setex(`saga:${sagaId}`, 3_600, JSON.stringify(failedSaga));
  };

  it("should handle saga compensation via API", async () => {
    // Inject a pre-built failed saga directly into the Redis mock so we can
    // test the compensate route without actually running a failing saga. It
    // carries an owning account, because a saga without one cannot be scoped
    // and the route below proves that case answers differently.
    const failedSagaId = "saga-test-failed-123";
    await seedFailedSaga(failedSagaId, "acc-11111111-1111-4111-8111-111111111111");

    const compensateHandler = routes.get("POST:/sagas/:sagaId/compensate");
    const compensateResult = await compensateHandler(
      { params: { sagaId: failedSagaId } },
      passthroughReply
    );

    expect(compensateResult.success).toBeTruthy();
    expect(compensateResult.data.sagaId).toBe(failedSagaId);
    expect(compensateResult.data.compensationStarted).toBeTruthy();
  });

  it("should refuse compensation of a saga whose owning account is unresolvable", async () => {
    // A saga the engine cannot scope to a tenant has its compensation SKIPPED.
    // Answering `{ compensationStarted: true }` there told the operator a
    // rollback had begun when nothing ran at all.
    const unscopableSagaId = "saga-test-unscopable-456";
    await seedFailedSaga(unscopableSagaId);

    const compensateHandler = routes.get("POST:/sagas/:sagaId/compensate");

    await expect(
      compensateHandler({ params: { sagaId: unscopableSagaId } }, passthroughReply)
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("unresolvable"),
    });
  });
});
