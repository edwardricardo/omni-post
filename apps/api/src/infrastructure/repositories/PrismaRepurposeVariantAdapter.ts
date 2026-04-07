/**
 * @file PrismaRepurposeVariantAdapter.ts
 * @description Prisma adapter for RepurposeVariantPort. Loads proposals,
 *              retrieves post content, finds connected platforms, and persists
 *              generated variants.
 * @layer infrastructure
 */

import { prisma } from "@infra/prisma";
import type { RepurposeVariantPort } from "../../application/ai/GenerateRepurposeVariantsUseCase.js";

export class PrismaRepurposeVariantAdapter implements RepurposeVariantPort {
  async loadProposal(proposalId: string): Promise<{
    id: string;
    accountId: string;
    sourcePostId: string;
    sourcePlatform: string;
  } | null> {
    const row = await prisma.repurposeProposal.findUnique({
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
    const content = await prisma.postContent.findFirst({
      where: { postId },
      select: { body: true },
      orderBy: { revision: "desc" },
    });

    return content?.body ?? null;
  }

  async getConnectedPlatforms(accountId: string): Promise<string[]> {
    const channels = await prisma.channel.findMany({
      where: {
        project: { accountId },
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
    await prisma.repurposeVariant.create({
      data: {
        proposalId: params.proposalId,
        platform: params.platform as never,
        content: params.content,
        hashtags: params.hashtags,
        status: "PENDING",
      },
    });
  }
}
