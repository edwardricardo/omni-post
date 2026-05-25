/**
 * @file ResolveConversationUseCase.ts
 * @description Marks a social conversation as resolved by a team member.
 *   Delegates to the SocialConversation entity's resolve() method which
 *   enforces the "not already resolved" invariant and emits a ConversationResolved event.
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
 * Input DTO for resolving a conversation.
 */
export interface ResolveConversationInput {
  conversationId: string;
  resolvedById: string;
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

/**
 * @class ResolveConversationUseCase
 * @description Marks a conversation as resolved by a specified team member.
 */
export class ResolveConversationUseCase implements UseCase<
  ResolveConversationInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly conversationRepository: SocialConversationRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Finds the conversation, resolves it, and persists the change.
   * @param input - Contains conversationId and resolvedById
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: ResolveConversationInput): Promise<Result<void, UseCaseError>> {
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      // 1. Validate resolvedById
      if (!input.resolvedById || input.resolvedById.trim().length === 0) {
        return err(
          new UseCaseError("resolvedById must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED)
        );
      }

      // 2. Parse conversation ID
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

      // 3. Find conversation
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

      // 4. Resolve
      const resolveResult = conversation.resolve(input.resolvedById);
      if (!resolveResult.ok) {
        return err(
          new UseCaseError(
            resolveResult.error.message,
            USE_CASE_ERRORS.CONFLICT,
            resolveResult.error
          )
        );
      }

      // 5. Persist
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
          "Failed to resolve conversation",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
