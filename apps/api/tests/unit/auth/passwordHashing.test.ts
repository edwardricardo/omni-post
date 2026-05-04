/**
 * @file passwordHashing.test.ts
 * @description Verifies the centralized Argon2id helper — round-trip success,
 *   verify safety on bad input, and `needsRehash` correctly detects param drift.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import argon2 from "argon2";
import {
  ARGON2_PARAMS,
  hashPassword,
  verifyPassword,
  needsRehash,
} from "../../../src/auth/passwordHashing.js";

describe("passwordHashing", () => {
  describe("ARGON2_PARAMS", () => {
    it("uses argon2id type", () => {
      expect(ARGON2_PARAMS.type).toBe(argon2.argon2id);
    });

    it("matches RFC 9106 second-recommended config (memory-constrained)", () => {
      expect(ARGON2_PARAMS.memoryCost).toBe(65536); // 64 MiB
      expect(ARGON2_PARAMS.timeCost).toBe(3);
      expect(ARGON2_PARAMS.parallelism).toBe(4);
      expect(ARGON2_PARAMS.hashLength).toBe(32);
    });
  });

  describe("hashPassword", () => {
    it("returns an argon2id-encoded hash string", async () => {
      const hash = await hashPassword("correct-horse-battery-staple");
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it("produces different hashes for identical plaintexts (random salt)", async () => {
      const a = await hashPassword("same");
      const b = await hashPassword("same");
      expect(a).not.toBe(b);
    });

    it("encodes the canonical params in the hash header", async () => {
      const hash = await hashPassword("anything");
      // Format: $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
      expect(hash).toContain("m=65536");
      expect(hash).toContain("t=3");
      expect(hash).toContain("p=4");
    });
  });

  describe("verifyPassword", () => {
    it("returns true for the correct plaintext", async () => {
      const hash = await hashPassword("the-secret");
      expect(await verifyPassword(hash, "the-secret")).toBe(true);
    });

    it("returns false for the wrong plaintext", async () => {
      const hash = await hashPassword("the-secret");
      expect(await verifyPassword(hash, "wrong-secret")).toBe(false);
    });

    it("returns false (does not throw) on a malformed hash", async () => {
      expect(await verifyPassword("not-a-real-hash", "anything")).toBe(false);
    });

    it("returns false (does not throw) on empty hash", async () => {
      expect(await verifyPassword("", "anything")).toBe(false);
    });

    it("is case-sensitive", async () => {
      const hash = await hashPassword("Password123");
      expect(await verifyPassword(hash, "password123")).toBe(false);
      expect(await verifyPassword(hash, "Password123")).toBe(true);
    });
  });

  describe("needsRehash", () => {
    it("returns false when stored hash already uses canonical params", async () => {
      const hash = await hashPassword("anything");
      expect(needsRehash(hash)).toBe(false);
    });

    it("returns true when stored hash uses weaker params (legacy)", async () => {
      // Mimic a legacy account hashed with weaker memory cost.
      const weakHash = await argon2.hash("anything", {
        type: argon2.argon2id,
        memoryCost: 4096, // weaker
        timeCost: 3,
        parallelism: 4,
      });
      expect(needsRehash(weakHash)).toBe(true);
    });

    it("returns true when stored hash uses lower memoryCost", async () => {
      const lowMem = await argon2.hash("anything", {
        type: argon2.argon2id,
        memoryCost: 19456, // OWASP minimum, below our 65536
        timeCost: 3,
        parallelism: 4,
      });
      expect(needsRehash(lowMem)).toBe(true);
    });
  });

  describe("end-to-end flow: hash → verify → rehash detection", () => {
    it("a freshly hashed password passes verify and does not need rehashing", async () => {
      const hash = await hashPassword("user-password-123");
      expect(await verifyPassword(hash, "user-password-123")).toBe(true);
      expect(needsRehash(hash)).toBe(false);
    });

    it("a legacy hash passes verify but triggers transparent rehash", async () => {
      const legacy = await argon2.hash("legacy-pwd", {
        type: argon2.argon2id,
        memoryCost: 4096,
        timeCost: 2,
        parallelism: 1,
      });
      expect(await verifyPassword(legacy, "legacy-pwd")).toBe(true);
      expect(needsRehash(legacy)).toBe(true);

      // After rehash, the new hash uses canonical params and no longer needs rehash.
      const upgraded = await hashPassword("legacy-pwd");
      expect(needsRehash(upgraded)).toBe(false);
    });
  });
});
