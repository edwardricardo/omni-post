/**
 * Container Setup - Service Registrations
 *
 * Registers all application services and infrastructure singletons in the DI container.
 * Extracted from setup.ts to keep files under 800 lines.
 *
 * @module infrastructure/container/setupServices
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { AdminUserRepositoryPort } from "../../domain/repositories/AdminUserRepository.js";
import type { AnalyticsReadRepositoryPort } from "../../domain/repositories/AnalyticsReadRepository.js";
import type { EventDispatcher as _EventDispatcher } from "../../domain/index.js";
import { AuthService } from "../../auth/authService.js";
import { MfaService } from "../../auth/mfaService.js";
import { RbacService } from "../../auth/rbacService.js";
import { auditService } from "../../audit/auditService.js";
import { ActivityFeedService } from "../../audit/activityFeedService.js";
import { aiService } from "../../ai/aiService.js";
import { dashboardService } from "../../admin/dashboardService.js";
import { AccountLifecycleService } from "../../admin/accountLifecycleService.js";
import { AccountSessionService } from "../../admin/AccountSessionService.js";
import { adminAuthService } from "../../admin/auth/AdminAuthService.js";
import { templateService } from "../../templates/templateService.js";
import { templateAnalytics } from "../../templates/templateAnalytics.js";
import { subscriptionService } from "../../billing/subscription/index.js";
import { webhookDashboardService } from "../../webhooks/webhookDashboardService.js";
import { RealtimeWebhookBroadcaster } from "../../webhooks/realtimeWebhookBroadcaster.js";
import { ProviderService } from "../../providers/providerService.js";
import { providerRegistry } from "../../providers/providerRegistry.js";
import { SyncEngine } from "../../content/SyncEngine.js";
import { ContentVersionManager } from "../../content/ContentVersionManager.js";
import { PlatformContentAdapter } from "../../content/PlatformContentAdapter.js";
import { EventService } from "../../events/EventService.js";
import { ContentSynchronizer } from "../../orchestration/ContentSynchronizer.js";
import { createRedisConnection } from "../../lib/redis.js";
import { ThreadAnalytics } from "../../analytics/threadAnalytics.js";
// Future: GeoAnalyticsService — deleted (100% fake geographic distribution)
import type { ApiMetrics } from "../../metrics/apiMetrics.js";
import { createPostsService } from "../../posts/postsService.js";
import { DatabaseOptimizer } from "../../database/DatabaseOptimizer.js";
import { RedisCacheManager } from "@adapters/cache-redis";
import { dbLogger } from "../../lib/logger.js";
import { CredentialManager } from "../../orchestration/CredentialManager.js";
import { RateLimitManager } from "../../orchestration/RateLimitManager.js";
import { ProviderCoordinator } from "../../orchestration/ProviderCoordinator.js";
import type { ProviderHealthMonitor } from "../../orchestration/ProviderHealthMonitor.js";
import { SagaManagerImpl } from "../../saga/SagaManager.js";
import type { IntegrationEventPublisher } from "../integration-events/IntegrationEventPort.js";
import { EventSchemaRegistry } from "../integration-events/EventSchemaRegistry.js";
import { UpcasterChain } from "../integration-events/EventUpcaster.js";

/**
 * Register all services in the container
 */
export function setupServices(
  container: Container,
  integrationEventPublisher?: IntegrationEventPublisher
): void {
  // Register Integration Event Publisher (P2-2) -- if provided
  if (integrationEventPublisher) {
    container.registerInstance(TOKENS.IntegrationEventPublisher, integrationEventPublisher);
  }

  // Register Event Versioning infrastructure (P2-5)
  container.register<EventSchemaRegistry>(
    TOKENS.EventSchemaRegistry,
    () => new EventSchemaRegistry(),
    true
  );
  container.register<UpcasterChain>(TOKENS.UpcasterChain, () => new UpcasterChain(), true);

  // Register Auth Services (R1-A -- factory-based with injected deps)
  container.register<MfaService>(
    TOKENS.MfaService,
    () => new MfaService(container.resolve<AdminUserRepositoryPort>(TOKENS.AdminUserRepository)),
    true
  );
  container.register<AuthService>(
    TOKENS.AuthService,
    () =>
      new AuthService(
        container.resolve<AdminUserRepositoryPort>(TOKENS.AdminUserRepository),
        container.resolve<MfaService>(TOKENS.MfaService)
      ),
    true
  );
  container.register<RbacService>(
    TOKENS.RbacService,
    () => new RbacService(container.resolve<AdminUserRepositoryPort>(TOKENS.AdminUserRepository)),
    true
  );

  // Register singleton instances
  container.registerInstance(TOKENS.AuditService, auditService);
  container.registerInstance(TOKENS.ActivityFeedService, new ActivityFeedService());
  container.registerInstance(TOKENS.AIService, aiService);
  container.registerInstance(TOKENS.DashboardService, dashboardService);

  container.register<AccountLifecycleService>(
    TOKENS.AccountLifecycleService,
    () =>
      new AccountLifecycleService(
        container.resolve<AdminUserRepositoryPort>(TOKENS.AdminUserRepository)
      ),
    true
  );
  container.register<AccountSessionService>(
    TOKENS.AccountSessionService,
    () =>
      new AccountSessionService(
        container.resolve<AdminUserRepositoryPort>(TOKENS.AdminUserRepository)
      ),
    true
  );

  container.registerInstance(TOKENS.AdminAuthService, adminAuthService);
  container.registerInstance(TOKENS.TemplateService, templateService);
  container.registerInstance(TOKENS.TemplateAnalytics, templateAnalytics);
  container.registerInstance(TOKENS.SubscriptionService, subscriptionService);
  container.registerInstance(TOKENS.WebhookDashboardService, webhookDashboardService);

  // Register RealtimeWebhookBroadcaster (F4D — SSE stream integration)
  container.register<RealtimeWebhookBroadcaster>(
    TOKENS.RealtimeWebhookBroadcaster,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      return new RealtimeWebhookBroadcaster(redis);
    },
    true
  );

  container.register<ProviderService>(
    TOKENS.ProviderService,
    () => new ProviderService(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.registerInstance(TOKENS.ProviderRegistry, providerRegistry);

  // Register Content Sync Services (F28)
  container.register<ContentVersionManager>(
    TOKENS.ContentVersionManager,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      const eventService = new EventService({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
      });
      return new ContentVersionManager({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        eventService,
      });
    },
    true
  );
  container.register<PlatformContentAdapter>(
    TOKENS.PlatformContentAdapter,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      const eventService = new EventService({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
      });
      return new PlatformContentAdapter({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        eventService,
      });
    },
    true
  );
  container.register<SyncEngine>(
    TOKENS.SyncEngine,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      const eventService = new EventService({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
      });
      const versionManager = container.resolve<ContentVersionManager>(TOKENS.ContentVersionManager);
      const synchronizer = new ContentSynchronizer({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        eventService,
      });
      return new SyncEngine({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        eventService,
        synchronizer,
        versionManager,
      });
    },
    true
  );

  // Register Analytics Services (M-8c)
  container.register<ThreadAnalytics>(
    TOKENS.ThreadAnalytics,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      return new ThreadAnalytics(
        redis,
        {} as ApiMetrics,
        container.resolve<AnalyticsReadRepositoryPort>(TOKENS.AnalyticsReadRepository)
      );
    },
    true
  );
  // Future: GeoAnalyticsService — deleted (100% fake geographic distribution)

  // Register CredentialManager + RateLimitManager (P2-A)
  container.register<CredentialManager>(
    TOKENS.CredentialManager,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      return new CredentialManager({ prisma: container.resolve(TOKENS.PrismaClient), redis });
    },
    true
  );
  container.register<RateLimitManager>(
    TOKENS.RateLimitManager,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      return new RateLimitManager({ redis });
    },
    true
  );

  // Register PostsService (B0-4)
  container.register(
    TOKENS.PostsService,
    () => {
      const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
      const dbOptimizer = new DatabaseOptimizer(container.resolve(TOKENS.PrismaClient), dbLogger);
      const cacheManager = new RedisCacheManager({
        redisUrl,
        keyPrefix: "posts:",
        defaultTtl: 300,
        enableCompression: true,
        enableMetrics: true,
      });
      return createPostsService(dbOptimizer, cacheManager);
    },
    true
  );

  // Register ProviderCoordinator (P2-B)
  container.register<ProviderCoordinator>(
    TOKENS.ProviderCoordinator,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      const eventService = new EventService({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
      });
      return new ProviderCoordinator({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        eventService,
      });
    },
    true
  );
  container.register<ProviderHealthMonitor>(
    TOKENS.ProviderHealthMonitor,
    () => container.resolve<ProviderCoordinator>(TOKENS.ProviderCoordinator).getHealthMonitor(),
    true
  );

  // Register SagaManager (P3-A)
  container.register<SagaManagerImpl>(
    TOKENS.SagaManager,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      const eventService = new EventService({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
      });
      return new SagaManagerImpl({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        eventService,
        enableMetrics: true,
        defaultTimeout: 30 * 60 * 1000,
        maxConcurrentSagas: 100,
      });
    },
    true
  );
}
