/**
 * @file GenerateImageUseCase.test.ts
 * @description Unit tests for GenerateImageUseCase — validates image generation
 *   orchestration: prompt validation, AI port delegation, and persistence.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { GenerateImageUseCase } from "../../src/GenerateImageUseCase.js";
import type { GeneratedImageData } from "@core/domain/repositories/GeneratedImageRepository.js";

const makeSavedImage = (overrides?: Partial<GeneratedImageData>): GeneratedImageData => ({
  id: "img-uuid-001",
  projectId: "proj-uuid-001",
  prompt: "a sunset over mountains",
  revisedPrompt: "a vivid sunset over snow-capped mountains",
  imageUrl: "https://example.com/image.png",
  size: "1024x1024",
  quality: "standard",
  style: "vivid",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});

const makeRepo = () => ({
  save: vi.fn().mockResolvedValue(ok(makeSavedImage())),
  findById: vi.fn(),
  findByProjectId: vi.fn(),
  delete: vi.fn(),
});

const makeGenerator = () => ({
  generateImage: vi
    .fn()
    .mockResolvedValue(
      ok({ imageUrl: "https://example.com/image.png", revisedPrompt: "revised prompt" })
    ),
});

describe("GenerateImageUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let generator: ReturnType<typeof makeGenerator>;
  let useCase: GenerateImageUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    generator = makeGenerator();
    useCase = new GenerateImageUseCase(repo, generator);
  });

  it("returns ok with saved image data when prompt is valid", async () => {
    const result = await useCase.execute({
      projectId: "proj-uuid-001",
      prompt: "a sunset over mountains",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.projectId, "proj-uuid-001");
    assert.strictEqual(result.value.imageUrl, "https://example.com/image.png");
  });

  it("returns VALIDATION_FAILED when prompt is empty string", async () => {
    const result = await useCase.execute({
      projectId: "proj-uuid-001",
      prompt: "   ",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns INTERNAL_ERROR when image generator fails", async () => {
    generator.generateImage.mockResolvedValue(err("Provider unavailable"));
    const result = await useCase.execute({
      projectId: "proj-uuid-001",
      prompt: "a sunset",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });

  it("returns INTERNAL_ERROR when repository save fails", async () => {
    repo.save.mockResolvedValue(err(new Error("DB write failed")));
    const result = await useCase.execute({
      projectId: "proj-uuid-001",
      prompt: "a sunset",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });
});
