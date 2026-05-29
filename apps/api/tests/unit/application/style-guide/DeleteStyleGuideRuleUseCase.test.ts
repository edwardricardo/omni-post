/**
 * @file DeleteStyleGuideRuleUseCase.test.ts
 * @description Unit tests for the style-guide delete use case.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@shared/types";
import { DeleteStyleGuideRuleUseCase } from "@core/style-guide/DeleteStyleGuideRuleUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { StyleGuideRuleRepository } from "@core/domain/repositories/StyleGuideRuleRepository.js";

function makeRepo() {
  return {
    upsert: vi.fn(),
    findById: vi.fn(),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    listByAccountLocale: vi.fn(),
    updateEmbedding: vi.fn(),
  };
}

describe("DeleteStyleGuideRuleUseCase", () => {
  it("returns ok on a successful delete", async () => {
    const repo = makeRepo();
    const useCase = new DeleteStyleGuideRuleUseCase(repo as unknown as StyleGuideRuleRepository);

    const result = await useCase.execute({ id: "rule-1" });

    expect(result.ok).toBe(true);
    expect(repo.delete).toHaveBeenCalledWith("rule-1");
  });

  it("maps NOT_FOUND to USE_CASE_ERRORS.NOT_FOUND", async () => {
    const repo = makeRepo();
    repo.delete.mockResolvedValueOnce(err("NOT_FOUND"));
    const useCase = new DeleteStyleGuideRuleUseCase(repo as unknown as StyleGuideRuleRepository);

    const result = await useCase.execute({ id: "missing" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
  });

  it("maps PERSISTENCE_ERROR to USE_CASE_ERRORS.INTERNAL_ERROR", async () => {
    const repo = makeRepo();
    repo.delete.mockResolvedValueOnce(err("PERSISTENCE_ERROR"));
    const useCase = new DeleteStyleGuideRuleUseCase(repo as unknown as StyleGuideRuleRepository);

    const result = await useCase.execute({ id: "rule-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
  });
});
