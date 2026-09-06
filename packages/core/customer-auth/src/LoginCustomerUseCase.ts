/**
 * @file LoginCustomerUseCase.ts
 * @description Authenticates a customer user by email/password, issues JWT tokens.
 *   Handles the multi-account scenario where an email may exist across accounts.
 *   Gated by BruteForceProtectionPort (NIST SP 800-63B-4 §rate-limiting + OWASP
 *   Authentication Cheat Sheet): account-based throttling, exponential backoff,
 *   CAPTCHA signalling, fail-open on adapter outage.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { Account } from "@core/domain/entities/Account.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import {
  type CustomerTokenService,
  CUSTOMER_MFA_CHALLENGE_TTL_SECONDS,
} from "@core/domain/repositories/CustomerTokenService.js";
import type { BruteForceProtectionPort, MfaChallengeStorePort } from "@ports/core";
import { randomBytes } from "crypto";
import { sha256Hex } from "./challengeBinding.js";

/** Error code union */
export type LoginCustomerError =
  | "INVALID_CREDENTIALS"
  | "USER_INACTIVE"
  | "ACCOUNT_DEACTIVATED"
  | "MULTIPLE_ACCOUNTS"
  | "RATE_LIMITED"
  | "MFA_UNAVAILABLE"
  | "INTERNAL_ERROR";

/** The MFA methods a customer may present at step 2. Static — leaks nothing new. */
const MFA_CHALLENGE_METHODS: readonly string[] = ["totp", "backup_code"];

/** Input DTO */
export interface LoginCustomerInput {
  readonly email: string;
  readonly password: string;
  readonly accountSlug?: string;
  /** Source IP — forensic + IP throttle supletoria. */
  readonly ip: string;
  /** Source user-agent — forensic + anomaly signals. */
  readonly userAgent: string;
}

/** Output DTO */
export interface LoginCustomerOutput {
  readonly user: Record<string, unknown>;
  readonly account: Record<string, unknown>;
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Signals the client to challenge the next attempt with a CAPTCHA. Canon:
   * defense-in-depth, not preventive on first attempt. */
  readonly captchaRequired?: boolean;
}

/**
 * Output DTO returned INSTEAD of a session when the authenticated customer has
 * MFA enabled. No session is minted at this point — the caller must complete
 * step 2 (`CompleteCustomerMfaLoginUseCase`) with the challenge token plus a
 * valid TOTP or backup code.
 */
export interface CustomerMfaChallengeOutput {
  readonly mfaRequired: true;
  readonly challengeToken: string;
  readonly expiresInSeconds: number;
  readonly methods: readonly string[];
}

/**
 * @class LoginCustomerUseCase
 * @description Verifies customer credentials and issues JWT tokens.
 *   Brute-force gated: `checkLoginAttempt` before credential verification,
 *   `recordFailedAttempt` on every failure path, `recordSuccessfulAttempt`
 *   on success (clears the per-identifier counter).
 */
export class LoginCustomerUseCase {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly accountRepo: AccountRepositoryPort,
    private readonly hasher: PasswordHasher,
    private readonly tokenService: CustomerTokenService,
    private readonly bruteForce: BruteForceProtectionPort,
    private readonly challengeStore: MfaChallengeStorePort
  ) {}

  /**
   * @method execute
   * @description Authenticates a customer user and returns access + refresh tokens.
   *   Gates on `bruteForce.checkLoginAttempt` (account-based primary, NIST
   *   800-63B-4 + OWASP). On every failure path emits `recordFailedAttempt`;
   *   on success emits `recordSuccessfulAttempt` (resets per-identifier
   *   counter). The exponential `delaySeconds` is honoured before answering
   *   to throttle the attacker.
   */
  async execute(
    input: LoginCustomerInput
  ): Promise<Result<LoginCustomerOutput | CustomerMfaChallengeOutput, LoginCustomerError>> {
    const { ip, userAgent } = input;

    try {
      if (!input.email || !input.password) {
        return err("INVALID_CREDENTIALS");
      }

      // Brute-force gate (NIST 800-63B-4 §rate-limiting + OWASP Auth Cheat Sheet).
      // Identifier is the account-primary key: an attacker rotating IPs cannot
      // bypass this counter.
      const check = await this.bruteForce.checkLoginAttempt({
        identifier: input.email,
        ip,
        userAgent,
      });

      if (!check.allowed) {
        return err("RATE_LIMITED");
      }

      // Honor exponential throttle delay (caps at 300s per port canon, DoS-conscious).
      if (check.delaySeconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, check.delaySeconds * 1000));
      }

      // Find user(s) by email across accounts
      const users = await this.customerUserRepo.findByEmailAcrossAccounts(input.email);

      if (users.length === 0) {
        await this.bruteForce.recordFailedAttempt({
          identifier: input.email,
          ip,
          userAgent,
          failureReason: "USER_NOT_FOUND",
        });
        return err("INVALID_CREDENTIALS");
      }

      // If multiple accounts and no slug hint, signal MULTIPLE_ACCOUNTS.
      // NOT counted as a failed attempt — credentials weren't verified yet and
      // requiring disambiguation is a UX hint, not an authentication failure.
      if (users.length > 1 && !input.accountSlug) {
        return err("MULTIPLE_ACCOUNTS");
      }

      // Pick the correct user (first match, or the one matching the slug)
      let targetUser = users[0]!;

      if (input.accountSlug && users.length > 1) {
        // Need to resolve slug to accountId
        for (const u of users) {
          const accountIdResult = AccountId.fromString(u.accountId);
          if (!accountIdResult.ok) continue;
          const accountResult = await this.accountRepo.findById(accountIdResult.value);
          if (accountResult.ok && accountResult.value.slug === input.accountSlug) {
            targetUser = u;
            break;
          }
        }
      }

      // Verify password
      const passwordValid = await this.hasher.verify(targetUser.passwordHash, input.password);
      if (!passwordValid) {
        await this.bruteForce.recordFailedAttempt({
          identifier: input.email,
          ip,
          userAgent,
          failureReason: "INVALID_PASSWORD",
        });
        return err("INVALID_CREDENTIALS");
      }

      // Check active
      if (!targetUser.isActive) {
        await this.bruteForce.recordFailedAttempt({
          identifier: input.email,
          ip,
          userAgent,
          failureReason: "USER_INACTIVE",
        });
        return err("USER_INACTIVE");
      }

      // Account liveness gate: a soft-deleted account's users must not log in
      // (nor receive an MFA challenge). `accountRepo.findById` filters
      // `deletedAt: null`, so a deleted account resolves as not-found here.
      // Fail-closed: an unresolvable or malformed accountId also refuses —
      // the gate admits only accounts it can PROVE live. Disclosed only after
      // the password verified above, so this is no enumeration oracle; the
      // failed attempt is recorded to mirror USER_INACTIVE.
      const accountIdResult = AccountId.fromString(targetUser.accountId);
      let liveAccount: Account | null = null;
      if (accountIdResult.ok) {
        const accountResult = await this.accountRepo.findById(accountIdResult.value);
        if (accountResult.ok) {
          liveAccount = accountResult.value;
        }
      }
      if (liveAccount === null) {
        await this.bruteForce.recordFailedAttempt({
          identifier: input.email,
          ip,
          userAgent,
          failureReason: "ACCOUNT_DEACTIVATED",
        });
        return err("ACCOUNT_DEACTIVATED");
      }

      // Transparent rehash: if the stored hash uses parameters weaker than
      // the current canon (e.g. after a server-side cost bump), upgrade it
      // silently while we still have the plaintext on the stack. Failure
      // here is non-fatal — the user logs in successfully either way. The
      // upgraded hash is persisted via the repository; the in-memory entity
      // keeps its original `passwordHash` field (readonly) since the user
      // is about to be released back to the caller.
      if (this.hasher.needsRehash(targetUser.passwordHash)) {
        const upgraded = await this.hasher.hash(input.password);
        await this.customerUserRepo.updatePasswordHash(targetUser.id, upgraded);
      }

      // MFA gate: a valid password is NOT terminal success for an MFA-enabled
      // customer. Issue a short-lived, single-use challenge and STOP — no
      // `recordLogin`/`save`, no `recordSuccessfulAttempt` (the BF counter is
      // cleared only after the second factor completes), no session mint. This
      // is what makes the BF ordering correct by construction.
      if (targetUser.mfaEnabled) {
        const jti = randomBytes(16).toString("hex");
        const issued = await this.challengeStore.issue(jti, CUSTOMER_MFA_CHALLENGE_TTL_SECONDS);
        if (!issued.ok) {
          // Fail-closed: the store is the single-use source of truth; without it
          // the gate cannot be enforced, so the login must not proceed.
          return err("MFA_UNAVAILABLE");
        }
        const challengeToken = this.tokenService.signMfaChallengeToken({
          sub: targetUser.id,
          accountId: targetUser.accountId,
          jti,
          iph: sha256Hex(ip),
          uah: sha256Hex(userAgent),
        });
        return ok({
          mfaRequired: true,
          challengeToken,
          expiresInSeconds: CUSTOMER_MFA_CHALLENGE_TTL_SECONDS,
          methods: MFA_CHALLENGE_METHODS,
        });
      }

      // Record login
      targetUser.recordLogin();
      await this.customerUserRepo.save(targetUser);

      // Successful authentication — clear per-identifier counters.
      await this.bruteForce.recordSuccessfulAttempt({
        identifier: input.email,
        ip,
        userAgent,
      });

      // Account for the response — the liveness gate above already fetched it.
      const accountJson: Record<string, unknown> = liveAccount.toJSON();

      // Sign tokens
      const sessionId = randomBytes(16).toString("hex");
      const accessToken = this.tokenService.signAccessToken({
        sub: targetUser.id,
        accountId: targetUser.accountId,
        roleId: targetUser.roleId,
        roleName: targetUser.roleName,
        permissions: [...targetUser.permissions],
      });
      const refreshToken = this.tokenService.signRefreshToken(targetUser.id, sessionId);

      return ok({
        user: { ...targetUser.toJSON() } as Record<string, unknown>,
        account: accountJson,
        accessToken,
        refreshToken,
        ...(check.captchaRequired && { captchaRequired: true }),
      });
    } catch (_error: unknown) {
      return err("INTERNAL_ERROR");
    }
  }
}
