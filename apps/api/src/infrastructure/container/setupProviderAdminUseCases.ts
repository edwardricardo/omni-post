/**
 * @file setupProviderAdminUseCases.ts
 * @description DI registrations for the provider-admin mass-reauth feature:
 *              ProviderConnectionRepository adapter + the mass-reauth use case.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import { PrismaProviderConnectionRepository } from "../repositories/PrismaProviderConnectionRepository.js";
import { MassForceReauthByProviderUseCase } from "../../application/providers/MassForceReauthByProviderUseCase.js";
import type { ChannelRepository } from "../../domain/repositories/ChannelRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

export function setupProviderAdminUseCases(container: Container): void {
  const repo = new PrismaProviderConnectionRepository(prisma);
  container.registerInstance(TOKENS.ProviderConnectionRepository, repo);
  container.register<MassForceReauthByProviderUseCase>(
    TOKENS.MassForceReauthByProviderUseCase,
    () =>
      new MassForceReauthByProviderUseCase(
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
        repo,
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
}
