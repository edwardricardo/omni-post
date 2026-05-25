/**
 * @file UpsertStyleGuideRuleUseCase.test.ts
 * @description Unit tests for the style-guide upsert use case.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@shared/types";
import { UpsertStyleGuideRuleUseCase } from "@core/application/style-guide/UpsertStyleGuideRuleUseCase.js";
import { EmbeddingService } from "@core/application/embeddings/EmbeddingService.js";
import type {
  StyleGuideRule,
  StyleGuideRuleRepository,
} from "@core/domain/repositories/StyleGuideRuleRepository.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";

function makeRule(overrides: Partial<StyleGuideRule> = {}): StyleGuideRule {
  return {
    id: "rule-1",
    accountId: "acc-1",
    locale: "es",
    rule: "Usa primera persona del plural",
    example: null,
    category: "tone",
    embedding: null,
    embeddingModel: "text-embedding-3-small",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepo() {
  return {
    upsert: vi.fn().mockResolvedValue(ok(makeRule())),
    findById: vi.fn(),
    delete: vi.fn(),
    listByAccountLocale: vi.fn(),
    updateEmbedding: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

describe("UpsertStyleGuideRuleUseCase", () => {
  it("persists the rule and stores the generated embedding", async () => {
    const repo = makeRepo();
    const ai = {
      generateEmbeddings: vi.fn().mockResolvedValue(ok([[0.7, 0.8, 0.9]])),
    } as unknown as AIServicePort;
    const useCase = new UpsertStyleGuideRuleUseCase(
      repo as unknown as StyleGuideRuleRepository,
      new EmbeddingService(ai),
      "text-embedding-3-small",
      1536
    );

    const result = await useCase.execute({
      accountId: "acc-1",
      locale: "es",
      rule: "Usa primera persona del plural",
      category: "tone",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.embeddingPersisted).toBe(true);
      expect(result.value.rule.embedding).toEqual([0.7, 0.8, 0.9]);
    }
    expect(repo.upsert).toHaveBeenCalledTimes(1);
    expect(repo.updateEmbedding).toHaveBeenCalledTimes(1);
  });

  it("returns embeddingPersisted=false when the embeddings call fails", async () => {
    const repo = makeRepo();
    const failingAI = {
      generateEmbeddings: vi.fn().mockResolvedValue(err("AI_ERROR")),
    } as unknown as AIServicePort;
    const useCase = new UpsertStyleGuideRuleUseCase(
      repo as unknown as StyleGuideRuleRepository,
      new EmbeddingService(failingAI),
      "text-embedding-3-small",
      1536
    );

    const result = await useCase.execute({
      accountId: "acc-1",
      locale: "es",
      rule: "Usa primera persona del plural",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.embeddingPersisted).toBe(false);
    expect(repo.updateEmbedding).not.toHaveBeenCalled();
  });

  it("surfaces a UseCaseError when the repository upsert fails", async () => {
    const repo = makeRepo();
    repo.upsert.mockResolvedValueOnce(err("PERSISTENCE_ERROR"));
    const ai = { generateEmbeddings: vi.fn() } as unknown as AIServicePort;
    const useCase = new UpsertStyleGuideRuleUseCase(
      repo as unknown as StyleGuideRuleRepository,
      new EmbeddingService(ai),
      "text-embedding-3-small",
      1536
    );

    const result = await useCase.execute({
      accountId: "acc-1",
      locale: "es",
      rule: "Brief rule",
    });

    expect(result.ok).toBe(false);
  });
});
