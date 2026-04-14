/**
 * @file EncryptionService.test.ts
 * @description Unit tests for AES-256-GCM EncryptionService.
 * @layer infrastructure
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { EncryptionService } from "../../../src/security/EncryptionService.js";
import type { EncryptedValue } from "../../../src/security/EncryptionService.js";

const VALID_KEY = randomBytes(32).toString("base64");

function createService(): EncryptionService {
  process.env.PLATFORM_ENCRYPTION_KEY = VALID_KEY;
  return new EncryptionService();
}

describe("EncryptionService", () => {
  const originalEnv = process.env.PLATFORM_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PLATFORM_ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.PLATFORM_ENCRYPTION_KEY;
    }
    vi.resetModules();
  });

  describe("constructor", () => {
    it("throws when PLATFORM_ENCRYPTION_KEY is not set", () => {
      delete process.env.PLATFORM_ENCRYPTION_KEY;
      expect(() => new EncryptionService()).toThrow(
        "PLATFORM_ENCRYPTION_KEY environment variable is required"
      );
    });

    it("throws when PLATFORM_ENCRYPTION_KEY is wrong length (not 32 bytes)", () => {
      process.env.PLATFORM_ENCRYPTION_KEY = randomBytes(16).toString("base64");
      expect(() => new EncryptionService()).toThrow("must be 32 bytes");
    });

    it("initializes successfully with valid 32-byte base64 key", () => {
      const svc = createService();
      expect(svc).toBeDefined();
    });
  });

  describe("encrypt", () => {
    it("returns encryptedValue, iv, and authTag", () => {
      const svc = createService();
      const result = svc.encrypt("test-secret");
      expect(result).toHaveProperty("encryptedValue");
      expect(result).toHaveProperty("iv");
      expect(result).toHaveProperty("authTag");
    });

    it("produces different ciphertext for the same plaintext (unique IVs)", () => {
      const svc = createService();
      const a = svc.encrypt("same-value");
      const b = svc.encrypt("same-value");
      expect(a.encryptedValue).not.toBe(b.encryptedValue);
    });

    it("produces different IV on every call", () => {
      const svc = createService();
      const a = svc.encrypt("value");
      const b = svc.encrypt("value");
      expect(a.iv).not.toBe(b.iv);
    });

    it("encrypted value is base64 encoded", () => {
      const svc = createService();
      const result = svc.encrypt("hello");
      expect(() => Buffer.from(result.encryptedValue, "base64")).not.toThrow();
      expect(() => Buffer.from(result.iv, "base64")).not.toThrow();
      expect(() => Buffer.from(result.authTag, "base64")).not.toThrow();
    });

    it("encrypts empty string without throwing", () => {
      const svc = createService();
      const result = svc.encrypt("");
      expect(result.encryptedValue).toBeDefined();
    });

    it("encrypts long strings (> 1000 chars)", () => {
      const svc = createService();
      const longString = "x".repeat(5000);
      const result = svc.encrypt(longString);
      expect(result.encryptedValue.length).toBeGreaterThan(0);
    });
  });

  describe("decrypt", () => {
    it("decrypts to original plaintext", () => {
      const svc = createService();
      const plaintext = "sk_test_secret_key_12345";
      const encrypted = svc.encrypt(plaintext);
      expect(svc.decrypt(encrypted)).toBe(plaintext);
    });

    it("throws when authTag is tampered", () => {
      const svc = createService();
      const encrypted = svc.encrypt("secret");
      const tampered: EncryptedValue = {
        ...encrypted,
        authTag: randomBytes(16).toString("base64"),
      };
      expect(() => svc.decrypt(tampered)).toThrow("Decryption failed");
    });

    it("throws when encryptedValue is tampered", () => {
      const svc = createService();
      const encrypted = svc.encrypt("secret");
      const tampered: EncryptedValue = {
        ...encrypted,
        encryptedValue: randomBytes(20).toString("base64"),
      };
      expect(() => svc.decrypt(tampered)).toThrow("Decryption failed");
    });

    it("throws when iv is tampered", () => {
      const svc = createService();
      const encrypted = svc.encrypt("secret");
      const tampered: EncryptedValue = {
        ...encrypted,
        iv: randomBytes(12).toString("base64"),
      };
      expect(() => svc.decrypt(tampered)).toThrow("Decryption failed");
    });

    it("throws with wrong encryption key", () => {
      const svc = createService();
      const encrypted = svc.encrypt("secret");

      process.env.PLATFORM_ENCRYPTION_KEY = randomBytes(32).toString("base64");
      const otherSvc = new EncryptionService();

      expect(() => otherSvc.decrypt(encrypted)).toThrow("Decryption failed");
    });

    it("round-trips correctly for special characters and unicode", () => {
      const svc = createService();
      const plaintext = "clave: ñ, emoji: 🔑, kanji: 暗号化";
      expect(svc.decrypt(svc.encrypt(plaintext))).toBe(plaintext);
    });

    it("round-trips correctly for JSON strings", () => {
      const svc = createService();
      const json = JSON.stringify({ apiKey: "sk_test_123", nested: { a: 1 } });
      expect(svc.decrypt(svc.encrypt(json))).toBe(json);
    });
  });

  describe("isConfigured", () => {
    it("returns true when PLATFORM_ENCRYPTION_KEY is valid", () => {
      const svc = createService();
      expect(svc.isConfigured()).toBe(true);
    });
  });

  describe("generateKey (static)", () => {
    it("returns a 44-character base64 string (32 bytes)", () => {
      const key = EncryptionService.generateKey();
      expect(key.length).toBe(44);
      expect(Buffer.from(key, "base64").length).toBe(32);
    });

    it("returns different keys on each call", () => {
      const a = EncryptionService.generateKey();
      const b = EncryptionService.generateKey();
      expect(a).not.toBe(b);
    });
  });
});
