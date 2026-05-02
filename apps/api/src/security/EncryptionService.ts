/**
 * @file EncryptionService.ts
 * @description AES-256-GCM encryption service for platform credentials.
 *   Uses envelope encryption — the master key (PLATFORM_ENCRYPTION_KEY)
 *   never touches the database. Each value has its own IV and auth tag.
 * @layer infrastructure
 */
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface EncryptedValue {
  encryptedValue: string;
  iv: string;
  authTag: string;
}

/**
 * @class EncryptionService
 * @description Stateless AES-256-GCM encryption using a master key from environment.
 *   Each encrypt call generates a unique IV. Auth tag provides tamper detection.
 */
export class EncryptionService {
  private readonly key: Buffer;

  /**
   * @param keyBase64 - Master key as base64 string. Defaults to
   *   `env.PLATFORM_ENCRYPTION_KEY` so production code constructs without
   *   args; tests pass a specific value to exercise edge cases.
   */
  constructor(keyBase64: string = env.PLATFORM_ENCRYPTION_KEY) {
    if (!keyBase64) {
      throw new Error("PLATFORM_ENCRYPTION_KEY environment variable is required");
    }

    const keyBuffer = Buffer.from(keyBase64, "base64");
    if (keyBuffer.length !== KEY_LENGTH) {
      throw new Error(
        `PLATFORM_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (256-bit) encoded as base64`
      );
    }

    this.key = keyBuffer;
  }

  /**
   * @method encrypt
   * @description Encrypts plaintext with AES-256-GCM using a unique random IV.
   * @param plaintext - The string to encrypt
   * @returns Encrypted value with IV and auth tag, all base64 encoded
   */
  encrypt(plaintext: string): EncryptedValue {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH });

    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      encryptedValue: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    };
  }

  /**
   * @method decrypt
   * @description Decrypts an AES-256-GCM encrypted value. Verifies auth tag for tamper detection.
   * @param encrypted - The encrypted value with IV and auth tag
   * @returns The original plaintext string
   * @throws Error if decryption fails (wrong key, tampered data, or invalid input)
   */
  decrypt(encrypted: EncryptedValue): string {
    const iv = Buffer.from(encrypted.iv, "base64");
    const authTag = Buffer.from(encrypted.authTag, "base64");
    const encryptedData = Buffer.from(encrypted.encryptedValue, "base64");

    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error("Decryption failed: invalid auth tag length");
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    try {
      const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
      return decrypted.toString("utf8");
    } catch {
      throw new Error("Decryption failed: data may be tampered");
    }
  }

  /**
   * @method isConfigured
   * @description Checks whether the encryption key is set and valid.
   * @returns true if PLATFORM_ENCRYPTION_KEY is present and 32 bytes
   */
  isConfigured(): boolean {
    return this.key.length === KEY_LENGTH;
  }

  /**
   * @method generateKey
   * @description Generates a new 32-byte random encryption key encoded as base64.
   *   Used only during initial setup — never called in normal operation.
   * @returns A base64-encoded 32-byte random key
   */
  static generateKey(): string {
    return randomBytes(KEY_LENGTH).toString("base64");
  }
}
