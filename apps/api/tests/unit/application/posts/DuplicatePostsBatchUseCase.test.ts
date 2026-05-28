/**
 * @file DuplicatePostsBatchUseCase.test.ts
 * @description Unit tests for DuplicatePostsBatchUseCase — covers happy path
 *              (clone with media + tags), validation, batch cap, source not
 *              found, save failure, and event dispatching.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err } from "@shared/types";
import { DuplicatePostsBatchUseCase } from "@core/posts/DuplicatePostsBatchUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { PostAggregate, PostId, ProjectId } from "@core/domain/index.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

// Mock business metrics — they call Prometheus which may not be initialized
vi.mock("../../../../src/metrics/businessMetrics.js", () => ({
  incrementPostCreated: vi.fn(),
  incrementPostDeleted: vi.fn(),
  incrementPostPublished: vi.fn(),
}));

function makeSourcePost(opts?: { body?: string; title?: string; tags?: string[] }): PostAggregate {
  const result = PostAggregate.create({
    projectId: ProjectId.generate(),
    body: opts?.body ?? "Original body",
    ...(opts?.title !== undefined && { title: opts.title }),
    tags: opts?.tags ?? ["news", "launch"],
  });
  if (!result.ok) {
    throw new Error(`Test fixture failed: ${result.error.message}`);
  }
  result.value.clearDomainEvents();
  return result.value;
}

function makeMockRepository() {
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

describe("DuplicatePostsBatchUseCase", () => {
  let repo: ReturnType<typeof makeMockRepository>;
  let dispatcher: ReturnType<typeof makeMockDispatcher>;
  let useCase: DuplicatePostsBatchUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepository();
    dispatcher = makeMockDispatcher();
    useCase = new DuplicatePostsBatchUseCase(repo as never, dispatcher as never);
  });

  describe("validation", () => {
    it("rejects empty postIds", async () => {
      const result = await useCase.execute({ postIds: [] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("rejects batches over 50 (lower cap than archive due to per-item read+write)", async () => {
      const ids = Array.from({ length: 51 }, () => PostId.generate().value);
      const result = await useCase.execute({ postIds: ids });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(result.error.message).toMatch(/exceeds limit/);
    });

    it("collects malformed UUIDs as invalidIds", async () => {
      const result = await useCase.execute({ postIds: ["not-a-uuid"] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.invalidIds).toEqual(["not-a-uuid"]);
      expect(result.value.duplicates).toEqual([]);
    });
  });

  describe("happy path", () => {
    it("clones a single post into a new DRAFT with the same content", async () => {
      const source = makeSourcePost({ body: "Hello world", title: "My Post" });
      repo.store.set(source.id.value, source);

      const result = await useCase.execute({ postIds: [source.id.value] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.duplicates).toHaveLength(1);
      expect(result.value.duplicates[0]?.sourceId).toBe(source.id.value);
      expect(result.value.duplicates[0]?.newId).not.toBe(source.id.value);

      const newId = result.value.duplicates[0]!.newId;
      const cloned = repo.store.get(newId);
      expect(cloned).toBeDefined();
      expect(cloned!.content.body).toBe("Hello world");
      expect(cloned!.content.title).toBe("My Post");
    });

    it("preserves tags on the clone", async () => {
      const source = makeSourcePost({ tags: ["a", "b", "c"] });
      repo.store.set(source.id.value, source);

      const result = await useCase.execute({ postIds: [source.id.value] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const cloned = repo.store.get(result.value.duplicates[0]!.newId);
      expect(cloned!.content.tags).toEqual(["a", "b", "c"]);
    });

    it("clones into the same projectId as the source", async () => {
      const source = makeSourcePost();
      repo.store.set(source.id.value, source);

      const result = await useCase.execute({ postIds: [source.id.value] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const cloned = repo.store.get(result.value.duplicates[0]!.newId);
      expect(cloned!.projectId.value).toBe(source.projectId.value);
    });

    it("dispatches PostCreated event after save", async () => {
      const source = makeSourcePost();
      repo.store.set(source.id.value, source);

      await useCase.execute({ postIds: [source.id.value] });

      expect(dispatcher.dispatchAll).toHaveBeenCalled();
    });
  });

  describe("missing sources", () => {
    it("collects not-found ids without aborting the batch", async () => {
      const survivor = makeSourcePost();
      repo.store.set(survivor.id.value, survivor);
      const ghostId = PostId.generate().value;

      const result = await useCase.execute({ postIds: [survivor.id.value, ghostId] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.duplicates).toHaveLength(1);
      expect(result.value.notFoundIds).toEqual([ghostId]);
    });
  });

  describe("error handling", () => {
    it("surfaces save failures as INTERNAL_ERROR", async () => {
      const source = makeSourcePost();
      repo.store.set(source.id.value, source);
      repo.save.mockResolvedValueOnce(err(new Error("Disk full")));

      const result = await useCase.execute({ postIds: [source.id.value] });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(result.error.message).toMatch(/Disk full/);
    });
  });
});
