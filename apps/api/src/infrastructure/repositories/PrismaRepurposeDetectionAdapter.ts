/**
 * @file PrismaRepurposeDetectionAdapter.ts
 * @description Prisma adapter for RepurposeDetectionPort. Queries analytics data
 *              to find high-performing posts and creates repurpose proposals.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { RepurposeDetectionPort } from "@core/ai/DetectRepurposeCandidatesUseCase.js";

export class PrismaRepurposeDetectionAdapter implements RepurposeDetectionPort {
  /** @param prisma - Injected Prisma client (composition root owns the singleton). */
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method getAccountAvgEngagement
   * @description Computes the average engagement rate for all posts owned by an account.
   */
  async getAccountAvgEngagement(accountId: string, sinceDays: number): Promise<number> {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - sinceDays);

    const accountPostIds = await this.getAccountPostIds(accountId);
    if (accountPostIds.length === 0) return 0;

    const summaries = await this.prisma.analyticsDailySummary.findMany({
      where: {
        date: { gte: sinceDate },
        postId: { in: accountPostIds },
      },
      select: { views: true, likes: true, comments: true, shares: true },
    });

    if (summaries.length === 0) return 0;

    let totalEngagement = 0;
    let totalViews = 0;

    for (const s of summaries) {
      totalEngagement += s.likes + s.comments + s.shares;
      totalViews += s.views;
    }

    return totalViews > 0 ? totalEngagement / totalViews : 0;
  }

  /**
   * @method getHighPerformers
   * @description Finds posts whose engagement rate exceeds the given minimum.
   */
  async getHighPerformers(params: {
    accountId: string;
    minEngagementRate: number;
    sinceDays: number;
  }): Promise<
    Array<{
      postId: string;
      platform: string;
      engagementRate: number;
      content: string;
    }>
  > {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - params.sinceDays);

    const accountPostIds = await this.getAccountPostIds(params.accountId);
    if (accountPostIds.length === 0) return [];

    const summaries = await this.prisma.analyticsDailySummary.findMany({
      where: {
        date: { gte: sinceDate },
        postId: { in: accountPostIds },
      },
      select: {
        postId: true,
        provider: true,
        views: true,
        likes: true,
        comments: true,
        shares: true,
      },
    });

    const aggregated = new Map<
      string,
      { provider: string; totalEngagement: number; totalViews: number }
    >();

    for (const s of summaries) {
      if (!s.postId) continue;
      const existing = aggregated.get(s.postId);
      if (existing) {
        existing.totalEngagement += s.likes + s.comments + s.shares;
        existing.totalViews += s.views;
      } else {
        aggregated.set(s.postId, {
          provider: s.provider,
          totalEngagement: s.likes + s.comments + s.shares,
          totalViews: s.views,
        });
      }
    }

    const highPerformerIds: string[] = [];
    const rateMap = new Map<string, { platform: string; engagementRate: number }>();

    for (const [postId, metrics] of aggregated) {
      if (metrics.totalViews === 0) continue;
      const rate = metrics.totalEngagement / metrics.totalViews;
      if (rate >= params.minEngagementRate) {
        highPerformerIds.push(postId);
        rateMap.set(postId, { platform: metrics.provider, engagementRate: rate });
      }
    }

    if (highPerformerIds.length === 0) return [];

    const posts = await this.prisma.post.findMany({
      where: { id: { in: highPerformerIds }, deletedAt: null },
      select: {
        id: true,
        contents: { select: { body: true }, take: 1 },
      },
    });

    const results: Array<{
      postId: string;
      platform: string;
      engagementRate: number;
      content: string;
    }> = [];

    for (const post of posts) {
      const rateInfo = rateMap.get(post.id);
      const content = post.contents[0];
      if (!rateInfo || !content) continue;

      results.push({
        postId: post.id,
        platform: rateInfo.platform,
        engagementRate: rateInfo.engagementRate,
        content: content.body,
      });
    }

    return results;
  }

  /**
   * @method createProposalIdempotent
   * @description Creates a repurpose proposal idempotently. If a proposal
   *   already exists for the same (accountId, sourcePostId) pair, returns
   *   the existing proposalId with `created: false`. The atomicity is
   *   guaranteed by the unique constraint on `(accountId, sourcePostId)`,
   *   not by a separate existence check (which would have a TOCTOU window
   *   between read and write).
   * @returns proposalId + `created` flag: `true` when a new row was
   *   inserted, `false` when an existing row was returned.
   */
  async createProposalIdempotent(params: {
    accountId: string;
    sourcePostId: string;
    sourcePlatform: string;
    engagementRate: number;
    engagementMultiplier: number;
  }): Promise<{ proposalId: string; created: boolean }> {
    try {
      const proposal = await this.prisma.repurposeProposal.create({
        data: {
          accountId: params.accountId,
          sourcePostId: params.sourcePostId,
          sourcePlatform: params.sourcePlatform as never,
          engagementRate: params.engagementRate,
          engagementMultiplier: params.engagementMultiplier,
          status: "PENDING",
        },
      });
      return { proposalId: proposal.id, created: true };
    } catch (error: unknown) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code: string }).code === "P2002"
      ) {
        const existing = await this.prisma.repurposeProposal.findUniqueOrThrow({
          where: {
            accountId_sourcePostId: {
              accountId: params.accountId,
              sourcePostId: params.sourcePostId,
            },
          },
          select: { id: true },
        });
        return { proposalId: existing.id, created: false };
      }
      throw error;
    }
  }

  private async getAccountPostIds(accountId: string): Promise<string[]> {
    const posts = await this.prisma.post.findMany({
      where: {
        project: { accountId, deletedAt: null },
        deletedAt: null,
      },
      select: { id: true },
    });
    return posts.map((p) => p.id);
  }
}
