/**
 * @file EncryptionService.ts
 * @description AES-256-GCM encryption service for platform credentials.
 *   Uses envelope encryption — the master key (PLATFORM_ENCRYPTION_KEY)
 *   never touches the database. Each value has its own IV and auth tag.
 *
 *   Key versioning: every EncryptedValue carries a `keyVersion`. New writes
 *   are stamped with the active version (env.PLATFORM_ENCRYPTION_KEY_VERSION,
 *   default 1). Reads dispatch to the matching key — the active key when
 *   `keyVersion === activeVersion`, otherwise a prior key from
 *   PLATFORM_ENCRYPTION_KEY_V{N}. This enables a graceful rotation window:
 *   bump activeVersion + add new key → existing ciphertexts still decrypt
 *   via the prior-key map → run re-wrap script → drop prior key from env.
 *
 *   Encryption context (KMS-canon pattern): every `encrypt()` and `decrypt()`
 *   call receives a structured `EncryptionContext { fieldName, recordId }`
 *   that serves a dual purpose:
 *   1. Bound as AAD (Additional Authenticated Data) in AES-GCM —
 *      cryptographic tamper-resistance against ciphertext substitution. A
 *      ciphertext stored as `Channel.credentials/<id>` cannot be replayed
 *      as `OidcConfiguration.clientSecret/<id>` because the auth tag is
 *      computed over the canonicalised context. Mismatch → decrypt fails.
 *   2. Logged in `AuditLog` (action `CREDENTIAL_DECRYPTED`) — ASVS V16.3.2
 *      L3 compliance. Never logs the plaintext (V16.2.5).
 *
 *   The AsyncLocalStorage `decryptAuditContext` is read at audit-emit time
 *   to enrich the event with userId / ipAddress / correlationId from the
 *   originating Fastify request.
 *
 * @layer infrastructure
 */
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type {
  EncryptionPort,
  EncryptedValue as PortEncryptedValue,
  EncryptionContext as PortEncryptionContext,
} from "@core/domain/repositories/EncryptionPort.js";
import { env } from "../config/env.js";
import { getRequestAuditContext } from "./decryptAuditContext.js";

// Re-export the canonical types from the @core/domain port so existing callers
// that imported them from this file keep compiling.
export type EncryptedValue = PortEncryptedValue;
export type EncryptionContext = PortEncryptionContext;

const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Audit emission port. Kept narrow to avoid dragging the full AuditService
 * type into the security layer — any object with this method satisfies it.
 * In practice: `AuditService.logCredentialDecrypt` matches.
 */
export interface DecryptAuditPort {
  logCredentialDecrypt(event: {
    fieldName: string;
    recordId: string;
    caller?: string;
    success: boolean;
    error?: string;
  }): Promise<void>;
}

/**
 * Optional override for tests — pass an explicit key map instead of reading
 * env. Production code constructs without args and resolves from `env`.
 */
export interface EncryptionServiceOptions {
  activeKeyBase64?: string;
  activeKeyVersion?: number;
  priorKeys?: ReadonlyMap<number, string>;
  auditPort?: DecryptAuditPort;
}

function decodeKey(keyBase64: string, label: string): Buffer {
  const buf = Buffer.from(keyBase64, "base64");
  if (buf.length !== KEY_LENGTH) {
    throw new Error(`${label} must be ${KEY_LENGTH} bytes (256-bit) encoded as base64`);
  }
  return buf;
}

function readPriorKeysFromEnv(): Map<number, string> {
  const map = new Map<number, string>();
  if (env.PLATFORM_ENCRYPTION_KEY_V1) map.set(1, env.PLATFORM_ENCRYPTION_KEY_V1);
  if (env.PLATFORM_ENCRYPTION_KEY_V2) map.set(2, env.PLATFORM_ENCRYPTION_KEY_V2);
  if (env.PLATFORM_ENCRYPTION_KEY_V3) map.set(3, env.PLATFORM_ENCRYPTION_KEY_V3);
  return map;
}

/**
 * Canonical AAD serialisation. Same `(fieldName, recordId)` ALWAYS produces
 * the same bytes regardless of property insertion order. `caller` is
 * intentionally excluded — it's audit metadata, not a binding parameter
 * (otherwise refactoring caller names would invalidate stored ciphertexts).
 */
function canonicaliseContext(ctx: EncryptionContext): Buffer {
  return Buffer.from(`${ctx.fieldName}\x1f${ctx.recordId}`, "utf8");
}

/**
 * @class EncryptionService
 * @description Stateless AES-256-GCM encryption with key versioning + AAD
 *   binding + decrypt-time audit emission.
 */
export class EncryptionService implements EncryptionPort {
  private readonly activeVersion: number;
  private readonly activeKey: Buffer;
  private readonly priorKeys: Map<number, Buffer>;
  private readonly auditPort: DecryptAuditPort | undefined;

  /**
   * @param options - Optional explicit key configuration (test-only). Production
   *   code constructs without args and resolves keys from `env`.
   */
  constructor(options: EncryptionServiceOptions = {}) {
    const activeKeyBase64 = options.activeKeyBase64 ?? env.PLATFORM_ENCRYPTION_KEY;
    if (!activeKeyBase64) {
      throw new Error("PLATFORM_ENCRYPTION_KEY environment variable is required");
    }
    this.activeKey = decodeKey(activeKeyBase64, "PLATFORM_ENCRYPTION_KEY");
    this.activeVersion = options.activeKeyVersion ?? env.PLATFORM_ENCRYPTION_KEY_VERSION;

    const priorSource = options.priorKeys ?? readPriorKeysFromEnv();
    this.priorKeys = new Map();
    for (const [version, keyB64] of priorSource) {
      if (version === this.activeVersion) continue;
      this.priorKeys.set(version, decodeKey(keyB64, `PLATFORM_ENCRYPTION_KEY_V${version}`));
    }

    this.auditPort = options.auditPort;
  }

  /**
   * @method encrypt
   * @description Encrypts plaintext with AES-256-GCM using a unique random IV
   *   and the caller-supplied context bound as AAD. Stamps the result with
   *   the active keyVersion so future reads can find the correct decryption
   *   key after a rotation.
   * @param plaintext - The string to encrypt.
   * @param context - Required `{ fieldName, recordId }`. Bound as AAD; same
   *   context MUST be passed at decrypt time or auth tag verification fails.
   * @returns Encrypted value with IV, auth tag, and keyVersion.
   */
  encrypt(plaintext: string, context: EncryptionContext): EncryptedValue {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.activeKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(canonicaliseContext(context));

    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      encryptedValue: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      keyVersion: this.activeVersion,
    };
  }

  /**
   * @method decrypt
   * @description Decrypts an AES-256-GCM encrypted value. Looks up the key by
   *   `keyVersion`, validates the AAD against the caller-supplied context,
   *   and emits an audit event (success or failure) via the injected port.
   * @param encrypted - The encrypted value with IV, auth tag, and keyVersion.
   * @param context - Required `{ fieldName, recordId }`. Must match the
   *   context passed at encrypt time, otherwise auth tag verification fails
   *   loud (no silent recovery — that defeats the AAD binding).
   * @returns The original plaintext string.
   * @throws Error if keyVersion is unknown, AAD mismatches, or data is tampered.
   */
  decrypt(encrypted: EncryptedValue, context: EncryptionContext): string {
    try {
      const key = this.resolveKey(encrypted.keyVersion);

      const iv = Buffer.from(encrypted.iv, "base64");
      const authTag = Buffer.from(encrypted.authTag, "base64");
      const encryptedData = Buffer.from(encrypted.encryptedValue, "base64");

      if (authTag.length !== AUTH_TAG_LENGTH) {
        throw new Error("Decryption failed: invalid auth tag length");
      }

      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAuthTag(authTag);
      decipher.setAAD(canonicaliseContext(context));

      let plaintext: string;
      try {
        const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
        plaintext = decrypted.toString("utf8");
      } catch {
        throw new Error("Decryption failed: data may be tampered or context mismatched");
      }

      this.emitAudit(context, true);
      return plaintext;
    } catch (error: unknown) {
      this.emitAudit(context, false, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * @method getActiveKeyVersion
   * @description Exposes the active version so re-wrap scripts can identify
   *   rows that need re-encryption (those with `keyVersion < activeVersion`).
   */
  getActiveKeyVersion(): number {
    return this.activeVersion;
  }

  /**
   * @method isConfigured
   * @description Checks whether the encryption key is set and valid.
   */
  isConfigured(): boolean {
    return this.activeKey.length === KEY_LENGTH;
  }

  /**
   * @method generateKey
   * @description Generates a new 32-byte random encryption key encoded as base64.
   *   Used only during initial setup or rotation — never called in normal operation.
   */
  static generateKey(): string {
    return randomBytes(KEY_LENGTH).toString("base64");
  }

  private resolveKey(version: number): Buffer {
    if (version === this.activeVersion) return this.activeKey;
    const prior = this.priorKeys.get(version);
    if (!prior) {
      throw new Error(
        `Decryption failed: keyVersion ${version} is not configured. ` +
          `Set PLATFORM_ENCRYPTION_KEY_V${version} or run the re-wrap script.`
      );
    }
    return prior;
  }

  /**
   * Fire-and-forget audit emission — failure to log NEVER fails the decrypt.
   * Reads the request's audit context from AsyncLocalStorage when available;
   * the audit port is responsible for enriching userId/ipAddress.
   */
  private emitAudit(context: EncryptionContext, success: boolean, error?: string): void {
    if (!this.auditPort) return;
    // Touch the ALS so the port can see request-scoped fields too — port
    // reads them itself; we just ensure ALS context is alive at emit time.
    void getRequestAuditContext();
    const event = {
      fieldName: context.fieldName,
      recordId: context.recordId,
      ...(context.caller !== undefined && { caller: context.caller }),
      success,
      ...(error !== undefined && { error }),
    };
    void this.auditPort.logCredentialDecrypt(event).catch(() => {
      // Audit failures must never propagate — they're best-effort.
    });
  }
}
