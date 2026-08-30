/**
 * @file setupAccountUseCases.ts
 * @description Registers account lifecycle use cases (soft delete and the separate, admin-only
 *              hard delete) in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { DeleteAccountUseCase, HardDeleteAccountUseCase } from "@core/accounts/index.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

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

  // No UnitOfWork: PrismaAccountRepository.hardDelete already runs its whole
  // FK-ordered cascade inside a single transaction (and joins an outer UoW
  // transaction when one is active), so an extra interactive transaction here
  // would widen the lock window without adding atomicity.
  container.register<HardDeleteAccountUseCase>(
    TOKENS.HardDeleteAccountUseCase,
    () =>
      new HardDeleteAccountUseCase(
        container.resolve<AccountRepositoryPort>(TOKENS.AccountRepository)
      ),
    true
  );
}
