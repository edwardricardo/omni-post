/**
 * @file PostCommandHandlers.create.test.ts
 * @description Tests for CreatePostCommandHandler. After the saga split, the
 *   handler is platform-agnostic: it creates a Post aggregate and returns
 *   { postId, version: 0 }. Channel validation, scheduling, and publishing
 *   are owned by downstream saga steps. Channel-specific test coverage lives
 *   in sagaIntegration.* tests.
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import "./PostCommandHandlers.test-helpers.js";
import {
  type TestContext,
  createTestConfig,
  buildCreatePostCommand,
  TEST_POST_ID,
} from "./PostCommandHandlers.test-helpers.js";
import { CreatePostCommandHandler } from "../../src/cqrs/handlers/PostCommandHandlers.js";
import { POST_COMMANDS } from "@shared/cqrs";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

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

  it("returns postId + version=0 when use case succeeds", async () => {
    const command = buildCreatePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();
    expect(result.data.postId).toBe(TEST_POST_ID);
    // Fresh Posts start at version 0 — the OCC seed propagated to the saga's
    // UpdatePostStatusStep as expectedVersion (Azure saga §15-20).
    expect(result.data.version).toBe(0);
  });

  it("delegates to createPostUseCase.execute with the platform-agnostic payload", async () => {
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
    expect(input.locale).toBe("en");
    // channelIds is NOT part of the create-time contract — the handler should
    // never forward it to the use case, even if a caller smuggles it in.
    expect("channelIds" in input).toBe(false);
    // scheduledAt is NOT part of the create-time contract either.
    expect("scheduledAt" in input).toBe(false);
  });

  it("does NOT call channelRepository (channel validation belongs to the saga)", async () => {
    const command = buildCreatePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.success).toBeTruthy();
    expect(ctx.channelRepository.findByIdCalls.length).toBe(0);
  });

  it("returns failure (no events) when the use case fails", async () => {
    ctx.createPostUseCase.shouldFail = true;
    ctx.createPostUseCase.failMessage = "Body cannot be empty";
    ctx.createPostUseCase.failCode = USE_CASE_ERRORS.VALIDATION_FAILED;

    const command = buildCreatePostCommand();
    const result = await handler.handle(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error.includes("Body cannot be empty")).toBeTruthy();
    // A failed command must not leak events.
    expect(result.events === undefined || result.events.length === 0).toBe(true);
  });

  it("rejects malformed commands at schema validation time", async () => {
    // Missing required field `body`.
    const invalidCommand = {
      id: "cmd-1",
      type: POST_COMMANDS.CREATE_POST,
      aggregateId: TEST_POST_ID,
      aggregateType: "Post",
      data: {
        projectId: "some-project",
        // Missing: body
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(invalidCommand);

    expect(result.success).toBe(false);
    // Schema validation should fail before reaching the use case.
    expect(ctx.createPostUseCase.executeCalls.length).toBe(0);
  });

  it("emits post.created event on success", async () => {
    const command = buildCreatePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    expect(result.events.length >= 1).toBeTruthy();
    expect(result.events.some((e: { type: string }) => e.type === "post.created")).toBeTruthy();
  });

  it("does NOT emit post.scheduled even when scheduledAt is in metadata (saga emits it)", async () => {
    const scheduledAt = new Date(Date.now() + 3600000);
    const command = buildCreatePostCommand({ scheduledAt });

    const result = await handler.handle(command);

    expect(result.success).toBeTruthy();
    expect(result.events).toBeTruthy();
    // post.scheduled is the responsibility of SchedulePublishingJobsStep — the
    // create handler must stay platform-agnostic.
    expect(result.events.some((e: { type: string }) => e.type === "post.scheduled")).toBe(false);
    expect(result.events.some((e: { type: string }) => e.type === "post.created")).toBe(true);
  });

  it("emits user.action event on success", async () => {
    const command = buildCreatePostCommand({ userId: "user-1" });
    const result = await handler.handle(command);

    expect(result.events).toBeTruthy();
    expect(result.events.some((e: { type: string }) => e.type === "user.action")).toBeTruthy();
  });

  it("invalidates query caches on success", async () => {
    const command = buildCreatePostCommand();
    await handler.handle(command);

    const deletedKeys = ctx.redis.getDeletedKeys();
    expect(deletedKeys.length > 0).toBeTruthy();
  });
});
