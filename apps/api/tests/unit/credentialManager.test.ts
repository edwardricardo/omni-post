/**
 * @file credentialManager.test.ts
 * @description Unit tests for CredentialManager — credential encryption, hashing,
 *              and API key management logic with fully mocked Prisma and Redis.
 *
 * Tests cover:
 * - API key hashing with SHA-256
 * - Data encryption with AES-256-GCM
 * - Data decryption
 * - Hash consistency
 * - Encryption uniqueness
 * - Tamper detection (auth tag validation)
 * - Edge cases (empty strings, long strings, unicode)
 * - API key generation, validation, deactivation, listing (mocked DB)
 * - Max active keys enforcement
 * - Audit log creation for key operations
 *
 * @layer infrastructure
 */

import { describe, it, beforeAll, beforeEach, expect, vi } from "vitest";
import crypto from "crypto";

// ========================================
// HOISTED MOCKS — inline store + model mock creation
// ========================================

/**
 * vi.hoisted callback receives no arguments but `vi` is available as a global
 * inside the hoisted scope (vitest injects it). We use vi.fn() directly.
 */
const { mockPrismaClient, stores, mockRedisInstance } = vi.hoisted(() => {
  const { randomUUID } = require("crypto") as typeof import("crypto");

  // Minimal in-memory store
  type Rec = Record<string, unknown>;

  function createStore() {
    const data = new Map<string, Rec>();
    return {
      data,
      add(record: Rec): Rec {
        const id = (record.id as string) || randomUUID();
        const full = { ...record, id };
        data.set(id, full);
        return full;
      },
      get(id: string) {
        return data.get(id);
      },
      update(id: string, partial: Rec) {
        const existing = data.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...partial };
        data.set(id, updated);
        return updated;
      },
      clear() {
        data.clear();
      },
      all(): Rec[] {
        return [...data.values()];
      },
    };
  }

  type Store = ReturnType<typeof createStore>;

  function buildModelMock(store: Store) {
    return {
      create: vi.fn(async ({ data }: { data: Rec }) => {
        const now = new Date();
        const record: Rec = { id: randomUUID(), createdAt: now, updatedAt: now, ...data };
        return store.add(record);
      }),
      findUnique: vi.fn(async ({ where }: { where: Rec }) => {
        return store.all().find((e) => Object.entries(where).every(([k, v]) => e[k] === v)) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: { where: Rec }) => {
        return store.all().find((e) => Object.entries(where).every(([k, v]) => e[k] === v)) ?? null;
      }),
      findMany: vi.fn(async (args?: { where?: Rec; select?: Rec; orderBy?: Rec }) => {
        let results = store.all();
        if (args?.where) {
          results = results.filter((e) =>
            Object.entries(args.where!).every(([k, v]) => e[k] === v)
          );
        }
        // Handle select: only return specified fields
        if (args?.select) {
          const selectedFields = Object.keys(args.select).filter((k) => args.select![k] === true);
          results = results.map((e) => {
            const picked: Rec = {};
            for (const field of selectedFields) {
              if (field in e) {
                picked[field] = e[field];
              }
            }
            return picked;
          });
        }
        return results;
      }),
      update: vi.fn(async ({ where, data }: { where: Rec; data: Rec }) => {
        const id = where.id as string;
        return store.update(id, { ...data, updatedAt: new Date() });
      }),
      delete: vi.fn(async ({ where }: { where: Rec }) => {
        const id = where.id as string;
        const record = store.data.get(id);
        store.data.delete(id);
        return record ?? null;
      }),
      deleteMany: vi.fn(async () => {
        const count = store.data.size;
        store.clear();
        return { count };
      }),
      count: vi.fn(async (args?: { where?: Rec }) => {
        if (!args?.where) return store.data.size;
        return store.all().filter((e) => Object.entries(args.where!).every(([k, v]) => e[k] === v))
          .length;
      }),
    };
  }

  const apiKeyStore = createStore();
  const auditLogStore = createStore();
  const accountStore = createStore();

  const prismaClient = {
    apiKey: buildModelMock(apiKeyStore),
    auditLog: buildModelMock(auditLogStore),
    account: buildModelMock(accountStore),
    $connect: vi.fn(async () => undefined),
    $disconnect: vi.fn(async () => undefined),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaClient)),
  };

  const redisInstance = {
    hgetall: vi.fn().mockResolvedValue({}),
    hmset: vi.fn().mockResolvedValue("OK"),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue("OK"),
  };

  return {
    mockPrismaClient: prismaClient,
    stores: { apiKey: apiKeyStore, auditLog: auditLogStore, account: accountStore },
    mockRedisInstance: redisInstance,
  };
});

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrismaClient };
});

vi.mock("ioredis", () => ({
  default: vi.fn(() => mockRedisInstance),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ========================================
// IMPORT AFTER MOCKS
// ========================================

import { CredentialManager } from "../../src/security/credentialManager.js";

// ========================================
// TEST SETUP
// ========================================

let credentialManager: CredentialManager;
const testAccountId = "test-account-id-001";
const testSecretKey = crypto.randomBytes(32);

describe("CredentialManager", () => {
  beforeAll(() => {
    credentialManager = new CredentialManager(
      mockPrismaClient as unknown as import("@infra/prisma").PrismaClient,
      mockRedisInstance as unknown as import("ioredis").default,
      {
        secretKey: testSecretKey as unknown as string,
        rotationIntervalDays: 90,
        maxActiveKeys: 10,
        enableAutoRotation: false,
      }
    );
  });

  beforeEach(() => {
    // Clear all stores between tests
    stores.apiKey.clear();
    stores.auditLog.clear();
    stores.account.clear();

    // Reset mock call history but preserve implementations
    vi.clearAllMocks();

    // Re-set defaults after clearAllMocks
    mockRedisInstance.hgetall.mockResolvedValue({});
    mockRedisInstance.hmset.mockResolvedValue("OK");
    mockRedisInstance.expire.mockResolvedValue(1);
    mockRedisInstance.del.mockResolvedValue(1);
  });

  // ========================================
  // TESTS: hashApiKey
  // ========================================

  describe("hashApiKey() - SHA-256 Hashing", () => {
    it("should produce consistent hash for same input", () => {
      const apiKey = "sk_test_abc123";

      const hash1 = credentialManager.hashApiKey(apiKey);
      const hash2 = credentialManager.hashApiKey(apiKey);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hash for different inputs", () => {
      const apiKey1 = "sk_test_abc123";
      const apiKey2 = "sk_test_xyz789";

      const hash1 = credentialManager.hashApiKey(apiKey1);
      const hash2 = credentialManager.hashApiKey(apiKey2);

      expect(hash1).not.toBe(hash2);
    });

    it("should produce 64-character hex hash (SHA-256)", () => {
      const apiKey = "sk_test_abc123";

      const hash = credentialManager.hashApiKey(apiKey);

      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should produce valid hash for empty string", () => {
      const apiKey = "";

      const hash = credentialManager.hashApiKey(apiKey);

      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should handle long API keys", () => {
      const apiKey = "sk_" + "a".repeat(1000);

      const hash = credentialManager.hashApiKey(apiKey);

      expect(hash.length).toBe(64);
    });

    it("should handle special characters", () => {
      const apiKey = "sk_test_!@#$%^&*()_+-=[]{}|;':\",./<>?`~";

      const hash = credentialManager.hashApiKey(apiKey);

      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should produce hex output only", () => {
      const apiKey = "sk_test_123";

      const hash = credentialManager.hashApiKey(apiKey);

      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });

  // ========================================
  // TESTS: encrypt / decrypt
  // ========================================

  describe("encrypt() - AES-256-GCM Encryption", () => {
    it("should produce encrypted data with iv and tag", () => {
      const plaintext = "sensitive-api-token-12345";

      const encrypted = credentialManager.encrypt(plaintext);

      expect(encrypted.encrypted).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.tag).toBeTruthy();
      expect(encrypted.encrypted.length > 0).toBeTruthy();
    });

    it("should produce data different from plaintext", () => {
      const plaintext = "my-secret-data";

      const encrypted = credentialManager.encrypt(plaintext);

      expect(encrypted.encrypted).not.toBe(plaintext);
      expect(encrypted.encrypted.includes(plaintext)).toBeFalsy();
    });

    it("should use different iv for each encryption (non-deterministic)", () => {
      const plaintext = "same-data";

      const encrypted1 = credentialManager.encrypt(plaintext);
      const encrypted2 = credentialManager.encrypt(plaintext);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
    });

    it("should produce a 16-byte (128-bit) auth tag (explicit authTagLength)", () => {
      const encrypted = credentialManager.encrypt("any-plaintext");
      // tag is hex-encoded — 16 bytes = 32 hex chars
      expect(encrypted.tag.length).toBe(32);
    });

    it("should handle empty string", () => {
      const plaintext = "";

      const encrypted = credentialManager.encrypt(plaintext);

      expect(encrypted.encrypted !== undefined).toBeTruthy();
      expect(encrypted.iv.length > 0).toBeTruthy();
      expect(encrypted.tag.length > 0).toBeTruthy();
    });

    it("should handle long strings", () => {
      const plaintext = "a".repeat(10000);

      const encrypted = credentialManager.encrypt(plaintext);

      expect(encrypted.encrypted.length > 0).toBeTruthy();
      expect(encrypted.iv.length > 0).toBeTruthy();
    });

    it("should produce 32 hex character IV (16 bytes)", () => {
      const plaintext = "test";

      const encrypted = credentialManager.encrypt(plaintext);

      expect(encrypted.iv.length).toBe(32);
      expect(encrypted.iv).toMatch(/^[0-9a-f]{32}$/);
    });

    it("should produce 32 hex character auth tag (16 bytes)", () => {
      const plaintext = "test";

      const encrypted = credentialManager.encrypt(plaintext);

      expect(encrypted.tag).toMatch(/^[0-9a-f]+$/);
      expect(encrypted.tag.length).toBe(32);
    });
  });

  describe("decrypt() - AES-256-GCM Decryption", () => {
    it("should correctly decrypt encrypted data", () => {
      const plaintext = "my-secret-token-xyz";

      const encrypted = credentialManager.encrypt(plaintext);
      const decrypted = credentialManager.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle empty string encryption/decryption", () => {
      const plaintext = "";

      const encrypted = credentialManager.encrypt(plaintext);
      const decrypted = credentialManager.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle long strings correctly", () => {
      const plaintext =
        "This is a very long secret string with lots of data that needs to be encrypted and decrypted properly without any data loss or corruption.";

      const encrypted = credentialManager.encrypt(plaintext);
      const decrypted = credentialManager.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle special characters", () => {
      const plaintext = "Special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?`~\n\t";

      const encrypted = credentialManager.encrypt(plaintext);
      const decrypted = credentialManager.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle unicode characters", () => {
      const plaintext = "Unicode: 你好 🚀 emojis cafe";

      const encrypted = credentialManager.encrypt(plaintext);
      const decrypted = credentialManager.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should fail with invalid tag (tamper detection)", () => {
      const plaintext = "sensitive-data";

      const encrypted = credentialManager.encrypt(plaintext);

      // Tamper with auth tag
      const tamperedEncrypted = {
        ...encrypted,
        tag: encrypted.tag.split("").reverse().join(""),
      };

      expect(() => credentialManager.decrypt(tamperedEncrypted)).toThrow();
    });

    it("should fail with invalid iv", () => {
      const plaintext = "sensitive-data";

      const encrypted = credentialManager.encrypt(plaintext);

      // Use wrong IV
      const tamperedEncrypted = {
        ...encrypted,
        iv: "0".repeat(32),
      };

      expect(() => credentialManager.decrypt(tamperedEncrypted)).toThrow();
    });

    it("should preserve data through multiple encrypt/decrypt cycles", () => {
      let data = "original-secret";

      // Encrypt and decrypt 10 times
      for (let i = 0; i < 10; i++) {
        const encrypted = credentialManager.encrypt(data);
        data = credentialManager.decrypt(encrypted);
      }

      expect(data).toBe("original-secret");
    });
  });

  // ========================================
  // TESTS: API Key Management (mocked DB)
  // ========================================

  describe("API Key Management (mocked DB)", () => {
    it("should generate and store API key in database", async () => {
      const result = await credentialManager.generateApiKey(
        testAccountId,
        "Test API Key",
        ["read", "write"],
        1000
      );

      expect(result.apiKey).toBeTruthy();
      expect(result.keyId).toBeTruthy();
      expect(result.apiKey.startsWith("sk_")).toBeTruthy();

      // Verify the mock store has the record
      const dbKey = stores.apiKey.get(result.keyId);

      expect(dbKey).toBeTruthy();
      expect(dbKey!.accountId).toBe(testAccountId);
      expect(dbKey!.name).toBe("Test API Key");
      expect(dbKey!.permissions).toStrictEqual(["read", "write"]);
      expect(dbKey!.rateLimit).toBe(1000);
      expect(dbKey!.isActive).toBe(true);
      // No expiration set
      expect(dbKey!.expiresAt).toBeUndefined();
    });

    it("should handle optional expiration date", async () => {
      const result = await credentialManager.generateApiKey(
        testAccountId,
        "Expiring API Key",
        ["read"],
        500,
        30 // 30 days
      );

      const dbKey = stores.apiKey.get(result.keyId);

      expect(dbKey?.expiresAt).toBeTruthy();
      const expiresAt = dbKey!.expiresAt as Date;
      const expectedExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const timeDiff = Math.abs(expiresAt.getTime() - expectedExpiry.getTime());
      expect(timeDiff < 1000).toBeTruthy();
    });

    it("should validate API key from database", async () => {
      const { apiKey, keyId } = await credentialManager.generateApiKey(
        testAccountId,
        "Validation Test Key",
        ["admin"],
        2000
      );

      const validation = await credentialManager.validateApiKey(apiKey);

      expect(validation.valid).toBe(true);
      expect(validation.accountId).toBe(testAccountId);
      expect(validation.permissions).toStrictEqual(["admin"]);
      expect(validation.rateLimit).toBe(2000);
      expect(validation.keyId).toBe(keyId);
    });

    it("should reject invalid API key", async () => {
      const validation = await credentialManager.validateApiKey("sk_invalid_fake_key");

      expect(validation.valid).toBe(false);
      expect(validation.accountId).toBe(undefined);
      expect(validation.permissions).toBe(undefined);
    });

    it("should deactivate API key", async () => {
      const { keyId } = await credentialManager.generateApiKey(testAccountId, "Key to Deactivate", [
        "read",
      ]);

      await credentialManager.deactivateApiKey(keyId);

      const dbKey = stores.apiKey.get(keyId);

      expect(dbKey?.isActive).toBe(false);
    });

    it("should list API keys for account", async () => {
      // Create multiple keys
      await credentialManager.generateApiKey(testAccountId, "List Key 1", ["read"]);
      await credentialManager.generateApiKey(testAccountId, "List Key 2", ["write"]);

      const keys = await credentialManager.listApiKeys(testAccountId);

      expect(keys.length >= 2).toBeTruthy();
      const keyNames = keys.map((k: Record<string, unknown>) => k.name);
      expect(keyNames.includes("List Key 1")).toBeTruthy();
      expect(keyNames.includes("List Key 2")).toBeTruthy();

      // Verify no keyHash is exposed (listApiKeys uses select to exclude it)
      keys.forEach((key: Record<string, unknown>) => {
        expect("keyHash" in key).toBe(false);
      });
    });

    it("should enforce max active keys limit", async () => {
      const limitedManager = new CredentialManager(
        mockPrismaClient as unknown as import("@infra/prisma").PrismaClient,
        mockRedisInstance as unknown as import("ioredis").default,
        {
          secretKey: testSecretKey as unknown as string,
          rotationIntervalDays: 90,
          maxActiveKeys: 2,
          enableAutoRotation: false,
        }
      );

      // Create 2 keys (should succeed)
      await limitedManager.generateApiKey(testAccountId, "Key 1", ["read"]);
      await limitedManager.generateApiKey(testAccountId, "Key 2", ["read"]);

      // Try to create 3rd key (should fail)
      // The error is caught and re-thrown as generic "Failed to generate API key"
      await expect(limitedManager.generateApiKey(testAccountId, "Key 3", ["read"])).rejects.toThrow(
        /Failed to generate API key/
      );
    });

    it("should create audit log entries for key operations", async () => {
      const { keyId } = await credentialManager.generateApiKey(testAccountId, "Audit Test Key", [
        "read",
      ]);

      // Check for creation audit log in mock store
      const allLogs = stores.auditLog.all();
      const creationLog = allLogs.find(
        (log) => log.action === "API_KEY_CREATED" && log.resourceId === testAccountId
      );

      expect(creationLog).toBeTruthy();
      expect(creationLog!.resource).toBe("ApiKey");

      // Deactivate and check audit log
      await credentialManager.deactivateApiKey(keyId);

      const allLogsAfter = stores.auditLog.all();
      const deactivationLog = allLogsAfter.find(
        (log) => log.action === "API_KEY_DEACTIVATED" && log.resourceId === testAccountId
      );

      expect(deactivationLog).toBeTruthy();
    });
  });
});
