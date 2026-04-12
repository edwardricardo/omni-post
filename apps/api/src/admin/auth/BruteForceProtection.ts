/**
 * @file BruteForceProtection.ts
 * @description Protects admin accounts against brute force attacks via login attempt
 *              tracking, threat score calculation, and account locking.
 * @layer infrastructure
 */

import { prisma } from "@infra/prisma";
import type { DeviceFingerprint, SecurityEventType } from "./adminAuthTypes";
import { adminAuthConfig } from "./adminAuthConfig";

export class BruteForceProtection {
  /**
   * Record login attempt for security analytics
   */
  async recordLoginAttempt(
    email: string,
    success: boolean,
    device: DeviceFingerprint,
    userId?: string,
    failureReason?: string
  ): Promise<void> {
    // Calculate threat score based on recent failed attempts
    const recentAttempts = await prisma.adminLoginAttempt.count({
      where: {
        email,
        success: false,
        attemptedAt: {
          gte: new Date(Date.now() - 60 * 60 * 1000), // Last hour
        },
      },
    });

    const threatScore = Math.min(100, recentAttempts * 20);

    // Build login attempt data object conditionally
    const attemptData: Record<string, unknown> = {
      email,
      success,
      ipAddress: device.ipAddress,
      userAgent: device.userAgent,
      deviceId: device.deviceId,
      threatScore,
      requiresCaptcha: threatScore >= 60,
      isBlocked: threatScore >= 80,
    };

    if (userId) {
      attemptData.userId = userId;
    }
    if (failureReason) {
      attemptData.failureReason = failureReason;
    }
    if (device.location) {
      attemptData.location = device.location;
    }

    await prisma.adminLoginAttempt.create({
      data: attemptData as Parameters<typeof prisma.adminLoginAttempt.create>[0]["data"],
    });
  }

  /**
   * Check if account should be locked due to failed attempts
   */
  async checkAndLockAccount(
    userId: string,
    onSecurityEvent: (event: {
      type: SecurityEventType;
      userId: string;
      details?: Record<string, unknown>;
      success: boolean;
      timestamp: Date;
    }) => Promise<void>
  ): Promise<boolean> {
    const user = await prisma.adminUser.findUnique({
      where: { id: userId },
      select: { failedLoginAttempts: true, lockedUntil: true },
    });

    if (!user) return false;

    // Check if already locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return true;
    }

    // Increment failed attempts
    const updatedUser = await prisma.adminUser.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: user.failedLoginAttempts + 1,
      },
    });

    // Lock account if max attempts exceeded
    if (updatedUser.failedLoginAttempts >= adminAuthConfig.security.maxLoginAttempts) {
      const lockUntil = new Date(
        Date.now() + adminAuthConfig.security.lockoutDurationMinutes * 60 * 1000
      );
      await prisma.adminUser.update({
        where: { id: userId },
        data: {
          lockedUntil: lockUntil,
          lockReason: "BRUTE_FORCE",
        },
      });

      await onSecurityEvent({
        type: "ACCOUNT_LOCKED",
        userId,
        details: { reason: "BRUTE_FORCE", lockUntil },
        success: true,
        timestamp: new Date(),
      });

      return true;
    }

    return false;
  }

  /**
   * Reset failed login attempts on successful login
   */
  async resetFailedAttempts(userId: string): Promise<void> {
    await prisma.adminUser.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lockReason: null,
      },
    });
  }
}
