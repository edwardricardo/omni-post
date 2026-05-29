/**
 * @file ListStyleGuideRulesByLocaleQuery.ts
 * @description Lists style-guide rules for an `(accountId, locale)`
 *              pair. Read-only — no UnitOfWork. Adapter returns rules
 *              ordered by createdAt ascending.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  StyleGuideRule,
  StyleGuideRuleRepository,
} from "@core/domain/repositories/StyleGuideRuleRepository.js";

export interface ListStyleGuideRulesByLocaleInput {
  accountId: string;
  locale: string;
}

export interface ListStyleGuideRulesByLocaleOutput {
  rules: StyleGuideRule[];
}

export class ListStyleGuideRulesByLocaleQuery implements UseCase<
  ListStyleGuideRulesByLocaleInput,
  ListStyleGuideRulesByLocaleOutput,
  UseCaseError
> {
  constructor(private readonly repository: StyleGuideRuleRepository) {}

  async execute(
    input: ListStyleGuideRulesByLocaleInput
  ): Promise<Result<ListStyleGuideRulesByLocaleOutput, UseCaseError>> {
    const result = await this.repository.listByAccountLocale(input.accountId, input.locale);
    if (result.ok) return ok({ rules: result.value });
    return err(
      new UseCaseError("Failed to list style-guide rules", USE_CASE_ERRORS.INTERNAL_ERROR)
    );
  }
}
