/**
 * @file mfa.test.ts
 * @description Tests for MFA System
 * @layer infrastructure
 */
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../src/auth/authService.js";
import { MfaService } from "../src/auth/mfaService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../src/infrastructure/repositories/PrismaAdminUserRepository.js";

const adminUserRepo = new PrismaAdminUserRepository(prisma);
const mfaService = new MfaService(adminUserRepo);
const authService = new AuthService(prisma, adminUserRepo, mfaService);
import { authenticator } from "otplib";

/**
 * MFA (Multi-Factor Authentication) System Tests
 * Tests MFA setup, verification, backup codes, and auth service integration
 */

describe("MFA System", () => {
  const testUsers: string[] = [];

  after(async () => {
    if (testUsers.length > 0) {
      await prisma.adminUser.deleteMany({
        where: {
          id: { in: testUsers },
        },
      });
    }
  });

  describe("MFA Status", () => {
    let testUserId: string;

    beforeEach(async () => {
      const email = `mfa-status-${Date.now()}@test.com`;
      const result = await authService.registerAdmin(
        email,
        "password123",
        "MFA Status Test",
        "ADMIN"
      );
      assert.ok(result.ok);
      testUserId = result.value.id;
      testUsers.push(testUserId);
    });

    afterEach(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should return disabled status for user without MFA", async () => {
      const result = await mfaService.getMfaStatus(testUserId);

      assert.ok(result.ok, "Get MFA status should succeed");
      assert.equal(result.value.enabled, false, "MFA should be disabled");
      assert.equal(result.value.backupCodesCount, 0, "Should have no backup codes");
    });

    it("should return error for non-existent user", async () => {
      const fakeUserId = "00000000-0000-0000-0000-000000000000";
      const result = await mfaService.getMfaStatus(fakeUserId);

      assert.ok(!result.ok, "Should fail for non-existent user");
      assert.equal(result.error, "USER_NOT_FOUND");
    });
  });

  describe("MFA Setup", () => {
    let testUserId: string;
    let testEmail: string;

    beforeEach(async () => {
      testEmail = `mfa-setup-${Date.now()}@test.com`;
      const result = await authService.registerAdmin(
        testEmail,
        "password123",
        "MFA Setup Test",
        "ADMIN"
      );
      assert.ok(result.ok);
      testUserId = result.value.id;
      testUsers.push(testUserId);
    });

    afterEach(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should setup MFA successfully", async () => {
      const result = await mfaService.setupMfa(testUserId, testEmail);

      assert.ok(result.ok, "MFA setup should succeed");
      assert.ok(result.value.secret, "Should return secret");
      assert.ok(result.value.qrCodeUrl.includes("data:image/png;base64"), "Should return QR code");
      assert.ok(result.value.manualEntryKey, "Should return manual entry key");
      assert.equal(result.value.backupCodes.length, 8, "Should return 8 backup codes");
    });

    it("should prevent duplicate MFA setup", async () => {
      // First setup
      const result1 = await mfaService.setupMfa(testUserId, testEmail);
      assert.ok(result1.ok, "First setup should succeed");

      const token = authenticator.generate(result1.value.secret);

      // Verify setup
      const verifyResult = await mfaService.verifyMfaSetup(testUserId, token);
      assert.ok(verifyResult.ok, "MFA verification should succeed");

      // Try setup again
      const result2 = await mfaService.setupMfa(testUserId, testEmail);
      assert.ok(!result2.ok, "Duplicate setup should fail");
      assert.equal(result2.error, "MFA_ALREADY_ENABLED");
    });
  });

  describe("MFA Setup Verification", () => {
    let testUserId: string;
    let testEmail: string;
    let testSecret: string;

    beforeEach(async () => {
      testEmail = `mfa-verify-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        testEmail,
        "password123",
        "MFA Verify Test",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      testUserId = registerResult.value.id;
      testUsers.push(testUserId);

      const setupResult = await mfaService.setupMfa(testUserId, testEmail);
      assert.ok(setupResult.ok);
      testSecret = setupResult.value.secret;
    });

    afterEach(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should verify MFA setup with valid TOTP token", async () => {
      const token = authenticator.generate(testSecret);

      const result = await mfaService.verifyMfaSetup(testUserId, token);

      assert.ok(result.ok, "MFA verification should succeed");
      assert.equal(result.value.backupCodes.length, 8, "Should generate 8 backup codes");
    });

    it("should reject MFA setup with invalid token", async () => {
      const result = await mfaService.verifyMfaSetup(testUserId, "000000");

      assert.ok(!result.ok, "Invalid token should be rejected");
    });
  });

  describe("MFA Token Verification", () => {
    let testUserId: string;
    let testSecret: string;

    before(async () => {
      const email = `mfa-token-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        email,
        "password123",
        "MFA Token Test",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      testUserId = registerResult.value.id;
      testUsers.push(testUserId);

      const setupResult = await mfaService.setupMfa(testUserId, email);
      assert.ok(setupResult.ok);
      testSecret = setupResult.value.secret;

      // Verify setup to enable MFA
      const token = authenticator.generate(testSecret);
      const verifyResult = await mfaService.verifyMfaSetup(testUserId, token);
      assert.ok(verifyResult.ok);
    });

    after(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should verify valid TOTP token", async () => {
      const token = authenticator.generate(testSecret);

      const result = await mfaService.verifyMfaToken(testUserId, token);

      assert.ok(result.ok, "Valid token should verify successfully");
      assert.equal(result.value.verified, true);
      assert.equal(result.value.usedBackupCode, false);
    });

    it("should reject invalid TOTP token", async () => {
      const result = await mfaService.verifyMfaToken(testUserId, "000000");

      assert.ok(!result.ok, "Invalid token should be rejected");
    });

    it("should reject token when MFA not enabled", async () => {
      const email = `mfa-disabled-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        email,
        "password123",
        "MFA Disabled Test",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      const userId = registerResult.value.id;
      testUsers.push(userId);

      const result = await mfaService.verifyMfaToken(userId, "000000");

      assert.ok(!result.ok, "Should fail when MFA not enabled");
      assert.equal(result.error, "MFA_NOT_ENABLED");

      await prisma.adminUser.delete({ where: { id: userId } }).catch(() => {});
    });
  });

  describe("Backup Code Management", () => {
    let testUserId: string;
    let testSecret: string;

    before(async () => {
      const email = `mfa-backup-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        email,
        "password123",
        "MFA Backup Test",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      testUserId = registerResult.value.id;
      testUsers.push(testUserId);

      const setupResult = await mfaService.setupMfa(testUserId, email);
      assert.ok(setupResult.ok);
      testSecret = setupResult.value.secret;

      // Verify setup to enable MFA
      const token = authenticator.generate(testSecret);
      const verifyResult = await mfaService.verifyMfaSetup(testUserId, token);
      assert.ok(verifyResult.ok);
    });

    after(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should regenerate backup codes", async () => {
      const token = authenticator.generate(testSecret);

      const result = await mfaService.regenerateBackupCodes(testUserId, token);

      assert.ok(result.ok, "Backup code regeneration should succeed");
      assert.equal(result.value.length, 8, "Should generate 8 backup codes");
      assert.ok(
        result.value.every((code) => code.length === 8),
        "All codes should be 8 characters"
      );
    });

    it("should verify backup code successfully", async () => {
      // Get fresh backup codes
      const token = authenticator.generate(testSecret);

      const backupResult = await mfaService.regenerateBackupCodes(testUserId, token);
      assert.ok(backupResult.ok);
      const backupCode = backupResult.value[0];

      // Use backup code
      const result = await mfaService.verifyMfaToken(testUserId, backupCode);

      assert.ok(result.ok, "Backup code should verify successfully");
      assert.equal(result.value.verified, true);
      assert.equal(result.value.usedBackupCode, true);
    });

    it("should prevent backup code reuse", async () => {
      // Get fresh backup codes
      const token = authenticator.generate(testSecret);

      const backupResult = await mfaService.regenerateBackupCodes(testUserId, token);
      assert.ok(backupResult.ok);
      const backupCode = backupResult.value[0];

      // Use backup code first time
      const result1 = await mfaService.verifyMfaToken(testUserId, backupCode);
      assert.ok(result1.ok, "First use should succeed");

      // Try to use same backup code again
      const result2 = await mfaService.verifyMfaToken(testUserId, backupCode);
      assert.ok(!result2.ok, "Backup code reuse should fail");
    });
  });

  describe("Auth Service MFA Integration", () => {
    let testUserId: string;
    let testEmail: string;
    let testSecret: string;

    before(async () => {
      testEmail = `mfa-auth-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        testEmail,
        "password123",
        "MFA Auth Test",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      testUserId = registerResult.value.id;
      testUsers.push(testUserId);

      // Setup and verify MFA
      const setupResult = await mfaService.setupMfa(testUserId, testEmail);
      assert.ok(setupResult.ok);
      testSecret = setupResult.value.secret;

      const token = authenticator.generate(testSecret);
      const verifyResult = await mfaService.verifyMfaSetup(testUserId, token);
      assert.ok(verifyResult.ok);
    });

    after(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should require MFA for login when enabled", async () => {
      const result = await authService.login({
        email: testEmail,
        password: "password123",
      });

      assert.ok(result.ok, "Login should succeed");
      assert.ok("mfaRequired" in result.value, "Should indicate MFA required");
      assert.equal(result.value.mfaRequired, true);
    });

    it("should complete login with valid MFA token", async () => {
      const token = authenticator.generate(testSecret);

      const result = await authService.login({
        email: testEmail,
        password: "password123",
        mfaToken: token,
      });

      assert.ok(result.ok, "MFA login should succeed");
      assert.ok("user" in result.value, "Should return user data");
      assert.ok(result.value.tokens.accessToken, "Should return access token");
    });

    it("should reject login with invalid MFA token", async () => {
      const result = await authService.login({
        email: testEmail,
        password: "password123",
        mfaToken: "000000",
      });

      assert.ok(!result.ok, "Login with invalid MFA token should fail");
    });

    it("should complete login with backup code", async () => {
      // Get fresh backup codes
      const token = authenticator.generate(testSecret);

      const backupResult = await mfaService.regenerateBackupCodes(testUserId, token);
      assert.ok(backupResult.ok);
      const backupCode = backupResult.value[0];

      // Login with backup code
      const result = await authService.login({
        email: testEmail,
        password: "password123",
        mfaToken: backupCode,
      });

      assert.ok(result.ok, "Login with backup code should succeed");
      assert.ok("user" in result.value, "Should return user data");
    });
  });

  describe("MFA Disable", () => {
    let testUserId: string;
    let testEmail: string;
    let testSecret: string;

    beforeEach(async () => {
      testEmail = `mfa-disable-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        testEmail,
        "password123",
        "MFA Disable Test",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      testUserId = registerResult.value.id;
      testUsers.push(testUserId);

      // Setup and verify MFA
      const setupResult = await mfaService.setupMfa(testUserId, testEmail);
      assert.ok(setupResult.ok);
      testSecret = setupResult.value.secret;

      const token = authenticator.generate(testSecret);
      const verifyResult = await mfaService.verifyMfaSetup(testUserId, token);
      assert.ok(verifyResult.ok);
    });

    afterEach(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should disable MFA successfully", async () => {
      const token = authenticator.generate(testSecret);

      const result = await mfaService.disableMfa(testUserId, token);

      assert.ok(result.ok, "MFA disable should succeed");

      // Verify MFA is disabled
      const statusResult = await mfaService.getMfaStatus(testUserId);
      assert.ok(statusResult.ok);
      assert.equal(statusResult.value.enabled, false, "MFA should be disabled");
      assert.equal(statusResult.value.backupCodesCount, 0, "Should have no backup codes");
    });

    it("should allow normal login after MFA disabled", async () => {
      const token = authenticator.generate(testSecret);

      // Disable MFA
      const disableResult = await mfaService.disableMfa(testUserId, token);
      assert.ok(disableResult.ok);

      // Login without MFA
      const loginResult = await authService.login({
        email: testEmail,
        password: "password123",
      });

      assert.ok(loginResult.ok, "Login should succeed");
      assert.ok("user" in loginResult.value, "Should return user data");
      assert.ok(!("mfaRequired" in loginResult.value), "Should not require MFA");
    });

    it("should reject MFA disable with invalid token", async () => {
      const result = await mfaService.disableMfa(testUserId, "000000");

      assert.ok(!result.ok, "Disable with invalid token should fail");
    });
  });

  describe("MFA Error Handling", () => {
    it("should handle non-existent user gracefully", async () => {
      const fakeUserId = "00000000-0000-0000-0000-000000000000";

      const statusResult = await mfaService.getMfaStatus(fakeUserId);
      assert.ok(!statusResult.ok);
      assert.equal(statusResult.error, "USER_NOT_FOUND");

      const setupResult = await mfaService.setupMfa(fakeUserId, "fake@example.com");
      assert.ok(!setupResult.ok);
      assert.equal(setupResult.error, "USER_NOT_FOUND");
    });

    it("should validate token format", async () => {
      const email = `mfa-error-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        email,
        "password123",
        "MFA Error Test",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      const userId = registerResult.value.id;
      testUsers.push(userId);

      const setupResult = await mfaService.setupMfa(userId, email);
      assert.ok(setupResult.ok);

      // Try to verify with invalid token format
      const verifyResult = await mfaService.verifyMfaSetup(userId, "invalid");
      assert.ok(!verifyResult.ok, "Invalid token format should be rejected");

      await prisma.adminUser.delete({ where: { id: userId } }).catch(() => {});
    });
  });
});
