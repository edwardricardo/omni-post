/**
 * @file setupProjectUseCases.ts
 * @description Registers project lifecycle use cases (soft delete and the separate, admin-only
 *              hard delete) in the DI container.
 * @layer infrastructure
 */
import type { PrismaClient } from "@infra/prisma";
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import {
  DeleteProjectUseCase,
  HardDeleteProjectUseCase,
  RestoreProjectUseCase,
} from "@core/projects/index.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import { HARD_DELETE_TX_OPTIONS } from "../hardDeleteTransaction.js";

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

  // The hard delete gets a DEDICATED Unit of Work, not the shared one: it runs
  // at Serializable isolation (so the tombstone snapshot cannot miss a row a
  // concurrent insert commits mid-transaction) with an explicit, sized timeout
  // (so a large cascade has a real budget). Opening it here — rather than letting
  // the adapter open its own — is what binds the `app.account_id` RLS GUC for the
  // cascade, under the route's `withSystemContext`.
  container.register<HardDeleteProjectUseCase>(
    TOKENS.HardDeleteProjectUseCase,
    () =>
      new HardDeleteProjectUseCase(
        container.resolve<ProjectRepositoryPort>(TOKENS.ProjectRepository),
        new PrismaUnitOfWork(
          container.resolve<PrismaClient>(TOKENS.PrismaClient),
          HARD_DELETE_TX_OPTIONS
        )
      ),
    true
  );

  // Restore reverses the soft delete (clears deletedAt). Uses the shared Unit of
  // Work like the soft delete — a single-row update, no cascade, so it needs no
  // dedicated Serializable transaction.
  container.register<RestoreProjectUseCase>(
    TOKENS.RestoreProjectUseCase,
    () =>
      new RestoreProjectUseCase(
        container.resolve<ProjectRepositoryPort>(TOKENS.ProjectRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
}
