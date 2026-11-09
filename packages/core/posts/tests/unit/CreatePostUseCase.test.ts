/**
 * @file CreatePostUseCase.test.ts
 * @description Unit tests for CreatePostUseCase — media attachment: a post created with valid
 *   media is saved, and an invalid media URL fails validation.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";
import { ok } from "@shared/types";
import { CreatePostUseCase } from "../../src/CreatePostUseCase.js";
import type { PostRepository } from "@core/domain/index.js";
import { AccountId } from "@core/domain/index.js";
import type { EventDispatcher } from "@core/domain/events/DomainEvent.js";
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
  executeResultInTransaction: async (fn) => fn(),
};

function makeMockRepo(): PostRepository {
  return {
    save: vi.fn(async () => ok(undefined)),
    findById: vi.fn(),
    findByProjectId: vi.fn(),
    findByStatus: vi.fn(),
    findReadyForPublishing: vi.fn(),
    findWithFilters: vi.fn(),
    countByProjectId: vi.fn(),
    countByStatus: vi.fn(),
    getProjectStats: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    delete: vi.fn(),
    hardDelete: vi.fn(),
    // Creation resolves the target project's tenant before building anything; a
    // double answering null would NOT_FOUND every case in this file.
    findProjectOwnerAccountId: vi.fn(async () => AccountId.fromStringUnsafe("acc-owner-fixture")),
  } as unknown as PostRepository;
}

function makeMockDispatcher(): EventDispatcher {
  return {
    dispatch: vi.fn(async () => {}),
    dispatchAll: vi.fn(async () => {}),
    register: vi.fn(),
  };
}

function makeMockMetrics(): BusinessMetricsPort {
  return {
    incrementPostCreated: vi.fn(),
    incrementPostPublished: vi.fn(),
    incrementPostDeleted: vi.fn(),
  } as unknown as BusinessMetricsPort;
}

const BASE_INPUT = {
  projectId: "550e8400-e29b-41d4-a716-446655440000",
  body: "Hello bulk scheduled world!",
};

describe("CreatePostUseCase — media extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createPost with media", () => {
    it("returns VALIDATION_FAILED when a media item URL is invalid", async () => {
      const repo = makeMockRepo();
      const dispatcher = makeMockDispatcher();
      const metrics = makeMockMetrics();
      const useCase = new CreatePostUseCase(repo, dispatcher, metrics, passthroughUow);

      const result = await useCase.execute({
        ...BASE_INPUT,
        media: [{ url: "not-a-url", type: "image" }],
      });

      assert.ok(!result.ok, "Expected failure for invalid URL");
      assert.strictEqual(result.error.code, "VALIDATION_FAILED");
    });

    it("calls repo.save once per successful execution regardless of media count", async () => {
      const repo = makeMockRepo();
      const dispatcher = makeMockDispatcher();
      const metrics = makeMockMetrics();
      const useCase = new CreatePostUseCase(repo, dispatcher, metrics, passthroughUow);

      await useCase.execute({
        ...BASE_INPUT,
        media: [
          { url: "https://cdn.example.com/photo.jpg", type: "image" },
          { url: "https://cdn.example.com/clip.mp4", type: "video" },
        ],
      });

      assert.strictEqual((repo.save as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    });

    it("returns the saved draft with its body when the media array is empty", async () => {
      const repo = makeMockRepo();
      const dispatcher = makeMockDispatcher();
      const metrics = makeMockMetrics();
      const useCase = new CreatePostUseCase(repo, dispatcher, metrics, passthroughUow);

      const result = await useCase.execute({ ...BASE_INPUT, media: [] });

      expect(result.ok).toBe(true);
      expect(result).toMatchObject({ value: { body: BASE_INPUT.body, status: "DRAFT" } });
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it("returns the saved draft for its project when the input carries no media field", async () => {
      const repo = makeMockRepo();
      const dispatcher = makeMockDispatcher();
      const metrics = makeMockMetrics();
      const useCase = new CreatePostUseCase(repo, dispatcher, metrics, passthroughUow);

      const result = await useCase.execute(BASE_INPUT);

      expect(result.ok).toBe(true);
      expect(result).toMatchObject({
        value: { projectId: BASE_INPUT.projectId, body: BASE_INPUT.body },
      });
    });
  });
});
