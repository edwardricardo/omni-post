#!/usr/bin/env tsx
/**
 * Unit Tests for MfaService
 * Testing MFA setup, verification, and management
 *
 * Coverage Target: 90%+
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MfaService } from "../../src/auth/mfaService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";

// Instantiate service with injected Prisma repository (proper DI pattern)
const mfaService = new MfaService(new PrismaAdminUserRepository(prisma));
import { authenticator } from "otplib";

const timestamp = Date.now();
const testEmail = `test-mfa-${timestamp}@example.com`;

let testUserId: string;
let mfaSecret: string;
let backupCodes: string[];
let inactiveUserId: string;
let invalidJsonUserId: string;

describe("MfaService Tests", { concurrency: 1 }, () => {
  before(async () => {
    // Setup: Create test user
    const testUser = await prisma.adminUser.create({
      data: {
        email: testEmail,
        passwordHash: "test-hash",
        name: "Test MFA User",
        emailVerified: true,
        mfaEnabled: false,
      },
    });

    testUserId = testUser.id;
  });

  after(async () => {
    // Cleanup: Delete test users
    await prisma.auditLog.deleteMany({ where: { userId: testUserId } });
    await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});

    if (inactiveUserId) {
      await prisma.auditLog.deleteMany({ where: { userId: inactiveUserId } });
      await prisma.adminUser.delete({ where: { id: inactiveUserId } }).catch(() => {});
    }

    if (invalidJsonUserId) {
      await prisma.auditLog.deleteMany({ where: { userId: invalidJsonUserId } });
      await prisma.adminUser.delete({ where: { id: invalidJsonUserId } }).catch(() => {});
    }
  });

  describe("setupMfa", () => {
    it("should generate MFA secret and QR code", async () => {
      const setupResult = await mfaService.setupMfa(testUserId, testEmail);

      assert.strictEqual(setupResult.ok, true);
      assert.ok(setupResult.ok && setupResult.value.secret);
      assert.ok(setupResult.ok && setupResult.value.qrCodeUrl);
      assert.ok(setupResult.ok && setupResult.value.backupCodes);
      assert.ok(setupResult.ok && setupResult.value.backupCodes.length >= 8);

      if (setupResult.ok) {
        mfaSecret = setupResult.value.secret;
        backupCodes = setupResult.value.backupCodes;
      }
    });

    it("should reject non-existent user", async () => {
      const invalidSetupResult = await mfaService.setupMfa("invalid-user-id", "test@example.com");

      assert.strictEqual(invalidSetupResult.ok, false);
      assert.strictEqual(invalidSetupResult.ok || invalidSetupResult.error, "USER_NOT_FOUND");
    });

    it("should reject inactive user", async () => {
      const inactiveUserEmail = `test-mfa-inactive-${timestamp}@example.com`;
      const inactiveUser = await prisma.adminUser.create({
        data: {
          email: inactiveUserEmail,
          passwordHash: "test-hash",
          name: "Test Inactive MFA User",
          emailVerified: true,
          mfaEnabled: false,
          isActive: false,
        },
      });

      inactiveUserId = inactiveUser.id;

      const inactiveSetupResult = await mfaService.setupMfa(inactiveUser.id, inactiveUserEmail);

      assert.strictEqual(inactiveSetupResult.ok, false);
      assert.strictEqual(inactiveSetupResult.ok || inactiveSetupResult.error, "USER_INACTIVE");
    });

    it("should reject when MFA already enabled", async () => {
      // Enable MFA for test user first
      await prisma.adminUser.update({
        where: { id: testUserId },
        data: { mfaEnabled: true },
      });

      const alreadyEnabledResult = await mfaService.setupMfa(testUserId, testEmail);

      assert.strictEqual(alreadyEnabledResult.ok, false);
      assert.strictEqual(
        alreadyEnabledResult.ok || alreadyEnabledResult.error,
        "MFA_ALREADY_ENABLED"
      );

      // Disable MFA to continue other tests
      await prisma.adminUser.update({
        where: { id: testUserId },
        data: { mfaEnabled: false, mfaSecret: null, passwordResetToken: null },
      });
    });
  });

  describe("getMfaStatus", () => {
    it("should return MFA disabled before verification", async () => {
      const statusBeforeResult = await mfaService.getMfaStatus(testUserId);

      assert.strictEqual(statusBeforeResult.ok, true);
      assert.strictEqual(statusBeforeResult.ok && statusBeforeResult.value.enabled, false);
    });

    it("should reject non-existent user", async () => {
      const invalidStatusResult = await mfaService.getMfaStatus("invalid-user-id");

      assert.strictEqual(invalidStatusResult.ok, false);
      assert.strictEqual(invalidStatusResult.ok || invalidStatusResult.error, "USER_NOT_FOUND");
    });

    it("should handle invalid JSON gracefully", async () => {
      const invalidJsonUserEmail = `test-mfa-invalid-json-${timestamp}@example.com`;
      const invalidJsonUser = await prisma.adminUser.create({
        data: {
          email: invalidJsonUserEmail,
          passwordHash: "test-hash",
          name: "Test Invalid JSON User",
          emailVerified: true,
          mfaEnabled: true,
          passwordResetToken: "invalid-json-data",
        },
      });

      invalidJsonUserId = invalidJsonUser.id;

      const invalidJsonStatusResult = await mfaService.getMfaStatus(invalidJsonUser.id);

      assert.strictEqual(invalidJsonStatusResult.ok, true);
      assert.strictEqual(invalidJsonStatusResult.ok && invalidJsonStatusResult.value.enabled, true);
      assert.strictEqual(
        invalidJsonStatusResult.ok && invalidJsonStatusResult.value.backupCodesCount,
        0
      );
    });
  });

  describe("verifyMfaSetup", () => {
    it("should verify with valid TOTP token", async () => {
      // Setup MFA first
      const setupResult = await mfaService.setupMfa(testUserId, testEmail);
      assert.strictEqual(setupResult.ok, true);

      if (setupResult.ok) {
        mfaSecret = setupResult.value.secret;

        // Generate a valid TOTP token
        const validToken = authenticator.generate(mfaSecret);

        const verifySetupResult = await mfaService.verifyMfaSetup(testUserId, validToken);

        assert.strictEqual(verifySetupResult.ok, true);
        assert.ok(verifySetupResult.ok && verifySetupResult.value.backupCodes);
        assert.ok(verifySetupResult.ok && verifySetupResult.value.backupCodes.length >= 8);

        if (verifySetupResult.ok) {
          backupCodes = verifySetupResult.value.backupCodes;
        }
      }
    });

    it("should return MFA enabled after verification", async () => {
      const statusAfterResult = await mfaService.getMfaStatus(testUserId);

      assert.strictEqual(statusAfterResult.ok, true);
      assert.strictEqual(statusAfterResult.ok && statusAfterResult.value.enabled, true);
    });

    it("should reject non-existent user", async () => {
      const invalidVerifySetupResult = await mfaService.verifyMfaSetup("invalid-user-id", "123456");

      assert.strictEqual(invalidVerifySetupResult.ok, false);
      assert.strictEqual(
        invalidVerifySetupResult.ok || invalidVerifySetupResult.error,
        "USER_NOT_FOUND"
      );
    });

    it("should reject when no setup in progress", async () => {
      // Reset user
      await prisma.adminUser.update({
        where: { id: testUserId },
        data: { mfaEnabled: false, mfaSecret: null, passwordResetToken: null },
      });

      const noSetupVerifyResult = await mfaService.verifyMfaSetup(testUserId, "123456");

      assert.strictEqual(noSetupVerifyResult.ok, false);
      assert.strictEqual(
        noSetupVerifyResult.ok || noSetupVerifyResult.error,
        "NO_SETUP_IN_PROGRESS"
      );
    });

    it("should handle invalid backup codes JSON during verification", async () => {
      // Reset user for fresh MFA setup
      await prisma.adminUser.update({
        where: { id: testUserId },
        data: {
          mfaEnabled: false,
          mfaSecret: mfaSecret,
          passwordResetToken: "invalid-json-data",
        },
      });

      const validToken2 = authenticator.generate(mfaSecret);

      const verifyWithInvalidJsonResult = await mfaService.verifyMfaSetup(testUserId, validToken2);

      assert.strictEqual(verifyWithInvalidJsonResult.ok, true);
      assert.ok(verifyWithInvalidJsonResult.ok && verifyWithInvalidJsonResult.value.backupCodes);
      assert.ok(
        verifyWithInvalidJsonResult.ok && verifyWithInvalidJsonResult.value.backupCodes.length >= 8
      );

      // Capture the new backup codes so the verifyMfaToken tests use valid ones
      if (verifyWithInvalidJsonResult.ok) {
        backupCodes = verifyWithInvalidJsonResult.value.backupCodes;
      }
    });
  });

  describe("verifyMfaToken", () => {
    before(async () => {
      // Ensure MFA is enabled with valid secret
      await prisma.adminUser.update({
        where: { id: testUserId },
        data: { mfaEnabled: true, mfaSecret: mfaSecret },
      });
    });

    it("should verify login with valid TOTP", async () => {
      const loginToken = authenticator.generate(mfaSecret);

      const verifyLoginResult = await mfaService.verifyMfaToken(testUserId, loginToken);

      assert.strictEqual(verifyLoginResult.ok, true);
      assert.strictEqual(verifyLoginResult.ok && verifyLoginResult.value.verified, true);
      assert.strictEqual(verifyLoginResult.ok && verifyLoginResult.value.usedBackupCode, false);
    });

    it("should reject invalid TOTP", async () => {
      const invalidVerifyResult = await mfaService.verifyMfaToken(testUserId, "000000");

      assert.strictEqual(invalidVerifyResult.ok, false);
      assert.strictEqual(invalidVerifyResult.ok || invalidVerifyResult.error, "INVALID_TOKEN");
    });

    it("should verify with backup code", async () => {
      const backupCode = backupCodes[0];
      assert.ok(backupCode, "Backup code should exist");

      const backupVerifyResult = await mfaService.verifyMfaToken(testUserId, backupCode);

      assert.strictEqual(backupVerifyResult.ok, true);
      assert.strictEqual(backupVerifyResult.ok && backupVerifyResult.value.verified, true);
      assert.strictEqual(backupVerifyResult.ok && backupVerifyResult.value.usedBackupCode, true);
    });

    it("should reject used backup code", async () => {
      const usedBackupResult = await mfaService.verifyMfaToken(
        testUserId,
        backupCodes[0] as string
      );

      assert.strictEqual(usedBackupResult.ok, false);
      assert.strictEqual(usedBackupResult.ok || usedBackupResult.error, "INVALID_TOKEN");
    });

    it("should reject non-existent user", async () => {
      const invalidVerifyTokenResult = await mfaService.verifyMfaToken("invalid-user-id", "123456");

      assert.strictEqual(invalidVerifyTokenResult.ok, false);
      assert.strictEqual(
        invalidVerifyTokenResult.ok || invalidVerifyTokenResult.error,
        "USER_NOT_FOUND"
      );
    });

    it("should reject when MFA not enabled", async () => {
      // Temporarily disable MFA
      await prisma.adminUser.update({
        where: { id: testUserId },
        data: { mfaEnabled: false },
      });

      const mfaNotEnabledResult = await mfaService.verifyMfaToken(testUserId, "123456");

      assert.strictEqual(mfaNotEnabledResult.ok, false);
      assert.strictEqual(mfaNotEnabledResult.ok || mfaNotEnabledResult.error, "MFA_NOT_ENABLED");

      // Re-enable for other tests
      await prisma.adminUser.update({
        where: { id: testUserId },
        data: { mfaEnabled: true },
      });
    });

    it("should handle invalid backup code JSON", async () => {
      // Enable MFA with secret but invalid backup codes JSON
      await prisma.adminUser.update({
        where: { id: testUserId },
        data: {
          mfaEnabled: true,
          mfaSecret: mfaSecret,
          passwordResetToken: "invalid-json",
        },
      });

      const invalidJsonVerifyResult = await mfaService.verifyMfaToken(testUserId, "12345678");

      assert.strictEqual(invalidJsonVerifyResult.ok, false);
      assert.strictEqual(
        invalidJsonVerifyResult.ok || invalidJsonVerifyResult.error,
        "INVALID_TOKEN"
      );
    });
  });

  describe("regenerateBackupCodes", () => {
    it("should generate new backup codes", async () => {
      // Ensure MFA is enabled
      await prisma.adminUser.update({
        where: { id: testUserId },
        data: { mfaEnabled: true, mfaSecret: mfaSecret },
      });

      const regenToken = authenticator.generate(mfaSecret);

      const regenResult = await mfaService.regenerateBackupCodes(testUserId, regenToken);

      assert.strictEqual(regenResult.ok, true);
      assert.ok(regenResult.ok && Array.isArray(regenResult.value));
      assert.ok(regenResult.ok && regenResult.value.length >= 8);
    });

    it("should reject non-existent user", async () => {
      const invalidRegenResult = await mfaService.regenerateBackupCodes(
        "invalid-user-id",
        "123456"
      );

      assert.strictEqual(invalidRegenResult.ok, false);
      assert.strictEqual(invalidRegenResult.ok || invalidRegenResult.error, "USER_NOT_FOUND");
    });
  });

  describe("disableMfa", () => {
    it("should disable MFA for user", async () => {
      const disableToken = authenticator.generate(mfaSecret);

      const disableResult = await mfaService.disableMfa(testUserId, disableToken);

      assert.strictEqual(disableResult.ok, true);
    });

    it("should confirm MFA is disabled", async () => {
      const finalStatusResult = await mfaService.getMfaStatus(testUserId);

      assert.strictEqual(finalStatusResult.ok, true);
      assert.strictEqual(finalStatusResult.ok && finalStatusResult.value.enabled, false);
    });

    it("should reject non-existent user", async () => {
      const invalidDisableResult = await mfaService.disableMfa("invalid-user-id", "123456");

      assert.strictEqual(invalidDisableResult.ok, false);
      assert.strictEqual(invalidDisableResult.ok || invalidDisableResult.error, "USER_NOT_FOUND");
    });
  });

  describe("adminForceDisable", () => {
    it("should force-disable MFA without TOTP verification", async () => {
      // First, enable MFA so we can test disabling it
      const setupResult = await mfaService.setupMfa(testUserId, testEmail);
      assert.strictEqual(setupResult.ok, true);

      if (setupResult.ok) {
        const validToken = authenticator.generate(setupResult.value.secret);
        const verifyResult = await mfaService.verifyMfaSetup(testUserId, validToken);
        assert.strictEqual(verifyResult.ok, true);

        // Capture secret for potential later use
        mfaSecret = setupResult.value.secret;
      }

      // Confirm MFA is enabled
      const statusBefore = await mfaService.getMfaStatus(testUserId);
      assert.strictEqual(statusBefore.ok, true);
      assert.strictEqual(statusBefore.ok && statusBefore.value.enabled, true);

      // Force-disable without providing a TOTP token
      const forceDisableResult = await mfaService.adminForceDisable(testUserId);

      assert.strictEqual(forceDisableResult.ok, true);

      // Confirm MFA is now disabled
      const statusAfter = await mfaService.getMfaStatus(testUserId);
      assert.strictEqual(statusAfter.ok, true);
      assert.strictEqual(statusAfter.ok && statusAfter.value.enabled, false);
      assert.strictEqual(statusAfter.ok && statusAfter.value.backupCodesCount, 0);
    });

    it("should succeed even when MFA is already disabled", async () => {
      // Ensure MFA is already disabled
      const statusBefore = await mfaService.getMfaStatus(testUserId);
      assert.strictEqual(statusBefore.ok, true);
      assert.strictEqual(statusBefore.ok && statusBefore.value.enabled, false);

      // Force-disable should still succeed (idempotent)
      const forceDisableResult = await mfaService.adminForceDisable(testUserId);

      assert.strictEqual(forceDisableResult.ok, true);
    });

    it("should reject non-existent user", async () => {
      const invalidResult = await mfaService.adminForceDisable("invalid-user-id");

      assert.strictEqual(invalidResult.ok, false);
      assert.strictEqual(invalidResult.ok || invalidResult.error, "USER_NOT_FOUND");
    });
  });
});
