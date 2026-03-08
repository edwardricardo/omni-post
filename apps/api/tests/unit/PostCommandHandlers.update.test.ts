import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./PostCommandHandlers.test-helpers.js";
import {
  type TestContext,
  createTestConfig,
  buildUpdatePostCommand,
  TEST_POST_ID,
} from "./PostCommandHandlers.test-helpers.js";
import { UpdatePostCommandHandler } from "../../src/cqrs/handlers/PostCommandHandlers.js";
import { POST_COMMANDS } from "@shared/cqrs";
import { USE_CASE_ERRORS } from "../../src/application/UseCase.js";

describe("UpdatePostCommandHandler", { concurrency: 1 }, () => {
  let handler: UpdatePostCommandHandler;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestConfig();
    handler = new UpdatePostCommandHandler(ctx.config);
  });

  it("should have correct command type", () => {
    assert.strictEqual(handler.commandType, POST_COMMANDS.UPDATE_POST);
  });

  it("should update a post successfully when use case returns ok", async () => {
    const command = buildUpdatePostCommand({
      title: "Updated Title",
      body: "Updated body content",
      userId: "user-1",
    });

    const result = await handler.handle(command);

    assert.ok(result.success, "Result should be successful");
    assert.ok(result.data, "Result should contain data");
    assert.strictEqual(result.data.version, 2);
  });

  it("should delegate to updatePostUseCase.execute with correct input", async () => {
    const command = buildUpdatePostCommand({
      aggregateId: TEST_POST_ID,
      title: "New Title",
      body: "New body",
      tags: ["new-tag"],
    });

    await handler.handle(command);

    assert.strictEqual(ctx.updatePostUseCase.executeCalls.length, 1);
    const input = ctx.updatePostUseCase.executeCalls[0] as Record<string, unknown>;
    assert.strictEqual(input.postId, TEST_POST_ID);
    assert.strictEqual(input.title, "New Title");
    assert.strictEqual(input.body, "New body");
    assert.deepStrictEqual(input.tags, ["new-tag"]);
  });

  it("should return error when use case fails with post not found", async () => {
    ctx.updatePostUseCase.shouldFail = true;
    ctx.updatePostUseCase.failMessage = "Post not found: non-existent";
    ctx.updatePostUseCase.failCode = USE_CASE_ERRORS.NOT_FOUND;

    const command = buildUpdatePostCommand({
      title: "Updated Title",
    });

    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error.includes("not found"), `Expected not found error, got: ${result.error}`);
  });

  it("should return error when use case fails with validation error", async () => {
    ctx.updatePostUseCase.shouldFail = true;
    ctx.updatePostUseCase.failMessage = "Post cannot be edited in current status: PUBLISHED";
    ctx.updatePostUseCase.failCode = USE_CASE_ERRORS.FORBIDDEN;

    const command = buildUpdatePostCommand({
      body: "Attempt update",
    });

    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(
      result.error.includes("cannot be edited") || result.error.includes("PUBLISHED"),
      `Expected forbidden error, got: ${result.error}`
    );
  });

  it("should handle command schema validation failure", async () => {
    // Wrong command type
    const invalidCommand = {
      id: "cmd-1",
      type: "post.wrong-type",
      aggregateId: TEST_POST_ID,
      aggregateType: "Post",
      data: {
        title: "Updated",
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
    assert.strictEqual(ctx.updatePostUseCase.executeCalls.length, 0);
  });

  it("should update only title without body or tags", async () => {
    const command = buildUpdatePostCommand({
      title: "Title Only Update",
    });

    const result = await handler.handle(command);

    assert.ok(result.success, "Result should be successful");
    assert.strictEqual(ctx.updatePostUseCase.executeCalls.length, 1);

    const input = ctx.updatePostUseCase.executeCalls[0] as Record<string, unknown>;
    assert.strictEqual(input.title, "Title Only Update");
    assert.strictEqual(input.body, undefined);
  });

  it("should generate post.updated event when changes are made", async () => {
    const command = buildUpdatePostCommand({
      title: "Updated Title",
      body: "Updated body",
      userId: "user-1",
    });

    const result = await handler.handle(command);

    assert.ok(result.events, "Should have events");
    assert.ok(result.events.length > 0, "Should have at least 1 event");
    assert.ok(
      result.events.some((e: { type: string }) => e.type === "post.updated"),
      "Should include post.updated event"
    );
  });

  it("should generate user.action event on successful update", async () => {
    const command = buildUpdatePostCommand({
      body: "Updated body",
      userId: "user-1",
    });

    const result = await handler.handle(command);

    assert.ok(result.events, "Should have events");
    assert.ok(
      result.events.some((e: { type: string }) => e.type === "user.action"),
      "Should include user.action event"
    );
  });

  it("should invalidate cache after successful update with changes", async () => {
    const command = buildUpdatePostCommand({
      title: "Updated Title",
    });

    await handler.handle(command);

    const deletedKeys = ctx.redis.getDeletedKeys();
    assert.ok(deletedKeys.length > 0, "Should have invalidated cache keys");
  });

  it("should not generate events when no content fields are provided", async () => {
    // data is empty object (no title, body, or tags)
    const command = buildUpdatePostCommand({});

    const result = await handler.handle(command);

    assert.ok(result.success, "Result should be successful");
    // When no changes, events array should be empty
    assert.ok(result.events, "Events array should exist");
    assert.strictEqual(result.events.length, 0, "Should not generate events without changes");
  });
});
