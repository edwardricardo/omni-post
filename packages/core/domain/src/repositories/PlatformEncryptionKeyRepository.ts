/**
 * @file PlatformEncryptionKeyRepository.ts
 * @description Port for the platform-wide encryption-key rotation log
 *   (`PlatformEncryptionKey` model). Records every Argon2id-derived
 *   data-key rotation performed by an admin so that audit + rollback
 *   tooling can reconstruct which `keyVersion` was active at any point
 *   in time.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports — see `AccountQueryRepository`, `AIServicePort`,
 *   `PlatformCredentialRepository`); application services wrap it before
 *   surfacing to their consumers.
 * @layer domain
 */

import { type Result } from "@shared/types";

/** Failure modes for encryption-key rotation persistence. */
export type EncryptionKeyStoreError = "DATABASE_ERROR";

/** Row shape returned by the reader. */
export interface PlatformEncryptionKey {
  keyVersion: number;
}

/** Input for creating a new rotation entry. */
export interface PlatformEncryptionKeyRotation {
  keyVersion: number;
  rotatedBy: string;
  note?: string;
}

export interface PlatformEncryptionKeyRepository {
  /**
   * Return the currently active rotation (highest `keyVersion` with
   * `isActive = true`), or `null` if no rotation has ever been recorded.
   */
  findActiveLatest(): Promise<Result<PlatformEncryptionKey | null, EncryptionKeyStoreError>>;

  /**
   * Persist a new rotation entry. The caller computes `keyVersion`
   * (typically `previous.keyVersion + 1`) so that the port stays free
   * of business logic.
   */
  createRotation(
    rotation: PlatformEncryptionKeyRotation
  ): Promise<Result<void, EncryptionKeyStoreError>>;
}
