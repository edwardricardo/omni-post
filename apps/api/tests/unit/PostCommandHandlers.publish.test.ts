import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./PostCommandHandlers.test-helpers.js";
import {
  type TestContext,
  createTestConfig,
  buildPublishPostCommand,
  createMockPostAggregate,
  TEST_POST_ID,
  TEST_CHANNEL_ID_1,
  TEST_CHANNEL_ID_2,
} from "./PostCommandHandlers.test-helpers.js";
import { PublishPostCommandHandler } from "../../src/cqrs/handlers/PostCommandHandlers.js";
import { POST_COMMANDS } from "@shared/cqrs";
import { randomUUID } from "crypto";

describe("PublishPostCommandHandler", { concurrency: 1 }, () => {
  let handler: PublishPostCommandHandler;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestConfig();
    handler = new PublishPostCommandHandler(ctx.config);
  });

  it("should have correct command type", () => {
    assert.strictEqual(handler.commandType, POST_COMMANDS.PUBLISH_POST);
  });

  it("should prepare publishing jobs successfully", async () => {
    const command = buildPublishPostCommand({
      channelIds: [TEST_CHANNEL_ID_1, TEST_CHANNEL_ID_2],
      userId: "user-1",
    });

    const result = await handler.handle(command);

    assert.ok(result.success, "Result should be successful");
    assert.ok(result.data, "Result should contain data");
    assert.ok(Array.isArray(result.data.jobIds), "jobIds should be an array");
    assert.strictEqual(result.data.jobIds.length, 2, "Should have one job per channel");
  });

  it("should load post via postRepository.findById", async () => {
    const command = buildPublishPostCommand();
    await handler.handle(command);

    assert.ok(
      ctx.postRepository.findByIdCalls.length >= 1,
      "Should have called postRepository.findById"
    );
  });

  it("should validate all channel IDs via channelRepository", async () => {
    const command = buildPublishPostCommand({
      channelIds: [TEST_CHANNEL_ID_1, TEST_CHANNEL_ID_2],
    });

    await handler.handle(command);

    // Channel validation calls findById for each channel
    assert.ok(ctx.channelRepository.findByIdCalls.length >= 2, "Should validate each channel ID");
  });

  it("should return error when post is not found", async () => {
    ctx.postRepository.shouldFail = true;

    const command = buildPublishPostCommand();
    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(
      result.error.includes("not found") || result.error.includes("Post"),
      `Expected not found error, got: ${result.error}`
    );
  });

  it("should return error when post is already published", async () => {
    ctx.postRepository.mockAggregate = createMockPostAggregate({
      status: "PUBLISHED",
    });

    const command = buildPublishPostCommand();
    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(
      result.error.includes("already published"),
      `Expected already published error, got: ${result.error}`
    );
  });

  it("should return error for invalid channel IDs", async () => {
    const unknownChannelId = randomUUID();
    const command = buildPublishPostCommand({
      channelIds: [unknownChannelId],
    });

    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(
      result.error.includes("not found") || result.error.includes("Channel"),
      `Expected channel not found error, got: ${result.error}`
    );
  });

  it("should return error for invalid channel ID format", async () => {
    const command = buildPublishPostCommand({
      channelIds: ["not-a-uuid"],
    });

    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(
      result.error.includes("Invalid channel ID") || result.error.includes("channel"),
      `Expected channel ID format error, got: ${result.error}`
    );
  });

  it("should return error for invalid post ID format", async () => {
    const command = buildPublishPostCommand({
      aggregateId: "not-a-uuid",
    });

    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(
      result.error.includes("Invalid post ID"),
      `Expected invalid post ID error, got: ${result.error}`
    );
  });

  it("should handle command schema validation failure", async () => {
    // Missing channelIds
    const invalidCommand = {
      id: "cmd-1",
      type: POST_COMMANDS.PUBLISH_POST,
      aggregateId: TEST_POST_ID,
      aggregateType: "Post",
      data: {
        // Missing: channelIds
        priority: "NORMAL",
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(invalidCommand);

    assert.strictEqual(result.success, false);
    // Schema validation should fail before reaching the repository
    assert.strictEqual(ctx.postRepository.findByIdCalls.length, 0);
  });

  it("should generate scheduled events for each channel", async () => {
    const command = buildPublishPostCommand({
      channelIds: [TEST_CHANNEL_ID_1, TEST_CHANNEL_ID_2],
      userId: "user-1",
    });

    const result = await handler.handle(command);

    assert.ok(result.events, "Should have events");
    const scheduledEvents = result.events.filter(
      (e: { type: string }) => e.type === "post.scheduled"
    );
    assert.strictEqual(scheduledEvents.length, 2, "Should have one scheduled event per channel");
  });

  it("should generate user.action event", async () => {
    const command = buildPublishPostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    assert.ok(result.events, "Should have events");
    assert.ok(
      result.events.some((e: { type: string }) => e.type === "user.action"),
      "Should include user.action event"
    );
  });

  it("should handle different priority levels", async () => {
    const priorities = ["LOW", "NORMAL", "HIGH"] as const;

    for (const priority of priorities) {
      // Reset mocks for each iteration
      ctx = createTestConfig();
      handler = new PublishPostCommandHandler(ctx.config);

      const command = buildPublishPostCommand({ priority });
      const result = await handler.handle(command);

      assert.ok(result.success, `Should succeed with priority ${priority}`);
    }
  });

  it("should invalidate cache on success", async () => {
    const command = buildPublishPostCommand();
    await handler.handle(command);

    const deletedKeys = ctx.redis.getDeletedKeys();
    assert.ok(deletedKeys.length > 0, "Should have invalidated cache keys");
  });
});
