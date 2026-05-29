/**
 * @file GetMentionsQuery.ts
 * @description Application query handler for the mentions-only inbox view.
 *   Returns cursor-paginated mention DTOs following the CQRS read-side pattern.
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import { type UseCase, type UseCaseError } from "@core/application/UseCase.js";
import {
  type SocialMessageQueryRepository,
  type CursorPaginatedResult,
  type SocialMessageDTO,
} from "@core/domain/repositories/SocialMessageQueryRepository.js";

/**
 * Input DTO for the mentions query.
 */
export interface GetMentionsInput {
  accountId: string;
  projectId?: string;
  cursor?: string;
  limit?: number;
}

/**
 * @class GetMentionsQuery
 * @description Fetches only mention-type messages from the Social Inbox with
 *   cursor-based pagination. Delegates directly to the read-model query
 *   repository's findMentions method.
 */
export class GetMentionsQuery implements UseCase<
  GetMentionsInput,
  CursorPaginatedResult<SocialMessageDTO>,
  UseCaseError
> {
  constructor(private readonly queryRepo: SocialMessageQueryRepository) {}

  /**
   * @method execute
   * @description Queries the read-model repository for mention messages,
   *   optionally filtered by project, with cursor-based pagination.
   * @param input - Query parameters including accountId and optional pagination
   * @returns Result containing a cursor-paginated list of mention DTOs
   */
  async execute(
    input: GetMentionsInput
  ): Promise<Result<CursorPaginatedResult<SocialMessageDTO>, UseCaseError>> {
    const result = await this.queryRepo.findMentions(input.accountId, input.projectId, {
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      limit: input.limit ?? 20,
    });

    return ok(result);
  }
}
