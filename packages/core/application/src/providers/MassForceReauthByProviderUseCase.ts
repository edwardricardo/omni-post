/**
 * @file MassForceReauthByProviderUseCase.ts
 * @description Admin-triggered cross-tenant mass force-reauth for a provider.
 *              When a platform-level OAuth client_secret rotates, every
 *              dependent Channel may need to be flagged so the tenant
 *              reconnects. The admin chooses tier:
 *                - flagChannels (default): set Channel.needsReauth = true
 *                - softDeleteChannels (opt-in, destructive): set deletedAt
 *              Tiers are independent toggles. All branches run inside one
 *              UoW; audit log is emitted by the route handler post-commit.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { Provider } from "@core/domain/value-objects/Provider.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface MassForceReauthInput {
  provider: string;
  reason: string;
  flagChannels?: boolean;
  softDeleteChannels?: boolean;
}

export interface MassForceReauthOutput {
  provider: string;
  tiers: {
    flagChannels: boolean;
    softDeleteChannels: boolean;
  };
  channelsFlagged: number;
  channelsSoftDeleted: number;
  channelIds: string[];
}

export class MassForceReauthByProviderUseCase implements UseCase<
  MassForceReauthInput,
  MassForceReauthOutput,
  UseCaseError
> {
  constructor(
    private readonly channelRepository: ChannelRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: MassForceReauthInput): Promise<Result<MassForceReauthOutput, UseCaseError>> {
    if (!input.provider.trim()) {
      return err(new UseCaseError("provider is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    const providerResult = Provider.fromString(input.provider.trim());
    if (!providerResult.ok) {
      return err(
        new UseCaseError(`Invalid provider: ${input.provider}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }
    const provider = providerResult.value;

    const reason = input.reason.trim();
    if (!reason) {
      return err(new UseCaseError("reason is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const flagChannels = input.flagChannels ?? true;
    const softDeleteChannels = input.softDeleteChannels ?? false;

    const doWork = async (): Promise<Result<MassForceReauthOutput, UseCaseError>> => {
      let channelsFlagged = 0;
      let channelsSoftDeleted = 0;
      const channelIds: string[] = [];

      if (flagChannels) {
        const flag = await this.channelRepository.bulkMarkForReauthByProvider(provider, reason);
        channelsFlagged = flag.count;
        channelIds.push(...flag.channelIds);
      }

      if (softDeleteChannels) {
        const del = await this.channelRepository.bulkSoftDeleteByProvider(provider);
        channelsSoftDeleted = del.count;
        for (const id of del.channelIds) {
          if (!channelIds.includes(id)) channelIds.push(id);
        }
      }

      return ok({
        provider: provider.type,
        tiers: { flagChannels, softDeleteChannels },
        channelsFlagged,
        channelsSoftDeleted,
        channelIds,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<MassForceReauthOutput, UseCaseError> = err(
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
          "Failed to execute mass force-reauth",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
