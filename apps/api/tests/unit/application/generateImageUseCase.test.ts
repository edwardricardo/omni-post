/**
 * @file generateImageUseCase.test.ts
 * @description Tests for GenerateImageUseCase — validation, guarded parent-project
 *   ownership (foreign → NOT_FOUND before the paid AI call), image-port delegation,
 *   accountId threading, and persistence.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { GenerateImageUseCase } from "@core/ai-image/GenerateImageUseCase.js";
import { Project } from "@core/domain/entities/Project.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeRepo() {
  return {
    save: vi.fn(async (data: any) => ({ ok: true as const, value: data })),
    findByProjectId: vi.fn(async () => []),
  };
}

function makeProject(): Project {
  const r = Project.create({ accountId: AccountId.fromStringUnsafe(ACCOUNT_ID), name: "Test" });
  if (!r.ok) throw new Error("fixture: Project.create failed");
  return r.value;
}

function makeProjectRepo(found = true) {
  return {
    findById: vi
      .fn()
      .mockResolvedValue(
        found ? ok(makeProject()) : err(new EntityNotFoundError("Project", VALID_PROJECT_ID))
      ),
  };
}

function makeImageGenerator() {
  return {
    generateImage: vi.fn(async () =>
      ok({
        imageUrl: "https://cdn.example.com/generated/img-1.png",
        revisedPrompt: "A stunning sunset over calm ocean waters",
      })
    ),
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: VALID_PROJECT_ID,
    prompt: "A beautiful sunset over the ocean",
    ...overrides,
  };
}

describe("GenerateImageUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let projectRepo: ReturnType<typeof makeProjectRepo>;
  let imageGenerator: ReturnType<typeof makeImageGenerator>;
  let uc: GenerateImageUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    projectRepo = makeProjectRepo(true);
    imageGenerator = makeImageGenerator();
    uc = new GenerateImageUseCase(repo as any, projectRepo as any, imageGenerator as any);
  });

  it("generates and persists image on success", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.equal(r.value.imageUrl, "https://cdn.example.com/generated/img-1.png");
    assert.equal(r.value.prompt, "A beautiful sunset over the ocean");
    assert.equal(r.value.projectId, VALID_PROJECT_ID);
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("trims the prompt", async () => {
    await uc.execute(makeInput({ prompt: "  sunset  " }));
    expect(imageGenerator.generateImage).toHaveBeenCalledWith(
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

  it("passes custom size to the image generator", async () => {
    await uc.execute(makeInput({ size: "1792x1024" }));
    expect(imageGenerator.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ size: "1792x1024" })
    );
  });

  it("passes custom quality to the image generator", async () => {
    await uc.execute(makeInput({ quality: "hd" }));
    expect(imageGenerator.generateImage).toHaveBeenCalledWith(
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

  it("rejects an invalid (non-UUID) projectId with VALIDATION_FAILED", async () => {
    const r = await uc.execute(makeInput({ projectId: "proj-1" }));
    assert.ok(!r.ok);
    assert.equal(r.error.code, "VALIDATION_FAILED");
  });

  it("rejects a foreign/missing project with NOT_FOUND, burning NO AI call and persisting nothing", async () => {
    const foreignRepo = makeProjectRepo(false);
    uc = new GenerateImageUseCase(repo as any, foreignRepo as any, imageGenerator as any);
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    assert.equal(r.error.code, "NOT_FOUND");
    expect(imageGenerator.generateImage).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("threads the resolved project's accountId onto the saved image", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    const savedData = repo.save.mock.calls[0]?.[0];
    assert.equal(savedData?.accountId, ACCOUNT_ID);
    assert.equal(r.value.accountId, ACCOUNT_ID);
  });

  it("surfaces the image-generation error message", async () => {
    imageGenerator.generateImage.mockResolvedValueOnce(err("Rate limit exceeded"));
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Rate limit");
  });

  it("returns error when repository save fails", async () => {
    repo.save.mockResolvedValueOnce({ ok: false, error: "DB error" });
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    expect(r.error.message).toContain("persist");
  });

  it("includes revisedPrompt from the generator in saved data", async () => {
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
