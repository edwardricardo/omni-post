/**
 * @file EncryptionPort.ts
 * @description Domain port abstracting envelope encryption used by application-
 *   layer credential services. The concrete adapter (apps/api `EncryptionService`)
 *   implements AES-256-GCM with versioned keys and AAD-bound context (KMS-canon
 *   pattern); this port surfaces only the minimal call shape callers need so
 *   `@core/application` can depend on it without infrastructure coupling.
 *
 *   Both methods are SYNCHRONOUS — encryption/decryption is in-process crypto,
 *   not I/O. `decrypt` MAY throw if the auth tag mismatches (tamper detection)
 *   or the key version is unknown; callers should wrap in try/catch and map to
 *   a domain error.
 * @layer domain
 */

/**
 * The envelope of an encrypted value at rest. All fields are base64-encoded
 * strings except `keyVersion` (number).
 */
export interface EncryptedValue {
  encryptedValue: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

/**
 * Caller-supplied context bound as AAD (Additional Authenticated Data) and
 * logged on every encrypt/decrypt. MUST NOT contain sensitive data — both
 * `fieldName` and `recordId` appear in plaintext in the audit log.
 */
export interface EncryptionContext {
  /** Logical field being encrypted (e.g. `"PlatformCredential"`). */
  readonly fieldName: string;
  /** Stable identifier for the row (e.g. `"${group}:${key}"`). */
  readonly recordId: string;
  /** Optional caller hint (service or use-case name) — audit metadata only,
   *  NOT bound as AAD (so re-grouping doesn't break decryption). */
  readonly caller?: string;
}

export interface EncryptionPort {
  /**
   * Encrypt plaintext + bind `context` as AAD. Returns the on-disk envelope.
   * Throws if encryption keys are not configured.
   */
  encrypt(plaintext: string, context: EncryptionContext): EncryptedValue;

  /**
   * Decrypt an envelope; the `context` MUST match the one used for encrypt
   * (AAD enforcement). Throws on tamper / key-version-unknown.
   */
  decrypt(encrypted: EncryptedValue, context: EncryptionContext): string;
}
