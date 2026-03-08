/**
 * Password Service
 *
 * Handles all password-related operations including:
 * - Password hashing with Argon2id
 * - Password verification
 * - Password strength validation
 * - Password change with history tracking
 * - Password reset (forgot password flow)
 */

import argon2 from "argon2";
import crypto from "crypto";
import { prisma } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import type { AuthErrorCode, PasswordValidation, SecurityEventType } from "./adminAuthTypes";
import { validatePasswordStrength } from "./adminAuthSchemas";
import { adminAuthConfig } from "./adminAuthConfig";

export class PasswordService {
  /**
   * Hash password using Argon2id
   */
  async hashPassword(password: string): Promise<{ hash: string; algorithm: "argon2id" }> {
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 4,
    });
    return { hash, algorithm: "argon2id" };
  }

  /**
   * Verify password against an argon2id hash
   */
  async verifyPassword(
    password: string,
    storedHash: string,
    _algorithm?: string
  ): Promise<{ valid: boolean; needsMigration: boolean }> {
    try {
      const valid = await argon2.verify(storedHash, password);
      return { valid, needsMigration: false };
    } catch {
      return { valid: false, needsMigration: false };
    }
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
    const user = await prisma.adminUser.findUnique({
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
    const updatedHistory = [...user.passwordHistory, user.passwordHash].slice(
      -passwordReusePrevented
    );

    // Update user record
    await prisma.adminUser.update({
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
    await prisma.adminSession.updateMany({
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
    const user = await prisma.adminUser.findUnique({
      where: { email: email.toLowerCase() },
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
    await prisma.adminUser.update({
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
      email: email.toLowerCase(),
      success: true,
      timestamp: new Date(),
    });

    // Return token (caller should send email)
    return ok(resetToken);
  }

  /**
   * Confirm password reset with token
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
    // Find user with valid reset token
    const user = await prisma.adminUser.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
      },
      select: {
        id: true,
        passwordHistory: true,
      },
    });

    if (!user) {
      return err("INVALID_TOKEN");
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
    const currentHash = await prisma.adminUser.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });

    const updatedHistory = [...user.passwordHistory, currentHash?.passwordHash || ""].slice(
      -passwordReusePrevented
    );

    // Update user record
    await prisma.adminUser.update({
      where: { id: user.id },
      data: {
        passwordHash: hash,
        passwordHashAlgo: algorithm,
        passwordHistory: updatedHistory,
        passwordChangedAt: new Date(),
        passwordResetToken: null,
        passwordResetExpires: null,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lockReason: null,
      },
    });

    // Log security event
    await onSecurityEvent({
      type: "PASSWORD_RESET_COMPLETED",
      userId: user.id,
      success: true,
      timestamp: new Date(),
    });

    // Revoke all active sessions
    await prisma.adminSession.updateMany({
      where: {
        userId: user.id,
        isActive: true,
      },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokeReason: "PASSWORD_RESET",
      },
    });

    return ok(true);
  }
}
