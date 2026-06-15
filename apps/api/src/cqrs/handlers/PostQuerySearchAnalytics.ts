/**
 * @file PostQuerySearchAnalytics.ts
 * @description CQRS query handlers for full-text post search (SearchPostsQueryHandler) and post analytics retrieval (GetPostAnalyticsQueryHandler) via PostQueryRepository.
 * @layer infrastructure
 */

import {
  PostId,
  ProjectId,
  type PostQueryRepository,
  type PostReadModel as DomainPostReadModel,
} from "@core/domain/index.js";
import { createLogger } from "../../lib/logger.js";
import {
  type Query,
  type QueryHandler,
  type QueryResult,
  type SearchPostsQuery,
  type PostsListReadModel,
  type PostAnalyticsReadModel,
  POST_QUERIES,
  validateQuery,
  SearchPostsQuerySchema,
} from "@shared/types/cqrs.js";

const log = createLogger("cqrs");

interface PostQueryHandlersConfig {
  postQueryRepository: PostQueryRepository;
}

/**
 * Map a list of domain PostReadModels to a CQRS PostsListReadModel list entry.
 */
function mapToListEntry(
  domainPost: DomainPostReadModel
): PostsListReadModel["data"]["posts"][number] {
  return {
    id: domainPost.id,
    ...(domainPost.title && { title: domainPost.title }),
    body: domainPost.body,
    status: domainPost.status as "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED",
    ...(domainPost.scheduledAt && { scheduledAt: domainPost.scheduledAt }),
    ...(domainPost.publishedAt && { publishedAt: domainPost.publishedAt }),
    createdAt: domainPost.createdAt,
    channelCount: 0, // channel data from separate endpoints
    publishedChannels: 0,
    failedChannels: 0,
    tags: domainPost.tags,
    hasMedia: domainPost.mediaCount > 0,
  };
}

/**
 * Search Posts Query Handler
 *
 * Performs text search across posts via PostQueryRepository.search().
 */
export class SearchPostsQueryHandler implements QueryHandler<Query<unknown>, PostsListReadModel> {
  readonly queryType = POST_QUERIES.SEARCH_POSTS;

  constructor(private config: PostQueryHandlersConfig) {}

  async handle(query: Query<unknown>): Promise<QueryResult<PostsListReadModel>> {
    try {
      const validation = validateQuery(query, SearchPostsQuerySchema);
      if (!validation.success) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
        };
      }

      const validatedQuery = validation.data as SearchPostsQuery;
      const { data } = validatedQuery;

      // Parse ProjectId
      const projectIdResult = ProjectId.fromString(data.projectId);
      if (!projectIdResult.ok) {
        return {
          success: false,
          error: `Invalid project ID: ${data.projectId}`,
        };
      }

      // Build pagination
      const page = Math.floor(data.offset / data.limit) + 1;
      const pagination = { page, limit: data.limit };

      const paginatedResult = await this.config.postQueryRepository.search(
        projectIdResult.value,
        data.searchTerm,
        pagination
      );

      const readModel: PostsListReadModel = {
        id: `search-results-${data.projectId}-${Date.now()}`,
        type: "PostsListReadModel",
        version: 1,
        lastUpdated: new Date(),
        data: {
          projectId: data.projectId,
          posts: paginatedResult.items.map(mapToListEntry),
          totalCount: paginatedResult.total,
          filters: {
            searchTerm: data.searchTerm,
            ...(data.filters && { ...data.filters }),
          },
        },
      };

      return {
        success: true,
        data: readModel,
        metadata: {
          totalCount: paginatedResult.total,
          page,
          limit: data.limit,
        },
      };
    } catch (error) {
      log.error({ err: error }, "SearchPostsQuery failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }
}

/**
 * Get Post Analytics Query Handler
 *
 * Retrieves analytics data for a post. Since PostQueryRepository does not
 * provide analytics data directly, this handler returns a simplified
 * analytics read model with the post metadata and zeroed-out metrics.
 * Actual analytics data should be fetched from dedicated analytics endpoints.
 */
export class GetPostAnalyticsQueryHandler implements QueryHandler<Query, PostAnalyticsReadModel> {
  readonly queryType = POST_QUERIES.GET_POST_ANALYTICS;

  constructor(private config: PostQueryHandlersConfig) {}

  async handle(query: Query): Promise<QueryResult<PostAnalyticsReadModel>> {
    try {
      const postId = (query.data as { postId?: string }).postId;

      if (!postId) {
        return {
          success: false,
          error: "Post ID is required",
        };
      }

      // Parse PostId
      const postIdResult = PostId.fromString(postId);
      if (!postIdResult.ok) {
        return {
          success: false,
          error: `Invalid post ID: ${postId}`,
        };
      }

      const result = await this.config.postQueryRepository.getById(postIdResult.value);

      if (!result.ok) {
        return {
          success: false,
          error: "Post not found",
        };
      }

      const post = result.value;

      // Build a simplified analytics read model.
      // Detailed per-channel analytics come from dedicated analytics endpoints,
      // not from PostQueryRepository.
      const readModel: PostAnalyticsReadModel = {
        id: `post-analytics-${postId}`,
        type: "PostAnalyticsReadModel",
        version: 1,
        lastUpdated: new Date(),
        data: {
          postId,
          projectId: post.projectId,
          channels: [],
          aggregated: {
            totalViews: 0,
            totalLikes: 0,
            totalShares: 0,
            totalComments: 0,
            totalEngagement: 0,
            engagementRate: 0,
          },
          trends: [],
        },
      };

      return {
        success: true,
        data: readModel,
      };
    } catch (error) {
      log.error({ err: error }, "GetPostAnalyticsQuery failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }
}
