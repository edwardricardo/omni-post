/**
 * @file PrismaChannelQueryForIngestion.ts
 * @description Read-only query adapter that finds active channels across accounts
 *              for analytics and inbox ingestion workers.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { ChannelQueryForIngestion } from "@core/domain/repositories/ChannelQueryForIngestion.js";

export class PrismaChannelQueryForIngestion implements ChannelQueryForIngestion {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveChannels(
    accountId?: string
  ): Promise<Array<{ id: string; projectId: string; provider: string; accountId: string }>> {
    const channels = await this.prisma.channel.findMany({
      where: {
        deletedAt: null,
        project: {
          deletedAt: null,
          ...(accountId ? { accountId } : {}),
        },
      },
      select: {
        id: true,
        projectId: true,
        provider: true,
        project: {
          select: { accountId: true },
        },
      },
    });

    return channels.map((ch) => ({
      id: ch.id,
      projectId: ch.projectId,
      provider: ch.provider,
      accountId: ch.project.accountId,
    }));
  }
}
