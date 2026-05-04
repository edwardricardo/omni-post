/**
 * @file MfaService.ts
 * @description Handles MFA operations for admin users including TOTP setup,
 *              QR code generation, backup codes, and verification during login.
 * @layer infrastructure
 */

import { hashPassword } from "../../auth/passwordHashing.js";
import crypto from "crypto";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { prisma } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import type {
  MfaSetupResponse,
  MfaStatusResponse,
  AuthErrorCode,
  SecurityEventType,
} from "./adminAuthTypes";
import { adminAuthConfig } from "./adminAuthConfig";

export class MfaService {
  /**
   * Setup MFA for admin user (generates secret and QR code)
   */
  async setupMfa(userId: string): Promise<Result<MfaSetupResponse, AuthErrorCode>> {
    const user = await prisma.adminUser.findUnique({
      where: { id: userId },
      select: { email: true, mfaEnabled: true },
    });

    if (!user) {
      return err("USER_NOT_FOUND");
    }

    if (user.mfaEnabled) {
      return err("INVALID_REQUEST" as AuthErrorCode);
    }

    // Generate TOTP secret
    const secret = authenticator.generateSecret();

    // Generate backup codes
    const backupCodes = Array.from({ length: adminAuthConfig.mfa.backupCodesCount }, () =>
      crypto.randomBytes(5).toString("hex").toUpperCase()
    );

    // Hash backup codes for storage
    const hashedBackupCodes = await Promise.all(backupCodes.map((code) => hashPassword(code)));

    // Save to database (not enabled yet - user must verify)
    await prisma.adminUser.update({
      where: { id: userId },
      data: {
        mfaSecret: secret,
        mfaBackupCodes: hashedBackupCodes,
      },
    });

    // Generate QR code
    const otpauth = authenticator.keyuri(user.email, adminAuthConfig.mfa.issuer, secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    return ok({
      secret,
      qrCodeUrl,
      backupCodes,
      recoveryCodes: backupCodes,
    });
  }

  /**
   * Verify MFA token and enable MFA
   */
  async verifyAndEnableMfa(
    userId: string,
    token: string,
    onSecurityEvent: (event: {
      type: SecurityEventType;
      userId: string;
      success: boolean;
      timestamp: Date;
    }) => Promise<void>
  ): Promise<Result<boolean, AuthErrorCode>> {
    const user = await prisma.adminUser.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true },
    });

    if (!user || !user.mfaSecret) {
      return err("USER_NOT_FOUND");
    }

    // Verify token
    const isValid = authenticator.verify({
      token,
      secret: user.mfaSecret,
    });

    if (!isValid) {
      return err("MFA_INVALID");
    }

    // Enable MFA
    await prisma.adminUser.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    await onSecurityEvent({
      type: "MFA_ENABLED",
      userId,
      success: true,
      timestamp: new Date(),
    });

    return ok(true);
  }

  /**
   * Verify MFA token during login
   */
  async verifyMfaToken(userId: string, token: string): Promise<boolean> {
    const user = await prisma.adminUser.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true },
    });

    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      return false;
    }

    return authenticator.verify({
      token,
      secret: user.mfaSecret,
    });
  }

  /**
   * Disable MFA for a user
   */
  async disableMfa(
    userId: string,
    password: string,
    mfaToken: string,
    verifyPassword: (
      password: string,
      storedHash: string,
      algorithm?: string
    ) => Promise<{ valid: boolean; needsMigration: boolean }>,
    onSecurityEvent: (event: {
      type: SecurityEventType;
      userId: string;
      success: boolean;
      timestamp: Date;
    }) => Promise<void>
  ): Promise<Result<boolean, AuthErrorCode>> {
    // Get user
    const user = await prisma.adminUser.findUnique({
      where: { id: userId },
      select: {
        passwordHash: true,
        passwordHashAlgo: true,
        mfaEnabled: true,
        mfaSecret: true,
      },
    });

    if (!user) {
      return err("USER_NOT_FOUND");
    }

    if (!user.mfaEnabled || !user.mfaSecret) {
      return err("INVALID_REQUEST");
    }

    // Verify password
    const { valid: passwordValid } = await verifyPassword(password, user.passwordHash);

    if (!passwordValid) {
      return err("INVALID_CREDENTIALS");
    }

    // Verify MFA token
    const mfaValid = authenticator.verify({
      token: mfaToken,
      secret: user.mfaSecret,
    });

    if (!mfaValid) {
      return err("MFA_INVALID");
    }

    // Disable MFA
    await prisma.adminUser.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: [],
        mfaBackupUsedAt: {},
      },
    });

    // Log security event
    await onSecurityEvent({
      type: "MFA_DISABLED",
      userId,
      success: true,
      timestamp: new Date(),
    });

    return ok(true);
  }

  /**
   * Get MFA status for a user
   */
  async getMfaStatus(userId: string): Promise<Result<MfaStatusResponse, AuthErrorCode>> {
    const user = await prisma.adminUser.findUnique({
      where: { id: userId },
      select: {
        mfaEnabled: true,
        mfaBackupCodes: true,
        mfaBackupUsedAt: true,
      },
    });

    if (!user) {
      return err("USER_NOT_FOUND");
    }

    // Count remaining backup codes
    const usedCodesMap = (user.mfaBackupUsedAt as Record<string, unknown>) || {};
    const usedCodesCount = Object.keys(usedCodesMap).length;
    const backupCodesRemaining = user.mfaBackupCodes.length - usedCodesCount;

    return ok({
      enabled: user.mfaEnabled,
      backupCodesRemaining: Math.max(0, backupCodesRemaining),
    });
  }
}
