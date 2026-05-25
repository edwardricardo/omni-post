/**
 * @file setupLocalizedGenerationUseCases.ts
 * @description DI registrations for the locale-native AI generation
 *              subsystem: per-locale glossary + style-guide repositories,
 *              the embeddings application service, the semantic retrieval
 *              port, the upsert/list/delete use cases, and the
 *              `GenerateLocalizedContentUseCase` orchestrator.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import { env } from "../../config/env.js";
import { localizedContentSpec } from "../../ai/structuredSchemas.js";

import type { GlossaryRepository } from "../../domain/repositories/GlossaryRepository.js";
import type { StyleGuideRuleRepository } from "../../domain/repositories/StyleGuideRuleRepository.js";
import type { SemanticRetrievalPort } from "../../domain/repositories/SemanticRetrievalPort.js";
import type { AIServicePort } from "../../domain/repositories/AIServicePort.js";
import type { BrandVoiceRepository } from "../../domain/repositories/BrandVoiceRepository.js";

import { PrismaGlossaryRepository } from "../repositories/PrismaGlossaryRepository.js";
import { PrismaStyleGuideRuleRepository } from "../repositories/PrismaStyleGuideRuleRepository.js";
import { PrismaSemanticRetrievalAdapter } from "../repositories/PrismaSemanticRetrievalAdapter.js";

import { EmbeddingService } from "../../application/embeddings/EmbeddingService.js";
import { UpsertGlossaryTermUseCase } from "../../application/glossary/UpsertGlossaryTermUseCase.js";
import { DeleteGlossaryTermUseCase } from "../../application/glossary/DeleteGlossaryTermUseCase.js";
import { ListGlossaryByLocaleQuery } from "../../application/glossary/ListGlossaryByLocaleQuery.js";
import { UpsertStyleGuideRuleUseCase } from "../../application/style-guide/UpsertStyleGuideRuleUseCase.js";
import { DeleteStyleGuideRuleUseCase } from "../../application/style-guide/DeleteStyleGuideRuleUseCase.js";
import { ListStyleGuideRulesByLocaleQuery } from "../../application/style-guide/ListStyleGuideRulesByLocaleQuery.js";
import { GenerateLocalizedContentUseCase } from "../../application/ai/GenerateLocalizedContentUseCase.js";

/**
 * @method setupLocalizedGenerationUseCases
 * @description Registers the localized AI generation surface against the
 *   shared Prisma client + AIServicePort. Singleton lifecycle for every
 *   token.
 */
export function setupLocalizedGenerationUseCases(container: Container): void {
  container.registerInstance<GlossaryRepository>(
    TOKENS.GlossaryRepository,
    new PrismaGlossaryRepository(prisma)
  );

  container.registerInstance<StyleGuideRuleRepository>(
    TOKENS.StyleGuideRuleRepository,
    new PrismaStyleGuideRuleRepository(prisma)
  );

  container.registerInstance<SemanticRetrievalPort>(
    TOKENS.SemanticRetrievalPort,
    new PrismaSemanticRetrievalAdapter(prisma)
  );

  container.register<EmbeddingService>(
    TOKENS.EmbeddingService,
    () => new EmbeddingService(container.resolve<AIServicePort>(TOKENS.AIServicePort)),
    true
  );

  container.register<UpsertGlossaryTermUseCase>(
    TOKENS.UpsertGlossaryTermUseCase,
    () =>
      new UpsertGlossaryTermUseCase(
        container.resolve<GlossaryRepository>(TOKENS.GlossaryRepository),
        container.resolve<EmbeddingService>(TOKENS.EmbeddingService),
        env.OPENAI_EMBEDDINGS_MODEL,
        env.EMBEDDINGS_DIMENSIONS
      ),
    true
  );

  container.register<DeleteGlossaryTermUseCase>(
    TOKENS.DeleteGlossaryTermUseCase,
    () =>
      new DeleteGlossaryTermUseCase(
        container.resolve<GlossaryRepository>(TOKENS.GlossaryRepository)
      ),
    true
  );

  container.register<ListGlossaryByLocaleQuery>(
    TOKENS.ListGlossaryByLocaleQuery,
    () =>
      new ListGlossaryByLocaleQuery(
        container.resolve<GlossaryRepository>(TOKENS.GlossaryRepository)
      ),
    true
  );

  container.register<UpsertStyleGuideRuleUseCase>(
    TOKENS.UpsertStyleGuideRuleUseCase,
    () =>
      new UpsertStyleGuideRuleUseCase(
        container.resolve<StyleGuideRuleRepository>(TOKENS.StyleGuideRuleRepository),
        container.resolve<EmbeddingService>(TOKENS.EmbeddingService),
        env.OPENAI_EMBEDDINGS_MODEL,
        env.EMBEDDINGS_DIMENSIONS
      ),
    true
  );

  container.register<DeleteStyleGuideRuleUseCase>(
    TOKENS.DeleteStyleGuideRuleUseCase,
    () =>
      new DeleteStyleGuideRuleUseCase(
        container.resolve<StyleGuideRuleRepository>(TOKENS.StyleGuideRuleRepository)
      ),
    true
  );

  container.register<ListStyleGuideRulesByLocaleQuery>(
    TOKENS.ListStyleGuideRulesByLocaleQuery,
    () =>
      new ListStyleGuideRulesByLocaleQuery(
        container.resolve<StyleGuideRuleRepository>(TOKENS.StyleGuideRuleRepository)
      ),
    true
  );

  container.register<GenerateLocalizedContentUseCase>(
    TOKENS.GenerateLocalizedContentUseCase,
    () =>
      new GenerateLocalizedContentUseCase(
        container.resolve<AIServicePort>(TOKENS.AIServicePort),
        container.resolve<EmbeddingService>(TOKENS.EmbeddingService),
        container.resolve<SemanticRetrievalPort>(TOKENS.SemanticRetrievalPort),
        container.resolve<BrandVoiceRepository>(TOKENS.BrandVoiceRepository),
        localizedContentSpec,
        env.EMBEDDINGS_DIMENSIONS
      ),
    true
  );
}
