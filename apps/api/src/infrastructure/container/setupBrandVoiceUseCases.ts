/**
 * @file setupBrandVoiceUseCases.ts
 * @description DI registrations for Brand Voice feature (Task 11.7).
 *              Registers repository adapter and use cases as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { PrismaClient } from "@infra/prisma";
import { PrismaBrandVoiceRepository } from "../repositories/PrismaBrandVoiceRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { GetBrandVoiceQuery } from "@core/brand-voice/GetBrandVoiceQuery.js";
import { UpsertBrandVoiceUseCase } from "@core/brand-voice/UpsertBrandVoiceUseCase.js";
import { DeleteBrandVoiceUseCase } from "@core/brand-voice/DeleteBrandVoiceUseCase.js";

/**
 * @function setupBrandVoiceUseCases
 * @description Registers brand-voice repository and use cases (get/upsert/delete) in the container.
 * @param container - DI container
 */
export function setupBrandVoiceUseCases(container: Container): void {
  // The container's client, never the `@infra/prisma` singleton — `setup.ts` applies the tenant
  // guard and the request-scoped GUC binding there. `brandVoice` is guard-enrolled and
  // RLS-covered; these use cases serve authenticated tenant flows that already bind context.
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);
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
