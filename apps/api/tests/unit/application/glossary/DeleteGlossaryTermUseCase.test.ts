/**
 * @file DeleteGlossaryTermUseCase.test.ts
 * @description Unit tests for the glossary delete use case. Verifies
 *              that successful deletes return ok and that the
 *              repository's NOT_FOUND outcome is mapped to the typed
 *              `USE_CASE_ERRORS.NOT_FOUND` code.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@shared/types";
import { DeleteGlossaryTermUseCase } from "../../../../src/application/glossary/DeleteGlossaryTermUseCase.js";
import { USE_CASE_ERRORS } from "../../../../src/application/UseCase.js";
import type { GlossaryRepository } from "../../../../src/domain/repositories/GlossaryRepository.js";

function makeRepo() {
  return {
    upsert: vi.fn(),
    findById: vi.fn(),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    listByAccountLocale: vi.fn(),
    updateEmbedding: vi.fn(),
  };
}

describe("DeleteGlossaryTermUseCase", () => {
  it("returns ok on a successful delete", async () => {
    const repo = makeRepo();
    const useCase = new DeleteGlossaryTermUseCase(repo as unknown as GlossaryRepository);

    const result = await useCase.execute({ id: "glossary-1" });

    expect(result.ok).toBe(true);
    expect(repo.delete).toHaveBeenCalledWith("glossary-1");
  });

  it("maps the repository's NOT_FOUND outcome to USE_CASE_ERRORS.NOT_FOUND", async () => {
    const repo = makeRepo();
    repo.delete.mockResolvedValueOnce(err("NOT_FOUND"));
    const useCase = new DeleteGlossaryTermUseCase(repo as unknown as GlossaryRepository);

    const result = await useCase.execute({ id: "missing" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
  });

  it("maps PERSISTENCE_ERROR to USE_CASE_ERRORS.INTERNAL_ERROR", async () => {
    const repo = makeRepo();
    repo.delete.mockResolvedValueOnce(err("PERSISTENCE_ERROR"));
    const useCase = new DeleteGlossaryTermUseCase(repo as unknown as GlossaryRepository);

    const result = await useCase.execute({ id: "glossary-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
  });
});
