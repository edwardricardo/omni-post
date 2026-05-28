/**
 * @file PlatformCredentialAdapter.ts
 * @description Composition-root adapter implementing `PlatformCredentialPort`
 *   by delegating to the `security` bounded context's
 *   `PlatformCredentialService`. Pure passthrough — all methods on the port
 *   have a 1:1 mapping with service methods.
 * @layer infrastructure
 */

import type { PlatformCredentialPort } from "@ports/core";
import type { Result } from "@shared/types";
import type { UseCaseError } from "@core/application/UseCase.js";
import type { CredentialGroup } from "@core/domain/value-objects/CredentialGroup.js";
import type { AccountCredentialGroup } from "@core/domain/value-objects/AccountCredentialGroup.js";
import type { PlatformCredentialService } from "@core/security/PlatformCredentialService.js";

export class PlatformCredentialAdapter implements PlatformCredentialPort {
  constructor(private readonly service: PlatformCredentialService) {}

  setCredential(
    group: CredentialGroup,
    key: string,
    value: string,
    updatedBy: string
  ): Promise<Result<void, UseCaseError>> {
    return this.service.setCredential(group, key, value, updatedBy);
  }

  getCredential(group: CredentialGroup, key: string): Promise<Result<string | null, UseCaseError>> {
    return this.service.getCredential(group, key);
  }

  deleteCredential(
    group: CredentialGroup,
    key: string,
    deletedBy: string
  ): Promise<Result<void, UseCaseError>> {
    return this.service.deleteCredential(group, key, deletedBy);
  }

  getGroup(group: CredentialGroup): Promise<Result<Record<string, string>, UseCaseError>> {
    return this.service.getGroup(group);
  }

  listConfiguredGroups(): Promise<Result<CredentialGroup[], UseCaseError>> {
    return this.service.listConfiguredGroups();
  }

  setAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string,
    value: string
  ): Promise<Result<void, UseCaseError>> {
    return this.service.setAccountCredential(accountId, group, key, value);
  }

  getAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<string | null, UseCaseError>> {
    return this.service.getAccountCredential(accountId, group, key);
  }

  deleteAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<void, UseCaseError>> {
    return this.service.deleteAccountCredential(accountId, group, key);
  }
}
