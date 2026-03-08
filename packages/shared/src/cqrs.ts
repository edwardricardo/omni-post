/**
 * Phase 2: Week 3-4 - CQRS (Command Query Responsibility Segregation)
 *
 * This module provides the foundation for CQRS pattern implementation:
 * - Separates Command (write) and Query (read) responsibilities
 * - Commands mutate state and generate events
 * - Queries read from optimized read models (projections)
 * - Event handlers update read models asynchronously
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainEvent } from "./events";

/**
 * Base Command interface - represents user intentions to change state
 */
export interface Command<T = unknown> {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  data: T;
  metadata: CommandMetadata;
  timestamp: Date;
}

/**
 * Command metadata for tracing and audit
 */
export interface CommandMetadata {
  userId?: string;
  sessionId?: string;
  correlationId: string;
  source: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Base Query interface - represents requests for data
 */
export interface Query<T = unknown> {
  id: string;
  type: string;
  data: T;
  metadata: QueryMetadata;
  timestamp: Date;
}

/**
 * Query metadata for caching and performance tracking
 */
export interface QueryMetadata {
  userId?: string;
  sessionId?: string;
  correlationId: string;
  source: string;
  cacheKey?: string;
  cacheTtl?: number;
}

/**
 * Command Handler interface
 */
export interface CommandHandler<TCommand extends Command = Command, TResult = void> {
  commandType: string;
  handle(command: TCommand): Promise<CommandResult<TResult>>;
}

/**
 * Query Handler interface
 */
export interface QueryHandler<TQuery extends Query = Query, TResult = unknown> {
  queryType: string;
  handle(query: TQuery): Promise<QueryResult<TResult>>;
}

/**
 * Command execution result
 */
export interface CommandResult<T = void> {
  success: boolean;
  data?: T;
  events?: DomainEvent[];
  error?: string;
  validationErrors?: ValidationError[];
}

/**
 * Query execution result
 */
export interface QueryResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    fromCache?: boolean;
    executionTime?: number;
    totalCount?: number;
    page?: number;
    limit?: number;
  };
}

/**
 * Validation error structure
 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
  value?: unknown;
}

/**
 * Read Model interface - optimized for queries
 */
export interface ReadModel {
  id: string;
  type: string;
  version: number;
  lastUpdated: Date;
  data: Record<string, unknown>;
}

/**
 * Projection interface - transforms events into read models
 */
export interface Projection<TReadModel extends ReadModel = ReadModel> {
  name: string;
  eventTypes: string[];
  handle(event: DomainEvent): Promise<TReadModel | TReadModel[] | null>;
  rebuild?(): Promise<void>;
}

// Command Types - Post Management

/**
 * Post Commands
 */
export const POST_COMMANDS = {
  CREATE_POST: "post.create",
  UPDATE_POST: "post.update",
  SCHEDULE_POST: "post.schedule",
  PUBLISH_POST: "post.publish",
  DELETE_POST: "post.delete",
  CANCEL_SCHEDULED_POST: "post.cancel-schedule",
} as const;

/**
 * Create Post Command
 */
export const CreatePostCommandSchema = z.object({
  id: z.string(),
  type: z.literal(POST_COMMANDS.CREATE_POST),
  aggregateId: z.string(),
  aggregateType: z.literal("Post"),
  data: z.object({
    projectId: z.string(),
    title: z.string().optional(),
    body: z.string(),
    locale: z.string().default("en"),
    tags: z.array(z.string()).optional(),
    mediaIds: z.array(z.string()).optional(),
    scheduledAt: z.date().optional(),
    channelIds: z.array(z.string()),
  }),
  metadata: z.object({
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    correlationId: z.string(),
    source: z.string(),
    userAgent: z.string().optional(),
    ipAddress: z.string().optional(),
  }),
  timestamp: z.date(),
});

export type CreatePostCommand = z.infer<typeof CreatePostCommandSchema>;

/**
 * Update Post Command
 */
export const UpdatePostCommandSchema = z.object({
  id: z.string(),
  type: z.literal(POST_COMMANDS.UPDATE_POST),
  aggregateId: z.string(),
  aggregateType: z.literal("Post"),
  data: z.object({
    title: z.string().optional(),
    body: z.string().optional(),
    tags: z.array(z.string()).optional(),
    mediaIds: z.array(z.string()).optional(),
    status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED"]).optional(),
  }),
  metadata: z.object({
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    correlationId: z.string(),
    source: z.string(),
    userAgent: z.string().optional(),
    ipAddress: z.string().optional(),
  }),
  timestamp: z.date(),
});

export type UpdatePostCommand = z.infer<typeof UpdatePostCommandSchema>;

/**
 * Publish Post Command
 */
export const PublishPostCommandSchema = z.object({
  id: z.string(),
  type: z.literal(POST_COMMANDS.PUBLISH_POST),
  aggregateId: z.string(),
  aggregateType: z.literal("Post"),
  data: z.object({
    channelIds: z.array(z.string()),
    publishAt: z.date().optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
  }),
  metadata: z.object({
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    correlationId: z.string(),
    source: z.string(),
    userAgent: z.string().optional(),
    ipAddress: z.string().optional(),
  }),
  timestamp: z.date(),
});

export type PublishPostCommand = z.infer<typeof PublishPostCommandSchema>;

// Query Types - Post Management

/**
 * Post Queries
 */
export const POST_QUERIES = {
  GET_POST: "post.get",
  LIST_POSTS: "post.list",
  GET_POST_ANALYTICS: "post.analytics",
  GET_POST_HISTORY: "post.history",
  SEARCH_POSTS: "post.search",
} as const;

/**
 * Get Post Query
 */
export const GetPostQuerySchema = z.object({
  id: z.string(),
  type: z.literal(POST_QUERIES.GET_POST),
  data: z.object({
    postId: z.string(),
    includeContent: z.boolean().default(true),
    includeMedia: z.boolean().default(true),
    includeAnalytics: z.boolean().default(false),
  }),
  metadata: z.object({
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    correlationId: z.string(),
    source: z.string(),
    cacheKey: z.string().optional(),
    cacheTtl: z.number().optional(),
  }),
  timestamp: z.date(),
});

export type GetPostQuery = z.infer<typeof GetPostQuerySchema>;

/**
 * List Posts Query
 */
export const ListPostsQuerySchema = z.object({
  id: z.string(),
  type: z.literal(POST_QUERIES.LIST_POSTS),
  data: z.object({
    projectId: z.string(),
    status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"]).optional(),
    channelId: z.string().optional(),
    fromDate: z.date().optional(),
    toDate: z.date().optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().min(1).max(100).default(20),
    offset: z.number().min(0).default(0),
    sortBy: z.enum(["createdAt", "updatedAt", "scheduledAt"]).default("createdAt"),
    sortOrder: z.enum(["ASC", "DESC"]).default("DESC"),
  }),
  metadata: z.object({
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    correlationId: z.string(),
    source: z.string(),
    cacheKey: z.string().optional(),
    cacheTtl: z.number().optional(),
  }),
  timestamp: z.date(),
});

export type ListPostsQuery = z.infer<typeof ListPostsQuerySchema>;

/**
 * Search Posts Query
 */
export const SearchPostsQuerySchema = z.object({
  id: z.string(),
  type: z.literal(POST_QUERIES.SEARCH_POSTS),
  data: z.object({
    projectId: z.string(),
    searchTerm: z.string(),
    filters: z
      .object({
        status: z.array(z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"])).optional(),
        channelIds: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        dateRange: z
          .object({
            from: z.date(),
            to: z.date(),
          })
          .optional(),
      })
      .optional(),
    limit: z.number().min(1).max(50).default(10),
    offset: z.number().min(0).default(0),
  }),
  metadata: z.object({
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    correlationId: z.string(),
    source: z.string(),
    cacheKey: z.string().optional(),
    cacheTtl: z.number().optional(),
  }),
  timestamp: z.date(),
});

export type SearchPostsQuery = z.infer<typeof SearchPostsQuerySchema>;

// Read Models

/**
 * Post Read Model - optimized for UI consumption
 */
export interface PostReadModel extends ReadModel {
  type: "PostReadModel";
  data: {
    id: string;
    projectId: string;
    status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
    title?: string;
    body: string;
    locale: string;
    tags: string[];
    mediaUrls: string[];
    scheduledAt?: Date;
    publishedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
    analytics?: {
      views: number;
      likes: number;
      shares: number;
      comments: number;
      engagement: number;
    };
    channels: {
      id: string;
      provider: string;
      name: string;
      status: "PENDING" | "PUBLISHED" | "FAILED";
      publishedAt?: Date;
      externalId?: string;
      error?: string;
    }[];
  };
}

/**
 * Posts List Read Model - optimized for list views
 */
export interface PostsListReadModel extends ReadModel {
  type: "PostsListReadModel";
  data: {
    projectId: string;
    posts: {
      id: string;
      title?: string;
      body: string;
      status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
      scheduledAt?: Date;
      publishedAt?: Date;
      createdAt: Date;
      channelCount: number;
      publishedChannels: number;
      failedChannels: number;
      tags: string[];
      hasMedia: boolean;
      analytics?: {
        totalViews: number;
        totalEngagement: number;
      };
    }[];
    totalCount: number;
    filters: Record<string, unknown>;
  };
}

/**
 * Post Analytics Read Model - optimized for analytics queries
 */
export interface PostAnalyticsReadModel extends ReadModel {
  type: "PostAnalyticsReadModel";
  data: {
    postId: string;
    projectId: string;
    channels: {
      channelId: string;
      provider: string;
      metrics: {
        views: number;
        likes: number;
        shares: number;
        comments: number;
        engagement: number;
        impressions: number;
        reach: number;
      };
      history: {
        timestamp: Date;
        metrics: Record<string, number>;
      }[];
    }[];
    aggregated: {
      totalViews: number;
      totalLikes: number;
      totalShares: number;
      totalComments: number;
      totalEngagement: number;
      engagementRate: number;
    };
    trends: {
      period: "1h" | "24h" | "7d" | "30d";
      viewsChange: number;
      engagementChange: number;
    }[];
  };
}

// Utility Functions

/**
 * Create a command with metadata
 */
export function createCommand<T>(
  type: string,
  aggregateId: string,
  aggregateType: string,
  data: T,
  metadata: Omit<CommandMetadata, "correlationId">
): Command<T> {
  return {
    id: `cmd-${randomUUID()}`,
    type,
    aggregateId,
    aggregateType,
    data,
    metadata: {
      ...(metadata.userId && { userId: metadata.userId }),
      ...(metadata.sessionId && { sessionId: metadata.sessionId }),
      source: metadata.source,
      ...(metadata.userAgent && { userAgent: metadata.userAgent }),
      ...(metadata.ipAddress && { ipAddress: metadata.ipAddress }),
      correlationId: `corr-${randomUUID()}`,
    },
    timestamp: new Date(),
  };
}

/**
 * Create a query with metadata
 */
export function createQuery<T>(
  type: string,
  data: T,
  metadata: Omit<QueryMetadata, "correlationId">
): Query<T> {
  return {
    id: `qry-${randomUUID()}`,
    type,
    data,
    metadata: {
      ...(metadata.userId && { userId: metadata.userId }),
      ...(metadata.sessionId && { sessionId: metadata.sessionId }),
      source: metadata.source,
      correlationId: `corr-${randomUUID()}`,
    },
    timestamp: new Date(),
  };
}

/**
 * Validate command using Zod schema
 */
export function validateCommand<T extends Command>(
  command: unknown,
  schema: z.ZodSchema<any>
): CommandResult<T> {
  try {
    const validatedCommand = schema.parse(command);
    return {
      success: true,
      data: validatedCommand,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: "Validation failed",
        validationErrors: error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
          code: err.code,
        })),
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown validation error",
    };
  }
}

/**
 * Validate query using Zod schema
 */
export function validateQuery<T extends Query>(
  query: unknown,
  schema: z.ZodSchema<any>
): QueryResult<T> {
  try {
    const validatedQuery = schema.parse(query);
    return {
      success: true,
      data: validatedQuery,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation failed: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown validation error",
    };
  }
}

/**
 * Cache key generator for queries
 */
export function generateCacheKey(query: Query): string {
  const { type, data } = query;
  const dataString = JSON.stringify(
    data,
    data && typeof data === "object" ? Object.keys(data).sort() : undefined
  );
  const hash = Buffer.from(dataString).toString("base64").replace(/[+/=]/g, "");
  return `query:${type}:${hash}`;
}

/**
 * CQRS Bus interface for command and query dispatching
 */
export interface CQRSBus {
  executeCommand<TCommand extends Command, TResult = void>(
    command: TCommand
  ): Promise<CommandResult<TResult>>;

  executeQuery<TQuery extends Query, TResult = unknown>(
    query: TQuery
  ): Promise<QueryResult<TResult>>;

  registerCommandHandler<TCommand extends Command, TResult = void>(
    handler: CommandHandler<TCommand, TResult>
  ): void;

  registerQueryHandler<TQuery extends Query, TResult = unknown>(
    handler: QueryHandler<TQuery, TResult>
  ): void;
}

/**
 * Middleware for automatic cache key generation
 */
export function withCacheKey<T extends Query>(query: T, customKey?: string): T {
  if (!query.metadata.cacheKey) {
    return {
      ...query,
      metadata: {
        ...query.metadata,
        cacheKey: customKey || generateCacheKey(query),
      },
    };
  }
  return query;
}
