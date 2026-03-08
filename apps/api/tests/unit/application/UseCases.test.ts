/**
 * Application Layer - Post Use Cases Unit Tests
 *
 * Pure Tier 0 unit tests. Post use cases accept repositories via DI,
 * so we mock the PostRepository and PostQueryRepository interfaces.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

import { ok, err } from "@shared/types";
import {
  CreatePostUseCase,
  GetPostUseCase,
  UpdatePostUseCase,
  ListPostsUseCase,
  DeletePostUseCase,
  USE_CASE_ERRORS,
} from "../../../src/application/index.js";
import { PostAggregate, ProjectId, EntityNotFoundError } from "../../../src/domain/index.js";
import type {
  PostRepository,
  PostQueryRepository,
  PostReadModel,
} from "../../../src/domain/index.js";
import type { EventDispatcher } from "../../../src/domain/events/DomainEvent.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_PROJECT_ID = "a0000000-0000-4000-8000-000000000001";

function createMockPostRepository(t: TestContext): PostRepository {
  return {
    findById: t.mock.fn(async () => err(new EntityNotFoundError("Post", "not-found"))),
    save: t.mock.fn(async () => ok(undefined)),
    delete: t.mock.fn(async () => ok(undefined)),
    findByProjectId: t.mock.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    })),
    findByStatus: t.mock.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    })),
    findReadyForPublishing: t.mock.fn(async () => []),
    findWithFilters: t.mock.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    })),
    countByProjectId: t.mock.fn(async () => 0),
    countByStatus: t.mock.fn(async () => 0),
    getProjectStats: t.mock.fn(async () => ({
      total: 0,
      drafts: 0,
      scheduled: 0,
      published: 0,
      failed: 0,
    })),
    bulkUpdateStatus: t.mock.fn(async () => ok(undefined)),
    hardDelete: t.mock.fn(async () => ok(undefined)),
  };
}

function createMockQueryRepository(t: TestContext): PostQueryRepository {
  return {
    getById: t.mock.fn(async () => err(new EntityNotFoundError("Post", "not-found"))),
    listByProject: t.mock.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    })),
    search: t.mock.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    })),
    getUpcoming: t.mock.fn(async () => []),
    getRecentlyPublished: t.mock.fn(async () => []),
  };
}

function createMockEventDispatcher(t: TestContext): EventDispatcher {
  return {
    dispatch: t.mock.fn(async () => {}),
    dispatchAll: t.mock.fn(async () => {}),
    register: t.mock.fn(() => {}),
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

describe("Post Use Cases", { concurrency: 1 }, () => {
  let postRepo: PostRepository;
  let queryRepo: PostQueryRepository;
  let eventDispatcher: EventDispatcher;

  beforeEach((t) => {
    postRepo = createMockPostRepository(t);
    queryRepo = createMockQueryRepository(t);
    eventDispatcher = createMockEventDispatcher(t);
  });

  describe("CreatePostUseCase", { concurrency: 1 }, () => {
    it("should create a new draft post with body, title, and tags", async () => {
      const useCase = new CreatePostUseCase(postRepo, eventDispatcher);

      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        body: "Test post body",
        title: "Test Title",
        tags: ["test", "unit"],
      });

      assert.ok(result.ok, "Should create post successfully");
      assert.equal(result.value.body, "Test post body");
      assert.equal(result.value.title, "Test Title");
      assert.deepEqual(result.value.tags, ["test", "unit"]);
      assert.equal(result.value.status, "DRAFT");
      assert.equal(result.value.projectId, TEST_PROJECT_ID);
      // Verify repo.save was called
      assert.equal(
        (postRepo.save as any).mock.calls.length,
        1,
        "Should persist post via repository"
      );
      // Verify events dispatched
      assert.equal(
        (eventDispatcher.dispatchAll as any).mock.calls.length,
        1,
        "Should dispatch domain events"
      );
    });

    it("should create a scheduled post when scheduledAt is in the future", async () => {
      const useCase = new CreatePostUseCase(postRepo, eventDispatcher);
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);

      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        body: "Scheduled post",
        scheduledAt: futureDate,
      });

      assert.ok(result.ok);
      assert.equal(result.value.status, "SCHEDULED");
      assert.ok(result.value.scheduledAt);
    });

    it("should reject invalid project ID format", async () => {
      const useCase = new CreatePostUseCase(postRepo, eventDispatcher);

      const result = await useCase.execute({
        projectId: "invalid-id",
        body: "Test",
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.match(result.error.message, /invalid project id/i);
    });

    it("should reject empty body", async () => {
      const useCase = new CreatePostUseCase(postRepo, eventDispatcher);

      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        body: "",
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("should return INTERNAL_ERROR when repository save fails", async () => {
      (postRepo.save as any).mock.mockImplementation(async () =>
        err(new Error("Database connection lost"))
      );

      const useCase = new CreatePostUseCase(postRepo, eventDispatcher);

      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        body: "Will fail to save",
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });

  describe("GetPostUseCase", { concurrency: 1 }, () => {
    it("should retrieve a post by ID from query repository", async () => {
      const postId = randomUUID();
      const readModel = makeReadModel({ id: postId, body: "Get test post", title: "Get Test" });

      (queryRepo.getById as any).mock.mockImplementation(async () => ok(readModel));

      const useCase = new GetPostUseCase(queryRepo);
      const result = await useCase.execute({ postId });

      assert.ok(result.ok);
      assert.equal(result.value.id, postId);
      assert.equal(result.value.body, "Get test post");
      assert.equal(result.value.title, "Get Test");
    });

    it("should return NOT_FOUND for non-existent post", async () => {
      const useCase = new GetPostUseCase(queryRepo);

      const result = await useCase.execute({
        postId: "a0000000-0000-4000-8000-000000000000",
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });

    it("should reject invalid post ID format", async () => {
      const useCase = new GetPostUseCase(queryRepo);

      const result = await useCase.execute({ postId: "invalid-id" });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("UpdatePostUseCase", { concurrency: 1 }, () => {
    it("should update an existing draft post", async () => {
      // Create a real PostAggregate to return from findById
      const projectId = ProjectId.fromStringUnsafe(TEST_PROJECT_ID);
      const createResult = PostAggregate.create({
        projectId,
        body: "Original body",
        title: "Original Title",
      });
      assert.ok(createResult.ok);
      const post = createResult.value;
      post.clearDomainEvents(); // clear creation events

      (postRepo.findById as any).mock.mockImplementation(async () => ok(post));

      const useCase = new UpdatePostUseCase(postRepo, eventDispatcher);
      const result = await useCase.execute({
        postId: post.id.value,
        body: "Updated body",
        title: "Updated Title",
      });

      assert.ok(result.ok, `Expected ok but got: ${!result.ok ? result.error.message : ""}`);
      assert.equal(result.value.body, "Updated body");
      assert.equal(result.value.title, "Updated Title");
      // Verify save was called
      assert.equal((postRepo.save as any).mock.calls.length, 1);
    });

    it("should return NOT_FOUND for non-existent post", async () => {
      const useCase = new UpdatePostUseCase(postRepo, eventDispatcher);

      const result = await useCase.execute({
        postId: "a0000000-0000-4000-8000-000000000000",
        body: "New body",
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });

    it("should reject invalid post ID format", async () => {
      const useCase = new UpdatePostUseCase(postRepo, eventDispatcher);

      const result = await useCase.execute({
        postId: "not-a-valid-uuid",
        body: "Some body",
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("should return FORBIDDEN when post is not editable", async () => {
      const projectId = ProjectId.fromStringUnsafe(TEST_PROJECT_ID);
      const createResult = PostAggregate.create({
        projectId,
        body: "Published post",
      });
      assert.ok(createResult.ok);
      const post = createResult.value;
      // Simulate a non-editable state by publishing through proper domain methods
      const publishingResult = post.startPublishing(["X"]);
      assert.ok(publishingResult.ok, "Should transition to publishing");
      const publishedResult = post.markAsPublished({ x: { success: true, externalId: "ext-1" } });
      assert.ok(publishedResult.ok, "Should transition to published");
      post.clearDomainEvents();

      (postRepo.findById as any).mock.mockImplementation(async () => ok(post));

      const useCase = new UpdatePostUseCase(postRepo, eventDispatcher);
      const result = await useCase.execute({
        postId: post.id.value,
        body: "Should not update",
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.FORBIDDEN);
    });
  });

  describe("ListPostsUseCase", { concurrency: 1 }, () => {
    it("should list posts for a project with pagination", async () => {
      const items = [makeReadModel({ body: "Post 1" }), makeReadModel({ body: "Post 2" })];
      (queryRepo.listByProject as any).mock.mockImplementation(async () => ({
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

      assert.ok(result.ok);
      assert.equal(result.value.items.length, 2);
      assert.equal(result.value.total, 2);
      assert.equal(result.value.page, 1);
      assert.equal(result.value.limit, 10);
      assert.equal(result.value.hasNext, false);
      assert.equal(result.value.hasPrevious, false);
      // All items belong to the test project
      for (const item of result.value.items) {
        assert.equal(item.projectId, TEST_PROJECT_ID);
      }
    });

    it("should return paginated shape with totalPages and navigation flags", async () => {
      (queryRepo.listByProject as any).mock.mockImplementation(async () => ({
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

      assert.ok(result.ok);
      assert.equal(result.value.totalPages, 3);
      assert.equal(result.value.hasNext, true);
      assert.equal(result.value.hasPrevious, true);
    });

    it("should reject invalid project ID format", async () => {
      const useCase = new ListPostsUseCase(queryRepo);

      const result = await useCase.execute({ projectId: "invalid-id" });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("should cap limit to 100 even if caller requests more", async () => {
      (queryRepo.listByProject as any).mock.mockImplementation(async () => ({
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

      assert.ok(result.ok);
      // The use case should have capped the limit to 100
      const callArgs = (queryRepo.listByProject as any).mock.calls[0]?.arguments;
      const pagination = callArgs?.[1] as { page: number; limit: number } | undefined;
      assert.ok(pagination);
      assert.equal(pagination.limit, 100);
    });
  });

  describe("DeletePostUseCase", { concurrency: 1 }, () => {
    it("should delete an existing draft post", async () => {
      const projectId = ProjectId.fromStringUnsafe(TEST_PROJECT_ID);
      const createResult = PostAggregate.create({
        projectId,
        body: "Post to delete",
      });
      assert.ok(createResult.ok);
      const post = createResult.value;

      (postRepo.findById as any).mock.mockImplementation(async () => ok(post));

      const useCase = new DeletePostUseCase(postRepo);
      const result = await useCase.execute({ postId: post.id.value });

      assert.ok(result.ok);
      // Verify delete was called on the repository
      assert.equal((postRepo.delete as any).mock.calls.length, 1);
    });

    it("should return NOT_FOUND for non-existent post", async () => {
      const useCase = new DeletePostUseCase(postRepo);

      const result = await useCase.execute({
        postId: "a0000000-0000-4000-8000-000000000000",
      });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });

    it("should reject invalid post ID format", async () => {
      const useCase = new DeletePostUseCase(postRepo);

      const result = await useCase.execute({ postId: "not-a-valid-uuid" });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("should return FORBIDDEN when post is published and not cancelled", async () => {
      const projectId = ProjectId.fromStringUnsafe(TEST_PROJECT_ID);
      const createResult = PostAggregate.create({
        projectId,
        body: "Published post",
      });
      assert.ok(createResult.ok);
      const post = createResult.value;
      const publishingResult = post.startPublishing(["X"]);
      assert.ok(publishingResult.ok, "Should transition to publishing");
      const publishedResult = post.markAsPublished({ x: { success: true, externalId: "ext-1" } });
      assert.ok(publishedResult.ok, "Should transition to published");

      (postRepo.findById as any).mock.mockImplementation(async () => ok(post));

      const useCase = new DeletePostUseCase(postRepo);
      const result = await useCase.execute({ postId: post.id.value });

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.FORBIDDEN);
    });
  });
});
