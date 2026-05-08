/**
 * @file RecurrenceScheduler.test.ts
 * @description Unit tests for RecurrenceScheduler — covers task registration,
 *              tick body (delegates to ProcessRecurrence + iterates results
 *              into CreatePostFromRecurrence), and graceful handling of
 *              upstream failures.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err } from "@shared/types";
import {
  RecurrenceScheduler,
  RECURRENCE_SCHEDULER_TASK_ID,
} from "../../../src/recurring/RecurrenceScheduler.js";
import { UseCaseError, USE_CASE_ERRORS } from "../../../src/application/UseCase.js";

function makeMockScheduler() {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    shutdownAll: vi.fn(),
  };
}

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeProcessRecurrence(processed: Array<Record<string, unknown>> = []) {
  return {
    execute: vi.fn(async () => ok({ processed, totalProcessed: processed.length })),
  };
}

function makeCreatePost(succeed = true) {
  return {
    execute: vi.fn(async () =>
      succeed
        ? ok({ postId: "new-post-id", scheduled: true })
        : err(new UseCaseError("clone failed", USE_CASE_ERRORS.INTERNAL_ERROR))
    ),
  };
}

describe("RecurrenceScheduler", () => {
  let scheduler: ReturnType<typeof makeMockScheduler>;
  let logger: ReturnType<typeof makeMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = makeMockScheduler();
    logger = makeMockLogger();
  });

  it("registers the tick with the BackgroundTaskScheduler on start()", () => {
    const processRec = makeProcessRecurrence();
    const createPost = makeCreatePost();
    const recScheduler = new RecurrenceScheduler(
      scheduler as never,
      processRec as never,
      createPost as never,
      logger as never
    );

    recScheduler.start();

    expect(scheduler.register).toHaveBeenCalledOnce();
    const [taskId, , intervalMs] = scheduler.register.mock.calls[0]!;
    expect(taskId).toBe(RECURRENCE_SCHEDULER_TASK_ID);
    expect(intervalMs).toBe(60_000);
  });

  it("unregisters the tick on stop()", () => {
    const recScheduler = new RecurrenceScheduler(
      scheduler as never,
      makeProcessRecurrence() as never,
      makeCreatePost() as never,
      logger as never
    );

    recScheduler.stop();

    expect(scheduler.unregister).toHaveBeenCalledWith(RECURRENCE_SCHEDULER_TASK_ID);
  });

  describe("tick", () => {
    it("delegates to CreatePostFromRecurrence for every due processed recurrence", async () => {
      const dueAt = new Date("2026-05-15T09:00:00Z");
      const processed = [
        {
          recurringPostId: "rec-1",
          templatePostId: "tmpl-1",
          projectId: "proj-1",
          channels: ["chan-1", "chan-2"],
          contentVariation: "EXACT",
          newOccurrenceCount: 1,
          deactivated: false,
          dueAt,
        },
        {
          recurringPostId: "rec-2",
          templatePostId: "tmpl-2",
          projectId: "proj-1",
          channels: ["chan-3"],
          contentVariation: "EXACT",
          newOccurrenceCount: 5,
          deactivated: true,
          dueAt,
        },
      ];
      const processRec = makeProcessRecurrence(processed);
      const createPost = makeCreatePost();
      const recScheduler = new RecurrenceScheduler(
        scheduler as never,
        processRec as never,
        createPost as never,
        logger as never
      );

      await recScheduler.tick();

      expect(processRec.execute).toHaveBeenCalledOnce();
      expect(createPost.execute).toHaveBeenCalledTimes(2);
      expect(createPost.execute).toHaveBeenNthCalledWith(1, {
        recurringPostId: "rec-1",
        templatePostId: "tmpl-1",
        projectId: "proj-1",
        channels: ["chan-1", "chan-2"],
        dueAt,
        contentVariation: "EXACT",
      });
    });

    it("no-ops cleanly when there are no due recurrences", async () => {
      const processRec = makeProcessRecurrence([]);
      const createPost = makeCreatePost();
      const recScheduler = new RecurrenceScheduler(
        scheduler as never,
        processRec as never,
        createPost as never,
        logger as never
      );

      await recScheduler.tick();

      expect(createPost.execute).not.toHaveBeenCalled();
    });

    it("logs a warn but does not throw when ProcessRecurrence fails", async () => {
      const processRec = {
        execute: vi.fn(async () =>
          err(new UseCaseError("DB blip", USE_CASE_ERRORS.INTERNAL_ERROR))
        ),
      };
      const createPost = makeCreatePost();
      const recScheduler = new RecurrenceScheduler(
        scheduler as never,
        processRec as never,
        createPost as never,
        logger as never
      );

      await expect(recScheduler.tick()).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
      expect(createPost.execute).not.toHaveBeenCalled();
    });

    it("counts created vs failed and continues on individual create failure", async () => {
      const dueAt = new Date("2026-05-15T09:00:00Z");
      const processed = [
        {
          recurringPostId: "rec-ok",
          templatePostId: "tmpl-ok",
          projectId: "proj-1",
          channels: ["chan-1"],
          contentVariation: "EXACT",
          newOccurrenceCount: 1,
          deactivated: false,
          dueAt,
        },
        {
          recurringPostId: "rec-fail",
          templatePostId: "tmpl-fail",
          projectId: "proj-1",
          channels: ["chan-2"],
          contentVariation: "EXACT",
          newOccurrenceCount: 1,
          deactivated: false,
          dueAt,
        },
      ];
      const processRec = makeProcessRecurrence(processed);
      const createPost = {
        execute: vi
          .fn()
          .mockResolvedValueOnce(ok({ postId: "new-1", scheduled: true }))
          .mockResolvedValueOnce(
            err(new UseCaseError("template missing", USE_CASE_ERRORS.NOT_FOUND))
          ),
      };
      const recScheduler = new RecurrenceScheduler(
        scheduler as never,
        processRec as never,
        createPost as never,
        logger as never
      );

      await recScheduler.tick();

      expect(createPost.execute).toHaveBeenCalledTimes(2);
      // The failure was logged + the loop continued.
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
