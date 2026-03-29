/**
 * @file SyncProviderCommentsUseCase.ts
 * @description Synchronizes comments from a social media provider into the inbox.
 *   Fetches comments via the provider adapter and ingests each one through
 *   IngestSocialMessageUseCase for deduplication and persistence.
 *   Provider integration will be wired in Step 7; currently returns a stub result.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type ChannelRepository } from "../../domain/repositories/ChannelRepository.js";
import { ChannelId } from "../../domain/value-objects/index.js";
import { type IngestSocialMessageUseCase } from "./IngestSocialMessageUseCase.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

// ---------------------------------------------------------------------------
// Input / Output DTOs
// ---------------------------------------------------------------------------

/**
 * Input DTO for syncing comments from a provider.
 */
export interface SyncProviderCommentsInput {
  channelId: string;
  since?: Date;
  limit?: number;
}

/**
 * Output DTO reporting the number of synced and skipped (duplicate) messages.
 */
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
 *
 *   NOTE: The provider adapter call is deferred to Step 7. This skeleton validates
 *   the channel and returns a zero-count result.
 */
export class SyncProviderCommentsUseCase implements UseCase<
  SyncProviderCommentsInput,
  SyncProviderCommentsOutput,
  UseCaseError
> {
  constructor(
    private readonly channelRepository: ChannelRepository,
    private readonly _ingestUseCase: IngestSocialMessageUseCase,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates the channel exists, then fetches and ingests provider comments.
   *   Currently returns a stub result until provider integration is wired in Step 7.
   * @param input - Contains channelId, optional since date, and optional limit
   * @returns Result containing sync counts on success, UseCaseError on failure
   */
  async execute(
    input: SyncProviderCommentsInput
  ): Promise<Result<SyncProviderCommentsOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<SyncProviderCommentsOutput, UseCaseError>> => {
      // 1. Validate channel ID
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

      // 2. Verify channel exists
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

      // TODO: Step 7 — Wire provider adapter integration:
      //   1. Get provider adapter from ProviderAdapterFactory using channel.provider
      //   2. Fetch comments via adapter.fetchComments({ since, limit })
      //   3. For each comment, call this._ingestUseCase.execute() with mapped data
      //   4. Count synced (isNew=true) vs skipped (isNew=false) from results
      //
      // const channel = channelResult.value;
      // const adapter = ProviderAdapterFactory.create(channel.provider);
      // const comments = await adapter.fetchComments({ since: input.since, limit: input.limit });
      // let synced = 0;
      // let skipped = 0;
      // for (const comment of comments) {
      //   const result = await this._ingestUseCase.execute({ ...mappedComment });
      //   if (result.ok) {
      //     if (result.value.isNew) synced++; else skipped++;
      //   }
      // }
      // return ok({ synced, skipped });

      return ok({ synced: 0, skipped: 0 });
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
