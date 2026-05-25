/**
 * Application Layer - Post Use Cases Unit Tests
 *
 * Pure Tier 0 unit tests. Post use cases accept repositories via DI,
 * so we mock the PostRepository and PostQueryRepository interfaces.
 *
 * @file UseCases.test.ts
 * @description Tests for Post Use Cases
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { randomUUID } from "crypto";

import { ok, err } from "@shared/types";
import {
  CreatePostUseCase,
  GetPostUseCase,
  UpdatePostUseCase,
  ListPostsUseCase,
  DeletePostUseCase,
  USE_CASE_ERRORS,
} from "@core/application/index.js";
import { PostAggregate, ProjectId, EntityNotFoundError } from "@core/domain/index.js";
import type { PostRepository, PostQueryRepository, PostReadModel } from "@core/domain/index.js";
import type { EventDispatcher } from "@core/domain/events/DomainEvent.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_PROJECT_ID = "a0000000-0000-4000-8000-000000000001";

function createMockPostRepository(): PostRepository {
  return {
    findById: vi.fn(async () => err(new EntityNotFoundError("Post", "not-found"))),
    save: vi.fn(async () => ok(undefined)),
    delete: vi.fn(async () => ok(undefined)),
    findByProjectId: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    })),
    findByStatus: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    })),
    findReadyForPublishing: vi.fn(async () => []),
    findWithFilters: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    })),
    countByProjectId: vi.fn(async () => 0),
    countByStatus: vi.fn(async () => 0),
    getProjectStats: vi.fn(async () => ({
      total: 0,
      drafts: 0,
      scheduled: 0,
      published: 0,
      failed: 0,
    })),
    bulkUpdateStatus: vi.fn(async () => ok(undefined)),
    hardDelete: vi.fn(async () => ok(undefined)),
  };
}

function createMockQueryRepository(): PostQueryRepository {
  return {
    getById: vi.fn(async () => err(new EntityNotFoundError("Post", "not-found"))),
    listByProject: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    })),
    search: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    })),
    getUpcoming: vi.fn(async () => []),
    getRecentlyPublished: vi.fn(async () => []),
  };
}

function createMockEventDispatcher(): EventDispatcher {
  return {
    dispatch: vi.fn(async () => {}),
    dispatchAll: vi.fn(async () => {}),
    register: vi.fn(() => {}),
  };
}

function createMockBusinessMetrics() {
  return {
    incrementPostCreated: vi.fn(),
    incrementPostPublished: vi.fn(),
    incrementPostDeleted: vi.fn(),
  };
}

function makeReadModel(overrides: Partial<PostReadModel> = {}): PostReadModel {
  return {
    id: randomUUID(),
    projectId: TEST_PROJECT_ID,
    body: "Test body",
    status: "DRAFT",
    locale: "en",
    tags: [],
    mediaCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Post Use Cases", () => {
  let postRepo: PostRepository;
  let queryRepo: PostQueryRepository;
  let eventDispatcher: EventDispatcher;

  beforeEach(() => {
    postRepo = createMockPostRepository();
    queryRepo = createMockQueryRepository();
    eventDispatcher = createMockEventDispatcher();
  });

  describe("CreatePostUseCase", () => {
    it("should create a new draft post with body, title, and tags", async () => {
      const useCase = new CreatePostUseCase(postRepo, eventDispatcher, createMockBusinessMetrics());

      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        body: "Test post body",
        title: "Test Title",
        tags: ["test", "unit"],
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.body).toBe("Test post body");
      expect(result.value.title).toBe("Test Title");
      expect(result.value.tags).toEqual(["test", "unit"]);
      expect(result.value.status).toBe("DRAFT");
      expect(result.value.projectId).toBe(TEST_PROJECT_ID);
      // Verify repo.save was called
      expect((postRepo.save as any).mock.calls.length).toBe(1);
      // Verify events dispatched
      expect((eventDispatcher.dispatchAll as any).mock.calls.length).toBe(1);
    });

    it("should create a scheduled post when scheduledAt is in the future", async () => {
      const useCase = new CreatePostUseCase(postRepo, eventDispatcher, createMockBusinessMetrics());
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);

      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        body: "Scheduled post",
        scheduledAt: futureDate,
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.status).toBe("SCHEDULED");
      expect(result.value.scheduledAt).toBeTruthy();
    });

    it("should reject invalid project ID format", async () => {
      const useCase = new CreatePostUseCase(postRepo, eventDispatcher, createMockBusinessMetrics());

      const result = await useCase.execute({
        projectId: "invalid-id",
        body: "Test",
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(result.error.message).toMatch(/invalid project id/i);
    });

    it("should reject empty body", async () => {
      const useCase = new CreatePostUseCase(postRepo, eventDispatcher, createMockBusinessMetrics());

      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        body: "",
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("should return INTERNAL_ERROR when repository save fails", async () => {
      (postRepo.save as any).mockImplementation(async () =>
        err(new Error("Database connection lost"))
      );

      const useCase = new CreatePostUseCase(postRepo, eventDispatcher, createMockBusinessMetrics());

      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        body: "Will fail to save",
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });

  describe("GetPostUseCase", () => {
    it("should retrieve a post by ID from query repository", async () => {
      const postId = randomUUID();
      const readModel = makeReadModel({ id: postId, body: "Get test post", title: "Get Test" });

      (queryRepo.getById as any).mockImplementation(async () => ok(readModel));

      const useCase = new GetPostUseCase(queryRepo);
      const result = await useCase.execute({ postId });

      expect(result.ok).toBeTruthy();
      expect(result.value.id).toBe(postId);
      expect(result.value.body).toBe("Get test post");
      expect(result.value.title).toBe("Get Test");
    });

    it("should return NOT_FOUND for non-existent post", async () => {
      const useCase = new GetPostUseCase(queryRepo);

      const result = await useCase.execute({
        postId: "a0000000-0000-4000-8000-000000000000",
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });

    it("should reject invalid post ID format", async () => {
      const useCase = new GetPostUseCase(queryRepo);

      const result = await useCase.execute({ postId: "invalid-id" });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("UpdatePostUseCase", () => {
    it("should update an existing draft post", async () => {
      // Create a real PostAggregate to return from findById
      const projectId = ProjectId.fromStringUnsafe(TEST_PROJECT_ID);
      const createResult = PostAggregate.create({
        projectId,
        body: "Original body",
        title: "Original Title",
      });
      expect(createResult.ok).toBeTruthy();
      const post = createResult.value;
      post.clearDomainEvents(); // clear creation events

      (postRepo.findById as any).mockImplementation(async () => ok(post));

      const useCase = new UpdatePostUseCase(postRepo, eventDispatcher);
      const result = await useCase.execute({
        postId: post.id.value,
        body: "Updated body",
        title: "Updated Title",
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.body).toBe("Updated body");
      expect(result.value.title).toBe("Updated Title");
      // Verify save was called
      expect((postRepo.save as any).mock.calls.length).toBe(1);
    });

    it("should return NOT_FOUND for non-existent post", async () => {
      const useCase = new UpdatePostUseCase(postRepo, eventDispatcher);

      const result = await useCase.execute({
        postId: "a0000000-0000-4000-8000-000000000000",
        body: "New body",
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });

    it("should reject invalid post ID format", async () => {
      const useCase = new UpdatePostUseCase(postRepo, eventDispatcher);

      const result = await useCase.execute({
        postId: "not-a-valid-uuid",
        body: "Some body",
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("should return FORBIDDEN when post is not editable", async () => {
      const projectId = ProjectId.fromStringUnsafe(TEST_PROJECT_ID);
      const createResult = PostAggregate.create({
        projectId,
        body: "Published post",
      });
      expect(createResult.ok).toBeTruthy();
      const post = createResult.value;
      // Simulate a non-editable state by publishing through proper domain methods
      const publishingResult = post.startPublishing(["X"]);
      expect(publishingResult.ok).toBeTruthy();
      const publishedResult = post.markAsPublished({ x: { success: true, externalId: "ext-1" } });
      expect(publishedResult.ok).toBeTruthy();
      post.clearDomainEvents();

      (postRepo.findById as any).mockImplementation(async () => ok(post));

      const useCase = new UpdatePostUseCase(postRepo, eventDispatcher);
      const result = await useCase.execute({
        postId: post.id.value,
        body: "Should not update",
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.FORBIDDEN);
    });
  });

  describe("ListPostsUseCase", () => {
    it("should list posts for a project with pagination", async () => {
      const items = [makeReadModel({ body: "Post 1" }), makeReadModel({ body: "Post 2" })];
      (queryRepo.listByProject as any).mockImplementation(async () => ({
        items,
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      }));

      const useCase = new ListPostsUseCase(queryRepo);
      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        page: 1,
        limit: 10,
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.items.length).toBe(2);
      expect(result.value.total).toBe(2);
      expect(result.value.page).toBe(1);
      expect(result.value.limit).toBe(10);
      expect(result.value.hasNext).toBe(false);
      expect(result.value.hasPrevious).toBe(false);
      // All items belong to the test project
      for (const item of result.value.items) {
        expect(item.projectId).toBe(TEST_PROJECT_ID);
      }
    });

    it("should return paginated shape with totalPages and navigation flags", async () => {
      (queryRepo.listByProject as any).mockImplementation(async () => ({
        items: [makeReadModel()],
        total: 50,
        page: 2,
        limit: 20,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      }));

      const useCase = new ListPostsUseCase(queryRepo);
      const result = await useCase.execute({ projectId: TEST_PROJECT_ID, page: 2 });

      expect(result.ok).toBeTruthy();
      expect(result.value.totalPages).toBe(3);
      expect(result.value.hasNext).toBe(true);
      expect(result.value.hasPrevious).toBe(true);
    });

    it("should reject invalid project ID format", async () => {
      const useCase = new ListPostsUseCase(queryRepo);

      const result = await useCase.execute({ projectId: "invalid-id" });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("should cap limit to 100 even if caller requests more", async () => {
      (queryRepo.listByProject as any).mockImplementation(async () => ({
        items: [],
        total: 0,
        page: 1,
        limit: 100,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false,
      }));

      const useCase = new ListPostsUseCase(queryRepo);
      const result = await useCase.execute({ projectId: TEST_PROJECT_ID, limit: 500 });

      expect(result.ok).toBeTruthy();
      // The use case should have capped the limit to 100
      const callArgs = (queryRepo.listByProject as any).mock.calls[0];
      const pagination = callArgs?.[1] as { page: number; limit: number } | undefined;
      expect(pagination).toBeTruthy();
      expect(pagination.limit).toBe(100);
    });
  });

  describe("DeletePostUseCase", () => {
    it("should delete an existing draft post", async () => {
      const projectId = ProjectId.fromStringUnsafe(TEST_PROJECT_ID);
      const createResult = PostAggregate.create({
        projectId,
        body: "Post to delete",
      });
      expect(createResult.ok).toBeTruthy();
      const post = createResult.value;

      (postRepo.findById as any).mockImplementation(async () => ok(post));

      const useCase = new DeletePostUseCase(postRepo, createMockBusinessMetrics());
      const result = await useCase.execute({ postId: post.id.value });

      expect(result.ok).toBeTruthy();
      // Verify delete was called on the repository
      expect((postRepo.delete as any).mock.calls.length).toBe(1);
    });

    it("should return NOT_FOUND for non-existent post", async () => {
      const useCase = new DeletePostUseCase(postRepo, createMockBusinessMetrics());

      const result = await useCase.execute({
        postId: "a0000000-0000-4000-8000-000000000000",
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });

    it("should reject invalid post ID format", async () => {
      const useCase = new DeletePostUseCase(postRepo, createMockBusinessMetrics());

      const result = await useCase.execute({ postId: "not-a-valid-uuid" });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("should return FORBIDDEN when post is published and not cancelled", async () => {
      const projectId = ProjectId.fromStringUnsafe(TEST_PROJECT_ID);
      const createResult = PostAggregate.create({
        projectId,
        body: "Published post",
      });
      expect(createResult.ok).toBeTruthy();
      const post = createResult.value;
      const publishingResult = post.startPublishing(["X"]);
      expect(publishingResult.ok).toBeTruthy();
      const publishedResult = post.markAsPublished({ x: { success: true, externalId: "ext-1" } });
      expect(publishedResult.ok).toBeTruthy();

      (postRepo.findById as any).mockImplementation(async () => ok(post));

      const useCase = new DeletePostUseCase(postRepo, createMockBusinessMetrics());
      const result = await useCase.execute({ postId: post.id.value });

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.FORBIDDEN);
    });
  });
});
