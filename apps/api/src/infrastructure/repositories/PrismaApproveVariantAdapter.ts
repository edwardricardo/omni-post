/**
 * @file PrismaApproveVariantAdapter.ts
 * @description Prisma adapter for ApproveVariantPort. Loads repurpose variants,
 *              marks them approved, and creates draft posts from approved content.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { ApproveVariantPort } from "@core/application/ai/ApproveRepurposeVariantUseCase.js";

export class PrismaApproveVariantAdapter implements ApproveVariantPort {
  constructor(private readonly prisma: PrismaClient) {}

  async loadVariant(variantId: string): Promise<{
    id: string;
    proposalId: string;
    platform: string;
    content: string;
    hashtags: string[];
    status: string;
    proposal: { accountId: string; sourcePostId: string };
  } | null> {
    const row = await this.prisma.repurposeVariant.findUnique({
      where: { id: variantId },
      include: {
        proposal: {
          select: { accountId: true, sourcePostId: true },
        },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      proposalId: row.proposalId,
      platform: row.platform,
      content: row.content,
      hashtags: row.hashtags,
      status: row.status,
      proposal: {
        accountId: row.proposal.accountId,
        sourcePostId: row.proposal.sourcePostId,
      },
    };
  }

  async setVariantApproved(variantId: string, postId: string): Promise<void> {
    await this.prisma.repurposeVariant.update({
      where: { id: variantId },
      data: { status: "APPROVED", postId },
    });
  }

  async createDraftPost(params: {
    accountId: string;
    platform: string;
    content: string;
    scheduleAt?: Date;
  }): Promise<string> {
    const project = await this.prisma.project.findFirst({
      where: { accountId: params.accountId, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    if (!project) {
      throw new Error("No project found for account");
    }

    const post = await this.prisma.post.create({
      data: {
        projectId: project.id,
        status: "DRAFT",
        ...(params.scheduleAt !== undefined && { scheduledAt: params.scheduleAt }),
      },
    });

    await this.prisma.postContent.create({
      data: {
        postId: post.id,
        locale: "en",
        body: params.content,
      },
    });

    return post.id;
  }
}
