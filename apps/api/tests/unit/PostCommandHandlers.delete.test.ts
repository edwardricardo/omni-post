import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./PostCommandHandlers.test-helpers.js";
import {
  type TestContext,
  createTestConfig,
  buildDeletePostCommand,
  createMockPostAggregate,
  TEST_POST_ID,
} from "./PostCommandHandlers.test-helpers.js";
import { DeletePostCommandHandler } from "../../src/cqrs/handlers/PostCommandHandlers.js";
import { POST_COMMANDS } from "@shared/cqrs";
import { USE_CASE_ERRORS } from "../../src/application/UseCase.js";

describe("DeletePostCommandHandler", { concurrency: 1 }, () => {
  let handler: DeletePostCommandHandler;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestConfig();
    handler = new DeletePostCommandHandler(ctx.config);
  });

  it("should have correct command type", () => {
    assert.strictEqual(handler.commandType, POST_COMMANDS.DELETE_POST);
  });

  it("should delete a post successfully", async () => {
    const command = buildDeletePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    assert.ok(result.success, "Result should be successful");
    assert.ok(result.data, "Result should contain data");
    assert.strictEqual(result.data.deleted, true);
  });

  it("should load post via postRepository.findById before deleting", async () => {
    const command = buildDeletePostCommand();
    await handler.handle(command);

    assert.ok(
      ctx.postRepository.findByIdCalls.length >= 1,
      "Should have called postRepository.findById"
    );
  });

  it("should delegate to deletePostUseCase.execute with correct postId", async () => {
    const command = buildDeletePostCommand({ aggregateId: TEST_POST_ID });
    await handler.handle(command);

    assert.strictEqual(ctx.deletePostUseCase.executeCalls.length, 1);
    const input = ctx.deletePostUseCase.executeCalls[0] as Record<string, string>;
    assert.strictEqual(input.postId, TEST_POST_ID);
  });

  it("should return error when post is not found in repository", async () => {
    ctx.postRepository.shouldFail = true;

    const command = buildDeletePostCommand();
    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(
      result.error.includes("not found") || result.error.includes("Post"),
      `Expected not found error, got: ${result.error}`
    );
    // Should NOT call the use case when post is not found in repo
    assert.strictEqual(ctx.deletePostUseCase.executeCalls.length, 0);
  });

  it("should return error when use case fails", async () => {
    ctx.deletePostUseCase.shouldFail = true;
    ctx.deletePostUseCase.failMessage = "Cannot delete post in status: PUBLISHED";
    ctx.deletePostUseCase.failCode = USE_CASE_ERRORS.FORBIDDEN;

    const command = buildDeletePostCommand();
    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(
      result.error.includes("PUBLISHED") || result.error.includes("Cannot delete"),
      `Expected forbidden error, got: ${result.error}`
    );
  });

  it("should return error for invalid post ID format", async () => {
    const command = buildDeletePostCommand({
      aggregateId: "not-a-valid-uuid",
    });

    const result = await handler.handle(command);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(
      result.error.includes("Invalid post ID"),
      `Expected invalid post ID error, got: ${result.error}`
    );
    assert.strictEqual(ctx.postRepository.findByIdCalls.length, 0);
    assert.strictEqual(ctx.deletePostUseCase.executeCalls.length, 0);
  });

  it("should generate post.deleted event on success", async () => {
    const command = buildDeletePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    assert.ok(result.events, "Should have events");
    assert.ok(
      result.events.some((e: { type: string }) => e.type === "post.deleted"),
      "Should include post.deleted event"
    );
  });

  it("should generate user.action event on success", async () => {
    const command = buildDeletePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    assert.ok(result.events, "Should have events");
    assert.ok(
      result.events.some((e: { type: string }) => e.type === "user.action"),
      "Should include user.action event"
    );
  });

  it("should include previous status in the deleted event data", async () => {
    ctx.postRepository.mockAggregate = createMockPostAggregate({
      status: "DRAFT",
      media: [{ id: "media-1" }],
    });

    const command = buildDeletePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    assert.ok(result.events, "Should have events");
    const deletedEvent = result.events.find((e: { type: string }) => e.type === "post.deleted");
    assert.ok(deletedEvent, "Should have post.deleted event");
    assert.ok(deletedEvent.data, "Event should have data");
    assert.strictEqual(
      deletedEvent.data.previousStatus,
      "DRAFT",
      "Should include previousStatus from loaded post"
    );
  });

  it("should invalidate cache on success", async () => {
    const command = buildDeletePostCommand();
    await handler.handle(command);

    const deletedKeys = ctx.redis.getDeletedKeys();
    assert.ok(deletedKeys.length > 0, "Should have invalidated cache keys");
  });
});
