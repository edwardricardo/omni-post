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
  setCredential(
    group: CredentialGroup,
    key: string,
    value: string,
    updatedBy: string
  ): Promise<Result<void, UseCaseError>>;

  getCredential(group: CredentialGroup, key: string): Promise<Result<string | null, UseCaseError>>;

  deleteCredential(
    group: CredentialGroup,
    key: string,
    deletedBy: string
  ): Promise<Result<void, UseCaseError>>;

  getGroup(group: CredentialGroup): Promise<Result<Record<string, string>, UseCaseError>>;

  listConfiguredGroups(): Promise<Result<CredentialGroup[], UseCaseError>>;

  // Per-account credentials (BYOK)
  setAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string,
    value: string
  ): Promise<Result<void, UseCaseError>>;

  getAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<string | null, UseCaseError>>;

  deleteAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<void, UseCaseError>>;
}
