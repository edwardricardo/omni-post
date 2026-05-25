/**
 * @file GetConversationMessagesQuery.ts
 * @description Application query handler for retrieving messages within a
 *   specific conversation. Returns cursor-paginated message DTOs following
 *   the CQRS read-side pattern.
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import { type UseCase, type UseCaseError } from "../UseCase.js";
import {
  type SocialMessageQueryRepository,
  type CursorPaginatedResult,
  type SocialMessageDTO,
} from "@core/domain/repositories/SocialMessageQueryRepository.js";

/**
 * Input DTO for the conversation messages query.
 */
export interface GetConversationMessagesInput {
  conversationId: string;
  cursor?: string;
  limit?: number;
}

/**
 * @class GetConversationMessagesQuery
 * @description Fetches all messages belonging to a conversation, ordered by
 *   providerCreatedAt, with cursor-based pagination. Delegates directly to
 *   the read-model query repository.
 */
export class GetConversationMessagesQuery implements UseCase<
  GetConversationMessagesInput,
  CursorPaginatedResult<SocialMessageDTO>,
  UseCaseError
> {
  constructor(private readonly queryRepo: SocialMessageQueryRepository) {}

  /**
   * @method execute
   * @description Queries the read-model repository for messages in the given
   *   conversation with cursor-based pagination.
   * @param input - Query parameters including conversationId and optional pagination
   * @returns Result containing a cursor-paginated list of message DTOs
   */
  async execute(
    input: GetConversationMessagesInput
  ): Promise<Result<CursorPaginatedResult<SocialMessageDTO>, UseCaseError>> {
    const result = await this.queryRepo.findByConversationId(input.conversationId, {
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      limit: input.limit ?? 20,
    });

    return ok(result);
  }
}
