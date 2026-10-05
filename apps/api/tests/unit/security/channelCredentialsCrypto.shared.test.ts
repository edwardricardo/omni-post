/**
 * @file channelCredentialsCrypto.shared.test.ts
 * @description Pins the shared `Channel.credentials` cipher the workers decrypt with
 *   (`@shared/types/channelCredentialsCrypto.js`): the channel id is bound as AAD, an
 *   envelope written without it is refused, the key is resolved through the ring by the
 *   envelope's version, an unknown version is refused loudly, and what the API's
 *   `ChannelCredentialsCrypto` writes for a channel decrypts here for the same channel —
 *   the cross-path contract that broke while each side carried its own copy of the cipher.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  CHANNEL_CREDENTIALS_FIELD_NAME,
  canonicaliseEncryptionContext,
  createEncryptionKeyRing,
  decryptChannelCredentials,
  encryptChannelCredentials,
  encryptWithContext,
  type EncryptionKeyRing,
} from "@shared/types/channelCredentialsCrypto.js";
import { ChannelCredentialsCrypto } from "../../../src/security/ChannelCredentialsCrypto.js";
import { EncryptionService } from "../../../src/security/EncryptionService.js";

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");
const CHANNEL = { channelId: "ch-shared-001" } as const;
const CREDENTIALS = { accessToken: "tok_shared", refreshToken: "ref_shared" } as const;

/** A ring holding one key, active at `version`. */
function ringWith(key: string, version = 1): EncryptionKeyRing {
  return createEncryptionKeyRing({
    activeKeyBase64: key,
    activeVersion: version,
    priorKeys: new Map(),
  });
}

/** The API's writer, built as `PrismaChannelRepository` builds it, on the test key. */
function apiCrypto(): ChannelCredentialsCrypto {
  return new ChannelCredentialsCrypto(
    new EncryptionService({ activeKeyBase64: KEY, activeKeyVersion: 1, priorKeys: new Map() })
  );
}

describe("shared Channel.credentials cipher", () => {
  describe("AAD binding", () => {
    it("decrypts an envelope for the channel id it was encrypted for", () => {
      const envelope = encryptChannelCredentials(CREDENTIALS, CHANNEL, ringWith(KEY));

      expect(decryptChannelCredentials(envelope, CHANNEL, ringWith(KEY))).toEqual(CREDENTIALS);
    });

    it("refuses an envelope decrypted for another channel id", () => {
      const envelope = encryptChannelCredentials(CREDENTIALS, CHANNEL, ringWith(KEY));

      expect(() =>
        decryptChannelCredentials(envelope, { channelId: "ch-other" }, ringWith(KEY))
      ).toThrow(/Decryption failed/);
    });

    it("refuses an envelope encrypted without the AAD", () => {
      // The shape the helper wrote before it bound the channel id: same key, no setAAD.
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY, "base64"), iv, {
        authTagLength: 16,
      });
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(CREDENTIALS), "utf8"),
        cipher.final(),
      ]);
      const unbound = {
        credentialsCiphertext: ciphertext.toString("base64"),
        credentialsIv: iv.toString("base64"),
        credentialsAuthTag: cipher.getAuthTag().toString("base64"),
        credentialsKeyVersion: 1,
      };

      expect(() => decryptChannelCredentials(unbound, CHANNEL, ringWith(KEY))).toThrow(
        /Decryption failed/
      );
    });

    it("binds the field name, the unit separator and the record id as UTF-8", () => {
      const aad = canonicaliseEncryptionContext({
        fieldName: CHANNEL_CREDENTIALS_FIELD_NAME,
        recordId: CHANNEL.channelId,
      });

      expect(aad).toEqual(Buffer.from(`Channel.credentials\x1f${CHANNEL.channelId}`, "utf8"));
    });

    it("refuses a decrypted plaintext that is not JSON without quoting it", () => {
      const value = encryptWithContext(
        "plaintext-that-is-not-json",
        { fieldName: CHANNEL_CREDENTIALS_FIELD_NAME, recordId: CHANNEL.channelId },
        ringWith(KEY)
      );
      const envelope = {
        credentialsCiphertext: value.encryptedValue,
        credentialsIv: value.iv,
        credentialsAuthTag: value.authTag,
        credentialsKeyVersion: value.keyVersion,
      };

      let message = "";
      try {
        decryptChannelCredentials(envelope, CHANNEL, ringWith(KEY));
      } catch (error: unknown) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/not valid JSON/);
      expect(message).not.toContain("plaintext-that-is-not-json");
    });
  });

  describe("key versions", () => {
    it("stamps the ring's active version on a new envelope", () => {
      const envelope = encryptChannelCredentials(CREDENTIALS, CHANNEL, ringWith(KEY, 4));

      expect(envelope.credentialsKeyVersion).toBe(4);
    });

    it("decrypts an envelope of a prior version with that version's key", () => {
      const written = encryptChannelCredentials(CREDENTIALS, CHANNEL, ringWith(KEY, 1));
      const rotated = createEncryptionKeyRing({
        activeKeyBase64: OTHER_KEY,
        activeVersion: 2,
        priorKeys: new Map([[1, KEY]]),
      });

      expect(decryptChannelCredentials(written, CHANNEL, rotated)).toEqual(CREDENTIALS);
    });

    it("refuses an unknown key version loudly instead of trying another key", () => {
      const written = encryptChannelCredentials(CREDENTIALS, CHANNEL, ringWith(KEY));
      const orphan = { ...written, credentialsKeyVersion: 7 };

      expect(() => decryptChannelCredentials(orphan, CHANNEL, ringWith(KEY))).toThrow(
        /Decryption failed: keyVersion 7 is not configured/
      );
    });
  });

  describe("key ring", () => {
    it("refuses an active or a prior key that does not decode to 32 bytes", () => {
      const shortKey = randomBytes(16).toString("base64");

      expect(() => ringWith(shortKey)).toThrow(/must be 32 bytes/);
      expect(() =>
        createEncryptionKeyRing({
          activeKeyBase64: KEY,
          activeVersion: 2,
          priorKeys: new Map([[1, shortKey]]),
        })
      ).toThrow(/PLATFORM_ENCRYPTION_KEY_V1 must be 32 bytes/);
    });

    it("ignores a prior key filed under the active version, even a malformed one", () => {
      const written = encryptChannelCredentials(CREDENTIALS, CHANNEL, ringWith(KEY));
      const shadowed = createEncryptionKeyRing({
        activeKeyBase64: KEY,
        activeVersion: 1,
        priorKeys: new Map([[1, randomBytes(16).toString("base64")]]),
      });

      expect(decryptChannelCredentials(written, CHANNEL, shadowed)).toEqual(CREDENTIALS);
    });
  });

  describe("cross-path contract with the API's writer and reader", () => {
    it("decrypts what the API's ChannelCredentialsCrypto writes for the same channel", () => {
      const written = apiCrypto().encrypt(CREDENTIALS, { recordId: CHANNEL.channelId });

      expect(decryptChannelCredentials(written, CHANNEL, ringWith(KEY))).toEqual(CREDENTIALS);
    });

    it("writes what the API's ChannelCredentialsCrypto reads for the same channel", () => {
      const written = encryptChannelCredentials(CREDENTIALS, CHANNEL, ringWith(KEY));

      expect(apiCrypto().decrypt(written, { recordId: CHANNEL.channelId })).toEqual(CREDENTIALS);
    });
  });
});
