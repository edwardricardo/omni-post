/**
 * @file PrismaPlatformCredentialRepository.ts
 * @description Prisma adapter implementing `PlatformCredentialRepository`
 *   (raw envelope storage for platform- and account-scoped credentials).
 *   Translates Prisma errors to `CredentialStoreError` codes; never touches
 *   plaintext (decryption is the responsibility of the application service
 *   composing this adapter with `EncryptionPort`).
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  PlatformCredentialRepository,
  CredentialStoreError,
} from "@core/domain/repositories/PlatformCredentialRepository.js";
import type { EncryptedValue } from "@core/domain/repositories/EncryptionPort.js";
import type { CredentialGroup } from "@core/domain/value-objects/CredentialGroup.js";
import type { AccountCredentialGroup } from "@core/domain/value-objects/AccountCredentialGroup.js";

export class PrismaPlatformCredentialRepository implements PlatformCredentialRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // Platform-wide credentials
  // -------------------------------------------------------------------------

  async upsertCredential(
    group: CredentialGroup,
    key: string,
    encrypted: EncryptedValue,
    updatedBy: string
  ): Promise<Result<void, CredentialStoreError>> {
    try {
      await this.prisma.platformCredential.upsert({
        where: { group_key: { group, key } },
        create: {
          group,
          key,
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          updatedBy,
        },
        update: {
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          updatedBy,
        },
      });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findCredential(
    group: CredentialGroup,
    key: string
  ): Promise<Result<EncryptedValue | null, CredentialStoreError>> {
    try {
      const record = await this.prisma.platformCredential.findUnique({
        where: { group_key: { group, key } },
      });
      if (!record) return ok(null);
      return ok({
        encryptedValue: record.encryptedValue,
        iv: record.iv,
        authTag: record.authTag,
        keyVersion: record.keyVersion,
      });
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findGroupCredentials(
    group: CredentialGroup
  ): Promise<Result<Record<string, EncryptedValue>, CredentialStoreError>> {
    try {
      const records = await this.prisma.platformCredential.findMany({
        where: { group, isActive: true },
      });
      const result: Record<string, EncryptedValue> = {};
      for (const record of records) {
        result[record.key] = {
          encryptedValue: record.encryptedValue,
          iv: record.iv,
          authTag: record.authTag,
          keyVersion: record.keyVersion,
        };
      }
      return ok(result);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async deleteCredential(
    group: CredentialGroup,
    key: string
  ): Promise<Result<void, CredentialStoreError>> {
    try {
      await this.prisma.platformCredential.delete({
        where: { group_key: { group, key } },
      });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async countGroupCredentials(
    group: CredentialGroup
  ): Promise<Result<number, CredentialStoreError>> {
    try {
      const count = await this.prisma.platformCredential.count({
        where: { group, isActive: true },
      });
      return ok(count);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async listGroupsWithActiveCredentials(): Promise<
    Result<CredentialGroup[], CredentialStoreError>
  > {
    try {
      const groups = await this.prisma.platformCredential.groupBy({
        by: ["group"],
        where: { isActive: true },
      });
      return ok(groups.map((g) => g.group as CredentialGroup));
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  // -------------------------------------------------------------------------
  // Per-account credentials
  // -------------------------------------------------------------------------

  async upsertAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string,
    encrypted: EncryptedValue
  ): Promise<Result<void, CredentialStoreError>> {
    try {
      await this.prisma.accountCredential.upsert({
        where: { accountId_group_key: { accountId, group, key } },
        create: {
          accountId,
          group,
          key,
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
        },
        update: {
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
        },
      });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<EncryptedValue | null, CredentialStoreError>> {
    try {
      const record = await this.prisma.accountCredential.findUnique({
        where: { accountId_group_key: { accountId, group, key } },
      });
      if (!record) return ok(null);
      return ok({
        encryptedValue: record.encryptedValue,
        iv: record.iv,
        authTag: record.authTag,
        keyVersion: record.keyVersion,
      });
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async deleteAccountCredential(
    accountId: string,
    group: AccountCredentialGroup,
    key: string
  ): Promise<Result<void, CredentialStoreError>> {
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
