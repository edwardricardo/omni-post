/**
 * @file PrismaOidcConfigurationRepository.ts
 * @description Prisma implementation of OidcConfigurationRepository port.
 *              Uses upsert to enforce one-config-per-account (unique accountId).
 *              The OIDC client secret is wrapped via EncryptionService — the
 *              domain layer sees plaintext, but persistence is always encrypted.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import type { OidcConfiguration } from "../../domain/entities/OidcConfiguration.js";
import type {
  OidcConfigurationRepository,
  OidcConfigurationData,
} from "../../domain/repositories/OidcConfigurationRepository.js";
import type { EncryptionService } from "../../security/EncryptionService.js";

export class PrismaOidcConfigurationRepository implements OidcConfigurationRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly encryption: EncryptionService
  ) {}

  async findByAccountId(accountId: string): Promise<OidcConfigurationData | null> {
    const row = await this.prisma.oidcConfiguration.findUnique({
      where: { accountId },
    });
    return row ? this.toData(row) : null;
  }

  async save(config: OidcConfiguration): Promise<Result<void, Error>> {
    try {
      const encrypted = this.encryption.encrypt(config.clientSecret, {
        fieldName: "OidcConfiguration.clientSecret",
        recordId: config.accountId,
        caller: "PrismaOidcConfigurationRepository.save",
      });
      await this.prisma.oidcConfiguration.upsert({
        where: { accountId: config.accountId },
        create: {
          id: config.id,
          accountId: config.accountId,
          issuerUrl: config.issuerUrl,
          clientId: config.clientId,
          clientSecretCiphertext: encrypted.encryptedValue,
          clientSecretIv: encrypted.iv,
          clientSecretAuthTag: encrypted.authTag,
          clientSecretKeyVersion: encrypted.keyVersion,
          scopes: config.scopes,
          attributeMapping: config.attributeMapping as Record<string, string>,
          isActive: config.isActive,
        },
        update: {
          issuerUrl: config.issuerUrl,
          clientId: config.clientId,
          clientSecretCiphertext: encrypted.encryptedValue,
          clientSecretIv: encrypted.iv,
          clientSecretAuthTag: encrypted.authTag,
          clientSecretKeyVersion: encrypted.keyVersion,
          scopes: config.scopes,
          attributeMapping: config.attributeMapping as Record<string, string>,
          isActive: config.isActive,
        },
      });
      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async delete(accountId: string): Promise<Result<void, Error>> {
    try {
      await this.prisma.oidcConfiguration.deleteMany({ where: { accountId } });
      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private toData(row: {
    id: string;
    accountId: string;
    issuerUrl: string;
    clientId: string;
    clientSecretCiphertext: string;
    clientSecretIv: string;
    clientSecretAuthTag: string;
    clientSecretKeyVersion: number;
    scopes: string[];
    attributeMapping: unknown;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): OidcConfigurationData {
    const clientSecret = this.encryption.decrypt(
      {
        encryptedValue: row.clientSecretCiphertext,
        iv: row.clientSecretIv,
        authTag: row.clientSecretAuthTag,
        keyVersion: row.clientSecretKeyVersion,
      },
      {
        fieldName: "OidcConfiguration.clientSecret",
        recordId: row.accountId,
        caller: "PrismaOidcConfigurationRepository.toData",
      }
    );
    return {
      id: row.id,
      accountId: row.accountId,
      issuerUrl: row.issuerUrl,
      clientId: row.clientId,
      clientSecret,
      scopes: row.scopes,
      attributeMapping: row.attributeMapping as Record<string, string>,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
