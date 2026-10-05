/**
 * @file channelCredentialsCrypto.ts
 * @description The AES-256-GCM cipher for the encrypted `Channel.credentials`
 *   envelope, the one the workers decrypt with. Three rules make an envelope
 *   readable by every process that holds the key:
 *   1. AAD: the context `<fieldName>\x1f<recordId>`, for this envelope
 *      `Channel.credentials\x1f<channelId>`, is authenticated with the
 *      ciphertext, so an envelope copied to another row does not decrypt.
 *   2. Key version: each envelope carries the version of the key that wrote it,
 *      and a reader resolves that version through its key ring; a version the
 *      ring does not hold is refused, never retried against another key.
 *   3. Plaintext: the credentials object as JSON, UTF-8.
 *   The module reads no env: each composition root builds the key ring from its
 *   own typed env and passes it in. `apps/api`'s `EncryptionService` and the
 *   seed (`infra/prisma/seed.ts`) still write this envelope with their own copy
 *   of the cipher, same algorithm and same AAD bytes;
 *   `apps/api/tests/unit/security/channelCredentialsCrypto.shared.test.ts` holds
 *   the API's writer and reader to this module in both directions.
 *   Node-only: served from `@shared/types/channelCredentialsCrypto.js`, never
 *   from the root barrel, and the one module of the shared kernel allowed Node
 *   crypto and `Buffer`.
 * @layer infrastructure
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
/** Joins the field name and the record id in the AAD: the ASCII unit separator. */
const CONTEXT_SEPARATOR = "\x1f";

/** Field name bound as AAD for the `Channel.credentials` envelope. */
export const CHANNEL_CREDENTIALS_FIELD_NAME = "Channel.credentials" as const;

/** Persisted shape of an encrypted `Channel.credentials` value: the row's four columns. */
export interface EncryptedChannelCredentialsEnvelope {
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsAuthTag: string;
  credentialsKeyVersion: number;
}

/**
 * What a value is encrypted for, bound as AAD. Structurally the domain's
 * `EncryptionContext` (`@core/domain/repositories/EncryptionPort.ts`) without its
 * audit-only `caller`; declared here because the shared kernel imports no domain.
 */
export interface EncryptionContext {
  readonly fieldName: string;
  readonly recordId: string;
}

/** An encrypted value at rest, base64 fields; structurally the domain's `EncryptedValue`. */
export interface EncryptedValue {
  encryptedValue: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

/** The base64 keys a composition root reads from its typed env. */
export interface EncryptionKeyRingInput {
  /** Key every new envelope is encrypted with: 32 bytes, base64-encoded. */
  readonly activeKeyBase64: string;
  /** Version stamped on every new envelope. */
  readonly activeVersion: number;
  /** Keys of earlier versions, by version, kept while envelopes they wrote are stored. */
  readonly priorKeys: ReadonlyMap<number, string>;
}

/** Decoded keys by version; build one with `createEncryptionKeyRing`. */
export interface EncryptionKeyRing {
  /** Version stamped on every envelope this ring encrypts. */
  readonly activeVersion: number;
  /** The 32-byte key of the active version. */
  readonly activeKey: Buffer;
  /** The 32-byte keys of earlier versions, by version. */
  readonly priorKeys: ReadonlyMap<number, Buffer>;
}

function decodeKey(keyBase64: string, label: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(`${label} must be ${KEY_LENGTH} bytes (256-bit) encoded as base64`);
  }
  return key;
}

/**
 * @function createEncryptionKeyRing
 * @description Decodes and length-checks every key of the ring, so a malformed key
 *   fails where the composition root builds the ring, at startup, and not on the
 *   first decrypt. A prior key under the active version is ignored: the active
 *   version always decrypts with the active key, the one new envelopes are written with.
 * @param input - The active key and version and the prior keys, base64-encoded.
 * @returns The decoded key ring.
 */
export function createEncryptionKeyRing(input: EncryptionKeyRingInput): EncryptionKeyRing {
  const priorKeys = new Map<number, Buffer>();
  for (const [version, keyBase64] of input.priorKeys) {
    if (version === input.activeVersion) continue;
    priorKeys.set(version, decodeKey(keyBase64, `PLATFORM_ENCRYPTION_KEY_V${version}`));
  }
  return {
    activeVersion: input.activeVersion,
    activeKey: decodeKey(input.activeKeyBase64, "PLATFORM_ENCRYPTION_KEY"),
    priorKeys,
  };
}

function resolveKey(ring: EncryptionKeyRing, version: number): Buffer {
  if (version === ring.activeVersion) return ring.activeKey;
  const prior = ring.priorKeys.get(version);
  if (prior === undefined) {
    throw new Error(
      `Decryption failed: keyVersion ${version} is not configured. ` +
        `Set PLATFORM_ENCRYPTION_KEY_V${version} to the key that wrote it.`
    );
  }
  return prior;
}

/**
 * @function canonicaliseEncryptionContext
 * @description The AAD bytes of a context: `<fieldName>\x1f<recordId>`, UTF-8. The same
 *   pair always yields the same bytes, and nothing else a caller attaches to its context
 *   (an audit `caller`) enters them, so renaming a caller never strands a stored envelope.
 * @param context - What the value is encrypted for.
 * @returns The bytes bound as AAD.
 */
export function canonicaliseEncryptionContext(context: EncryptionContext): Buffer {
  return Buffer.from(`${context.fieldName}${CONTEXT_SEPARATOR}${context.recordId}`, "utf8");
}

/**
 * @function encryptWithContext
 * @description Encrypts a plaintext under the ring's active key with a fresh random IV,
 *   binding the context as AAD and stamping the active version.
 * @param plaintext - The value to encrypt.
 * @param context - What the value is encrypted for; decryption must name the same.
 * @param ring - Key ring whose active key encrypts.
 * @returns The encrypted value, base64 fields and the key version.
 */
export function encryptWithContext(
  plaintext: string,
  context: EncryptionContext,
  ring: EncryptionKeyRing
): EncryptedValue {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, ring.activeKey, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(canonicaliseEncryptionContext(context));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: ring.activeVersion,
  };
}

/**
 * @function decryptWithContext
 * @description Decrypts a value with the key of its version, verifying the auth tag over
 *   the ciphertext and the context's AAD.
 * @param value - The encrypted value as stored.
 * @param context - What the value was encrypted for.
 * @param ring - Key ring holding the key of `value.keyVersion`.
 * @returns The plaintext.
 * @throws Error starting `Decryption failed` when the version is not in the ring, the auth
 *   tag is malformed, or the tag does not verify (tampered data, another key, another context).
 */
export function decryptWithContext(
  value: EncryptedValue,
  context: EncryptionContext,
  ring: EncryptionKeyRing
): string {
  const key = resolveKey(ring, value.keyVersion);
  const authTag = Buffer.from(value.authTag, "base64");
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Decryption failed: invalid auth tag length");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(value.iv, "base64"), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  decipher.setAAD(canonicaliseEncryptionContext(context));
  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.encryptedValue, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    // GCM cannot tell these causes apart: each one fails the same tag check.
    throw new Error(
      "Decryption failed: data may be tampered, or the key or the context does not match"
    );
  }
}

/** Context of the `Channel.credentials` envelope: the id of the row that stores it. */
export interface ChannelCredentialsContext {
  readonly channelId: string;
}

function channelContext(context: ChannelCredentialsContext): EncryptionContext {
  return { fieldName: CHANNEL_CREDENTIALS_FIELD_NAME, recordId: context.channelId };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCredentials(plaintext: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    // The parser's own message quotes its input, and the input is the plaintext.
    throw new Error("Decrypted channel credentials are not valid JSON");
  }
  if (!isJsonObject(parsed)) {
    throw new Error("Decrypted channel credentials are not a JSON object");
  }
  return parsed;
}

/**
 * @function encryptChannelCredentials
 * @description Encrypts a credentials object for the channel row that will store it,
 *   binding `Channel.credentials\x1f<channelId>` as AAD. The id must be the row's own:
 *   the envelope decrypts only for the id it was written for.
 * @param credentials - Provider-specific credentials, any JSON-serialisable object.
 * @param context - `{ channelId }` of the row that will store the envelope.
 * @param ring - Key ring whose active key encrypts.
 * @returns The four envelope columns, ready for `prisma.channel.{create,update}`.
 */
export function encryptChannelCredentials(
  credentials: Record<string, unknown>,
  context: ChannelCredentialsContext,
  ring: EncryptionKeyRing
): EncryptedChannelCredentialsEnvelope {
  const value = encryptWithContext(JSON.stringify(credentials), channelContext(context), ring);
  return {
    credentialsCiphertext: value.encryptedValue,
    credentialsIv: value.iv,
    credentialsAuthTag: value.authTag,
    credentialsKeyVersion: value.keyVersion,
  };
}

/**
 * @function decryptChannelCredentials
 * @description Decrypts a channel row's envelope back to its credentials object, with
 *   the row's id bound as AAD and the key resolved by `credentialsKeyVersion`.
 * @param envelope - The row's four envelope columns.
 * @param context - `{ channelId }` of the row the envelope was read from.
 * @param ring - Key ring holding the key of the envelope's version.
 * @returns The plaintext credentials object.
 * @throws Error when the envelope does not decrypt for that id and ring, or when its
 *   plaintext is not a JSON object; no message quotes the plaintext.
 */
export function decryptChannelCredentials(
  envelope: EncryptedChannelCredentialsEnvelope,
  context: ChannelCredentialsContext,
  ring: EncryptionKeyRing
): Record<string, unknown> {
  const plaintext = decryptWithContext(
    {
      encryptedValue: envelope.credentialsCiphertext,
      iv: envelope.credentialsIv,
      authTag: envelope.credentialsAuthTag,
      keyVersion: envelope.credentialsKeyVersion,
    },
    channelContext(context),
    ring
  );
  return parseCredentials(plaintext);
}
