/**
 * @file PrismaTopPerformersQuery.ts
 * @description Prisma adapter for TopPerformersQueryPort.
 *              Joins Post + PostContent + AnalyticsDailySummary to find
 *              top-performing posts by engagement for a given account.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { TopPerformersQueryPort } from "@core/ai/GetTopPerformersContextUseCase.js";

export class PrismaTopPerformersQuery implements TopPerformersQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findTopPerformers(params: {
    accountId: string;
    platform?: string;
    since: Date;
    limit: number;
  }): Promise<
    Array<{
      postBody: string;
      platform: string;
      views: number;
      likes: number;
      comments: number;
      shares: number;
      publishedAt: Date;
    }>
  > {
    const summaries = await this.prisma.analyticsDailySummary.findMany({
      where: {
        postId: { not: null },
        date: { gte: params.since },
        ...(params.platform ? { provider: params.platform as never } : {}),
      },
      select: {
        postId: true,
        provider: true,
        views: true,
        likes: true,
        comments: true,
        shares: true,
        date: true,
      },
      orderBy: { date: "desc" },
      take: params.limit * 10,
    });

    const postIds = [...new Set(summaries.map((s) => s.postId).filter(Boolean))] as string[];
    if (postIds.length === 0) return [];

    const posts = await this.prisma.post.findMany({
      where: {
        id: { in: postIds },
        project: { accountId: params.accountId },
        deletedAt: null,
      },
      select: {
        id: true,
        publishedAt: true,
        contents: {
          select: { body: true },
          take: 1,
        },
      },
    });

    const postMap = new Map(posts.map((p) => [p.id, p]));

    const aggregated = new Map<
      string,
      { views: number; likes: number; comments: number; shares: number; provider: string }
    >();

    for (const s of summaries) {
      if (!s.postId) continue;
      const existing = aggregated.get(s.postId);
      if (existing) {
        existing.views += s.views;
        existing.likes += s.likes;
        existing.comments += s.comments;
        existing.shares += s.shares;
      } else {
        aggregated.set(s.postId, {
          views: s.views,
          likes: s.likes,
          comments: s.comments,
          shares: s.shares,
          provider: s.provider,
        });
      }
    }

    const results: Array<{
      postBody: string;
      platform: string;
      views: number;
      likes: number;
      comments: number;
      shares: number;
      publishedAt: Date;
    }> = [];

    for (const [postId, metrics] of aggregated) {
      const post = postMap.get(postId);
      if (!post) continue;
      const content = post.contents[0];
      if (!content) continue;

      results.push({
        postBody: content.body,
        platform: metrics.provider,
        views: metrics.views,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        publishedAt: post.publishedAt ?? new Date(),
      });
    }

    return results
      .sort((a, b) => {
        const engA = a.views > 0 ? (a.likes + a.comments + a.shares) / a.views : 0;
        const engB = b.views > 0 ? (b.likes + b.comments + b.shares) / b.views : 0;
        return engB - engA;
      })
      .slice(0, params.limit);
  }
}
