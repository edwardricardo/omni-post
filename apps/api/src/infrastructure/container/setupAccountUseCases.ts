/**
 * @file setupAccountUseCases.ts
 * @description Registers the admin-only hard-delete account use case in the DI container.
 * @layer infrastructure
 */
import type { PrismaClient } from "@infra/prisma";
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { HardDeleteAccountUseCase } from "@core/accounts/index.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import { HARD_DELETE_TX_OPTIONS } from "../hardDeleteTransaction.js";

/**
 * @method setupAccountUseCases
 * @description Register account lifecycle use cases. Singletons — use cases are stateless.
 */
export function setupAccountUseCases(container: Container): void {
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
}
