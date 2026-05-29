/**
 * @file CreatePostFromRecurrenceUseCase.test.ts
 * @description Unit tests for CreatePostFromRecurrenceUseCase — covers
 *              the EXACT-variation happy path, validation rejections,
 *              NOT_IMPLEMENTED for ROTATED/AI_GENERATED, template-not-found,
 *              and clone-then-schedule composition.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err } from "@shared/types";
import { CreatePostFromRecurrenceUseCase } from "@core/recurring/CreatePostFromRecurrenceUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { PostAggregate, PostId, ProjectId } from "@core/domain/index.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

vi.mock("../../../../src/metrics/businessMetrics.js", () => ({
  incrementPostCreated: vi.fn(),
  incrementPostDeleted: vi.fn(),
  incrementPostPublished: vi.fn(),
}));

function makeTemplatePost(): PostAggregate {
  const result = PostAggregate.create({
    projectId: ProjectId.generate(),
    body: "Weekly digest body",
    title: "Weekly digest",
    tags: ["weekly", "digest"],
  });
  if (!result.ok) throw new Error(`fixture: ${result.error.message}`);
  result.value.clearDomainEvents();
  return result.value;
}

function makeMockPostRepository(template?: PostAggregate) {
  const store = new Map<string, PostAggregate>();
  if (template) store.set(template.id.value, template);
  return {
    store,
    findById: vi.fn(async (id: PostId) => {
      const p = store.get(id.value);
      if (!p) return err(new EntityNotFoundError("Post", id.value));
      return ok(p);
    }),
    save: vi.fn(async (post: PostAggregate) => {
      store.set(post.id.value, post);
      return ok(undefined);
    }),
    delete: vi.fn(),
    findByProjectId: vi.fn(),
    findByStatus: vi.fn(),
    findReadyForPublishing: vi.fn(),
    findWithFilters: vi.fn(),
    countByProjectId: vi.fn(),
    countByStatus: vi.fn(),
    getProjectStats: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    bulkArchive: vi.fn(),
    bulkHardDelete: vi.fn(),
    hardDelete: vi.fn(),
  };
}

function makeMockDispatcher() {
  return {
    dispatch: vi.fn(async () => {}),
    dispatchAll: vi.fn(async () => {}),
    register: vi.fn(),
  };
}

function makeMockSchedule() {
  return {
    execute: vi.fn(async () => ok({ postId: "scheduled", status: "SCHEDULED" })),
  };
}

const VALID_INPUT = {
  recurringPostId: "rec-1",
  templatePostId: "", // filled per-test from the fixture
  projectId: "", // filled per-test
  channels: ["channel-1"],
  dueAt: new Date("2026-05-15T09:00:00Z"),
  contentVariation: "EXACT",
};

describe("CreatePostFromRecurrenceUseCase", () => {
  let template: PostAggregate;
  let postRepo: ReturnType<typeof makeMockPostRepository>;
  let dispatcher: ReturnType<typeof makeMockDispatcher>;
  let schedule: ReturnType<typeof makeMockSchedule>;
  let useCase: CreatePostFromRecurrenceUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    template = makeTemplatePost();
    postRepo = makeMockPostRepository(template);
    dispatcher = makeMockDispatcher();
    schedule = makeMockSchedule();
    useCase = new CreatePostFromRecurrenceUseCase(
      postRepo as never,
      dispatcher as never,
      schedule as never
    );
  });

  describe("validation", () => {
    it("rejects ROTATED variation as NOT_IMPLEMENTED", async () => {
      const result = await useCase.execute({
        ...VALID_INPUT,
        templatePostId: template.id.value,
        projectId: template.projectId.value,
        contentVariation: "ROTATED",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_IMPLEMENTED);
    });

    it("rejects AI_GENERATED variation as NOT_IMPLEMENTED", async () => {
      const result = await useCase.execute({
        ...VALID_INPUT,
        templatePostId: template.id.value,
        projectId: template.projectId.value,
        contentVariation: "AI_GENERATED",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_IMPLEMENTED);
    });

    it("rejects empty channels array", async () => {
      const result = await useCase.execute({
        ...VALID_INPUT,
        templatePostId: template.id.value,
        projectId: template.projectId.value,
        channels: [],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("rejects malformed templatePostId", async () => {
      const result = await useCase.execute({
        ...VALID_INPUT,
        templatePostId: "not-a-uuid",
        projectId: template.projectId.value,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("happy path", () => {
    it("clones template content + schedules with the recurrence channels + dueAt", async () => {
      const result = await useCase.execute({
        ...VALID_INPUT,
        templatePostId: template.id.value,
        projectId: template.projectId.value,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.scheduled).toBe(true);
      expect(result.value.postId).not.toBe(template.id.value);

      // The clone was saved (template + 1 clone = 2 store entries).
      expect(postRepo.store.size).toBe(2);
      const cloneEntry = Array.from(postRepo.store.entries()).find(
        ([id]) => id !== template.id.value
      );
      expect(cloneEntry).toBeDefined();
      const clone = cloneEntry![1];
      expect(clone.content.body).toBe(template.content.body);
      expect(clone.content.title).toBe(template.content.title);
      expect(clone.content.tags).toEqual(template.content.tags);

      // Domain events for creation were dispatched.
      expect(dispatcher.dispatchAll).toHaveBeenCalled();

      // SchedulePostUseCase received the new postId + channels + dueAt.
      expect(schedule.execute).toHaveBeenCalledWith({
        postId: clone.id.value,
        channelIds: VALID_INPUT.channels,
        scheduledFor: VALID_INPUT.dueAt.toISOString(),
      });
    });
  });

  describe("not-found", () => {
    it("returns NOT_FOUND when template doesn't exist", async () => {
      const ghostId = PostId.generate().value;
      const result = await useCase.execute({
        ...VALID_INPUT,
        templatePostId: ghostId,
        projectId: template.projectId.value,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(schedule.execute).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("surfaces save failure as INTERNAL_ERROR", async () => {
      postRepo.save.mockResolvedValueOnce(err(new Error("Disk full")));

      const result = await useCase.execute({
        ...VALID_INPUT,
        templatePostId: template.id.value,
        projectId: template.projectId.value,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(schedule.execute).not.toHaveBeenCalled();
    });

    it("surfaces SchedulePostUseCase failure as INTERNAL_ERROR", async () => {
      const innerErr = {
        code: USE_CASE_ERRORS.VALIDATION_FAILED,
        message: "Channel not found",
      };
      schedule.execute.mockResolvedValueOnce(err(innerErr) as never);

      const result = await useCase.execute({
        ...VALID_INPUT,
        templatePostId: template.id.value,
        projectId: template.projectId.value,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(result.error.message).toMatch(/Channel not found/);
    });
  });
});
