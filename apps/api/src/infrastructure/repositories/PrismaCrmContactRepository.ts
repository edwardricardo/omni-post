/**
 * @file PrismaCrmContactRepository.ts
 * @description Prisma implementation of CrmContactRepository. Uses upsert on
 *              (accountId, platform, externalId) unique constraint for bulk operations.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  CrmContactRepository,
  CrmContactData,
  UpsertCrmContactInput,
} from "../../domain/repositories/CrmContactRepository.js";

export class PrismaCrmContactRepository implements CrmContactRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertMany(contacts: UpsertCrmContactInput[]): Promise<number> {
    let count = 0;
    for (const contact of contacts) {
      const platform = contact.platform as "HUBSPOT" | "SALESFORCE";
      await this.prisma.crmContact.upsert({
        where: {
          accountId_platform_externalId: {
            accountId: contact.accountId,
            platform,
            externalId: contact.externalId,
          },
        },
        create: {
          accountId: contact.accountId,
          platform,
          externalId: contact.externalId,
          email: contact.email,
          firstName: contact.firstName ?? null,
          lastName: contact.lastName ?? null,
          company: contact.company ?? null,
          title: contact.title ?? null,
          phone: contact.phone ?? null,
        },
        update: {
          email: contact.email,
          firstName: contact.firstName ?? null,
          lastName: contact.lastName ?? null,
          company: contact.company ?? null,
          title: contact.title ?? null,
          phone: contact.phone ?? null,
        },
      });
      count++;
    }
    return count;
  }

  async findByAccountId(accountId: string): Promise<CrmContactData[]> {
    const rows = await this.prisma.crmContact.findMany({
      where: { accountId },
      orderBy: { syncedAt: "desc" },
    });
    return rows.map((r) => this.toData(r));
  }

  private toData(row: {
    id: string;
    accountId: string;
    platform: string;
    externalId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    title: string | null;
    phone: string | null;
    syncedAt: Date;
    updatedAt: Date;
  }): CrmContactData {
    return {
      id: row.id,
      accountId: row.accountId,
      platform: row.platform,
      externalId: row.externalId,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.company,
      title: row.title,
      phone: row.phone,
      syncedAt: row.syncedAt,
      updatedAt: row.updatedAt,
    };
  }
}
