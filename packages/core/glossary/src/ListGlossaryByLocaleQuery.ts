/**
 * @file ListGlossaryByLocaleQuery.ts
 * @description Lists glossary entries for an `(accountId, locale)` pair.
 *              Read-only — no UnitOfWork. Returns the entries ordered by
 *              term ascending (canonical adapter order).
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  GlossaryEntry,
  GlossaryRepository,
} from "@core/domain/repositories/GlossaryRepository.js";

export interface ListGlossaryByLocaleInput {
  accountId: string;
  locale: string;
}

export interface ListGlossaryByLocaleOutput {
  entries: GlossaryEntry[];
}

export class ListGlossaryByLocaleQuery implements UseCase<
  ListGlossaryByLocaleInput,
  ListGlossaryByLocaleOutput,
  UseCaseError
> {
  constructor(private readonly repository: GlossaryRepository) {}

  async execute(
    input: ListGlossaryByLocaleInput
  ): Promise<Result<ListGlossaryByLocaleOutput, UseCaseError>> {
    const result = await this.repository.listByAccountLocale(input.accountId, input.locale);
    if (result.ok) return ok({ entries: result.value });
    return err(new UseCaseError("Failed to list glossary entries", USE_CASE_ERRORS.INTERNAL_ERROR));
  }
}
