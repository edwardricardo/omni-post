/**
 * @file MassForceReauthByProviderUseCase.ts
 * @description Admin-triggered cross-tenant mass force-reauth for a provider.
 *              When a platform-level OAuth client_secret rotates, every
 *              dependent Channel + ProviderConnection row may need to be
 *              flagged so the tenant reconnects. The admin chooses tier:
 *                - flagChannels (default): set Channel.needsReauth = true
 *                - disableProviderConnections (opt-in): set isActive = false
 *                - softDeleteChannels (opt-in, destructive): set deletedAt
 *              Tiers are independent toggles. All branches run inside one
 *              UoW; audit log is emitted by the route handler post-commit.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { Provider } from "../../domain/value-objects/Provider.js";
import type { ChannelRepository } from "../../domain/repositories/ChannelRepository.js";
import type { ProviderConnectionRepository } from "./ProviderConnectionRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

export interface MassForceReauthInput {
  provider: string;
  reason: string;
  flagChannels?: boolean;
  disableProviderConnections?: boolean;
  softDeleteChannels?: boolean;
}

export interface MassForceReauthOutput {
  provider: string;
  tiers: {
    flagChannels: boolean;
    disableProviderConnections: boolean;
    softDeleteChannels: boolean;
  };
  channelsFlagged: number;
  providerConnectionsDisabled: number;
  channelsSoftDeleted: number;
  channelIds: string[];
  providerConnectionIds: string[];
}

export class MassForceReauthByProviderUseCase implements UseCase<
  MassForceReauthInput,
  MassForceReauthOutput,
  UseCaseError
> {
  constructor(
    private readonly channelRepository: ChannelRepository,
    private readonly providerConnectionRepository: ProviderConnectionRepository,
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
    const disableProviderConnections = input.disableProviderConnections ?? false;
    const softDeleteChannels = input.softDeleteChannels ?? false;

    const doWork = async (): Promise<Result<MassForceReauthOutput, UseCaseError>> => {
      let channelsFlagged = 0;
      let providerConnectionsDisabled = 0;
      let channelsSoftDeleted = 0;
      const channelIds: string[] = [];
      const providerConnectionIds: string[] = [];

      if (flagChannels) {
        const flag = await this.channelRepository.bulkMarkForReauthByProvider(provider, reason);
        channelsFlagged = flag.count;
        channelIds.push(...flag.channelIds);
      }

      if (disableProviderConnections) {
        const disable = await this.providerConnectionRepository.bulkDisableByProvider(
          provider.type
        );
        providerConnectionsDisabled = disable.count;
        providerConnectionIds.push(...disable.connectionIds);
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
        tiers: { flagChannels, disableProviderConnections, softDeleteChannels },
        channelsFlagged,
        providerConnectionsDisabled,
        channelsSoftDeleted,
        channelIds,
        providerConnectionIds,
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
