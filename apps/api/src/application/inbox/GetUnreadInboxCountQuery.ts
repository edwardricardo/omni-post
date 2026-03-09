/**
 * @file GetUnreadInboxCountQuery.ts
 * @description Application query handler for counting unread Social Inbox messages.
 *   Returns a simple count DTO following the CQRS read-side pattern.
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import { type UseCase, type UseCaseError } from "../UseCase.js";
import { type SocialMessageQueryRepository } from "../../domain/repositories/SocialMessageQueryRepository.js";

/**
 * Input DTO for the unread inbox count query.
 */
export interface GetUnreadInboxCountInput {
  accountId: string;
  projectId?: string;
}

/**
 * @class GetUnreadInboxCountQuery
 * @description Returns the number of unread messages in the Social Inbox for
 *   a given account, optionally filtered by project.
 */
export class GetUnreadInboxCountQuery
  implements UseCase<GetUnreadInboxCountInput, { count: number }, UseCaseError>
{
  constructor(private readonly queryRepo: SocialMessageQueryRepository) {}

  /**
   * @method execute
   * @description Counts unread messages for the given account and optional project.
   * @param input - Query parameters including accountId and optional projectId
   * @returns Result containing { count: number } on success
   */
  async execute(input: GetUnreadInboxCountInput): Promise<Result<{ count: number }, UseCaseError>> {
    const count = await this.queryRepo.countUnread(input.accountId, input.projectId);

    return ok({ count });
  }
}
