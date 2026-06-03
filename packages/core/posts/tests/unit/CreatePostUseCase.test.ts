/**
 * @file CreatePostUseCase.test.ts
 * @description Unit tests for CreatePostUseCase — media attachment extension.
 *   Spec scenario: "createPost with media attaches items to the post",
 *   "createPost with empty media creates post without attachments".
 *   P1.3 (RED) → P1.4b (GREEN).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok } from "@shared/types";
import { CreatePostUseCase } from "../../src/CreatePostUseCase.js";
import type { PostRepository } from "@core/domain/index.js";
import type { EventDispatcher } from "@core/domain/events/DomainEvent.js";
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const passthroughUow: UnitOfWork = { executeInTransaction: async (fn) => fn() };

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
    it("creates a post without errors when media is an empty array", async () => {
      const repo = makeMockRepo();
      const dispatcher = makeMockDispatcher();
      const metrics = makeMockMetrics();
      const useCase = new CreatePostUseCase(repo, dispatcher, metrics, passthroughUow);

      const result = await useCase.execute({ ...BASE_INPUT, media: [] });

      assert.ok(result.ok, `Expected success but got: ${result.ok ? "" : result.error.message}`);
    });

    it("creates a post without errors when media field is omitted", async () => {
      const repo = makeMockRepo();
      const dispatcher = makeMockDispatcher();
      const metrics = makeMockMetrics();
      const useCase = new CreatePostUseCase(repo, dispatcher, metrics, passthroughUow);

      const result = await useCase.execute(BASE_INPUT);

      assert.ok(result.ok, `Expected success but got: ${result.ok ? "" : result.error.message}`);
    });

    it("creates a post successfully when media contains a valid image item", async () => {
      const repo = makeMockRepo();
      const dispatcher = makeMockDispatcher();
      const metrics = makeMockMetrics();
      const useCase = new CreatePostUseCase(repo, dispatcher, metrics, passthroughUow);

      const result = await useCase.execute({
        ...BASE_INPUT,
        media: [{ url: "https://cdn.example.com/photo.jpg", type: "image" }],
      });

      assert.ok(result.ok, `Expected success but got: ${result.ok ? "" : result.error.message}`);
    });

    it("creates a post successfully when media contains a valid video item", async () => {
      const repo = makeMockRepo();
      const dispatcher = makeMockDispatcher();
      const metrics = makeMockMetrics();
      const useCase = new CreatePostUseCase(repo, dispatcher, metrics, passthroughUow);

      const result = await useCase.execute({
        ...BASE_INPUT,
        media: [{ url: "https://cdn.example.com/clip.mp4", type: "video" }],
      });

      assert.ok(result.ok, `Expected success but got: ${result.ok ? "" : result.error.message}`);
    });

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
  });
});
