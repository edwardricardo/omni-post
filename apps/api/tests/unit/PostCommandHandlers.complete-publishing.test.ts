/**
 * @file PostCommandHandlers.complete-publishing.test.ts
 * @description Tests for CompletePostPublishingCommandHandler — the command contract (strict
 *              data, a non-empty channel set), verbatim delegation of the outcome, the single
 *              audit event that fires only on an applied promotion, cache invalidation matching
 *              the update handler, and the REAL aggregate version coming back rather than a
 *              constant.
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect, vi } from "vitest";

// The handler's only externally visible act for a dropped `reasonCode` IS the log
// line, so the log has to be readable from here — a refusal whose whole effect is a
// log cannot be told from silence by a case that cannot see it. Only `createLogger`
// is overridden; the rest of the module keeps its real exports, because other
// importers in this graph read `logger` from it.
const logMocks = vi.hoisted(() => {
  const entries: Array<{ level: string; payload: Record<string, unknown>; message: string }> = [];
  const record =
    (level: string) =>
    (payload: unknown, message?: string): void => {
      entries.push({
        level,
        payload: (payload ?? {}) as Record<string, unknown>,
        message: message ?? "",
      });
    };
  const logger = {
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    debug: record("debug"),
    child: () => logger,
  };
  return { entries, logger };
});

vi.mock("../../src/lib/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/logger.js")>();
  return {
    ...actual,
    createLogger: () => logMocks.logger as unknown as ReturnType<typeof actual.createLogger>,
  };
});

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
import { POST_COMMANDS, CompletePostPublishingCommandSchema } from "@shared/types/cqrs.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

describe("CompletePostPublishingCommandHandler", () => {
  let handler: CompletePostPublishingCommandHandler;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestConfig();
    handler = new CompletePostPublishingCommandHandler(ctx.config);
    logMocks.entries.length = 0;
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

    // The two levels below `data` used to be open while `data` itself was strict,
    // so a key added to a CHANNEL — the level the emitter actually writes — was
    // stripped without a word. That is exactly how a `reasonCode` sent before the
    // contract declared it would have vanished: the emitter sees a parsed command
    // and the reader sees a field that never arrived. The promotion has ONE
    // production emitter, the saga's post-pivot step, so closing this rejects no
    // payload anything in the tree sends today.
    it("rejects an unknown key on a channel rather than silently dropping it", async () => {
      const command = buildCompletePostPublishingCommand();
      const channels = (command.data as { outcome: { channels: Record<string, unknown>[] } })
        .outcome.channels;
      channels[0]!.publishedAt = "2026-01-01T00:00:00.000Z";

      const result = await handler.handle(command);

      expect(result.success).toBeFalsy();
      expect(result.validationErrors?.some((e) => e.code === "unrecognized_keys")).toBeTruthy();
      expect(ctx.completePostPublishingUseCase.executeCalls.length).toBe(0);
    });

    it("rejects an unknown key beside the channel set rather than silently dropping it", async () => {
      const command = buildCompletePostPublishingCommand();
      (command.data as { outcome: Record<string, unknown> }).outcome.providerResults = {};

      const result = await handler.handle(command);

      expect(result.success).toBeFalsy();
      expect(result.validationErrors?.some((e) => e.code === "unrecognized_keys")).toBeTruthy();
      expect(ctx.completePostPublishingUseCase.executeCalls.length).toBe(0);
    });
  });

  // The exclusion reason the record keeps per channel. It is DECLARED here before
  // anything reads it, so the emitter and the contract move in one step rather than
  // two: an undeclared key is stripped by Zod without a word, which would let the
  // emitter believe it had sent a reason that never left the parser.
  describe("the additive reasonCode field", () => {
    it("is declared by the contract and survives parsing instead of being stripped", () => {
      const parsed = CompletePostPublishingCommandSchema.safeParse(
        buildCompletePostPublishingCommand({
          channels: [
            {
              channelId: TEST_CHANNEL_ID_1,
              success: false,
              error: "the provider rejected the content",
              reasonCode: "CONTENT_REJECTED",
            },
          ],
        })
      );

      expect(parsed.success).toBeTruthy();
      expect(parsed.data?.data.outcome.channels[0]?.reasonCode).toBe("CONTENT_REJECTED");
    });

    it("stays optional — a command that carries none still parses", () => {
      const parsed = CompletePostPublishingCommandSchema.safeParse(
        buildCompletePostPublishingCommand()
      );

      expect(parsed.success).toBeTruthy();
      expect(parsed.data?.data.outcome.channels[0]?.reasonCode).toBeUndefined();
    });

    // The reconciliation that reads the reason is parked (T1c.5), so THIS handler
    // still routes to the promotion use case, which has no field for it. The case
    // pins that the addition changed nothing here: it is a regression guard, and it
    // was green before the field existed as well as after.
    // The drop is deliberate, but a drop nobody can see is indistinguishable from a
    // field that was never sent. A producer wired before the reconciliation reader
    // lands would watch the value cross the parser and vanish at this seam with
    // nothing to read. The log is the discoverability, and it is asserted rather
    // than assumed because its entire effect IS the line.
    it("warns ONCE per command, naming how many codes it dropped and why", async () => {
      await handler.handle(
        buildCompletePostPublishingCommand({
          channels: [
            { channelId: TEST_CHANNEL_ID_1, success: false, reasonCode: "CONTENT_REJECTED" },
            { channelId: TEST_CHANNEL_ID_2, success: false, reasonCode: "BUDGET_EXHAUSTED" },
          ],
        })
      );

      const warnings = logMocks.entries.filter((entry) => entry.level === "warn");
      expect(warnings.length).toBe(1);
      expect(warnings[0]?.payload.droppedReasonCodes).toBe(2);
      expect(warnings[0]?.payload.postId).toBe(TEST_POST_ID);
      expect(warnings[0]?.message).toContain("reasonCode");
    });

    it("counts only the channels that carried one, not every channel in the outcome", async () => {
      await handler.handle(
        buildCompletePostPublishingCommand({
          channels: [
            { channelId: TEST_CHANNEL_ID_1, success: true },
            { channelId: TEST_CHANNEL_ID_2, success: false, reasonCode: "CONTENT_REJECTED" },
          ],
        })
      );

      const warnings = logMocks.entries.filter((entry) => entry.level === "warn");
      expect(warnings.length).toBe(1);
      expect(warnings[0]?.payload.droppedReasonCodes).toBe(1);
    });

    it("stays silent when no channel carried a reasonCode — nothing was dropped", async () => {
      await handler.handle(buildCompletePostPublishingCommand());

      expect(logMocks.entries.filter((entry) => entry.level === "warn").length).toBe(0);
    });

    it("is not forwarded by this handler — the promotion use case has no field for it yet", async () => {
      await handler.handle(
        buildCompletePostPublishingCommand({
          channels: [
            { channelId: TEST_CHANNEL_ID_1, success: false, reasonCode: "BUDGET_EXHAUSTED" },
          ],
        })
      );

      const input = ctx.completePostPublishingUseCase.executeCalls[0] as {
        outcome: { channels: Array<Record<string, unknown>> };
      };
      expect(input.outcome.channels[0]).toStrictEqual({
        channelId: TEST_CHANNEL_ID_1,
        success: false,
      });
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
      expect(result.data?.applied).toBeTruthy();
    });
  });

  describe("version, events and caches", () => {
    it("returns the REAL aggregate version the use case reported, never a constant", async () => {
      ctx.completePostPublishingUseCase.version = 37;

      const result = await handler.handle(buildCompletePostPublishingCommand());

      expect(result.data?.version).toBe(37);
      expect(result.data?.postId).toBe(TEST_POST_ID);
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
      expect(result.data?.applied).toBeFalsy();
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
