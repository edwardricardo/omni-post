/**
 * @file RegisterCustomerUseCase.ts
 * @description Creates a new Account + CustomerUser atomically, hashes the password,
 *   and returns JWT tokens for immediate login (no email verification enforced).
 *   An address already held by any account, live or deleted, is refused with the same
 *   EMAIL_EXISTS; when the holder is a deleted account or a deleted user, the owner of the
 *   address is told by e-mail instead of the caller being told on screen.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { LoggerPort } from "@ports/core";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { CustomerRoleRepository } from "@core/domain/repositories/CustomerRoleRepository.js";
import {
  isAccountEmailTaken,
  type AccountRepositoryPort,
} from "@core/domain/repositories/AccountRepository.js";
import { Account, type SubscriptionTierValue } from "@core/domain/entities/Account.js";
import { CustomerUser } from "@core/domain/entities/CustomerUser.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";
import { randomBytes } from "crypto";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import type { CustomerTokenService } from "@core/domain/repositories/CustomerTokenService.js";
import type { AccountSubscriptionPort } from "@core/domain/repositories/AccountSubscriptionPort.js";
import type { WelcomeMailer } from "@core/domain/repositories/WelcomeMailer.js";
import type { DeletedAccountNoticeMailer } from "@core/domain/repositories/DeletedAccountNoticeMailer.js";
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
 * Who holds the addresses a registration claims. `taken` refuses the registration;
 * `deletedHolderAddresses` names the addresses whose holder is a deleted account or a
 * deleted user, each of which gets the notice.
 */
interface AddressHold {
  readonly taken: boolean;
  readonly deletedHolderAddresses: readonly string[];
}

/** The tokens of the session a registration opens. */
interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/** The platform links an e-mail sent from registration points at. */
interface PlatformLinks {
  readonly baseUrl: string;
  readonly supportEmail: string;
}

/** The answer for an address nothing holds. */
const FREE: AddressHold = { taken: false, deletedHolderAddresses: [] };

/** The answer for an address a live account holds. */
const TAKEN_BY_LIVE_HOLDER: AddressHold = { taken: true, deletedHolderAddresses: [] };

/** Used when the platform settings name no base URL. */
const DEFAULT_BASE_URL = "https://app.omnipost.io";

/** Used when the platform settings name no support address. */
const DEFAULT_SUPPORT_EMAIL = "support@omnipost.io";

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
    private readonly logger: LoggerPort,
    private readonly accountSubscriptionPort?: AccountSubscriptionPort,
    private readonly welcomeMailer?: WelcomeMailer,
    private readonly credentialService?: PlatformCredentialReader,
    private readonly deletedAccountNoticeMailer?: DeletedAccountNoticeMailer,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Creates account + user in a single transaction and returns tokens. An
   *   address any account already holds is refused with EMAIL_EXISTS whether that account
   *   is live or deleted, so the answer reveals nothing a live-account refusal would not;
   *   for a deleted holder the owner of the address is sent a notice afterwards.
   * @param input - The registration's account and user data.
   * @returns The created account, user and tokens; VALIDATION_ERROR for invalid input,
   *   EMAIL_EXISTS for an address already held, INTERNAL_ERROR for any other failure.
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

    const accountEmail = input.accountEmail || input.email;

    // Every read and write sits inside this try, the lookups included: a failure of the
    // cross-account read is a database fault like any other, so it is logged and answered
    // as INTERNAL_ERROR instead of escaping the application layer as a throw.
    try {
      const hold = await this.findHolder(input.email, accountEmail);
      if (hold.taken) {
        // Sent only after the decision, outside any transaction, and never awaited: the
        // refusal must not wait on the mail transport or differ from a live-holder refusal
        // because a notice is on its way.
        for (const address of hold.deletedHolderAddresses) {
          this.dispatchDeletedAccountNotice(address);
        }
        return err("EMAIL_EXISTS");
      }

      // Create Account domain entity
      const accountResult = Account.create({
        email: accountEmail,
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
        this.logger.error(
          { err: ownerRoleResult.error, operation: "registerCustomer.resolveOwnerRole" },
          "The OWNER role could not be resolved during registration"
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
        // Persist account. A live account born after the holder lookup above is refused
        // here by the database's partial unique, the only check that cannot race.
        const saveAccountResult = await this.accountRepo.save(account);
        if (!saveAccountResult.ok) {
          if (isAccountEmailTaken(saveAccountResult.error)) {
            return err("EMAIL_EXISTS");
          }
          this.logger.error(
            { err: saveAccountResult.error, operation: "registerCustomer.saveAccount" },
            "The account could not be saved during registration"
          );
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

        // Create the customer user. Creation is the intent, so a duplicate is a
        // typed conflict rather than a silent update of whoever already holds the
        // address — the pre-flight lookup above narrows the window but cannot
        // close it, and the database's own unique constraint is what does.
        const createUserResult = await this.customerUserRepo.create(user, passwordHash);
        if (!createUserResult.ok) {
          return createUserResult.error === "EMAIL_EXISTS"
            ? err("EMAIL_EXISTS")
            : err("INTERNAL_ERROR");
        }

        return ok({
          account: account.toJSON(),
          user: { ...user.toJSON() } as Record<string, unknown>,
          ...this.issueTokens(user),
        });
      };

      // A returned `err` must roll back what the unit already wrote (the account and its
      // trial subscription) rather than commit it, so the work runs through the Result-aware
      // seam: `ok` commits, `err` rolls back and comes back unchanged.
      const result = this.unitOfWork
        ? await this.unitOfWork.executeResultInTransaction(doWork)
        : await doWork();

      // The welcome e-mail follows a committed registration and never blocks it; its
      // failure is logged, because it can no longer change the answer.
      if (result.ok) {
        this.dispatchWelcomeEmail(account.name, input.email);
      }

      return result;
    } catch (error: unknown) {
      this.logger.error(
        { err: error, operation: "registerCustomer" },
        "Customer registration failed"
      );
      return err("INTERNAL_ERROR");
    }
  }

  /**
   * @method issueTokens
   * @description Signs the access and refresh tokens of a new session, so the customer is
   *   signed in as soon as the registration commits.
   * @param user - The user just created.
   * @returns The access token and the refresh token of the new session.
   */
  private issueTokens(user: CustomerUser): IssuedTokens {
    const sessionId = randomBytes(16).toString("hex");
    return {
      accessToken: this.tokenService.signAccessToken({
        sub: user.id,
        accountId: user.accountId,
        roleId: user.roleId,
        roleName: user.roleName,
        permissions: [...user.permissions],
      }),
      refreshToken: this.tokenService.signRefreshToken(user.id, sessionId),
    };
  }

  /**
   * @method findHolder
   * @description Decides who holds the addresses a registration claims. A live user of a
   *   live account, or a live account, takes the address with no notice. A live user whose
   *   account is deleted, a deleted user, or a deleted account takes it too, and names the
   *   address for the notice: the registration must not create an account beside the
   *   deleted one, and only the owner of the address may learn that it exists.
   * @param email - The address of the user being registered.
   * @param accountEmail - The address of the account being created.
   * @returns Whether the addresses are taken, and which of them belong to a deleted holder.
   */
  private async findHolder(email: string, accountEmail: string): Promise<AddressHold> {
    const liveUsers = await this.customerUserRepo.findByEmailAcrossAccounts(email);
    if (liveUsers.length > 0) {
      for (const liveUser of liveUsers) {
        if (await this.isAccountLive(liveUser.accountId)) {
          return TAKEN_BY_LIVE_HOLDER;
        }
      }
      return { taken: true, deletedHolderAddresses: [normalizeEmail(email)] };
    }

    const deletedHolderAddresses = new Set<string>();
    if (await this.customerUserRepo.existsDeletedByEmailAcrossAccounts(email)) {
      deletedHolderAddresses.add(normalizeEmail(email));
    }
    if (await this.accountRepo.existsDeletedByEmail(accountEmail)) {
      deletedHolderAddresses.add(normalizeEmail(accountEmail));
    }
    if (deletedHolderAddresses.size > 0) {
      return { taken: true, deletedHolderAddresses: [...deletedHolderAddresses] };
    }

    // A live account with no live user, for example one created by an administrator.
    if ((await this.accountRepo.findByEmail(accountEmail)) !== null) {
      return TAKEN_BY_LIVE_HOLDER;
    }
    return FREE;
  }

  /**
   * @method isAccountLive
   * @description Reports whether the account a live user belongs to is itself live. An id
   *   that does not parse counts as not live, the same way the login gate reads it.
   * @param accountId - The account id a live user carries.
   * @returns True when a live account carries the id.
   */
  private async isAccountLive(accountId: string): Promise<boolean> {
    const id = AccountId.fromString(accountId);
    if (!id.ok) {
      return false;
    }
    const found = await this.accountRepo.findById(id.value);
    return found.ok;
  }

  /**
   * @method dispatchWelcomeEmail
   * @description Starts the welcome e-mail without waiting for it. Never throws.
   * @param accountName - The name of the account just created.
   * @param email - The address of the user just created.
   */
  private dispatchWelcomeEmail(accountName: string, email: string): void {
    const mailer = this.welcomeMailer;
    if (!mailer) return;
    this.dispatchEmail("registerCustomer.welcomeEmail", (links) =>
      mailer.sendWelcome(email, {
        accountName,
        onboardingUrl: `${links.baseUrl}/dashboard`,
        supportEmail: links.supportEmail,
      })
    );
  }

  /**
   * @method dispatchDeletedAccountNotice
   * @description Starts the deleted-account notice to the owner of an address without
   *   waiting for it. Never throws.
   * @param address - The address that belongs to a deleted account or a deleted user.
   */
  private dispatchDeletedAccountNotice(address: string): void {
    const mailer = this.deletedAccountNoticeMailer;
    if (!mailer) return;
    this.dispatchEmail("registerCustomer.deletedAccountNotice", (links) =>
      mailer.notifyRegistrationAttemptOnDeletedAccount(address, {
        supportEmail: links.supportEmail,
      })
    );
  }

  /**
   * @method dispatchEmail
   * @description Resolves the platform links, sends one e-mail, and logs a failure either
   *   way it arrives: a returned error or a thrown one. The address is never logged.
   * @param operation - The name the log entry carries.
   * @param send - Sends the e-mail with the resolved links.
   */
  private dispatchEmail(
    operation: string,
    send: (links: PlatformLinks) => Promise<Result<void, Error>>
  ): void {
    const deliver = async (): Promise<void> => {
      const sent = await send(await this.resolvePlatformLinks());
      if (!sent.ok) {
        this.logger.error({ err: sent.error, operation }, "A registration e-mail was not sent");
      }
    };
    deliver().catch((error: unknown) => {
      this.logger.error({ err: error, operation }, "A registration e-mail was not sent");
    });
  }

  /**
   * @method resolvePlatformLinks
   * @description Reads the base URL and support address from the platform settings,
   *   falling back to the defaults for any value the settings do not carry.
   * @returns The links a registration e-mail points at.
   */
  private async resolvePlatformLinks(): Promise<PlatformLinks> {
    let baseUrl = DEFAULT_BASE_URL;
    let supportEmail = DEFAULT_SUPPORT_EMAIL;

    if (this.credentialService) {
      const platformResult = await this.credentialService.getPlatformCredentials();
      if (platformResult.ok) {
        baseUrl = platformResult.value.baseUrl || baseUrl;
        supportEmail = platformResult.value.supportEmail || supportEmail;
      }
    }

    return { baseUrl, supportEmail };
  }
}
