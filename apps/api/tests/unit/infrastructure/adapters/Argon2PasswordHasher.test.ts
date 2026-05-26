/**
 * @file Argon2PasswordHasher.test.ts
 * @description Tests the Argon2 password-hasher adapter: hash produces an
 *              argon2id-encoded string, verify accepts the matching secret and
 *              rejects others, and needsRehash returns a boolean.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { Argon2PasswordHasher } from "../../../../src/infrastructure/adapters/Argon2PasswordHasher.js";

describe("Argon2PasswordHasher", () => {
  const hasher = new Argon2PasswordHasher();

  it("hashes a secret to an argon2id-encoded string", async () => {
    const hash = await hasher.hash("s3cr3t-value");
    assert.ok(hash.startsWith("$argon2id$"));
  });

  it("verifies the matching secret", async () => {
    const hash = await hasher.hash("s3cr3t-value");
    assert.strictEqual(await hasher.verify(hash, "s3cr3t-value"), true);
  });

  it("rejects a non-matching secret", async () => {
    const hash = await hasher.hash("s3cr3t-value");
    assert.strictEqual(await hasher.verify(hash, "wrong-value"), false);
  });

  it("returns a boolean from needsRehash", async () => {
    const hash = await hasher.hash("s3cr3t-value");
    assert.strictEqual(typeof hasher.needsRehash(hash), "boolean");
  });
});
