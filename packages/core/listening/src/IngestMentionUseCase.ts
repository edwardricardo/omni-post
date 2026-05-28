/**
 * @file IngestMentionUseCase.ts
 * @description Ingests a brand mention from a provider search or inbound webhook.
 *   Deduplicates by (provider, externalId); creates and persists the Mention
 *   aggregate when new. A single-aggregate insert — no Unit of Work or domain
 *   events are required (nothing consumes a mention-ingested event today).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { type MentionRepository } from "@core/domain/repositories/MentionRepository.js";
import { MentionAggregate, type MentionSource } from "@core/domain/aggregates/MentionAggregate.js";
import { AccountId, ProjectId, ChannelId } from "@core/domain/value-objects/EntityId.js";
import { type ProviderType } from "@core/domain/value-objects/Provider.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for ingesting a mention from a provider search or webhook.
 */
export interface IngestMentionInput {
  accountId: string;
  projectId: string;
  channelId?: string;
  provider: ProviderType;
  externalId: string;
  source: MentionSource;
  trackedTermId?: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorProviderId: string;
  url?: string;
  body: string;
  lang?: string;
  mediaUrls?: string[];
  providerCreatedAt: Date;
}

/**
 * Output DTO: the mention ID and whether it was newly created.
 */
export interface IngestMentionOutput {
  id: string;
  isNew: boolean;
}

/**
 * @class IngestMentionUseCase
 * @description Deduplicates by (provider, externalId), creates the Mention
 *   aggregate, and persists it. Returns isNew=false for duplicates.
 */
export class IngestMentionUseCase implements UseCase<
  IngestMentionInput,
  IngestMentionOutput,
  UseCaseError
> {
  constructor(
    private readonly mentionRepository: MentionRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Ingests a mention with deduplication.
   * @param input - The normalized mention data from a provider search/webhook
   * @returns Result with the mention ID + newness flag, or a UseCaseError
   */
  async execute(input: IngestMentionInput): Promise<Result<IngestMentionOutput, UseCaseError>> {
    // 1. Deduplication check
    const existing = await this.mentionRepository.findByProviderExternalId(
      input.provider,
      input.externalId
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

    let channelId: ChannelId | undefined;
    if (input.channelId !== undefined) {
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
      channelId = channelIdResult.value;
    }

    // 3. Create aggregate
    const aggregateResult = MentionAggregate.create({
      accountId: accountIdResult.value,
      projectId: projectIdResult.value,
      ...(channelId !== undefined && { channelId }),
      provider: input.provider,
      externalId: input.externalId,
      source: input.source,
      ...(input.trackedTermId !== undefined && { trackedTermId: input.trackedTermId }),
      authorName: input.authorName,
      ...(input.authorHandle !== undefined && { authorHandle: input.authorHandle }),
      ...(input.authorAvatarUrl !== undefined && { authorAvatarUrl: input.authorAvatarUrl }),
      authorProviderId: input.authorProviderId,
      ...(input.url !== undefined && { url: input.url }),
      body: input.body,
      ...(input.lang !== undefined && { lang: input.lang }),
      ...(input.mediaUrls !== undefined && { mediaUrls: input.mediaUrls }),
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

    const mention = aggregateResult.value;

    const persist = async (): Promise<Result<IngestMentionOutput, UseCaseError>> => {
      const saveResult = await this.mentionRepository.save(mention);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save mention",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }
      return ok({ id: mention.id.value, isNew: true });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<IngestMentionOutput, UseCaseError> = ok({
          id: mention.id.value,
          isNew: true,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await persist();
        });
        return result;
      }
      return await persist();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to persist mention",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
