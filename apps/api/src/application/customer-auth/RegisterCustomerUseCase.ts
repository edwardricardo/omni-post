/**
 * @file RegisterCustomerUseCase.ts
 * @description Creates a new Account + CustomerUser atomically, hashes the password,
 *   and returns JWT tokens for immediate login (no email verification enforced).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { CustomerUserRepository } from "../../domain/repositories/CustomerUserRepository.js";
import type { CustomerRoleRepository } from "../../domain/repositories/CustomerRoleRepository.js";
import type { AccountRepositoryPort } from "../../domain/repositories/AccountRepository.js";
import { Account, type SubscriptionTierValue } from "../../domain/entities/Account.js";
import { CustomerUser } from "../../domain/entities/CustomerUser.js";
import { randomBytes } from "crypto";
import { hashPassword } from "../../auth/passwordHashing.js";
import type { AccountSubscriptionPort } from "../../domain/repositories/AccountSubscriptionPort.js";
import type { EmailPort } from "../../domain/repositories/EmailPort.js";
import type { PlatformCredentialService } from "../../security/PlatformCredentialService.js";
import { welcomeEmail } from "../notifications/emailTemplates.js";
import { signCustomerAccessToken, signCustomerRefreshToken } from "../../auth/customerJwt.js";
import { createLogger } from "../../lib/logger.js";

const registrationLogger = createLogger("customer-registration");

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
    private readonly accountSubscriptionPort?: AccountSubscriptionPort,
    private readonly unitOfWork?: UnitOfWork,
    private readonly emailPort?: EmailPort,
    private readonly credentialService?: PlatformCredentialService
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
    const passwordHash = await hashPassword(input.password);

    // Resolve the OWNER role snapshot — the account creator owns the account.
    const ownerRoleResult = await this.customerRoleRepo.getSnapshotByName("OWNER");
    if (!ownerRoleResult.ok) {
      registrationLogger.error(
        { err: ownerRoleResult.error.message },
        "OWNER CustomerRole not seeded; cannot register customer"
      );
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
      const accessToken = signCustomerAccessToken({
        sub: user.id,
        accountId: user.accountId,
        roleId: user.roleId,
        roleName: user.roleName,
        permissions: [...user.permissions],
      });
      const refreshToken = signCustomerRefreshToken(user.id, sessionId);

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

      // Send welcome email after successful registration (never blocks)
      if (result.ok && this.emailPort) {
        this.sendWelcomeEmail(account.name, input.email).catch((e) =>
          registrationLogger.warn({ err: e }, "Failed to send welcome email")
        );
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
    if (!this.emailPort) return;

    let baseUrl = "https://app.omnipost.io";
    let supportEmail = "support@omnipost.io";

    if (this.credentialService) {
      const platformResult = await this.credentialService.getGroup("PLATFORM");
      if (platformResult.ok) {
        baseUrl = platformResult.value.baseUrl || baseUrl;
        supportEmail = platformResult.value.supportEmail || supportEmail;
      }
    }

    const content = await welcomeEmail({
      accountName,
      onboardingUrl: `${baseUrl}/dashboard`,
      supportEmail,
    });

    await this.emailPort.send({
      to: [email],
      subject: content.subject,
      body: `Welcome to OmniPost! Get started at ${baseUrl}/dashboard`,
      html: content.html,
    });
  }
}
