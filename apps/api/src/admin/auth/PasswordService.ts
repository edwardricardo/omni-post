/**
 * @file PasswordService.ts
 * @description Handles password operations including Argon2id hashing, verification,
 *              strength validation, history tracking, and reset flows.
 * @layer infrastructure
 */

import crypto from "crypto";
import type { PrismaClient } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import type { AuthErrorCode, PasswordValidation, SecurityEventType } from "./adminAuthTypes.js";
import { validatePasswordStrength } from "./adminAuthSchemas.js";
import { adminAuthConfig } from "./adminAuthConfig.js";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";
import { authLogger } from "../../lib/logger.js";
import {
  hashPassword as argonHashPassword,
  verifyPassword as argonVerifyPassword,
  needsRehash,
} from "../../auth/passwordHashing.js";

export class PasswordService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Hash password using the canonical Argon2id parameters.
   */
  async hashPassword(password: string): Promise<{ hash: string; algorithm: "argon2id" }> {
    const hash = await argonHashPassword(password);
    return { hash, algorithm: "argon2id" };
  }

  /**
   * Verify password against an argon2id hash. `needsMigration` is true when
   * the stored hash uses parameters weaker than the current canon, so callers
   * can transparently re-hash on the next successful login.
   */
  async verifyPassword(
    password: string,
    storedHash: string,
    _algorithm?: string
  ): Promise<{ valid: boolean; needsMigration: boolean }> {
    const valid = await argonVerifyPassword(storedHash, password);
    if (!valid) return { valid: false, needsMigration: false };
    return { valid: true, needsMigration: needsRehash(storedHash) };
  }

  /**
   * Validate password strength
   */
  validatePassword(password: string): PasswordValidation {
    return validatePasswordStrength(password);
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    onSecurityEvent: (event: {
      type: SecurityEventType;
      userId: string;
      success: boolean;
      error?: string;
      timestamp: Date;
    }) => Promise<void>
  ): Promise<Result<boolean, AuthErrorCode>> {
    // Get user with password hash
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      select: {
        passwordHash: true,
        passwordHashAlgo: true,
        passwordHistory: true,
        passwordChangedAt: true,
      },
    });

    if (!user) {
      return err("USER_NOT_FOUND");
    }

    // Verify current password
    const { valid } = await this.verifyPassword(currentPassword, user.passwordHash);

    if (!valid) {
      await onSecurityEvent({
        type: "PASSWORD_CHANGED",
        userId,
        success: false,
        error: "Invalid current password",
        timestamp: new Date(),
      });
      return err("INVALID_CREDENTIALS");
    }

    // Validate new password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
      return err("PASSWORD_TOO_WEAK");
    }

    // Check password reuse
    const passwordReusePrevented = adminAuthConfig.passwordPolicy.preventPasswordReuse;
    const recentPasswords = user.passwordHistory.slice(-passwordReusePrevented);

    for (const oldHash of recentPasswords) {
      const { valid: isReused } = await this.verifyPassword(newPassword, oldHash);
      if (isReused) {
        return err("PASSWORD_REUSED");
      }
    }

    // Hash new password
    const { hash, algorithm } = await this.hashPassword(newPassword);

    // Update password history
    // Read-modify-write, unguarded: two concurrent changes on one admin can each
    // append to the history they read and the loser's entry is lost. Deliberately
    // out of scope for the reset claim — owned by SMELL-114.
    const updatedHistory = [...user.passwordHistory, user.passwordHash].slice(
      -passwordReusePrevented
    );

    // Update user record
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: {
        passwordHash: hash,
        passwordHashAlgo: algorithm,
        passwordHistory: updatedHistory,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });

    // Log security event
    await onSecurityEvent({
      type: "PASSWORD_CHANGED",
      userId,
      success: true,
      timestamp: new Date(),
    });

    // Revoke all other sessions for security
    await this.prisma.adminSession.updateMany({
      where: {
        userId,
        isActive: true,
      },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokeReason: "PASSWORD_CHANGED",
      },
    });

    return ok(true);
  }

  /**
   * Initiate password reset (forgot password flow)
   * Generates reset token and stores it in database
   */
  async initiatePasswordReset(
    email: string,
    onSecurityEvent: (event: {
      type: SecurityEventType;
      userId?: string;
      email?: string;
      success: boolean;
      timestamp: Date;
    }) => Promise<void>
  ): Promise<Result<string, AuthErrorCode>> {
    // Find user by email
    const user = await this.prisma.adminUser.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, isActive: true },
    });

    // Always return success to prevent email enumeration
    // But only actually send email if user exists and is active
    if (!user || !user.isActive) {
      // Generate fake token to maintain timing consistency
      crypto.randomUUID();
      return ok("reset_token_placeholder");
    }

    // Generate reset token (UUID v4)
    const resetToken = crypto.randomUUID();

    // Token expires in 1 hour
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    // Store reset token in database
    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpires: expiresAt,
      },
    });

    // Log security event
    await onSecurityEvent({
      type: "PASSWORD_RESET_REQUESTED",
      userId: user.id,
      email: normalizeEmail(email),
      success: true,
      timestamp: new Date(),
    });

    // Return token (caller should send email)
    return ok(resetToken);
  }

  /**
   * @method confirmPasswordReset
   * @description Completes a password reset by CLAIMING the reset token: for a
   *   given token at most ONE caller ever receives success, under every
   *   interleaving, and the winner's password is the one that persists. Every
   *   exit that does not consume the token leaves that token exactly as usable
   *   as it was, so a refused attempt never costs the holder a new email.
   *
   *   Four exits: `INVALID_TOKEN` (the token is unusable — unknown, expired,
   *   already consumed, or its owner deactivated), `PASSWORD_TOO_WEAK` and
   *   `PASSWORD_REUSED` (the request was refused before anything was consumed),
   *   `CONCURRENT_MODIFICATION` (the token is fine; another password write moved
   *   the row, so the same token may be presented again), and `INTERNAL_ERROR`
   *   (the question could not be asked — never reported as a bad token).
   * @param token - The reset token presented by the caller.
   * @param newPassword - The replacement password, still to be policy-checked.
   * @param onSecurityEvent - Audit sink for the completion event.
   * @returns `ok(true)` for the single caller that consumed the token; otherwise
   *   the `AuthErrorCode` naming which of the exits above was taken.
   */
  async confirmPasswordReset(
    token: string,
    newPassword: string,
    onSecurityEvent: (event: {
      type: SecurityEventType;
      userId: string;
      success: boolean;
      timestamp: Date;
    }) => Promise<void>
  ): Promise<Result<boolean, AuthErrorCode>> {
    let userId: string;
    try {
      // ONE read. `isActive: true` mirrors the claim below, so a deactivated
      // owner never reaches argon2 work; `passwordHash` is selected here so the
      // second read — and the `|| ""` history poison it fed — is gone.
      const user = await this.prisma.adminUser.findFirst({
        where: {
          passwordResetToken: token,
          passwordResetExpires: { gt: new Date() },
          isActive: true,
        },
        select: { id: true, passwordHash: true, passwordHistory: true },
      });

      if (!user) {
        return err("INVALID_TOKEN");
      }

      const validation = validatePasswordStrength(newPassword);
      if (!validation.valid) {
        return err("PASSWORD_TOO_WEAK");
      }

      const keep = adminAuthConfig.passwordPolicy.preventPasswordReuse;
      for (const oldHash of user.passwordHistory.slice(-keep)) {
        const { valid: isReused } = await this.verifyPassword(newPassword, oldHash);
        if (isReused) {
          return err("PASSWORD_REUSED");
        }
      }

      const { hash, algorithm } = await this.hashPassword(newPassword);

      // Only real stored hashes enter the history. The column is NOT NULL and no
      // production writer stores "", so this filter is unreachable from the tree
      // today; it holds the invariant by construction instead of by auditing
      // writers, and it purges any "" a retired fallback left behind on the next
      // successful reset. The claim below still names the history exactly as
      // READ — unfiltered — because the guard is on what is WRITTEN, and a
      // predicate naming a value the row never held could never match.
      const updatedHistory = [...user.passwordHistory, user.passwordHash]
        .filter((entry) => entry.length > 0)
        .slice(-keep);

      // ONE conditional write — the claim. The predicate names the row (`id`),
      // the credential and its liveness (token, strictly-future expiry, live
      // owner), and BOTH values the `data` below derives from (`passwordHash`,
      // `passwordHistory`), so the DATABASE decides who consumes the token and
      // whether the history this write appends to is still the one it read.
      // Under Read Committed a concurrent committed writer makes EvalPlanQual
      // re-check exactly the columns this WHERE names, and the loser matches
      // zero rows.
      //
      // `id` caps the match at one row, so the `count === 0` refusal this site
      // spells and a `count !== 1` refusal coincide here. That cap comes from
      // `id` alone: `AdminUser.passwordResetToken` carries NO unique index, so
      // the token is a claim PREDICATE here, not the row key. The fact that
      // tokens are `crypto.randomUUID()` is NOT what caps the count either;
      // collision resistance bounds the odds, it does not bound the rows.
      //
      // The missing index is the SMALL half of the "CHANGE_REQUIRED" problem
      // (SMELL-110). The large half is an AUTHENTICATION HAZARD:
      // `AccountSessionService.resetPassword` stores that literal string in this
      // very column with a 24h expiry, so it is a guessable, shared, non-secret
      // value that satisfies every term of the predicate below — anyone reaching
      // this method with the token `"CHANGE_REQUIRED"` would claim a real admin's
      // password. Nothing HERE stops that: the method takes an unconstrained
      // `string`. The only thing standing in the way is the route's
      // `z.string().uuid()` on `resetPasswordConfirmSchema`, one layer out and one
      // caller away, which is why a second caller of this method — a CLI, a job, a
      // test harness — reintroduces the hole in full.
      //
      // Typed `StringNullableListFilter` equality — no raw SQL.
      const { count } = await this.prisma.adminUser.updateMany({
        where: {
          id: user.id,
          passwordResetToken: token,
          passwordResetExpires: { gt: new Date() },
          isActive: true,
          passwordHash: user.passwordHash,
          passwordHistory: { equals: user.passwordHistory },
        },
        data: {
          passwordHash: hash,
          passwordHashAlgo: algorithm,
          passwordHistory: updatedHistory,
          passwordChangedAt: new Date(),
          passwordResetToken: null,
          passwordResetExpires: null,
          mustChangePassword: false,
          // Clearing the lockout on a successful reset is DELIBERATE: completing
          // a reset proves control of the mailbox, which is the stronger signal.
          // A refused claim never reaches here, so a failed attempt can never
          // launder a lockout away.
          failedLoginAttempts: 0,
          lockedUntil: null,
          lockReason: null,
        },
      });

      if (count === 0) {
        // Disambiguate, never retry in place. A dead, consumed or expired token,
        // or a deactivated owner, is INVALID_TOKEN. A token that is still live
        // means only the snapshot columns moved — a concurrent password write on
        // this admin — which is a RETRYABLE conflict and must never read as a bad
        // token: the two are opposite instructions to the caller.
        //
        // The verdict names the row as of THIS read's instant, not the claim's: a
        // consumption landing between the two is reported INVALID_TOKEN (true by
        // then), and a history move landing after it is invisible here and is
        // caught by the retry's own claim.
        const now = await this.prisma.adminUser.findUnique({
          where: { id: user.id },
          select: { passwordResetToken: true, passwordResetExpires: true, isActive: true },
        });
        const tokenLive =
          now !== null &&
          now.passwordResetToken === token &&
          now.isActive &&
          now.passwordResetExpires !== null &&
          now.passwordResetExpires > new Date();
        return err(tokenLive ? "CONCURRENT_MODIFICATION" : "INVALID_TOKEN");
      }

      userId = user.id;
    } catch (error: unknown) {
      // A throw is a failure to ASK the question, not an answer to it, so it is
      // never reported as a bad token.
      authLogger.error({ err: error }, "confirmPasswordReset claim failed");
      return err("INTERNAL_ERROR");
    }

    // Post-claim side effects, deliberately OUTSIDE the claim and outside the try,
    // exactly as before. Known residual, pre-existing and NOT closed here: a throw
    // in either of these leaves the password already changed while the caller
    // receives a 500. Folding them in would require a transaction around a flow
    // that is deliberately one statement, and would blur the claim's proof.
    await onSecurityEvent({
      type: "PASSWORD_RESET_COMPLETED",
      userId,
      success: true,
      timestamp: new Date(),
    });

    await this.prisma.adminSession.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, revokedAt: new Date(), revokeReason: "PASSWORD_RESET" },
    });

    return ok(true);
  }
}
