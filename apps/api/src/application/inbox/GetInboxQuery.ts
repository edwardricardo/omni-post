/**
 * @file GetInboxQuery.ts
 * @description Application query handler for the unified Social Inbox feed.
 *   Applies optional filters (provider, messageType, status, channel, assignee)
 *   and returns cursor-paginated message DTOs following the CQRS read-side pattern.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  type SocialMessageQueryRepository,
  type CursorPaginatedResult,
  type SocialMessageDTO,
  type InboxFilter,
} from "../../domain/repositories/SocialMessageQueryRepository.js";
import { Provider } from "../../domain/value-objects/Provider.js";
import { SocialMessageType } from "../../domain/value-objects/SocialMessageType.js";
import { SocialMessageStatus } from "../../domain/value-objects/SocialMessageStatus.js";

/**
 * Input DTO for the unified inbox query.
 */
export interface GetInboxInput {
  accountId: string;
  projectId?: string;
  channelId?: string;
  provider?: string;
  messageType?: string;
  status?: string;
  assigneeId?: string;
  cursor?: string;
  limit?: number;
}

/**
 * @class GetInboxQuery
 * @description Fetches the unified Social Inbox feed with cursor-based pagination
 *   and optional filters. Validates filter value objects before delegating to the
 *   read-model query repository.
 */
export class GetInboxQuery
  implements UseCase<GetInboxInput, CursorPaginatedResult<SocialMessageDTO>, UseCaseError>
{
  constructor(private readonly queryRepo: SocialMessageQueryRepository) {}

  /**
   * @method execute
   * @description Builds an InboxFilter from the input, validates value-object
   *   strings (provider, messageType, status) if provided, and queries the
   *   read-model repository with cursor-based pagination.
   * @param input - Query parameters including optional filters and pagination
   * @returns Result containing a cursor-paginated list of SocialMessageDTOs
   */
  async execute(
    input: GetInboxInput
  ): Promise<Result<CursorPaginatedResult<SocialMessageDTO>, UseCaseError>> {
    const filter: InboxFilter = {
      accountId: input.accountId,
    };

    // Validate and map optional provider filter
    if (input.provider !== undefined) {
      const providerResult = Provider.fromString(input.provider);
      if (!providerResult.ok) {
        return err(
          new UseCaseError(providerResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED)
        );
      }
      filter.provider = providerResult.value.type;
    }

    // Validate and map optional messageType filter
    if (input.messageType !== undefined) {
      const typeResult = SocialMessageType.create(input.messageType);
      if (!typeResult.ok) {
        return err(new UseCaseError(typeResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
      }
      filter.messageType = typeResult.value.value;
    }

    // Validate and map optional status filter
    if (input.status !== undefined) {
      const statusResult = SocialMessageStatus.fromString(input.status);
      if (!statusResult.ok) {
        return err(new UseCaseError(statusResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
      }
      filter.status = statusResult.value.value;
    }

    // Map remaining optional filters using conditional spreading
    if (input.projectId !== undefined) {
      filter.projectId = input.projectId;
    }
    if (input.channelId !== undefined) {
      filter.channelId = input.channelId;
    }
    if (input.assigneeId !== undefined) {
      filter.assigneeId = input.assigneeId;
    }

    const result = await this.queryRepo.findInbox(filter, {
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      limit: input.limit ?? 20,
    });

    return ok(result);
  }
}
