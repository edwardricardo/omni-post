/**
 * @file PostCommandHandlers.create.test.ts
 * @description Tests for CreatePostCommandHandler
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import "./PostCommandHandlers.test-helpers.js";
import {
  type TestContext,
  createTestConfig,
  buildCreatePostCommand,
  TEST_POST_ID,
  TEST_CHANNEL_ID_1,
} from "./PostCommandHandlers.test-helpers.js";
import { CreatePostCommandHandler } from "../../src/cqrs/handlers/PostCommandHandlers.js";
import { POST_COMMANDS } from "@shared/cqrs";
import { USE_CASE_ERRORS } from "../../src/application/UseCase.js";
import { randomUUID } from "crypto";

describe("CreatePostCommandHandler", () => {
  let handler: CreatePostCommandHandler;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestConfig();
    handler = new CreatePostCommandHandler(ctx.config);
  });

  it("should have correct command type", () => {
    expect(handler.commandType).toBe(POST_COMMANDS.CREATE_POST);
  });

  it("should create a post successfully when use case returns ok", async () => {
    const command = buildCreatePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();
    expect(result.data.postId).toBe(TEST_POST_ID);
    expect(result.data.version).toBe(1);
  });

  it("should delegate to createPostUseCase.execute with correct input", async () => {
    const command = buildCreatePostCommand({
      body: "My post body",
      title: "My Title",
      tags: ["tag1", "tag2"],
      locale: "en",
    });

    await handler.handle(command);

    expect(ctx.createPostUseCase.executeCalls.length).toBe(1);
    const input = ctx.createPostUseCase.executeCalls[0] as Record<string, unknown>;
    expect(input.body).toBe("My post body");
    expect(input.title).toBe("My Title");
    expect(input.tags).toStrictEqual(["tag1", "tag2"]);
  });

  it("should validate channels via channelRepository before creating", async () => {
    const command = buildCreatePostCommand({
      channelIds: [TEST_CHANNEL_ID_1],
    });

    const result = await handler.handle(command);

    expect(result.success).toBeTruthy();
    expect(ctx.channelRepository.findByIdCalls.length >= 1).toBeTruthy();
  });

  it("should return error for invalid channel ID format", async () => {
    const command = buildCreatePostCommand({
      channelIds: ["not-a-valid-uuid"],
    });

    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(
      result.error.includes("Invalid channel ID") || result.error.includes("channel")
    ).toBeTruthy();
  });

  it("should return error when channel is not found in repository", async () => {
    const unknownChannelId = randomUUID();
    const command = buildCreatePostCommand({
      channelIds: [unknownChannelId],
    });

    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error.includes("not found") || result.error.includes("Channel")).toBeTruthy();
  });

  it("should return error when use case fails with validation error", async () => {
    ctx.createPostUseCase.shouldFail = true;
    ctx.createPostUseCase.failMessage = "Body cannot be empty";
    ctx.createPostUseCase.failCode = USE_CASE_ERRORS.VALIDATION_FAILED;

    const command = buildCreatePostCommand();
    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error.includes("Body cannot be empty")).toBeTruthy();
  });

  it("should handle command schema validation failure", async () => {
    // Missing required fields (body, channelIds)
    const invalidCommand = {
      id: "cmd-1",
      type: POST_COMMANDS.CREATE_POST,
      aggregateId: TEST_POST_ID,
      aggregateType: "Post",
      data: {
        projectId: "some-project",
        // Missing: body, channelIds
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(invalidCommand);

    expect(result.success).toBe(false);
    // Schema validation should fail before reaching the use case
    expect(ctx.createPostUseCase.executeCalls.length).toBe(0);
  });

  it("should skip channel validation when channelIds is empty", async () => {
    const command = buildCreatePostCommand({ channelIds: [] });
    const result = await handler.handle(command);

    expect(result.success).toBeTruthy();
    expect(ctx.channelRepository.findByIdCalls.length).toBe(0);
  });

  it("should generate post.created event on success", async () => {
    const command = buildCreatePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    expect(result.events.length >= 1).toBeTruthy();
    expect(result.events.some((e: { type: string }) => e.type === "post.created")).toBeTruthy();
  });

  it("should generate post.scheduled event when scheduledAt is provided", async () => {
    const scheduledAt = new Date(Date.now() + 3600000);
    const command = buildCreatePostCommand({ scheduledAt });

    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    expect(result.events.some((e: { type: string }) => e.type === "post.scheduled")).toBeTruthy();
  });

  it("should generate user.action event on success", async () => {
    const command = buildCreatePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    expect(result.events.some((e: { type: string }) => e.type === "user.action")).toBeTruthy();
  });

  it("should invalidate cache on success", async () => {
    const command = buildCreatePostCommand();
    await handler.handle(command);

    const deletedKeys = ctx.redis.getDeletedKeys();
    expect(deletedKeys.length > 0).toBeTruthy();
  });
});
