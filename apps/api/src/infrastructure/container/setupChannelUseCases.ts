/**
 * @file setupChannelUseCases.ts
 * @description Registers channel-related use cases (currently just primary
 *              promotion) in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { SetPrimaryChannelUseCase, UpdateChannelAuthStateUseCase } from "@core/channels/index.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * @method setupChannelUseCases
 * @description Register channel use cases. Singletons — use cases are stateless.
 */
export function setupChannelUseCases(container: Container): void {
  container.register<SetPrimaryChannelUseCase>(
    TOKENS.SetPrimaryChannelUseCase,
    () =>
      new SetPrimaryChannelUseCase(
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  container.register<UpdateChannelAuthStateUseCase>(
    TOKENS.UpdateChannelAuthStateUseCase,
    () =>
      new UpdateChannelAuthStateUseCase(
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
}
