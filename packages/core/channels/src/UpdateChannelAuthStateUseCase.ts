/**
 * @file UpdateChannelAuthStateUseCase.ts
 * @description Admin-triggered force re-auth of a channel. Flips
 *              `Channel.needsReauth = true` so the tenant sees a reconnect
 *              banner; the next refresh cycle will fail naturally without
 *              needing explicit token nullification. Wraps the mutation in
 *              a Unit of Work; the audit log entry is emitted by the route
 *              handler AFTER commit (external side-effect).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { ChannelId, type ChannelRepository } from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface UpdateChannelAuthStateInput {
  channelId: string;
  reason: string;
}

export interface UpdateChannelAuthStateOutput {
  channelId: string;
  projectId: string;
  provider: string;
  needsReauth: true;
  authFailedAt: string;
}

export class UpdateChannelAuthStateUseCase implements UseCase<
  UpdateChannelAuthStateInput,
  UpdateChannelAuthStateOutput,
  UseCaseError
> {
  constructor(
    private readonly channelRepository: ChannelRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: UpdateChannelAuthStateInput
  ): Promise<Result<UpdateChannelAuthStateOutput, UseCaseError>> {
    const reason = input.reason.trim();
    if (!reason) {
      return err(new UseCaseError("reason is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const channelIdResult = ChannelId.fromString(input.channelId);
    if (!channelIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid channel ID: ${input.channelId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
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

    const doWork = async (): Promise<Result<UpdateChannelAuthStateOutput, UseCaseError>> => {
      channel.markForReauth(reason);
      const saveResult = await this.channelRepository.save(channel);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to mark channel for re-auth",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }
      const failedAt = channel.authFailedAt;
      return ok({
        channelId: channel.id.value,
        projectId: channel.projectId.value,
        provider: channel.provider.type,
        needsReauth: true,
        authFailedAt: failedAt ? failedAt.toISOString() : new Date().toISOString(),
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<UpdateChannelAuthStateOutput, UseCaseError> = err(
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
          "Failed to update channel auth state",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
