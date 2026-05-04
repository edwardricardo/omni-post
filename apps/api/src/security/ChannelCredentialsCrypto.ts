/**
 * @file ChannelCredentialsCrypto.ts
 * @description Wraps Channel.credentials JSON-blob encryption — serialises
 *   the plaintext credentials object to JSON, hands it to EncryptionService,
 *   and returns the EncryptedValue envelope ready for persistence. The
 *   inverse path takes a stored envelope and parses the decrypted JSON
 *   back into a plain object.
 *
 *   Forwards `EncryptionContext { fieldName, recordId }` to EncryptionService
 *   so the AAD binding ties the ciphertext to the channel row. Caller passes
 *   `recordId = channel.id`; this wrapper sets `fieldName = "Channel.credentials"`
 *   internally so consumers can't accidentally drift the AAD value.
 *
 * @layer infrastructure
 */
import type { EncryptionService, EncryptedValue } from "./EncryptionService.js";

/**
 * Persisted shape of an encrypted Channel.credentials value.
 * The four columns of the Channel row map 1:1 to this envelope.
 */
export interface EncryptedChannelCredentialsRow {
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsAuthTag: string;
  credentialsKeyVersion: number;
}

/**
 * Reduced caller context — only the channel id varies; fieldName is fixed
 * because this wrapper exists exclusively for `Channel.credentials`.
 */
export interface ChannelCredentialsContext {
  /** Channel primary key — bound as AAD. */
  readonly recordId: string;
  /** Optional caller hint for audit metadata. */
  readonly caller?: string;
}

const FIELD_NAME = "Channel.credentials" as const;

/**
 * @class ChannelCredentialsCrypto
 * @description Stateless adapter on top of EncryptionService — converts
 *   plaintext credentials objects to/from the persisted envelope. Uses the
 *   version-aware EncryptionService so multi-key rotation is supported.
 */
export class ChannelCredentialsCrypto {
  constructor(private readonly encryption: EncryptionService) {}

  /**
   * @method encrypt
   * @description Encrypts a plaintext credentials object for persistence.
   *   The channel id is bound as AAD via the underlying EncryptionService —
   *   the same id MUST be passed to `decrypt` or the auth tag will fail.
   * @param credentials - Any JSON-serialisable credentials shape (provider-specific).
   * @param context - `{ recordId: channel.id, caller? }`. Required.
   * @returns EncryptedChannelCredentialsRow ready for `prisma.channel.{create,update}`.
   */
  encrypt(
    credentials: Record<string, unknown>,
    context: ChannelCredentialsContext
  ): EncryptedChannelCredentialsRow {
    const plaintext = JSON.stringify(credentials);
    const enc = this.encryption.encrypt(plaintext, {
      fieldName: FIELD_NAME,
      recordId: context.recordId,
      ...(context.caller !== undefined && { caller: context.caller }),
    });
    return {
      credentialsCiphertext: enc.encryptedValue,
      credentialsIv: enc.iv,
      credentialsAuthTag: enc.authTag,
      credentialsKeyVersion: enc.keyVersion,
    };
  }

  /**
   * @method decrypt
   * @description Decrypts a persisted envelope back to its plaintext object.
   *   The channel id passed in `context` must match the id used at encrypt
   *   time (AAD binding).
   * @param row - Subset of a Channel row containing the four envelope columns.
   * @param context - `{ recordId: channel.id, caller? }`. Required.
   * @returns The plaintext credentials object as `Record<string, unknown>`.
   * @throws if AAD mismatches, the keyVersion is unknown, the auth tag is
   *   invalid, or the decrypted bytes are not valid JSON.
   */
  decrypt(
    row: EncryptedChannelCredentialsRow,
    context: ChannelCredentialsContext
  ): Record<string, unknown> {
    const envelope: EncryptedValue = {
      encryptedValue: row.credentialsCiphertext,
      iv: row.credentialsIv,
      authTag: row.credentialsAuthTag,
      keyVersion: row.credentialsKeyVersion,
    };
    const plaintext = this.encryption.decrypt(envelope, {
      fieldName: FIELD_NAME,
      recordId: context.recordId,
      ...(context.caller !== undefined && { caller: context.caller }),
    });
    return JSON.parse(plaintext) as Record<string, unknown>;
  }
}
