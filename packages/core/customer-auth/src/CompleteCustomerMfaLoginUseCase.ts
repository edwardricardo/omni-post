/**
 * @file CompleteCustomerMfaLoginUseCase.ts
 * @description Customer login step 2: verifies a login MFA challenge token plus a
 *              TOTP or backup code, then mints the real session. Single-use is
 *              enforced SERVER-SIDE by atomically consuming the challenge `jti`
 *              from the allowlist store AFTER the code verifies, so two concurrent
 *              valid step-2 requests mint exactly ONE session (the consume is the
 *              serializer). The session is minted only after the second factor
 *              (OWASP "regenerate on privilege change"); brute-force success is
 *              recorded only here, never at the password step. Anti-oracle: every
 *              challenge-invalid sub-case (bad signature / expired / consumed /
 *              foreign / binding mismatch) returns the SAME `INVALID_CHALLENGE`
 *              to the caller — which sub-case occurred lives in the route's logs.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import type { CustomerTokenService } from "@core/domain/repositories/CustomerTokenService.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import {
  MFA_SUBJECT_TYPE,
  type BruteForceProtectionPort,
  type MfaChallengeStorePort,
  type MfaVerificationPort,
} from "@ports/core";
import { randomBytes } from "crypto";
import { sha256Hex } from "./challengeBinding.js";
import type { LoginCustomerOutput } from "./LoginCustomerUseCase.js";

/** Input DTO for customer login step 2. */
export interface CompleteCustomerMfaLoginInput {
  /** The challenge JWT issued by step 1. */
  readonly challengeToken: string;
  /** A TOTP (6 digits) or a backup code (8 hex chars). */
  readonly code: string;
  /** Trusted source IP (route derives it via `resolveClientIp`, never `request.ip`). */
  readonly ip: string;
  /** Raw source user-agent. */
  readonly userAgent: string;
}

/**
 * Error code union. The route collapses `INVALID_CHALLENGE` and
 * `CHALLENGE_BINDING_MISMATCH` to a byte-identical 401 (no oracle); the distinct
 * internal codes exist only so the route can emit the binding-mismatch WARN.
 */
export type CompleteCustomerMfaLoginError =
  | "INVALID_CHALLENGE"
  | "CHALLENGE_BINDING_MISMATCH"
  | "INVALID_MFA_CODE"
  | "USER_INACTIVE"
  | "RATE_LIMITED"
  | "MFA_UNAVAILABLE"
  | "INTERNAL_ERROR";

/**
 * @class CompleteCustomerMfaLoginUseCase
 * @description Verifies the challenge + second factor and mints the session.
 *   Mutating use case: the `recordLogin` + `save` writes run inside the injected
 *   Unit of Work; the brute-force `recordSuccessfulAttempt` (an external Redis
 *   call) runs OUTSIDE the transaction per ARCHITECTURE_CANON.
 */
export class CompleteCustomerMfaLoginUseCase {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly accountRepo: AccountRepositoryPort,
    private readonly mfaVerification: MfaVerificationPort,
    private readonly tokenService: CustomerTokenService,
    private readonly challengeStore: MfaChallengeStorePort,
    private readonly bruteForce: BruteForceProtectionPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Completes step 2. On success returns a full session
   *   (`LoginCustomerOutput`); every failure is a typed `Result`.
   * @param input - Challenge token, MFA code, trusted IP + user-agent.
   * @returns Ok(session) on success, or a typed step-2 error.
   */
  async execute(
    input: CompleteCustomerMfaLoginInput
  ): Promise<Result<LoginCustomerOutput, CompleteCustomerMfaLoginError>> {
    const { ip, userAgent } = input;

    try {
      // 1. Verify the challenge JWT (signature / expiry / alg / iss / aud / type).
      const claimsResult = this.tokenService.verifyMfaChallengeToken(input.challengeToken);
      if (!claimsResult.ok) {
        return err("INVALID_CHALLENGE");
      }
      const claims = claimsResult.value;

      // 2. Binding check — a stolen challenge replayed from another host dies
      // here, before the jti is even consulted. Byte-identical to expiry on the
      // wire; distinct internal code only so the route emits the WARN.
      if (claims.iph !== sha256Hex(ip) || claims.uah !== sha256Hex(userAgent)) {
        return err("CHALLENGE_BINDING_MISMATCH");
      }

      // 3. Load the subject by the challenge's `sub` (account-explicit lookup).
      const userResult = await this.customerUserRepo.findById(claims.sub);
      if (!userResult.ok) {
        return err("INVALID_CHALLENGE");
      }
      const user = userResult.value;

      // 3b. Tenant-bind the challenge: `claims.accountId` was set at step 1 from
      // the SAME row `sub` identifies, so this should never fire in practice —
      // but the claim exists precisely to make that binding an enforced
      // invariant, not an assumption the code leans on (design Decision 7).
      // Byte-identical `INVALID_CHALLENGE`, never consumed — a mismatch is not
      // a legitimate attempt to burn the challenge, and a distinct response
      // here would itself be a tenant oracle.
      if (user.accountId !== claims.accountId) {
        return err("INVALID_CHALLENGE");
      }

      // 4. Re-check the row: an account deactivated or MFA disabled between the
      // two steps invalidates the challenge (mfa-disabled is indistinguishable
      // from any other invalid challenge — no oracle).
      if (!user.mfaEnabled) {
        return err("INVALID_CHALLENGE");
      }
      if (!user.isActive) {
        return err("USER_INACTIVE");
      }

      // 5. Brute-force gate — SAME identifier as step 1 (the email) so the
      // per-account counters aggregate across both steps.
      const check = await this.bruteForce.checkLoginAttempt({
        identifier: user.email,
        ip,
        userAgent,
      });
      if (!check.allowed) {
        return err("RATE_LIMITED");
      }
      if (check.delaySeconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, check.delaySeconds * 1000));
      }

      // 6. Verify the second factor. A wrong code does NOT burn the challenge
      // (a typo must not force password re-entry); it is a brute-force failure.
      const verification = await this.mfaVerification.verifyMfaToken(
        { type: MFA_SUBJECT_TYPE.CUSTOMER, id: claims.sub },
        input.code
      );
      if (!verification.ok) {
        if (verification.error === "INVALID_TOKEN") {
          await this.bruteForce.recordFailedAttempt({
            identifier: user.email,
            ip,
            userAgent,
            failureReason: "MFA_FAILED",
          });
          return err("INVALID_MFA_CODE");
        }
        if (verification.error === "DATABASE_ERROR") {
          return err("INTERNAL_ERROR");
        }
        // USER_NOT_FOUND / MFA_NOT_ENABLED — the row changed under us; the
        // challenge is no longer valid. Indistinguishable on the wire.
        return err("INVALID_CHALLENGE");
      }

      // 7. Consume the jti atomically — this is the one-session-per-challenge
      // serializer. The loser of a concurrent race gets NOT_FOUND. A store
      // fault is fail-closed (no session), never fail-open.
      const consumed = await this.challengeStore.consume(claims.jti);
      if (!consumed.ok) {
        return err("MFA_UNAVAILABLE");
      }
      if (consumed.value === "NOT_FOUND") {
        return err("INVALID_CHALLENGE");
      }

      // 8. Record the login + persist inside the Unit of Work (DB writes only).
      user.recordLogin();
      const doSave = async (): Promise<Result<void, CompleteCustomerMfaLoginError>> => {
        const saved = await this.customerUserRepo.save(user);
        if (!saved.ok) {
          return err("INTERNAL_ERROR");
        }
        return ok(undefined);
      };
      let saveResult: Result<void, CompleteCustomerMfaLoginError> = ok(undefined);
      if (this.unitOfWork) {
        await this.unitOfWork.executeInTransaction(async () => {
          saveResult = await doSave();
        });
      } else {
        saveResult = await doSave();
      }
      if (!saveResult.ok) {
        return err(saveResult.error);
      }

      // 9. Clear the per-identifier BF counter (Redis — OUTSIDE the transaction).
      await this.bruteForce.recordSuccessfulAttempt({
        identifier: user.email,
        ip,
        userAgent,
      });

      // 10. Fetch the account for the response body.
      const accountIdResult = AccountId.fromString(user.accountId);
      let accountJson: Record<string, unknown> = { id: user.accountId };
      if (accountIdResult.ok) {
        const accountResult = await this.accountRepo.findById(accountIdResult.value);
        if (accountResult.ok) {
          accountJson = accountResult.value.toJSON();
        }
      }

      // 11. Mint the fresh session — access + refresh, new sessionId.
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
        user: { ...user.toJSON() } as Record<string, unknown>,
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
