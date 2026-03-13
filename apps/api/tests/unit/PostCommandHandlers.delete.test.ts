import { describe, it, beforeEach, expect } from "vitest";
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

describe("DeletePostCommandHandler", () => {
  let handler: DeletePostCommandHandler;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestConfig();
    handler = new DeletePostCommandHandler(ctx.config);
  });

  it("should have correct command type", () => {
    expect(handler.commandType).toBe(POST_COMMANDS.DELETE_POST);
  });

  it("should delete a post successfully", async () => {
    const command = buildDeletePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();
    expect(result.data.deleted).toBe(true);
  });

  it("should load post via postRepository.findById before deleting", async () => {
    const command = buildDeletePostCommand();
    await handler.handle(command);

    expect(ctx.postRepository.findByIdCalls.length >= 1).toBeTruthy();
  });

  it("should delegate to deletePostUseCase.execute with correct postId", async () => {
    const command = buildDeletePostCommand({ aggregateId: TEST_POST_ID });
    await handler.handle(command);

    expect(ctx.deletePostUseCase.executeCalls.length).toBe(1);
    const input = ctx.deletePostUseCase.executeCalls[0] as Record<string, string>;
    expect(input.postId).toBe(TEST_POST_ID);
  });

  it("should return error when post is not found in repository", async () => {
    ctx.postRepository.shouldFail = true;

    const command = buildDeletePostCommand();
    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error.includes("not found") || result.error.includes("Post")).toBeTruthy();
    // Should NOT call the use case when post is not found in repo
    expect(ctx.deletePostUseCase.executeCalls.length).toBe(0);
  });

  it("should return error when use case fails", async () => {
    ctx.deletePostUseCase.shouldFail = true;
    ctx.deletePostUseCase.failMessage = "Cannot delete post in status: PUBLISHED";
    ctx.deletePostUseCase.failCode = USE_CASE_ERRORS.FORBIDDEN;

    const command = buildDeletePostCommand();
    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(
      result.error.includes("PUBLISHED") || result.error.includes("Cannot delete")
    ).toBeTruthy();
  });

  it("should return error for invalid post ID format", async () => {
    const command = buildDeletePostCommand({
      aggregateId: "not-a-valid-uuid",
    });

    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error.includes("Invalid post ID")).toBeTruthy();
    expect(ctx.postRepository.findByIdCalls.length).toBe(0);
    expect(ctx.deletePostUseCase.executeCalls.length).toBe(0);
  });

  it("should generate post.deleted event on success", async () => {
    const command = buildDeletePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    expect(result.events.some((e: { type: string }) => e.type === "post.deleted")).toBeTruthy();
  });

  it("should generate user.action event on success", async () => {
    const command = buildDeletePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    expect(result.events.some((e: { type: string }) => e.type === "user.action")).toBeTruthy();
  });

  it("should include previous status in the deleted event data", async () => {
    ctx.postRepository.mockAggregate = createMockPostAggregate({
      status: "DRAFT",
      media: [{ id: "media-1" }],
    });

    const command = buildDeletePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    const deletedEvent = result.events.find((e: { type: string }) => e.type === "post.deleted");
    expect(deletedEvent).toBeTruthy();
    expect(deletedEvent.data).toBeTruthy();
    expect(deletedEvent.data.previousStatus).toBe("DRAFT");
  });

  it("should invalidate cache on success", async () => {
    const command = buildDeletePostCommand();
    await handler.handle(command);

    const deletedKeys = ctx.redis.getDeletedKeys();
    expect(deletedKeys.length > 0).toBeTruthy();
  });
});
