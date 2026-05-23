/**
 * @file PrismaRepurposeDetectionAdapter.ts
 * @description Prisma adapter for RepurposeDetectionPort. Queries analytics data
 *              to find high-performing posts and creates repurpose proposals.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { RepurposeDetectionPort } from "../../application/ai/DetectRepurposeCandidatesUseCase.js";

export class PrismaRepurposeDetectionAdapter implements RepurposeDetectionPort {
  /** @param prisma - Prisma client for analytics and repurpose-proposal queries. */
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
      where: { id: { in: highPerformerIds } },
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
   * @method proposalExistsForPost
   * @description Checks if a repurpose proposal already exists for a given post.
   */
  async proposalExistsForPost(postId: string): Promise<boolean> {
    const count = await this.prisma.repurposeProposal.count({
      where: { sourcePostId: postId },
    });
    return count > 0;
  }

  /**
   * @method createProposal
   * @description Creates a new repurpose proposal for a high-performing post.
   */
  async createProposal(params: {
    accountId: string;
    sourcePostId: string;
    sourcePlatform: string;
    engagementRate: number;
    engagementMultiplier: number;
  }): Promise<string> {
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
    return proposal.id;
  }

  private async getAccountPostIds(accountId: string): Promise<string[]> {
    const posts = await this.prisma.post.findMany({
      where: {
        project: { accountId },
        deletedAt: null,
      },
      select: { id: true },
    });
    return posts.map((p) => p.id);
  }
}
