/**
 * @file SendReplyUseCase.ts
 * @description Sends a reply to a social inbox message. Creates an outbound reply
 *   record, calls the provider API to post the reply, marks the message as replied
 *   (via aggregate state machine), and persists the changes.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type SocialMessageRepository } from "@core/domain/repositories/SocialMessageRepository.js";
import {
  type SocialOutboundReplyRepository,
  OUTBOUND_REPLY_STATUSES,
} from "@core/domain/repositories/SocialOutboundReplyRepository.js";
import { type ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import { type EventDispatcher } from "@core/domain/events/DomainEvent.js";
import { SocialMessageId } from "@core/domain/value-objects/SocialMessageId.js";
import { type ProviderAdapter } from "@ports/core";
import { type ProviderType } from "@core/domain/value-objects/Provider.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { GuardrailRegistry } from "@core/guardrails/GuardrailRegistry.js";

/**
 * Resolves a ProviderAdapter by provider type. Injected via DI.
 */
export interface ProviderAdapterResolver {
  resolve(provider: ProviderType): ProviderAdapter | undefined;
}

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
 * @description Creates an outbound reply for a social message, posts the reply
 *   via the provider API, and marks the original message as REPLIED.
 */
export class SendReplyUseCase implements UseCase<SendReplyInput, SendReplyOutput, UseCaseError> {
  constructor(
    private readonly socialMessageRepository: SocialMessageRepository,
    private readonly outboundReplyRepository: SocialOutboundReplyRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly channelRepository?: ChannelRepository,
    private readonly providerAdapterResolver?: ProviderAdapterResolver,
    private readonly unitOfWork?: UnitOfWork,
    private readonly guardrails?: GuardrailRegistry
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

    // Evaluate the body against the guardrail registry before any
    // persistence or provider call. Hard block on first violation.
    if (this.guardrails) {
      const accountId =
        typeof aggregate.accountId === "string" ? aggregate.accountId : String(aggregate.accountId);
      const decision = await this.guardrails.evaluate({
        action: "send-reply",
        text: input.body.trim(),
        accountId,
      });
      if (!decision.allow) {
        return err(
          new UseCaseError(
            `Reply rejected by ${decision.guardrailName}: ${decision.reason}`,
            USE_CASE_ERRORS.GUARDRAIL_REJECTED
          )
        );
      }
    }

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

    // 4. Post reply via provider API (if adapter is available)
    let providerReplyId: string | undefined;

    if (this.channelRepository && this.providerAdapterResolver) {
      const adapter = this.providerAdapterResolver.resolve(aggregate.provider);

      if (!adapter || !adapter.capabilities.replies || !adapter.postReply) {
        // Provider does not support replies — mark as FAILED and return error
        await this.outboundReplyRepository.updateStatus(
          reply.id,
          OUTBOUND_REPLY_STATUSES.FAILED,
          undefined,
          `${aggregate.provider} does not support replies via API`
        );
        return err(
          new UseCaseError(
            `Direct replies via API are not supported for ${aggregate.provider}. Reply directly in the ${aggregate.provider} app.`,
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }

      // Load channel to get credentials
      const channelResult = await this.channelRepository.findById(aggregate.channelId);
      if (!channelResult.ok) {
        await this.outboundReplyRepository.updateStatus(
          reply.id,
          OUTBOUND_REPLY_STATUSES.FAILED,
          undefined,
          "Channel not found — cannot retrieve provider credentials"
        );
        return err(
          new UseCaseError(
            "Channel not found — cannot retrieve provider credentials",
            USE_CASE_ERRORS.NOT_FOUND,
            channelResult.error
          )
        );
      }

      const channel = channelResult.value;

      // Call provider API
      const providerResult = await adapter.postReply({
        channelCredentials: channel.credentials,
        inReplyToProviderMessageId: aggregate.providerMessageId,
        body: input.body.trim(),
      });

      if (!providerResult.ok) {
        await this.outboundReplyRepository.updateStatus(
          reply.id,
          OUTBOUND_REPLY_STATUSES.FAILED,
          undefined,
          `Provider API error: ${providerResult.error}`
        );
        return err(
          new UseCaseError(
            `Failed to post reply via ${aggregate.provider}: ${providerResult.error}`,
            USE_CASE_ERRORS.INTERNAL_ERROR
          )
        );
      }

      providerReplyId = providerResult.value.providerReplyId;

      // Mark as SENT with provider reply ID
      await this.outboundReplyRepository.updateStatus(
        reply.id,
        OUTBOUND_REPLY_STATUSES.SENT,
        providerReplyId
      );
    } else {
      // Fallback: no adapter resolver — mark as SENT directly (backward compatible)
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

    // 7. Persist aggregate + dispatch events (atomically via UoW when available)
    const persistAndDispatch = async (): Promise<Result<SendReplyOutput, UseCaseError>> => {
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

      return ok({
        replyId: reply.id,
        ...(providerReplyId !== undefined && { providerReplyId }),
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<SendReplyOutput, UseCaseError> = ok({
          replyId: reply.id,
          ...(providerReplyId !== undefined && { providerReplyId }),
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await persistAndDispatch();
        });
        return result;
      }
      return await persistAndDispatch();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to persist reply changes",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
