/**
 * @file PostCommandHandlers.publish.test.ts
 * @description Tests for PublishPostCommandHandler
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
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
import { POST_COMMANDS } from "@shared/types/cqrs.js";
import { randomUUID } from "crypto";

describe("PublishPostCommandHandler", () => {
  let handler: PublishPostCommandHandler;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestConfig();
    handler = new PublishPostCommandHandler(ctx.config);
  });

  it("should have correct command type", () => {
    expect(handler.commandType).toBe(POST_COMMANDS.PUBLISH_POST);
  });

  it("should prepare publishing jobs successfully", async () => {
    const command = buildPublishPostCommand({
      channelIds: [TEST_CHANNEL_ID_1, TEST_CHANNEL_ID_2],
      userId: "user-1",
    });

    const result = await handler.handle(command);

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();
    expect(Array.isArray(result.data.jobIds)).toBeTruthy();
    expect(result.data.jobIds.length).toBe(2);
  });

  it("should load post via postRepository.findById", async () => {
    const command = buildPublishPostCommand();
    await handler.handle(command);

    expect(ctx.postRepository.findByIdCalls.length >= 1).toBeTruthy();
  });

  it("should validate all channel IDs via channelRepository", async () => {
    const command = buildPublishPostCommand({
      channelIds: [TEST_CHANNEL_ID_1, TEST_CHANNEL_ID_2],
    });

    await handler.handle(command);

    // Channel validation calls findById for each channel
    expect(ctx.channelRepository.findByIdCalls.length >= 2).toBeTruthy();
  });

  it("should return error when post is not found", async () => {
    ctx.postRepository.shouldFail = true;

    const command = buildPublishPostCommand();
    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error.includes("not found") || result.error.includes("Post")).toBeTruthy();
  });

  it("should return error when post is already published", async () => {
    ctx.postRepository.mockAggregate = createMockPostAggregate({
      status: "PUBLISHED",
    });

    const command = buildPublishPostCommand();
    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error.includes("already published")).toBeTruthy();
  });

  it("should return error for invalid channel IDs", async () => {
    const unknownChannelId = randomUUID();
    const command = buildPublishPostCommand({
      channelIds: [unknownChannelId],
    });

    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error.includes("not found") || result.error.includes("Channel")).toBeTruthy();
  });

  it("should return error for invalid channel ID format", async () => {
    const command = buildPublishPostCommand({
      channelIds: ["not-a-uuid"],
    });

    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(
      result.error.includes("Invalid channel ID") || result.error.includes("channel")
    ).toBeTruthy();
  });

  it("should return error for invalid post ID format", async () => {
    const command = buildPublishPostCommand({
      aggregateId: "not-a-uuid",
    });

    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error.includes("Invalid post ID")).toBeTruthy();
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

    expect(result.success).toBe(false);
    // Schema validation should fail before reaching the repository
    expect(ctx.postRepository.findByIdCalls.length).toBe(0);
  });

  it("should generate scheduled events for each channel", async () => {
    const command = buildPublishPostCommand({
      channelIds: [TEST_CHANNEL_ID_1, TEST_CHANNEL_ID_2],
      userId: "user-1",
    });

    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    const scheduledEvents = result.events.filter(
      (e: { type: string }) => e.type === "post.scheduled"
    );
    expect(scheduledEvents.length).toBe(2);
  });

  it("should generate user.action event", async () => {
    const command = buildPublishPostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    expect(result.events.some((e: { type: string }) => e.type === "user.action")).toBeTruthy();
  });

  it("should handle different priority levels", async () => {
    const priorities = ["LOW", "NORMAL", "HIGH"] as const;

    for (const priority of priorities) {
      // Reset mocks for each iteration
      ctx = createTestConfig();
      handler = new PublishPostCommandHandler(ctx.config);

      const command = buildPublishPostCommand({ priority });
      const result = await handler.handle(command);

      expect(result.success).toBeTruthy();
    }
  });

  it("should invalidate cache on success", async () => {
    const command = buildPublishPostCommand();
    await handler.handle(command);

    const deletedKeys = ctx.redis.getDeletedKeys();
    expect(deletedKeys.length > 0).toBeTruthy();
  });
});
