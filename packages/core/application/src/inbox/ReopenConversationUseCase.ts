/**
 * @file ReopenConversationUseCase.ts
 * @description Reopens a previously resolved social conversation.
 *   Delegates to the SocialConversation entity's reopen() method which
 *   enforces the "must be resolved" invariant and emits a ConversationReopened event.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type SocialConversationRepository } from "@core/domain/repositories/SocialConversationRepository.js";
import { SocialConversationId } from "@core/domain/value-objects/SocialConversationId.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

// ---------------------------------------------------------------------------
// Input DTO
// ---------------------------------------------------------------------------

/**
 * Input DTO for reopening a conversation.
 */
export interface ReopenConversationInput {
  conversationId: string;
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

/**
 * @class ReopenConversationUseCase
 * @description Reopens a resolved conversation so it returns to an active state.
 */
export class ReopenConversationUseCase implements UseCase<
  ReopenConversationInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly conversationRepository: SocialConversationRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Finds the conversation, reopens it, and persists the change.
   * @param input - Contains the conversationId to reopen
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: ReopenConversationInput): Promise<Result<void, UseCaseError>> {
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      // 1. Parse conversation ID
      const idResult = SocialConversationId.fromString(input.conversationId);
      if (!idResult.ok) {
        return err(
          new UseCaseError(
            `Invalid conversationId: ${input.conversationId}`,
            USE_CASE_ERRORS.VALIDATION_FAILED,
            idResult.error
          )
        );
      }

      // 2. Find conversation
      const findResult = await this.conversationRepository.findById(idResult.value);
      if (!findResult.ok) {
        return err(
          new UseCaseError(
            `Conversation not found: ${input.conversationId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            findResult.error
          )
        );
      }

      const conversation = findResult.value;

      // 3. Reopen
      const reopenResult = conversation.reopen();
      if (!reopenResult.ok) {
        return err(
          new UseCaseError(reopenResult.error.message, USE_CASE_ERRORS.CONFLICT, reopenResult.error)
        );
      }

      // 4. Persist
      const saveResult = await this.conversationRepository.save(conversation);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save conversation",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined) as Result<void, UseCaseError>;
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to reopen conversation",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
