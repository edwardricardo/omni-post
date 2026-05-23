/**
 * @file dataFetcher.ts
 * @description Handles all data retrieval for cross-platform analytics through
 *              read-model repository ports for clean, Prisma-free data access.
 * @layer infrastructure
 */

import type { DomainAnalytics } from "@shared/types";
import type { AnalyticsReadRepositoryPort } from "../../domain/repositories/AnalyticsReadRepository.js";
import type { ProjectQueryRepositoryPort } from "../../domain/repositories/ProjectQueryRepository.js";
import type {
  CrossPlatformAnalyticsOptions,
  PostDataItem,
  ChannelDataItem,
  CompetitorDataItem,
} from "./types";

/**
 * Resolve the set of post IDs in scope for the given options: a single project
 * when projectId is set, otherwise every post across the account's projects.
 */
async function resolveScopedPostIds(
  options: CrossPlatformAnalyticsOptions,
  projectRepository: ProjectQueryRepositoryPort
): Promise<string[]> {
  if (options.projectId) {
    return projectRepository.getPostIds(options.projectId);
  }
  const projects = await projectRepository.getByAccountId(options.accountId);
  const postIdsArrays = await Promise.all(
    projects.map((project) => projectRepository.getPostIds(project.id))
  );
  return postIdsArrays.flat();
}

/**
 * Resolve the set of project IDs in scope for the given options.
 */
async function resolveScopedProjectIds(
  options: CrossPlatformAnalyticsOptions,
  projectRepository: ProjectQueryRepositoryPort
): Promise<string[]> {
  if (options.projectId) {
    return [options.projectId];
  }
  const projects = await projectRepository.getByAccountId(options.accountId);
  return projects.map((project) => project.id);
}

/**
 * Fetches analytics data for the given options and date range, ordered by
 * capturedAt ascending and filtered to the requested providers (if any).
 */
export async function getAnalyticsData(
  options: CrossPlatformAnalyticsOptions,
  startDate: Date,
  endDate: Date,
  analyticsRepository: AnalyticsReadRepositoryPort,
  projectRepository: ProjectQueryRepositoryPort
): Promise<DomainAnalytics[]> {
  const postIds = await resolveScopedPostIds(options, projectRepository);

  const analytics = await analyticsRepository.getByPostIds(postIds, {
    startDate,
    endDate,
    orderBy: { capturedAt: "asc" },
  });

  if (options.providers && options.providers.length > 0) {
    const providerSet = new Set<string>(options.providers as unknown as string[]);
    return analytics.filter((record) => providerSet.has(record.provider)) as DomainAnalytics[];
  }

  return analytics as DomainAnalytics[];
}

/**
 * Fetches posts data for the given options and date range. Each post carries
 * its latest content revision and media types.
 */
export async function getPostsData(
  options: CrossPlatformAnalyticsOptions,
  startDate: Date,
  endDate: Date,
  projectRepository: ProjectQueryRepositoryPort
): Promise<PostDataItem[]> {
  const projectIds = await resolveScopedProjectIds(options, projectRepository);

  const postsByProject = await Promise.all(
    projectIds.map((projectId) => projectRepository.getPostsWithContent(projectId))
  );
  const posts = postsByProject.flat();

  return posts
    .filter((post) => post.createdAt >= startDate && post.createdAt <= endDate)
    .map((post) => {
      // Latest content revision first — mirrors the legacy `take: 1` ordered desc.
      const latestContent = [...post.contents].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      )[0];
      return {
        id: post.id,
        createdAt: post.createdAt,
        contents: latestContent
          ? [
              {
                ...(latestContent.body && { content: latestContent.body }),
                ...(latestContent.title && { title: latestContent.title }),
                ...(latestContent.tags &&
                  latestContent.tags.length > 0 && { tags: latestContent.tags }),
              },
            ]
          : [],
        media: post.media.map((m) => ({ type: m.type })),
      };
    });
}

/**
 * Fetches channel data for the given options.
 */
export async function getChannelsData(
  options: CrossPlatformAnalyticsOptions,
  projectRepository: ProjectQueryRepositoryPort
): Promise<ChannelDataItem[]> {
  const projectIds = await resolveScopedProjectIds(options, projectRepository);

  const channelsByProject = await Promise.all(
    projectIds.map((projectId) => projectRepository.getChannelsByProject(projectId))
  );
  const channels = channelsByProject.flat();

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
