/**
 * @file SubmitForReviewUseCase.test.ts
 * @description Unit tests for SubmitForReviewUseCase — validates post exists,
 *   creates approval request, and persists via repository.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { SubmitForReviewUseCase } from "../../src/SubmitForReviewUseCase.js";

const VALID_POST_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_SUBMITTER_ID = "550e8400-e29b-41d4-a716-446655440002";

const makeApprovalRepo = () => ({
  save: vi.fn().mockResolvedValue(ok(undefined)),
  findById: vi.fn(),
  findByPostId: vi.fn(),
  findByAccountId: vi.fn(),
  countPending: vi.fn(),
});

const makePostRepo = () => ({
  findById: vi.fn().mockResolvedValue(ok({ id: { value: VALID_POST_ID } })),
  save: vi.fn(),
  delete: vi.fn(),
  findAll: vi.fn(),
  bulkUpdateStatus: vi.fn(),
  bulkArchive: vi.fn(),
  bulkHardDelete: vi.fn(),
  hardDelete: vi.fn(),
  findPaginated: vi.fn(),
  countByStatus: vi.fn(),
  findScheduledBefore: vi.fn(),
  findByAccountId: vi.fn(),
  findByChannelId: vi.fn(),
  getById: vi.fn(),
});

describe("SubmitForReviewUseCase", () => {
  let approvalRepo: ReturnType<typeof makeApprovalRepo>;
  let postRepo: ReturnType<typeof makePostRepo>;
  let useCase: SubmitForReviewUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    approvalRepo = makeApprovalRepo();
    postRepo = makePostRepo();
    useCase = new SubmitForReviewUseCase(approvalRepo, postRepo);
  });

  it("returns VALIDATION_FAILED when postId is not a valid UUID", async () => {
    const result = await useCase.execute({
      postId: "not-a-uuid",
      submitterId: VALID_SUBMITTER_ID,
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns NOT_FOUND when post does not exist", async () => {
    postRepo.findById.mockResolvedValue(err(new Error("Post not found")));
    const result = await useCase.execute({
      postId: VALID_POST_ID,
      submitterId: VALID_SUBMITTER_ID,
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "NOT_FOUND");
  });

  it("returns INTERNAL_ERROR when approval repo save throws", async () => {
    approvalRepo.save.mockRejectedValue(new Error("DB error"));
    const result = await useCase.execute({
      postId: VALID_POST_ID,
      submitterId: VALID_SUBMITTER_ID,
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });

  it("returns the id of the approval request it saves for a valid submission", async () => {
    const result = await useCase.execute({
      postId: VALID_POST_ID,
      submitterId: VALID_SUBMITTER_ID,
    });

    expect(result.ok).toBe(true);
    expect(approvalRepo.save).toHaveBeenCalledTimes(1);
    const saved = approvalRepo.save.mock.calls[0]?.[0];
    expect(result).toMatchObject({ value: { requestId: saved.id.value } });
  });
});
