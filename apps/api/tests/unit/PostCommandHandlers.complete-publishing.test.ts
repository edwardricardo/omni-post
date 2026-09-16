/**
 * @file PostCommandHandlers.complete-publishing.test.ts
 * @description Tests for CompletePostPublishingCommandHandler — the command contract (strict
 *              data, a non-empty channel set), verbatim delegation of the outcome, the single
 *              audit event that fires only on an applied promotion, cache invalidation matching
 *              the update handler, and the REAL aggregate version coming back rather than a
 *              constant.
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import "./PostCommandHandlers.test-helpers.js";
import {
  type TestContext,
  createTestConfig,
  buildCompletePostPublishingCommand,
  TEST_POST_ID,
  TEST_PROJECT_ID,
  TEST_CHANNEL_ID_1,
  TEST_CHANNEL_ID_2,
} from "./PostCommandHandlers.test-helpers.js";
import { CompletePostPublishingCommandHandler } from "../../src/cqrs/handlers/PostCommandHandlers.js";
import { POST_COMMANDS } from "@shared/types/cqrs.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

describe("CompletePostPublishingCommandHandler", () => {
  let handler: CompletePostPublishingCommandHandler;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestConfig();
    handler = new CompletePostPublishingCommandHandler(ctx.config);
  });

  it("should have correct command type", () => {
    expect(handler.commandType).toBe(POST_COMMANDS.COMPLETE_PUBLISHING);
  });

  describe("command contract", () => {
    it("accepts a well-formed total-success outcome", async () => {
      const result = await handler.handle(buildCompletePostPublishingCommand());

      expect(result.success).toBeTruthy();
    });

    it("rejects an unknown key in data with unrecognized_keys rather than silently dropping it", async () => {
      const command = buildCompletePostPublishingCommand();
      (command.data as Record<string, unknown>).status = "PUBLISHED";

      const result = await handler.handle(command);

      expect(result.success).toBeFalsy();
      expect(result.validationErrors?.some((e) => e.code === "unrecognized_keys")).toBeTruthy();
      expect(ctx.completePostPublishingUseCase.executeCalls.length).toBe(0);
    });

    it("rejects an empty channel set at the schema boundary", async () => {
      const command = buildCompletePostPublishingCommand({ channels: [] });

      const result = await handler.handle(command);

      expect(result.success).toBeFalsy();
      expect(ctx.completePostPublishingUseCase.executeCalls.length).toBe(0);
    });
  });

  describe("delegation", () => {
    it("forwards the outcome verbatim, including per-channel receipts and the OCC token", async () => {
      const command = buildCompletePostPublishingCommand({
        aggregateId: TEST_POST_ID,
        channels: [
          { channelId: TEST_CHANNEL_ID_1, success: true, externalId: "x-1" },
          { channelId: TEST_CHANNEL_ID_2, success: true, externalId: "ig-1" },
        ],
        expectedVersion: 4,
      });

      await handler.handle(command);

      expect(ctx.completePostPublishingUseCase.executeCalls.length).toBe(1);
      const input = ctx.completePostPublishingUseCase.executeCalls[0] as Record<string, unknown>;
      expect(input.postId).toBe(TEST_POST_ID);
      expect(input.expectedVersion).toBe(4);
      expect(input.outcome).toStrictEqual({
        channels: [
          { channelId: TEST_CHANNEL_ID_1, success: true, externalId: "x-1" },
          { channelId: TEST_CHANNEL_ID_2, success: true, externalId: "ig-1" },
        ],
      });
    });

    it("omits expectedVersion when the command carries none — the reused-draft path fabricates no token", async () => {
      await handler.handle(buildCompletePostPublishingCommand());

      const input = ctx.completePostPublishingUseCase.executeCalls[0] as Record<string, unknown>;
      expect("expectedVersion" in input).toBeFalsy();
    });

    it("surfaces a refusal from the use case as a failed command result", async () => {
      ctx.completePostPublishingUseCase.shouldFail = true;
      ctx.completePostPublishingUseCase.failMessage = "Partial publish outcomes are not promoted";
      ctx.completePostPublishingUseCase.failCode = USE_CASE_ERRORS.NOT_IMPLEMENTED;

      const result = await handler.handle(buildCompletePostPublishingCommand());

      expect(result.success).toBeFalsy();
      expect(result.error).toContain("Partial publish outcomes are not promoted");
    });

    // The FSM origins (a CANCELLED post refused, a FAILED one promoted) are
    // decided by the use case and proven there
    // (`CompletePostPublishingUseCase.test.ts`). At this layer the only
    // observable is that whatever the use case decided travels back verbatim,
    // which is what this case exercises — the `version` half is owned by
    // "returns the REAL aggregate version" below.
    it("forwards an applied promotion as a successful result carrying applied:true", async () => {
      ctx.completePostPublishingUseCase.applied = true;

      const result = await handler.handle(buildCompletePostPublishingCommand());

      expect(result.success).toBeTruthy();
      expect(result.data.applied).toBeTruthy();
    });
  });

  describe("version, events and caches", () => {
    it("returns the REAL aggregate version the use case reported, never a constant", async () => {
      ctx.completePostPublishingUseCase.version = 37;

      const result = await handler.handle(buildCompletePostPublishingCommand());

      expect(result.data.version).toBe(37);
      expect(result.data.postId).toBe(TEST_POST_ID);
    });

    it("emits exactly one user-action audit event when the promotion applied", async () => {
      ctx.completePostPublishingUseCase.applied = true;

      const result = await handler.handle(buildCompletePostPublishingCommand());

      expect(result.events?.length).toBe(1);
      expect(result.events?.[0]?.type).toBe("user.action");
    });

    it("emits no event for an idempotent re-application — nothing happened to audit", async () => {
      ctx.completePostPublishingUseCase.applied = false;

      const result = await handler.handle(buildCompletePostPublishingCommand());

      expect(result.success).toBeTruthy();
      expect(result.data.applied).toBeFalsy();
      expect(result.events?.length).toBe(0);
    });

    it("invalidates the same cache keys the update handler does", async () => {
      ctx.completePostPublishingUseCase.applied = true;

      await handler.handle(buildCompletePostPublishingCommand());

      const deleted = ctx.redis.getDeletedKeys().join("|");
      expect(deleted).toContain(`post.get:${TEST_POST_ID}`);
      expect(deleted).toContain(`post.list:${TEST_PROJECT_ID}`);
      expect(deleted).toContain(`post.search:${TEST_PROJECT_ID}`);
      expect(deleted).toContain(`post.analytics:${TEST_POST_ID}`);
      expect(deleted).toContain("dashboard:stats");
    });

    it("invalidates nothing when the promotion did not apply", async () => {
      ctx.completePostPublishingUseCase.applied = false;

      await handler.handle(buildCompletePostPublishingCommand());

      expect(ctx.redis.getDeletedKeys().length).toBe(0);
    });
  });
});
