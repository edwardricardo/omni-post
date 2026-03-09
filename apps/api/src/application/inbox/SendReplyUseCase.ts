/**
 * @file SendReplyUseCase.ts
 * @description Sends a reply to a social inbox message. Creates an outbound reply
 *   record, marks the message as replied (via aggregate state machine), and persists
 *   the changes. The actual provider API call will be wired in Step 7.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type SocialMessageRepository } from "../../domain/repositories/SocialMessageRepository.js";
import {
  type SocialOutboundReplyRepository,
  OUTBOUND_REPLY_STATUSES,
} from "../../domain/repositories/SocialOutboundReplyRepository.js";
import { type EventDispatcher } from "../../domain/events/DomainEvent.js";
import { SocialMessageId } from "../../domain/value-objects/SocialMessageId.js";

// ---------------------------------------------------------------------------
// Input / Output DTOs
// ---------------------------------------------------------------------------

/**
 * Input DTO for sending a reply to a social message.
 */
export interface SendReplyInput {
  messageId: string;
  authorId: string;
  body: string;
}

/**
 * Output DTO containing the created reply's identifier and optional provider reply ID.
 */
export interface SendReplyOutput {
  replyId: string;
  providerReplyId?: string;
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

/**
 * @class SendReplyUseCase
 * @description Creates an outbound reply for a social message. Currently saves the
 *   reply record and marks the original message as REPLIED. Provider integration
 *   for actually posting the reply via the platform API will be added in Step 7.
 */
export class SendReplyUseCase implements UseCase<SendReplyInput, SendReplyOutput, UseCaseError> {
  constructor(
    private readonly socialMessageRepository: SocialMessageRepository,
    private readonly outboundReplyRepository: SocialOutboundReplyRepository,
    private readonly eventDispatcher: EventDispatcher
  ) {}

  /**
   * @method execute
   * @description Creates an outbound reply, marks the source message as REPLIED,
   *   persists both, and dispatches domain events.
   * @param input - Contains messageId, authorId, and reply body
   * @returns Result containing the reply ID on success, UseCaseError on failure
   */
  async execute(input: SendReplyInput): Promise<Result<SendReplyOutput, UseCaseError>> {
    // 1. Validate input
    if (!input.body || input.body.trim().length === 0) {
      return err(
        new UseCaseError("Reply body must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    if (!input.authorId || input.authorId.trim().length === 0) {
      return err(
        new UseCaseError("Author ID must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // 2. Parse message ID and find aggregate
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

    // 3. Create outbound reply record
    const replyResult = await this.outboundReplyRepository.save({
      socialMessageId: input.messageId,
      authorId: input.authorId,
      body: input.body.trim(),
    });

    if (!replyResult.ok) {
      return err(
        new UseCaseError(
          "Failed to create outbound reply",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          replyResult.error
        )
      );
    }

    const reply = replyResult.value;

    // 4. Mark reply as SENT (provider integration deferred to Step 7)
    // TODO: Step 7 — call provider adapter to post reply via platform API,
    //   then set providerReplyId from the response. For now, mark as SENT directly.
    const statusResult = await this.outboundReplyRepository.updateStatus(
      reply.id,
      OUTBOUND_REPLY_STATUSES.SENT
    );

    if (!statusResult.ok) {
      return err(
        new UseCaseError(
          "Failed to update reply status",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          statusResult.error
        )
      );
    }

    // 5. If message is UNREAD, transition to READ first, then to REPLIED
    if (aggregate.isUnread) {
      const readResult = aggregate.markAsRead();
      if (!readResult.ok) {
        return err(
          new UseCaseError(readResult.error.message, USE_CASE_ERRORS.CONFLICT, readResult.error)
        );
      }
    }

    // 6. Transition to REPLIED (only if not already replied)
    if (!aggregate.isReplied) {
      const repliedResult = aggregate.markAsReplied();
      if (!repliedResult.ok) {
        return err(
          new UseCaseError(
            repliedResult.error.message,
            USE_CASE_ERRORS.CONFLICT,
            repliedResult.error
          )
        );
      }
    }

    // 7. Persist aggregate
    const saveResult = await this.socialMessageRepository.save(aggregate);
    if (!saveResult.ok) {
      return err(
        new UseCaseError("Failed to save message", USE_CASE_ERRORS.INTERNAL_ERROR, saveResult.error)
      );
    }

    // 8. Dispatch events
    const events = aggregate.domainEvents;
    if (events.length > 0) {
      await this.eventDispatcher.dispatchAll([...events]);
      aggregate.clearDomainEvents();
    }

    return ok({ replyId: reply.id });
  }
}
