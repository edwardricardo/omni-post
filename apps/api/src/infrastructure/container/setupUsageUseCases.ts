/**
 * @file setupUsageUseCases.ts
 * @description Registers usage metering use cases in the DI container.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { PrismaUsageMetricRepository } from "../repositories/PrismaUsageMetricRepository.js";
import type { UsageMetricRepository } from "@core/domain/repositories/UsageMetricRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { IncrementUsageUseCase } from "@core/usage/IncrementUsageUseCase.js";
import { GetUsageUseCase } from "@core/usage/GetUsageUseCase.js";

/**
 * @method setupUsageUseCases
 * @description Registers the usage metric repository and use cases as singletons.
 */
export function setupUsageUseCases(container: Container): void {
  container.register<UsageMetricRepository>(
    TOKENS.UsageMetricRepository,
    () => new PrismaUsageMetricRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  const repo = () => container.resolve<UsageMetricRepository>(TOKENS.UsageMetricRepository);

  const uow = () => container.resolve<UnitOfWork>(TOKENS.UnitOfWork);

  container.register(
    TOKENS.IncrementUsageUseCase,
    () => new IncrementUsageUseCase(repo(), uow()),
    true
  );

  container.register(TOKENS.GetUsageUseCase, () => new GetUsageUseCase(repo()), true);
}
