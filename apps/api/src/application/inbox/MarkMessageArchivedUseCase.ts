/**
 * @file MarkMessageArchivedUseCase.ts
 * @description Archives a social inbox message by transitioning its status
 *   to ARCHIVED via the aggregate state machine.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type SocialMessageRepository } from "../../domain/repositories/SocialMessageRepository.js";
import { type EventDispatcher } from "../../domain/events/DomainEvent.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import { SocialMessageId } from "../../domain/value-objects/SocialMessageId.js";

// ---------------------------------------------------------------------------
// Input DTO
// ---------------------------------------------------------------------------

/**
 * Input DTO for archiving a message.
 */
export interface MarkMessageArchivedInput {
  messageId: string;
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

/**
 * @class MarkMessageArchivedUseCase
 * @description Transitions a social message to ARCHIVED status from any non-terminal state.
 */
export class MarkMessageArchivedUseCase implements UseCase<
  MarkMessageArchivedInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly socialMessageRepository: SocialMessageRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Finds the message by ID, transitions to ARCHIVED, persists, and dispatches events.
   * @param input - Contains the messageId to archive
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: MarkMessageArchivedInput): Promise<Result<void, UseCaseError>> {
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
    const archiveResult = aggregate.archive();
    if (!archiveResult.ok) {
      return err(
        new UseCaseError(archiveResult.error.message, USE_CASE_ERRORS.CONFLICT, archiveResult.error)
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
