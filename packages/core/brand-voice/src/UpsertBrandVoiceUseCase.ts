/**
 * @file UpsertBrandVoiceUseCase.ts
 * @description Creates or updates the brand voice configuration for an account.
 *              Enforces validation rules: systemPrompt max 2000 chars, name required.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  type BrandVoiceRepository,
  type BrandVoiceData,
} from "@core/domain/repositories/BrandVoiceRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface UpsertBrandVoiceInput {
  accountId: string;
  name: string;
  systemPrompt: string;
  tone?: string[];
  examples?: string[];
  isActive?: boolean;
}

export class UpsertBrandVoiceUseCase implements UseCase<
  UpsertBrandVoiceInput,
  BrandVoiceData,
  UseCaseError
> {
  private static readonly MAX_SYSTEM_PROMPT_LENGTH = 2000;
  private static readonly MAX_NAME_LENGTH = 100;

  constructor(
    private readonly repository: BrandVoiceRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates and upserts the brand voice. One brand voice per account (unique constraint).
   */
  async execute(input: UpsertBrandVoiceInput): Promise<Result<BrandVoiceData, UseCaseError>> {
    const validationError = this.validate(input);
    if (validationError) {
      return err(validationError);
    }

    const doWork = async (): Promise<Result<BrandVoiceData, UseCaseError>> => {
      const data = await this.repository.upsert({
        accountId: input.accountId,
        name: input.name.trim(),
        systemPrompt: input.systemPrompt.trim(),
        tone: input.tone ?? [],
        examples: input.examples ?? [],
        isActive: input.isActive ?? true,
      });

      return ok(data);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<BrandVoiceData, UseCaseError> = err(
          new UseCaseError("Transaction not executed", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to upsert brand voice",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private validate(input: UpsertBrandVoiceInput): UseCaseError | null {
    if (!input.accountId) {
      return new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED);
    }
    if (!input.name || input.name.trim().length === 0) {
      return new UseCaseError("name is required", USE_CASE_ERRORS.VALIDATION_FAILED);
    }
    if (input.name.trim().length > UpsertBrandVoiceUseCase.MAX_NAME_LENGTH) {
      return new UseCaseError(
        `name must be at most ${UpsertBrandVoiceUseCase.MAX_NAME_LENGTH} characters`,
        USE_CASE_ERRORS.VALIDATION_FAILED
      );
    }
    if (!input.systemPrompt || input.systemPrompt.trim().length === 0) {
      return new UseCaseError("systemPrompt is required", USE_CASE_ERRORS.VALIDATION_FAILED);
    }
    if (input.systemPrompt.trim().length > UpsertBrandVoiceUseCase.MAX_SYSTEM_PROMPT_LENGTH) {
      return new UseCaseError(
        `systemPrompt must be at most ${UpsertBrandVoiceUseCase.MAX_SYSTEM_PROMPT_LENGTH} characters`,
        USE_CASE_ERRORS.VALIDATION_FAILED
      );
    }
    return null;
  }
}
