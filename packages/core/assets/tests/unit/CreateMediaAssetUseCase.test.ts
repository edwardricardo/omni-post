/**
 * @file CreateMediaAssetUseCase.test.ts
 * @description Unit tests for CreateMediaAssetUseCase — validates domain entity
 *   creation, mime type validation, and persistence.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { CreateMediaAssetUseCase } from "../../src/CreateMediaAssetUseCase.js";

const makeValidInput = () => ({
  accountId: "acct-uuid-001",
  name: "hero-image.png",
  url: "https://s3.example.com/hero-image.png",
  storageKey: "uploads/hero-image.png",
  mimeType: "image/png",
  sizeBytes: 204800,
});

const makeRepo = () => ({
  save: vi.fn().mockResolvedValue(ok(undefined)),
  findById: vi.fn(),
  findByAccountId: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  findByFolderId: vi.fn(),
  tagAsset: vi.fn(),
  removeTag: vi.fn(),
  findByTag: vi.fn(),
});

describe("CreateMediaAssetUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let useCase: CreateMediaAssetUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    useCase = new CreateMediaAssetUseCase(repo);
  });

  it("returns ok with asset data when input is valid", async () => {
    const result = await useCase.execute(makeValidInput());
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.name, "hero-image.png");
    assert.strictEqual(result.value.mimeType, "image/png");
    assert.strictEqual(result.value.sizeBytes, 204800);
    assert.ok(result.value.id, "Expected id to be present");
  });

  it("returns VALIDATION_FAILED when name is empty", async () => {
    const result = await useCase.execute({
      ...makeValidInput(),
      name: "",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when mimeType is empty", async () => {
    const result = await useCase.execute({
      ...makeValidInput(),
      mimeType: "",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns INTERNAL_ERROR when repository save fails", async () => {
    repo.save.mockResolvedValue(err(new Error("Storage error")));
    const result = await useCase.execute(makeValidInput());
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });
});
