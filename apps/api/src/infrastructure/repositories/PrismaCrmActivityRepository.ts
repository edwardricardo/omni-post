/**
 * @file PrismaCrmActivityRepository.ts
 * @description Prisma implementation of CrmActivityRepository. Manages CRM activity logging
 *              and tracks sync status for outbound activity pushes.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  CrmActivityRepository,
  CrmActivityData,
  CreateCrmActivityInput,
} from "../../domain/repositories/CrmActivityRepository.js";

export class PrismaCrmActivityRepository implements CrmActivityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(data: CreateCrmActivityInput): Promise<CrmActivityData> {
    const row = await this.prisma.crmActivity.create({
      data: {
        accountId: data.accountId,
        platform: data.platform as "HUBSPOT" | "SALESFORCE",
        type: data.type as
          | "POST_PUBLISHED"
          | "POST_SCHEDULED"
          | "CAMPAIGN_CREATED"
          | "CAMPAIGN_COMPLETED"
          | "APPROVAL_APPROVED",
        title: data.title,
        description: data.description ?? null,
        occurredAt: data.occurredAt,
        contactEmail: data.contactEmail ?? null,
        postId: data.postId ?? null,
        campaignId: data.campaignId ?? null,
      },
    });
    return this.toData(row);
  }

  async findUnsyncedByAccountId(accountId: string): Promise<CrmActivityData[]> {
    const rows = await this.prisma.crmActivity.findMany({
      where: { accountId, syncedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => this.toData(r));
  }

  async markSynced(id: string, externalId: string | null): Promise<void> {
    await this.prisma.crmActivity.update({
      where: { id },
      data: {
        syncedAt: new Date(),
        ...(externalId !== null && { externalId }),
      },
    });
  }

  private toData(row: {
    id: string;
    accountId: string;
    platform: string;
    externalId: string | null;
    type: string;
    title: string;
    description: string | null;
    occurredAt: Date;
    contactEmail: string | null;
    postId: string | null;
    campaignId: string | null;
    syncedAt: Date | null;
    syncError: string | null;
    createdAt: Date;
  }): CrmActivityData {
    return {
      id: row.id,
      accountId: row.accountId,
      platform: row.platform,
      externalId: row.externalId,
      type: row.type,
      title: row.title,
      description: row.description,
      occurredAt: row.occurredAt,
      contactEmail: row.contactEmail,
      postId: row.postId,
      campaignId: row.campaignId,
      syncedAt: row.syncedAt,
      syncError: row.syncError,
      createdAt: row.createdAt,
    };
  }
}
