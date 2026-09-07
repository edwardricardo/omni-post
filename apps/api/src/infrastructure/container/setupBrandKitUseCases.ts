/**
 * @file setupBrandKitUseCases.ts
 * @description DI registrations for Brand Kit feature.
 *              Registers repository adapter and use cases as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { PrismaClient } from "@infra/prisma";
import { PrismaBrandKitRepository } from "../repositories/PrismaBrandKitRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { GetBrandKitQuery } from "@core/brand-kit/GetBrandKitQuery.js";
import { UpsertBrandKitUseCase } from "@core/brand-kit/UpsertBrandKitUseCase.js";
import { DeleteBrandKitUseCase } from "@core/brand-kit/DeleteBrandKitUseCase.js";

/**
 * @function setupBrandKitUseCases
 * @description Registers brand-kit repository and use cases (get/upsert/delete) in the container.
 * @param container - DI container
 */
export function setupBrandKitUseCases(container: Container): void {
  // The container's client, never the `@infra/prisma` singleton: `setup.ts` is where the tenant
  // guard and the request-scoped GUC binding are applied, so a repository built from the raw
  // singleton is DI-resolved and yet unguarded and unbound. `brandKit` is guard-enrolled and
  // RLS-covered, so under the application role that repository answers zero rows with no throw.
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);
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
