/**
 * @file setupAccountUseCases.ts
 * @description Registers account lifecycle use cases (soft delete and the separate, admin-only
 *              hard delete) in the DI container.
 * @layer infrastructure
 */
import type { PrismaClient } from "@infra/prisma";
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import {
  DeleteAccountUseCase,
  HardDeleteAccountUseCase,
  RestoreAccountUseCase,
} from "@core/accounts/index.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import { HARD_DELETE_TX_OPTIONS } from "../hardDeleteTransaction.js";

/**
 * @method setupAccountUseCases
 * @description Register account lifecycle use cases. Singletons — use cases are stateless.
 */
export function setupAccountUseCases(container: Container): void {
  container.register<DeleteAccountUseCase>(
    TOKENS.DeleteAccountUseCase,
    () =>
      new DeleteAccountUseCase(
        container.resolve<AccountRepositoryPort>(TOKENS.AccountRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // The hard delete gets a DEDICATED Unit of Work, not the shared one: it runs
  // at Serializable isolation (so the tombstone snapshot cannot miss a project a
  // concurrent insert commits mid-transaction) with an explicit, sized timeout
  // (so a large cascade has a real budget). Opening it here — rather than letting
  // the adapter open its own — is what binds the `app.account_id` RLS GUC for the
  // cascade, under the route's `withSystemContext`.
  container.register<HardDeleteAccountUseCase>(
    TOKENS.HardDeleteAccountUseCase,
    () =>
      new HardDeleteAccountUseCase(
        container.resolve<AccountRepositoryPort>(TOKENS.AccountRepository),
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
  container.register<RestoreAccountUseCase>(
    TOKENS.RestoreAccountUseCase,
    () =>
      new RestoreAccountUseCase(
        container.resolve<AccountRepositoryPort>(TOKENS.AccountRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
}
