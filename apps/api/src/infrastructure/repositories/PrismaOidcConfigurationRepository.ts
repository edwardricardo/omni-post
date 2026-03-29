/**
 * @file PrismaOidcConfigurationRepository.ts
 * @description Prisma implementation of OidcConfigurationRepository port.
 *              Uses upsert to enforce one-config-per-account (unique accountId).
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import type { OidcConfiguration } from "../../domain/entities/OidcConfiguration.js";
import type {
  OidcConfigurationRepository,
  OidcConfigurationData,
} from "../../domain/repositories/OidcConfigurationRepository.js";

export class PrismaOidcConfigurationRepository implements OidcConfigurationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByAccountId(accountId: string): Promise<OidcConfigurationData | null> {
    const row = await this.prisma.oidcConfiguration.findUnique({
      where: { accountId },
    });
    return row ? this.toData(row) : null;
  }

  async save(config: OidcConfiguration): Promise<Result<void, Error>> {
    try {
      await this.prisma.oidcConfiguration.upsert({
        where: { accountId: config.accountId },
        create: {
          id: config.id,
          accountId: config.accountId,
          issuerUrl: config.issuerUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          scopes: config.scopes,
          attributeMapping: config.attributeMapping as Record<string, string>,
          isActive: config.isActive,
        },
        update: {
          issuerUrl: config.issuerUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
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
    clientSecret: string;
    scopes: string[];
    attributeMapping: unknown;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): OidcConfigurationData {
    return {
      id: row.id,
      accountId: row.accountId,
      issuerUrl: row.issuerUrl,
      clientId: row.clientId,
      clientSecret: row.clientSecret,
      scopes: row.scopes,
      attributeMapping: row.attributeMapping as Record<string, string>,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
