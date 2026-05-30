/**
 * @file PlatformCredentialPort.ts
 * @description Port for the platform credentials service (provider API
 *   keys/tokens, BYOK secrets, system credentials). Adapter wraps
 *   `PlatformCredentialService` from `@core/security` and is wired in the
 *   composition root.
 *
 *   Exposes the read + write surface used by consumers outside the
 *   `security` context (settings, ai). Encryption stays inside the adapter.
 *
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { UseCaseError } from "@core/application/UseCase.js";
import type { CredentialGroup } from "@core/domain/value-objects/CredentialGroup.js";
import type { AccountCredentialGroup } from "@core/domain/value-objects/AccountCredentialGroup.js";

export interface PlatformCredentialPort {
  // System-wide credential groups
  /**
   * Upsert a system-wide credential. Adapter encrypts the value at rest
   * (envelope encryption) and writes an audit trail attributing the change
   * to `updatedBy`.
   */
  setCredential(
    group: CredentialGroup,
    key: string,
    value: string,
    updatedBy: string
  ): Promise<Result<void, UseCaseError>>;

  /** Read a system-wide credential's plaintext value, or ok(null) when absent. */
  getCredential(group: CredentialGroup, key: string): Promise<Result<string | null, UseCaseError>>;

  /** Remove a system-wide credential. Records an audit event attributing the deletion to `deletedBy`. */
  deleteCredential(
    group: CredentialGroup,
    key: string,
    deletedBy: string
  ): Promise<Result<void, UseCaseError>>;

  /** Return every key/value pair in a system-wide credential group. */
  getGroup(group: CredentialGroup): Promise<Result<Record<string, string>, UseCaseError>>;

  /** List the credential groups that have at least one configured key. */
  listConfiguredGroups(): Promise<Result<CredentialGroup[], UseCaseError>>;

  // Per-account credentials (BYOK)
  /** Upsert a BYOK credential scoped to a specific account. */
  setAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string,
    value: string
  ): Promise<Result<void, UseCaseError>>;

  /** Read a per-account credential, or ok(null) when the account has not configured it. */
  getAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<string | null, UseCaseError>>;

  /** Delete a per-account credential. Idempotent on missing keys. */
  deleteAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<void, UseCaseError>>;
}
