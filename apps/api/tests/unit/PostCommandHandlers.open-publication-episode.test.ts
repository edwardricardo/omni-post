/**
 * @file PostCommandHandlers.open-publication-episode.test.ts
 * @description Tests for OpenPublicationEpisodeCommandHandler — the command contract
 *              (strict data, a declared-but-optional channel set, a required
 *              publish-now flag), the mapping from the command's aggregate id and
 *              data onto the use case's input, the opened channels travelling back
 *              unchanged, the refusal code surviving the crossing, and the cache
 *              invalidation an episode opening owes the readers of the post.
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import "./PostCommandHandlers.test-helpers.js";
import {
  type TestContext,
  createTestConfig,
  buildOpenPublicationEpisodeCommand,
  TEST_POST_ID,
  TEST_PROJECT_ID,
  TEST_CHANNEL_ID_1,
  TEST_CHANNEL_ID_2,
} from "./PostCommandHandlers.test-helpers.js";
import {
  OpenPublicationEpisodeCommandHandler,
  createPostCommandHandlers,
} from "../../src/cqrs/handlers/PostCommandHandlers.js";
import { POST_COMMANDS } from "@shared/types/cqrs.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

describe("OpenPublicationEpisodeCommandHandler", () => {
  let handler: OpenPublicationEpisodeCommandHandler;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestConfig();
    handler = new OpenPublicationEpisodeCommandHandler(ctx.config);
  });

  it("answers the post.open-publication-episode command type", () => {
    expect(handler.commandType).toBe(POST_COMMANDS.OPEN_PUBLICATION_EPISODE);
    expect(POST_COMMANDS.OPEN_PUBLICATION_EPISODE).toBe("post.open-publication-episode");
  });

  it("is one of the handlers the factory registers, so the bus can route the command", () => {
    const types = createPostCommandHandlers(ctx.config).map((h) => h.commandType);

    expect(types).toContain(POST_COMMANDS.OPEN_PUBLICATION_EPISODE);
  });

  describe("command contract", () => {
    it("accepts a well-formed publish-now request naming one channel", async () => {
      const result = await handler.handle(
        buildOpenPublicationEpisodeCommand({ channelIds: [TEST_CHANNEL_ID_1] })
      );

      expect(result.success).toBeTruthy();
    });

    it("accepts a request that names no channel at all — the record's own set is opened", async () => {
      const result = await handler.handle(buildOpenPublicationEpisodeCommand());

      expect(result.success).toBeTruthy();
      const input = ctx.openPublicationEpisodeUseCase.executeCalls[0] as Record<string, unknown>;
      expect("channelIds" in input).toBeFalsy();
    });

    it("rejects an unknown key in data with unrecognized_keys rather than dropping it", async () => {
      const command = buildOpenPublicationEpisodeCommand();
      (command.data as Record<string, unknown>).status = "PUBLISHING";

      const result = await handler.handle(command);

      expect(result.success).toBeFalsy();
      expect(result.validationErrors?.some((e) => e.code === "unrecognized_keys")).toBeTruthy();
      expect(ctx.openPublicationEpisodeUseCase.executeCalls.length).toBe(0);
    });

    it("rejects a request with no enterPublishing flag — the mode is not guessable", async () => {
      const command = buildOpenPublicationEpisodeCommand();
      delete (command.data as Record<string, unknown>).enterPublishing;

      const result = await handler.handle(command);

      expect(result.success).toBeFalsy();
      expect(ctx.openPublicationEpisodeUseCase.executeCalls.length).toBe(0);
    });

    it("rejects an empty channel list at the schema boundary, before any load", async () => {
      const result = await handler.handle(buildOpenPublicationEpisodeCommand({ channelIds: [] }));

      expect(result.success).toBeFalsy();
      expect(ctx.openPublicationEpisodeUseCase.executeCalls.length).toBe(0);
    });

    it("rejects a channel id that is not a uuid, before any load", async () => {
      const result = await handler.handle(
        buildOpenPublicationEpisodeCommand({ channelIds: ["not-a-uuid"] })
      );

      expect(result.success).toBeFalsy();
      expect(ctx.openPublicationEpisodeUseCase.executeCalls.length).toBe(0);
    });
  });

  describe("delegation", () => {
    it("maps the aggregate id and the data onto the use case input, key for key", async () => {
      await handler.handle(
        buildOpenPublicationEpisodeCommand({
          aggregateId: TEST_POST_ID,
          channelIds: [TEST_CHANNEL_ID_1, TEST_CHANNEL_ID_2],
          enterPublishing: true,
        })
      );

      expect(ctx.openPublicationEpisodeUseCase.executeCalls.length).toBe(1);
      expect(ctx.openPublicationEpisodeUseCase.executeCalls[0]).toStrictEqual({
        postId: TEST_POST_ID,
        channelIds: [TEST_CHANNEL_ID_1, TEST_CHANNEL_ID_2],
        enterPublishing: true,
      });
    });

    it("forwards enterPublishing:false verbatim — a scheduled open is not a publish-now one", async () => {
      await handler.handle(buildOpenPublicationEpisodeCommand({ enterPublishing: false }));

      const input = ctx.openPublicationEpisodeUseCase.executeCalls[0] as Record<string, unknown>;
      expect(input.enterPublishing).toBe(false);
    });

    it("returns the opened channels the use case answered, unchanged", async () => {
      ctx.openPublicationEpisodeUseCase.opened = [
        { channelId: TEST_CHANNEL_ID_1, episode: 3 },
        { channelId: TEST_CHANNEL_ID_2, episode: 1 },
      ];

      const result = await handler.handle(buildOpenPublicationEpisodeCommand());

      expect(result.data?.postId).toBe(TEST_POST_ID);
      expect(result.data?.opened).toStrictEqual([
        { channelId: TEST_CHANNEL_ID_1, episode: 3 },
        { channelId: TEST_CHANNEL_ID_2, episode: 1 },
      ]);
    });

    it("reports the already-open answer and the status the use case read back", async () => {
      ctx.openPublicationEpisodeUseCase.alreadyOpen = true;
      ctx.openPublicationEpisodeUseCase.status = "PARTIALLY_PUBLISHED";

      const result = await handler.handle(buildOpenPublicationEpisodeCommand());

      expect(result.success).toBeTruthy();
      expect(result.data?.alreadyOpen).toBeTruthy();
      expect(result.data?.status).toBe("PARTIALLY_PUBLISHED");
    });

    it("passes the refusal code through unchanged, so the caller switches on it and never on the message", async () => {
      ctx.openPublicationEpisodeUseCase.shouldFail = true;
      ctx.openPublicationEpisodeUseCase.failMessage =
        "CHANNEL_HAS_LIVE_FRAGMENTS: the channel still holds 2 fragments";
      ctx.openPublicationEpisodeUseCase.failCode = USE_CASE_ERRORS.CONFLICT;

      const result = await handler.handle(buildOpenPublicationEpisodeCommand());

      expect(result.success).toBeFalsy();
      expect(result.code).toBe(USE_CASE_ERRORS.CONFLICT);
      expect(result.error).toContain("CHANNEL_HAS_LIVE_FRAGMENTS");
    });

    it("passes a validation refusal code through with the same mechanism", async () => {
      ctx.openPublicationEpisodeUseCase.shouldFail = true;
      ctx.openPublicationEpisodeUseCase.failCode = USE_CASE_ERRORS.VALIDATION_FAILED;

      const result = await handler.handle(buildOpenPublicationEpisodeCommand());

      expect(result.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("caches", () => {
    it("invalidates the post's read keys, because the record and the word may both have moved", async () => {
      await handler.handle(buildOpenPublicationEpisodeCommand());

      const deleted = ctx.redis.getDeletedKeys().join("|");
      expect(deleted).toContain(`post.get:${TEST_POST_ID}`);
      expect(deleted).toContain(`post.list:${TEST_PROJECT_ID}`);
      expect(deleted).toContain(`post.search:${TEST_PROJECT_ID}`);
      expect(deleted).toContain("dashboard:stats");
    });

    it("invalidates nothing when the episode was refused", async () => {
      ctx.openPublicationEpisodeUseCase.shouldFail = true;

      await handler.handle(buildOpenPublicationEpisodeCommand());

      expect(ctx.redis.getDeletedKeys().length).toBe(0);
    });

    it("emits no audit event — the step's caller is the saga and the record's own events travel by outbox", async () => {
      const result = await handler.handle(buildOpenPublicationEpisodeCommand());

      expect(result.events?.length).toBe(0);
    });
  });
});
