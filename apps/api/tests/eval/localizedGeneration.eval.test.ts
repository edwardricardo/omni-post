/**
 * @file localizedGeneration.eval.test.ts
 * @description Trajectory eval for the locale-native generation
 *              pipeline. Runs the same use case twice with `locale: es`
 *              and `locale: en` against fully deterministic mocks and
 *              asserts:
 *                - System prompt carries the canonical locale-native
 *                  instruction for the requested locale.
 *                - Glossary terms for the requested locale are
 *                  injected; terms from another locale never leak.
 *                - AI-call budget upper bound: 1 embedding + 1
 *                  structured generate per run.
 *
 *              Failure of any assertion blocks merge.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { ok } from "@shared/types";
import { GenerateLocalizedContentUseCase } from "@core/application/ai/GenerateLocalizedContentUseCase.js";
import { EmbeddingService } from "@core/application/embeddings/EmbeddingService.js";
import type { AIServicePort } from "../../src/domain/repositories/AIServicePort.js";
import { localizedContentSpec } from "../../src/ai/structuredSchemas.js";
import type { SemanticRetrievalPort } from "../../src/domain/repositories/SemanticRetrievalPort.js";
import type { BrandVoiceRepository } from "../../src/domain/repositories/BrandVoiceRepository.js";

const MAX_LOCALIZED_AI_CALLS_PER_RUN = 2; // 1 embedding + 1 structured

function makeAI() {
  const generateEmbeddings = vi.fn().mockResolvedValue(ok([[0.1, 0.2, 0.3]]));
  const generateStructured = vi
    .fn()
    .mockResolvedValue(ok({ content: "Contenido", rationale: null }));
  const ai = {
    generateEmbeddings,
    generateStructured,
  } as unknown as AIServicePort;
  return { ai, generateEmbeddings, generateStructured };
}

const GLOSSARY_BY_LOCALE = {
  es: [
    { id: "g-es-1", term: "Marca", definition: "Identidad comercial", usage: null, distance: 0.1 },
  ],
  en: [
    { id: "g-en-1", term: "Brand", definition: "Commercial identity", usage: null, distance: 0.1 },
  ],
} as const;

const STYLE_BY_LOCALE = {
  es: [
    {
      id: "s-es-1",
      rule: "Usa primera persona del plural",
      example: null,
      category: "tone",
      distance: 0.1,
    },
  ],
  en: [
    {
      id: "s-en-1",
      rule: "Prefer active voice",
      example: null,
      category: "grammar",
      distance: 0.1,
    },
  ],
} as const;

function makeRetrieval(): SemanticRetrievalPort {
  return {
    searchGlossary: vi.fn(async (q) => [...(GLOSSARY_BY_LOCALE[q.locale as "es" | "en"] ?? [])]),
    searchStyleGuide: vi.fn(async (q) => [...(STYLE_BY_LOCALE[q.locale as "es" | "en"] ?? [])]),
  };
}

function makeBrandVoice(): BrandVoiceRepository {
  return {
    findByAccountId: vi.fn().mockResolvedValue(null),
  } as unknown as BrandVoiceRepository;
}

describe("trajectory eval — localized generation", () => {
  it("system prompt carries the es-native instruction when locale=es", async () => {
    const { ai, generateStructured } = makeAI();
    const useCase = new GenerateLocalizedContentUseCase(
      ai,
      new EmbeddingService(ai),
      makeRetrieval(),
      makeBrandVoice(),
      localizedContentSpec,
      1536
    );

    await useCase.execute({ accountId: "acc-1", locale: "es", brief: "Anuncio de lanzamiento" });

    const messages = generateStructured.mock.calls[0]?.[0] as Array<{
      role: string;
      content: string;
    }>;
    const system = messages.find((m) => m.role === "system");
    expect(system?.content).toMatch(/locale "es"/);
    expect(system?.content).toMatch(/Never translate/);
  });

  it("system prompt carries the en-native instruction when locale=en", async () => {
    const { ai, generateStructured } = makeAI();
    const useCase = new GenerateLocalizedContentUseCase(
      ai,
      new EmbeddingService(ai),
      makeRetrieval(),
      makeBrandVoice(),
      localizedContentSpec,
      1536
    );

    await useCase.execute({ accountId: "acc-1", locale: "en", brief: "Launch announcement" });

    const messages = generateStructured.mock.calls[0]?.[0] as Array<{
      role: string;
      content: string;
    }>;
    const system = messages.find((m) => m.role === "system");
    expect(system?.content).toMatch(/locale "en"/);
    expect(system?.content).toMatch(/Never translate/);
  });

  it("injects ONLY the glossary terms of the requested locale (no cross-locale leak)", async () => {
    const { ai, generateStructured } = makeAI();
    const useCase = new GenerateLocalizedContentUseCase(
      ai,
      new EmbeddingService(ai),
      makeRetrieval(),
      makeBrandVoice(),
      localizedContentSpec,
      1536
    );

    await useCase.execute({ accountId: "acc-1", locale: "es", brief: "Brief" });

    const messages = generateStructured.mock.calls[0]?.[0] as Array<{
      role: string;
      content: string;
    }>;
    const system = messages.find((m) => m.role === "system");
    expect(system?.content).toContain("Marca");
    expect(system?.content).toContain("Identidad comercial");
    expect(system?.content).not.toContain("Brand");
    expect(system?.content).not.toContain("Commercial identity");
  });

  it("keeps per-run AI-call cost within the canonical budget (≤ 2 calls)", async () => {
    const { ai, generateEmbeddings, generateStructured } = makeAI();
    const useCase = new GenerateLocalizedContentUseCase(
      ai,
      new EmbeddingService(ai),
      makeRetrieval(),
      makeBrandVoice(),
      localizedContentSpec,
      1536
    );

    await useCase.execute({ accountId: "acc-1", locale: "es", brief: "Brief" });

    const totalAiCalls =
      generateEmbeddings.mock.calls.length + generateStructured.mock.calls.length;
    expect(
      totalAiCalls,
      `localized generation cost regression: ${totalAiCalls} > ${MAX_LOCALIZED_AI_CALLS_PER_RUN}`
    ).toBeLessThanOrEqual(MAX_LOCALIZED_AI_CALLS_PER_RUN);
    expect(generateEmbeddings).toHaveBeenCalledTimes(1);
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it("returns the audit fields (usedTerms / usedRules) for transparency", async () => {
    const { ai } = makeAI();
    const useCase = new GenerateLocalizedContentUseCase(
      ai,
      new EmbeddingService(ai),
      makeRetrieval(),
      makeBrandVoice(),
      localizedContentSpec,
      1536
    );

    const result = await useCase.execute({
      accountId: "acc-1",
      locale: "es",
      brief: "Brief",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.usedTerms).toEqual(["g-es-1"]);
      expect(result.value.usedRules).toEqual(["s-es-1"]);
    }
  });
});
