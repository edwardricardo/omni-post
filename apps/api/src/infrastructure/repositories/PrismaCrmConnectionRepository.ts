/**
 * @file PrismaCrmConnectionRepository.ts
 * @description Prisma implementation of CrmConnectionRepository. Uses upsert
 *              on (accountId, platform) unique constraint for save operations.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  CrmConnectionRepository,
  CrmConnectionData,
} from "../../domain/repositories/CrmConnectionRepository.js";

export class PrismaCrmConnectionRepository implements CrmConnectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<CrmConnectionData | null> {
    const row = await this.prisma.crmConnection.findUnique({ where: { id } });
    return row ? this.toData(row) : null;
  }

  async findByAccountId(accountId: string): Promise<CrmConnectionData[]> {
    const rows = await this.prisma.crmConnection.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toData(r));
  }

  async findByAccountAndPlatform(
    accountId: string,
    platform: string
  ): Promise<CrmConnectionData | null> {
    const row = await this.prisma.crmConnection.findUnique({
      where: {
        accountId_platform: {
          accountId,
          platform: platform as "HUBSPOT" | "SALESFORCE",
        },
      },
    });
    return row ? this.toData(row) : null;
  }

  async save(
    data: Omit<CrmConnectionData, "id" | "createdAt" | "updatedAt">
  ): Promise<CrmConnectionData> {
    const platform = data.platform as "HUBSPOT" | "SALESFORCE";
    const row = await this.prisma.crmConnection.upsert({
      where: {
        accountId_platform: {
          accountId: data.accountId,
          platform,
        },
      },
      create: {
        accountId: data.accountId,
        platform,
        isActive: data.isActive,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenExpiresAt: data.tokenExpiresAt,
        portalId: data.portalId,
        instanceUrl: data.instanceUrl,
        sandboxMode: data.sandboxMode,
        syncContacts: data.syncContacts,
        syncActivities: data.syncActivities,
        lastSyncAt: data.lastSyncAt,
      },
      update: {
        isActive: data.isActive,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenExpiresAt: data.tokenExpiresAt,
        portalId: data.portalId,
        instanceUrl: data.instanceUrl,
        sandboxMode: data.sandboxMode,
        syncContacts: data.syncContacts,
        syncActivities: data.syncActivities,
        lastSyncAt: data.lastSyncAt,
      },
    });
    return this.toData(row);
  }

  private toData(row: {
    id: string;
    accountId: string;
    platform: string;
    isActive: boolean;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
    portalId: string | null;
    instanceUrl: string | null;
    sandboxMode: boolean;
    syncContacts: boolean;
    syncActivities: boolean;
    lastSyncAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): CrmConnectionData {
    return {
      id: row.id,
      accountId: row.accountId,
      platform: row.platform,
      isActive: row.isActive,
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      tokenExpiresAt: row.tokenExpiresAt,
      portalId: row.portalId,
      instanceUrl: row.instanceUrl,
      sandboxMode: row.sandboxMode,
      syncContacts: row.syncContacts,
      syncActivities: row.syncActivities,
      lastSyncAt: row.lastSyncAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
