/**
 * @file PlatformCredentialAdapter.ts
 * @description Composition-root adapter implementing `PlatformCredentialPort`
 *   by delegating to the `security` bounded context's
 *   `PlatformCredentialService`. Pure passthrough — both methods (`getAccountCredential`,
 *   `getGroup`) already match the port signature exactly.
 * @layer infrastructure
 */

import type { PlatformCredentialPort } from "@ports/core";
import type { Result } from "@shared/types";
import type { UseCaseError } from "@core/application/UseCase.js";
import type {
  AccountCredentialGroup,
  CredentialGroup,
} from "@core/domain/value-objects/CredentialGroup.js";
import type { PlatformCredentialService } from "@core/security/PlatformCredentialService.js";

export class PlatformCredentialAdapter implements PlatformCredentialPort {
  constructor(private readonly service: PlatformCredentialService) {}

  getAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<string | null, UseCaseError>> {
    return this.service.getAccountCredential(accountId, group, key);
  }

  getGroup(group: CredentialGroup): Promise<Result<Record<string, string>, UseCaseError>> {
    return this.service.getGroup(group);
  }
}
