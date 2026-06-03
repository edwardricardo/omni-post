/**
 * @file setupProviderAdminUseCases.ts
 * @description DI registrations for the provider-admin mass-reauth feature.
 *              The use case operates only on the Channel aggregate.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { MassForceReauthByProviderUseCase } from "@core/providers/MassForceReauthByProviderUseCase.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * @function setupProviderAdminUseCases
 * @description Registers provider-admin use cases (mass-reauth-by-provider) in the container.
 * @param container - DI container
 */
export function setupProviderAdminUseCases(container: Container): void {
  container.register<MassForceReauthByProviderUseCase>(
    TOKENS.MassForceReauthByProviderUseCase,
    () =>
      new MassForceReauthByProviderUseCase(
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
}
