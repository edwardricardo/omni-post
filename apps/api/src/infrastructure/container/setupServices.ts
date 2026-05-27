/**
 * @file setupServices.ts
 * @description Registers all application services and infrastructure singletons in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { AdminUserRepositoryPort } from "@core/domain/repositories/AdminUserRepository.js";
import type { AdminSessionRepository } from "@core/domain/repositories/AdminSessionRepository.js";
import type { RoleRepository } from "@core/domain/repositories/RoleRepository.js";
import type { AuditLogRepository } from "@core/domain/repositories/AuditLogRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { AccountLifecycleQueryService } from "../../admin/accountLifecycleQueryService.js";
import type { AnalyticsReadRepositoryPort } from "@core/domain/repositories/AnalyticsReadRepository.js";
import type { ThreadReadRepositoryPort } from "@core/domain/repositories/ThreadReadRepository.js";
import type { EventDispatcher as _EventDispatcher } from "@core/domain/index.js";
import { AuthService } from "../../auth/authService.js";
import { MfaService } from "../../auth/mfaService.js";
import { RbacService } from "../../auth/rbacService.js";
import { AuditService } from "../../audit/auditService.js";
import { ActivityFeedService } from "../../audit/activityFeedService.js";
import { AIService } from "../../ai/aiService.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import type { HttpClientPort } from "@core/domain/repositories/HttpClientPort.js";
import { FetchHttpClient } from "../adapters/FetchHttpClient.js";
import { AiRequestService } from "../../ai/AiRequestService.js";
import { DashboardService } from "../../admin/dashboardService.js";
import { AccountLifecycleService } from "../../admin/accountLifecycleService.js";
import { AccountSessionService } from "../../admin/AccountSessionService.js";
import { AdminAuthService } from "../../admin/auth/AdminAuthService.js";
import { AdminUserAdminService } from "../../admin/AdminUserAdminService.js";
import { CustomerAccountBillingService } from "../../admin/CustomerAccountBillingService.js";
import { PricingAdminService } from "../../admin/PricingAdminService.js";
import { TemplateService } from "../../templates/templateService.js";
import { templateAnalytics } from "../../templates/templateAnalytics.js";
import { BillingService } from "@core/application/billing/BillingService.js";
import { SubscriptionPlanService } from "@core/application/billing/SubscriptionPlanService.js";
import { SubscriptionManagementService } from "@core/application/billing/SubscriptionManagementService.js";
import { TrialManagementService } from "@core/application/billing/TrialManagementService.js";
import { SubscriptionStatsService } from "@core/application/billing/SubscriptionStatsService.js";
import { SubscriptionService } from "@core/application/billing/SubscriptionService.js";
import { AuditEmitterAdapter } from "../../services/AuditEmitterAdapter.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";
import { WebhookDashboardService } from "../../webhooks/webhookDashboardService.js";
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
import { ComplianceService } from "../../compliance/ComplianceService.js";
import { DataRetentionService } from "../../compliance/DataRetentionService.js";
import { DlqArchivalService } from "../../webhooks/DlqArchivalService.js";
import { DatabaseOptimizer } from "../../database/DatabaseOptimizer.js";
import { RedisCacheManager, RedisCacheAdapter, createCacheManager } from "@adapters/cache-redis";
import type { CachePort } from "@ports/core";
import { getRedisUrl } from "../../lib/redis.js";
import { dbLogger, createLogger } from "../../lib/logger.js";
import { SagaManagerImpl } from "../../saga/SagaManager.js";
import type { IntegrationEventPublisher } from "../integration-events/IntegrationEventPort.js";
import { EventSchemaRegistry } from "../integration-events/EventSchemaRegistry.js";
import { EncryptionService } from "../../security/EncryptionService.js";
import type { EncryptionPort } from "@core/domain/repositories/EncryptionPort.js";
import { PrismaPlatformCredentialRepository } from "../repositories/PrismaPlatformCredentialRepository.js";
import type { PlatformCredentialRepository } from "@core/domain/repositories/PlatformCredentialRepository.js";
import { ChannelCredentialsCrypto } from "../../security/ChannelCredentialsCrypto.js";
import { PlatformCredentialService } from "@core/application/security/PlatformCredentialService.js";
import { SettingsService } from "../../settings/SettingsService.js";
import { UpcasterChain } from "../integration-events/EventUpcaster.js";
import { NotificationBroadcaster } from "../../services/NotificationBroadcaster.js";
import { AnalyticsStreamBroadcaster } from "../../services/AnalyticsStreamBroadcaster.js";
import { RealtimeAnalyticsService } from "../../analytics/realtimeAnalytics.js";
import { GA4TrackingAdapter } from "../adapters/GA4TrackingAdapter.js";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import { ResendEmailAdapter } from "../adapters/ResendEmailAdapter.js";
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import { PrometheusBusinessMetricsAdapter } from "../adapters/PrometheusBusinessMetricsAdapter.js";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import { Argon2PasswordHasher } from "../adapters/Argon2PasswordHasher.js";
import type { CustomerTokenService } from "@core/domain/repositories/CustomerTokenService.js";
import { CustomerTokenServiceAdapter } from "../adapters/CustomerTokenServiceAdapter.js";
import type { ReferralRewardMailer } from "@core/domain/repositories/ReferralRewardMailer.js";
import type { WelcomeMailer } from "@core/domain/repositories/WelcomeMailer.js";
import type { TeamInvitationMailer } from "@core/domain/repositories/TeamInvitationMailer.js";
import type { NotificationMailer } from "@core/domain/repositories/NotificationMailer.js";
import { TransactionalEmailAdapter } from "../adapters/TransactionalEmailAdapter.js";
import {
  BullMQQueuePortRegistry,
  BullMQDeadLetterQueueAdapter,
  QUEUE_NAMES,
} from "@adapters/queue-bullmq";
import type { QueuePort, QueuePortRegistry, DeadLetterQueuePort } from "@ports/core";
import Redis from "ioredis";
import {
  DefaultBackgroundTaskScheduler,
  type BackgroundTaskScheduler,
} from "@observability/background-scheduler";
import { env } from "../../config/env.js";

/**
 * Register all services in the container
 */
export function setupServices(
  container: Container,
  integrationEventPublisher?: IntegrationEventPublisher
): void {
  // Register Integration Event Publisher -- if provided
  if (integrationEventPublisher) {
    container.registerInstance(TOKENS.IntegrationEventPublisher, integrationEventPublisher);
  }

  // Register BackgroundTaskScheduler (centralised setInterval registry).
  // Singleton — one registry per process, flushed on SIGTERM/SIGINT.
  container.register<BackgroundTaskScheduler>(
    TOKENS.BackgroundTaskScheduler,
    () => new DefaultBackgroundTaskScheduler({ logger: createLogger("scheduler") }),
    true
  );

  // Register Event Versioning infrastructure
  container.register<EventSchemaRegistry>(
    TOKENS.EventSchemaRegistry,
    () => new EventSchemaRegistry(),
    true
  );
  container.register<UpcasterChain>(TOKENS.UpcasterChain, () => new UpcasterChain(), true);

  // Register Auth Services -- factory-based with injected deps
  container.register<MfaService>(
    TOKENS.MfaService,
    () =>
      new MfaService(
        container.resolve<AdminUserRepositoryPort>(TOKENS.AdminUserRepository),
        container.resolve<AuditLogRepository>(TOKENS.AuditLogRepository)
      ),
    true
  );
  container.register<AuthService>(
    TOKENS.AuthService,
    () =>
      new AuthService(
        container.resolve(TOKENS.PrismaClient),
        container.resolve<AdminUserRepositoryPort>(TOKENS.AdminUserRepository),
        container.resolve<MfaService>(TOKENS.MfaService),
        container.resolve<RoleRepository>(TOKENS.RoleRepository),
        container.resolve<AdminSessionRepository>(TOKENS.AdminSessionRepository),
        container.resolve<AuditLogRepository>(TOKENS.AuditLogRepository)
      ),
    true
  );
  container.register<RbacService>(
    TOKENS.RbacService,
    () =>
      new RbacService(
        container.resolve<AdminUserRepositoryPort>(TOKENS.AdminUserRepository),
        container.resolve<RoleRepository>(TOKENS.RoleRepository),
        container.resolve<AuditLogRepository>(TOKENS.AuditLogRepository),
        container.resolve<CachePort>(TOKENS.CachePort)
      ),
    true
  );

  // Register singleton instances
  container.register<AuditService>(
    TOKENS.AuditService,
    () => new AuditService(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<ActivityFeedService>(
    TOKENS.ActivityFeedService,
    () => new ActivityFeedService(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<AiRequestService>(
    TOKENS.AiRequestService,
    () =>
      new AiRequestService(
        container.resolve(TOKENS.PrismaClient),
        container.resolve<PlatformCredentialService>(TOKENS.PlatformCredentialService),
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
        container.resolve<CachePort>(TOKENS.CachePort)
      ),
    true
  );

  container.register<AIService>(
    TOKENS.AIService,
    () =>
      new AIService(
        container.resolve<AiRequestService>(TOKENS.AiRequestService),
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
        container.resolve<CachePort>(TOKENS.CachePort)
      ),
    true
  );
  // Port-side handle so application/ml use cases depend on the abstraction.
  // The concrete AIService instance fulfils the AIServicePort contract;
  // resolving the port returns the same singleton.
  container.register<AIServicePort>(
    TOKENS.AIServicePort,
    () => container.resolve<AIService>(TOKENS.AIService),
    true
  );
  // Outbound HTTP port for application services (TriggerIntegrationEventService).
  container.register<HttpClientPort>(TOKENS.HttpClientPort, () => new FetchHttpClient(), true);

  // Application-wide RedisCacheManager singleton: a single L1+L2 tiered cache
  // pool shared by every consumer. Created lazily so tests that resolve the
  // container without exercising cache-dependent code don't open a real Redis
  // connection. The Fastify entry point (`apps/api/src/index.ts`) resolves it
  // immediately for `fastify.cacheManager` decoration; everything else
  // resolves it implicitly via `TOKENS.CachePort`.
  container.register<RedisCacheManager>(
    TOKENS.RedisCacheManager,
    () =>
      createCacheManager(
        {
          redisUrl: getRedisUrl(),
          keyPrefix: "api:",
          enableMetrics: true,
        },
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler)
      ),
    true
  );

  // General-purpose cache port: wraps the application-wide `RedisCacheManager`
  // singleton behind the canonical `CachePort` API. Callers namespace their
  // keys with conventional prefixes (`credentials:`, `permissions:`,
  // `branch:`); the underlying manager applies the global `keyPrefix` at the
  // Redis level, so every consumer shares L1+L2 tiering, tag invalidation,
  // and cross-pod coherence with no duplicated cache pools.
  container.register<CachePort>(
    TOKENS.CachePort,
    () => new RedisCacheAdapter(container.resolve<RedisCacheManager>(TOKENS.RedisCacheManager)),
    true
  );

  container.register<DashboardService>(
    TOKENS.DashboardService,
    () => new DashboardService(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<AccountLifecycleQueryService>(
    TOKENS.AccountLifecycleQueryService,
    () => new AccountLifecycleQueryService(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<AccountSessionService>(
    TOKENS.AccountSessionService,
    () =>
      new AccountSessionService(
        container.resolve<AdminUserRepositoryPort>(TOKENS.AdminUserRepository),
        container.resolve<AdminSessionRepository>(TOKENS.AdminSessionRepository),
        container.resolve<AuditLogRepository>(TOKENS.AuditLogRepository)
      ),
    true
  );
  container.register<AccountLifecycleService>(
    TOKENS.AccountLifecycleService,
    () =>
      new AccountLifecycleService(
        container.resolve<AdminUserRepositoryPort>(TOKENS.AdminUserRepository),
        container.resolve<AdminSessionRepository>(TOKENS.AdminSessionRepository),
        container.resolve<RoleRepository>(TOKENS.RoleRepository),
        container.resolve<AuditLogRepository>(TOKENS.AuditLogRepository),
        container.resolve<AccountLifecycleQueryService>(TOKENS.AccountLifecycleQueryService),
        container.resolve<AccountSessionService>(TOKENS.AccountSessionService),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  container.register<AdminAuthService>(
    TOKENS.AdminAuthService,
    () => new AdminAuthService(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<AdminUserAdminService>(
    TOKENS.AdminUserAdminService,
    () =>
      new AdminUserAdminService(
        container.resolve<AdminUserRepositoryPort>(TOKENS.AdminUserRepository),
        container.resolve<RoleRepository>(TOKENS.RoleRepository),
        container.resolve<AdminSessionRepository>(TOKENS.AdminSessionRepository)
      ),
    true
  );
  container.register<CustomerAccountBillingService>(
    TOKENS.CustomerAccountBillingService,
    () =>
      new CustomerAccountBillingService(
        container.resolve(TOKENS.PrismaClient),
        container.resolve<AuditLogRepository>(TOKENS.AuditLogRepository)
      ),
    true
  );
  container.register<PricingAdminService>(
    TOKENS.PricingAdminService,
    () => new PricingAdminService(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<TemplateService>(
    TOKENS.TemplateService,
    () => new TemplateService(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.registerInstance(TOKENS.TemplateAnalytics, templateAnalytics);
  container.register<AuditEmitterPort>(
    TOKENS.AuditEmitterPort,
    () => new AuditEmitterAdapter(container.resolve<AuditLogRepository>(TOKENS.AuditLogRepository)),
    true
  );
  container.register<BillingService>(
    TOKENS.BillingService,
    () => new BillingService(container.resolve<AuditEmitterPort>(TOKENS.AuditEmitterPort)),
    true
  );
  container.register<SubscriptionPlanService>(
    TOKENS.SubscriptionPlanService,
    () => new SubscriptionPlanService(container.resolve(TOKENS.AccountSubscriptionQueryRepository)),
    true
  );
  container.register<SubscriptionStatsService>(
    TOKENS.SubscriptionStatsService,
    () => new SubscriptionStatsService(container.resolve(TOKENS.SubscriptionStatsQueryRepository)),
    true
  );
  container.register<SubscriptionManagementService>(
    TOKENS.SubscriptionManagementService,
    () =>
      new SubscriptionManagementService(
        container.resolve(TOKENS.AccountQueryRepository),
        container.resolve(TOKENS.AccountSubscriptionQueryRepository),
        container.resolve(TOKENS.AccountSubscriptionPort),
        container.resolve(TOKENS.ProjectQueryRepository),
        container.resolve(TOKENS.BillingService),
        container.resolve(TOKENS.AuditEmitterPort)
      ),
    true
  );
  container.register<TrialManagementService>(
    TOKENS.TrialManagementService,
    () =>
      new TrialManagementService(
        container.resolve(TOKENS.AccountRepository),
        container.resolve(TOKENS.AccountQueryRepository),
        container.resolve(TOKENS.AccountSubscriptionQueryRepository),
        container.resolve(TOKENS.SubscriptionPlanService),
        container.resolve(TOKENS.BillingService),
        container.resolve(TOKENS.AuditEmitterPort),
        container.resolve(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<SubscriptionService>(
    TOKENS.SubscriptionService,
    () =>
      new SubscriptionService(
        container.resolve(TOKENS.SubscriptionPlanService),
        container.resolve(TOKENS.SubscriptionManagementService),
        container.resolve(TOKENS.TrialManagementService),
        container.resolve(TOKENS.SubscriptionStatsService),
        container.resolve(TOKENS.BillingService)
      ),
    true
  );
  container.register<WebhookDashboardService>(
    TOKENS.WebhookDashboardService,
    () =>
      new WebhookDashboardService(
        container.resolve<import("@infra/prisma").PrismaClient>(TOKENS.PrismaClient)
      ),
    true
  );

  // Compliance
  container.register<ComplianceService>(
    TOKENS.ComplianceService,
    () => {
      const p = container.resolve<import("@infra/prisma").PrismaClient>(TOKENS.PrismaClient);
      const emailPort = container.resolve<EmailPort>(TOKENS.EmailPort);
      return new ComplianceService(p, emailPort);
    },
    true
  );
  container.register<DlqArchivalService>(
    TOKENS.DlqArchivalService,
    () =>
      new DlqArchivalService(
        container.resolve<import("@infra/prisma").PrismaClient>(TOKENS.PrismaClient)
      ),
    true
  );
  container.register<DataRetentionService>(
    TOKENS.DataRetentionService,
    () =>
      new DataRetentionService(
        container.resolve<import("@infra/prisma").PrismaClient>(TOKENS.PrismaClient)
      ),
    true
  );

  // Register RealtimeWebhookBroadcaster (F4D — SSE stream integration)
  container.register<RealtimeWebhookBroadcaster>(
    TOKENS.RealtimeWebhookBroadcaster,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      return new RealtimeWebhookBroadcaster(
        container.resolve<import("@infra/prisma").PrismaClient>(TOKENS.PrismaClient),
        redis,
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler)
      );
    },
    true
  );

  container.register<ProviderService>(
    TOKENS.ProviderService,
    () => new ProviderService(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.registerInstance(TOKENS.ProviderRegistry, providerRegistry);

  // Queue infrastructure: single Redis connection shared across all queue
  // adapters via the registry. Per-queue retry policy wired here so
  // producers don't need to pass `attempts`/`backoff` on every enqueue
  // call. Defaults follow the BullMQ canon — exponential backoff with
  // jitter to avoid thundering-herd on simultaneous failures. DLQ queues
  // set `attempts: 1` because they are terminal stores, not processing
  // queues.
  container.register<QueuePortRegistry>(
    TOKENS.QueuePortRegistry,
    () => {
      const connection = new Redis(env.REDIS_URL || "redis://localhost:6379", {
        enableReadyCheck: false,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        // ioredis defaults: commandTimeout = null (forever), connectTimeout = 10000.
        // 5 s on each so a hung Redis fails fast instead of stalling job
        // enqueues from API request handlers.
        commandTimeout: 5_000,
        connectTimeout: 5_000,
      });
      const defaultJobOptionsByQueue = {
        [QUEUE_NAMES.PUBLISH]: {
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 5000, jitter: 0.5 },
        },
        [QUEUE_NAMES.ANALYTICS_AGGREGATION]: {
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 5000, jitter: 0.5 },
        },
        [QUEUE_NAMES.INBOX_SYNC]: {
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 5000, jitter: 0.5 },
        },
        [QUEUE_NAMES.GENERATE_REPURPOSE]: {
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 10000, jitter: 0.5 },
        },
        [QUEUE_NAMES.WEBHOOK_PROCESSING]: {
          attempts: 5,
          backoff: { type: "exponential" as const, delay: 2000, jitter: 0.3 },
        },
        [QUEUE_NAMES.BULK_SCHEDULE]: {
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 5000, jitter: 0.5 },
        },
        // DLQs: terminal — no retry policy.
        [QUEUE_NAMES.DEAD_LETTER_QUEUE]: { attempts: 1 },
        [QUEUE_NAMES.WEBHOOK_DEAD_LETTER]: { attempts: 1 },
        [QUEUE_NAMES.FAILED_OPERATIONS_DLQ]: { attempts: 1 },
        [QUEUE_NAMES.BULK_SCHEDULE_DEAD_LETTER]: { attempts: 1 },
      };
      return new BullMQQueuePortRegistry({ connection, defaultJobOptionsByQueue });
    },
    true
  );
  container.register<QueuePort>(
    TOKENS.QueuePort,
    () =>
      container.resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry).forQueue(QUEUE_NAMES.PUBLISH),
    true
  );
  container.register<DeadLetterQueuePort>(
    TOKENS.DeadLetterQueuePort,
    () =>
      new BullMQDeadLetterQueueAdapter({
        registry: container.resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry),
      }),
    true
  );

  // Register Content Sync Services
  container.register<ContentVersionManager>(
    TOKENS.ContentVersionManager,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      const eventService = new EventService({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
      });
      return new ContentVersionManager({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        eventService,
        cache: container.resolve<CachePort>(TOKENS.CachePort),
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
        scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
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
        scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
      });
      const versionManager = container.resolve<ContentVersionManager>(TOKENS.ContentVersionManager);
      const synchronizer = new ContentSynchronizer({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        eventService,
        scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
      });
      return new SyncEngine({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        eventService,
        synchronizer,
        versionManager,
        scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
      });
    },
    true
  );

  // Register Analytics Services (M-8c)
  container.register<ThreadAnalytics>(
    TOKENS.ThreadAnalytics,
    () =>
      new ThreadAnalytics(
        container.resolve<CachePort>(TOKENS.CachePort),
        {} as ApiMetrics,
        container.resolve<AnalyticsReadRepositoryPort>(TOKENS.AnalyticsReadRepository),
        container.resolve<ThreadReadRepositoryPort>(TOKENS.ThreadReadRepository)
      ),
    true
  );
  // Future: GeoAnalyticsService — deleted (100% fake geographic distribution)

  // Register PostsService — shares the application-wide RedisCacheManager
  // singleton (prefix `api:`) instead of opening a second pool. Cache keys
  // built inside the service are namespaced via the `dashboard:posts:` /
  // `posts:total:` segments embedded in the key strings themselves, so the
  // singleton's global `api:` prefix layers cleanly without collisions.
  container.register(
    TOKENS.PostsService,
    () => {
      const dbOptimizer = new DatabaseOptimizer(
        container.resolve(TOKENS.PrismaClient),
        dbLogger,
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler)
      );
      const cacheManager = container.resolve<RedisCacheManager>(TOKENS.RedisCacheManager);
      return createPostsService(dbOptimizer, cacheManager);
    },
    true
  );

  // Register NotificationBroadcaster
  container.register<NotificationBroadcaster>(
    TOKENS.NotificationBroadcaster,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      const broadcaster = new NotificationBroadcaster(
        redis,
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler)
      );
      broadcaster.initialize();
      return broadcaster;
    },
    true
  );

  // Register AnalyticsStreamBroadcaster (SSE fan-out for real-time metrics)
  container.register<AnalyticsStreamBroadcaster>(
    TOKENS.AnalyticsStreamBroadcaster,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      const broadcaster = new AnalyticsStreamBroadcaster(
        redis,
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler)
      );
      broadcaster.initialize();
      return broadcaster;
    },
    true
  );

  // Register RealtimeAnalyticsService (constructing it starts the 30s metrics poll)
  container.register<RealtimeAnalyticsService>(
    TOKENS.RealtimeAnalyticsService,
    () =>
      new RealtimeAnalyticsService(
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
        container.resolve<CachePort>(TOKENS.CachePort),
        container.resolve<AnalyticsReadRepositoryPort>(TOKENS.AnalyticsReadRepository),
        container.resolve<AnalyticsStreamBroadcaster>(TOKENS.AnalyticsStreamBroadcaster)
      ),
    true
  );

  // Register GA4 Tracking Adapter
  container.register<GA4TrackingAdapter>(
    TOKENS.GA4TrackingPort,
    () => new GA4TrackingAdapter(),
    true
  );

  // Register EmailPort
  container.register<EmailPort>(TOKENS.EmailPort, () => new ResendEmailAdapter(), true);

  // Register BusinessMetricsPort
  container.register<BusinessMetricsPort>(
    TOKENS.BusinessMetricsPort,
    () => new PrometheusBusinessMetricsAdapter(),
    true
  );

  // Register PasswordHasher (Argon2id; backs passwords + API keys + backup codes)
  container.register<PasswordHasher>(TOKENS.PasswordHasher, () => new Argon2PasswordHasher(), true);

  // Register CustomerTokenService (HS256 JWT; backs customer auth token lifecycle)
  container.register<CustomerTokenService>(
    TOKENS.CustomerTokenService,
    () => new CustomerTokenServiceAdapter(),
    true
  );

  // Register the transactional-email role ports (one adapter backs all four).
  const transactionalEmailAdapter = () =>
    new TransactionalEmailAdapter(
      container.resolve<EmailPort>(TOKENS.EmailPort),
      env.CLIENT_URL ?? "http://localhost:3002"
    );
  container.register<ReferralRewardMailer>(
    TOKENS.ReferralRewardMailer,
    transactionalEmailAdapter,
    true
  );
  container.register<WelcomeMailer>(TOKENS.WelcomeMailer, transactionalEmailAdapter, true);
  container.register<TeamInvitationMailer>(
    TOKENS.TeamInvitationMailer,
    transactionalEmailAdapter,
    true
  );
  container.register<NotificationMailer>(
    TOKENS.NotificationMailer,
    transactionalEmailAdapter,
    true
  );

  // Register SagaManager
  container.register<SagaManagerImpl>(
    TOKENS.SagaManager,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      const eventService = new EventService({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
      });
      return new SagaManagerImpl({
        prisma: container.resolve(TOKENS.PrismaClient),
        redis,
        eventService,
        scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
        enableMetrics: true,
        defaultTimeout: 30 * 60 * 1000,
        maxConcurrentSagas: 100,
      });
    },
    true
  );

  // Register Platform Encryption Services
  // AuditService singleton (registered earlier in this setup) is reused as
  // the decrypt-audit port for EncryptionService — every decrypt() emits
  // an audit event via this port.
  container.register<EncryptionService>(
    TOKENS.EncryptionService,
    () =>
      new EncryptionService({
        auditPort: container.resolve<AuditService>(TOKENS.AuditService),
      }),
    true
  );
  container.register<ChannelCredentialsCrypto>(
    TOKENS.ChannelCredentialsCrypto,
    () =>
      new ChannelCredentialsCrypto(container.resolve<EncryptionService>(TOKENS.EncryptionService)),
    true
  );
  // Platform credential adapter — implements PlatformCredentialRepository
  // (raw envelope storage). Same instance also serves the EncryptionPort token
  // below for service injection.
  container.register<PlatformCredentialRepository>(
    TOKENS.PlatformCredentialRepository,
    () => new PrismaPlatformCredentialRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  // EncryptionPort token resolves to the existing EncryptionService instance.
  container.register<EncryptionPort>(
    TOKENS.EncryptionPort,
    () => container.resolve<EncryptionService>(TOKENS.EncryptionService),
    true
  );
  container.register<PlatformCredentialService>(
    TOKENS.PlatformCredentialService,
    () =>
      new PlatformCredentialService(
        container.resolve<PlatformCredentialRepository>(TOKENS.PlatformCredentialRepository),
        container.resolve<EncryptionPort>(TOKENS.EncryptionPort),
        container.resolve(TOKENS.AuditEmitterPort)
      ),
    true
  );

  // Register Settings Service
  container.register<SettingsService>(
    TOKENS.SettingsService,
    () =>
      new SettingsService(
        container.resolve<PlatformCredentialService>(TOKENS.PlatformCredentialService),
        container.resolve(TOKENS.PrismaClient)
      ),
    true
  );
}
