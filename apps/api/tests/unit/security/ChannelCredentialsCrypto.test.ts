/**
 * @file ChannelCredentialsCrypto.test.ts
 * @description Verifies the JSON-envelope wrapper that converts plaintext
 *   credentials objects to/from the persisted Channel row envelope. Asserts
 *   the round-trip works, plaintext never appears in the envelope output,
 *   decryption fails loudly on tamper / wrong key, and the channel id
 *   (recordId) is bound as AAD via the underlying EncryptionService.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { ChannelCredentialsCrypto } from "../../../src/security/ChannelCredentialsCrypto.js";
import { EncryptionService } from "../../../src/security/EncryptionService.js";

const KEY = randomBytes(32).toString("base64");
const CTX = { recordId: "ch-001" } as const;

function makeCrypto(): ChannelCredentialsCrypto {
  return new ChannelCredentialsCrypto(
    new EncryptionService({ activeKeyBase64: KEY, activeKeyVersion: 1 })
  );
}

describe("ChannelCredentialsCrypto", () => {
  it("round-trips a plain credentials object", () => {
    const crypto = makeCrypto();
    const creds = { accessToken: "tok_abc", refreshToken: "ref_xyz", expiresAt: 1700000000000 };
    const envelope = crypto.encrypt(creds, CTX);
    expect(crypto.decrypt(envelope, CTX)).toEqual(creds);
  });

  it("plaintext token must NOT appear in any envelope field", () => {
    const crypto = makeCrypto();
    const envelope = crypto.encrypt(
      {
        accessToken: "SECRET_BEARER_TOKEN_XYZ_999",
        page_id: "fb_page_777",
      },
      CTX
    );
    const serialised = JSON.stringify(envelope);
    expect(serialised).not.toContain("SECRET_BEARER_TOKEN_XYZ_999");
    expect(serialised).not.toContain("fb_page_777");
  });

  it("stamps the active keyVersion on every new envelope", () => {
    const crypto = new ChannelCredentialsCrypto(
      new EncryptionService({ activeKeyBase64: KEY, activeKeyVersion: 7 })
    );
    expect(crypto.encrypt({ x: 1 }, CTX).credentialsKeyVersion).toBe(7);
  });

  it("throws when ciphertext is tampered", () => {
    const crypto = makeCrypto();
    const envelope = crypto.encrypt({ accessToken: "abc" }, CTX);
    const tampered = {
      ...envelope,
      credentialsCiphertext: randomBytes(20).toString("base64"),
    };
    expect(() => crypto.decrypt(tampered, CTX)).toThrow(/Decryption failed/);
  });

  it("throws when authTag is tampered", () => {
    const crypto = makeCrypto();
    const envelope = crypto.encrypt({ accessToken: "abc" }, CTX);
    const tampered = {
      ...envelope,
      credentialsAuthTag: randomBytes(16).toString("base64"),
    };
    expect(() => crypto.decrypt(tampered, CTX)).toThrow(/Decryption failed/);
  });

  it("throws when the keyVersion is unknown (no prior key configured)", () => {
    const crypto = makeCrypto();
    const envelope = crypto.encrypt({ accessToken: "abc" }, CTX);
    const orphan = { ...envelope, credentialsKeyVersion: 99 };
    expect(() => crypto.decrypt(orphan, CTX)).toThrow(/keyVersion 99/);
  });

  it("preserves nested objects and arrays through the round-trip", () => {
    const crypto = makeCrypto();
    const creds = {
      accessToken: "abc",
      scope: ["read", "write", "tweet.read"],
      metadata: { user_id: "777", screen_name: "test" },
    };
    expect(crypto.decrypt(crypto.encrypt(creds, CTX), CTX)).toEqual(creds);
  });

  it("throws when decrypted with a different recordId (AAD binding)", () => {
    const crypto = makeCrypto();
    const envelope = crypto.encrypt({ accessToken: "abc" }, { recordId: "ch-A" });
    expect(() => crypto.decrypt(envelope, { recordId: "ch-B" })).toThrow(/Decryption failed/);
  });
});
