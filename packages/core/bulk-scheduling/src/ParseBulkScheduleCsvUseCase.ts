/**
 * @file ParseBulkScheduleCsvUseCase.ts
 * @description Phase-1 use case for bulk-scheduling: parses a CSV and returns a
 *              validated row preview. Stateless — no DB, no UoW, no queue. The
 *              client uses the returned rows to show a preview and then calls
 *              ConfirmBulkScheduleUseCase (Phase 2) with a selected channelIds[].
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import { type UseCase, UseCaseError } from "@core/application/UseCase.js";
import { parseSchedulingCsv } from "./schedulingCsv.js";
import type { ParseSchedulingCsvResult } from "./schedulingCsv.js";

/** Input for Phase-1 parse. */
export interface ParseBulkScheduleCsvInput {
  /** Raw CSV text (header + data rows). */
  csv: string;
}

/**
 * @class ParseBulkScheduleCsvUseCase
 * @description Stateless Phase-1 parser. Thin wrapper over `parseSchedulingCsv`
 *   that fits the use-case contract. Never throws — per-row errors are returned
 *   in the result, not as exceptions. No database interaction at all.
 */
export class ParseBulkScheduleCsvUseCase implements UseCase<
  ParseBulkScheduleCsvInput,
  ParseSchedulingCsvResult,
  UseCaseError
> {
  /**
   * @method execute
   * @description Parse and structurally validate the CSV. Returns the complete
   *   parse result (validRows, errors, totalDataRows). Never writes to the database.
   * @param input - The raw CSV text.
   * @returns A `Result` wrapping the parse outcome. Always ok — parsing errors
   *   are surfaced inside `result.value.errors`, not as a failure `Result`.
   */
  execute(
    input: ParseBulkScheduleCsvInput
  ): Promise<Result<ParseSchedulingCsvResult, UseCaseError>> {
    const result = parseSchedulingCsv(input.csv);
    return Promise.resolve(ok(result));
  }
}
