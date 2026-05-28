/**
 * @file UpsertGlossaryTermUseCase.test.ts
 * @description Unit tests for the glossary upsert use case. Verifies
 *              that the embedding is generated and stored after the row
 *              is persisted, and that a failure inside the embeddings
 *              provider leaves the textual row intact with
 *              `embeddingPersisted: false`.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@shared/types";
import { UpsertGlossaryTermUseCase } from "@core/application/glossary/UpsertGlossaryTermUseCase.js";
import { EmbeddingService } from "@core/embeddings/EmbeddingService.js";
import type {
  GlossaryEntry,
  GlossaryRepository,
} from "@core/domain/repositories/GlossaryRepository.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";

function makeEntry(overrides: Partial<GlossaryEntry> = {}): GlossaryEntry {
  return {
    id: "glossary-1",
    accountId: "acc-1",
    locale: "es",
    term: "Marca",
    definition: "Identidad comercial",
    usage: null,
    embedding: null,
    embeddingModel: "text-embedding-3-small",
    createdAt: new Date("2026-05-21T00:00:00Z"),
    updatedAt: new Date("2026-05-21T00:00:00Z"),
    ...overrides,
  };
}

function makeRepo() {
  return {
    upsert: vi.fn().mockResolvedValue(ok(makeEntry())),
    findById: vi.fn(),
    delete: vi.fn(),
    listByAccountLocale: vi.fn(),
    updateEmbedding: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

describe("UpsertGlossaryTermUseCase", () => {
  it("persists the term and stores the generated embedding", async () => {
    const repo = makeRepo();
    const ai = {
      generateEmbeddings: vi.fn().mockResolvedValue(ok([[0.1, 0.2, 0.3]])),
    } as unknown as AIServicePort;
    const useCase = new UpsertGlossaryTermUseCase(
      repo as unknown as GlossaryRepository,
      new EmbeddingService(ai),
      "text-embedding-3-small",
      1536
    );

    const result = await useCase.execute({
      accountId: "acc-1",
      locale: "es",
      term: "Marca",
      definition: "Identidad comercial",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.embeddingPersisted).toBe(true);
      expect(result.value.entry.embedding).toEqual([0.1, 0.2, 0.3]);
    }
    expect(repo.upsert).toHaveBeenCalledTimes(1);
    expect(repo.updateEmbedding).toHaveBeenCalledTimes(1);
  });

  it("returns embeddingPersisted=false when the provider fails", async () => {
    const repo = makeRepo();
    const failingAI = {
      generateEmbeddings: vi.fn().mockResolvedValue(err("AI_ERROR")),
    } as unknown as AIServicePort;
    const useCase = new UpsertGlossaryTermUseCase(
      repo as unknown as GlossaryRepository,
      new EmbeddingService(failingAI),
      "text-embedding-3-small",
      1536
    );

    const result = await useCase.execute({
      accountId: "acc-1",
      locale: "es",
      term: "Marca",
      definition: "Identidad comercial",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.embeddingPersisted).toBe(false);
    expect(repo.updateEmbedding).not.toHaveBeenCalled();
  });

  it("surfaces a UseCaseError when the repository upsert fails", async () => {
    const repo = makeRepo();
    repo.upsert.mockResolvedValueOnce(err("PERSISTENCE_ERROR"));
    const ai = { generateEmbeddings: vi.fn() } as unknown as AIServicePort;
    const useCase = new UpsertGlossaryTermUseCase(
      repo as unknown as GlossaryRepository,
      new EmbeddingService(ai),
      "text-embedding-3-small",
      1536
    );

    const result = await useCase.execute({
      accountId: "acc-1",
      locale: "es",
      term: "Marca",
      definition: "Identidad comercial",
    });

    expect(result.ok).toBe(false);
  });
});
