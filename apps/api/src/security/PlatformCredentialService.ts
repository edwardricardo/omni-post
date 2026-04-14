/**
 * @file PlatformCredentialService.ts
 * @description CRUD service for encrypted platform credentials.
 *   Handles both platform-wide credentials (PlatformCredential) and
 *   per-account credentials (AccountCredential). All values are encrypted
 *   at rest via EncryptionService before DB writes.
 * @layer application
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient, CredentialGroup, AccountCredentialGroup } from "@infra/prisma";
import type { EncryptionService } from "./EncryptionService.js";

type CredentialError = "NOT_FOUND" | "ENCRYPTION_ERROR" | "DATABASE_ERROR";

/**
 * @class PlatformCredentialService
 * @description Encrypted credential storage for platform-wide and per-account secrets.
 *   Receives EncryptionService and PrismaClient via constructor injection.
 */
export class PlatformCredentialService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly encryption: EncryptionService
  ) {}

  /**
   * @method setCredential
   * @description Encrypts a value and upserts it into PlatformCredential.
   *   Writes an audit log entry with group and key but never the plaintext value.
   * @param group - The credential group
   * @param key - The credential key within the group
   * @param value - The plaintext value to encrypt and store
   * @param updatedBy - The admin userId performing the update
   * @returns Result with void on success or error string on failure
   */
  async setCredential(
    group: CredentialGroup,
    key: string,
    value: string,
    updatedBy: string
  ): Promise<Result<void, CredentialError>> {
    try {
      const encrypted = this.encryption.encrypt(value);

      await this.prisma.platformCredential.upsert({
        where: { group_key: { group, key } },
        create: {
          group,
          key,
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          updatedBy,
        },
        update: {
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          updatedBy,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          action: "CREDENTIAL_UPDATED",
          resource: "platform_credential",
          details: { group, key },
          userId: updatedBy,
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("PLATFORM_ENCRYPTION_KEY")) {
        return err("ENCRYPTION_ERROR");
      }
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method getCredential
   * @description Retrieves and decrypts a single platform credential.
   * @param group - The credential group
   * @param key - The credential key within the group
   * @returns The decrypted plaintext value, or null if not found
   */
  async getCredential(
    group: CredentialGroup,
    key: string
  ): Promise<Result<string | null, CredentialError>> {
    try {
      const record = await this.prisma.platformCredential.findUnique({
        where: { group_key: { group, key } },
      });

      if (!record) return ok(null);

      const plaintext = this.encryption.decrypt({
        encryptedValue: record.encryptedValue,
        iv: record.iv,
        authTag: record.authTag,
      });

      return ok(plaintext);
    } catch {
      return err("ENCRYPTION_ERROR");
    }
  }

  /**
   * @method getGroup
   * @description Retrieves and decrypts all active credentials in a group.
   * @param group - The credential group
   * @returns A key-value map of decrypted credentials
   */
  async getGroup(group: CredentialGroup): Promise<Result<Record<string, string>, CredentialError>> {
    try {
      const records = await this.prisma.platformCredential.findMany({
        where: { group, isActive: true },
      });

      const result: Record<string, string> = {};
      for (const record of records) {
        result[record.key] = this.encryption.decrypt({
          encryptedValue: record.encryptedValue,
          iv: record.iv,
          authTag: record.authTag,
        });
      }

      return ok(result);
    } catch {
      return err("ENCRYPTION_ERROR");
    }
  }

  /**
   * @method deleteCredential
   * @description Deletes a platform credential and logs the action.
   * @param group - The credential group
   * @param key - The credential key within the group
   * @param deletedBy - The admin userId performing the deletion
   * @returns Result with void on success or error string on failure
   */
  async deleteCredential(
    group: CredentialGroup,
    key: string,
    deletedBy: string
  ): Promise<Result<void, CredentialError>> {
    try {
      await this.prisma.platformCredential.delete({
        where: { group_key: { group, key } },
      });

      await this.prisma.auditLog.create({
        data: {
          action: "CREDENTIAL_DELETED",
          resource: "platform_credential",
          details: { group, key },
          userId: deletedBy,
        },
      });

      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method isGroupConfigured
   * @description Checks if at least one active credential exists for the group.
   *   Does NOT decrypt any values.
   * @param group - The credential group to check
   * @returns true if at least one active credential exists
   */
  async isGroupConfigured(group: CredentialGroup): Promise<Result<boolean, CredentialError>> {
    try {
      const count = await this.prisma.platformCredential.count({
        where: { group, isActive: true },
      });
      return ok(count > 0);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method listConfiguredGroups
   * @description Returns a list of groups that have at least one active credential.
   *   Does NOT decrypt any values.
   * @returns Array of CredentialGroup values with active credentials
   */
  async listConfiguredGroups(): Promise<Result<CredentialGroup[], CredentialError>> {
    try {
      const groups = await this.prisma.platformCredential.groupBy({
        by: ["group"],
        where: { isActive: true },
      });
      return ok(groups.map((g) => g.group));
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method setAccountCredential
   * @description Encrypts and upserts a per-account credential.
   * @param accountId - The account that owns the credential
   * @param group - The account credential group
   * @param key - The credential key
   * @param value - The plaintext value to encrypt and store
   * @returns Result with void on success or error string on failure
   */
  async setAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string,
    value: string
  ): Promise<Result<void, CredentialError>> {
    try {
      const encrypted = this.encryption.encrypt(value);

      await this.prisma.accountCredential.upsert({
        where: { accountId_group_key: { accountId, group, key } },
        create: {
          accountId,
          group,
          key,
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
        },
        update: {
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("PLATFORM_ENCRYPTION_KEY")) {
        return err("ENCRYPTION_ERROR");
      }
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method getAccountCredential
   * @description Retrieves and decrypts a per-account credential.
   * @param accountId - The account that owns the credential
   * @param group - The account credential group
   * @param key - The credential key
   * @returns The decrypted plaintext value, or null if not found
   */
  async getAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<string | null, CredentialError>> {
    try {
      const record = await this.prisma.accountCredential.findUnique({
        where: { accountId_group_key: { accountId, group, key } },
      });

      if (!record) return ok(null);

      const plaintext = this.encryption.decrypt({
        encryptedValue: record.encryptedValue,
        iv: record.iv,
        authTag: record.authTag,
      });

      return ok(plaintext);
    } catch {
      return err("ENCRYPTION_ERROR");
    }
  }

  /**
   * @method deleteAccountCredential
   * @description Deletes a per-account credential.
   * @param accountId - The account that owns the credential
   * @param group - The account credential group
   * @param key - The credential key
   * @returns Result with void on success or error string on failure
   */
  async deleteAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<void, CredentialError>> {
    try {
      await this.prisma.accountCredential.delete({
        where: { accountId_group_key: { accountId, group, key } },
      });

      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
