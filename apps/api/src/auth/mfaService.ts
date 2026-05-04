/**
 * @file mfaService.ts
 * @description Multi-factor authentication service handling TOTP setup, verification,
 *              backup code generation, and MFA lifecycle management.
 * @layer infrastructure
 */
import { authenticator } from "otplib";
import * as QRCode from "qrcode";
import * as crypto from "crypto";
import { ok, err, isErr, type Result } from "@shared/types";
import { prisma } from "@infra/prisma";
import { AuditableService } from "../services/AuditableService";
import type { AdminUserRepositoryPort } from "../domain/repositories/AdminUserRepository.js";
import { authLogger } from "../lib/logger.js";
import { hashPassword, verifyPassword } from "./passwordHashing.js";

interface MfaSetupData {
  secret: string;
  backupCodes: string[];
  qrCodeUrl: string;
  manualEntryKey: string;
}

interface MfaVerificationResult {
  verified: boolean;
  usedBackupCode?: boolean;
}

export class MfaService extends AuditableService {
  private readonly appName = "OmniPost Admin";
  private readonly issuer = "OmniPost";

  constructor(private readonly userRepo: AdminUserRepositoryPort) {
    super("MfaService");
  }

  /**
   * Generate MFA secret and setup data for a user
   */
  async setupMfa(
    userId: string,
    userEmail: string
  ): Promise<
    Result<
      MfaSetupData,
      "USER_NOT_FOUND" | "MFA_ALREADY_ENABLED" | "DATABASE_ERROR" | "USER_INACTIVE"
    >
  > {
    try {
      const userResult = await this.userRepo.findActiveUser(userId, "id");

      if (isErr(userResult)) {
        // Type guard: userResult is Err type here, can access .error
        // Map repository errors to service errors
        if (userResult.error === "NOT_FOUND") return err("USER_NOT_FOUND");
        return err("USER_INACTIVE");
      }

      const user = userResult.value;

      if (user.mfaEnabled) {
        return err("MFA_ALREADY_ENABLED");
      }

      // Generate secret
      const secretBase32 = authenticator.generateSecret();
      const otpauthUrl = authenticator.keyuri(userEmail, this.issuer, secretBase32);

      // Generate backup codes
      const backupCodes = this.generateBackupCodes();
      const hashedBackupCodes = await Promise.all(
        backupCodes.map((code) => this.hashBackupCode(code))
      );

      // Generate QR code URL
      const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

      // Store the secret (but don't enable MFA yet)
      await prisma.adminUser.update({
        where: { id: userId },
        data: {
          mfaSecret: secretBase32,
          // Store backup codes as JSON array
          // Note: In production, consider storing these in a separate table
          passwordResetToken: JSON.stringify(hashedBackupCodes), // Temporary storage
        },
      });

      // Log MFA setup initiated
      await this.logSecurityEvent(userId, user.id, {
        action: "MFA_SETUP_INITIATED",
        severity: "MEDIUM",
        details: {
          email: userEmail,
        },
      });

      return ok({
        secret: secretBase32,
        backupCodes,
        qrCodeUrl,
        manualEntryKey: secretBase32,
      });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "MFA setup error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Verify MFA setup and enable MFA for the user
   */
  async verifyMfaSetup(
    userId: string,
    token: string
  ): Promise<
    Result<
      { backupCodes: string[] },
      | "USER_NOT_FOUND"
      | "INVALID_TOKEN"
      | "MFA_ALREADY_ENABLED"
      | "NO_SETUP_IN_PROGRESS"
      | "DATABASE_ERROR"
    >
  > {
    try {
      const userResult = await this.userRepo.findById(userId);

      if (!userResult.ok) {
        return err("USER_NOT_FOUND");
      }

      const user = userResult.value;

      if (user.mfaEnabled) {
        return err("MFA_ALREADY_ENABLED");
      }

      if (!user.mfaSecret) {
        return err("NO_SETUP_IN_PROGRESS");
      }

      // Verify the token
      authenticator.options = { window: 2 }; // Allow 2 time windows (1 minute each)
      const verified = authenticator.verify({
        token,
        secret: user.mfaSecret,
      });

      if (!verified) {
        // Log failed MFA verification
        await this.logSecurityEvent(userId, user.id, {
          action: "MFA_SETUP_FAILED",
          severity: "MEDIUM",
          details: {
            reason: "INVALID_TOKEN",
          },
        });

        return err("INVALID_TOKEN");
      }

      // Get backup codes from temporary storage
      const backupCodesJson = user.passwordResetToken;
      let backupCodes: string[] = [];

      if (backupCodesJson) {
        try {
          const _hashedCodes = JSON.parse(backupCodesJson);
          // Generate new plain codes for display (we can't reverse the hash)
          backupCodes = this.generateBackupCodes();
          const newHashedCodes = await Promise.all(
            backupCodes.map((code) => this.hashBackupCode(code))
          );

          // Enable MFA and store backup codes properly
          await prisma.adminUser.update({
            where: { id: userId },
            data: {
              mfaEnabled: true,
              passwordResetToken: JSON.stringify(newHashedCodes),
            },
          });
        } catch {
          // Fallback: generate new backup codes
          backupCodes = this.generateBackupCodes();
          const hashedCodes = await Promise.all(
            backupCodes.map((code) => this.hashBackupCode(code))
          );

          await prisma.adminUser.update({
            where: { id: userId },
            data: {
              mfaEnabled: true,
              passwordResetToken: JSON.stringify(hashedCodes),
            },
          });
        }
      }

      // Log successful MFA setup
      await this.logSecurityEvent(userId, user.id, {
        action: "MFA_ENABLED",
        severity: "HIGH",
        details: {
          email: user.email,
        },
      });

      return ok({ backupCodes });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "MFA verification error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Verify MFA token during login
   */
  async verifyMfaToken(
    userId: string,
    token: string
  ): Promise<
    Result<
      MfaVerificationResult,
      "USER_NOT_FOUND" | "MFA_NOT_ENABLED" | "INVALID_TOKEN" | "DATABASE_ERROR"
    >
  > {
    try {
      const userResult = await this.userRepo.findById(userId);

      if (!userResult.ok) {
        return err("USER_NOT_FOUND");
      }

      const user = userResult.value;

      if (!user.mfaEnabled || !user.mfaSecret) {
        return err("MFA_NOT_ENABLED");
      }

      // First try to verify as TOTP token
      authenticator.options = { window: 2 };
      const totpVerified = authenticator.verify({
        token,
        secret: user.mfaSecret,
      });

      if (totpVerified) {
        return ok({ verified: true, usedBackupCode: false });
      }

      // If TOTP fails, try backup codes
      if (user.passwordResetToken) {
        try {
          const hashedBackupCodes = JSON.parse(user.passwordResetToken);

          for (let i = 0; i < hashedBackupCodes.length; i++) {
            const hashedCode = hashedBackupCodes[i];
            const isValidBackupCode = await this.verifyBackupCode(token, hashedCode);

            if (isValidBackupCode) {
              // Remove used backup code
              hashedBackupCodes.splice(i, 1);
              await prisma.adminUser.update({
                where: { id: userId },
                data: {
                  passwordResetToken: JSON.stringify(hashedBackupCodes),
                },
              });

              // Log backup code usage
              await this.logSecurityEvent(userId, user.id, {
                action: "MFA_BACKUP_CODE_USED",
                severity: "MEDIUM",
                details: {
                  remainingCodes: hashedBackupCodes.length,
                },
              });

              return ok({ verified: true, usedBackupCode: true });
            }
          }
        } catch (parseError) {
          authLogger.error({ err: parseError }, "Error parsing backup codes");
        }
      }

      // Log failed MFA attempt
      await this.logSecurityEvent(userId, user.id, {
        action: "MFA_VERIFICATION_FAILED",
        severity: "MEDIUM",
        details: {
          tokenLength: token.length,
        },
      });

      return err("INVALID_TOKEN");
    } catch (error: unknown) {
      authLogger.error({ err: error }, "MFA token verification error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Force-disable MFA for a user without requiring TOTP verification.
   *
   * This method exists for admin emergency access recovery scenarios
   * (e.g., user lost their authenticator device). It intentionally skips
   * TOTP token verification because it is invoked under admin privilege.
   *
   * **Security consideration**: This method should only be called from
   * admin-authenticated routes that enforce proper authorization checks
   * (e.g., requireAdmin middleware).
   *
   * @param userId - The ID of the user whose MFA should be disabled
   * @returns Ok(void) on success, or an appropriate error
   */
  async adminForceDisable(
    userId: string
  ): Promise<Result<void, "USER_NOT_FOUND" | "DATABASE_ERROR">> {
    try {
      // Verify the user exists
      const userResult = await this.userRepo.findById(userId);

      if (!userResult.ok) {
        return err("USER_NOT_FOUND");
      }

      const user = userResult.value;

      // Disable MFA, clear secret and backup codes
      await prisma.adminUser.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaSecret: null,
          passwordResetToken: null,
        },
      });

      // Log security event for audit trail
      await this.logSecurityEvent(userId, user.id, {
        action: "MFA_ADMIN_FORCE_DISABLED",
        severity: "HIGH",
        details: {},
      });

      return ok(undefined);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Admin force-disable MFA error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Disable MFA for a user
   */
  async disableMfa(
    userId: string,
    token: string
  ): Promise<
    Result<void, "USER_NOT_FOUND" | "MFA_NOT_ENABLED" | "INVALID_TOKEN" | "DATABASE_ERROR">
  > {
    try {
      // First verify the user can provide a valid MFA token
      const verification = await this.verifyMfaToken(userId, token);

      if (isErr(verification)) {
        // Type guard: verification is Err type here, can access .error
        // Extract error and return with correct type
        return err(verification.error);
      }

      // Disable MFA
      await prisma.adminUser.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaSecret: null,
          passwordResetToken: null, // Clear backup codes
        },
      });

      // Log MFA disabled (fetch user for accountId)
      const userResult = await this.userRepo.findById(userId);
      if (userResult.ok) {
        await this.logSecurityEvent(userId, userResult.value.id, {
          action: "MFA_DISABLED",
          severity: "HIGH",
          details: {},
        });
      }

      return ok(undefined);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "MFA disable error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Generate new backup codes for a user
   */
  async regenerateBackupCodes(
    userId: string,
    token: string
  ): Promise<
    Result<string[], "USER_NOT_FOUND" | "MFA_NOT_ENABLED" | "INVALID_TOKEN" | "DATABASE_ERROR">
  > {
    try {
      // First verify the user can provide a valid MFA token
      const verification = await this.verifyMfaToken(userId, token);

      if (isErr(verification)) {
        // Type guard: verification is Err type here, can access .error
        // Extract error and return with correct type
        return err(verification.error);
      }

      // Generate new backup codes
      const backupCodes = this.generateBackupCodes();
      const hashedBackupCodes = await Promise.all(
        backupCodes.map((code) => this.hashBackupCode(code))
      );

      // Update backup codes
      await prisma.adminUser.update({
        where: { id: userId },
        data: {
          passwordResetToken: JSON.stringify(hashedBackupCodes),
        },
      });

      // Log backup codes regenerated (fetch user for accountId)
      const userResult = await this.userRepo.findById(userId);
      if (userResult.ok) {
        await this.logSecurityEvent(userId, userResult.value.id, {
          action: "MFA_BACKUP_CODES_REGENERATED",
          severity: "MEDIUM",
          details: {},
        });
      }

      return ok(backupCodes);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Backup codes regeneration error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Get MFA status for a user
   */
  async getMfaStatus(userId: string): Promise<
    Result<
      {
        enabled: boolean;
        backupCodesCount: number;
      },
      "USER_NOT_FOUND" | "DATABASE_ERROR"
    >
  > {
    try {
      const userResult = await this.userRepo.findById(userId);

      if (!userResult.ok) {
        return err("USER_NOT_FOUND");
      }

      const user = userResult.value;

      let backupCodesCount = 0;
      if (user.passwordResetToken) {
        try {
          const backupCodes = JSON.parse(user.passwordResetToken);
          backupCodesCount = Array.isArray(backupCodes) ? backupCodes.length : 0;
        } catch {
          backupCodesCount = 0;
        }
      }

      return ok({
        enabled: user.mfaEnabled,
        backupCodesCount,
      });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Get MFA status error");
      return err("DATABASE_ERROR");
    }
  }

  // Private helper methods

  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < 8; i++) {
      // Generate 8-character alphanumeric codes
      const code = crypto.randomBytes(4).toString("hex").toUpperCase();
      codes.push(code);
    }
    return codes;
  }

  private async hashBackupCode(code: string): Promise<string> {
    // Backup codes are passwords; use the canonical Argon2id parameters.
    // SHA-256 alone is vulnerable to brute-force given the small alphabet
    // (~32 bits of entropy per code) — Argon2id makes the search space
    // computationally infeasible.
    return hashPassword(code);
  }

  private async verifyBackupCode(code: string, hashedCode: string): Promise<boolean> {
    return verifyPassword(hashedCode, code);
  }
}

// NOTE: No module-level singleton. MfaService is registered in the DI
// container (TOKENS.MfaService) and receives AdminUserRepositoryPort via
// constructor injection. See setup.ts for registration.
