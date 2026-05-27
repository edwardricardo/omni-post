/**
 * @file PlatformCredentialRepository.ts
 * @description Low-level storage port for platform- and account-scoped
 *              encrypted credentials. The port deals in raw `EncryptedValue`
 *              envelopes — it does NOT decrypt. Application-layer services
 *              (e.g. `PlatformCredentialService`) compose this port with
 *              `EncryptionPort` to expose decrypted values to their callers.
 *
 *              Port-level error type is a string union (canon for @core/domain
 *              repository ports — see `AccountQueryRepository`, `AIServicePort`,
 *              etc.); application services wrap it in `UseCaseError` before
 *              surfacing to their consumers.
 * @layer domain
 */

import { type Result } from "@shared/types";
import type { CredentialGroup } from "../value-objects/CredentialGroup.js";
import type { AccountCredentialGroup } from "../value-objects/AccountCredentialGroup.js";
import type { EncryptedValue } from "./EncryptionPort.js";

/** Shared failure modes for credential reads + writes. */
export type CredentialStoreError = "NOT_FOUND" | "DATABASE_ERROR";

export interface PlatformCredentialRepository {
  // -------------------------------------------------------------------------
  // Platform-wide credentials
  // -------------------------------------------------------------------------

  /**
   * Insert or update a platform-wide credential row.
   * `updatedBy` is the admin userId performing the change (persisted on the row).
   */
  upsertCredential(
    group: CredentialGroup,
    key: string,
    encrypted: EncryptedValue,
    updatedBy: string
  ): Promise<Result<void, CredentialStoreError>>;

  /**
   * Read a single platform-wide credential's encrypted envelope, or null if absent.
   */
  findCredential(
    group: CredentialGroup,
    key: string
  ): Promise<Result<EncryptedValue | null, CredentialStoreError>>;

  /**
   * Read every active platform-wide credential within `group`. Returns a map
   * `key → EncryptedValue` (empty map if no rows). Inactive rows are filtered out.
   */
  findGroupCredentials(
    group: CredentialGroup
  ): Promise<Result<Record<string, EncryptedValue>, CredentialStoreError>>;

  /**
   * Hard-delete a platform-wide credential row.
   */
  deleteCredential(
    group: CredentialGroup,
    key: string
  ): Promise<Result<void, CredentialStoreError>>;

  /**
   * Count active credential rows in `group` (no decryption).
   */
  countGroupCredentials(group: CredentialGroup): Promise<Result<number, CredentialStoreError>>;

  /**
   * List distinct groups that have at least one active credential.
   */
  listGroupsWithActiveCredentials(): Promise<Result<CredentialGroup[], CredentialStoreError>>;

  // -------------------------------------------------------------------------
  // Per-account credentials
  // -------------------------------------------------------------------------

  /**
   * Insert or update a per-account credential row.
   */
  upsertAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string,
    encrypted: EncryptedValue
  ): Promise<Result<void, CredentialStoreError>>;

  /**
   * Read a single per-account credential envelope, or null if absent.
   */
  findAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<EncryptedValue | null, CredentialStoreError>>;

  /**
   * Hard-delete a per-account credential row.
   */
  deleteAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<void, CredentialStoreError>>;
}
