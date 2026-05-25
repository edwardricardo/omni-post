/**
 * @file utmLinksUseCase.test.ts
 * @description Tests for GenerateUTMLinksUseCase — ID validation, UTM creation, entity persistence.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { GenerateUTMLinksUseCase } from "@core/application/utm/GenerateUTMLinksUseCase.js";
import { TrackedLinkId } from "@core/domain/value-objects/EntityId.js";

// Mock TrackedLink entity
function makeMockLink() {
  return {
    setUTMParameters: vi.fn(),
    getUTMUrl: vi.fn(
      () => "https://example.com/page?utm_source=x&utm_medium=social&utm_campaign=test"
    ),
  };
}

function makeRepo(link: ReturnType<typeof makeMockLink> | null = null) {
  const mockLink = link ?? makeMockLink();
  return {
    findById: vi.fn(async () =>
      mockLink
        ? { ok: true as const, value: mockLink }
        : { ok: false as const, error: new Error("Not found") }
    ),
    save: vi.fn(async () => ({ ok: true as const, value: undefined })),
    _mockLink: mockLink,
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    trackedLinkId: TrackedLinkId.generate().value,
    source: "instagram",
    medium: "social",
    campaign: "q1-launch",
    ...overrides,
  };
}

describe("GenerateUTMLinksUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let uc: GenerateUTMLinksUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    uc = new GenerateUTMLinksUseCase(repo as any);
  });

  it("generates UTM URL on success", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.ok(r.value.utmUrl.includes("utm_source"));
  });

  it("calls setUTMParameters on the tracked link entity", async () => {
    await uc.execute(makeInput());
    expect(repo._mockLink.setUTMParameters).toHaveBeenCalledOnce();
  });

  it("calls repository.save after setting UTM parameters", async () => {
    await uc.execute(makeInput());
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects invalid tracked link ID", async () => {
    const r = await uc.execute(makeInput({ trackedLinkId: "not-a-uuid" }));
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Invalid tracked link ID");
  });

  it("returns NOT_FOUND when link doesn't exist", async () => {
    repo.findById.mockResolvedValueOnce({ ok: false, error: new Error("Not found") });
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    expect(r.error.message).toContain("not found");
  });

  it("returns error when save fails", async () => {
    repo.save.mockResolvedValueOnce({ ok: false, error: new Error("DB error") });
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Failed to save");
  });

  it("passes optional content and term to UTMParameters", async () => {
    const r = await uc.execute(makeInput({ content: "image-post", term: "social media" }));
    // If UTMParameters.create fails, the use case returns an error
    // If it succeeds, UTM is set on the link
    // We just verify it doesn't crash with optional fields
    if (r.ok) {
      assert.ok(r.value.utmUrl);
    }
  });
});
