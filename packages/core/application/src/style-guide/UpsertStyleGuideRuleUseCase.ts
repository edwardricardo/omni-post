/**
 * @file UpsertStyleGuideRuleUseCase.ts
 * @description Creates or updates a style-guide rule (per account +
 *              locale) and ensures its embedding is generated and
 *              persisted alongside the textual fields. Returns the saved
 *              rule with its `id`.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  StyleGuideRule,
  StyleGuideRuleRepository,
} from "@core/domain/repositories/StyleGuideRuleRepository.js";
import type { EmbeddingService } from "../embeddings/EmbeddingService.js";

export interface UpsertStyleGuideRuleInput {
  id?: string;
  accountId: string;
  locale: string;
  rule: string;
  example?: string | null;
  category?: string | null;
}

export interface UpsertStyleGuideRuleOutput {
  rule: StyleGuideRule;
  embeddingPersisted: boolean;
}

export class UpsertStyleGuideRuleUseCase implements UseCase<
  UpsertStyleGuideRuleInput,
  UpsertStyleGuideRuleOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: StyleGuideRuleRepository,
    private readonly embeddings: EmbeddingService,
    private readonly embeddingModel: string,
    private readonly embeddingDimensions: number
  ) {}

  async execute(
    input: UpsertStyleGuideRuleInput
  ): Promise<Result<UpsertStyleGuideRuleOutput, UseCaseError>> {
    try {
      const saved = await this.repository.upsert(input);
      if (!saved.ok) {
        return err(
          new UseCaseError("Failed to persist style-guide rule", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
      }

      const textToEmbed = input.example ? `${input.rule} — example: ${input.example}` : input.rule;

      const embeddingResult = await this.embeddings.embedSingle(
        textToEmbed,
        { dimensions: this.embeddingDimensions },
        input.accountId
      );

      if (!embeddingResult.ok) {
        return ok({ rule: saved.value, embeddingPersisted: false });
      }

      const stored = await this.repository.updateEmbedding(
        saved.value.id,
        embeddingResult.value,
        this.embeddingModel
      );
      if (!stored.ok) {
        return ok({ rule: saved.value, embeddingPersisted: false });
      }

      return ok({
        rule: {
          ...saved.value,
          embedding: embeddingResult.value,
          embeddingModel: this.embeddingModel,
        },
        embeddingPersisted: true,
      });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Unexpected failure while upserting style-guide rule",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
