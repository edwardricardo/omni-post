/**
 * @file ListGlossaryByLocaleQuery.test.ts
 * @description Unit tests for the glossary list query. Verifies the
 *              account + locale arguments are forwarded to the
 *              repository and that the page is surfaced as the use-case
 *              output.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@shared/types";
import { ListGlossaryByLocaleQuery } from "@core/application/glossary/ListGlossaryByLocaleQuery.js";
import type {
  GlossaryEntry,
  GlossaryRepository,
} from "@core/domain/repositories/GlossaryRepository.js";

function makeEntry(overrides: Partial<GlossaryEntry> = {}): GlossaryEntry {
  return {
    id: "g-1",
    accountId: "acc-1",
    locale: "es",
    term: "Marca",
    definition: "Identidad",
    usage: null,
    embedding: null,
    embeddingModel: "text-embedding-3-small",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("ListGlossaryByLocaleQuery", () => {
  it("forwards (accountId, locale) to the repository and returns the page", async () => {
    const repo = {
      upsert: vi.fn(),
      findById: vi.fn(),
      delete: vi.fn(),
      listByAccountLocale: vi
        .fn()
        .mockResolvedValue(ok([makeEntry(), makeEntry({ id: "g-2", term: "Voz" })])),
      updateEmbedding: vi.fn(),
    };
    const useCase = new ListGlossaryByLocaleQuery(repo as unknown as GlossaryRepository);

    const result = await useCase.execute({ accountId: "acc-1", locale: "es" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entries).toHaveLength(2);
    expect(repo.listByAccountLocale).toHaveBeenCalledWith("acc-1", "es");
  });

  it("surfaces a UseCaseError when the repository fails", async () => {
    const repo = {
      upsert: vi.fn(),
      findById: vi.fn(),
      delete: vi.fn(),
      listByAccountLocale: vi.fn().mockResolvedValue(err("PERSISTENCE_ERROR")),
      updateEmbedding: vi.fn(),
    };
    const useCase = new ListGlossaryByLocaleQuery(repo as unknown as GlossaryRepository);

    const result = await useCase.execute({ accountId: "acc-1", locale: "es" });

    expect(result.ok).toBe(false);
  });
});
