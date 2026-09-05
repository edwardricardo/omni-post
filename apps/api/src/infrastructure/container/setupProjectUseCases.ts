/**
 * @file setupProjectUseCases.ts
 * @description Registers the admin-only hard-delete project use case in the DI container.
 * @layer infrastructure
 */
import type { PrismaClient } from "@infra/prisma";
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { HardDeleteProjectUseCase } from "@core/projects/index.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import { HARD_DELETE_TX_OPTIONS } from "../hardDeleteTransaction.js";

/**
 * @method setupProjectUseCases
 * @description Register project lifecycle use cases. Singletons — use cases are stateless.
 */
export function setupProjectUseCases(container: Container): void {
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
}
