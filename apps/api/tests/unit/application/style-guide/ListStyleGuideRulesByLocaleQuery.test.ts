/**
 * @file ListStyleGuideRulesByLocaleQuery.test.ts
 * @description Unit tests for the style-guide list query.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@shared/types";
import { ListStyleGuideRulesByLocaleQuery } from "../../../../src/application/style-guide/ListStyleGuideRulesByLocaleQuery.js";
import type {
  StyleGuideRule,
  StyleGuideRuleRepository,
} from "../../../../src/domain/repositories/StyleGuideRuleRepository.js";

function makeRule(overrides: Partial<StyleGuideRule> = {}): StyleGuideRule {
  return {
    id: "rule-1",
    accountId: "acc-1",
    locale: "en",
    rule: "Prefer active voice",
    example: null,
    category: "grammar",
    embedding: null,
    embeddingModel: "text-embedding-3-small",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("ListStyleGuideRulesByLocaleQuery", () => {
  it("forwards (accountId, locale) to the repository and returns the rules", async () => {
    const repo = {
      upsert: vi.fn(),
      findById: vi.fn(),
      delete: vi.fn(),
      listByAccountLocale: vi
        .fn()
        .mockResolvedValue(ok([makeRule(), makeRule({ id: "rule-2", rule: "Avoid jargon" })])),
      updateEmbedding: vi.fn(),
    };
    const useCase = new ListStyleGuideRulesByLocaleQuery(
      repo as unknown as StyleGuideRuleRepository
    );

    const result = await useCase.execute({ accountId: "acc-1", locale: "en" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rules).toHaveLength(2);
    expect(repo.listByAccountLocale).toHaveBeenCalledWith("acc-1", "en");
  });

  it("surfaces a UseCaseError when the repository fails", async () => {
    const repo = {
      upsert: vi.fn(),
      findById: vi.fn(),
      delete: vi.fn(),
      listByAccountLocale: vi.fn().mockResolvedValue(err("PERSISTENCE_ERROR")),
      updateEmbedding: vi.fn(),
    };
    const useCase = new ListStyleGuideRulesByLocaleQuery(
      repo as unknown as StyleGuideRuleRepository
    );

    const result = await useCase.execute({ accountId: "acc-1", locale: "en" });

    expect(result.ok).toBe(false);
  });
});
