/**
 * @file enhancedOAuthProvider.token-encryption.test.ts
 * @description Verifies that encryptToken / decryptToken propagate errors instead of
 *   silently falling back to plaintext. Prevents regression of the "fallback to
 *   unencrypted" CWE-256 bug surfaced in SECRETS_DATABASE_INVENTORY.md.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { setupMocks } from "./enhancedOAuthProvider.test-helpers.js";

const VALID_OAUTH_KEY = randomBytes(32).toString("hex");
process.env.OAUTH_ENCRYPTION_KEY = VALID_OAUTH_KEY;

const { EnhancedOAuthService } = await import("../../src/auth/enhancedOAuthProvider.js");

interface OAuthInternals {
  encryptToken: (
    token: string,
    context: {
      fieldName: "ProviderConnection.accessToken" | "ProviderConnection.refreshToken";
      recordId: string;
      caller?: string;
    }
  ) => string;
  decryptToken: (
    encrypted: string,
    context: {
      fieldName: "ProviderConnection.accessToken" | "ProviderConnection.refreshToken";
      recordId: string;
      caller?: string;
    }
  ) => string;
}

const TEST_CTX = {
  fieldName: "ProviderConnection.accessToken" as const,
  recordId: "conn-test-1",
};

function createService() {
  const { mockRedis, mockMetrics, mockPrisma } = setupMocks();
  return new EnhancedOAuthService(mockRedis as never, mockMetrics as never, mockPrisma as never);
}

describe("EnhancedOAuthService token encryption (no plaintext fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("encryptToken", () => {
    it("returns iv:authTag:ciphertext format on success", () => {
      const svc = createService() as unknown as OAuthInternals;
      const encrypted = svc.encryptToken("test-access-token", TEST_CTX);
      expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    });

    it("returns empty string when given empty input (early return)", () => {
      const svc = createService() as unknown as OAuthInternals;
      expect(svc.encryptToken("", TEST_CTX)).toBe("");
    });

    it("produces unique ciphertext for the same plaintext (random IV)", () => {
      const svc = createService() as unknown as OAuthInternals;
      const a = svc.encryptToken("same-token", TEST_CTX);
      const b = svc.encryptToken("same-token", TEST_CTX);
      expect(a).not.toBe(b);
    });
  });

  describe("decryptToken", () => {
    it("round-trips an encrypted token to its original plaintext", () => {
      const svc = createService() as unknown as OAuthInternals;
      const plaintext = "sk_oauth_secret_value_xyz_123";
      const encrypted = svc.encryptToken(plaintext, TEST_CTX);
      expect(svc.decryptToken(encrypted, TEST_CTX)).toBe(plaintext);
    });

    it("returns empty string when given empty input (early return)", () => {
      const svc = createService() as unknown as OAuthInternals;
      expect(svc.decryptToken("", TEST_CTX)).toBe("");
    });

    it("THROWS instead of returning the value when stored data has no ':' separator (CWE-256 fix)", () => {
      const svc = createService() as unknown as OAuthInternals;
      // Pre-fix behaviour: returned the input as-is.
      // Post-fix behaviour: throws AppError so plaintext data isn't silently consumed.
      expect(() => svc.decryptToken("plaintext-no-colons", TEST_CTX)).toThrow(
        /not encrypted|re-authentication required/i
      );
    });

    it("THROWS when format is malformed (wrong number of parts)", () => {
      const svc = createService() as unknown as OAuthInternals;
      expect(() => svc.decryptToken("only:two", TEST_CTX)).toThrow(/decrypt/i);
    });

    it("THROWS when ciphertext is tampered (auth tag mismatch)", () => {
      const svc = createService() as unknown as OAuthInternals;
      const encrypted = svc.encryptToken("valid-token", TEST_CTX);
      const parts = encrypted.split(":");
      const tamperedCipher = `${parts[0]}:${parts[1]}:${"00".repeat(20)}`;
      expect(() => svc.decryptToken(tamperedCipher, TEST_CTX)).toThrow(/decrypt/i);
    });

    it("THROWS when authTag is tampered", () => {
      const svc = createService() as unknown as OAuthInternals;
      const encrypted = svc.encryptToken("valid-token", TEST_CTX);
      const parts = encrypted.split(":");
      const tamperedTag = `${parts[0]}:${"00".repeat(16)}:${parts[2]}`;
      expect(() => svc.decryptToken(tamperedTag, TEST_CTX)).toThrow(/decrypt/i);
    });

    it("THROWS when decrypted with a different recordId (AAD binding)", () => {
      const svc = createService() as unknown as OAuthInternals;
      const encrypted = svc.encryptToken("valid-token", {
        fieldName: "ProviderConnection.accessToken",
        recordId: "conn-A",
      });
      expect(() =>
        svc.decryptToken(encrypted, {
          fieldName: "ProviderConnection.accessToken",
          recordId: "conn-B",
        })
      ).toThrow(/decrypt/i);
    });
  });
});
