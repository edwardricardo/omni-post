/**
 * @file GetBrandVoiceQuery.ts
 * @description Returns the brand voice configuration for an account, or null if not set.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  type BrandVoiceRepository,
  type BrandVoiceData,
} from "../../domain/repositories/BrandVoiceRepository.js";

export interface GetBrandVoiceInput {
  accountId: string;
}

export type GetBrandVoiceOutput = BrandVoiceData | null;

export class GetBrandVoiceQuery implements UseCase<
  GetBrandVoiceInput,
  GetBrandVoiceOutput,
  UseCaseError
> {
  constructor(private readonly repository: BrandVoiceRepository) {}

  /**
   * @method execute
   * @description Retrieves the brand voice for an account. Returns null when none configured.
   */
  async execute(input: GetBrandVoiceInput): Promise<Result<GetBrandVoiceOutput, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const brandVoice = await this.repository.findByAccountId(input.accountId);
    return ok(brandVoice);
  }
}
