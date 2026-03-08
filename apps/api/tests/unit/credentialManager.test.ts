/**
 * CredentialManager - Comprehensive Test Suite (node:test)
 *
 * This test suite validates credential encryption, hashing, and key management logic.
 *
 * Tests cover:
 * - API key hashing with SHA-256
 * - Data encryption with AES-256-GCM
 * - Data decryption
 * - Hash consistency
 * - Encryption uniqueness
 * - Tamper detection (auth tag validation)
 * - Edge cases (empty strings, long strings, unicode)
 *
 * Key Business Rules:
 * - API key hashes are SHA-256 (64 hex characters)
 * - Encryption uses AES-256-GCM with random IV per encryption
 * - IV is 16 bytes (32 hex characters)
 * - Auth tag is 16 bytes (32 hex characters)
 * - Same plaintext produces different ciphertext due to random IV
 * - Tampered auth tags cause decryption to fail
 * - Empty strings and unicode are supported
 *
 * Run with: NODE_ENV=test tsx apps/api/tests/unit/credentialManager.test.ts
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import { CredentialManager } from "../../src/security/credentialManager.js";
import { prisma } from "@infra/prisma";
import Redis from "ioredis";
import crypto from "crypto";

// ========================================
// TEST SETUP
// ========================================

let mockRedis: Redis;
let credentialManager: CredentialManager;
let testAccountId: string;
const TEST_EMAIL_PREFIX = `cred-mgr-test-${Date.now()}`;

describe("CredentialManager", () => {
  before(async () => {
    // Create mock Redis (lazy connect)
    mockRedis = new Redis({
      host: "localhost",
      port: 6379,
      lazyConnect: true,
    });

    // Create credential manager with test config
    // AES-256 requires a 32-byte key
    const testSecretKey = crypto.randomBytes(32);
    credentialManager = new CredentialManager(mockRedis, {
      secretKey: testSecretKey as any, // CredentialConfig expects string, but code needs Buffer
      rotationIntervalDays: 90,
      maxActiveKeys: 10,
      enableAutoRotation: false, // Disable auto-rotation for tests
    });

    // Create a unique test account
    const account = await prisma.account.create({
      data: {
        email: `${TEST_EMAIL_PREFIX}@example.com`,
        name: "Credential Test Account",
        subscription: "PRO",
      },
    });
    testAccountId = account.id;
  });

  after(async () => {
    // Clean up test data
    await prisma.apiKey.deleteMany({
      where: { accountId: testAccountId },
    });
    await prisma.account.deleteMany({
      where: { id: testAccountId },
    });
    await prisma.auditLog.deleteMany({
      where: { resourceId: testAccountId },
    });

    // Disconnect Redis
    await mockRedis.quit();
  });

  // ========================================
  // TESTS: hashApiKey
  // ========================================

  describe("hashApiKey() - SHA-256 Hashing", () => {
    it("should produce consistent hash for same input", () => {
      const apiKey = "sk_test_abc123";

      const hash1 = credentialManager.hashApiKey(apiKey);
      const hash2 = credentialManager.hashApiKey(apiKey);

      assert.strictEqual(hash1, hash2, "Same API key should produce identical hashes");
    });

    it("should produce different hash for different inputs", () => {
      const apiKey1 = "sk_test_abc123";
      const apiKey2 = "sk_test_xyz789";

      const hash1 = credentialManager.hashApiKey(apiKey1);
      const hash2 = credentialManager.hashApiKey(apiKey2);

      assert.notStrictEqual(hash1, hash2, "Different API keys should produce different hashes");
    });

    it("should produce 64-character hex hash (SHA-256)", () => {
      const apiKey = "sk_test_abc123";

      const hash = credentialManager.hashApiKey(apiKey);

      assert.strictEqual(
        hash.length,
        64,
        `SHA-256 hash should be 64 hex chars, got ${hash.length}`
      );
      assert.match(hash, /^[a-f0-9]{64}$/, "Hash should be valid hex string");
    });

    it("should produce valid hash for empty string", () => {
      const apiKey = "";

      const hash = credentialManager.hashApiKey(apiKey);

      assert.strictEqual(hash.length, 64, "Empty string should still produce 64-char hash");
      assert.match(hash, /^[a-f0-9]{64}$/, "Empty string hash should be valid hex");
    });

    it("should handle long API keys", () => {
      const apiKey = "sk_" + "a".repeat(1000);

      const hash = credentialManager.hashApiKey(apiKey);

      assert.strictEqual(hash.length, 64, "Long API key should produce 64-char hash");
    });

    it("should handle special characters", () => {
      const apiKey = "sk_test_!@#$%^&*()_+-=[]{}|;':\",./<>?`~";

      const hash = credentialManager.hashApiKey(apiKey);

      assert.strictEqual(hash.length, 64, "API key with special chars should produce 64-char hash");
      assert.match(hash, /^[a-f0-9]{64}$/, "Hash should be valid hex string");
    });

    it("should produce hex output only", () => {
      const apiKey = "sk_test_123";

      const hash = credentialManager.hashApiKey(apiKey);

      assert.match(hash, /^[0-9a-f]+$/, "Hash should only contain hex characters (0-9, a-f)");
    });
  });

  // ========================================
  // TESTS: encrypt / decrypt
  // ========================================

  describe("encrypt() - AES-256-GCM Encryption", () => {
    it("should produce encrypted data with iv and tag", () => {
      const plaintext = "sensitive-api-token-12345";

      const encrypted = credentialManager.encrypt(plaintext);

      assert.ok(encrypted.encrypted, "Should have encrypted field");
      assert.ok(encrypted.iv, "Should have iv field");
      assert.ok(encrypted.tag, "Should have tag field");
      assert.ok(encrypted.encrypted.length > 0, "Encrypted data should not be empty");
    });

    it("should produce data different from plaintext", () => {
      const plaintext = "my-secret-data";

      const encrypted = credentialManager.encrypt(plaintext);

      assert.notStrictEqual(
        encrypted.encrypted,
        plaintext,
        "Encrypted data should differ from plaintext"
      );
      assert.ok(!encrypted.encrypted.includes(plaintext), "Encrypted should not contain plaintext");
    });

    it("should use different iv for each encryption (non-deterministic)", () => {
      const plaintext = "same-data";

      const encrypted1 = credentialManager.encrypt(plaintext);
      const encrypted2 = credentialManager.encrypt(plaintext);

      assert.notStrictEqual(
        encrypted1.iv,
        encrypted2.iv,
        "Different encryptions should use different IVs"
      );
      assert.notStrictEqual(
        encrypted1.encrypted,
        encrypted2.encrypted,
        "Different IVs produce different ciphertext"
      );
    });

    it("should handle empty string", () => {
      const plaintext = "";

      const encrypted = credentialManager.encrypt(plaintext);

      assert.ok(encrypted.encrypted !== undefined, "Should encrypt empty string");
      assert.ok(encrypted.iv.length > 0, "Should have valid IV");
      assert.ok(encrypted.tag.length > 0, "Should have valid auth tag");
    });

    it("should handle long strings", () => {
      const plaintext = "a".repeat(10000);

      const encrypted = credentialManager.encrypt(plaintext);

      assert.ok(encrypted.encrypted.length > 0, "Should encrypt long string");
      assert.ok(encrypted.iv.length > 0, "Should have valid IV");
    });

    it("should produce 32 hex character IV (16 bytes)", () => {
      const plaintext = "test";

      const encrypted = credentialManager.encrypt(plaintext);

      assert.strictEqual(
        encrypted.iv.length,
        32,
        `IV should be 32 hex chars (16 bytes), got ${encrypted.iv.length}`
      );
      assert.match(encrypted.iv, /^[0-9a-f]{32}$/, "IV should be valid hex");
    });

    it("should produce 32 hex character auth tag (16 bytes)", () => {
      const plaintext = "test";

      const encrypted = credentialManager.encrypt(plaintext);

      assert.match(encrypted.tag, /^[0-9a-f]+$/, "Auth tag should be valid hex");
      assert.strictEqual(
        encrypted.tag.length,
        32,
        `Tag should be 32 hex chars, got ${encrypted.tag.length}`
      );
    });
  });

  describe("decrypt() - AES-256-GCM Decryption", () => {
    it("should correctly decrypt encrypted data", () => {
      const plaintext = "my-secret-token-xyz";

      const encrypted = credentialManager.encrypt(plaintext);
      const decrypted = credentialManager.decrypt(encrypted);

      assert.strictEqual(
        decrypted,
        plaintext,
        `Decrypted should match plaintext, got '${decrypted}'`
      );
    });

    it("should handle empty string encryption/decryption", () => {
      const plaintext = "";

      const encrypted = credentialManager.encrypt(plaintext);
      const decrypted = credentialManager.decrypt(encrypted);

      assert.strictEqual(decrypted, plaintext, "Empty string should encrypt/decrypt correctly");
    });

    it("should handle long strings correctly", () => {
      const plaintext =
        "This is a very long secret string with lots of data that needs to be encrypted and decrypted properly without any data loss or corruption.";

      const encrypted = credentialManager.encrypt(plaintext);
      const decrypted = credentialManager.decrypt(encrypted);

      assert.strictEqual(
        decrypted,
        plaintext,
        "Long string should encrypt/decrypt without data loss"
      );
    });

    it("should handle special characters", () => {
      const plaintext = "Special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?`~\n\t";

      const encrypted = credentialManager.encrypt(plaintext);
      const decrypted = credentialManager.decrypt(encrypted);

      assert.strictEqual(
        decrypted,
        plaintext,
        "Special characters should survive encryption/decryption"
      );
    });

    it("should handle unicode characters", () => {
      const plaintext = "Unicode: 你好 🚀 émojis café";

      const encrypted = credentialManager.encrypt(plaintext);
      const decrypted = credentialManager.decrypt(encrypted);

      assert.strictEqual(
        decrypted,
        plaintext,
        "Unicode characters should survive encryption/decryption"
      );
    });

    it("should fail with invalid tag (tamper detection)", () => {
      const plaintext = "sensitive-data";

      const encrypted = credentialManager.encrypt(plaintext);

      // Tamper with auth tag
      const tamperedEncrypted = {
        ...encrypted,
        tag: encrypted.tag.split("").reverse().join(""), // Reverse the tag to simulate tampering
      };

      assert.throws(
        () => credentialManager.decrypt(tamperedEncrypted),
        /error/i,
        "Should throw error when auth tag is tampered"
      );
    });

    it("should fail with invalid iv", () => {
      const plaintext = "sensitive-data";

      const encrypted = credentialManager.encrypt(plaintext);

      // Use wrong IV
      const tamperedEncrypted = {
        ...encrypted,
        iv: "0".repeat(32), // Invalid IV
      };

      assert.throws(
        () => credentialManager.decrypt(tamperedEncrypted),
        /error/i,
        "Should throw error with invalid IV"
      );
    });

    it("should preserve data through multiple encrypt/decrypt cycles", () => {
      let data = "original-secret";

      // Encrypt and decrypt 10 times
      for (let i = 0; i < 10; i++) {
        const encrypted = credentialManager.encrypt(data);
        data = credentialManager.decrypt(encrypted);
      }

      assert.strictEqual(data, "original-secret", "Multiple cycles should preserve original data");
    });
  });

  // ========================================
  // TESTS: Database Integration
  // ========================================

  describe("Database Integration - API Key Management", () => {
    it("should generate and store API key in database", async () => {
      const result = await credentialManager.generateApiKey(
        testAccountId,
        "Test API Key",
        ["read", "write"],
        1000
      );

      assert.ok(result.apiKey, "Should return API key");
      assert.ok(result.keyId, "Should return key ID");
      assert.ok(result.apiKey.startsWith("sk_"), "API key should have sk_ prefix");

      // Verify in database
      const dbKey = await prisma.apiKey.findUnique({
        where: { id: result.keyId },
      });

      assert.ok(dbKey, "Key should exist in database");
      assert.strictEqual(dbKey.accountId, testAccountId);
      assert.strictEqual(dbKey.name, "Test API Key");
      assert.deepStrictEqual(dbKey.permissions, ["read", "write"]);
      assert.strictEqual(dbKey.rateLimit, 1000);
      assert.strictEqual(dbKey.isActive, true);
      // Prisma returns null for unset optional fields
      assert.strictEqual(dbKey.expiresAt, null);
    });

    it("should handle optional expiration date", async () => {
      const result = await credentialManager.generateApiKey(
        testAccountId,
        "Expiring API Key",
        ["read"],
        500,
        30 // 30 days
      );

      const dbKey = await prisma.apiKey.findUnique({
        where: { id: result.keyId },
      });

      assert.ok(dbKey?.expiresAt, "Should have expiration date");
      const expiresAt = dbKey!.expiresAt as Date;
      const expectedExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const timeDiff = Math.abs(expiresAt.getTime() - expectedExpiry.getTime());
      assert.ok(timeDiff < 1000, "Expiration should be approximately 30 days from now");
    });

    it("should validate API key from database", async () => {
      const { apiKey, keyId } = await credentialManager.generateApiKey(
        testAccountId,
        "Validation Test Key",
        ["admin"],
        2000
      );

      const validation = await credentialManager.validateApiKey(apiKey);

      assert.strictEqual(validation.valid, true, "Should validate as valid");
      assert.strictEqual(validation.accountId, testAccountId);
      assert.deepStrictEqual(validation.permissions, ["admin"]);
      assert.strictEqual(validation.rateLimit, 2000);
      assert.strictEqual(validation.keyId, keyId);
    });

    it("should reject invalid API key", async () => {
      const validation = await credentialManager.validateApiKey("sk_invalid_fake_key");

      assert.strictEqual(validation.valid, false, "Should reject invalid key");
      assert.strictEqual(validation.accountId, undefined);
      assert.strictEqual(validation.permissions, undefined);
    });

    it("should deactivate API key", async () => {
      const { keyId } = await credentialManager.generateApiKey(testAccountId, "Key to Deactivate", [
        "read",
      ]);

      await credentialManager.deactivateApiKey(keyId);

      const dbKey = await prisma.apiKey.findUnique({
        where: { id: keyId },
      });

      assert.strictEqual(dbKey?.isActive, false, "Key should be deactivated");
    });

    it("should list API keys for account", async () => {
      // Create multiple keys
      await credentialManager.generateApiKey(testAccountId, "List Key 1", ["read"]);
      await credentialManager.generateApiKey(testAccountId, "List Key 2", ["write"]);

      const keys = await credentialManager.listApiKeys(testAccountId);

      assert.ok(keys.length >= 2, "Should return at least 2 keys");
      const keyNames = keys.map((k) => k.name);
      assert.ok(keyNames.includes("List Key 1"), "Should include List Key 1");
      assert.ok(keyNames.includes("List Key 2"), "Should include List Key 2");

      // Verify no keyHash is exposed
      keys.forEach((key) => {
        assert.strictEqual("keyHash" in key, false, "keyHash should not be exposed");
      });
    });

    it("should enforce max active keys limit", async () => {
      // Create second test account for isolation
      const account2 = await prisma.account.create({
        data: {
          email: `${TEST_EMAIL_PREFIX}-limit-${Date.now()}@example.com`,
          name: "Limit Test Account",
          subscription: "BASIC",
        },
      });

      // Set up credential manager with low limit
      const lowLimitRedis = new Redis({
        host: "localhost",
        port: 6379,
        lazyConnect: true,
      });

      const testSecretKey = crypto.randomBytes(32);
      const limitedManager = new CredentialManager(lowLimitRedis, {
        secretKey: testSecretKey as any,
        rotationIntervalDays: 90,
        maxActiveKeys: 2,
        enableAutoRotation: false,
      });

      try {
        // Ensure account has no existing keys
        await prisma.apiKey.deleteMany({ where: { accountId: account2.id } });

        // Create 2 keys (should succeed)
        await limitedManager.generateApiKey(account2.id, "Key 1", ["read"]);
        await limitedManager.generateApiKey(account2.id, "Key 2", ["read"]);

        // Try to create 3rd key (should fail)
        // Note: The error is caught and re-thrown as generic "Failed to generate API key"
        await assert.rejects(
          limitedManager.generateApiKey(account2.id, "Key 3", ["read"]),
          {
            message: /Failed to generate API key/,
          },
          "Should reject when max keys reached"
        );
      } finally {
        // Cleanup
        await prisma.apiKey.deleteMany({ where: { accountId: account2.id } });
        await prisma.account.delete({ where: { id: account2.id } });
        await lowLimitRedis.quit();
      }
    });

    it("should create audit log entries for key operations", async () => {
      const { keyId } = await credentialManager.generateApiKey(testAccountId, "Audit Test Key", [
        "read",
      ]);

      // Check for creation audit log
      const creationLog = await prisma.auditLog.findFirst({
        where: {
          action: "API_KEY_CREATED",
          resourceId: testAccountId,
        },
        orderBy: { createdAt: "desc" },
      });

      assert.ok(creationLog, "Should create audit log for key creation");
      assert.strictEqual(creationLog.resource, "ApiKey");

      // Deactivate and check audit log
      await credentialManager.deactivateApiKey(keyId);

      const deactivationLog = await prisma.auditLog.findFirst({
        where: {
          action: "API_KEY_DEACTIVATED",
          resourceId: testAccountId,
        },
        orderBy: { createdAt: "desc" },
      });

      assert.ok(deactivationLog, "Should create audit log for key deactivation");
    });
  });
});
