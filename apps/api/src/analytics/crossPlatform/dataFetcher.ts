/**
 * @file dataFetcher.ts
 * @description Handles all database queries and data retrieval for cross-platform analytics
 *              using repository pattern for clean data access.
 * @layer infrastructure
 */

import { prisma } from "@infra/prisma";
import type { DomainAnalytics } from "@shared/types";
import type { ProjectQueryRepositoryPort } from "../../domain/repositories/ProjectQueryRepository.js";
import type {
  CrossPlatformAnalyticsOptions,
  PostDataItem,
  ChannelDataItem,
  CompetitorDataItem,
} from "./types";

/**
 * Fetches analytics data for the given options and date range
 */
export async function getAnalyticsData(
  options: CrossPlatformAnalyticsOptions,
  startDate: Date,
  endDate: Date,
  projectRepository: ProjectQueryRepositoryPort
): Promise<DomainAnalytics[]> {
  const whereClause: Record<string, unknown> = {
    capturedAt: {
      gte: startDate,
      lte: endDate,
    },
  };

  if (options.projectId) {
    const postIds = await projectRepository.getPostIds(options.projectId);
    whereClause.postId = { in: postIds };
  } else {
    const projects = await projectRepository.getByAccountId(options.accountId);
    const projectIds = projects.map((p) => p.id);
    const postIdsArrays = await Promise.all(
      projectIds.map((projectId) => projectRepository.getPostIds(projectId))
    );
    const postIds = postIdsArrays.flat();
    whereClause.postId = { in: postIds };
  }

  if (options.providers && options.providers.length > 0) {
    whereClause.provider = { in: options.providers };
  }

  return prisma.analytics.findMany({
    where: whereClause,
    orderBy: { capturedAt: "asc" },
  });
}

/**
 * Fetches posts data for the given options and date range
 */
export async function getPostsData(
  options: CrossPlatformAnalyticsOptions,
  startDate: Date,
  endDate: Date,
  projectRepository: ProjectQueryRepositoryPort
): Promise<PostDataItem[]> {
  const whereClause: Record<string, unknown> = {
    createdAt: {
      gte: startDate,
      lte: endDate,
    },
  };

  if (options.projectId) {
    whereClause.projectId = options.projectId;
  } else {
    const projects = await projectRepository.getByAccountId(options.accountId);
    whereClause.projectId = { in: projects.map((p) => p.id) };
  }

  const posts = await prisma.post.findMany({
    where: whereClause,
    include: {
      contents: {
        take: 1,
        orderBy: { createdAt: "desc" },
      },
      media: true,
    },
  });

  return posts.map((post) => ({
    id: post.id,
    createdAt: post.createdAt,
    contents: post.contents?.map((c) => ({
      ...(c.body && { content: c.body }),
      ...(c.title && { title: c.title }),
      ...(c.tags && c.tags.length > 0 && { tags: c.tags }),
    })),
    media: post.media?.map((m) => ({ type: m.type })),
  }));
}

/**
 * Fetches channel data for the given options
 */
export async function getChannelsData(
  options: CrossPlatformAnalyticsOptions,
  projectRepository: ProjectQueryRepositoryPort
): Promise<ChannelDataItem[]> {
  const whereClause: Record<string, unknown> = {};

  if (options.projectId) {
    whereClause.projectId = options.projectId;
  } else {
    const projects = await projectRepository.getByAccountId(options.accountId);
    whereClause.projectId = { in: projects.map((p) => p.id) };
  }

  const channels = await prisma.channel.findMany({
    where: whereClause,
  });

  return channels.map((channel) => ({
    id: channel.id,
    provider: channel.provider,
    name: channel.handle,
  }));
}

/**
 * Fetches competitor data (mock implementation)
 * In production, this would integrate with competitor analysis services
 */
export async function getCompetitorData(
  _options: CrossPlatformAnalyticsOptions
): Promise<CompetitorDataItem[]> {
  return [
    {
      id: "competitor_1",
      name: "Competitor A",
      followers: 50000,
      avgEngagementRate: 4.2,
      postFrequency: 5,
    },
    {
      id: "competitor_2",
      name: "Competitor B",
      followers: 75000,
      avgEngagementRate: 3.8,
      postFrequency: 7,
    },
  ];
}
