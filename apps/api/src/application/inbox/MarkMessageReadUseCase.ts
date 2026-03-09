/**
 * @file MarkMessageReadUseCase.ts
 * @description Marks a social inbox message as read by transitioning its
 *   status from UNREAD to READ via the aggregate state machine.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type SocialMessageRepository } from "../../domain/repositories/SocialMessageRepository.js";
import { type EventDispatcher } from "../../domain/events/DomainEvent.js";
import { SocialMessageId } from "../../domain/value-objects/SocialMessageId.js";

// ---------------------------------------------------------------------------
// Input DTO
// ---------------------------------------------------------------------------

/**
 * Input DTO for marking a message as read.
 */
export interface MarkMessageReadInput {
  messageId: string;
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

/**
 * @class MarkMessageReadUseCase
 * @description Transitions a social message from UNREAD to READ status.
 */
export class MarkMessageReadUseCase implements UseCase<MarkMessageReadInput, void, UseCaseError> {
  constructor(
    private readonly socialMessageRepository: SocialMessageRepository,
    private readonly eventDispatcher: EventDispatcher
  ) {}

  /**
   * @method execute
   * @description Finds the message by ID, transitions to READ, persists, and dispatches events.
   * @param input - Contains the messageId to mark as read
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: MarkMessageReadInput): Promise<Result<void, UseCaseError>> {
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

    // 3. Transition status
    const markResult = aggregate.markAsRead();
    if (!markResult.ok) {
      return err(
        new UseCaseError(markResult.error.message, USE_CASE_ERRORS.CONFLICT, markResult.error)
      );
    }

    // 4. Persist
    const saveResult = await this.socialMessageRepository.save(aggregate);
    if (!saveResult.ok) {
      return err(
        new UseCaseError("Failed to save message", USE_CASE_ERRORS.INTERNAL_ERROR, saveResult.error)
      );
    }

    // 5. Dispatch events
    const events = aggregate.domainEvents;
    if (events.length > 0) {
      await this.eventDispatcher.dispatchAll([...events]);
      aggregate.clearDomainEvents();
    }

    return ok(undefined);
  }
}
