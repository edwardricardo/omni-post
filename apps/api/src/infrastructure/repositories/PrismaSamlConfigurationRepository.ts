/**
 * @file PrismaSamlConfigurationRepository.ts
 * @description Prisma implementation of SamlConfigurationRepository port.
 *              Uses upsert to enforce one-config-per-account (unique accountId).
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import type { SamlConfiguration } from "@core/domain/entities/SamlConfiguration.js";
import type {
  SamlConfigurationRepository,
  SamlConfigurationData,
} from "@core/domain/repositories/SamlConfigurationRepository.js";

export class PrismaSamlConfigurationRepository implements SamlConfigurationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByAccountId(accountId: string): Promise<SamlConfigurationData | null> {
    const row = await this.prisma.samlConfiguration.findUnique({
      where: { accountId },
    });
    return row ? this.toData(row) : null;
  }

  async save(config: SamlConfiguration): Promise<Result<void, Error>> {
    try {
      await this.prisma.samlConfiguration.upsert({
        where: { accountId: config.accountId },
        create: {
          id: config.id,
          accountId: config.accountId,
          entityId: config.entityId,
          idpEntityId: config.idpEntityId,
          idpSsoUrl: config.idpSsoUrl,
          idpCertificate: config.idpCertificate,
          attributeMapping: config.attributeMapping as Record<string, string>,
          isActive: config.isActive,
        },
        update: {
          entityId: config.entityId,
          idpEntityId: config.idpEntityId,
          idpSsoUrl: config.idpSsoUrl,
          idpCertificate: config.idpCertificate,
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
      await this.prisma.samlConfiguration.deleteMany({ where: { accountId } });
      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private toData(row: {
    id: string;
    accountId: string;
    entityId: string;
    idpEntityId: string;
    idpSsoUrl: string;
    idpCertificate: string;
    attributeMapping: unknown;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): SamlConfigurationData {
    return {
      id: row.id,
      accountId: row.accountId,
      entityId: row.entityId,
      idpEntityId: row.idpEntityId,
      idpSsoUrl: row.idpSsoUrl,
      idpCertificate: row.idpCertificate,
      attributeMapping: row.attributeMapping as Record<string, string>,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
