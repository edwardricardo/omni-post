/**
 * @file UpsertGlossaryTermUseCase.ts
 * @description Creates or updates a glossary entry (per account + locale)
 *              and ensures its embedding is generated and persisted
 *              alongside the textual fields. Returns the saved entry
 *              with its `id` so callers can correlate later mutations.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  GlossaryEntry,
  GlossaryRepository,
} from "../../domain/repositories/GlossaryRepository.js";
import type { EmbeddingService } from "../embeddings/EmbeddingService.js";
import { env } from "../../config/env.js";

export interface UpsertGlossaryTermInput {
  accountId: string;
  locale: string;
  term: string;
  definition: string;
  usage?: string | null;
}

export interface UpsertGlossaryTermOutput {
  entry: GlossaryEntry;
  embeddingPersisted: boolean;
}

export class UpsertGlossaryTermUseCase implements UseCase<
  UpsertGlossaryTermInput,
  UpsertGlossaryTermOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: GlossaryRepository,
    private readonly embeddings: EmbeddingService
  ) {}

  async execute(
    input: UpsertGlossaryTermInput
  ): Promise<Result<UpsertGlossaryTermOutput, UseCaseError>> {
    try {
      const saved = await this.repository.upsert(input);
      if (!saved.ok) {
        return err(
          new UseCaseError("Failed to persist glossary term", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
      }

      const textToEmbed = input.usage
        ? `${input.term}: ${input.definition} — ${input.usage}`
        : `${input.term}: ${input.definition}`;

      const embeddingModel = env.OPENAI_EMBEDDINGS_MODEL;
      const dimensions = env.EMBEDDINGS_DIMENSIONS;
      const embeddingResult = await this.embeddings.embedSingle(
        textToEmbed,
        { dimensions },
        input.accountId
      );

      if (!embeddingResult.ok) {
        // Embedding failure is non-fatal: the textual entry is saved and
        // can be re-embedded later by a background job. The use case
        // surfaces `embeddingPersisted: false` so the caller can decide.
        return ok({ entry: saved.value, embeddingPersisted: false });
      }

      const stored = await this.repository.updateEmbedding(
        saved.value.id,
        embeddingResult.value,
        embeddingModel
      );
      if (!stored.ok) {
        return ok({ entry: saved.value, embeddingPersisted: false });
      }

      return ok({
        entry: { ...saved.value, embedding: embeddingResult.value, embeddingModel },
        embeddingPersisted: true,
      });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Unexpected failure while upserting glossary term",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
