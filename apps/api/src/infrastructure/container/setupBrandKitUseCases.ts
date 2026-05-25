/**
 * @file setupBrandKitUseCases.ts
 * @description DI registrations for Brand Kit feature.
 *              Registers repository adapter and use cases as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import { PrismaBrandKitRepository } from "../repositories/PrismaBrandKitRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { GetBrandKitQuery } from "@core/application/brand-kit/GetBrandKitQuery.js";
import { UpsertBrandKitUseCase } from "@core/application/brand-kit/UpsertBrandKitUseCase.js";
import { DeleteBrandKitUseCase } from "@core/application/brand-kit/DeleteBrandKitUseCase.js";

export function setupBrandKitUseCases(container: Container): void {
  const repo = new PrismaBrandKitRepository(prisma);
  const uow = () => container.resolve<UnitOfWork>(TOKENS.UnitOfWork);
  container.registerInstance(TOKENS.BrandKitRepository, repo);
  container.registerInstance(TOKENS.GetBrandKitQuery, new GetBrandKitQuery(repo));
  container.register(
    TOKENS.UpsertBrandKitUseCase,
    () => new UpsertBrandKitUseCase(repo, uow()),
    true
  );
  container.register(
    TOKENS.DeleteBrandKitUseCase,
    () => new DeleteBrandKitUseCase(repo, uow()),
    true
  );
}
