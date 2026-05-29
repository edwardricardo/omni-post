/**
 * @file AssignMessageUseCase.ts
 * @description Assigns a social inbox message to a team member for handling.
 *   Delegates to the aggregate's assign() method which validates the assignee ID
 *   and emits a SocialMessageAssigned domain event.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type SocialMessageRepository } from "@core/domain/repositories/SocialMessageRepository.js";
import { type EventDispatcher } from "@core/domain/events/DomainEvent.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { SocialMessageId } from "@core/domain/value-objects/SocialMessageId.js";

// ---------------------------------------------------------------------------
// Input DTO
// ---------------------------------------------------------------------------

/**
 * Input DTO for assigning a message to a team member.
 */
export interface AssignMessageInput {
  messageId: string;
  assigneeId: string;
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

/**
 * @class AssignMessageUseCase
 * @description Assigns a social inbox message to a team member by delegating
 *   to the aggregate's assign() method.
 */
export class AssignMessageUseCase implements UseCase<AssignMessageInput, void, UseCaseError> {
  constructor(
    private readonly socialMessageRepository: SocialMessageRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Finds the message, assigns it to the specified team member,
   *   persists the change, and dispatches domain events.
   * @param input - Contains messageId and assigneeId
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: AssignMessageInput): Promise<Result<void, UseCaseError>> {
    // 1. Parse message ID
    const idResult = SocialMessageId.fromString(input.messageId);
    if (!idResult.ok) {
      return err(
        new UseCaseError(
          `Invalid messageId: ${input.messageId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          idResult.error
        )
      );
    }

    // 2. Find message
    const findResult = await this.socialMessageRepository.findById(idResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Message not found: ${input.messageId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    const aggregate = findResult.value;

    // 3. Assign to team member
    const assignResult = aggregate.assign(input.assigneeId);
    if (!assignResult.ok) {
      return err(
        new UseCaseError(
          assignResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          assignResult.error
        )
      );
    }

    // 4. Persist and dispatch events
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const saveResult = await this.socialMessageRepository.save(aggregate);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save message",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      const events = aggregate.domainEvents;
      if (events.length > 0) {
        await this.eventDispatcher.dispatchAll([...events]);
        aggregate.clearDomainEvents();
      }

      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save message",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
