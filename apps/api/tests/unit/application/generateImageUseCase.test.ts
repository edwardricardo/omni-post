/**
 * @file generateImageUseCase.test.ts
 * @description Tests for GenerateImageUseCase — validation, AI delegation, persistence.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { GenerateImageUseCase } from "../../../src/application/ai-image/GenerateImageUseCase.js";

function makeRepo() {
  return {
    save: vi.fn(async (data: any) => ({ ok: true as const, value: data })),
    findByProjectId: vi.fn(async () => []),
  };
}

function makeAIService() {
  return {
    generateImage: vi.fn(async () => ({
      ok: true as const,
      value: {
        imageUrl: "https://cdn.example.com/generated/img-1.png",
        revisedPrompt: "A stunning sunset over calm ocean waters",
      },
    })),
    generateContent: vi.fn(),
    optimizeContent: vi.fn(),
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj-1",
    prompt: "A beautiful sunset over the ocean",
    ...overrides,
  };
}

describe("GenerateImageUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let aiService: ReturnType<typeof makeAIService>;
  let uc: GenerateImageUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    aiService = makeAIService();
    uc = new GenerateImageUseCase(repo as any, aiService as any);
  });

  it("generates and persists image on success", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.equal(r.value.imageUrl, "https://cdn.example.com/generated/img-1.png");
    assert.equal(r.value.prompt, "A beautiful sunset over the ocean");
    assert.equal(r.value.projectId, "proj-1");
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("trims the prompt", async () => {
    await uc.execute(makeInput({ prompt: "  sunset  " }));
    expect(aiService.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "sunset" })
    );
  });

  it("uses default size 1024x1024 when not specified", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.equal(r.value.size, "1024x1024");
  });

  it("uses default quality standard when not specified", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.equal(r.value.quality, "standard");
  });

  it("uses default style vivid when not specified", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.equal(r.value.style, "vivid");
  });

  it("passes custom size to AI service", async () => {
    await uc.execute(makeInput({ size: "1792x1024" }));
    expect(aiService.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ size: "1792x1024" })
    );
  });

  it("passes custom quality to AI service", async () => {
    await uc.execute(makeInput({ quality: "hd" }));
    expect(aiService.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ quality: "hd" })
    );
  });

  it("rejects empty prompt", async () => {
    const r = await uc.execute(makeInput({ prompt: "" }));
    assert.ok(!r.ok);
  });

  it("rejects whitespace-only prompt", async () => {
    const r = await uc.execute(makeInput({ prompt: "   " }));
    assert.ok(!r.ok);
  });

  it("returns error when AI service fails", async () => {
    aiService.generateImage.mockResolvedValueOnce({
      ok: false,
      error: { message: "Rate limit exceeded" },
    });
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Rate limit");
  });

  it("returns generic error when AI error has no message", async () => {
    aiService.generateImage.mockResolvedValueOnce({
      ok: false,
      error: "unknown",
    });
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Image generation failed");
  });

  it("returns error when AI service returns null value", async () => {
    aiService.generateImage.mockResolvedValueOnce({
      ok: true,
      value: null,
    });
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    expect(r.error.message).toContain("no image data");
  });

  it("returns error when repository save fails", async () => {
    repo.save.mockResolvedValueOnce({ ok: false, error: "DB error" });
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    expect(r.error.message).toContain("persist");
  });

  it("includes revisedPrompt from AI in saved data", async () => {
    await uc.execute(makeInput());
    const savedData = repo.save.mock.calls[0]?.[0];
    assert.equal(savedData?.revisedPrompt, "A stunning sunset over calm ocean waters");
  });

  it("generates a UUID for the image ID", async () => {
    await uc.execute(makeInput());
    const savedData = repo.save.mock.calls[0]?.[0];
    assert.ok(savedData?.id);
    assert.ok(savedData.id.length > 10);
  });
});
