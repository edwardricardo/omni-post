/**
 * @file ArchivePostsBatchUseCase.test.ts
 * @description Unit tests for ArchivePostsBatchUseCase — covers happy path,
 *              UUID validation (mixed valid + invalid), batch-size cap,
 *              empty input, and repository failure surfacing.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err } from "@shared/types";
import { ArchivePostsBatchUseCase } from "@core/posts/ArchivePostsBatchUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { PostId } from "@core/domain/index.js";

function makeMockRepository() {
  return {
    bulkArchive: vi.fn(async (ids: PostId[]) => ok(ids.length)),
    // unused but required by interface — supply minimal stubs
    findById: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    findByProjectId: vi.fn(),
    findByStatus: vi.fn(),
    findReadyForPublishing: vi.fn(),
    findWithFilters: vi.fn(),
    countByProjectId: vi.fn(),
    countByStatus: vi.fn(),
    getProjectStats: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    bulkHardDelete: vi.fn(),
    hardDelete: vi.fn(),
  };
}

describe("ArchivePostsBatchUseCase", () => {
  let repo: ReturnType<typeof makeMockRepository>;
  let useCase: ArchivePostsBatchUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepository();
    useCase = new ArchivePostsBatchUseCase(repo as never);
  });

  describe("validation", () => {
    it("rejects empty postIds", async () => {
      const result = await useCase.execute({ postIds: [] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("rejects batches over 100", async () => {
      const ids = Array.from({ length: 101 }, () => PostId.generate().value);
      const result = await useCase.execute({ postIds: ids });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(result.error.message).toMatch(/exceeds limit/);
    });

    it("collects malformed UUIDs as invalidIds without failing the request", async () => {
      const validId = PostId.generate().value;
      const result = await useCase.execute({ postIds: [validId, "not-a-uuid"] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.invalidIds).toEqual(["not-a-uuid"]);
      expect(result.value.archived).toBe(1);
    });

    it("returns archived=0 with full invalidIds when every input is malformed", async () => {
      const result = await useCase.execute({ postIds: ["bad-1", "bad-2"] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.archived).toBe(0);
      expect(result.value.invalidIds).toEqual(["bad-1", "bad-2"]);
      expect(repo.bulkArchive).not.toHaveBeenCalled();
    });
  });

  describe("happy path", () => {
    it("archives all valid postIds and reports the row count", async () => {
      const ids = [PostId.generate().value, PostId.generate().value];
      repo.bulkArchive.mockResolvedValueOnce(ok(2));

      const result = await useCase.execute({ postIds: ids });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.archived).toBe(2);
      expect(result.value.invalidIds).toEqual([]);
      expect(repo.bulkArchive).toHaveBeenCalledOnce();
    });
  });

  describe("UoW integration", () => {
    it("wraps the repository call in executeInTransaction when UoW is provided", async () => {
      const uow = {
        executeInTransaction: vi.fn(async (fn: () => Promise<void>) => {
          await fn();
        }),
      };
      const useCaseWithUow = new ArchivePostsBatchUseCase(repo as never, uow as never);

      const ids = [PostId.generate().value];
      repo.bulkArchive.mockResolvedValueOnce(ok(1));

      const result = await useCaseWithUow.execute({ postIds: ids });

      expect(result.ok).toBe(true);
      expect(uow.executeInTransaction).toHaveBeenCalledOnce();
      expect(repo.bulkArchive).toHaveBeenCalledOnce();
    });
  });

  describe("error handling", () => {
    it("surfaces repository errors as INTERNAL_ERROR", async () => {
      const ids = [PostId.generate().value];
      repo.bulkArchive.mockResolvedValueOnce(err(new Error("DB connection lost")));

      const result = await useCase.execute({ postIds: ids });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(result.error.message).toMatch(/DB connection lost/);
    });
  });
});
