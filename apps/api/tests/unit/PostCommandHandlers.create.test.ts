import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
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

describe("CreatePostCommandHandler", { concurrency: 1 }, () => {
  let handler: CreatePostCommandHandler;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestConfig();
    handler = new CreatePostCommandHandler(ctx.config);
  });

  it("should have correct command type", () => {
    assert.strictEqual(handler.commandType, POST_COMMANDS.CREATE_POST);
  });

  it("should create a post successfully when use case returns ok", async () => {
    const command = buildCreatePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    assert.ok(result.success, "Result should be successful");
    assert.ok(result.data, "Result should contain data");
    assert.strictEqual(result.data.postId, TEST_POST_ID);
    assert.strictEqual(result.data.version, 1);
  });

  it("should delegate to createPostUseCase.execute with correct input", async () => {
    const command = buildCreatePostCommand({
      body: "My post body",
      title: "My Title",
      tags: ["tag1", "tag2"],
      locale: "en",
    });

    await handler.handle(command);

    assert.strictEqual(ctx.createPostUseCase.executeCalls.length, 1);
    const input = ctx.createPostUseCase.executeCalls[0] as Record<string, unknown>;
    assert.strictEqual(input.body, "My post body");
    assert.strictEqual(input.title, "My Title");
    assert.deepStrictEqual(input.tags, ["tag1", "tag2"]);
  });

  it("should validate channels via channelRepository before creating", async () => {
    const command = buildCreatePostCommand({
      channelIds: [TEST_CHANNEL_ID_1],
    });

    const result = await handler.handle(command);

    assert.ok(result.success, "Result should be successful");
    assert.ok(
      ctx.channelRepository.findByIdCalls.length >= 1,
      "Should have called channelRepository.findById"
    );
  });

  it("should return error for invalid channel ID format", async () => {
    const command = buildCreatePostCommand({
      channelIds: ["not-a-valid-uuid"],
    });

    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(
      result.error.includes("Invalid channel ID") || result.error.includes("channel"),
      `Expected channel-related error, got: ${result.error}`
    );
  });

  it("should return error when channel is not found in repository", async () => {
    const unknownChannelId = randomUUID();
    const command = buildCreatePostCommand({
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

  it("should return error when use case fails with validation error", async () => {
    ctx.createPostUseCase.shouldFail = true;
    ctx.createPostUseCase.failMessage = "Body cannot be empty";
    ctx.createPostUseCase.failCode = USE_CASE_ERRORS.VALIDATION_FAILED;

    const command = buildCreatePostCommand();
    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(
      result.error.includes("Body cannot be empty"),
      `Expected use case error message, got: ${result.error}`
    );
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

    assert.strictEqual(result.success, false);
    // Schema validation should fail before reaching the use case
    assert.strictEqual(ctx.createPostUseCase.executeCalls.length, 0);
  });

  it("should skip channel validation when channelIds is empty", async () => {
    const command = buildCreatePostCommand({ channelIds: [] });
    const result = await handler.handle(command);

    assert.ok(result.success, "Result should be successful");
    assert.strictEqual(
      ctx.channelRepository.findByIdCalls.length,
      0,
      "Should not call channelRepository when channelIds is empty"
    );
  });

  it("should generate post.created event on success", async () => {
    const command = buildCreatePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    assert.ok(result.events, "Should have events");
    assert.ok(result.events.length >= 1, "Should have at least 1 event");
    assert.ok(
      result.events.some((e: { type: string }) => e.type === "post.created"),
      "Should include post.created event"
    );
  });

  it("should generate post.scheduled event when scheduledAt is provided", async () => {
    const scheduledAt = new Date(Date.now() + 3600000);
    const command = buildCreatePostCommand({ scheduledAt });

    const result = await handler.handle(command);

    assert.ok(result.events, "Should have events");
    assert.ok(
      result.events.some((e: { type: string }) => e.type === "post.scheduled"),
      "Should include post.scheduled event"
    );
  });

  it("should generate user.action event on success", async () => {
    const command = buildCreatePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    assert.ok(result.events, "Should have events");
    assert.ok(
      result.events.some((e: { type: string }) => e.type === "user.action"),
      "Should include user.action event"
    );
  });

  it("should invalidate cache on success", async () => {
    const command = buildCreatePostCommand();
    await handler.handle(command);

    const deletedKeys = ctx.redis.getDeletedKeys();
    assert.ok(deletedKeys.length > 0, "Should have invalidated cache keys");
  });
});
