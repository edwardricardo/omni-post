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

// Dropping the fields the reconciliation does not read is the design, and the
// handler must stay QUIET about it. Silence is only assertable by a case that can
// see the log, so the log is made readable from here and the absence of a warning
// is pinned. Only `createLogger` is overridden; the rest of the module keeps its
// real exports, because other importers in this graph read `logger` from it.
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
import { PUBLISH_STATUS } from "@core/domain/index.js";

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

  // The exclusion reason the record keeps per channel. It is DECLARED by the
  // contract even though no reader consumes it, because the channel object is
  // `.strict()`: an undeclared key does not slip through, it rejects the whole
  // command — so omitting it would refuse the very outcome the wait step sends.
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

    // Not forwarding it is the DESIGN, so the handler must also stay QUIET about it.
    // While the reconciliation was parked this seam warned once per command carrying
    // a code, because a producer had no other way to learn the value went nowhere.
    // The reconciliation now reads the RECORD the emitter projected that code from,
    // so nothing is lost and there is nothing to announce — and a warning that fired
    // on every partial publish would be telling the operator a defect was happening
    // while the design worked exactly as intended.
    it("stays silent about a reasonCode it does not forward — the record already holds it", async () => {
      await handler.handle(
        buildCompletePostPublishingCommand({
          channels: [
            { channelId: TEST_CHANNEL_ID_1, success: false, reasonCode: "CONTENT_REJECTED" },
            { channelId: TEST_CHANNEL_ID_2, success: false, reasonCode: "BUDGET_EXHAUSTED" },
          ],
        })
      );

      expect(logMocks.entries.filter((entry) => entry.level === "warn").length).toBe(0);
    });

    it("is not forwarded by this handler — the reconciliation reads it off the record", async () => {
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
    it("forwards every channel and its result, the OCC token, and none of the receipts", async () => {
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
      // `externalId` goes the way `reasonCode` and `error` go, and for the same
      // reason: the reconciliation loads the record those values were projected
      // from, so a copy on the input could only ever contradict it.
      expect(input.outcome).toStrictEqual({
        channels: [
          { channelId: TEST_CHANNEL_ID_1, success: true },
          { channelId: TEST_CHANNEL_ID_2, success: true },
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
      ctx.completePostPublishingUseCase.failMessage =
        "Post carries no publication record: its publication outcome cannot be established";
      ctx.completePostPublishingUseCase.failCode = USE_CASE_ERRORS.VALIDATION_FAILED;

      const result = await handler.handle(buildCompletePostPublishingCommand());

      expect(result.success).toBeFalsy();
      expect(result.error).toContain("no publication record");
    });

    it("forwards a NON-TOTAL reconciliation as a success, not as a refusal", async () => {
      // The seam that used to answer NOT_IMPLEMENTED here is gone: known
      // partiality is an outcome the record holds, and the handler must carry
      // it back as one.
      ctx.completePostPublishingUseCase.status = PUBLISH_STATUS.PARTIALLY_PUBLISHED;
      ctx.completePostPublishingUseCase.publishedAt = undefined;

      const result = await handler.handle(buildCompletePostPublishingCommand());

      expect(result.success).toBeTruthy();
      expect(result.data.applied).toBeTruthy();
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

    // The audit payload is the only externally visible trace a reconciliation
    // leaves, so both halves of its publication moment are pinned. The word is
    // recorded because it is no longer always PUBLISHED; the moment is recorded
    // ONLY when one was earned, because a row carrying a publication moment for a
    // post that did not publish everywhere reads as a publication that never
    // happened, and nothing downstream can tell it from one that did.
    it("audits the derived word and the publication moment when every channel published", async () => {
      ctx.completePostPublishingUseCase.applied = true;
      ctx.completePostPublishingUseCase.status = PUBLISH_STATUS.PUBLISHED;
      ctx.completePostPublishingUseCase.publishedAt = new Date("2024-03-04T05:06:07.000Z");

      const result = await handler.handle(buildCompletePostPublishingCommand());

      const details = (result.events?.[0]?.data as { details?: Record<string, unknown> }).details;
      expect(details).toStrictEqual({
        channelCount: 1,
        status: PUBLISH_STATUS.PUBLISHED,
        publishedAt: new Date("2024-03-04T05:06:07.000Z"),
      });
    });

    it("audits the derived word and OMITS the publication moment for a partial publish", async () => {
      ctx.completePostPublishingUseCase.applied = true;
      ctx.completePostPublishingUseCase.status = PUBLISH_STATUS.PARTIALLY_PUBLISHED;
      ctx.completePostPublishingUseCase.publishedAt = undefined;

      const result = await handler.handle(buildCompletePostPublishingCommand());

      const details = (result.events?.[0]?.data as { details?: Record<string, unknown> }).details;
      expect(details).toStrictEqual({
        channelCount: 1,
        status: PUBLISH_STATUS.PARTIALLY_PUBLISHED,
      });
      expect(details !== undefined && "publishedAt" in details).toBeFalsy();
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
