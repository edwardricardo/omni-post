/**
 * @file PostQueryGetList.ts
 * @description CQRS query handlers for single post retrieval (GetPostQueryHandler) and paginated post listing (ListPostsQueryHandler) via PostQueryRepository.
 * @layer application
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
  type GetPostQuery,
  type ListPostsQuery,
  type PostReadModel as CQRSPostReadModel,
  type PostsListReadModel,
  POST_QUERIES,
  validateQuery,
  GetPostQuerySchema,
  ListPostsQuerySchema,
} from "@shared/cqrs";
import type { PostSortField, SortParams } from "@core/domain/index.js";

const log = createLogger("cqrs");

interface PostQueryHandlersConfig {
  postQueryRepository: PostQueryRepository;
}

/**
 * Map a domain PostReadModel to the CQRS-envelope PostReadModel.
 *
 * The domain model is flat (id, body, status, etc.) while the CQRS
 * model wraps it in an envelope with id, type, version, lastUpdated.
 */
function mapToCQRSReadModel(domainPost: DomainPostReadModel): CQRSPostReadModel {
  return {
    id: `post-readmodel-${domainPost.id}`,
    type: "PostReadModel",
    version: 1,
    lastUpdated: domainPost.updatedAt,
    data: {
      id: domainPost.id,
      projectId: domainPost.projectId,
      status: domainPost.status as "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED",
      ...(domainPost.title && { title: domainPost.title }),
      body: domainPost.body,
      locale: domainPost.locale,
      tags: domainPost.tags,
      mediaUrls: [], // domain read model has mediaCount, not URLs
      ...(domainPost.scheduledAt && { scheduledAt: domainPost.scheduledAt }),
      ...(domainPost.publishedAt && { publishedAt: domainPost.publishedAt }),
      createdAt: domainPost.createdAt,
      updatedAt: domainPost.updatedAt,
      channels: [], // channel data comes from separate endpoints
    },
  };
}

/**
 * Get Post Query Handler
 *
 * Retrieves a single post by ID via PostQueryRepository.
 */
export class GetPostQueryHandler implements QueryHandler<Query<unknown>, CQRSPostReadModel> {
  readonly queryType = POST_QUERIES.GET_POST;

  constructor(private config: PostQueryHandlersConfig) {}

  async handle(query: Query<unknown>): Promise<QueryResult<CQRSPostReadModel>> {
    try {
      const validation = validateQuery(query, GetPostQuerySchema);
      if (!validation.success) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
        };
      }

      const validatedQuery = validation.data as GetPostQuery;
      const { data } = validatedQuery;

      // Parse PostId from string (returns Result)
      const postIdResult = PostId.fromString(data.postId);
      if (!postIdResult.ok) {
        return {
          success: false,
          error: `Invalid post ID: ${data.postId}`,
        };
      }

      const result = await this.config.postQueryRepository.getById(postIdResult.value);

      if (!result.ok) {
        return {
          success: false,
          error: "Post not found",
        };
      }

      const readModel = mapToCQRSReadModel(result.value);

      return {
        success: true,
        data: readModel,
      };
    } catch (error) {
      log.error({ err: error }, "GetPostQuery failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }
}

/**
 * List Posts Query Handler
 *
 * Lists posts for a project with pagination, sorting, and filtering
 * via PostQueryRepository.
 */
export class ListPostsQueryHandler implements QueryHandler<Query<unknown>, PostsListReadModel> {
  readonly queryType = POST_QUERIES.LIST_POSTS;

  constructor(private config: PostQueryHandlersConfig) {}

  async handle(query: Query<unknown>): Promise<QueryResult<PostsListReadModel>> {
    try {
      const validation = validateQuery(query, ListPostsQuerySchema);
      if (!validation.success) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
        };
      }

      const validatedQuery = validation.data as ListPostsQuery;
      const { data } = validatedQuery;

      // Parse ProjectId
      const projectIdResult = ProjectId.fromString(data.projectId);
      if (!projectIdResult.ok) {
        return {
          success: false,
          error: `Invalid project ID: ${data.projectId}`,
        };
      }

      // Build pagination from query offset/limit
      const page = Math.floor(data.offset / data.limit) + 1;
      const pagination = { page, limit: data.limit };

      // Build sort params
      const sort: SortParams<PostSortField> = {
        field: data.sortBy as PostSortField,
        direction: data.sortOrder.toLowerCase() as "asc" | "desc",
      };

      const paginatedResult = await this.config.postQueryRepository.listByProject(
        projectIdResult.value,
        pagination,
        sort
      );

      const readModel: PostsListReadModel = {
        id: `posts-list-${data.projectId}-${Date.now()}`,
        type: "PostsListReadModel",
        version: 1,
        lastUpdated: new Date(),
        data: {
          projectId: data.projectId,
          posts: paginatedResult.items.map((domainPost) => ({
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
          })),
          totalCount: paginatedResult.total,
          filters: {
            ...(data.status && { status: data.status }),
            ...(data.channelId && { channelId: data.channelId }),
            ...(data.tags && { tags: data.tags }),
            ...(data.fromDate || data.toDate
              ? {
                  dateRange: {
                    ...(data.fromDate && { from: data.fromDate }),
                    ...(data.toDate && { to: data.toDate }),
                  },
                }
              : {}),
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
      log.error({ err: error }, "ListPostsQuery failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }
}
