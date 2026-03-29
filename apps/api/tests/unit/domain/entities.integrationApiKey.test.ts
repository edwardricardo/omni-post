/**
 * @file entities.integrationApiKey.test.ts
 * @description Unit tests for IntegrationApiKey domain entity.
 * @layer domain
 */

import { describe, it, expect, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { IntegrationApiKey } from "../../../src/domain/entities/IntegrationApiKey.js";

describe("IntegrationApiKey", () => {
  const validInput = {
    accountId: "acc-001",
    keyHash: "$argon2id$v=19$m=65536,t=3,p=4$somesalt$somehash",
    keyPrefix: "zap_abcd1234",
    label: "My integration",
  };

  describe("create()", () => {
    it("creates a valid key with all fields populated (default platform ZAPIER)", () => {
      const result = IntegrationApiKey.create(validInput);

      assert.ok(result.ok, "Should succeed");
      expect(result.value.accountId).toBe("acc-001");
      expect(result.value.keyPrefix).toBe("zap_abcd1234");
      expect(result.value.keyHash).toBe(validInput.keyHash);
      expect(result.value.label).toBe("My integration");
      expect(result.value.platform).toBe("ZAPIER");
      expect(result.value.id).toBeTruthy();
      expect(result.value.createdAt).toBeInstanceOf(Date);
      expect(result.value.revokedAt).toBeNull();
      expect(result.value.lastUsedAt).toBeNull();
    });

    it("creates a key with MAKE platform", () => {
      const result = IntegrationApiKey.create({
        ...validInput,
        platform: "MAKE",
        keyPrefix: "mak_abcd1234",
      });

      assert.ok(result.ok, "Should succeed");
      expect(result.value.platform).toBe("MAKE");
      expect(result.value.keyPrefix).toBe("mak_abcd1234");
    });

    it("creates a key without label when omitted", () => {
      const { label: _label, ...inputWithoutLabel } = validInput;
      const result = IntegrationApiKey.create(inputWithoutLabel);

      assert.ok(result.ok, "Should succeed");
      expect(result.value.label).toBeNull();
    });

    it("rejects empty accountId", () => {
      const result = IntegrationApiKey.create({ ...validInput, accountId: "  " });

      assert.ok(!result.ok, "Should fail");
      expect(result.error.message).toContain("Account ID is required");
    });

    it("rejects empty keyHash", () => {
      const result = IntegrationApiKey.create({ ...validInput, keyHash: "  " });

      assert.ok(!result.ok, "Should fail");
      expect(result.error.message).toContain("Key hash is required");
    });

    it("rejects keyPrefix shorter than 8 characters", () => {
      const result = IntegrationApiKey.create({ ...validInput, keyPrefix: "zap_" });

      assert.ok(!result.ok, "Should fail");
      expect(result.error.message).toContain("at least 8 characters");
    });

    it("rejects label longer than 100 characters", () => {
      const result = IntegrationApiKey.create({ ...validInput, label: "a".repeat(101) });

      assert.ok(!result.ok, "Should fail");
      expect(result.error.message).toContain("Label cannot exceed");
    });
  });

  describe("revoke()", () => {
    it("sets revokedAt on first call", () => {
      const result = IntegrationApiKey.create(validInput);
      assert.ok(result.ok);

      const key = result.value;
      expect(key.revokedAt).toBeNull();

      key.revoke();

      expect(key.revokedAt).toBeInstanceOf(Date);
      expect(key.isRevoked).toBe(true);
    });

    it("is idempotent -- second revoke is a no-op", () => {
      const result = IntegrationApiKey.create(validInput);
      assert.ok(result.ok);

      const key = result.value;
      key.revoke();
      const firstRevokedAt = key.revokedAt;

      key.revoke();

      expect(key.revokedAt).toBe(firstRevokedAt);
    });
  });

  describe("isRevoked", () => {
    it("returns false for a non-revoked key", () => {
      const result = IntegrationApiKey.create(validInput);
      assert.ok(result.ok);

      expect(result.value.isRevoked).toBe(false);
    });

    it("returns true for a revoked key", () => {
      const result = IntegrationApiKey.create(validInput);
      assert.ok(result.ok);

      result.value.revoke();

      expect(result.value.isRevoked).toBe(true);
    });
  });

  describe("markUsed()", () => {
    it("updates lastUsedAt timestamp", () => {
      const result = IntegrationApiKey.create(validInput);
      assert.ok(result.ok);

      expect(result.value.lastUsedAt).toBeNull();

      result.value.markUsed();

      expect(result.value.lastUsedAt).toBeInstanceOf(Date);
    });
  });

  describe("toJSON()", () => {
    it("excludes keyHash from serialized output", () => {
      const result = IntegrationApiKey.create(validInput);
      assert.ok(result.ok);

      const json = result.value.toJSON();

      expect(json).toHaveProperty("id");
      expect(json).toHaveProperty("accountId");
      expect(json).toHaveProperty("keyPrefix");
      expect(json).toHaveProperty("label");
      expect(json).toHaveProperty("platform");
      expect(json).not.toHaveProperty("keyHash");
    });
  });

  describe("reconstitute()", () => {
    it("rebuilds an entity from persisted props without validation", () => {
      const props = {
        id: "key-001",
        accountId: "acc-001",
        platform: "ZAPIER" as const,
        keyHash: "hash-value",
        keyPrefix: "zap_abcd1234",
        label: "Restored",
        lastUsedAt: new Date("2025-06-01"),
        createdAt: new Date("2025-01-01"),
        revokedAt: null,
      };

      const key = IntegrationApiKey.reconstitute(props);

      expect(key.id).toBe("key-001");
      expect(key.accountId).toBe("acc-001");
      expect(key.platform).toBe("ZAPIER");
      expect(key.keyHash).toBe("hash-value");
      expect(key.label).toBe("Restored");
      expect(key.lastUsedAt).toEqual(new Date("2025-06-01"));
    });

    it("reconstitutes a MAKE key correctly", () => {
      const props = {
        id: "key-002",
        accountId: "acc-002",
        platform: "MAKE" as const,
        keyHash: "hash-value-make",
        keyPrefix: "mak_abcd1234",
        label: "Make key",
        lastUsedAt: null,
        createdAt: new Date("2025-01-01"),
        revokedAt: null,
      };

      const key = IntegrationApiKey.reconstitute(props);

      expect(key.platform).toBe("MAKE");
      expect(key.keyPrefix).toBe("mak_abcd1234");
    });
  });

  describe("PLATFORM_KEY_PREFIX", () => {
    it("maps ZAPIER to zap_ prefix", () => {
      expect(IntegrationApiKey.PLATFORM_KEY_PREFIX.ZAPIER).toBe("zap_");
    });

    it("maps MAKE to mak_ prefix", () => {
      expect(IntegrationApiKey.PLATFORM_KEY_PREFIX.MAKE).toBe("mak_");
    });
  });
});
