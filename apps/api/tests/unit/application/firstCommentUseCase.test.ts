/**
 * @file firstCommentUseCase.test.ts
 * @description Tests for SetFirstCommentUseCase — validation, persistence, error paths.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { SetFirstCommentUseCase } from "@core/first-comment/SetFirstCommentUseCase.js";

function makeRepo() {
  return {
    save: vi.fn(async (data: any) => ({ ok: true as const, value: data })),
    findByPostId: vi.fn(async () => null),
    deleteByPostId: vi.fn(async () => undefined),
  };
}

describe("SetFirstCommentUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let uc: SetFirstCommentUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    uc = new SetFirstCommentUseCase(repo as any);
  });

  it("saves first comment with PENDING status", async () => {
    const r = await uc.execute({ postId: "post-1", body: "First!" });
    assert.ok(r.ok);
    assert.equal(r.value.postId, "post-1");
    assert.equal(r.value.body, "First!");
    assert.equal(r.value.status, "PENDING");
  });

  it("generates an ID for the saved record", async () => {
    const r = await uc.execute({ postId: "post-1", body: "Comment" });
    assert.ok(r.ok);
    assert.ok(r.value.id);
    assert.ok(r.value.id.length > 10);
  });

  it("calls repository.save with correct data", async () => {
    await uc.execute({ postId: "post-2", body: "My comment" });
    expect(repo.save).toHaveBeenCalledOnce();
    const saved = repo.save.mock.calls[0]?.[0];
    assert.equal(saved?.postId, "post-2");
    assert.equal(saved?.body, "My comment");
    assert.equal(saved?.status, "PENDING");
  });

  it("rejects empty body", async () => {
    const r = await uc.execute({ postId: "post-1", body: "" });
    assert.ok(!r.ok);
  });

  it("rejects whitespace-only body", async () => {
    const r = await uc.execute({ postId: "post-1", body: "   " });
    assert.ok(!r.ok);
  });

  it("returns error when repository save fails", async () => {
    repo.save.mockResolvedValueOnce({ ok: false, error: new Error("DB error") });
    const r = await uc.execute({ postId: "post-1", body: "Comment" });
    assert.ok(!r.ok);
  });
});
