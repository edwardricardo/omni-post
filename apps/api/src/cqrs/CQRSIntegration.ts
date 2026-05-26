/**
 * @file CQRSIntegration.ts
 * @description Fastify integration layer that registers CQRS command/query endpoints, wires handler factories to the bus, and exposes health and metrics routes.
 * @layer application
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PostRepository, PostQueryRepository, ChannelRepository } from "@core/domain/index.js";
import type { CreatePostUseCase } from "@core/application/posts/CreatePostUseCase.js";
import type { UpdatePostUseCase } from "@core/application/posts/UpdatePostUseCase.js";
import type { DeletePostUseCase } from "@core/application/posts/DeletePostUseCase.js";
import {
  createCommand,
  createQuery,
  withCacheKey,
  POST_COMMANDS,
  POST_QUERIES,
} from "@shared/cqrs";
import { CQRSBusImpl } from "./CQRSBus";
import { createPostCommandHandlers } from "./handlers/PostCommandHandlers";
import { createPostQueryHandlers } from "./handlers/PostQueryHandlers";
import { EventService } from "../events/EventService";
import Redis from "ioredis";
import { logger } from "../lib/logger.js";

type PostStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
type SortByField = "createdAt" | "updatedAt" | "scheduledAt";
type SortOrderValue = "ASC" | "DESC";

interface SearchFilters {
  status?: PostStatus[];
  channelIds?: string[];
  tags?: string[];
  dateRange?: { from: Date; to: Date };
}

interface CQRSIntegrationConfig {
  fastify: FastifyInstance;
  createPostUseCase: CreatePostUseCase;
  updatePostUseCase: UpdatePostUseCase;
  deletePostUseCase: DeletePostUseCase;
  postRepository: PostRepository;
  channelRepository: ChannelRepository;
  postQueryRepository: PostQueryRepository;
  eventService: EventService;
  redis: Redis;
  enableMetrics?: boolean;
  enableQueryCache?: boolean;
  defaultCacheTtl?: number;
}

export class CQRSIntegration {
  private cqrsBus: CQRSBusImpl;

  constructor(private config: CQRSIntegrationConfig) {
    this.cqrsBus = new CQRSBusImpl({
      eventService: config.eventService,
      redis: config.redis,
      enableMetrics: config.enableMetrics !== false,
      enableQueryCache: config.enableQueryCache !== false,
      defaultCacheTtl: config.defaultCacheTtl || 300, // 5 minutes
    });
  }

  /**
   * Initialize CQRS integration
   */
  async initialize(): Promise<void> {
    // Register command handlers
    const commandHandlers = createPostCommandHandlers({
      createPostUseCase: this.config.createPostUseCase,
      updatePostUseCase: this.config.updatePostUseCase,
      deletePostUseCase: this.config.deletePostUseCase,
      postRepository: this.config.postRepository,
      channelRepository: this.config.channelRepository,
      redis: this.config.redis,
    });

    commandHandlers.forEach((handler) => {
      this.cqrsBus.registerCommandHandler(handler);
    });

    // Register query handlers
    const queryHandlers = createPostQueryHandlers({
      postQueryRepository: this.config.postQueryRepository,
    });

    queryHandlers.forEach((handler) => {
      this.cqrsBus.registerQueryHandler(handler);
    });

    // Register CQRS routes
    await this.registerRoutes();

    logger.info("CQRS Integration initialized successfully");
  }

  /**
   * Register CQRS API routes
   */
  private async registerRoutes(): Promise<void> {
    const { fastify } = this.config;

    // Command Routes

    // Create Post Command
    fastify.post<{
      Body: {
        title?: string;
        body: string;
        locale?: string;
        tags?: string[];
        mediaIds?: string[];
        scheduledAt?: string;
        channelIds: string[];
      };
    }>("/api/cqrs/posts/create", async (request, reply) => {
      try {
        const {
          title,
          body,
          locale = "en",
          tags,
          mediaIds,
          scheduledAt,
          channelIds,
        } = request.body;
        const postId = `post-${randomUUID()}`;

        const command = createCommand(
          POST_COMMANDS.CREATE_POST,
          postId,
          "Post",
          {
            projectId: request.user?.projectId || "default-project",
            title,
            body,
            locale,
            tags,
            mediaIds,
            scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
            channelIds,
          },
          {
            ...(request.user?.id && { userId: request.user.id }),
            ...(request.session?.id && { sessionId: request.session.id }),
            source: "PostAPI",
            ...(request.headers["user-agent"] && { userAgent: request.headers["user-agent"] }),
            ipAddress: request.ip,
          }
        );

        const result = await this.cqrsBus.executeCommand(command);

        if (!result.success) {
          return reply.status(400).send({
            error: result.error,
            validationErrors: result.validationErrors,
          });
        }

        return {
          success: true,
          data: {
            postId,
            ...(result.data && typeof result.data === "object" ? result.data : {}),
          },
          eventsPublished: result.events?.length || 0,
        };
      } catch (error) {
        logger.error({ err: error }, "Create post command failed");
        return reply.status(500).send({
          error: "Internal server error",
        });
      }
    });

    // Update Post Command
    fastify.put<{
      Params: { postId: string };
      Body: {
        title?: string;
        body?: string;
        tags?: string[];
        mediaIds?: string[];
        status?: "DRAFT" | "SCHEDULED" | "PUBLISHED";
      };
    }>("/api/cqrs/posts/:postId", async (request, reply) => {
      try {
        const { postId } = request.params;
        const updateData = request.body;

        const command = createCommand(POST_COMMANDS.UPDATE_POST, postId, "Post", updateData, {
          ...(request.user?.id && { userId: request.user.id }),
          ...(request.session?.id && { sessionId: request.session.id }),
          source: "PostAPI",
          ...(request.headers["user-agent"] && { userAgent: request.headers["user-agent"] }),
          ipAddress: request.ip,
        });

        const result = await this.cqrsBus.executeCommand(command);

        if (!result.success) {
          return reply.status(400).send({
            error: result.error,
            validationErrors: result.validationErrors,
          });
        }

        return {
          success: true,
          data: result.data,
          eventsPublished: result.events?.length || 0,
        };
      } catch (error) {
        logger.error({ err: error }, "Update post command failed");
        return reply.status(500).send({
          error: "Internal server error",
        });
      }
    });

    // Publish Post Command
    fastify.post<{
      Params: { postId: string };
      Body: {
        channelIds: string[];
        publishAt?: string;
        priority?: "LOW" | "NORMAL" | "HIGH";
      };
    }>("/api/cqrs/posts/:postId/publish", async (request, reply) => {
      try {
        const { postId } = request.params;
        const { channelIds, publishAt, priority = "NORMAL" } = request.body;

        const command = createCommand(
          POST_COMMANDS.PUBLISH_POST,
          postId,
          "Post",
          {
            channelIds,
            publishAt: publishAt ? new Date(publishAt) : undefined,
            priority,
          },
          {
            ...(request.user?.id && { userId: request.user.id }),
            ...(request.session?.id && { sessionId: request.session.id }),
            source: "PostAPI",
            ...(request.headers["user-agent"] && { userAgent: request.headers["user-agent"] }),
            ipAddress: request.ip,
          }
        );

        const result = await this.cqrsBus.executeCommand(command);

        if (!result.success) {
          return reply.status(400).send({
            error: result.error,
            validationErrors: result.validationErrors,
          });
        }

        return {
          success: true,
          data: result.data,
          eventsPublished: result.events?.length || 0,
        };
      } catch (error) {
        logger.error({ err: error }, "Publish post command failed");
        return reply.status(500).send({
          error: "Internal server error",
        });
      }
    });

    // Query Routes

    // Get Post Query
    fastify.get<{
      Params: { postId: string };
      Querystring: {
        includeContent?: string;
        includeMedia?: string;
        includeAnalytics?: string;
      };
    }>("/api/cqrs/posts/:postId", async (request, reply) => {
      try {
        const { postId } = request.params;
        const {
          includeContent = "true",
          includeMedia = "true",
          includeAnalytics = "false",
        } = request.query;

        const userId = request.user?.id;
        const sessionId = request.session?.id;

        let query = createQuery(
          POST_QUERIES.GET_POST,
          {
            postId,
            includeContent: includeContent === "true",
            includeMedia: includeMedia === "true",
            includeAnalytics: includeAnalytics === "true",
          },
          {
            source: "PostAPI",
            ...(userId && { userId }),
            ...(sessionId && { sessionId }),
            cacheTtl: 300, // 5 minutes
          }
        );

        // Add cache key for this query
        query = withCacheKey(
          query,
          `post:${postId}:${includeContent}:${includeMedia}:${includeAnalytics}`
        );

        const result = await this.cqrsBus.executeQuery(query);

        if (!result.success) {
          return reply.status(404).send({
            error: result.error,
          });
        }

        return {
          success: true,
          data: result.data,
          metadata: result.metadata,
        };
      } catch (error) {
        logger.error({ err: error }, "Get post query failed");
        return reply.status(500).send({
          error: "Internal server error",
        });
      }
    });

    // List Posts Query
    fastify.get<{
      Querystring: {
        projectId: string;
        status?: string;
        channelId?: string;
        fromDate?: string;
        toDate?: string;
        tags?: string;
        limit?: string;
        offset?: string;
        sortBy?: string;
        sortOrder?: string;
      };
    }>("/api/cqrs/posts", async (request, reply) => {
      try {
        const {
          projectId,
          status,
          channelId,
          fromDate,
          toDate,
          tags,
          limit = "20",
          offset = "0",
          sortBy = "createdAt",
          sortOrder = "DESC",
        } = request.query;

        let query = createQuery(
          POST_QUERIES.LIST_POSTS,
          {
            projectId,
            status: status as PostStatus | undefined,
            channelId,
            fromDate: fromDate ? new Date(fromDate) : undefined,
            toDate: toDate ? new Date(toDate) : undefined,
            tags: tags ? tags.split(",") : undefined,
            limit: parseInt(limit),
            offset: parseInt(offset),
            sortBy: sortBy as SortByField,
            sortOrder: sortOrder as SortOrderValue,
          },
          {
            ...(request.user?.id && { userId: request.user.id }),
            ...(request.session?.id && { sessionId: request.session.id }),
            source: "PostAPI",
            cacheTtl: 60, // 1 minute
          }
        );

        // Generate cache key based on query parameters
        const cacheKeyParams = [
          projectId,
          status,
          channelId,
          fromDate,
          toDate,
          tags,
          limit,
          offset,
          sortBy,
          sortOrder,
        ].join(":");
        query = withCacheKey(query, `posts:list:${cacheKeyParams}`);

        const result = await this.cqrsBus.executeQuery(query);

        if (!result.success) {
          return reply.status(400).send({
            error: result.error,
          });
        }

        return {
          success: true,
          data: result.data,
          metadata: result.metadata,
        };
      } catch (error) {
        logger.error({ err: error }, "List posts query failed");
        return reply.status(500).send({
          error: "Internal server error",
        });
      }
    });

    // Search Posts Query
    fastify.get<{
      Querystring: {
        projectId: string;
        q: string;
        status?: string;
        channelIds?: string;
        tags?: string;
        fromDate?: string;
        toDate?: string;
        limit?: string;
        offset?: string;
      };
    }>("/api/cqrs/posts/search", async (request, reply) => {
      try {
        const {
          projectId,
          q: searchTerm,
          status,
          channelIds,
          tags,
          fromDate,
          toDate,
          limit = "10",
          offset = "0",
        } = request.query;

        if (!searchTerm) {
          return reply.status(400).send({
            error: "Search term is required",
          });
        }

        const filters: SearchFilters = {};
        if (status) {
          filters.status = status.split(",") as PostStatus[];
        }
        if (channelIds) {
          filters.channelIds = channelIds.split(",");
        }
        if (tags) {
          filters.tags = tags.split(",");
        }
        if (fromDate && toDate) {
          filters.dateRange = {
            from: new Date(fromDate),
            to: new Date(toDate),
          };
        }

        const userId3 = request.user?.id;
        const sessionId3 = request.session?.id;

        let query = createQuery(
          POST_QUERIES.SEARCH_POSTS,
          {
            projectId,
            searchTerm,
            filters: Object.keys(filters).length > 0 ? filters : undefined,
            limit: parseInt(limit),
            offset: parseInt(offset),
          },
          {
            source: "PostAPI",
            ...(userId3 && { userId: userId3 }),
            ...(sessionId3 && { sessionId: sessionId3 }),
            cacheTtl: 120, // 2 minutes
          }
        );

        // Generate cache key for search
        const searchKey = [searchTerm, JSON.stringify(filters), limit, offset].join(":");
        query = withCacheKey(query, `posts:search:${Buffer.from(searchKey).toString("base64")}`);

        const result = await this.cqrsBus.executeQuery(query);

        if (!result.success) {
          return reply.status(400).send({
            error: result.error,
          });
        }

        return {
          success: true,
          data: result.data,
          metadata: result.metadata,
        };
      } catch (error) {
        logger.error({ err: error }, "Search posts query failed");
        return reply.status(500).send({
          error: "Internal server error",
        });
      }
    });

    // CQRS System Routes

    // CQRS Health Check
    fastify.get("/api/cqrs/health", async (_request, reply) => {
      try {
        const health = await this.cqrsBus.healthCheck();
        const metrics = this.cqrsBus.getMetrics();
        const handlersInfo = this.cqrsBus.getHandlersInfo();

        return {
          ...health,
          metrics,
          handlers: handlersInfo,
          timestamp: new Date(),
        };
      } catch (error) {
        logger.error({ err: error }, "CQRS health check failed");
        return reply.status(500).send({
          status: "unhealthy",
          error: "Health check failed",
        });
      }
    });

    // CQRS Metrics
    fastify.get("/api/cqrs/metrics", async (_request, reply) => {
      try {
        const metrics = this.cqrsBus.getMetrics();
        const handlersInfo = this.cqrsBus.getHandlersInfo();

        return {
          success: true,
          data: {
            performance: metrics,
            handlers: handlersInfo,
          },
          timestamp: new Date(),
        };
      } catch (error) {
        logger.error({ err: error }, "CQRS metrics failed");
        return reply.status(500).send({
          error: "Failed to get metrics",
        });
      }
    });

    // Clear Query Cache
    fastify.delete<{
      Querystring: { pattern?: string };
    }>("/api/cqrs/cache", async (request, reply) => {
      try {
        const pattern = request.query.pattern;
        const clearedCount = await this.cqrsBus.clearCache(pattern);

        return {
          success: true,
          data: {
            clearedCount,
            pattern: pattern || "all",
          },
        };
      } catch (error) {
        logger.error({ err: error }, "Clear cache failed");
        return reply.status(500).send({
          error: "Failed to clear cache",
        });
      }
    });

    logger.info("CQRS API routes registered");
  }

  /**
   * Get CQRS Bus instance
   */
  getBus(): CQRSBusImpl {
    return this.cqrsBus;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down CQRS Integration");
    await this.cqrsBus.shutdown();
    logger.info("CQRS Integration shutdown complete");
  }
}
