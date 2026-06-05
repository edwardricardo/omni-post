/**
 * @file UpsertStyleGuideRuleUseCase.test.ts
 * @description Unit tests for UpsertStyleGuideRuleUseCase — validates rule
 *   persistence, embedding generation, and graceful degradation when embedding
 *   service fails.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { UpsertStyleGuideRuleUseCase } from "../../src/UpsertStyleGuideRuleUseCase.js";
import type { StyleGuideRule } from "@core/domain/repositories/StyleGuideRuleRepository.js";

const makeSavedRule = (overrides?: Partial<StyleGuideRule>): StyleGuideRule => ({
  id: "rule-uuid-001",
  accountId: "acct-uuid-001",
  locale: "en-US",
  rule: "Use active voice whenever possible.",
  example: null,
  category: "grammar",
  embedding: null,
  embeddingModel: "",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});

const makeRepo = () => ({
  upsert: vi.fn().mockResolvedValue(ok(makeSavedRule())),
  findById: vi.fn(),
  delete: vi.fn(),
  findByAccountIdAndLocale: vi.fn(),
  updateEmbedding: vi.fn().mockResolvedValue(ok(undefined)),
});

const makeEmbeddingService = () => ({
  embed: vi.fn(),
  embedSingle: vi.fn().mockResolvedValue(ok([0.1, 0.2, 0.3])),
});

const makeValidInput = () => ({
  accountId: "acct-uuid-001",
  locale: "en-US",
  rule: "Use active voice whenever possible.",
  category: "grammar" as string | null | undefined,
});

describe("UpsertStyleGuideRuleUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let embeddingService: ReturnType<typeof makeEmbeddingService>;
  let useCase: UpsertStyleGuideRuleUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    embeddingService = makeEmbeddingService();
    useCase = new UpsertStyleGuideRuleUseCase(
      repo,
      embeddingService,
      "text-embedding-3-small",
      1536
    );
  });

  it("returns ok with rule and embeddingPersisted=true when everything succeeds", async () => {
    const result = await useCase.execute(makeValidInput());
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.embeddingPersisted, true);
    assert.strictEqual(result.value.rule.id, "rule-uuid-001");
  });

  it("returns ok with embeddingPersisted=false when embedding service fails", async () => {
    embeddingService.embedSingle.mockResolvedValue(
      err({ code: "INTERNAL_ERROR", message: "AI service unavailable" })
    );
    const result = await useCase.execute(makeValidInput());
    assert.ok(result.ok, "Expected ok result — rule saved even if embedding fails");
    assert.strictEqual(result.value.embeddingPersisted, false);
  });

  it("returns ok with embeddingPersisted=false when updateEmbedding fails", async () => {
    repo.updateEmbedding.mockResolvedValue(err("PERSISTENCE_ERROR"));
    const result = await useCase.execute(makeValidInput());
    assert.ok(result.ok, "Expected ok result — rule saved even if embedding storage fails");
    assert.strictEqual(result.value.embeddingPersisted, false);
  });

  it("returns INTERNAL_ERROR when repo.upsert fails", async () => {
    repo.upsert.mockResolvedValue(err("PERSISTENCE_ERROR"));
    const result = await useCase.execute(makeValidInput());
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });
});
