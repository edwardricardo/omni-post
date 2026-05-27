/**
 * @file PlatformCredentialService.ts
 * @description CRUD service for encrypted platform credentials. Composes a
 *   storage port (`PlatformCredentialRepository`) with an encryption port
 *   (`EncryptionPort`) and emits audit entries via `AuditEmitterPort`. Owns
 *   encryption/decryption; the repository deals only in `EncryptedValue`
 *   envelopes. Implements the narrow `PlatformCredentialReader` port so
 *   application use-cases can read the platform group without depending on
 *   the full service.
 * @layer application
 */
import { ok, err, type Result } from "@shared/types";
import type { CredentialGroup } from "@core/domain/value-objects/CredentialGroup.js";
import type { AccountCredentialGroup } from "@core/domain/value-objects/AccountCredentialGroup.js";
import type {
  PlatformCredentialReader,
  PlatformCredentialReadError,
} from "@core/domain/repositories/PlatformCredentialReader.js";
import type {
  PlatformCredentialRepository,
  CredentialStoreError,
} from "@core/domain/repositories/PlatformCredentialRepository.js";
import type { EncryptionPort, EncryptedValue } from "@core/domain/repositories/EncryptionPort.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";

/**
 * @class PlatformCredentialService
 * @description Encrypted credential storage facade. Public methods return
 *   `Result<T, UseCaseError>` (canon for @core/application) except
 *   `getPlatformCredentials()` which honours the narrower
 *   `PlatformCredentialReader` port contract (string-union error). All other
 *   internal port calls use `CredentialStoreError`, wrapped here.
 */
export class PlatformCredentialService implements PlatformCredentialReader {
  constructor(
    private readonly credentialRepo: PlatformCredentialRepository,
    private readonly encryption: EncryptionPort,
    private readonly auditEmitter: AuditEmitterPort
  ) {}

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private wrapStoreError(
    operation: string,
    storeError: CredentialStoreError,
    cause?: unknown
  ): UseCaseError {
    const code =
      storeError === "NOT_FOUND" ? USE_CASE_ERRORS.NOT_FOUND : USE_CASE_ERRORS.INTERNAL_ERROR;
    return new UseCaseError(
      `Credential ${operation} failed: ${storeError}`,
      code,
      cause instanceof Error ? cause : undefined
    );
  }

  private encryptionError(operation: string, cause: unknown): UseCaseError {
    return new UseCaseError(
      `Credential ${operation} encryption failed`,
      USE_CASE_ERRORS.INTERNAL_ERROR,
      cause instanceof Error ? cause : undefined
    );
  }

  // -------------------------------------------------------------------------
  // Platform-wide credentials
  // -------------------------------------------------------------------------

  /**
   * @method setCredential
   * @description Encrypts a value and upserts it. Emits a `CREDENTIAL_UPDATED`
   *   audit entry (never the plaintext value).
   */
  async setCredential(
    group: CredentialGroup,
    key: string,
    value: string,
    updatedBy: string
  ): Promise<Result<void, UseCaseError>> {
    let encrypted: EncryptedValue;
    try {
      encrypted = this.encryption.encrypt(value, {
        fieldName: "PlatformCredential",
        recordId: `${group}:${key}`,
        caller: "PlatformCredentialService.setCredential",
      });
    } catch (error: unknown) {
      return err(this.encryptionError("setCredential", error));
    }

    const saved = await this.credentialRepo.upsertCredential(group, key, encrypted, updatedBy);
    if (!saved.ok) return err(this.wrapStoreError("setCredential", saved.error));

    await this.auditEmitter.emit({
      action: "CREDENTIAL_UPDATED",
      category: "SECURITY",
      userId: updatedBy,
      resourceType: "platform_credential",
      resourceId: `${group}:${key}`,
      details: { group, key },
    });

    return ok(undefined);
  }

  /**
   * @method getCredential
   * @description Retrieves and decrypts a single platform credential.
   */
  async getCredential(
    group: CredentialGroup,
    key: string
  ): Promise<Result<string | null, UseCaseError>> {
    const found = await this.credentialRepo.findCredential(group, key);
    if (!found.ok) return err(this.wrapStoreError("getCredential", found.error));
    if (found.value === null) return ok(null);

    try {
      const plaintext = this.encryption.decrypt(found.value, {
        fieldName: "PlatformCredential",
        recordId: `${group}:${key}`,
        caller: "PlatformCredentialService.getCredential",
      });
      return ok(plaintext);
    } catch (error: unknown) {
      return err(this.encryptionError("getCredential", error));
    }
  }

  /**
   * @method getGroup
   * @description Retrieves and decrypts all active credentials in a group.
   */
  async getGroup(group: CredentialGroup): Promise<Result<Record<string, string>, UseCaseError>> {
    const found = await this.credentialRepo.findGroupCredentials(group);
    if (!found.ok) return err(this.wrapStoreError("getGroup", found.error));

    try {
      const result: Record<string, string> = {};
      for (const [key, envelope] of Object.entries(found.value)) {
        result[key] = this.encryption.decrypt(envelope, {
          fieldName: "PlatformCredential",
          recordId: `${group}:${key}`,
          caller: "PlatformCredentialService.getGroup",
        });
      }
      return ok(result);
    } catch (error: unknown) {
      return err(this.encryptionError("getGroup", error));
    }
  }

  /**
   * @method getPlatformCredentials
   * @description Narrow `PlatformCredentialReader` port implementation. Returns
   *   the PLATFORM group with the port's string-union error (NOT the
   *   service-canonical UseCaseError) to preserve the existing port contract
   *   consumed by `@core/application/customer-auth` and `team` use cases.
   */
  async getPlatformCredentials(): Promise<
    Result<Record<string, string>, PlatformCredentialReadError>
  > {
    const found = await this.credentialRepo.findGroupCredentials("PLATFORM");
    if (!found.ok) return err(found.error);

    try {
      const result: Record<string, string> = {};
      for (const [key, envelope] of Object.entries(found.value)) {
        result[key] = this.encryption.decrypt(envelope, {
          fieldName: "PlatformCredential",
          recordId: `PLATFORM:${key}`,
          caller: "PlatformCredentialService.getPlatformCredentials",
        });
      }
      return ok(result);
    } catch {
      return err("ENCRYPTION_ERROR");
    }
  }

  /**
   * @method deleteCredential
   * @description Deletes a platform credential and emits a `CREDENTIAL_DELETED`
   *   audit entry.
   */
  async deleteCredential(
    group: CredentialGroup,
    key: string,
    deletedBy: string
  ): Promise<Result<void, UseCaseError>> {
    const deleted = await this.credentialRepo.deleteCredential(group, key);
    if (!deleted.ok) return err(this.wrapStoreError("deleteCredential", deleted.error));

    await this.auditEmitter.emit({
      action: "CREDENTIAL_DELETED",
      category: "SECURITY",
      userId: deletedBy,
      resourceType: "platform_credential",
      resourceId: `${group}:${key}`,
      details: { group, key },
    });

    return ok(undefined);
  }

  /**
   * @method isGroupConfigured
   * @description Checks if at least one active credential exists for the group.
   */
  async isGroupConfigured(group: CredentialGroup): Promise<Result<boolean, UseCaseError>> {
    const counted = await this.credentialRepo.countGroupCredentials(group);
    if (!counted.ok) return err(this.wrapStoreError("isGroupConfigured", counted.error));
    return ok(counted.value > 0);
  }

  /**
   * @method listConfiguredGroups
   * @description Returns groups with at least one active credential.
   */
  async listConfiguredGroups(): Promise<Result<CredentialGroup[], UseCaseError>> {
    const listed = await this.credentialRepo.listGroupsWithActiveCredentials();
    if (!listed.ok) return err(this.wrapStoreError("listConfiguredGroups", listed.error));
    return ok(listed.value);
  }

  // -------------------------------------------------------------------------
  // Per-account credentials
  // -------------------------------------------------------------------------

  /**
   * @method setAccountCredential
   * @description Encrypts and upserts a per-account credential. No audit entry
   *   (per-account credential changes are scoped to that account; audit emission
   *   is the caller's responsibility if needed).
   */
  async setAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string,
    value: string
  ): Promise<Result<void, UseCaseError>> {
    let encrypted: EncryptedValue;
    try {
      encrypted = this.encryption.encrypt(value, {
        fieldName: "AccountCredential",
        recordId: `${accountId}:${group}:${key}`,
        caller: "PlatformCredentialService.setAccountCredential",
      });
    } catch (error: unknown) {
      return err(this.encryptionError("setAccountCredential", error));
    }

    const saved = await this.credentialRepo.upsertAccountCredential(
      accountId,
      group,
      key,
      encrypted
    );
    if (!saved.ok) return err(this.wrapStoreError("setAccountCredential", saved.error));

    return ok(undefined);
  }

  /**
   * @method getAccountCredential
   * @description Retrieves and decrypts a per-account credential.
   */
  async getAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<string | null, UseCaseError>> {
    const found = await this.credentialRepo.findAccountCredential(accountId, group, key);
    if (!found.ok) return err(this.wrapStoreError("getAccountCredential", found.error));
    if (found.value === null) return ok(null);

    try {
      const plaintext = this.encryption.decrypt(found.value, {
        fieldName: "AccountCredential",
        recordId: `${accountId}:${group}:${key}`,
        caller: "PlatformCredentialService.getAccountCredential",
      });
      return ok(plaintext);
    } catch (error: unknown) {
      return err(this.encryptionError("getAccountCredential", error));
    }
  }

  /**
   * @method deleteAccountCredential
   * @description Deletes a per-account credential.
   */
  async deleteAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<void, UseCaseError>> {
    const deleted = await this.credentialRepo.deleteAccountCredential(accountId, group, key);
    if (!deleted.ok) return err(this.wrapStoreError("deleteAccountCredential", deleted.error));
    return ok(undefined);
  }
}
