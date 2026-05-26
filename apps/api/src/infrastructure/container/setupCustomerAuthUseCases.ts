/**
 * @file setupCustomerAuthUseCases.ts
 * @description Registers CustomerUser repository and customer authentication
 *   use cases in the DI container.
 * @layer infrastructure
 */

import type { CachePort } from "@ports/core";
import type { PrismaClient } from "@infra/prisma";

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { env } from "../../config/env.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { CustomerRoleRepository } from "@core/domain/repositories/CustomerRoleRepository.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import type { WelcomeMailer } from "@core/domain/repositories/WelcomeMailer.js";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import type { CustomerTokenService } from "@core/domain/repositories/CustomerTokenService.js";
import type { PlatformCredentialReader } from "@core/domain/repositories/PlatformCredentialReader.js";
import { PrismaAccountSubscriptionAdapter } from "../repositories/PrismaAccountSubscriptionAdapter.js";
import { PrismaCustomerUserRepository } from "../repositories/PrismaCustomerUserRepository.js";
import { PrismaCustomerRoleRepository } from "../repositories/PrismaCustomerRoleRepository.js";
import {
  RegisterCustomerUseCase,
  LoginCustomerUseCase,
  RefreshCustomerTokenUseCase,
  LogoutCustomerUseCase,
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
} from "@core/application/customer-auth/index.js";

/**
 * @function setupCustomerAuthUseCases
 * @description Registers all customer auth dependencies in the DI container.
 */
export function setupCustomerAuthUseCases(container: Container): void {
  // Repositories
  container.register<CustomerUserRepository>(
    TOKENS.CustomerUserRepository,
    () => new PrismaCustomerUserRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<CustomerRoleRepository>(
    TOKENS.CustomerRoleRepository,
    () => new PrismaCustomerRoleRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register
  container.register<RegisterCustomerUseCase>(
    TOKENS.RegisterCustomerUseCase,
    () =>
      new RegisterCustomerUseCase(
        container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository),
        container.resolve<CustomerRoleRepository>(TOKENS.CustomerRoleRepository),
        container.resolve<AccountRepositoryPort>(TOKENS.AccountRepository),
        container.resolve<PasswordHasher>(TOKENS.PasswordHasher),
        container.resolve<CustomerTokenService>(TOKENS.CustomerTokenService),
        new PrismaAccountSubscriptionAdapter(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork),
        container.resolve<WelcomeMailer>(TOKENS.WelcomeMailer),
        container.resolve<PlatformCredentialReader>(TOKENS.PlatformCredentialService)
      ),
    true
  );

  // Login
  container.register<LoginCustomerUseCase>(
    TOKENS.LoginCustomerUseCase,
    () =>
      new LoginCustomerUseCase(
        container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository),
        container.resolve<AccountRepositoryPort>(TOKENS.AccountRepository),
        container.resolve<PasswordHasher>(TOKENS.PasswordHasher),
        container.resolve<CustomerTokenService>(TOKENS.CustomerTokenService)
      ),
    true
  );

  // Refresh
  container.register<RefreshCustomerTokenUseCase>(
    TOKENS.RefreshCustomerTokenUseCase,
    () =>
      new RefreshCustomerTokenUseCase(
        container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository),
        container.resolve<CachePort>(TOKENS.CachePort),
        container.resolve<CustomerTokenService>(TOKENS.CustomerTokenService)
      ),
    true
  );

  // Logout — receives the refresh token from the caller and revokes its
  // sessionId via CachePort so subsequent refresh attempts are rejected.
  container.register<LogoutCustomerUseCase>(
    TOKENS.LogoutCustomerUseCase,
    () =>
      new LogoutCustomerUseCase(
        container.resolve<CachePort>(TOKENS.CachePort),
        container.resolve<CustomerTokenService>(TOKENS.CustomerTokenService)
      ),
    true
  );

  // Request Password Reset
  container.register<RequestPasswordResetUseCase>(
    TOKENS.RequestPasswordResetUseCase,
    () =>
      new RequestPasswordResetUseCase(
        container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository),
        env.CLIENT_URL ?? "http://localhost:3200",
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
        container.resolve<PasswordHasher>(TOKENS.PasswordHasher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
}
