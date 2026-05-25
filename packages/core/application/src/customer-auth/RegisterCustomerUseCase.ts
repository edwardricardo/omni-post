/**
 * @file RegisterCustomerUseCase.ts
 * @description Creates a new Account + CustomerUser atomically, hashes the password,
 *   and returns JWT tokens for immediate login (no email verification enforced).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { CustomerRoleRepository } from "@core/domain/repositories/CustomerRoleRepository.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import { Account, type SubscriptionTierValue } from "@core/domain/entities/Account.js";
import { CustomerUser } from "@core/domain/entities/CustomerUser.js";
import { randomBytes } from "crypto";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import type { CustomerTokenService } from "@core/domain/repositories/CustomerTokenService.js";
import type { AccountSubscriptionPort } from "@core/domain/repositories/AccountSubscriptionPort.js";
import type { WelcomeMailer } from "@core/domain/repositories/WelcomeMailer.js";
import type { PlatformCredentialReader } from "@core/domain/repositories/PlatformCredentialReader.js";

/** Error code union for this use case */
export type RegisterCustomerError = "VALIDATION_ERROR" | "EMAIL_EXISTS" | "INTERNAL_ERROR";

/** Input DTO */
export interface RegisterCustomerInput {
  readonly accountName: string;
  readonly accountEmail: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly password: string;
  readonly plan?: SubscriptionTierValue;
}

/** Output DTO */
export interface RegisterCustomerOutput {
  readonly account: Record<string, unknown>;
  readonly user: Record<string, unknown>;
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * @class RegisterCustomerUseCase
 * @description Orchestrates customer registration: creates Account + CustomerUser
 *   atomically, then signs JWT tokens for immediate login.
 */
export class RegisterCustomerUseCase {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly customerRoleRepo: CustomerRoleRepository,
    private readonly accountRepo: AccountRepositoryPort,
    private readonly hasher: PasswordHasher,
    private readonly tokenService: CustomerTokenService,
    private readonly accountSubscriptionPort?: AccountSubscriptionPort,
    private readonly unitOfWork?: UnitOfWork,
    private readonly welcomeMailer?: WelcomeMailer,
    private readonly credentialService?: PlatformCredentialReader
  ) {}

  /**
   * @method execute
   * @description Creates account + user in a single transaction and returns tokens.
   */
  async execute(
    input: RegisterCustomerInput
  ): Promise<Result<RegisterCustomerOutput, RegisterCustomerError>> {
    // Basic validation
    if (!input.email || !input.password || !input.firstName || !input.lastName) {
      return err("VALIDATION_ERROR");
    }
    if (input.password.length < 8) {
      return err("VALIDATION_ERROR");
    }

    // Check for duplicate email across all accounts
    const existingUsers = await this.customerUserRepo.findByEmailAcrossAccounts(input.email);
    if (existingUsers.length > 0) {
      return err("EMAIL_EXISTS");
    }

    // Create Account domain entity
    const accountResult = Account.create({
      email: input.accountEmail || input.email,
      name: input.accountName || `${input.firstName} ${input.lastName}`,
      ...(input.plan !== undefined && { subscription: input.plan }),
    });

    if (!accountResult.ok) {
      return err("VALIDATION_ERROR");
    }

    const account = accountResult.value;

    // Hash password (application layer responsibility)
    const passwordHash = await this.hasher.hash(input.password);

    // Resolve the OWNER role snapshot — the account creator owns the account.
    const ownerRoleResult = await this.customerRoleRepo.getSnapshotByName("OWNER");
    if (!ownerRoleResult.ok) {
      return err("INTERNAL_ERROR");
    }
    const ownerRole = ownerRoleResult.value;

    // Create CustomerUser domain entity
    const userId = randomBytes(12).toString("hex");
    const userResult = CustomerUser.create({
      id: userId,
      accountId: account.id.toString(),
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      roleId: ownerRole.roleId,
      roleName: ownerRole.roleName,
      roleLevel: ownerRole.roleLevel,
      permissions: ownerRole.permissions,
    });

    if (!userResult.ok) {
      return err("VALIDATION_ERROR");
    }

    const user = userResult.value;

    const doWork = async (): Promise<Result<RegisterCustomerOutput, RegisterCustomerError>> => {
      // Persist account
      const saveAccountResult = await this.accountRepo.save(account);
      if (!saveAccountResult.ok) {
        return err("INTERNAL_ERROR");
      }

      // Create AccountSubscription for trial period
      if (this.accountSubscriptionPort) {
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 14);
        await this.accountSubscriptionPort.createForNewAccount({
          accountId: account.id.toString(),
          status: "TRIALING",
          pricePerMonth: 0,
          maxProjects: 3,
          trialEndsAt,
          billingCycle: "MONTHLY",
        });
      }

      // Persist customer user
      const saveUserResult = await this.customerUserRepo.save(user, passwordHash);
      if (!saveUserResult.ok) {
        return err("INTERNAL_ERROR");
      }

      // Sign tokens for immediate login
      const sessionId = randomBytes(16).toString("hex");
      const accessToken = this.tokenService.signAccessToken({
        sub: user.id,
        accountId: user.accountId,
        roleId: user.roleId,
        roleName: user.roleName,
        permissions: [...user.permissions],
      });
      const refreshToken = this.tokenService.signRefreshToken(user.id, sessionId);

      return ok({
        account: account.toJSON(),
        user: { ...user.toJSON() } as Record<string, unknown>,
        accessToken,
        refreshToken,
      });
    };

    try {
      let result: Result<RegisterCustomerOutput, RegisterCustomerError>;
      if (this.unitOfWork) {
        result = err("INTERNAL_ERROR");
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
      } else {
        result = await doWork();
      }

      // Send welcome email after successful registration (never blocks).
      // Delivery failures are surfaced by the email adapter's own logging;
      // they must never roll back a committed registration.
      if (result.ok && this.welcomeMailer) {
        this.sendWelcomeEmail(account.name, input.email).catch(() => {});
      }

      return result;
    } catch (_error: unknown) {
      return err("INTERNAL_ERROR");
    }
  }

  /**
   * @method sendWelcomeEmail
   * @description Sends welcome email to newly registered customer. Never throws.
   */
  private async sendWelcomeEmail(accountName: string, email: string): Promise<void> {
    if (!this.welcomeMailer) return;

    let baseUrl = "https://app.omnipost.io";
    let supportEmail = "support@omnipost.io";

    if (this.credentialService) {
      const platformResult = await this.credentialService.getPlatformCredentials();
      if (platformResult.ok) {
        baseUrl = platformResult.value.baseUrl || baseUrl;
        supportEmail = platformResult.value.supportEmail || supportEmail;
      }
    }

    await this.welcomeMailer.sendWelcome(email, {
      accountName,
      onboardingUrl: `${baseUrl}/dashboard`,
      supportEmail,
    });
  }
}
