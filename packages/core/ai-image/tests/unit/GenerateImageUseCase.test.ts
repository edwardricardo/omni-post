/**
 * @file GenerateImageUseCase.test.ts
 * @description Unit tests for GenerateImageUseCase — validates image generation
 *   orchestration: prompt validation, guarded parent-project ownership check
 *   BEFORE the paid AI call, AI port delegation, accountId threading, and
 *   persistence.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { GenerateImageUseCase } from "../../src/GenerateImageUseCase.js";
import type { GeneratedImageData } from "@core/domain/repositories/GeneratedImageRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import { Project } from "@core/domain/entities/Project.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";

// Return the data passed in so threading assertions can read the constructed DTO.
const makeRepo = () => ({
  save: vi.fn(async (data: GeneratedImageData) => ok(data)),
  findById: vi.fn(),
  findByProjectId: vi.fn(),
  delete: vi.fn(),
});

const makeProject = (): Project => {
  const result = Project.create({
    accountId: AccountId.fromStringUnsafe(ACCOUNT_ID),
    name: "Test Project",
  });
  if (!result.ok) throw new Error("fixture: Project.create failed");
  return result.value;
};

// Narrow mock — the use case only calls findById. Cast to the port for the ctor.
const makeProjectRepo = (found = true) =>
  ({
    findById: vi
      .fn()
      .mockResolvedValue(
        found ? ok(makeProject()) : err(new EntityNotFoundError("Project", VALID_PROJECT_ID))
      ),
  }) as unknown as ProjectRepositoryPort & { findById: ReturnType<typeof vi.fn> };

const makeGenerator = () => ({
  generateImage: vi
    .fn()
    .mockResolvedValue(
      ok({ imageUrl: "https://example.com/image.png", revisedPrompt: "revised prompt" })
    ),
});

describe("GenerateImageUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let projectRepo: ReturnType<typeof makeProjectRepo>;
  let generator: ReturnType<typeof makeGenerator>;
  let useCase: GenerateImageUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    projectRepo = makeProjectRepo(true);
    generator = makeGenerator();
    useCase = new GenerateImageUseCase(repo, projectRepo, generator);
  });

  it("returns ok with saved image data when prompt is valid", async () => {
    const result = await useCase.execute({
      projectId: VALID_PROJECT_ID,
      prompt: "a sunset over mountains",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.projectId, VALID_PROJECT_ID);
    assert.strictEqual(result.value.imageUrl, "https://example.com/image.png");
  });

  it("returns VALIDATION_FAILED when prompt is empty string", async () => {
    const result = await useCase.execute({
      projectId: VALID_PROJECT_ID,
      prompt: "   ",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when projectId is not a valid UUID", async () => {
    const result = await useCase.execute({
      projectId: "not-a-uuid",
      prompt: "a sunset",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns INTERNAL_ERROR when image generator fails", async () => {
    generator.generateImage.mockResolvedValue(err("Provider unavailable"));
    const result = await useCase.execute({
      projectId: VALID_PROJECT_ID,
      prompt: "a sunset",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });

  it("returns INTERNAL_ERROR when repository save fails", async () => {
    repo.save.mockResolvedValue(err(new Error("DB write failed")));
    const result = await useCase.execute({
      projectId: VALID_PROJECT_ID,
      prompt: "a sunset",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });

  it("returns NOT_FOUND for a foreign/missing project and burns NO AI call and persists nothing", async () => {
    const foreignRepo = makeProjectRepo(false);
    useCase = new GenerateImageUseCase(repo, foreignRepo, generator);
    const result = await useCase.execute({
      projectId: VALID_PROJECT_ID,
      prompt: "a sunset over mountains",
    });
    assert.ok(!result.ok, "foreign project must fail");
    assert.strictEqual(result.error.code, "NOT_FOUND");
    assert.strictEqual(
      generator.generateImage.mock.calls.length,
      0,
      "the paid AI call must NOT be invoked for a foreign project"
    );
    assert.strictEqual(
      repo.save.mock.calls.length,
      0,
      "no row may be persisted for a foreign project"
    );
  });

  it("threads the resolved project's accountId onto the saved image", async () => {
    const result = await useCase.execute({
      projectId: VALID_PROJECT_ID,
      prompt: "a sunset over mountains",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(repo.save.mock.calls.length, 1);
    const savedData = repo.save.mock.calls[0]?.[0] as GeneratedImageData;
    assert.strictEqual(
      savedData.accountId,
      ACCOUNT_ID,
      "accountId must be threaded from the resolved project"
    );
    assert.strictEqual(result.value.accountId, ACCOUNT_ID);
  });
});
