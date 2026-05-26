/**
 * @file HardDeletePostsBatchUseCase.test.ts
 * @description Unit tests for HardDeletePostsBatchUseCase — covers happy path,
 *              UUID validation, batch-size cap, empty input, and repo failure.
 *              Mirrors the structure of ArchivePostsBatchUseCase.test.ts.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err } from "@shared/types";
import { HardDeletePostsBatchUseCase } from "@core/application/posts/HardDeletePostsBatchUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { PostId } from "@core/domain/index.js";

function makeMockRepository() {
  return {
    bulkHardDelete: vi.fn(async (ids: PostId[]) => ok(ids.length)),
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
    bulkArchive: vi.fn(),
    hardDelete: vi.fn(),
  };
}

describe("HardDeletePostsBatchUseCase", () => {
  let repo: ReturnType<typeof makeMockRepository>;
  let useCase: HardDeletePostsBatchUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepository();
    useCase = new HardDeletePostsBatchUseCase(repo as never);
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
    });

    it("collects malformed UUIDs as invalidIds", async () => {
      const validId = PostId.generate().value;
      const result = await useCase.execute({ postIds: [validId, "not-a-uuid"] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.invalidIds).toEqual(["not-a-uuid"]);
      expect(result.value.deleted).toBe(1);
    });
  });

  describe("happy path", () => {
    it("deletes all valid postIds and reports the row count", async () => {
      const ids = [PostId.generate().value, PostId.generate().value];
      repo.bulkHardDelete.mockResolvedValueOnce(ok(2));

      const result = await useCase.execute({ postIds: ids });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deleted).toBe(2);
      expect(repo.bulkHardDelete).toHaveBeenCalledOnce();
    });
  });

  describe("UoW integration", () => {
    it("wraps the repository call in executeInTransaction", async () => {
      const uow = {
        executeInTransaction: vi.fn(async (fn: () => Promise<void>) => {
          await fn();
        }),
      };
      const useCaseWithUow = new HardDeletePostsBatchUseCase(repo as never, uow as never);

      const ids = [PostId.generate().value];
      repo.bulkHardDelete.mockResolvedValueOnce(ok(1));

      const result = await useCaseWithUow.execute({ postIds: ids });

      expect(result.ok).toBe(true);
      expect(uow.executeInTransaction).toHaveBeenCalledOnce();
    });
  });

  describe("error handling", () => {
    it("surfaces repository errors as INTERNAL_ERROR", async () => {
      const ids = [PostId.generate().value];
      repo.bulkHardDelete.mockResolvedValueOnce(err(new Error("FK violation")));

      const result = await useCase.execute({ postIds: ids });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
      expect(result.error.message).toMatch(/FK violation/);
    });
  });
});
