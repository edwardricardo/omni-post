/**
 * @file PrismaRepurposeVariantAdapter.ts
 * @description Prisma adapter for RepurposeVariantPort. Loads proposals,
 *              retrieves post content, finds connected platforms, and persists
 *              generated variants.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { RepurposeVariantPort } from "@core/ai/GenerateRepurposeVariantsUseCase.js";

export class PrismaRepurposeVariantAdapter implements RepurposeVariantPort {
  constructor(private readonly prisma: PrismaClient) {}

  async loadProposal(proposalId: string): Promise<{
    id: string;
    accountId: string;
    sourcePostId: string;
    sourcePlatform: string;
  } | null> {
    const row = await this.prisma.repurposeProposal.findUnique({
      where: { id: proposalId },
      select: {
        id: true,
        accountId: true,
        sourcePostId: true,
        sourcePlatform: true,
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      accountId: row.accountId,
      sourcePostId: row.sourcePostId,
      sourcePlatform: row.sourcePlatform,
    };
  }

  async getPostContent(postId: string): Promise<string | null> {
    const content = await this.prisma.postContent.findFirst({
      where: { postId },
      select: { body: true },
      orderBy: { revision: "desc" },
    });

    return content?.body ?? null;
  }

  async getConnectedPlatforms(accountId: string): Promise<string[]> {
    const channels = await this.prisma.channel.findMany({
      where: {
        project: { accountId, deletedAt: null },
        deletedAt: null,
      },
      select: { provider: true },
      distinct: ["provider"],
    });

    return channels.map((c) => c.provider);
  }

  async createVariant(params: {
    proposalId: string;
    platform: string;
    content: string;
    hashtags: string[];
  }): Promise<void> {
    await this.prisma.repurposeVariant.create({
      data: {
        proposalId: params.proposalId,
        platform: params.platform as never,
        content: params.content,
        hashtags: params.hashtags,
        status: "PENDING",
      },
    });
  }

  async existingVariantPlatforms(proposalId: string): Promise<string[]> {
    const rows = await this.prisma.repurposeVariant.findMany({
      where: { proposalId },
      select: { platform: true },
      distinct: ["platform"],
    });

    return rows.map((r) => r.platform);
  }
}
