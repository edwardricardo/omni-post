/**
 * @file SetFirstCommentUseCase.test.ts
 * @description Unit tests for SetFirstCommentUseCase — validates comment body
 *   presence, upsert semantics, and error propagation.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { SetFirstCommentUseCase } from "../../src/SetFirstCommentUseCase.js";
import type { FirstCommentData } from "@core/domain/repositories/FirstCommentRepository.js";

const makeSavedComment = (overrides?: Partial<FirstCommentData>): FirstCommentData => ({
  id: "fc-uuid-001",
  postId: "post-uuid-001",
  body: "Check out our latest blog post!",
  status: "PENDING",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});

const makeRepo = () => ({
  save: vi.fn().mockResolvedValue(ok(makeSavedComment())),
  findByPostId: vi.fn(),
  delete: vi.fn(),
  updateStatus: vi.fn(),
});

describe("SetFirstCommentUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let useCase: SetFirstCommentUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    useCase = new SetFirstCommentUseCase(repo);
  });

  it("returns ok with first comment data when body is valid", async () => {
    const result = await useCase.execute({
      postId: "post-uuid-001",
      body: "Check out our latest blog post!",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.postId, "post-uuid-001");
    assert.strictEqual(result.value.status, "PENDING");
    assert.ok(result.value.id, "Expected id to be present");
  });

  it("returns ok when updating (upsert) an existing first comment", async () => {
    repo.save.mockResolvedValue(ok(makeSavedComment({ body: "Updated comment!" })));
    const result = await useCase.execute({
      postId: "post-uuid-001",
      body: "Updated comment!",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.body, "Updated comment!");
  });

  it("returns VALIDATION_FAILED when body is empty", async () => {
    const result = await useCase.execute({
      postId: "post-uuid-001",
      body: "   ",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns INTERNAL_ERROR when repository save fails", async () => {
    repo.save.mockResolvedValue(err(new Error("Upsert failed")));
    const result = await useCase.execute({
      postId: "post-uuid-001",
      body: "Valid body",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });
});
