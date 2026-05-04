/**
 * @file channelCredentialsCrypto.ts
 * @description Shared AES-256-GCM helpers for the encrypted Channel.credentials
 *   envelope. The api app, the workers app, and the seed all need to encrypt or
 *   decrypt this envelope; centralising the contract here ensures the same
 *   format (JSON-serialised plaintext, separate iv/authTag/keyVersion columns)
 *   is honoured everywhere — drift between encryptors and decryptors is the
 *   easiest way to lose access to credentials silently.
 *
 *   Contract mirrors `apps/api/src/security/EncryptionService` for v1 keys —
 *   the EncryptionService remains the canonical version-aware service for the
 *   api process, but workers / seed scripts use this lighter helper to avoid
 *   pulling in framework dependencies.
 * @layer infrastructure
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** Persisted shape of an encrypted Channel.credentials value. */
export interface EncryptedChannelCredentialsEnvelope {
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsAuthTag: string;
  credentialsKeyVersion: number;
}

function decodeKey(keyBase64: string): Buffer {
  const buf = Buffer.from(keyBase64, "base64");
  if (buf.length !== KEY_LENGTH) {
    throw new Error(
      `PLATFORM_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (256-bit) encoded as base64`
    );
  }
  return buf;
}

/**
 * @function encryptChannelCredentials
 * @description Encrypts a plaintext credentials object for storage on a
 *   Channel row. The plaintext is JSON-serialised before encryption.
 * @param credentials - Provider-specific credentials object (any JSON-serialisable shape).
 * @param keyBase64 - Active encryption key (32 bytes, base64-encoded).
 * @param keyVersion - Active key version (defaults to 1 for steady state).
 */
export function encryptChannelCredentials(
  credentials: Record<string, unknown>,
  keyBase64: string,
  keyVersion = 1
): EncryptedChannelCredentialsEnvelope {
  const key = decodeKey(keyBase64);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    credentialsCiphertext: ciphertext.toString("base64"),
    credentialsIv: iv.toString("base64"),
    credentialsAuthTag: authTag.toString("base64"),
    credentialsKeyVersion: keyVersion,
  };
}

/**
 * @function decryptChannelCredentials
 * @description Decrypts a persisted Channel.credentials envelope back to its
 *   plaintext JSON object. Throws if the auth tag is invalid or the bytes do
 *   not parse as JSON.
 * @param envelope - Subset of a Channel row carrying the four envelope columns.
 * @param keyBase64 - Encryption key matching `envelope.credentialsKeyVersion`.
 */
export function decryptChannelCredentials(
  envelope: EncryptedChannelCredentialsEnvelope,
  keyBase64: string
): Record<string, unknown> {
  const key = decodeKey(keyBase64);
  const iv = Buffer.from(envelope.credentialsIv, "base64");
  const authTag = Buffer.from(envelope.credentialsAuthTag, "base64");
  const ciphertext = Buffer.from(envelope.credentialsCiphertext, "base64");

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Decryption failed: invalid auth tag length");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8"
    );
    return JSON.parse(plaintext) as Record<string, unknown>;
  } catch {
    throw new Error("Decryption failed: data may be tampered or key version is wrong");
  }
}
