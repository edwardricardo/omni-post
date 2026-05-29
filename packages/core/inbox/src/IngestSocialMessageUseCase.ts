/**
 * @file IngestSocialMessageUseCase.ts
 * @description Ingests a new social message from a webhook or provider sync.
 *   Performs deduplication by providerMessageId and groups messages into
 *   conversations when a providerParentId is present.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type SocialMessageRepository } from "@core/domain/repositories/SocialMessageRepository.js";
import { type SocialConversationRepository } from "@core/domain/repositories/SocialConversationRepository.js";
import { type EventDispatcher } from "@core/domain/events/DomainEvent.js";
import { SocialMessageAggregate } from "@core/domain/aggregates/SocialMessageAggregate.js";
import { SocialMessageType } from "@core/domain/value-objects/SocialMessageType.js";
import { AccountId, ProjectId, ChannelId } from "@core/domain/value-objects/EntityId.js";
import { type ProviderType } from "@core/domain/value-objects/Provider.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

// ---------------------------------------------------------------------------
// Input / Output DTOs
// ---------------------------------------------------------------------------

/**
 * Input DTO for ingesting a social message from a webhook or sync.
 */
export interface IngestSocialMessageInput {
  accountId: string;
  projectId: string;
  channelId: string;
  provider: ProviderType;
  providerMessageId: string;
  providerParentId?: string;
  messageType: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorProviderId: string;
  body: string;
  mediaUrls?: string[];
  webhookEventId?: string;
  relatedPostId?: string;
  providerCreatedAt: Date;
}

/**
 * Output DTO indicating the message ID and whether it was newly created.
 */
export interface IngestSocialMessageOutput {
  id: string;
  isNew: boolean;
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

/**
 * @class IngestSocialMessageUseCase
 * @description Processes an incoming social message: deduplicates by provider message ID,
 *   creates the aggregate, links to a conversation thread when applicable, and dispatches
 *   domain events.
 */
export class IngestSocialMessageUseCase implements UseCase<
  IngestSocialMessageInput,
  IngestSocialMessageOutput,
  UseCaseError
> {
  constructor(
    private readonly socialMessageRepository: SocialMessageRepository,
    private readonly socialConversationRepository: SocialConversationRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Ingests a social message with deduplication and conversation grouping.
   * @param input - The raw message data from a provider webhook or sync
   * @returns Result containing the message ID and newness flag, or a UseCaseError
   */
  async execute(
    input: IngestSocialMessageInput
  ): Promise<Result<IngestSocialMessageOutput, UseCaseError>> {
    // 1. Deduplication check
    const existing = await this.socialMessageRepository.findByProviderMessageId(
      input.provider,
      input.providerMessageId
    );

    if (existing) {
      return ok({ id: existing.id.value, isNew: false });
    }

    // 2. Validate typed IDs
    const accountIdResult = AccountId.fromString(input.accountId);
    if (!accountIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid accountId: ${input.accountId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          accountIdResult.error
        )
      );
    }

    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid projectId: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          projectIdResult.error
        )
      );
    }

    const channelIdResult = ChannelId.fromString(input.channelId);
    if (!channelIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid channelId: ${input.channelId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          channelIdResult.error
        )
      );
    }

    // 3. Create message type value object
    const messageTypeResult = SocialMessageType.create(input.messageType);
    if (!messageTypeResult.ok) {
      return err(
        new UseCaseError(
          `Invalid messageType: ${input.messageType}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          messageTypeResult.error
        )
      );
    }

    // 4. Create aggregate
    const aggregateResult = SocialMessageAggregate.create({
      accountId: accountIdResult.value,
      projectId: projectIdResult.value,
      channelId: channelIdResult.value,
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      ...(input.providerParentId !== undefined && { providerParentId: input.providerParentId }),
      messageType: messageTypeResult.value,
      authorName: input.authorName,
      ...(input.authorHandle !== undefined && { authorHandle: input.authorHandle }),
      ...(input.authorAvatarUrl !== undefined && { authorAvatarUrl: input.authorAvatarUrl }),
      authorProviderId: input.authorProviderId,
      body: input.body,
      ...(input.mediaUrls !== undefined && { mediaUrls: input.mediaUrls }),
      ...(input.webhookEventId !== undefined && { webhookEventId: input.webhookEventId }),
      ...(input.relatedPostId !== undefined && { relatedPostId: input.relatedPostId }),
      providerCreatedAt: input.providerCreatedAt,
    });

    if (!aggregateResult.ok) {
      return err(
        new UseCaseError(
          aggregateResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          aggregateResult.error
        )
      );
    }

    const aggregate = aggregateResult.value;

    // 5-7. Link conversation + persist + dispatch (atomically via UoW when available)
    const persistAll = async (): Promise<Result<IngestSocialMessageOutput, UseCaseError>> => {
      // 5. Link to conversation if providerParentId is present
      if (input.providerParentId !== undefined) {
        const conversationResult = await this.socialConversationRepository.findOrCreateByRoot(
          input.provider,
          input.providerParentId,
          {
            accountId: input.accountId,
            projectId: input.projectId,
            channelId: input.channelId,
            lastMessageAt: input.providerCreatedAt,
          }
        );

        if (conversationResult.ok) {
          const conversation = conversationResult.value;
          aggregate.setConversationId(conversation.id);

          // Update conversation counters
          conversation.incrementMessageCount(input.providerCreatedAt);
          await this.socialConversationRepository.save(conversation);
        }
      }

      // 6. Persist aggregate
      const saveResult = await this.socialMessageRepository.save(aggregate);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save social message",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      // 7. Dispatch domain events
      const events = aggregate.domainEvents;
      if (events.length > 0) {
        await this.eventDispatcher.dispatchAll([...events]);
        aggregate.clearDomainEvents();
      }

      return ok({ id: aggregate.id.value, isNew: true });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<IngestSocialMessageOutput, UseCaseError> = ok({
          id: aggregate.id.value,
          isNew: true,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await persistAll();
        });
        return result;
      }
      return await persistAll();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to persist social message",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
