/**
 * @file setupProjectUseCases.ts
 * @description Registers project lifecycle use cases (soft delete and the separate, admin-only
 *              hard delete) in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { DeleteProjectUseCase, HardDeleteProjectUseCase } from "@core/projects/index.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * @method setupProjectUseCases
 * @description Register project lifecycle use cases. Singletons — use cases are stateless.
 */
export function setupProjectUseCases(container: Container): void {
  container.register<DeleteProjectUseCase>(
    TOKENS.DeleteProjectUseCase,
    () =>
      new DeleteProjectUseCase(
        container.resolve<ProjectRepositoryPort>(TOKENS.ProjectRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // No UnitOfWork: PrismaProjectRepository.hardDelete already runs its whole
  // FK-ordered cascade inside a single transaction (and joins an outer UoW
  // transaction when one is active), so an extra interactive transaction here
  // would widen the lock window without adding atomicity.
  container.register<HardDeleteProjectUseCase>(
    TOKENS.HardDeleteProjectUseCase,
    () =>
      new HardDeleteProjectUseCase(
        container.resolve<ProjectRepositoryPort>(TOKENS.ProjectRepository)
      ),
    true
  );
}
