import { describe, it, beforeEach, expect } from "vitest";
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

describe("UpdatePostCommandHandler", () => {
  let handler: UpdatePostCommandHandler;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestConfig();
    handler = new UpdatePostCommandHandler(ctx.config);
  });

  it("should have correct command type", () => {
    expect(handler.commandType).toBe(POST_COMMANDS.UPDATE_POST);
  });

  it("should update a post successfully when use case returns ok", async () => {
    const command = buildUpdatePostCommand({
      title: "Updated Title",
      body: "Updated body content",
      userId: "user-1",
    });

    const result = await handler.handle(command);

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();
    expect(result.data.version).toBe(2);
  });

  it("should delegate to updatePostUseCase.execute with correct input", async () => {
    const command = buildUpdatePostCommand({
      aggregateId: TEST_POST_ID,
      title: "New Title",
      body: "New body",
      tags: ["new-tag"],
    });

    await handler.handle(command);

    expect(ctx.updatePostUseCase.executeCalls.length).toBe(1);
    const input = ctx.updatePostUseCase.executeCalls[0] as Record<string, unknown>;
    expect(input.postId).toBe(TEST_POST_ID);
    expect(input.title).toBe("New Title");
    expect(input.body).toBe("New body");
    expect(input.tags).toStrictEqual(["new-tag"]);
  });

  it("should return error when use case fails with post not found", async () => {
    ctx.updatePostUseCase.shouldFail = true;
    ctx.updatePostUseCase.failMessage = "Post not found: non-existent";
    ctx.updatePostUseCase.failCode = USE_CASE_ERRORS.NOT_FOUND;

    const command = buildUpdatePostCommand({
      title: "Updated Title",
    });

    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error.includes("not found")).toBeTruthy();
  });

  it("should return error when use case fails with validation error", async () => {
    ctx.updatePostUseCase.shouldFail = true;
    ctx.updatePostUseCase.failMessage = "Post cannot be edited in current status: PUBLISHED";
    ctx.updatePostUseCase.failCode = USE_CASE_ERRORS.FORBIDDEN;

    const command = buildUpdatePostCommand({
      body: "Attempt update",
    });

    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(
      result.error.includes("cannot be edited") || result.error.includes("PUBLISHED")
    ).toBeTruthy();
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

    expect(result.success).toBe(false);
    // Schema validation should fail before reaching the use case
    expect(ctx.updatePostUseCase.executeCalls.length).toBe(0);
  });

  it("should update only title without body or tags", async () => {
    const command = buildUpdatePostCommand({
      title: "Title Only Update",
    });

    const result = await handler.handle(command);

    expect(result.success).toBeTruthy();
    expect(ctx.updatePostUseCase.executeCalls.length).toBe(1);

    const input = ctx.updatePostUseCase.executeCalls[0] as Record<string, unknown>;
    expect(input.title).toBe("Title Only Update");
    expect(input.body).toBe(undefined);
  });

  it("should generate post.updated event when changes are made", async () => {
    const command = buildUpdatePostCommand({
      title: "Updated Title",
      body: "Updated body",
      userId: "user-1",
    });

    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    expect(result.events.length > 0).toBeTruthy();
    expect(result.events.some((e: { type: string }) => e.type === "post.updated")).toBeTruthy();
  });

  it("should generate user.action event on successful update", async () => {
    const command = buildUpdatePostCommand({
      body: "Updated body",
      userId: "user-1",
    });

    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    expect(result.events.some((e: { type: string }) => e.type === "user.action")).toBeTruthy();
  });

  it("should invalidate cache after successful update with changes", async () => {
    const command = buildUpdatePostCommand({
      title: "Updated Title",
    });

    await handler.handle(command);

    const deletedKeys = ctx.redis.getDeletedKeys();
    expect(deletedKeys.length > 0).toBeTruthy();
  });

  it("should not generate events when no content fields are provided", async () => {
    // data is empty object (no title, body, or tags)
    const command = buildUpdatePostCommand({});

    const result = await handler.handle(command);

    expect(result.success).toBeTruthy();
    // When no changes, events array should be empty
    expect(result.events).toBeTruthy();
    expect(result.events.length).toBe(0);
  });
});
