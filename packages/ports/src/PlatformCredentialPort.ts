/**
 * @file PlatformCredentialPort.ts
 * @description Port for read access to platform credentials (provider API
 *   keys/tokens, BYOK secrets) from outside the `security` bounded context.
 *   Adapter wraps `PlatformCredentialService` from `@core/security` and is
 *   wired in the composition root.
 *
 *   Methods match the existing service call sites:
 *     `credentialService.getAccountCredential(accountId, group, key)` —
 *       per-account BYOK lookup.
 *     `credentialService.getGroup(group)` — system-wide credential group
 *       lookup (e.g. AI_POOL).
 *
 *   Returns decrypted values; encryption stays inside the adapter.
 *
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { UseCaseError } from "@core/application/UseCase.js";
import type {
  AccountCredentialGroup,
  CredentialGroup,
} from "@core/domain/value-objects/CredentialGroup.js";

export interface PlatformCredentialPort {
  getAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<string | null, UseCaseError>>;
  getGroup(group: CredentialGroup): Promise<Result<Record<string, string>, UseCaseError>>;
}
