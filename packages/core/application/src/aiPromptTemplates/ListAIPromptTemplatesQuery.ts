/**
 * @file ListAIPromptTemplatesQuery.ts
 * @description Query handler for listing AI prompt templates. Returns system templates
 *   plus account-specific templates when an accountId is provided.
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import { type UseCase, UseCaseError } from "../UseCase.js";
import type { AIPromptTemplateRepository } from "@core/domain/repositories/AIPromptTemplateRepository.js";
import {
  type AIPromptTemplateDto,
  type ListAIPromptTemplatesInput,
  type TemplateVariableDto,
} from "./types.js";

/**
 * @class ListAIPromptTemplatesQuery
 * @description Returns all system templates plus account-specific templates.
 */
export class ListAIPromptTemplatesQuery implements UseCase<
  ListAIPromptTemplatesInput,
  AIPromptTemplateDto[],
  UseCaseError
> {
  constructor(private readonly repository: AIPromptTemplateRepository) {}

  /**
   * @method execute
   * @description Fetches system templates and optionally account templates.
   * @param input - Optional accountId to include account-specific templates
   * @returns Result containing array of AIPromptTemplateDto
   */
  async execute(
    input: ListAIPromptTemplatesInput
  ): Promise<Result<AIPromptTemplateDto[], UseCaseError>> {
    const rows = await this.repository.findAll(input.accountId);

    const dtos: AIPromptTemplateDto[] = rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      category: row.category,
      platforms: row.platforms,
      prompt: row.prompt,
      variables: row.variables as TemplateVariableDto[],
      tone: row.tone,
      isSystem: row.isSystem,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    return ok(dtos);
  }
}
