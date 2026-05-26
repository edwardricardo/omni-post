/**
 * @file ListMentionsQuery.ts
 * @description Application query for the brand-mention feed. Validates optional
 *   filter value strings (provider, tracked-term kind, sentiment) and returns a
 *   cursor-paginated list of mention DTOs (CQRS read side — no UoW, no events).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  type MentionQueryRepository,
  type MentionDTO,
  type MentionFilter,
  type TrackedTermKindValue,
  type MentionSentimentValue,
  type CursorPaginatedResult,
} from "@core/domain/repositories/MentionQueryRepository.js";
import { Provider } from "@core/domain/value-objects/Provider.js";

const TRACKED_TERM_KINDS: readonly TrackedTermKindValue[] = ["BRAND", "MARKET"];
const SENTIMENT_LABELS: readonly MentionSentimentValue[] = ["POSITIVE", "NEUTRAL", "NEGATIVE"];

/**
 * Input DTO for the mention feed query.
 */
export interface ListMentionsInput {
  accountId: string;
  projectId?: string;
  provider?: string;
  kind?: string;
  sentiment?: string;
  since?: Date;
  until?: Date;
  cursor?: string;
  limit?: number;
}

/**
 * @class ListMentionsQuery
 * @description Returns the cursor-paginated mention feed for an account/project,
 *   validating optional filter strings before delegating to the read model.
 */
export class ListMentionsQuery implements UseCase<
  ListMentionsInput,
  CursorPaginatedResult<MentionDTO>,
  UseCaseError
> {
  constructor(private readonly queryRepo: MentionQueryRepository) {}

  /**
   * @method execute
   * @description Builds a MentionFilter (validating provider/kind/sentiment) and
   *   queries the read model with cursor-based pagination.
   * @param input - Account scope, optional filters, and pagination.
   * @returns Result with a cursor-paginated list of MentionDTOs, or VALIDATION_FAILED.
   */
  async execute(
    input: ListMentionsInput
  ): Promise<Result<CursorPaginatedResult<MentionDTO>, UseCaseError>> {
    const filter: MentionFilter = { accountId: input.accountId };

    if (input.provider !== undefined) {
      const providerResult = Provider.fromString(input.provider);
      if (!providerResult.ok) {
        return err(
          new UseCaseError(providerResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED)
        );
      }
      filter.provider = providerResult.value.type;
    }

    if (input.kind !== undefined) {
      if (!TRACKED_TERM_KINDS.includes(input.kind as TrackedTermKindValue)) {
        return err(
          new UseCaseError(
            `Invalid tracked-term kind: ${input.kind}`,
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }
      filter.kind = input.kind as TrackedTermKindValue;
    }

    if (input.sentiment !== undefined) {
      if (!SENTIMENT_LABELS.includes(input.sentiment as MentionSentimentValue)) {
        return err(
          new UseCaseError(
            `Invalid sentiment label: ${input.sentiment}`,
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }
      filter.sentiment = input.sentiment as MentionSentimentValue;
    }

    if (input.projectId !== undefined) {
      filter.projectId = input.projectId;
    }
    if (input.since !== undefined) {
      filter.since = input.since;
    }
    if (input.until !== undefined) {
      filter.until = input.until;
    }

    const result = await this.queryRepo.listMentions(filter, {
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      limit: input.limit ?? 20,
    });

    return ok(result);
  }
}
