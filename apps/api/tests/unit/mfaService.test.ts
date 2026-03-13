/**
 * @file mfaService.test.ts
 * @description Unit tests for MfaService — MFA setup, verification, and management.
 *              Uses InMemoryAdminUserRepository + mockPrisma (no real database).
 *
 *              The MfaService reads user state via its injected AdminUserRepositoryPort
 *              but writes via prisma.adminUser.update() directly. To keep both stores
 *              in sync, the mockPrisma.adminUser.update mock is overridden to also
 *              update the InMemoryAdminUserRepository.
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// 1. Hoisted mock setup — runs before any imports
// ---------------------------------------------------------------------------

const { mockModule, stores } = vi.hoisted(() => {
  // Use require() since vi.hoisted() callback is synchronous (no top-level await)

  const { randomUUID } = require("crypto") as typeof import("crypto");

  type StoreRecord = Record<string, unknown>;

  interface ModelStore {
    data: Map<string, StoreRecord>;
    add(record: StoreRecord): StoreRecord;
    get(id: string): StoreRecord | undefined;
    update(id: string, data: Partial<StoreRecord>): StoreRecord | undefined;
    remove(id: string): void;
    clear(): void;
    all(): StoreRecord[];
  }

  function createStore(): ModelStore {
    const data = new Map<string, StoreRecord>();
    return {
      data,
      add(record) {
        const id = (record["id"] as string) || randomUUID();
        const full = { ...record, id };
        data.set(id, full);
        return full;
      },
      get(id) {
        return data.get(id);
      },
      update(id, partial) {
        const existing = data.get(id);
        if (!existing) return undefined;
        const updated = { ...existing, ...partial };
        data.set(id, updated);
        return updated;
      },
      remove(id) {
        data.delete(id);
      },
      clear() {
        data.clear();
      },
      all() {
        return [...data.values()];
      },
    };
  }

  function buildModelMock(store: ModelStore) {
    return {
      create: vi.fn(async ({ data }: { data: StoreRecord }) => {
        const now = new Date();
        const record = { id: randomUUID(), createdAt: now, updatedAt: now, ...data };
        return store.add(record);
      }),
      findUnique: vi.fn(async ({ where }: { where: StoreRecord }) => {
        return (
          store.all().find((entry) => Object.entries(where).every(([k, v]) => entry[k] === v)) ??
          null
        );
      }),
      findFirst: vi.fn(async ({ where }: { where: StoreRecord }) => {
        return (
          store.all().find((entry) => Object.entries(where).every(([k, v]) => entry[k] === v)) ??
          null
        );
      }),
      findMany: vi.fn(async () => store.all()),
      update: vi.fn(async ({ where, data }: { where: StoreRecord; data: StoreRecord }) => {
        const id = where["id"] as string;
        const updated = store.update(id, { ...data, updatedAt: new Date() });
        return updated ?? null;
      }),
      delete: vi.fn(async ({ where }: { where: StoreRecord }) => {
        const id = where["id"] as string;
        const record = store.get(id);
        store.remove(id);
        return record ?? null;
      }),
      deleteMany: vi.fn(async () => {
        const count = store.data.size;
        store.clear();
        return { count };
      }),
    };
  }

  const adminUserStore = createStore();
  const auditLogStore = createStore();

  const prisma = {
    adminUser: buildModelMock(adminUserStore),
    auditLog: buildModelMock(auditLogStore),
    $connect: vi.fn(async () => undefined),
    $disconnect: vi.fn(async () => undefined),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  return {
    mockModule: { prisma },
    stores: { adminUser: adminUserStore, auditLog: auditLogStore },
  };
});

// Mock @infra/prisma — merge with original to preserve any re-exported enums
vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, ...mockModule };
});

// Silence logger output in tests
vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const silentLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => silentLogger,
  };
  return { logger: silentLogger, authLogger: silentLogger };
});

// ---------------------------------------------------------------------------
// 2. Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { MfaService } from "../../src/auth/mfaService.js";
import { InMemoryAdminUserRepository } from "./helpers/InMemoryAdminUserRepository.js";
import { makeAdminUser, resetFactoryCounter } from "./helpers/factories.js";
import { authenticator } from "otplib";

// ---------------------------------------------------------------------------
// 3. Shared state
// ---------------------------------------------------------------------------

const inMemoryRepo = new InMemoryAdminUserRepository();

// Override the prisma.adminUser.update mock to also sync InMemoryAdminUserRepository
const originalPrismaUpdate = mockModule.prisma.adminUser.update;
mockModule.prisma.adminUser.update.mockImplementation(
  async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    // 1) Update the prisma store
    const id = where["id"] as string;
    const updated = stores.adminUser.update(id, { ...data, updatedAt: new Date() });

    // 2) Sync the InMemoryAdminUserRepository
    if (id && data) {
      inMemoryRepo.update(id, data);
    }

    return updated ?? null;
  }
);

let testUserId: string;
let mfaSecret: string;
let backupCodes: string[];
let inactiveUserId: string;
let invalidJsonUserId: string;

const timestamp = Date.now();
const testEmail = `test-mfa-${timestamp}@example.com`;

// ---------------------------------------------------------------------------
// 4. Test suite
// ---------------------------------------------------------------------------

describe("MfaService Tests", () => {
  const mfaService = new MfaService(inMemoryRepo);

  beforeAll(() => {
    resetFactoryCounter();
    stores.adminUser.clear();
    stores.auditLog.clear();
    inMemoryRepo.clear();

    // Create the primary test user in both stores
    const testUser = makeAdminUser({
      email: testEmail,
      passwordHash: "test-hash",
      name: "Test MFA User",
      emailVerified: true,
      mfaEnabled: false,
    });
    testUserId = testUser.id;

    // Seed both stores
    inMemoryRepo.add(testUser);
    stores.adminUser.add({ ...testUser });
  });

  afterAll(() => {
    stores.adminUser.clear();
    stores.auditLog.clear();
    inMemoryRepo.clear();
  });

  describe("setupMfa", () => {
    it("should generate MFA secret and QR code", async () => {
      const setupResult = await mfaService.setupMfa(testUserId, testEmail);

      expect(setupResult.ok).toBe(true);
      expect(setupResult.ok && setupResult.value.secret).toBeTruthy();
      expect(setupResult.ok && setupResult.value.qrCodeUrl).toBeTruthy();
      expect(setupResult.ok && setupResult.value.backupCodes).toBeTruthy();
      expect(setupResult.ok && setupResult.value.backupCodes.length >= 8).toBeTruthy();

      if (setupResult.ok) {
        mfaSecret = setupResult.value.secret;
        backupCodes = setupResult.value.backupCodes;
      }
    });

    it("should reject non-existent user", async () => {
      const invalidSetupResult = await mfaService.setupMfa("invalid-user-id", "test@example.com");

      expect(invalidSetupResult.ok).toBe(false);
      expect(invalidSetupResult.ok || invalidSetupResult.error).toBe("USER_NOT_FOUND");
    });

    it("should reject inactive user", async () => {
      const inactiveUserEmail = `test-mfa-inactive-${timestamp}@example.com`;
      const inactiveUser = makeAdminUser({
        email: inactiveUserEmail,
        passwordHash: "test-hash",
        name: "Test Inactive MFA User",
        emailVerified: true,
        mfaEnabled: false,
        isActive: false,
      });

      inactiveUserId = inactiveUser.id;

      // Add to both stores
      inMemoryRepo.add(inactiveUser);
      stores.adminUser.add({ ...inactiveUser });

      const inactiveSetupResult = await mfaService.setupMfa(inactiveUser.id, inactiveUserEmail);

      expect(inactiveSetupResult.ok).toBe(false);
      expect(inactiveSetupResult.ok || inactiveSetupResult.error).toBe("USER_INACTIVE");
    });

    it("should reject when MFA already enabled", async () => {
      // Enable MFA for test user — update both stores
      stores.adminUser.update(testUserId, { mfaEnabled: true });
      inMemoryRepo.update(testUserId, { mfaEnabled: true });

      const alreadyEnabledResult = await mfaService.setupMfa(testUserId, testEmail);

      expect(alreadyEnabledResult.ok).toBe(false);
      expect(alreadyEnabledResult.ok || alreadyEnabledResult.error).toBe("MFA_ALREADY_ENABLED");

      // Disable MFA to continue other tests — update both stores
      stores.adminUser.update(testUserId, {
        mfaEnabled: false,
        mfaSecret: null,
        passwordResetToken: null,
      });
      inMemoryRepo.update(testUserId, {
        mfaEnabled: false,
        mfaSecret: null,
        passwordResetToken: null,
      });
    });
  });

  describe("getMfaStatus", () => {
    it("should return MFA disabled before verification", async () => {
      const statusBeforeResult = await mfaService.getMfaStatus(testUserId);

      expect(statusBeforeResult.ok).toBe(true);
      expect(statusBeforeResult.ok && statusBeforeResult.value.enabled).toBe(false);
    });

    it("should reject non-existent user", async () => {
      const invalidStatusResult = await mfaService.getMfaStatus("invalid-user-id");

      expect(invalidStatusResult.ok).toBe(false);
      expect(invalidStatusResult.ok || invalidStatusResult.error).toBe("USER_NOT_FOUND");
    });

    it("should handle invalid JSON gracefully", async () => {
      const invalidJsonUserEmail = `test-mfa-invalid-json-${timestamp}@example.com`;
      const invalidJsonUser = makeAdminUser({
        email: invalidJsonUserEmail,
        passwordHash: "test-hash",
        name: "Test Invalid JSON User",
        emailVerified: true,
        mfaEnabled: true,
        passwordResetToken: "invalid-json-data",
      });

      invalidJsonUserId = invalidJsonUser.id;

      // Add to both stores
      inMemoryRepo.add(invalidJsonUser);
      stores.adminUser.add({ ...invalidJsonUser });

      const invalidJsonStatusResult = await mfaService.getMfaStatus(invalidJsonUser.id);

      expect(invalidJsonStatusResult.ok).toBe(true);
      expect(invalidJsonStatusResult.ok && invalidJsonStatusResult.value.enabled).toBe(true);
      expect(invalidJsonStatusResult.ok && invalidJsonStatusResult.value.backupCodesCount).toBe(0);
    });
  });

  describe("verifyMfaSetup", () => {
    it("should verify with valid TOTP token", async () => {
      // Setup MFA first
      const setupResult = await mfaService.setupMfa(testUserId, testEmail);
      expect(setupResult.ok).toBe(true);

      if (setupResult.ok) {
        mfaSecret = setupResult.value.secret;

        // Generate a valid TOTP token
        const validToken = authenticator.generate(mfaSecret);

        const verifySetupResult = await mfaService.verifyMfaSetup(testUserId, validToken);

        expect(verifySetupResult.ok).toBe(true);
        expect(verifySetupResult.ok && verifySetupResult.value.backupCodes).toBeTruthy();
        expect(
          verifySetupResult.ok && verifySetupResult.value.backupCodes.length >= 8
        ).toBeTruthy();

        if (verifySetupResult.ok) {
          backupCodes = verifySetupResult.value.backupCodes;
        }
      }
    });

    it("should return MFA enabled after verification", async () => {
      const statusAfterResult = await mfaService.getMfaStatus(testUserId);

      expect(statusAfterResult.ok).toBe(true);
      expect(statusAfterResult.ok && statusAfterResult.value.enabled).toBe(true);
    });

    it("should reject non-existent user", async () => {
      const invalidVerifySetupResult = await mfaService.verifyMfaSetup("invalid-user-id", "123456");

      expect(invalidVerifySetupResult.ok).toBe(false);
      expect(invalidVerifySetupResult.ok || invalidVerifySetupResult.error).toBe("USER_NOT_FOUND");
    });

    it("should reject when no setup in progress", async () => {
      // Reset user — update both stores
      stores.adminUser.update(testUserId, {
        mfaEnabled: false,
        mfaSecret: null,
        passwordResetToken: null,
      });
      inMemoryRepo.update(testUserId, {
        mfaEnabled: false,
        mfaSecret: null,
        passwordResetToken: null,
      });

      const noSetupVerifyResult = await mfaService.verifyMfaSetup(testUserId, "123456");

      expect(noSetupVerifyResult.ok).toBe(false);
      expect(noSetupVerifyResult.ok || noSetupVerifyResult.error).toBe("NO_SETUP_IN_PROGRESS");
    });

    it("should handle invalid backup codes JSON during verification", async () => {
      // Reset user for fresh MFA setup — update both stores
      stores.adminUser.update(testUserId, {
        mfaEnabled: false,
        mfaSecret: mfaSecret,
        passwordResetToken: "invalid-json-data",
      });
      inMemoryRepo.update(testUserId, {
        mfaEnabled: false,
        mfaSecret: mfaSecret,
        passwordResetToken: "invalid-json-data",
      });

      const validToken2 = authenticator.generate(mfaSecret);

      const verifyWithInvalidJsonResult = await mfaService.verifyMfaSetup(testUserId, validToken2);

      expect(verifyWithInvalidJsonResult.ok).toBe(true);
      expect(
        verifyWithInvalidJsonResult.ok && verifyWithInvalidJsonResult.value.backupCodes
      ).toBeTruthy();
      expect(
        verifyWithInvalidJsonResult.ok && verifyWithInvalidJsonResult.value.backupCodes.length >= 8
      ).toBeTruthy();

      // Capture the new backup codes so the verifyMfaToken tests use valid ones
      if (verifyWithInvalidJsonResult.ok) {
        backupCodes = verifyWithInvalidJsonResult.value.backupCodes;
      }
    });
  });

  describe("verifyMfaToken", () => {
    beforeAll(async () => {
      // Ensure MFA is enabled with valid secret — update both stores
      stores.adminUser.update(testUserId, { mfaEnabled: true, mfaSecret: mfaSecret });
      inMemoryRepo.update(testUserId, { mfaEnabled: true, mfaSecret: mfaSecret });
    });

    it("should verify login with valid TOTP", async () => {
      const loginToken = authenticator.generate(mfaSecret);

      const verifyLoginResult = await mfaService.verifyMfaToken(testUserId, loginToken);

      expect(verifyLoginResult.ok).toBe(true);
      expect(verifyLoginResult.ok && verifyLoginResult.value.verified).toBe(true);
      expect(verifyLoginResult.ok && verifyLoginResult.value.usedBackupCode).toBe(false);
    });

    it("should reject invalid TOTP", async () => {
      const invalidVerifyResult = await mfaService.verifyMfaToken(testUserId, "000000");

      expect(invalidVerifyResult.ok).toBe(false);
      expect(invalidVerifyResult.ok || invalidVerifyResult.error).toBe("INVALID_TOKEN");
    });

    it("should verify with backup code", async () => {
      const backupCode = backupCodes[0];
      expect(backupCode).toBeTruthy();

      const backupVerifyResult = await mfaService.verifyMfaToken(testUserId, backupCode);

      expect(backupVerifyResult.ok).toBe(true);
      expect(backupVerifyResult.ok && backupVerifyResult.value.verified).toBe(true);
      expect(backupVerifyResult.ok && backupVerifyResult.value.usedBackupCode).toBe(true);
    });

    it("should reject used backup code", async () => {
      const usedBackupResult = await mfaService.verifyMfaToken(
        testUserId,
        backupCodes[0] as string
      );

      expect(usedBackupResult.ok).toBe(false);
      expect(usedBackupResult.ok || usedBackupResult.error).toBe("INVALID_TOKEN");
    });

    it("should reject non-existent user", async () => {
      const invalidVerifyTokenResult = await mfaService.verifyMfaToken("invalid-user-id", "123456");

      expect(invalidVerifyTokenResult.ok).toBe(false);
      expect(invalidVerifyTokenResult.ok || invalidVerifyTokenResult.error).toBe("USER_NOT_FOUND");
    });

    it("should reject when MFA not enabled", async () => {
      // Temporarily disable MFA — update both stores
      stores.adminUser.update(testUserId, { mfaEnabled: false });
      inMemoryRepo.update(testUserId, { mfaEnabled: false });

      const mfaNotEnabledResult = await mfaService.verifyMfaToken(testUserId, "123456");

      expect(mfaNotEnabledResult.ok).toBe(false);
      expect(mfaNotEnabledResult.ok || mfaNotEnabledResult.error).toBe("MFA_NOT_ENABLED");

      // Re-enable for other tests — update both stores
      stores.adminUser.update(testUserId, { mfaEnabled: true });
      inMemoryRepo.update(testUserId, { mfaEnabled: true });
    });

    it("should handle invalid backup code JSON", async () => {
      // Enable MFA with secret but invalid backup codes JSON — update both stores
      stores.adminUser.update(testUserId, {
        mfaEnabled: true,
        mfaSecret: mfaSecret,
        passwordResetToken: "invalid-json",
      });
      inMemoryRepo.update(testUserId, {
        mfaEnabled: true,
        mfaSecret: mfaSecret,
        passwordResetToken: "invalid-json",
      });

      const invalidJsonVerifyResult = await mfaService.verifyMfaToken(testUserId, "12345678");

      expect(invalidJsonVerifyResult.ok).toBe(false);
      expect(invalidJsonVerifyResult.ok || invalidJsonVerifyResult.error).toBe("INVALID_TOKEN");
    });
  });

  describe("regenerateBackupCodes", () => {
    it("should generate new backup codes", async () => {
      // Ensure MFA is enabled — update both stores
      stores.adminUser.update(testUserId, { mfaEnabled: true, mfaSecret: mfaSecret });
      inMemoryRepo.update(testUserId, { mfaEnabled: true, mfaSecret: mfaSecret });

      const regenToken = authenticator.generate(mfaSecret);

      const regenResult = await mfaService.regenerateBackupCodes(testUserId, regenToken);

      expect(regenResult.ok).toBe(true);
      expect(regenResult.ok && Array.isArray(regenResult.value)).toBeTruthy();
      expect(regenResult.ok && regenResult.value.length >= 8).toBeTruthy();
    });

    it("should reject non-existent user", async () => {
      const invalidRegenResult = await mfaService.regenerateBackupCodes(
        "invalid-user-id",
        "123456"
      );

      expect(invalidRegenResult.ok).toBe(false);
      expect(invalidRegenResult.ok || invalidRegenResult.error).toBe("USER_NOT_FOUND");
    });
  });

  describe("disableMfa", () => {
    it("should disable MFA for user", async () => {
      const disableToken = authenticator.generate(mfaSecret);

      const disableResult = await mfaService.disableMfa(testUserId, disableToken);

      expect(disableResult.ok).toBe(true);
    });

    it("should confirm MFA is disabled", async () => {
      const finalStatusResult = await mfaService.getMfaStatus(testUserId);

      expect(finalStatusResult.ok).toBe(true);
      expect(finalStatusResult.ok && finalStatusResult.value.enabled).toBe(false);
    });

    it("should reject non-existent user", async () => {
      const invalidDisableResult = await mfaService.disableMfa("invalid-user-id", "123456");

      expect(invalidDisableResult.ok).toBe(false);
      expect(invalidDisableResult.ok || invalidDisableResult.error).toBe("USER_NOT_FOUND");
    });
  });

  describe("adminForceDisable", () => {
    it("should force-disable MFA without TOTP verification", async () => {
      // First, enable MFA so we can test disabling it
      const setupResult = await mfaService.setupMfa(testUserId, testEmail);
      expect(setupResult.ok).toBe(true);

      if (setupResult.ok) {
        const validToken = authenticator.generate(setupResult.value.secret);
        const verifyResult = await mfaService.verifyMfaSetup(testUserId, validToken);
        expect(verifyResult.ok).toBe(true);

        // Capture secret for potential later use
        mfaSecret = setupResult.value.secret;
      }

      // Confirm MFA is enabled
      const statusBefore = await mfaService.getMfaStatus(testUserId);
      expect(statusBefore.ok).toBe(true);
      expect(statusBefore.ok && statusBefore.value.enabled).toBe(true);

      // Force-disable without providing a TOTP token
      const forceDisableResult = await mfaService.adminForceDisable(testUserId);

      expect(forceDisableResult.ok).toBe(true);

      // Confirm MFA is now disabled
      const statusAfter = await mfaService.getMfaStatus(testUserId);
      expect(statusAfter.ok).toBe(true);
      expect(statusAfter.ok && statusAfter.value.enabled).toBe(false);
      expect(statusAfter.ok && statusAfter.value.backupCodesCount).toBe(0);
    });

    it("should succeed even when MFA is already disabled", async () => {
      // Ensure MFA is already disabled
      const statusBefore = await mfaService.getMfaStatus(testUserId);
      expect(statusBefore.ok).toBe(true);
      expect(statusBefore.ok && statusBefore.value.enabled).toBe(false);

      // Force-disable should still succeed (idempotent)
      const forceDisableResult = await mfaService.adminForceDisable(testUserId);

      expect(forceDisableResult.ok).toBe(true);
    });

    it("should reject non-existent user", async () => {
      const invalidResult = await mfaService.adminForceDisable("invalid-user-id");

      expect(invalidResult.ok).toBe(false);
      expect(invalidResult.ok || invalidResult.error).toBe("USER_NOT_FOUND");
    });
  });
});
