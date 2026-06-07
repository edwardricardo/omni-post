/**
 * @file CreateCommentUseCase.test.ts
 * @description Unit tests for CreateCommentUseCase — validates comment body,
 *   mention extraction, and persistence.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { CreateCommentUseCase } from "../../src/CreateCommentUseCase.js";

const makeRepo = () => ({
  save: vi.fn().mockResolvedValue(undefined),
  findById: vi.fn(),
  findByPostId: vi.fn(),
  delete: vi.fn(),
  countByPostId: vi.fn(),
});

describe("CreateCommentUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let useCase: CreateCommentUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    useCase = new CreateCommentUseCase(repo);
  });

  it("returns ok with comment id and empty mentions for a plain comment", async () => {
    const result = await useCase.execute({
      postId: "post-uuid-001",
      authorId: "author-uuid-001",
      body: "Great post!",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.ok(result.value.id, "Expected comment id to be present");
    assert.deepEqual(result.value.mentions, []);
  });

  it("returns ok and extracts @mention from comment body", async () => {
    const result = await useCase.execute({
      postId: "post-uuid-001",
      authorId: "author-uuid-001",
      body: "Thanks @john for the feedback!",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.deepEqual(result.value.mentions, ["john"]);
  });

  it("returns VALIDATION_FAILED when body is empty", async () => {
    const result = await useCase.execute({
      postId: "post-uuid-001",
      authorId: "author-uuid-001",
      body: "   ",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns INTERNAL_ERROR when repository save throws", async () => {
    repo.save.mockRejectedValue(new Error("DB failure"));
    const result = await useCase.execute({
      postId: "post-uuid-001",
      authorId: "author-uuid-001",
      body: "Nice post!",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });
});
