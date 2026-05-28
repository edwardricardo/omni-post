/**
 * @file GetShareOfVoiceQuery.ts
 * @description Application query for Share of Voice over the brand-listening
 *   corpus. Defaults to the trailing 30-day window, validates the window, and
 *   delegates to the read-model repository (CQRS read side — no UoW, no events).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  type MentionQueryRepository,
  type ShareOfVoiceDTO,
} from "@core/domain/repositories/MentionQueryRepository.js";

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Input DTO for the Share of Voice query.
 */
export interface GetShareOfVoiceInput {
  accountId: string;
  projectId: string;
  since?: Date;
  until?: Date;
}

/**
 * @class GetShareOfVoiceQuery
 * @description Computes Share of Voice for a project over a time window. Applies
 *   a trailing 30-day default window when not supplied, rejects an inverted
 *   window, and returns the aggregated read-model DTO.
 */
export class GetShareOfVoiceQuery implements UseCase<
  GetShareOfVoiceInput,
  ShareOfVoiceDTO,
  UseCaseError
> {
  constructor(private readonly queryRepo: MentionQueryRepository) {}

  /**
   * @method execute
   * @description Resolves the [since, until) window (defaulting to the trailing
   *   30 days) and delegates to the read-model repository.
   * @param input - Account + project scope and an optional window.
   * @returns Result with the ShareOfVoiceDTO, or a VALIDATION_FAILED error.
   */
  async execute(input: GetShareOfVoiceInput): Promise<Result<ShareOfVoiceDTO, UseCaseError>> {
    const until = input.until ?? new Date();
    const since = input.since ?? new Date(until.getTime() - DEFAULT_WINDOW_MS);

    if (since.getTime() >= until.getTime()) {
      return err(
        new UseCaseError("`since` must be before `until`", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const result = await this.queryRepo.getShareOfVoice({
      accountId: input.accountId,
      projectId: input.projectId,
      since,
      until,
    });

    return ok(result);
  }
}
