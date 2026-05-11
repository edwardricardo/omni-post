/**
 * @file GetUnreadCountQuery.ts
 * @description Application query handler for counting unread notifications.
 *   Returns a simple count DTO following the CQRS read-side pattern.
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import type { UseCase, UseCaseError } from "../UseCase.js";
import type { NotificationRepository } from "../../domain/repositories/NotificationRepository.js";

/**
 * Input DTO for unread count query
 */
export interface GetUnreadCountInput {
  recipientId: string;
}

/**
 * @class GetUnreadCountQuery
 * @description Returns the number of unread notifications for a recipient.
 */
export class GetUnreadCountQuery implements UseCase<
  GetUnreadCountInput,
  { count: number },
  UseCaseError
> {
  constructor(private readonly repository: NotificationRepository) {}

  /**
   * @method execute
   * @description Counts unread notifications for the given recipient.
   * @param input - Query parameters including recipientId
   * @returns Result<{ count: number }> on success
   */
  async execute(input: GetUnreadCountInput): Promise<Result<{ count: number }, UseCaseError>> {
    const count = await this.repository.countUnread(input.recipientId);
    return ok({ count });
  }
}
