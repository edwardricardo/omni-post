/**
 * @file GenerateLocalizedContentUseCase.test.ts
 * @description Unit tests for the localized content orchestrator. Mocks
 *              every collaborator so the pipeline is exercised
 *              end-to-end without network or DB. Covers: prompt
 *              assembly (locale-native imperative, glossary + style
 *              injection), embedding failure short-circuit, AI failure
 *              short-circuit, and the audit fields (`usedTerms`,
 *              `usedRules`).
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@shared/types";
import { GenerateLocalizedContentUseCase } from "@core/application/ai/GenerateLocalizedContentUseCase.js";
import { EmbeddingService } from "@core/application/embeddings/EmbeddingService.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import { localizedContentSpec } from "../../../../src/ai/structuredSchemas.js";
import type { SemanticRetrievalPort } from "@core/domain/repositories/SemanticRetrievalPort.js";
import type { BrandVoiceRepository } from "@core/domain/repositories/BrandVoiceRepository.js";

function makeAI(structured?: { content: string; rationale: string | null }) {
  return {
    generateEmbeddings: vi.fn().mockResolvedValue(ok([[0.1, 0.2, 0.3]])),
    generateStructured: vi
      .fn()
      .mockResolvedValue(ok(structured ?? { content: "Contenido generado", rationale: null })),
  } as unknown as AIServicePort;
}

function makeRetrieval(opts: {
  glossary?: Array<{
    id: string;
    term: string;
    definition: string;
    usage?: string | null;
    distance?: number;
  }>;
  style?: Array<{
    id: string;
    rule: string;
    example?: string | null;
    category?: string | null;
    distance?: number;
  }>;
}) {
  return {
    searchGlossary: vi.fn().mockResolvedValue(
      (opts.glossary ?? []).map((g) => ({
        id: g.id,
        term: g.term,
        definition: g.definition,
        usage: g.usage ?? null,
        distance: g.distance ?? 0.1,
      }))
    ),
    searchStyleGuide: vi.fn().mockResolvedValue(
      (opts.style ?? []).map((s) => ({
        id: s.id,
        rule: s.rule,
        example: s.example ?? null,
        category: s.category ?? null,
        distance: s.distance ?? 0.1,
      }))
    ),
  } as unknown as SemanticRetrievalPort;
}

function makeBrandVoice(systemPrompt: string | null) {
  return {
    findByAccountId: vi.fn().mockResolvedValue(
      systemPrompt
        ? {
            id: "bv-1",
            accountId: "acc-1",
            name: "Test brand voice",
            systemPrompt,
            tone: [],
            examples: [],
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null
    ),
  } as unknown as BrandVoiceRepository;
}

describe("GenerateLocalizedContentUseCase", () => {
  it("produces content + audit fields on the happy path", async () => {
    const ai = makeAI();
    const retrieval = makeRetrieval({
      glossary: [{ id: "g1", term: "Marca", definition: "Identidad comercial" }],
      style: [{ id: "s1", rule: "Usa primera persona del plural", category: "tone" }],
    });
    const useCase = new GenerateLocalizedContentUseCase(
      ai,
      new EmbeddingService(ai),
      retrieval,
      makeBrandVoice("Friendly voice"),
      localizedContentSpec,
      1536
    );

    const result = await useCase.execute({
      accountId: "acc-1",
      locale: "es",
      brief: "Anuncio de lanzamiento de producto",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe("Contenido generado");
      expect(result.value.usedTerms).toEqual(["g1"]);
      expect(result.value.usedRules).toEqual(["s1"]);
    }
  });

  it("instructs the model to write natively in the requested locale", async () => {
    const ai = makeAI();
    const retrieval = makeRetrieval({});
    const useCase = new GenerateLocalizedContentUseCase(
      ai,
      new EmbeddingService(ai),
      retrieval,
      makeBrandVoice(null),
      localizedContentSpec,
      1536
    );

    await useCase.execute({ accountId: "acc-1", locale: "es", brief: "Lanzamiento de producto" });

    const generateStructured = ai.generateStructured as ReturnType<typeof vi.fn>;
    const messages = generateStructured.mock.calls[0]?.[0] as Array<{
      role: string;
      content: string;
    }>;
    const systemMessage = messages.find((m) => m.role === "system");
    expect(systemMessage?.content).toMatch(/locale "es"/);
    expect(systemMessage?.content).toMatch(/Never translate/);
  });

  it("does NOT mention 'en' instruction when locale=es", async () => {
    const ai = makeAI();
    const retrieval = makeRetrieval({});
    const useCase = new GenerateLocalizedContentUseCase(
      ai,
      new EmbeddingService(ai),
      retrieval,
      makeBrandVoice(null),
      localizedContentSpec,
      1536
    );

    await useCase.execute({ accountId: "acc-1", locale: "es", brief: "Brief" });

    const generateStructured = ai.generateStructured as ReturnType<typeof vi.fn>;
    const messages = generateStructured.mock.calls[0]?.[0] as Array<{
      role: string;
      content: string;
    }>;
    const systemMessage = messages.find((m) => m.role === "system");
    expect(systemMessage?.content).not.toMatch(/locale "en"/);
  });

  it("injects the brand voice into the system prompt when available", async () => {
    const ai = makeAI();
    const useCase = new GenerateLocalizedContentUseCase(
      ai,
      new EmbeddingService(ai),
      makeRetrieval({}),
      makeBrandVoice("We are concise and confident"),
      localizedContentSpec,
      1536
    );

    await useCase.execute({ accountId: "acc-1", locale: "en", brief: "Quarterly review post" });

    const generateStructured = ai.generateStructured as ReturnType<typeof vi.fn>;
    const messages = generateStructured.mock.calls[0]?.[0] as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0]?.content).toContain("We are concise and confident");
  });

  it("degrades to brand-voice-only generation when embeddings are unavailable", async () => {
    const generateStructured = vi
      .fn()
      .mockResolvedValue(ok({ content: "Contenido sin RAG", rationale: null }));
    const ai = {
      generateEmbeddings: vi.fn().mockResolvedValue(err("AI_ERROR")),
      generateStructured,
    } as unknown as AIServicePort;
    const retrieval = makeRetrieval({
      glossary: [{ id: "g1", term: "Marca", definition: "Identidad" }],
      style: [{ id: "s1", rule: "Tono cercano" }],
    });
    const useCase = new GenerateLocalizedContentUseCase(
      ai,
      new EmbeddingService(ai),
      retrieval,
      makeBrandVoice("Friendly voice"),
      localizedContentSpec,
      1536
    );

    const result = await useCase.execute({ accountId: "acc-1", locale: "es", brief: "Brief" });

    // Generation still succeeds, but without semantic retrieval: the
    // glossary / style-guide search is skipped (no query embedding) and
    // the audit fields are empty to signal the missing grounding.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe("Contenido sin RAG");
      expect(result.value.usedTerms).toEqual([]);
      expect(result.value.usedRules).toEqual([]);
    }
    expect(retrieval.searchGlossary).not.toHaveBeenCalled();
    expect(retrieval.searchStyleGuide).not.toHaveBeenCalled();
    // Brand voice is still injected even in the degraded path.
    const messages = generateStructured.mock.calls[0]?.[0] as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0]?.content).toContain("Friendly voice");
  });

  it("returns a UseCaseError when the structured generation fails", async () => {
    const ai = {
      generateEmbeddings: vi.fn().mockResolvedValue(ok([[0.1, 0.2, 0.3]])),
      generateStructured: vi.fn().mockResolvedValue(err("AI_ERROR")),
    } as unknown as AIServicePort;
    const useCase = new GenerateLocalizedContentUseCase(
      ai,
      new EmbeddingService(ai),
      makeRetrieval({}),
      makeBrandVoice(null),
      localizedContentSpec,
      1536
    );

    const result = await useCase.execute({ accountId: "acc-1", locale: "es", brief: "Brief" });

    expect(result.ok).toBe(false);
  });
});
