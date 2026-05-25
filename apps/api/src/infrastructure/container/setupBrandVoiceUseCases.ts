/**
 * @file setupBrandVoiceUseCases.ts
 * @description DI registrations for Brand Voice feature (Task 11.7).
 *              Registers repository adapter and use cases as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import { PrismaBrandVoiceRepository } from "../repositories/PrismaBrandVoiceRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { GetBrandVoiceQuery } from "@core/application/brand-voice/GetBrandVoiceQuery.js";
import { UpsertBrandVoiceUseCase } from "@core/application/brand-voice/UpsertBrandVoiceUseCase.js";
import { DeleteBrandVoiceUseCase } from "@core/application/brand-voice/DeleteBrandVoiceUseCase.js";

export function setupBrandVoiceUseCases(container: Container): void {
  const repo = new PrismaBrandVoiceRepository(prisma);
  const uow = () => container.resolve<UnitOfWork>(TOKENS.UnitOfWork);
  container.registerInstance(TOKENS.BrandVoiceRepository, repo);
  container.registerInstance(TOKENS.GetBrandVoiceQuery, new GetBrandVoiceQuery(repo));
  container.register(
    TOKENS.UpsertBrandVoiceUseCase,
    () => new UpsertBrandVoiceUseCase(repo, uow()),
    true
  );
  container.register(
    TOKENS.DeleteBrandVoiceUseCase,
    () => new DeleteBrandVoiceUseCase(repo, uow()),
    true
  );
}
