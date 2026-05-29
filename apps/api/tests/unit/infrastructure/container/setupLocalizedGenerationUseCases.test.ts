/**
 * @file setupLocalizedGenerationUseCases.test.ts
 * @description Unit tests for the DI registration of the locale-native
 *              AI generation surface. Builds a real `Container`,
 *              pre-registers the two upstream collaborators
 *              (`AIServicePort`, `BrandVoiceRepository`) as stubs, runs
 *              the setup function, and asserts each of the 11 tokens
 *              resolves to an instance of the expected concrete class.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Container } from "../../../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../../../src/infrastructure/container/types.js";
import { setupLocalizedGenerationUseCases } from "../../../../src/infrastructure/container/setupLocalizedGenerationUseCases.js";
import { PrismaGlossaryRepository } from "../../../../src/infrastructure/repositories/PrismaGlossaryRepository.js";
import { PrismaStyleGuideRuleRepository } from "../../../../src/infrastructure/repositories/PrismaStyleGuideRuleRepository.js";
import { PrismaSemanticRetrievalAdapter } from "../../../../src/infrastructure/repositories/PrismaSemanticRetrievalAdapter.js";
import { EmbeddingService } from "@core/embeddings/EmbeddingService.js";
import { UpsertGlossaryTermUseCase } from "@core/glossary/UpsertGlossaryTermUseCase.js";
import { DeleteGlossaryTermUseCase } from "@core/glossary/DeleteGlossaryTermUseCase.js";
import { ListGlossaryByLocaleQuery } from "@core/glossary/ListGlossaryByLocaleQuery.js";
import { UpsertStyleGuideRuleUseCase } from "@core/style-guide/UpsertStyleGuideRuleUseCase.js";
import { DeleteStyleGuideRuleUseCase } from "@core/style-guide/DeleteStyleGuideRuleUseCase.js";
import { ListStyleGuideRulesByLocaleQuery } from "@core/style-guide/ListStyleGuideRulesByLocaleQuery.js";
import { GenerateLocalizedContentUseCase } from "@core/ai/GenerateLocalizedContentUseCase.js";

describe("setupLocalizedGenerationUseCases", () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
    container.registerInstance(TOKENS.AIServicePort, {} as never);
    container.registerInstance(TOKENS.BrandVoiceRepository, {} as never);
  });

  it("registers all 11 localized-generation tokens", () => {
    setupLocalizedGenerationUseCases(container);

    expect(container.has(TOKENS.GlossaryRepository)).toBe(true);
    expect(container.has(TOKENS.StyleGuideRuleRepository)).toBe(true);
    expect(container.has(TOKENS.SemanticRetrievalPort)).toBe(true);
    expect(container.has(TOKENS.EmbeddingService)).toBe(true);
    expect(container.has(TOKENS.UpsertGlossaryTermUseCase)).toBe(true);
    expect(container.has(TOKENS.DeleteGlossaryTermUseCase)).toBe(true);
    expect(container.has(TOKENS.ListGlossaryByLocaleQuery)).toBe(true);
    expect(container.has(TOKENS.UpsertStyleGuideRuleUseCase)).toBe(true);
    expect(container.has(TOKENS.DeleteStyleGuideRuleUseCase)).toBe(true);
    expect(container.has(TOKENS.ListStyleGuideRulesByLocaleQuery)).toBe(true);
    expect(container.has(TOKENS.GenerateLocalizedContentUseCase)).toBe(true);
  });

  it("resolves the repositories to their Prisma adapters", () => {
    setupLocalizedGenerationUseCases(container);

    expect(container.resolve(TOKENS.GlossaryRepository)).toBeInstanceOf(PrismaGlossaryRepository);
    expect(container.resolve(TOKENS.StyleGuideRuleRepository)).toBeInstanceOf(
      PrismaStyleGuideRuleRepository
    );
    expect(container.resolve(TOKENS.SemanticRetrievalPort)).toBeInstanceOf(
      PrismaSemanticRetrievalAdapter
    );
  });

  it("resolves the application services to their canonical classes", () => {
    setupLocalizedGenerationUseCases(container);

    expect(container.resolve(TOKENS.EmbeddingService)).toBeInstanceOf(EmbeddingService);
    expect(container.resolve(TOKENS.UpsertGlossaryTermUseCase)).toBeInstanceOf(
      UpsertGlossaryTermUseCase
    );
    expect(container.resolve(TOKENS.DeleteGlossaryTermUseCase)).toBeInstanceOf(
      DeleteGlossaryTermUseCase
    );
    expect(container.resolve(TOKENS.ListGlossaryByLocaleQuery)).toBeInstanceOf(
      ListGlossaryByLocaleQuery
    );
    expect(container.resolve(TOKENS.UpsertStyleGuideRuleUseCase)).toBeInstanceOf(
      UpsertStyleGuideRuleUseCase
    );
    expect(container.resolve(TOKENS.DeleteStyleGuideRuleUseCase)).toBeInstanceOf(
      DeleteStyleGuideRuleUseCase
    );
    expect(container.resolve(TOKENS.ListStyleGuideRulesByLocaleQuery)).toBeInstanceOf(
      ListStyleGuideRulesByLocaleQuery
    );
    expect(container.resolve(TOKENS.GenerateLocalizedContentUseCase)).toBeInstanceOf(
      GenerateLocalizedContentUseCase
    );
  });

  it("treats use-case registrations as singletons (same instance on repeated resolve)", () => {
    setupLocalizedGenerationUseCases(container);

    const first = container.resolve(TOKENS.GenerateLocalizedContentUseCase);
    const second = container.resolve(TOKENS.GenerateLocalizedContentUseCase);
    expect(first).toBe(second);
  });
});
