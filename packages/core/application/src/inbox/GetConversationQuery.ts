/**
 * @file GetConversationQuery.ts
 * @description Application query handler for retrieving a single Social Inbox
 *   conversation by its ID. Returns a conversation DTO following the CQRS
 *   read-side pattern.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  type SocialConversationRepository,
  type SocialConversationDTO,
} from "@core/domain/repositories/SocialConversationRepository.js";
import { SocialConversationId } from "@core/domain/value-objects/SocialConversationId.js";

/**
 * Input DTO for the conversation detail query.
 */
export interface GetConversationInput {
  conversationId: string;
}

/**
 * @class GetConversationQuery
 * @description Retrieves a single conversation by its ID and maps the domain
 *   entity to a flat DTO for the read side. Returns NOT_FOUND if the
 *   conversation does not exist.
 */
export class GetConversationQuery implements UseCase<
  GetConversationInput,
  SocialConversationDTO,
  UseCaseError
> {
  constructor(private readonly conversationRepo: SocialConversationRepository) {}

  /**
   * @method execute
   * @description Parses the conversation ID, fetches the entity from the
   *   repository, and maps it to a SocialConversationDTO.
   * @param input - Query parameters containing the conversationId string
   * @returns Result containing the conversation DTO on success, UseCaseError on failure
   */
  async execute(input: GetConversationInput): Promise<Result<SocialConversationDTO, UseCaseError>> {
    // Parse and validate the conversation ID
    const idResult = SocialConversationId.fromString(input.conversationId);
    if (!idResult.ok) {
      return err(
        new UseCaseError(
          `Invalid conversation ID: "${input.conversationId}"`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Fetch entity from repository
    const findResult = await this.conversationRepo.findById(idResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Conversation not found: "${input.conversationId}"`,
          USE_CASE_ERRORS.NOT_FOUND
        )
      );
    }

    const entity = findResult.value;

    // Map entity to DTO
    const dto: SocialConversationDTO = {
      id: entity.id.value,
      accountId: entity.accountId.value,
      projectId: entity.projectId.value,
      channelId: entity.channelId.value,
      provider: entity.provider,
      subject: entity.subject,
      participantCount: entity.participantCount,
      messageCount: entity.messageCount,
      lastMessageAt: entity.lastMessageAt,
      isResolved: entity.isResolved,
      resolvedAt: entity.resolvedAt,
      resolvedById: entity.resolvedById,
      rootProviderMessageId: entity.rootProviderMessageId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };

    return ok(dto);
  }
}
