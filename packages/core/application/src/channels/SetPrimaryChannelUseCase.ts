/**
 * @file SetPrimaryChannelUseCase.ts
 * @description Promotes a channel to primary for its (project, provider) pair within a
 *              transaction. Unmarks the previous primary (if any) and marks the target,
 *              persisting both atomically so the partial unique index on the database
 *              never sees two primaries simultaneously.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { ChannelId, type ChannelRepository } from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for promoting a channel to primary.
 *
 * @property channelId - UUID of the channel to mark as primary.
 */
export interface SetPrimaryChannelInput {
  channelId: string;
}

/**
 * Output DTO returned after a successful primary promotion.
 *
 * @property id - The promoted channel UUID.
 * @property projectId - Project the channel belongs to.
 * @property provider - Provider type of the channel.
 * @property previousPrimaryId - The id of the channel that was previously primary,
 *   or undefined when no primary existed for this (project, provider) pair.
 */
export interface SetPrimaryChannelOutput {
  id: string;
  projectId: string;
  provider: string;
  previousPrimaryId?: string;
}

/**
 * @class SetPrimaryChannelUseCase
 * @description Atomically transitions the primary flag from the current primary
 *   channel (if any) to the target channel within the same (project, provider)
 *   pair. The two saves run inside a single Unit of Work so the database partial
 *   unique index never observes a transient duplicate-primary state.
 */
export class SetPrimaryChannelUseCase implements UseCase<
  SetPrimaryChannelInput,
  SetPrimaryChannelOutput,
  UseCaseError
> {
  constructor(
    private readonly channelRepository: ChannelRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Marks the target channel as primary, unmarking any sibling that
   *   was primary for the same (project, provider) pair. Both writes commit
   *   atomically.
   * @param input - The id of the channel to promote.
   * @returns Result with the new primary's identifiers, or a UseCaseError describing why
   *   promotion failed (NOT_FOUND when the channel does not exist, INTERNAL_ERROR on
   *   persistence failures).
   */
  async execute(
    input: SetPrimaryChannelInput
  ): Promise<Result<SetPrimaryChannelOutput, UseCaseError>> {
    const channelIdResult = ChannelId.fromString(input.channelId);
    if (!channelIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid channel ID: ${input.channelId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    const targetResult = await this.channelRepository.findById(channelIdResult.value);
    if (!targetResult.ok) {
      return err(
        new UseCaseError(
          `Channel not found: ${input.channelId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          targetResult.error
        )
      );
    }

    const target = targetResult.value;

    if (target.isPrimary) {
      return ok({
        id: target.id.value,
        projectId: target.projectId.value,
        provider: target.provider.type,
      });
    }

    // findPrimaryByProjectAndProvider returns NotFoundError when no primary exists
    // yet for this (project, provider) pair. That is the "first primary ever" case
    // and not an error — we just skip the unmark step.
    const previousPrimaryResult = await this.channelRepository.findPrimaryByProjectAndProvider(
      target.projectId,
      target.provider
    );
    const previousPrimary = previousPrimaryResult.ok ? previousPrimaryResult.value : null;

    const doWork = async (): Promise<Result<SetPrimaryChannelOutput, UseCaseError>> => {
      if (previousPrimary) {
        previousPrimary.unmarkAsPrimary();
        const unmarkResult = await this.channelRepository.save(previousPrimary);
        if (!unmarkResult.ok) {
          return err(
            new UseCaseError(
              "Failed to unmark previous primary channel",
              USE_CASE_ERRORS.INTERNAL_ERROR,
              unmarkResult.error
            )
          );
        }
      }

      target.markAsPrimary();
      const saveResult = await this.channelRepository.save(target);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to mark channel as primary",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok({
        id: target.id.value,
        projectId: target.projectId.value,
        provider: target.provider.type,
        ...(previousPrimary && { previousPrimaryId: previousPrimary.id.value }),
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<SetPrimaryChannelOutput, UseCaseError> = err(
          new UseCaseError("Transaction did not complete", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to set primary channel",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
