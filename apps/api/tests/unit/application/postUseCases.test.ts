/**
 * @file postUseCases.test.ts
 * @description Unit tests for all 7 post use cases: Create, Update, Schedule, Delete, Get, List.
 * @layer application
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ok, err } from "@shared/types";
import {
  PostAggregate,
  ProjectId,
  PostId,
  ChannelId,
  AccountId,
  PUBLISH_STATUS,
} from "@core/domain/index.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import { CreatePostUseCase } from "@core/posts/CreatePostUseCase.js";
import { UpdatePostUseCase } from "@core/posts/UpdatePostUseCase.js";
import { SchedulePostUseCase } from "@core/posts/SchedulePostUseCase.js";
import { DeletePostUseCase, type DeletePostCaller } from "@core/posts/DeletePostUseCase.js";
import { GetPostUseCase } from "@core/posts/GetPostUseCase.js";
import { ListPostsUseCase } from "@core/posts/ListPostsUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// Mock business metrics — they call Prometheus which may not be initialized
vi.mock("../../../src/metrics/businessMetrics.js", () => ({
  incrementPostCreated: vi.fn(),
  incrementPostDeleted: vi.fn(),
  incrementPostPublished: vi.fn(),
}));

// --- Mock factories ---

function createMockPostRepository() {
  const store = new Map<string, PostAggregate>();
  return {
    store,
    findById: vi.fn(async (id: PostId) => {
      const post = store.get(id.value);
      if (!post) return err(new EntityNotFoundError("Post", id.value));
      return ok(post);
    }),
    save: vi.fn(async (post: PostAggregate) => {
      store.set(post.id.value, post);
      return ok(undefined);
    }),
    delete: vi.fn(async (id: PostId) => {
      if (!store.has(id.value)) return err(new EntityNotFoundError("Post", id.value));
      store.delete(id.value);
      return ok(undefined);
    }),
    findByProjectId: vi.fn(),
    findByStatus: vi.fn(),
    findReadyForPublishing: vi.fn(),
    findWithFilters: vi.fn(),
    countByProjectId: vi.fn(),
    countByStatus: vi.fn(),
    getProjectStats: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    hardDelete: vi.fn(),
    findOwnerAccountId: vi.fn(async (_id: PostId): Promise<AccountId | null> => null),
  };
}

function createMockEventDispatcher() {
  return {
    dispatch: vi.fn(async () => {}),
    dispatchAll: vi.fn(async () => {}),
    register: vi.fn(),
  };
}

function createMockBusinessMetrics() {
  return {
    incrementPostCreated: vi.fn(),
    incrementPostPublished: vi.fn(),
    incrementPostDeleted: vi.fn(),
  };
}

function createMockChannelRepository() {
  const channels = new Map<string, { id: string; name: string }>();
  return {
    channels,
    findById: vi.fn(async (id: ChannelId) => {
      const ch = channels.get(id.value);
      if (!ch) return err(new EntityNotFoundError("Channel", id.value));
      return ok(ch);
    }),
    save: vi.fn(),
    delete: vi.fn(),
    findByAccountId: vi.fn(),
  };
}

function createMockQueryRepository() {
  const store = new Map<string, any>();
  return {
    store,
    getById: vi.fn(async (id: PostId) => {
      const post = store.get(id.value);
      if (!post) return err(new EntityNotFoundError("Post", id.value));
      return ok(post);
    }),
    listByProject: vi.fn(
      async (_projId: ProjectId, pagination?: any, _sort?: any, _filter?: any) => {
        const items = Array.from(store.values());
        const page = pagination?.page ?? 1;
        const limit = Math.min(pagination?.limit ?? 20, 100);
        const total = items.length;
        const totalPages = Math.ceil(total / limit);
        const start = (page - 1) * limit;
        return {
          items: items.slice(start, start + limit),
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrevious: page > 1,
        };
      }
    ),
    search: vi.fn(),
    getUpcoming: vi.fn(),
    getRecentlyPublished: vi.fn(),
    getByIdWithThread: vi.fn(),
    listGlobal: vi.fn(),
  };
}

const TEST_PROJECT_ID = ProjectId.generate().value;

function validCreateInput(overrides?: Record<string, unknown>) {
  return {
    projectId: TEST_PROJECT_ID,
    body: "Test post body content",
    ...overrides,
  };
}

describe("CreatePostUseCase", () => {
  let useCase: CreatePostUseCase;
  let repo: ReturnType<typeof createMockPostRepository>;
  let dispatcher: ReturnType<typeof createMockEventDispatcher>;

  beforeEach(() => {
    repo = createMockPostRepository();
    dispatcher = createMockEventDispatcher();
    useCase = new CreatePostUseCase(repo as any, dispatcher as any, createMockBusinessMetrics());
  });

  describe("success", () => {
    it("creates a post with DRAFT status", async () => {
      const result = await useCase.execute(validCreateInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe(PUBLISH_STATUS.DRAFT);
      expect(result.value.body).toBe("Test post body content");
      expect(result.value.id).toBeTruthy();
    });

    it("persists the post in the repository", async () => {
      const result = await useCase.execute(validCreateInput());
      expect(result.ok).toBe(true);
      expect(repo.save).toHaveBeenCalledOnce();
    });

    it("dispatches domain events", async () => {
      await useCase.execute(validCreateInput());
      expect(dispatcher.dispatchAll).toHaveBeenCalledOnce();
    });

    it("returns projectId in output", async () => {
      const result = await useCase.execute(validCreateInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.projectId).toBe(TEST_PROJECT_ID);
    });

    it("creates with title when provided", async () => {
      const result = await useCase.execute(validCreateInput({ title: "My Title" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.title).toBe("My Title");
    });

    it("creates with tags when provided", async () => {
      const result = await useCase.execute(validCreateInput({ tags: ["a", "b"] }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tags).toEqual(["a", "b"]);
    });

    it("creates as SCHEDULED when scheduledAt provided", async () => {
      const future = new Date(Date.now() + 7_200_000);
      const result = await useCase.execute(validCreateInput({ scheduledAt: future }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe(PUBLISH_STATUS.SCHEDULED);
      expect(result.value.scheduledAt).toBeDefined();
    });

    it("returns createdAt timestamp", async () => {
      const result = await useCase.execute(validCreateInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("validation", () => {
    it("rejects invalid projectId", async () => {
      const result = await useCase.execute(validCreateInput({ projectId: "not-uuid" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("rejects empty body", async () => {
      const result = await useCase.execute(validCreateInput({ body: "" }));
      expect(result.ok).toBe(false);
    });
  });

  describe("error handling", () => {
    it("returns error when save fails", async () => {
      repo.save.mockResolvedValueOnce(err(new Error("DB error")));
      const result = await useCase.execute(validCreateInput());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });
});

describe("UpdatePostUseCase", () => {
  let useCase: UpdatePostUseCase;
  let repo: ReturnType<typeof createMockPostRepository>;
  let dispatcher: ReturnType<typeof createMockEventDispatcher>;
  let existingPost: PostAggregate;

  beforeEach(() => {
    repo = createMockPostRepository();
    dispatcher = createMockEventDispatcher();
    useCase = new UpdatePostUseCase(repo as any, dispatcher as any);

    const createResult = PostAggregate.create({
      projectId: ProjectId.fromStringUnsafe(TEST_PROJECT_ID),
      body: "Original body",
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    existingPost = createResult.value;
    repo.store.set(existingPost.id.value, existingPost);
  });

  describe("success", () => {
    it("updates body and returns updated DTO", async () => {
      const result = await useCase.execute({
        postId: existingPost.id.value,
        body: "Updated body",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.body).toBe("Updated body");
    });

    it("updates title", async () => {
      const result = await useCase.execute({
        postId: existingPost.id.value,
        title: "New Title",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.title).toBe("New Title");
    });

    it("updates tags", async () => {
      const result = await useCase.execute({
        postId: existingPost.id.value,
        tags: ["x", "y"],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tags).toEqual(["x", "y"]);
    });

    it("persists and dispatches events", async () => {
      await useCase.execute({ postId: existingPost.id.value, body: "New" });
      expect(repo.save).toHaveBeenCalled();
      expect(dispatcher.dispatchAll).toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("rejects invalid postId", async () => {
      const result = await useCase.execute({ postId: "not-uuid", body: "x" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("business rules", () => {
    it("rejects update on non-editable post (SCHEDULED)", async () => {
      existingPost.schedule(new Date(Date.now() + 3_600_000));
      const result = await useCase.execute({
        postId: existingPost.id.value,
        body: "Cannot update",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.FORBIDDEN);
    });
  });

  describe("error handling", () => {
    it("returns NOT_FOUND for non-existent post", async () => {
      const fakeId = PostId.generate().value;
      const result = await useCase.execute({ postId: fakeId, body: "x" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });
});

describe("SchedulePostUseCase", () => {
  let useCase: SchedulePostUseCase;
  let repo: ReturnType<typeof createMockPostRepository>;
  let dispatcher: ReturnType<typeof createMockEventDispatcher>;
  let channelRepo: ReturnType<typeof createMockChannelRepository>;
  let draftPost: PostAggregate;
  let channelId: string;

  beforeEach(() => {
    repo = createMockPostRepository();
    dispatcher = createMockEventDispatcher();
    channelRepo = createMockChannelRepository();
    useCase = new SchedulePostUseCase(
      repo as any,
      dispatcher as any,
      channelRepo as any,
      createMockBusinessMetrics()
    );

    const createResult = PostAggregate.create({
      projectId: ProjectId.fromStringUnsafe(TEST_PROJECT_ID),
      body: "Post to schedule",
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    draftPost = createResult.value;
    repo.store.set(draftPost.id.value, draftPost);

    channelId = ChannelId.generate().value;
    channelRepo.channels.set(channelId, { id: channelId, name: "Test Channel" });
  });

  describe("success", () => {
    it("schedules a draft post", async () => {
      const future = new Date(Date.now() + 7_200_000).toISOString();
      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: future,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe(PUBLISH_STATUS.SCHEDULED);
      expect(result.value.channelIds).toEqual([channelId]);
    });

    it("persists and dispatches events", async () => {
      const future = new Date(Date.now() + 7_200_000).toISOString();
      await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: future,
      });
      expect(repo.save).toHaveBeenCalled();
      expect(dispatcher.dispatchAll).toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("rejects invalid postId", async () => {
      const result = await useCase.execute({
        postId: "not-uuid",
        channelIds: [channelId],
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("rejects empty channelIds", async () => {
      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [],
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("rejects invalid date string", async () => {
      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: "not-a-date",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("rejects non-existent channel", async () => {
      const fakeChannelId = ChannelId.generate().value;
      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [fakeChannelId],
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("error handling", () => {
    it("returns NOT_FOUND for non-existent post", async () => {
      const fakePostId = PostId.generate().value;
      const result = await useCase.execute({
        postId: fakePostId,
        channelIds: [channelId],
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });
});

describe("DeletePostUseCase", () => {
  let useCase: DeletePostUseCase;
  let repo: ReturnType<typeof createMockPostRepository>;
  let draftPost: PostAggregate;

  // These behavior tests exercise the caller-agnostic delete mechanics (status
  // rules, validation, not-found). They use an explicit system caller so the
  // ownership gate is skipped — the gate itself is covered separately below.
  const SYSTEM_CALLER: DeletePostCaller = { type: "system", source: "unit-test" };

  beforeEach(() => {
    repo = createMockPostRepository();
    useCase = new DeletePostUseCase(repo as any, createMockBusinessMetrics());

    const createResult = PostAggregate.create({
      projectId: ProjectId.fromStringUnsafe(TEST_PROJECT_ID),
      body: "Post to delete",
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    draftPost = createResult.value;
    repo.store.set(draftPost.id.value, draftPost);
  });

  describe("success", () => {
    it("deletes a draft post", async () => {
      const result = await useCase.execute({ postId: draftPost.id.value, caller: SYSTEM_CALLER });
      expect(result.ok).toBe(true);
      expect(repo.delete).toHaveBeenCalled();
    });

    it("deletes a failed post", async () => {
      draftPost.startPublishing(["X"]);
      draftPost.markAsFailed("error", ["X"]);
      const result = await useCase.execute({ postId: draftPost.id.value, caller: SYSTEM_CALLER });
      expect(result.ok).toBe(true);
    });

    it("deletes a cancelled post", async () => {
      draftPost.cancel("no longer needed");
      const result = await useCase.execute({ postId: draftPost.id.value, caller: SYSTEM_CALLER });
      expect(result.ok).toBe(true);
    });
  });

  describe("business rules", () => {
    it("rejects deleting a SCHEDULED post", async () => {
      draftPost.schedule(new Date(Date.now() + 3_600_000));
      const result = await useCase.execute({ postId: draftPost.id.value, caller: SYSTEM_CALLER });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.FORBIDDEN);
    });

    it("rejects deleting a PUBLISHED post", async () => {
      draftPost.startPublishing(["X"]);
      draftPost.markAsPublished({ X: { success: true } });
      const result = await useCase.execute({ postId: draftPost.id.value, caller: SYSTEM_CALLER });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.FORBIDDEN);
    });
  });

  describe("validation", () => {
    it("rejects invalid postId", async () => {
      const result = await useCase.execute({ postId: "not-uuid", caller: SYSTEM_CALLER });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("error handling", () => {
    it("returns NOT_FOUND for non-existent post", async () => {
      const result = await useCase.execute({
        postId: PostId.generate().value,
        caller: SYSTEM_CALLER,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("ownership gate (CWE-639)", () => {
    const ownerAccount = AccountId.generate();

    it("returns NOT_FOUND and never deletes when the customer does not own the post", async () => {
      repo.findOwnerAccountId.mockResolvedValueOnce(ownerAccount);

      const result = await useCase.execute({
        postId: draftPost.id.value,
        caller: { type: "customer", accountId: AccountId.generate().value },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.delete).not.toHaveBeenCalled();
      // Gate runs before load — findById is never reached on a foreign id.
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when the post has no owner (findOwnerAccountId null)", async () => {
      repo.findOwnerAccountId.mockResolvedValueOnce(null);

      const result = await useCase.execute({
        postId: draftPost.id.value,
        caller: { type: "customer", accountId: ownerAccount.value },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("deletes when the customer owns the post", async () => {
      repo.findOwnerAccountId.mockResolvedValueOnce(ownerAccount);

      const result = await useCase.execute({
        postId: draftPost.id.value,
        caller: { type: "customer", accountId: ownerAccount.value },
      });

      expect(result.ok).toBe(true);
      expect(repo.delete).toHaveBeenCalled();
    });

    it("skips the gate for a system caller (findOwnerAccountId never consulted)", async () => {
      const result = await useCase.execute({
        postId: draftPost.id.value,
        caller: { type: "system", source: "PostPublishingSaga:Compensation" },
      });

      expect(result.ok).toBe(true);
      expect(repo.findOwnerAccountId).not.toHaveBeenCalled();
      expect(repo.delete).toHaveBeenCalled();
    });

    it("fails closed (throws) for an unknown caller variant", async () => {
      await expect(
        useCase.execute({
          postId: draftPost.id.value,
          caller: { type: "intruder" } as unknown as DeletePostCaller,
        })
      ).rejects.toThrow(/Unhandled delete caller type/);
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });
});

describe("GetPostUseCase", () => {
  let useCase: GetPostUseCase;
  let queryRepo: ReturnType<typeof createMockQueryRepository>;

  beforeEach(() => {
    queryRepo = createMockQueryRepository();
    useCase = new GetPostUseCase(queryRepo as any);
  });

  describe("success", () => {
    it("returns the post read model", async () => {
      const postId = PostId.generate().value;
      queryRepo.store.set(postId, {
        id: postId,
        projectId: TEST_PROJECT_ID,
        body: "Hello",
        status: "DRAFT",
        locale: "en",
        tags: [],
        mediaCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await useCase.execute({ postId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(postId);
      expect(result.value.body).toBe("Hello");
    });
  });

  describe("validation", () => {
    it("rejects invalid postId", async () => {
      const result = await useCase.execute({ postId: "bad-id" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("error handling", () => {
    it("returns NOT_FOUND for unknown post", async () => {
      const result = await useCase.execute({ postId: PostId.generate().value });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });
});

describe("ListPostsUseCase", () => {
  let useCase: ListPostsUseCase;
  let queryRepo: ReturnType<typeof createMockQueryRepository>;

  beforeEach(() => {
    queryRepo = createMockQueryRepository();
    useCase = new ListPostsUseCase(queryRepo as any);
  });

  describe("success", () => {
    it("returns paginated results", async () => {
      // Seed 3 posts
      for (let i = 0; i < 3; i++) {
        const id = PostId.generate().value;
        queryRepo.store.set(id, {
          id,
          projectId: TEST_PROJECT_ID,
          body: `Post ${i}`,
          status: "DRAFT",
          locale: "en",
          tags: [],
          mediaCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const result = await useCase.execute({ projectId: TEST_PROJECT_ID });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(3);
      expect(result.value.total).toBe(3);
    });

    it("respects page and limit parameters", async () => {
      for (let i = 0; i < 25; i++) {
        const id = PostId.generate().value;
        queryRepo.store.set(id, {
          id,
          projectId: TEST_PROJECT_ID,
          body: `Post ${i}`,
          status: "DRAFT",
          locale: "en",
          tags: [],
          mediaCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        page: 1,
        limit: 10,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(10);
      expect(result.value.hasNext).toBe(true);
      expect(result.value.totalPages).toBe(3);
    });

    it("caps limit at 100", async () => {
      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        limit: 500,
      });
      expect(result.ok).toBe(true);
      // The use case caps at 100, mock respects it
      expect(queryRepo.listByProject).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ limit: 100 }),
        undefined,
        undefined
      );
    });

    it("defaults page to 1 and limit to 20", async () => {
      await useCase.execute({ projectId: TEST_PROJECT_ID });
      expect(queryRepo.listByProject).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ page: 1, limit: 20 }),
        undefined,
        undefined
      );
    });
  });

  describe("validation", () => {
    it("rejects invalid projectId", async () => {
      const result = await useCase.execute({ projectId: "bad-id" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });
});
