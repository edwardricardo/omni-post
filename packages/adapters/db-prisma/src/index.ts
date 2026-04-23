/**
 * @file index.ts
 * @description Prisma repo adapter factory composing Account, Project, Post, Channel,
 *              PublishLog, Analytics, and Thread sub-repositories into a single RepoPort.
 * @layer infrastructure
 */
import {
  createDatabaseCircuitBreaker,
  withDatabaseRetry,
  DatabaseMetricsCollector,
  checkDatabaseConnection,
  type DatabaseHealthMetrics,
} from "./resilience.js";
import { prisma } from "@infra/prisma";
import { createLogger } from "@observability/logger";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";

const logger = createLogger("adapter:db-prisma");
import type { RepoPort } from "@ports/core";
import { createAccountRepository } from "./AccountRepository.js";
import { createProjectRepository } from "./ProjectRepository.js";
import { createPostRepository } from "./PostRepository.js";
import { createChannelRepository } from "./ChannelRepository.js";
import { createPublishLogRepository } from "./PublishLogRepository.js";
import { createAnalyticsRepository } from "./AnalyticsRepository.js";
import { createThreadRepository } from "./ThreadRepository.js";

export {
  createCachedRepositoryAdapter,
  type CacheConfiguration,
  type CacheMetrics,
} from "./cached.js";

export { createAccountRepository } from "./AccountRepository.js";
export { createProjectRepository, type CreateProjectInput } from "./ProjectRepository.js";
export { createPostRepository } from "./PostRepository.js";
export { createChannelRepository } from "./ChannelRepository.js";
export { createPublishLogRepository } from "./PublishLogRepository.js";
export { createAnalyticsRepository } from "./AnalyticsRepository.js";
export { createThreadRepository } from "./ThreadRepository.js";
export {
  createDatabaseCircuitBreaker,
  withDatabaseRetry,
  DatabaseMetricsCollector,
  checkDatabaseConnection,
  isDatabaseErrorRetryable,
  getDatabaseConnectionConfig,
  type DatabaseHealthMetrics,
  type DatabaseResilienceOptions,
  type DatabaseRetryOptions,
} from "./resilience.js";
export {
  mapProviderFromDB,
  mapProviderToDB,
  mapSubscriptionTierFromDB,
  mapSubscriptionTierToDB,
  getMaxProjectsForTier,
  mapThreadStrategyFromDB,
  mapThreadStrategyToDB,
  mapTweetStatusFromDB,
  mapTweetStatusToDB,
  type Provider,
  type PrismaSubscriptionTier,
  type PrismaThreadStrategy,
  type PrismaTweetStatus,
} from "./mappers.js";

export function createPrismaRepoAdapter(options?: {
  scheduler?: BackgroundTaskScheduler;
}): RepoPort & {
  getDatabaseHealthMetrics(): DatabaseHealthMetrics;
  close(): Promise<void>;
} {
  const metricsCollector = new DatabaseMetricsCollector();
  const connectionMonitorTaskId = "db-prisma-connection-monitor";

  // Create circuit breakers for critical database operations
  const readOperationBreaker = createDatabaseCircuitBreaker(
    async (operation: () => Promise<unknown>) => {
      return await withDatabaseRetry(operation);
    },
    {
      timeout: 5000,
      errorThresholdPercentage: 60,
      resetTimeout: 45000,
    }
  );

  const writeOperationBreaker = createDatabaseCircuitBreaker(
    async (operation: () => Promise<unknown>) => {
      return await withDatabaseRetry(operation, { maxRetries: 2, baseDelay: 100 });
    },
    {
      timeout: 8000,
      errorThresholdPercentage: 40,
      resetTimeout: 60000,
    }
  );

  const transactionBreaker = createDatabaseCircuitBreaker(
    async (operation: () => Promise<unknown>) => {
      return await withDatabaseRetry(operation, { maxRetries: 1, baseDelay: 200 });
    },
    {
      timeout: 12000,
      errorThresholdPercentage: 30,
      resetTimeout: 90000,
    }
  );

  // Setup metrics collection
  metricsCollector.setupCircuitBreakerMetrics(readOperationBreaker);
  metricsCollector.setupCircuitBreakerMetrics(writeOperationBreaker);
  metricsCollector.setupCircuitBreakerMetrics(transactionBreaker);

  // Connection health monitoring
  const monitorConnection = async (): Promise<void> => {
    const isHealthy = await checkDatabaseConnection(prisma);
    metricsCollector.updateConnectionHealth(isHealthy);
  };

  // Register monitor via scheduler when available, fire initial check immediately
  if (options?.scheduler) {
    options.scheduler.register(connectionMonitorTaskId, monitorConnection, 30_000, {
      immediate: true,
      onError: (err) => logger.warn({ err }, "DB connection monitor error"),
    });
  } else {
    void monitorConnection();
  }

  // Compose repositories from focused modules
  const accountRepo = createAccountRepository(readOperationBreaker, writeOperationBreaker);
  const projectRepo = createProjectRepository();
  const postRepo = createPostRepository(transactionBreaker);
  const channelRepo = createChannelRepository();
  const publishLogRepo = createPublishLogRepository();
  const analyticsRepo = createAnalyticsRepository();
  const threadRepo = createThreadRepository();

  return {
    // Account methods
    ...accountRepo,

    // Project methods
    ...projectRepo,

    // Post methods
    ...postRepo,

    // Channel methods
    ...channelRepo,

    // PublishLog methods
    ...publishLogRepo,

    // Analytics methods
    ...analyticsRepo,

    // Thread & Tweet methods
    ...threadRepo,

    getDatabaseHealthMetrics(): DatabaseHealthMetrics {
      return metricsCollector.getMetrics();
    },

    async close(): Promise<void> {
      try {
        if (options?.scheduler) {
          options.scheduler.unregister(connectionMonitorTaskId);
        }
        await prisma.$disconnect();
        logger.info("Database connections closed");
      } catch (error) {
        logger.warn({ err: error }, "Database cleanup warning");
      }
    },
  };
}
