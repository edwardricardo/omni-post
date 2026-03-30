/**
 * @file SyncProviderCommentsUseCase.ts
 * @description Synchronizes comments from a social media provider into the inbox.
 *   Fetches comments via the provider adapter and ingests each one through
 *   IngestSocialMessageUseCase for deduplication and persistence.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type ChannelRepository } from "../../domain/repositories/ChannelRepository.js";
import { ChannelId } from "../../domain/value-objects/index.js";
import { type IngestSocialMessageUseCase } from "./IngestSocialMessageUseCase.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { ProviderAdapter } from "@ports/core";
import type { ProviderType } from "../../domain/value-objects/Provider.js";

// ---------------------------------------------------------------------------
// Input / Output DTOs
// ---------------------------------------------------------------------------

export interface SyncProviderCommentsInput {
  channelId: string;
  accountId?: string;
  projectId?: string;
  since?: Date;
  limit?: number;
}

export interface SyncProviderCommentsOutput {
  synced: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

/**
 * @class SyncProviderCommentsUseCase
 * @description Fetches comments from a provider and ingests them into the inbox.
 *   Each fetched comment is passed through IngestSocialMessageUseCase which handles
 *   deduplication and conversation grouping.
 */
export class SyncProviderCommentsUseCase implements UseCase<
  SyncProviderCommentsInput,
  SyncProviderCommentsOutput,
  UseCaseError
> {
  constructor(
    private readonly channelRepository: ChannelRepository,
    private readonly ingestUseCase: IngestSocialMessageUseCase,
    private readonly unitOfWork?: UnitOfWork,
    private readonly getProviderAdapter?: (provider: string) => ProviderAdapter | undefined
  ) {}

  /**
   * @method execute
   * @description Validates the channel, fetches comments from provider adapter,
   *   and ingests each through IngestSocialMessageUseCase.
   * @param input - Contains channelId, optional since date, and optional limit
   * @returns Result containing sync counts on success, UseCaseError on failure
   */
  async execute(
    input: SyncProviderCommentsInput
  ): Promise<Result<SyncProviderCommentsOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<SyncProviderCommentsOutput, UseCaseError>> => {
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

      const channelResult = await this.channelRepository.findById(channelIdResult.value);
      if (!channelResult.ok) {
        return err(
          new UseCaseError(
            `Channel not found: ${input.channelId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            channelResult.error
          )
        );
      }

      const channel = channelResult.value;
      const providerName = channel.provider.toString().toLowerCase();

      if (!this.getProviderAdapter) {
        return ok({ synced: 0, skipped: 0 });
      }

      const adapter = this.getProviderAdapter(providerName);
      if (!adapter || !adapter.getComments) {
        return ok({ synced: 0, skipped: 0 });
      }

      const credentials = channel.credentials;
      let synced = 0;
      let skipped = 0;
      let cursor: string | undefined;

      do {
        const commentsResult = await adapter.getComments({
          channelCredentials: credentials as unknown,
          ...(input.since !== undefined && { since: input.since }),
          ...(cursor !== undefined && { cursor }),
          limit: input.limit ?? 100,
        });

        if (!commentsResult.ok) {
          if (commentsResult.error === "AUTH") {
            return err(
              new UseCaseError(
                `Auth error syncing comments for channel ${input.channelId}`,
                USE_CASE_ERRORS.FORBIDDEN
              )
            );
          }
          return err(
            new UseCaseError(
              `Network error syncing comments for channel ${input.channelId}`,
              USE_CASE_ERRORS.INTERNAL_ERROR
            )
          );
        }

        const { comments, nextCursor } = commentsResult.value;

        for (const comment of comments) {
          const ingestResult = await this.ingestUseCase.execute({
            accountId: input.accountId ?? "",
            projectId: input.projectId ?? channel.projectId.value,
            channelId: input.channelId,
            provider: providerName.toUpperCase() as ProviderType,
            providerMessageId: comment.providerMessageId,
            ...(comment.providerParentId !== undefined && {
              providerParentId: comment.providerParentId,
            }),
            messageType: "COMMENT",
            authorName: comment.authorName,
            ...(comment.authorHandle !== undefined && { authorHandle: comment.authorHandle }),
            ...(comment.authorAvatarUrl !== undefined && {
              authorAvatarUrl: comment.authorAvatarUrl,
            }),
            authorProviderId: comment.authorProviderId,
            body: comment.body,
            ...(comment.mediaUrls !== undefined && { mediaUrls: comment.mediaUrls }),
            providerCreatedAt: comment.createdAt,
          });

          if (ingestResult.ok) {
            if (ingestResult.value.isNew) {
              synced++;
            } else {
              skipped++;
            }
          }
        }

        cursor = nextCursor;
      } while (cursor);

      return ok({ synced, skipped });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<SyncProviderCommentsOutput, UseCaseError> = ok({
          synced: 0,
          skipped: 0,
        }) as Result<SyncProviderCommentsOutput, UseCaseError>;
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to sync provider comments",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
