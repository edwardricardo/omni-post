/**
 * @file EncryptionService.test.ts
 * @description Unit tests for AES-256-GCM EncryptionService with key versioning,
 *   AAD-bound EncryptionContext, and audit emission.
 * @layer infrastructure
 */
import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { EncryptionService } from "../../../src/security/EncryptionService.js";
import type { EncryptedValue, EncryptionContext } from "../../../src/security/EncryptionService.js";

const VALID_KEY = randomBytes(32).toString("base64");
const CTX: EncryptionContext = { fieldName: "Channel.credentials", recordId: "ch-1" };

function createService(): EncryptionService {
  return new EncryptionService({ activeKeyBase64: VALID_KEY, activeKeyVersion: 1 });
}

describe("EncryptionService", () => {
  describe("constructor", () => {
    it("throws when active key is empty", () => {
      expect(() => new EncryptionService({ activeKeyBase64: "" })).toThrow(
        "PLATFORM_ENCRYPTION_KEY environment variable is required"
      );
    });

    it("throws when key is wrong length (not 32 bytes)", () => {
      const shortKey = randomBytes(16).toString("base64");
      expect(() => new EncryptionService({ activeKeyBase64: shortKey })).toThrow(
        "must be 32 bytes"
      );
    });

    it("initializes successfully with valid 32-byte base64 key", () => {
      const svc = createService();
      expect(svc).toBeDefined();
      expect(svc.getActiveKeyVersion()).toBe(1);
    });

    it("rejects a prior key with wrong length", () => {
      const shortKey = randomBytes(16).toString("base64");
      const priorKeys = new Map<number, string>([[1, shortKey]]);
      expect(
        () => new EncryptionService({ activeKeyBase64: VALID_KEY, activeKeyVersion: 2, priorKeys })
      ).toThrow("must be 32 bytes");
    });
  });

  describe("encrypt", () => {
    it("returns encryptedValue, iv, authTag, and keyVersion", () => {
      const svc = createService();
      const result = svc.encrypt("test-secret", CTX);
      expect(result).toHaveProperty("encryptedValue");
      expect(result).toHaveProperty("iv");
      expect(result).toHaveProperty("authTag");
      expect(result).toHaveProperty("keyVersion");
    });

    it("stamps the active keyVersion on every new ciphertext", () => {
      const svc = new EncryptionService({ activeKeyBase64: VALID_KEY, activeKeyVersion: 7 });
      const result = svc.encrypt("x", CTX);
      expect(result.keyVersion).toBe(7);
    });

    it("produces different ciphertext for the same plaintext + same context (unique IV)", () => {
      const svc = createService();
      const a = svc.encrypt("same-value", CTX);
      const b = svc.encrypt("same-value", CTX);
      expect(a.encryptedValue).not.toBe(b.encryptedValue);
    });

    it("produces different IV on every call", () => {
      const svc = createService();
      const a = svc.encrypt("value", CTX);
      const b = svc.encrypt("value", CTX);
      expect(a.iv).not.toBe(b.iv);
    });

    it("encrypted value is base64 encoded", () => {
      const svc = createService();
      const result = svc.encrypt("hello", CTX);
      expect(() => Buffer.from(result.encryptedValue, "base64")).not.toThrow();
      expect(() => Buffer.from(result.iv, "base64")).not.toThrow();
      expect(() => Buffer.from(result.authTag, "base64")).not.toThrow();
    });

    it("encrypts empty string without throwing", () => {
      const svc = createService();
      const result = svc.encrypt("", CTX);
      expect(result.encryptedValue).toBeDefined();
    });

    it("produces a 16-byte (128-bit) auth tag", () => {
      const svc = createService();
      const result = svc.encrypt("any-plaintext", CTX);
      const tagBytes = Buffer.from(result.authTag, "base64");
      expect(tagBytes.length).toBe(16);
    });
  });

  describe("decrypt", () => {
    it("decrypts to original plaintext when context matches", () => {
      const svc = createService();
      const plaintext = "sk_test_secret_key_12345";
      const encrypted = svc.encrypt(plaintext, CTX);
      expect(svc.decrypt(encrypted, CTX)).toBe(plaintext);
    });

    it("throws when authTag is tampered", () => {
      const svc = createService();
      const encrypted = svc.encrypt("secret", CTX);
      const tampered: EncryptedValue = {
        ...encrypted,
        authTag: randomBytes(16).toString("base64"),
      };
      expect(() => svc.decrypt(tampered, CTX)).toThrow("Decryption failed");
    });

    it("throws when iv is tampered", () => {
      const svc = createService();
      const encrypted = svc.encrypt("secret", CTX);
      const tampered: EncryptedValue = {
        ...encrypted,
        iv: randomBytes(12).toString("base64"),
      };
      expect(() => svc.decrypt(tampered, CTX)).toThrow("Decryption failed");
    });

    it("throws with wrong encryption key", () => {
      const svc = createService();
      const encrypted = svc.encrypt("secret", CTX);

      const otherKey = randomBytes(32).toString("base64");
      const otherSvc = new EncryptionService({ activeKeyBase64: otherKey, activeKeyVersion: 1 });

      expect(() => otherSvc.decrypt(encrypted, CTX)).toThrow("Decryption failed");
    });

    it("throws when keyVersion is unknown (no prior key configured)", () => {
      const svc = createService();
      const orphan: EncryptedValue = {
        encryptedValue: "AAAA",
        iv: randomBytes(12).toString("base64"),
        authTag: randomBytes(16).toString("base64"),
        keyVersion: 99,
      };
      expect(() => svc.decrypt(orphan, CTX)).toThrow(/keyVersion 99 is not configured/);
    });

    it("round-trips correctly for special characters and unicode", () => {
      const svc = createService();
      const plaintext = "clave: ñ, emoji: 🔑, kanji: 暗号化";
      expect(svc.decrypt(svc.encrypt(plaintext, CTX), CTX)).toBe(plaintext);
    });
  });

  describe("AAD binding (KMS canon)", () => {
    it("decrypt with DIFFERENT fieldName fails (AAD mismatch)", () => {
      const svc = createService();
      const encrypted = svc.encrypt("secret", CTX);
      const badCtx: EncryptionContext = { fieldName: "OtherField", recordId: "ch-1" };
      expect(() => svc.decrypt(encrypted, badCtx)).toThrow("Decryption failed");
    });

    it("decrypt with DIFFERENT recordId fails (AAD mismatch)", () => {
      const svc = createService();
      const encrypted = svc.encrypt("secret", CTX);
      const badCtx: EncryptionContext = { fieldName: "Channel.credentials", recordId: "ch-2" };
      expect(() => svc.decrypt(encrypted, badCtx)).toThrow("Decryption failed");
    });

    it("ciphertext from Channel.credentials cannot be replayed as OidcConfiguration.clientSecret", () => {
      const svc = createService();
      // Attacker tries to substitute one field's ciphertext for another.
      const fromChannel = svc.encrypt("oauth-token", {
        fieldName: "Channel.credentials",
        recordId: "row-1",
      });
      expect(() =>
        svc.decrypt(fromChannel, {
          fieldName: "OidcConfiguration.clientSecret",
          recordId: "row-1",
        })
      ).toThrow("Decryption failed");
    });

    it("`caller` is NOT bound as AAD — re-grouping caller names doesn't break decryption", () => {
      const svc = createService();
      const encrypted = svc.encrypt("secret", { ...CTX, caller: "OldCaller" });
      // Refactor renamed the caller — decrypt must still succeed.
      expect(svc.decrypt(encrypted, { ...CTX, caller: "NewCaller" })).toBe("secret");
    });
  });

  describe("audit emission", () => {
    it("calls auditPort.logCredentialDecrypt with success: true on successful decrypt", async () => {
      const auditPort = { logCredentialDecrypt: vi.fn(async () => {}) };
      const svc = new EncryptionService({
        activeKeyBase64: VALID_KEY,
        activeKeyVersion: 1,
        auditPort,
      });
      const encrypted = svc.encrypt("secret", CTX);
      svc.decrypt(encrypted, { ...CTX, caller: "TestCaller" });
      // Fire-and-forget — give the microtask queue a tick.
      await new Promise((r) => setImmediate(r));
      expect(auditPort.logCredentialDecrypt).toHaveBeenCalledWith({
        fieldName: "Channel.credentials",
        recordId: "ch-1",
        caller: "TestCaller",
        success: true,
      });
    });

    it("calls auditPort.logCredentialDecrypt with success: false on AAD mismatch", async () => {
      const auditPort = { logCredentialDecrypt: vi.fn(async () => {}) };
      const svc = new EncryptionService({
        activeKeyBase64: VALID_KEY,
        activeKeyVersion: 1,
        auditPort,
      });
      const encrypted = svc.encrypt("secret", CTX);
      expect(() => svc.decrypt(encrypted, { fieldName: "Wrong", recordId: "ch-1" })).toThrow();
      await new Promise((r) => setImmediate(r));
      const call = auditPort.logCredentialDecrypt.mock.calls[0]?.[0];
      expect(call).toMatchObject({
        fieldName: "Wrong",
        recordId: "ch-1",
        success: false,
      });
      expect(call?.error).toMatch(/Decryption failed/);
    });

    it("does NOT include the plaintext anywhere in the audit event (ASVS V16.2.5)", async () => {
      const auditPort = { logCredentialDecrypt: vi.fn(async () => {}) };
      const svc = new EncryptionService({
        activeKeyBase64: VALID_KEY,
        activeKeyVersion: 1,
        auditPort,
      });
      const plaintext = "VERY_SECRET_TOKEN_xyz_12345";
      svc.decrypt(svc.encrypt(plaintext, CTX), CTX);
      await new Promise((r) => setImmediate(r));
      const call = auditPort.logCredentialDecrypt.mock.calls[0]?.[0];
      expect(JSON.stringify(call)).not.toContain(plaintext);
    });

    it("audit failure does not break decrypt (fire-and-forget)", () => {
      const auditPort = {
        logCredentialDecrypt: vi.fn(async () => {
          throw new Error("audit DB down");
        }),
      };
      const svc = new EncryptionService({
        activeKeyBase64: VALID_KEY,
        activeKeyVersion: 1,
        auditPort,
      });
      const encrypted = svc.encrypt("secret", CTX);
      // Decrypt must still return the plaintext even though audit will throw.
      expect(svc.decrypt(encrypted, CTX)).toBe("secret");
    });

    it("works with no audit port wired (back-compat)", () => {
      const svc = createService();
      const encrypted = svc.encrypt("secret", CTX);
      expect(svc.decrypt(encrypted, CTX)).toBe("secret");
    });
  });

  describe("key rotation (dual-key validity window)", () => {
    it("decrypts a v1 ciphertext after rotating to v2 active when v1 is in priorKeys", () => {
      const v1Key = randomBytes(32).toString("base64");
      const v1Svc = new EncryptionService({ activeKeyBase64: v1Key, activeKeyVersion: 1 });
      const oldCipher = v1Svc.encrypt("hello-from-v1", CTX);

      const v2Key = randomBytes(32).toString("base64");
      const v2Svc = new EncryptionService({
        activeKeyBase64: v2Key,
        activeKeyVersion: 2,
        priorKeys: new Map([[1, v1Key]]),
      });

      expect(v2Svc.decrypt(oldCipher, CTX)).toBe("hello-from-v1");
      expect(v2Svc.encrypt("hello-from-v2", CTX).keyVersion).toBe(2);
    });

    it("once a prior key is dropped, ciphertexts at that version no longer decrypt", () => {
      const v1Key = randomBytes(32).toString("base64");
      const v1Svc = new EncryptionService({ activeKeyBase64: v1Key, activeKeyVersion: 1 });
      const oldCipher = v1Svc.encrypt("orphaned", CTX);

      const v2Key = randomBytes(32).toString("base64");
      const v2Svc = new EncryptionService({
        activeKeyBase64: v2Key,
        activeKeyVersion: 2,
        priorKeys: new Map(),
      });

      expect(() => v2Svc.decrypt(oldCipher, CTX)).toThrow(/keyVersion 1 is not configured/);
    });
  });

  describe("isConfigured", () => {
    it("returns true when active key is valid", () => {
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
