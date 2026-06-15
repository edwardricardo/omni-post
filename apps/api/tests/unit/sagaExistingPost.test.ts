/**
 * @file sagaExistingPost.test.ts
 * @description Verifies the existing-post path (publish/schedule a draft the
 *              caller already owns). The saga skips CreatePostStep, the
 *              compensation never deletes the user's draft, and the route
 *              schema rejects ambiguous bodies (postId + content together).
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { SagaIntegration } from "../../src/saga/SagaIntegration.js";
import { CreatePostStep, createSagaContext } from "@shared/types/saga.js";
import type { Command } from "@shared/types/cqrs.js";
import {
  buildIntegration,
  makeStartRequest,
  passthroughReply,
  TEST_CHANNEL_IDS,
  TEST_EXISTING_DRAFT_POST_ID,
  type MockCQRSBus,
  type MockRedis,
} from "./sagaIntegration.helpers.js";

describe("Saga — existing-post path (postId provided)", () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;
  let mockCQRSBus: MockCQRSBus;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    ({ integration, routes, mockCQRSBus, mockRedis } = await buildIntegration());
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("publish-now with postId starts the saga without creating a new post", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    expect(handler).toBeTruthy();

    const request = makeStartRequest({
      mode: "publish-now",
      channelIds: [TEST_CHANNEL_IDS[0]!],
    });
    // Override body to use existing-post path:
    request.body = {
      mode: "publish-now",
      projectId: request.body.projectId,
      postId: TEST_EXISTING_DRAFT_POST_ID,
      channelIds: [TEST_CHANNEL_IDS[0]!],
    };

    const result = await handler(request, passthroughReply);
    expect(result.success).toBeTruthy();

    // Allow saga steps to advance.
    await new Promise<void>((r) => setTimeout(r, 300));

    const sagaData = await mockRedis.get(`saga:${result.data.sagaId}`);
    expect(sagaData).toBeTruthy();
    const parsed = JSON.parse(sagaData!);

    // No post.create command should have been executed: the saga reused
    // the provided draft.
    const createCommands = mockCQRSBus.executedCommands.filter((c) => c.type === "post.create");
    expect(createCommands).toHaveLength(0);

    // metadata.postData carries the postId so the steps can find it.
    expect(parsed.context.metadata.postData.postId).toBe(TEST_EXISTING_DRAFT_POST_ID);
  });

  it("schedule with postId requires scheduledAt", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const request = makeStartRequest({ mode: "schedule" });
    request.body = {
      mode: "schedule",
      projectId: request.body.projectId,
      postId: TEST_EXISTING_DRAFT_POST_ID,
      channelIds: [TEST_CHANNEL_IDS[0]!],
      scheduledAt: futureIso,
    };

    const result = await handler(request, passthroughReply);
    expect(result.success).toBeTruthy();
    expect(result.data.mode).toBe("schedule");
  });

  it("rejects ambiguous body (postId AND content provided)", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");

    const request = makeStartRequest({ mode: "publish-now" });
    request.body = {
      mode: "publish-now",
      projectId: request.body.projectId,
      postId: TEST_EXISTING_DRAFT_POST_ID,
      locale: "en",
      body: "extra content",
      channelIds: [TEST_CHANNEL_IDS[0]!],
    };

    await expect(handler(request, passthroughReply)).rejects.toThrowError(
      /Invalid saga start body/
    );
  });

  it("rejects body with neither postId nor content", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");

    const request = makeStartRequest({ mode: "publish-now" });
    request.body = {
      mode: "publish-now",
      projectId: request.body.projectId,
      channelIds: [TEST_CHANNEL_IDS[0]!],
    };

    await expect(handler(request, passthroughReply)).rejects.toThrowError(
      /Invalid saga start body/
    );
  });

  it("rejects postId belonging to a different project (404 anti-IDOR)", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");

    const request = makeStartRequest({ mode: "publish-now" });
    request.body = {
      mode: "publish-now",
      projectId: request.body.projectId,
      // Random UUID — mock post repo only recognises TEST_EXISTING_DRAFT_POST_ID.
      postId: "99999999-9999-4999-8999-999999999999",
      channelIds: [TEST_CHANNEL_IDS[0]!],
    };

    await expect(handler(request, passthroughReply)).rejects.toThrowError(/Post not found/);
  });

  it("CreatePostStep skips creation and flags compensation when postId is provided", async () => {
    const executedCommands: Command[] = [];
    const step = new CreatePostStep(async (cmd: Command) => {
      executedCommands.push(cmd);
      return { success: true, data: { id: cmd.aggregateId, version: 1 } };
    });

    const ctx = createSagaContext("saga-existing-1", "corr-1", "user-1", {
      mode: "publish-now",
      postData: {
        postId: TEST_EXISTING_DRAFT_POST_ID,
        channelIds: [TEST_CHANNEL_IDS[0]!],
      },
    });
    ctx.stepData["validate-post-data"] = {
      validatedData: ctx.metadata.postData,
    };

    const result = await step.execute(ctx);

    expect(result.success).toBeTruthy();
    expect(executedCommands).toHaveLength(0);
    const stepData = ctx.stepData["create-post"] as {
      postId: string;
      skippedCreation: boolean;
    };
    expect(stepData.postId).toBe(TEST_EXISTING_DRAFT_POST_ID);
    expect(stepData.skippedCreation).toBe(true);
  });

  it("CreatePostStep compensation is a no-op when the saga reused an existing post", async () => {
    const executedCommands: Command[] = [];
    const step = new CreatePostStep(async (cmd: Command) => {
      executedCommands.push(cmd);
      return { success: true, data: {} };
    });

    const ctx = createSagaContext("saga-existing-2", "corr-2", "user-1", {
      mode: "publish-now",
      postData: { postId: TEST_EXISTING_DRAFT_POST_ID },
    });

    const result = await step.compensate?.(ctx, {
      postId: TEST_EXISTING_DRAFT_POST_ID,
      skippedCreation: true,
    });

    expect(result?.success).toBeTruthy();
    // Most importantly: NO post.delete command issued.
    const deleteCommands = executedCommands.filter((c) => c.type === "post.delete");
    expect(deleteCommands).toHaveLength(0);
  });
});
