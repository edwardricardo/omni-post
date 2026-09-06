/**
 * @file setupProjectUseCases.ts
 * @description Registers the project lifecycle use cases (customer-facing soft delete and the
 *              separate, admin-only hard delete) in the DI container.
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
  // The soft delete uses the SHARED Unit of Work, not the hard delete's
  // dedicated Serializable one. It is a single UPDATE of a single row by
  // primary key: there is no multi-row snapshot for Serializable to keep
  // consistent, so the stricter level would buy only retryable serialization
  // failures. What the soft delete DOES want from the transaction — and the
  // shared PrismaUnitOfWork provides — is the `app.account_id` RLS GUC bound
  // at tx start (layer 2 of tenant isolation) and atomicity over the
  // existence-probe + update pair inside the repository's `delete`.
  container.register<DeleteProjectUseCase>(
    TOKENS.DeleteProjectUseCase,
    () =>
      new DeleteProjectUseCase(
        container.resolve<ProjectRepositoryPort>(TOKENS.ProjectRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // The restore takes the SAME shared Unit of Work as the soft delete it
  // reverses, and for the same reasons: it is one UPDATE clearing `deletedAt` on
  // one row by primary key, so Serializable would buy only retryable
  // serialization failures, while the shared transaction supplies the two things
  // the operation genuinely needs — the `app.account_id` RLS GUC bound at tx
  // start, and atomicity over the liveness/name-collision reads and the write
  // they guard.
  container.register<RestoreProjectUseCase>(
    TOKENS.RestoreProjectUseCase,
    () =>
      new RestoreProjectUseCase(
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
}
