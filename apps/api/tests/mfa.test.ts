/**
 * @file mfa.test.ts
 * @description Tests for MFA System
 * @layer infrastructure
 */
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../src/auth/authService.js";
import { MfaService } from "../src/admin/auth/MfaService.js";
import { MFA_SUBJECT_TYPE, type MfaSubject } from "@ports/core";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { PrismaRoleRepository } from "../src/infrastructure/repositories/PrismaRoleRepository.js";
import { PrismaAdminSessionRepository } from "../src/infrastructure/repositories/PrismaAdminSessionRepository.js";
import { PrismaAuditLogRepository } from "../src/infrastructure/repositories/PrismaAuditLogRepository.js";
import { PrismaAdminMfaUserRepository } from "../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";
import { PrismaCustomerMfaUserRepository } from "../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js";

const adminUserRepo = new PrismaAdminUserRepository(prisma);
const roleRepo = new PrismaRoleRepository(prisma);
const sessionRepo = new PrismaAdminSessionRepository(prisma);
// Unified, port-based MfaService (mfa-consolidation) — mirrors the composition
// root wiring in setupServices.ts. `authServiceCore.login` calls the unified
// subject-typed `verifyMfaToken` signature, so this file's AuthService must be
// built with the SAME service production actually resolves via DI, not the
// retired legacy `auth/mfaService.ts` (which took a bare userId string and
// silently broke this file — bivariance let the mismatched type through).
const mfaService = new MfaService(
  new PrismaAdminMfaUserRepository(prisma),
  new PrismaCustomerMfaUserRepository(prisma),
  new PrismaAuditLogRepository(prisma)
);
const authService = new AuthService(
  prisma,
  adminUserRepo,
  mfaService,
  roleRepo,
  sessionRepo,
  new PrismaAuditLogRepository(prisma)
);
import { authenticator } from "otplib";

/** Build the ADMIN subject the unified MfaService expects for a given user id. */
function adminSubject(id: string): MfaSubject {
  return { type: MFA_SUBJECT_TYPE.ADMIN, id };
}

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
      const result = await mfaService.getMfaStatus(adminSubject(testUserId));

      assert.ok(result.ok, "Get MFA status should succeed");
      assert.equal(result.value.enabled, false, "MFA should be disabled");
      assert.equal(result.value.backupCodesCount, 0, "Should have no backup codes");
    });

    it("should return error for non-existent user", async () => {
      const fakeUserId = "00000000-0000-0000-0000-000000000000";
      const result = await mfaService.getMfaStatus(adminSubject(fakeUserId));

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
      const result = await mfaService.setupMfa(adminSubject(testUserId));

      assert.ok(result.ok, "MFA setup should succeed");
      assert.ok(result.value.secret, "Should return secret");
      assert.ok(result.value.qrCodeUrl.includes("data:image/png;base64"), "Should return QR code");
      assert.ok(result.value.manualEntryKey, "Should return manual entry key");
      assert.equal(result.value.backupCodes.length, 8, "Should return 8 backup codes");
    });

    it("should prevent duplicate MFA setup", async () => {
      // First setup
      const result1 = await mfaService.setupMfa(adminSubject(testUserId));
      assert.ok(result1.ok, "First setup should succeed");

      const token = authenticator.generate(result1.value.secret);

      // Verify setup
      const verifyResult = await mfaService.verifyMfaSetup(adminSubject(testUserId), token);
      assert.ok(verifyResult.ok, "MFA verification should succeed");

      // Try setup again
      const result2 = await mfaService.setupMfa(adminSubject(testUserId));
      assert.ok(!result2.ok, "Duplicate setup should fail");
      assert.equal(result2.error, "MFA_ALREADY_ENABLED");
    });
  });

  describe("MFA Setup Verification", () => {
    let testUserId: string;
    let testEmail: string;
    let testSecret: string;

    let testSetupBackupCodesCount: number;

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

      const setupResult = await mfaService.setupMfa(adminSubject(testUserId));
      assert.ok(setupResult.ok);
      testSecret = setupResult.value.secret;
      testSetupBackupCodesCount = setupResult.value.backupCodes.length;
    });

    afterEach(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should verify MFA setup with valid TOTP token", async () => {
      // Unified-service behavior (spec, not the legacy quirk): backup codes
      // are issued exactly once at setup and are NEVER re-derived/re-issued
      // at verify-setup — the setup step already returned 8 above.
      assert.equal(testSetupBackupCodesCount, 8, "setup should have issued 8 backup codes");

      const token = authenticator.generate(testSecret);

      const result = await mfaService.verifyMfaSetup(adminSubject(testUserId), token);

      assert.ok(result.ok, "MFA verification should succeed");
      assert.equal(
        result.value.backupCodes.length,
        0,
        "verify-setup must not re-issue backup codes — they were returned once at setup"
      );
    });

    it("should reject MFA setup with invalid token", async () => {
      const result = await mfaService.verifyMfaSetup(adminSubject(testUserId), "000000");

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

      const setupResult = await mfaService.setupMfa(adminSubject(testUserId));
      assert.ok(setupResult.ok);
      testSecret = setupResult.value.secret;

      // Verify setup to enable MFA
      const token = authenticator.generate(testSecret);
      const verifyResult = await mfaService.verifyMfaSetup(adminSubject(testUserId), token);
      assert.ok(verifyResult.ok);
    });

    after(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should verify valid TOTP token", async () => {
      const token = authenticator.generate(testSecret);

      const result = await mfaService.verifyMfaToken(adminSubject(testUserId), token);

      assert.ok(result.ok, "Valid token should verify successfully");
      assert.equal(result.value.verified, true);
      assert.equal(result.value.usedBackupCode, false);
    });

    it("should reject invalid TOTP token", async () => {
      const result = await mfaService.verifyMfaToken(adminSubject(testUserId), "000000");

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

      const result = await mfaService.verifyMfaToken(adminSubject(userId), "000000");

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

      const setupResult = await mfaService.setupMfa(adminSubject(testUserId));
      assert.ok(setupResult.ok);
      testSecret = setupResult.value.secret;

      // Verify setup to enable MFA
      const token = authenticator.generate(testSecret);
      const verifyResult = await mfaService.verifyMfaSetup(adminSubject(testUserId), token);
      assert.ok(verifyResult.ok);
    });

    after(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should regenerate backup codes", async () => {
      const token = authenticator.generate(testSecret);

      const result = await mfaService.regenerateBackupCodes(adminSubject(testUserId), token);

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

      const backupResult = await mfaService.regenerateBackupCodes(adminSubject(testUserId), token);
      assert.ok(backupResult.ok);
      const backupCode = backupResult.value[0];

      // Use backup code
      const result = await mfaService.verifyMfaToken(
        adminSubject(testUserId),
        backupCode as string
      );

      assert.ok(result.ok, "Backup code should verify successfully");
      assert.equal(result.value.verified, true);
      assert.equal(result.value.usedBackupCode, true);
    });

    it("should prevent backup code reuse", async () => {
      // Get fresh backup codes
      const token = authenticator.generate(testSecret);

      const backupResult = await mfaService.regenerateBackupCodes(adminSubject(testUserId), token);
      assert.ok(backupResult.ok);
      const backupCode = backupResult.value[0] as string;

      // Use backup code first time
      const result1 = await mfaService.verifyMfaToken(adminSubject(testUserId), backupCode);
      assert.ok(result1.ok, "First use should succeed");

      // Try to use same backup code again
      const result2 = await mfaService.verifyMfaToken(adminSubject(testUserId), backupCode);
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
      const setupResult = await mfaService.setupMfa(adminSubject(testUserId));
      assert.ok(setupResult.ok);
      testSecret = setupResult.value.secret;

      const token = authenticator.generate(testSecret);
      const verifyResult = await mfaService.verifyMfaSetup(adminSubject(testUserId), token);
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

      const backupResult = await mfaService.regenerateBackupCodes(adminSubject(testUserId), token);
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
      const setupResult = await mfaService.setupMfa(adminSubject(testUserId));
      assert.ok(setupResult.ok);
      testSecret = setupResult.value.secret;

      const token = authenticator.generate(testSecret);
      const verifyResult = await mfaService.verifyMfaSetup(adminSubject(testUserId), token);
      assert.ok(verifyResult.ok);
    });

    afterEach(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should disable MFA successfully", async () => {
      const token = authenticator.generate(testSecret);

      const result = await mfaService.disableMfa(adminSubject(testUserId), token);

      assert.ok(result.ok, "MFA disable should succeed");

      // Verify MFA is disabled
      const statusResult = await mfaService.getMfaStatus(adminSubject(testUserId));
      assert.ok(statusResult.ok);
      assert.equal(statusResult.value.enabled, false, "MFA should be disabled");
      assert.equal(statusResult.value.backupCodesCount, 0, "Should have no backup codes");
    });

    it("should allow normal login after MFA disabled", async () => {
      const token = authenticator.generate(testSecret);

      // Disable MFA
      const disableResult = await mfaService.disableMfa(adminSubject(testUserId), token);
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
      const result = await mfaService.disableMfa(adminSubject(testUserId), "000000");

      assert.ok(!result.ok, "Disable with invalid token should fail");
    });
  });

  describe("MFA Error Handling", () => {
    it("should handle non-existent user gracefully", async () => {
      const fakeUserId = "00000000-0000-0000-0000-000000000000";

      const statusResult = await mfaService.getMfaStatus(adminSubject(fakeUserId));
      assert.ok(!statusResult.ok);
      assert.equal(statusResult.error, "USER_NOT_FOUND");

      const setupResult = await mfaService.setupMfa(adminSubject(fakeUserId));
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

      const setupResult = await mfaService.setupMfa(adminSubject(userId));
      assert.ok(setupResult.ok);

      // Try to verify with invalid token format
      const verifyResult = await mfaService.verifyMfaSetup(adminSubject(userId), "invalid");
      assert.ok(!verifyResult.ok, "Invalid token format should be rejected");

      await prisma.adminUser.delete({ where: { id: userId } }).catch(() => {});
    });
  });
});
