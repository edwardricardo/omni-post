/**
 * SagaIntegration -- Queue Integration Tests
 *
 * Validates that:
 * - Starting a saga causes the SchedulePublishingJobsStep to call
 *   the job-queue function with the correct payload, including sagaId.
 * - The enqueued job data carries the post, channel, account and sagaId fields.
 *
 * These tests exercise the integration between SagaIntegration, SagaManager,
 * and the SchedulePublishingJobsStep from @shared/saga.
 *
 * @file sagaIntegration.queue.test.ts
 * @description Tests for SagaIntegration - Queue Integration
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { untilValue } from "@packages/vitest-shared/determinism";
import { SagaIntegration } from "../../src/saga/SagaIntegration.js";
import {
  buildIntegration,
  makeStartRequest,
  passthroughReply,
  TEST_ACCOUNT_ID,
  TEST_CHANNEL_IDS,
  TEST_EXISTING_DRAFT_POST_ID,
  type MockEventService,
  type MockQueue,
  type MockRedis,
} from "./sagaIntegration.helpers.js";

/**
 * The queue double the integration enqueues on, reached through a documented cast: the harness
 * builds it inside `buildIntegration` and hands back no reference, and the integration keeps its
 * configuration private.
 */
function queueOf(integration: SagaIntegration): MockQueue {
  return (integration as unknown as { config: { queue: MockQueue } }).config.queue;
}

// Suppress verbose background-execution logs so they don't corrupt the TAP
// stream when this file runs as a subprocess in the full test suite.
console.log = () => {};
console.error = () => {};
console.warn = () => {};

/** The statuses a saga never leaves. */
const TERMINAL_STATUSES: readonly unknown[] = ["COMPLETED", "FAILED", "COMPENSATED"];

/**
 * Waits until the pass the start deferred has parked the saga, a retry scheduled or an ending
 * reached, and returns the record the hot cache then holds. Over these doubles the pass stops at
 * the pivot's reread check, because the post repository knows no post the create step made, and
 * schedules a retry that no scheduler fires, so the record no longer changes once parked.
 */
async function awaitParked(redis: MockRedis, sagaId: string): Promise<string> {
  return await untilValue(
    async () => {
      const cached = await redis.get(`saga:${sagaId}`);
      if (cached === null) return null;
      const record = JSON.parse(cached) as { status?: unknown; nextRetryAt?: unknown };
      const parked = record.nextRetryAt !== undefined || TERMINAL_STATUSES.includes(record.status);
      return parked ? cached : null;
    },
    {
      description: `the first pass over saga ${sagaId} to park it`,
      timeoutMs: 3_000,
      intervalMs: 5,
    }
  );
}

/**
 * Waits until every saga the test started is parked. Shutting down under a running pass leaves it
 * advancing against a stopped manager after the test ended, so no pass may outlive its test.
 */
async function awaitEverySagaParked(redis: MockRedis): Promise<void> {
  for (const key of await redis.keys("saga:*")) {
    await awaitParked(redis, key.slice("saga:".length));
  }
}

// ============================================================================
// Queue Integration Tests
// ============================================================================

describe("SagaIntegration - Queue Integration", () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;
  let mockEventService: MockEventService;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    ({ integration, routes, mockEventService, mockRedis } = await buildIntegration());
  });

  afterEach(async () => {
    await awaitEverySagaParked(mockRedis);
    await integration.shutdown();
  });

  it("should start a saga and transition through steps asynchronously", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    expect(handler).toBeTruthy();

    const request = makeStartRequest({
      body: "Queue integration test content",
      channelIds: [TEST_CHANNEL_IDS[0]!],
    });

    const result = await handler(request, passthroughReply);

    expect(result.success).toBeTruthy();
    expect(result.data.sagaId).toBeTruthy();

    // Verify the saga was persisted to Redis once its first pass ran
    const sagaData = await awaitParked(mockRedis, result.data.sagaId);
    expect(sagaData).toBeTruthy();

    const parsed = JSON.parse(sagaData);
    expect(["RUNNING", "COMPLETED", "FAILED"].includes(parsed.status)).toBeTruthy();
  });

  it("should emit saga started event containing the sagaId", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    expect(handler).toBeTruthy();

    const request = makeStartRequest({
      body: "Event emission test",
      channelIds: [TEST_CHANNEL_IDS[0]!],
    });

    const result = await handler(request, passthroughReply);

    // The start appends the event in the transaction it commits before the handler returns.
    const startedEvents = mockEventService.publishedEvents.filter((e) => e.type === "saga.started");

    expect(startedEvents.length > 0).toBeTruthy();

    const startedEvent = startedEvents[0];
    expect(startedEvent).toBeTruthy();
    expect(startedEvent.data.sagaId).toBe(result.data.sagaId);
    expect(startedEvent.data.definitionId).toBe("post-publishing-saga");
  });

  it("should include sagaId in the correlationId of the context", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    expect(handler).toBeTruthy();

    const request = makeStartRequest({
      body: "CorrelationId test",
      channelIds: [TEST_CHANNEL_IDS[0]!],
    });

    const result = await handler(request, passthroughReply);

    expect(result.data.correlationId).toBeTruthy();
    expect(result.data.correlationId.startsWith("post-publish-")).toBeTruthy();
  });

  it("should execute the validate-post-data step with channel data", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    expect(handler).toBeTruthy();

    const channelIds = [TEST_CHANNEL_IDS[0]!, TEST_CHANNEL_IDS[1]!, TEST_CHANNEL_IDS[2]!];
    const request = makeStartRequest({
      body: "Multi-channel test",
      channelIds,
    });

    const result = await handler(request, passthroughReply);

    const sagaData = await awaitParked(mockRedis, result.data.sagaId);
    expect(sagaData).toBeTruthy();

    const parsed = JSON.parse(sagaData);
    // The saga starts executing immediately, and the validate-post-data step
    // is the first step. If the saga advanced past step 0, the validation
    // succeeded.
    expect(parsed.currentStep >= 1 || parsed.status === "RUNNING").toBeTruthy();
  });

  it("should schedule publishing jobs with sagaId in the job payload", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    expect(handler).toBeTruthy();

    // The existing-draft path, because the pivot's reread check confirms the post is still a
    // DRAFT and the post repository double knows only that draft: a post the create step makes
    // cannot be reread there, so a from-scratch saga is refused at the pivot and enqueues nothing.
    const request = makeStartRequest({ channelIds: [TEST_CHANNEL_IDS[0]!] });
    request.body = {
      mode: "publish-now",
      projectId: request.body.projectId,
      postId: TEST_EXISTING_DRAFT_POST_ID,
      channelIds: [TEST_CHANNEL_IDS[0]!],
    };

    const result = await handler(request, passthroughReply);
    const sagaId = result.data.sagaId;
    const parsed = JSON.parse(await awaitParked(mockRedis, sagaId));

    // The pivot (step 2) enqueued one job for the one channel, and the saga moved on to the wait
    // step, where it parks on a retry because the queue double reports no job states.
    expect(parsed.stepResults[2]).toMatchObject({
      outcome: "succeeded",
      data: { channelCount: 1 },
    });
    expect(parsed.stepResults[2].data.jobIds).toHaveLength(1);
    expect(parsed.currentStep).toBe(3);
    expect(parsed.status).toBe("RUNNING");

    // The enqueued job carries the saga, so the worker can report its completion back to it.
    const queue = queueOf(integration);
    expect(queue.enqueuedJobs).toHaveLength(1);
    expect(queue.enqueuedJobs[0]).toMatchObject({
      id: parsed.stepResults[2].data.jobIds[0],
      payload: {
        type: "publish-post",
        sagaId,
        postId: TEST_EXISTING_DRAFT_POST_ID,
        channelId: TEST_CHANNEL_IDS[0],
        accountId: TEST_ACCOUNT_ID,
      },
    });
  });
});

// ============================================================================
// Queue Job Payload Shape Tests
// ============================================================================

describe("SagaIntegration - Job Payload Shape", () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    ({ integration, routes, mockRedis } = await buildIntegration());
  });

  afterEach(async () => {
    await awaitEverySagaParked(mockRedis);
    await integration.shutdown();
  });

  it("should pass postData through the saga context metadata", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    expect(handler).toBeTruthy();

    const request = makeStartRequest({
      body: "Payload shape test content",
      channelIds: [TEST_CHANNEL_IDS[0]!, TEST_CHANNEL_IDS[1]!],
    });

    const result = await handler(request, passthroughReply);

    // The start caches the saga, metadata included, before the handler returns.
    const sagaData = await mockRedis.get(`saga:${result.data.sagaId}`);
    expect(sagaData).toBeTruthy();

    const parsed = JSON.parse(sagaData);

    expect(parsed.context.metadata.postData).toBeTruthy();
    expect(parsed.context.metadata.postData.body).toBe("Payload shape test content");
    expect(parsed.context.metadata.postData.channelIds).toStrictEqual([
      TEST_CHANNEL_IDS[0],
      TEST_CHANNEL_IDS[1],
    ]);
    expect(parsed.context.metadata.mode).toBe("publish-now");
  });

  it("should set mode metadata for draft requests", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    expect(handler).toBeTruthy();

    const request = makeStartRequest({
      body: "Draft test content",
      mode: "draft",
    });

    const result = await handler(request, passthroughReply);

    // The start caches the saga, metadata included, before the handler returns.
    const sagaData = await mockRedis.get(`saga:${result.data.sagaId}`);
    expect(sagaData).toBeTruthy();

    const parsed = JSON.parse(sagaData);

    expect(parsed.context.metadata.mode).toBe("draft");
    expect(parsed.context.metadata.postData.channelIds).toBeUndefined();
  });
});
