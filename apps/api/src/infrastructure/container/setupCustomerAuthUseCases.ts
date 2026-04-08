/**
 * @file setupCustomerAuthUseCases.ts
 * @description Registers CustomerUser repository and customer authentication
 *   use cases in the DI container.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { CustomerUserRepository } from "../../domain/repositories/CustomerUserRepository.js";
import type { AccountRepositoryPort } from "../../domain/repositories/AccountRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { EmailPort } from "../../domain/repositories/EmailPort.js";
import { PrismaAccountSubscriptionAdapter } from "../repositories/PrismaAccountSubscriptionAdapter.js";
import { PrismaCustomerUserRepository } from "../repositories/PrismaCustomerUserRepository.js";
import {
  RegisterCustomerUseCase,
  LoginCustomerUseCase,
  RefreshCustomerTokenUseCase,
  LogoutCustomerUseCase,
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
} from "../../application/customer-auth/index.js";

/**
 * @function setupCustomerAuthUseCases
 * @description Registers all customer auth dependencies in the DI container.
 */
export function setupCustomerAuthUseCases(container: Container): void {
  // Repository
  container.register<CustomerUserRepository>(
    TOKENS.CustomerUserRepository,
    () => new PrismaCustomerUserRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register
  container.register<RegisterCustomerUseCase>(
    TOKENS.RegisterCustomerUseCase,
    () =>
      new RegisterCustomerUseCase(
        container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository),
        container.resolve<AccountRepositoryPort>(TOKENS.AccountRepository),
        new PrismaAccountSubscriptionAdapter(),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // Login
  container.register<LoginCustomerUseCase>(
    TOKENS.LoginCustomerUseCase,
    () =>
      new LoginCustomerUseCase(
        container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository),
        container.resolve<AccountRepositoryPort>(TOKENS.AccountRepository)
      ),
    true
  );

  // Refresh
  container.register<RefreshCustomerTokenUseCase>(
    TOKENS.RefreshCustomerTokenUseCase,
    () =>
      new RefreshCustomerTokenUseCase(
        container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository)
      ),
    true
  );

  // Logout
  container.register<LogoutCustomerUseCase>(
    TOKENS.LogoutCustomerUseCase,
    () => new LogoutCustomerUseCase(),
    true
  );

  // Request Password Reset
  container.register<RequestPasswordResetUseCase>(
    TOKENS.RequestPasswordResetUseCase,
    () =>
      new RequestPasswordResetUseCase(
        container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository),
        container.resolve<EmailPort>(TOKENS.EmailPort),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // Reset Password
  container.register<ResetPasswordUseCase>(
    TOKENS.ResetPasswordUseCase,
    () =>
      new ResetPasswordUseCase(
        container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
}
