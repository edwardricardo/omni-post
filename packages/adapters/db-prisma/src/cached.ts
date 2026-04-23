/**
 * @file cached.ts
 * @description RepoPort wrapper that transparently caches list/query results via the Redis cache
 *              manager, invalidating by key prefix on mutations.
 * @layer infrastructure
 */
import type {
  RepoPort,
  PublishLog,
  Channel,
  LogPublishInput,
  ListLogsQuery,
  CreatePostInput,
  ListPostsQuery,
  PostsPage,
  Analytics,
  AnalyticsQuery,
  AnalyticsInput,
  CreateThreadInput,
  CreateTweetInput,
  UpdateTweetInput,
} from "@ports/core";
import type {
  Result,
  CanonicalPost,
  Media,
  Account,
  CreateAccountInput,
  UpdateAccountInput,
  Thread,
  Tweet,
} from "@shared/types";
import Redis from "ioredis";
import type { DatabaseHealthMetrics } from "./resilience.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:cache");

export interface CacheConfiguration {
  defaultTTL: number;
  accountTTL: number;
  postTTL: number;
  projectTTL: number;
  analyticsTTL: number;
  threadTTL: number;
  keyPrefix: string;
  enableCompression: boolean;
  maxCacheSize: number;
}

export const DEFAULT_CACHE_CONFIG: CacheConfiguration = {
  defaultTTL: 300, // 5 minutes
  accountTTL: 1800, // 30 minutes
  postTTL: 600, // 10 minutes
  projectTTL: 900, // 15 minutes
  analyticsTTL: 180, // 3 minutes (analytics change frequently)
  threadTTL: 300, // 5 minutes
  keyPrefix: "omni-post:",
  enableCompression: false, // Can be enabled for large objects
  maxCacheSize: 1000, // Max keys to track for memory management
};

export interface CacheMetrics {
  hits: number;
  misses: number;
  errors: number;
  hitRate: number;
  totalRequests: number;
  invalidations: number;
  lastReset: Date;
}

export class CacheMetricsCollector {
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    errors: 0,
    hitRate: 0,
    totalRequests: 0,
    invalidations: 0,
    lastReset: new Date(),
  };

  recordHit(): void {
    this.metrics.hits++;
    this.metrics.totalRequests++;
    this.updateHitRate();
  }

  recordMiss(): void {
    this.metrics.misses++;
    this.metrics.totalRequests++;
    this.updateHitRate();
  }

  recordError(): void {
    this.metrics.errors++;
  }

  recordInvalidation(): void {
    this.metrics.invalidations++;
  }

  private updateHitRate(): void {
    if (this.metrics.totalRequests > 0) {
      this.metrics.hitRate = (this.metrics.hits / this.metrics.totalRequests) * 100;
    }
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      errors: 0,
      hitRate: 0,
      totalRequests: 0,
      invalidations: 0,
      lastReset: new Date(),
    };
  }
}

export function createCachedRepositoryAdapter(
  baseRepo: RepoPort & { getDatabaseHealthMetrics(): DatabaseHealthMetrics },
  config: Partial<CacheConfiguration> = {}
): RepoPort & {
  getDatabaseHealthMetrics(): DatabaseHealthMetrics;
  getCacheMetrics(): CacheMetrics;
  invalidateCache(pattern?: string): Promise<number>;
} {
  const cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...config };
  const metricsCollector = new CacheMetricsCollector();

  // Initialize Redis connection
  const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    keyPrefix: cacheConfig.keyPrefix,
    enableReadyCheck: false,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  // Handle Redis connection errors
  redis.on("error", (error) => {
    logger.warn({ err: error }, "Cache Redis connection error");
    metricsCollector.recordError();
  });

  // Key generation utilities
  const generateKey = (type: string, identifier: string | string[]): string => {
    const id = Array.isArray(identifier) ? identifier.join(":") : identifier;
    return `${type}:${id}`;
  };

  // Generic cache operations
  const getCached = async <T>(key: string): Promise<T | null> => {
    try {
      const cached = await redis.get(key);
      if (cached) {
        metricsCollector.recordHit();
        return JSON.parse(cached) as T;
      }
      metricsCollector.recordMiss();
      return null;
    } catch (error: unknown) {
      logger.warn({ err: error, key }, "Cache get error");
      metricsCollector.recordError();
      return null;
    }
  };

  const setCached = async <T>(key: string, value: T, ttlSeconds?: number): Promise<void> => {
    try {
      const serialized = JSON.stringify(value);
      const ttl = ttlSeconds || cacheConfig.defaultTTL;
      await redis.setex(key, ttl, serialized);
    } catch (error: unknown) {
      logger.warn({ err: error, key }, "Cache set error");
      metricsCollector.recordError();
    }
  };

  const deleteCached = async (key: string): Promise<void> => {
    try {
      await redis.del(key);
      metricsCollector.recordInvalidation();
    } catch (error: unknown) {
      logger.warn({ err: error, key }, "Cache delete error");
      metricsCollector.recordError();
    }
  };

  const deletePattern = async (pattern: string): Promise<number> => {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        const deleted = await redis.del(...keys);
        metricsCollector.recordInvalidation();
        return deleted;
      }
      return 0;
    } catch (error: unknown) {
      logger.warn({ err: error, pattern }, "Cache pattern delete error");
      metricsCollector.recordError();
      return 0;
    }
  };

  return {
    // Account management methods with caching
    async createAccount(
      input: CreateAccountInput
    ): Promise<Result<Account, "EMAIL_TAKEN" | "DATABASE_ERROR">> {
      const result = await baseRepo.createAccount(input);

      if (result.ok) {
        // Cache the new account
        const accountKey = generateKey("account", result.value.id);
        const emailKey = generateKey("account-email", result.value.email);
        await setCached(accountKey, result.value, cacheConfig.accountTTL);
        await setCached(emailKey, result.value, cacheConfig.accountTTL);
      }

      return result;
    },

    async getAccountById(id: string): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">> {
      const cacheKey = generateKey("account", id);
      const cached = await getCached<Account>(cacheKey);

      if (cached) {
        return { ok: true, value: cached };
      }

      const result = await baseRepo.getAccountById(id);

      if (result.ok) {
        await setCached(cacheKey, result.value, cacheConfig.accountTTL);
      }

      return result;
    },

    async getAccountByEmail(
      email: string
    ): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">> {
      const cacheKey = generateKey("account-email", email);
      const cached = await getCached<Account>(cacheKey);

      if (cached) {
        return { ok: true, value: cached };
      }

      const result = await baseRepo.getAccountByEmail(email);

      if (result.ok) {
        await setCached(cacheKey, result.value, cacheConfig.accountTTL);
        // Also cache by ID
        const accountKey = generateKey("account", result.value.id);
        await setCached(accountKey, result.value, cacheConfig.accountTTL);
      }

      return result;
    },

    async updateAccount(
      id: string,
      input: UpdateAccountInput
    ): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">> {
      const result = await baseRepo.updateAccount(id, input);

      if (result.ok) {
        // Update cache and invalidate related keys
        const accountKey = generateKey("account", id);
        const emailKey = generateKey("account-email", result.value.email);
        await setCached(accountKey, result.value, cacheConfig.accountTTL);
        await setCached(emailKey, result.value, cacheConfig.accountTTL);

        // Invalidate projects cache for this account
        await deletePattern(`projects-account:${id}`);
      }

      return result;
    },

    async deleteAccount(id: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
      const result = await baseRepo.deleteAccount(id);

      if (result.ok) {
        // Invalidate all account-related caches
        await deletePattern(`account:${id}`);
        await deletePattern(`account-email:*`); // Need to get email first, but simpler to clear all
        await deletePattern(`projects-account:${id}`);
      }

      return result;
    },

    async listAccounts(): Promise<Result<Account[], "DATABASE_ERROR">> {
      // Don't cache list operations as they change frequently and can be large
      return baseRepo.listAccounts();
    },

    // Project management methods
    async createProject(
      accountId: string,
      input: Omit<CreatePostInput, "projectId"> & { name: string }
    ): Promise<
      Result<
        { id: string; name: string; accountId: string },
        "QUOTA_EXCEEDED" | "NAME_TAKEN" | "ACCOUNT_NOT_FOUND" | "DATABASE_ERROR"
      >
    > {
      const result = await baseRepo.createProject(accountId, input);

      if (result.ok) {
        // Invalidate projects cache for this account
        await deletePattern(`projects-account:${accountId}`);
      }

      return result;
    },

    async getProjectsByAccount(
      accountId: string
    ): Promise<
      Result<
        Array<{ id: string; name: string; accountId: string; createdAt: Date }>,
        "DATABASE_ERROR"
      >
    > {
      const cacheKey = generateKey("projects-account", accountId);
      const cached =
        await getCached<Array<{ id: string; name: string; accountId: string; createdAt: Date }>>(
          cacheKey
        );

      if (cached) {
        return { ok: true, value: cached };
      }

      const result = await baseRepo.getProjectsByAccount(accountId);

      if (result.ok) {
        await setCached(cacheKey, result.value, cacheConfig.projectTTL);
      }

      return result;
    },

    async deleteProject(id: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
      const result = await baseRepo.deleteProject(id);

      if (result.ok) {
        // Invalidate related caches - we don't know accountId here, so invalidate patterns
        await deletePattern(`projects-account:*`);
        await deletePattern(`post:*`); // Posts belong to projects
        await deletePattern(`posts-project:*`);
      }

      return result;
    },

    // Post management methods with caching
    async getPostById(id: string): Promise<Result<CanonicalPost, "NOT_FOUND" | "DATABASE_ERROR">> {
      const cacheKey = generateKey("post", id);
      const cached = await getCached<CanonicalPost>(cacheKey);

      if (cached) {
        return { ok: true, value: cached };
      }

      const result = await baseRepo.getPostById(id);

      if (result.ok) {
        await setCached(cacheKey, result.value, cacheConfig.postTTL);
      }

      return result;
    },

    async createPost(input: CreatePostInput): Promise<Result<CanonicalPost, "DATABASE_ERROR">> {
      const result = await baseRepo.createPost(input);

      if (result.ok) {
        // Cache the new post
        const postKey = generateKey("post", result.value.id);
        await setCached(postKey, result.value, cacheConfig.postTTL);

        // Invalidate project posts cache
        await deletePattern(`posts-project:${input.projectId}`);
      }

      return result;
    },

    async listPosts(query: ListPostsQuery): Promise<Result<PostsPage, "DATABASE_ERROR">> {
      // Don't cache paginated lists as they're complex and change frequently
      return baseRepo.listPosts(query);
    },

    async addMediaToPost(
      postId: string,
      media: Media
    ): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
      const result = await baseRepo.addMediaToPost(postId, media);

      if (result.ok) {
        // Invalidate the post cache as it now has new media
        await deleteCached(generateKey("post", postId));
      }

      return result;
    },

    // Channel operations (read-through cache)
    async getChannelsByIds(ids: string[]): Promise<Result<Channel[], "DATABASE_ERROR">> {
      const cacheKey = generateKey("channels", ids.sort());
      const cached = await getCached<Channel[]>(cacheKey);

      if (cached) {
        return { ok: true, value: cached };
      }

      const result = await baseRepo.getChannelsByIds(ids);

      if (result.ok) {
        await setCached(cacheKey, result.value, cacheConfig.defaultTTL);
      }

      return result;
    },

    // Logging operations (write-through, no caching for logs as they're append-only)
    async logPublish(input: LogPublishInput): Promise<Result<PublishLog, "DATABASE_ERROR">> {
      return baseRepo.logPublish(input);
    },

    async getLogByDedupeKey(
      dedupeKey: string
    ): Promise<Result<PublishLog | null, "DATABASE_ERROR">> {
      return baseRepo.getLogByDedupeKey(dedupeKey);
    },

    async listLogs(query: ListLogsQuery): Promise<Result<PublishLog[], "DATABASE_ERROR">> {
      return baseRepo.listLogs(query);
    },

    // Analytics operations (short TTL due to frequent updates)
    async listAnalytics(query: AnalyticsQuery): Promise<Result<Analytics[], "DATABASE_ERROR">> {
      return baseRepo.listAnalytics(query);
    },

    async addAnalytics(input: AnalyticsInput): Promise<Result<Analytics, "DATABASE_ERROR">> {
      return baseRepo.addAnalytics(input);
    },

    // Thread operations with caching
    async createThread(
      input: CreateThreadInput
    ): Promise<Result<Thread, "POST_NOT_FOUND" | "THREAD_EXISTS" | "DATABASE_ERROR">> {
      const result = await baseRepo.createThread(input);

      if (result.ok) {
        const threadKey = generateKey("thread-post", input.postId);
        await setCached(threadKey, result.value, cacheConfig.threadTTL);
      }

      return result;
    },

    async getThreadByPostId(postId: string): Promise<Result<Thread | null, "DATABASE_ERROR">> {
      const cacheKey = generateKey("thread-post", postId);
      const cached = await getCached<Thread | null>(cacheKey);

      if (cached !== undefined) {
        return { ok: true, value: cached };
      }

      const result = await baseRepo.getThreadByPostId(postId);

      if (result.ok) {
        await setCached(cacheKey, result.value, cacheConfig.threadTTL);
      }

      return result;
    },

    async getThreadById(threadId: string): Promise<Result<Thread, "NOT_FOUND" | "DATABASE_ERROR">> {
      const cacheKey = generateKey("thread", threadId);
      const cached = await getCached<Thread>(cacheKey);

      if (cached) {
        return { ok: true, value: cached };
      }

      const result = await baseRepo.getThreadById(threadId);

      if (result.ok) {
        await setCached(cacheKey, result.value, cacheConfig.threadTTL);
      }

      return result;
    },

    async deleteThread(threadId: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
      const result = await baseRepo.deleteThread(threadId);

      if (result.ok) {
        await deletePattern(`thread:${threadId}`);
        await deletePattern(`thread-post:*`); // Don't know postId, so clear all
        await deletePattern(`tweets-thread:${threadId}`);
      }

      return result;
    },

    // Tweet operations
    async createTweet(
      input: CreateTweetInput
    ): Promise<Result<Tweet, "THREAD_NOT_FOUND" | "SEQUENCE_EXISTS" | "DATABASE_ERROR">> {
      const result = await baseRepo.createTweet(input);

      if (result.ok) {
        // Invalidate thread caches as they include tweets
        await deletePattern(`thread:${input.threadId}`);
        await deletePattern(`tweets-thread:${input.threadId}`);
      }

      return result;
    },

    async updateTweet(
      tweetId: string,
      input: UpdateTweetInput
    ): Promise<Result<Tweet, "NOT_FOUND" | "DATABASE_ERROR">> {
      const result = await baseRepo.updateTweet(tweetId, input);

      if (result.ok) {
        // Invalidate thread caches
        await deletePattern(`thread:*`);
        await deletePattern(`tweets-thread:*`);
      }

      return result;
    },

    async getTweetsByThread(threadId: string): Promise<Result<Tweet[], "DATABASE_ERROR">> {
      const cacheKey = generateKey("tweets-thread", threadId);
      const cached = await getCached<Tweet[]>(cacheKey);

      if (cached) {
        return { ok: true, value: cached };
      }

      const result = await baseRepo.getTweetsByThread(threadId);

      if (result.ok) {
        await setCached(cacheKey, result.value, cacheConfig.threadTTL);
      }

      return result;
    },

    async getTweetById(tweetId: string): Promise<Result<Tweet, "NOT_FOUND" | "DATABASE_ERROR">> {
      const cacheKey = generateKey("tweet", tweetId);
      const cached = await getCached<Tweet>(cacheKey);

      if (cached) {
        return { ok: true, value: cached };
      }

      const result = await baseRepo.getTweetById(tweetId);

      if (result.ok) {
        await setCached(cacheKey, result.value, cacheConfig.threadTTL);
      }

      return result;
    },

    // Extended methods
    getDatabaseHealthMetrics(): DatabaseHealthMetrics {
      return baseRepo.getDatabaseHealthMetrics();
    },

    getCacheMetrics(): CacheMetrics {
      return metricsCollector.getMetrics();
    },

    async invalidateCache(pattern?: string): Promise<number> {
      if (pattern) {
        return await deletePattern(pattern);
      } else {
        // Clear all cache
        return await deletePattern("*");
      }
    },
  };
}
