/**
 * @file setupServices.ts
 * @description Registers all application services and infrastructure singletons in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { registerRedisConnections } from "./registerRedisConnections.js";
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
import { MfaService } from "../../admin/auth/MfaService.js";
import { PrismaAdminMfaUserRepository } from "../adapters/PrismaAdminMfaUserRepository.js";
import type { MfaUserRepositoryPort } from "@ports/core";
import { RbacService } from "../../auth/rbacService.js";
import { RoleManagementService } from "@core/auth/RoleManagementService.js";
import { PrismaRoleManagementRepository } from "../repositories/PrismaRoleManagementRepository.js";
import type { RoleManagementRepository } from "@core/domain/repositories/RoleManagementRepository.js";
import { RbacCacheInvalidatorAdapter } from "../../auth/RbacCacheInvalidatorAdapter.js";
import type { RbacCacheInvalidatorPort } from "@core/domain/repositories/RbacCacheInvalidatorPort.js";
import { AuditService } from "../../audit/auditService.js";
import { ActivityFeedService } from "../../audit/activityFeedService.js";
import { AIService } from "../../ai/aiService.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import type { HttpClientPort } from "@core/domain/repositories/HttpClientPort.js";
import { FetchHttpClient } from "../adapters/FetchHttpClient.js";
import { AiRequestService } from "@core/ai/AiRequestService.js";
import { AIRequestExecutorAdapter } from "../../ai/AIRequestExecutorAdapter.js";
import { AICircuitBreaker } from "../../ai/providers/AICircuitBreaker.js";
import { RedisTokenBucketRateLimiter } from "../../ai/providers/RedisTokenBucketRateLimiter.js";
import type { RateLimiterPort } from "@ports/core";
import type { AIRequestExecutorPort } from "@core/domain/repositories/AIRequestExecutorPort.js";
import { DashboardService } from "../../admin/dashboardService.js";
import { AccountLifecycleService } from "../../admin/accountLifecycleService.js";
import { AccountSessionService } from "../../admin/AccountSessionService.js";
import { AdminAuthService } from "../../admin/auth/AdminAuthService.js";
import { AdminUserAdminService } from "../../admin/AdminUserAdminService.js";
import { CustomerAccountBillingService } from "../../admin/CustomerAccountBillingService.js";
import { PricingAdminService } from "../../admin/PricingAdminService.js";
import { TemplateService } from "../../templates/templateService.js";
import { templateAnalytics } from "../../templates/templateAnalytics.js";
import { BillingService } from "@core/billing/BillingService.js";
import { SubscriptionPlanService } from "@core/billing/SubscriptionPlanService.js";
import { SubscriptionManagementService } from "@core/billing/SubscriptionManagementService.js";
import { TrialManagementService } from "@core/billing/TrialManagementService.js";
import { SubscriptionStatsService } from "@core/billing/SubscriptionStatsService.js";
import { SubscriptionService } from "@core/billing/SubscriptionService.js";
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
import { ComplianceService } from "@core/compliance/ComplianceService.js";
import { DataRetentionService } from "@core/compliance/DataRetentionService.js";
import { DlqArchivalService } from "@core/webhooks/DlqArchivalService.js";
import { PrismaWebhookDeadLetterArchivalRepository } from "../repositories/PrismaWebhookDeadLetterArchivalRepository.js";
import type { WebhookDeadLetterArchivalPort } from "@core/domain/repositories/WebhookDeadLetterArchivalPort.js";
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
import { PrismaPlatformEncryptionKeyRepository } from "../repositories/PrismaPlatformEncryptionKeyRepository.js";
import type { PlatformEncryptionKeyRepository } from "@core/domain/repositories/PlatformEncryptionKeyRepository.js";
import { PrismaAiTokenUsageRepository } from "../repositories/PrismaAiTokenUsageRepository.js";
import type { AiTokenUsageReader } from "@core/domain/repositories/AiTokenUsageReader.js";
import { PrismaAccountBillingRepository } from "../repositories/PrismaAccountBillingRepository.js";
import type { AccountBillingRepository } from "@core/domain/repositories/AccountBillingRepository.js";
import { PrismaAccountSubscriptionBillingRepository } from "../repositories/PrismaAccountSubscriptionBillingRepository.js";
import type { AccountSubscriptionBillingRepository } from "@core/domain/repositories/AccountSubscriptionBillingRepository.js";
import { PrismaGdprSettingsRepository } from "../repositories/PrismaGdprSettingsRepository.js";
import type { GdprSettingsRepository } from "@core/domain/repositories/GdprSettingsRepository.js";
import { PrismaSecuritySettingsRepository } from "../repositories/PrismaSecuritySettingsRepository.js";
import type { SecuritySettingsRepository } from "@core/domain/repositories/SecuritySettingsRepository.js";
import { PrismaDsarRequestRepository } from "../repositories/PrismaDsarRequestRepository.js";
import type { DsarRequestRepository } from "@core/domain/repositories/DsarRequestRepository.js";
import { PrismaDataBreachReportRepository } from "../repositories/PrismaDataBreachReportRepository.js";
import type { DataBreachReportRepository } from "@core/domain/repositories/DataBreachReportRepository.js";
import { PrismaAuditLogRetentionRepository } from "../repositories/PrismaAuditLogRetentionRepository.js";
import type { AuditLogRetentionPort } from "@core/domain/repositories/AuditLogRetentionPort.js";
import { PrismaAccountNotificationRepository } from "../repositories/PrismaAccountNotificationRepository.js";
import type { AccountNotificationReader } from "@core/domain/repositories/AccountNotificationReader.js";
import { ChannelCredentialsCrypto } from "../../security/ChannelCredentialsCrypto.js";
import { PlatformCredentialService } from "@core/security/PlatformCredentialService.js";
import { PlatformCredentialAdapter } from "./adapters/PlatformCredentialAdapter.js";
import { SettingsService } from "@core/settings/SettingsService.js";
import { UpcasterChain } from "../integration-events/EventUpcaster.js";
import { NotificationBroadcaster } from "../../services/NotificationBroadcaster.js";
import { AnalyticsStreamBroadcaster } from "../../services/AnalyticsStreamBroadcaster.js";
import { StreamConnectionTracker } from "../../services/StreamConnectionTracker.js";
import { RedisBruteForceAdapter } from "../adapters/RedisBruteForceAdapter.js";
import type { BruteForceProtectionPort } from "@ports/core";
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
import { Redis } from "ioredis";
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

  // MFA-user persistence adapters. The AdminUser adapter is wired now; the
  // customer subject resolves to the same admin adapter until the CustomerUser
  // columns and adapter land, keeping admin MFA behavior unchanged.
  container.register<MfaUserRepositoryPort>(
    TOKENS.AdminMfaUserRepository,
    () => new PrismaAdminMfaUserRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<MfaUserRepositoryPort>(
    TOKENS.CustomerMfaUserRepository,
    () => container.resolve<MfaUserRepositoryPort>(TOKENS.AdminMfaUserRepository),
    true
  );

  // Unified, port-based MFA service — the single MFA capability for both admin
  // and customer subjects. SMELL-37 is closed: the legacy `auth/mfaService.ts`
  // factory is gone and there is exactly ONE registration under
  // TOKENS.MfaService, so every consumer (AuthService, AdminAuthService,
  // mfaRoutes) resolves the same instance.
  container.register<MfaService>(
    TOKENS.MfaService,
    () =>
      new MfaService(
        container.resolve<MfaUserRepositoryPort>(TOKENS.AdminMfaUserRepository),
        container.resolve<MfaUserRepositoryPort>(TOKENS.CustomerMfaUserRepository),
        container.resolve<AuditLogRepository>(TOKENS.AuditLogRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
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
  // RoleManagementService (@core/application) + its two ports.
  container.register<RoleManagementRepository>(
    TOKENS.RoleManagementRepository,
    () => new PrismaRoleManagementRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<RbacCacheInvalidatorPort>(
    TOKENS.RbacCacheInvalidatorPort,
    () => new RbacCacheInvalidatorAdapter(container.resolve<RbacService>(TOKENS.RbacService)),
    true
  );
  container.register<RoleManagementService>(
    TOKENS.RoleManagementService,
    () =>
      new RoleManagementService(
        container.resolve<RoleManagementRepository>(TOKENS.RoleManagementRepository),
        container.resolve<RbacCacheInvalidatorPort>(TOKENS.RbacCacheInvalidatorPort)
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
  // Single per-process circuit breaker shared by every orchestrator instance
  // (the per-request orchestrators built inside AIRequestExecutorAdapter and
  // the admin orchestrator in AIService). Sharing it is the whole point:
  // breaker state must outlive the ephemeral orchestrators so a tripped
  // provider stays skipped across requests.
  container.register<AICircuitBreaker>(TOKENS.AICircuitBreaker, () => new AICircuitBreaker(), true);
  // Cross-pod token-bucket rate limiter for outbound provider calls. Its own
  // Redis connection (independent failure domain from cache/queue); fail-open
  // so a limiter outage never blocks AI traffic. Shared singleton so every
  // ephemeral orchestrator throttles against the same buckets.
  container.register<RateLimiterPort>(
    TOKENS.RateLimiterPort,
    () =>
      new RedisTokenBucketRateLimiter(createRedisConnection(), {
        capacity: env.AI_PROVIDER_REQUESTS_PER_MIN,
      }),
    true
  );
  // Cross-pod token-bucket limiter for INBOUND HTTP requests (same port +
  // algorithm as the AI one — one rate-limiting canon — a distinct instance
  // with its own key prefix + Redis connection). Per-path capacity/window come
  // from the rule table passed per call by the HTTP preHandler.
  container.register<RateLimiterPort>(
    TOKENS.HttpRateLimiter,
    () =>
      new RedisTokenBucketRateLimiter(createRedisConnection(), {
        keyPrefix: "http:ratelimit:",
      }),
    true
  );
  // AIRequestExecutor adapter wraps AIProviderFactory + AIOrchestrator so
  // AiRequestService can live in @core/application.
  container.register<AIRequestExecutorPort>(
    TOKENS.AIRequestExecutorPort,
    () =>
      new AIRequestExecutorAdapter(
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
        container.resolve<CachePort>(TOKENS.CachePort),
        container.resolve<AICircuitBreaker>(TOKENS.AICircuitBreaker),
        container.resolve<RateLimiterPort>(TOKENS.RateLimiterPort)
      ),
    true
  );
  container.register<AiRequestService>(
    TOKENS.AiRequestService,
    () =>
      new AiRequestService(
        new PlatformCredentialAdapter(
          container.resolve<PlatformCredentialService>(TOKENS.PlatformCredentialService)
        ),
        container.resolve<AIRequestExecutorPort>(TOKENS.AIRequestExecutorPort),
        container.resolve<AccountSubscriptionBillingRepository>(
          TOKENS.AccountSubscriptionBillingRepository
        ),
        container.resolve<AiTokenUsageReader>(TOKENS.AiTokenUsageReader)
      ),
    true
  );

  container.register<AIService>(
    TOKENS.AIService,
    () =>
      new AIService(
        container.resolve<AiRequestService>(TOKENS.AiRequestService),
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
        container.resolve<CachePort>(TOKENS.CachePort),
        container.resolve<AICircuitBreaker>(TOKENS.AICircuitBreaker),
        container.resolve<RateLimiterPort>(TOKENS.RateLimiterPort)
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
    () =>
      new AdminAuthService(
        container.resolve(TOKENS.PrismaClient),
        container.resolve<BruteForceProtectionPort>(TOKENS.BruteForceProtectionPort),
        // Unified MFA service resolved from the single TOKENS.MfaService
        // registration (SMELL-37: the inline `new MfaService(prisma)` inside
        // AdminAuthService was deleted; one instance backs every consumer).
        container.resolve<MfaService>(TOKENS.MfaService)
      ),
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

  // Compliance ports (GdprSettings, SecuritySettings, DsarRequest,
  // DataBreachReport, AuditLogRetention, AccountNotification).
  container.register<GdprSettingsRepository>(
    TOKENS.GdprSettingsRepository,
    () => new PrismaGdprSettingsRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<SecuritySettingsRepository>(
    TOKENS.SecuritySettingsRepository,
    () => new PrismaSecuritySettingsRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<DsarRequestRepository>(
    TOKENS.DsarRequestRepository,
    () => new PrismaDsarRequestRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<DataBreachReportRepository>(
    TOKENS.DataBreachReportRepository,
    () => new PrismaDataBreachReportRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<AuditLogRetentionPort>(
    TOKENS.AuditLogRetentionPort,
    () => new PrismaAuditLogRetentionRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<AccountNotificationReader>(
    TOKENS.AccountNotificationReader,
    () => new PrismaAccountNotificationRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<ComplianceService>(
    TOKENS.ComplianceService,
    () =>
      new ComplianceService(
        container.resolve<GdprSettingsRepository>(TOKENS.GdprSettingsRepository),
        container.resolve<SecuritySettingsRepository>(TOKENS.SecuritySettingsRepository),
        container.resolve<DsarRequestRepository>(TOKENS.DsarRequestRepository),
        container.resolve<DataBreachReportRepository>(TOKENS.DataBreachReportRepository),
        container.resolve<AuditLogRetentionPort>(TOKENS.AuditLogRetentionPort),
        container.resolve<AccountNotificationReader>(TOKENS.AccountNotificationReader),
        container.resolve<EmailPort>(TOKENS.EmailPort),
        container.resolve(TOKENS.AuditEmitterPort)
      ),
    true
  );
  container.register<WebhookDeadLetterArchivalPort>(
    TOKENS.WebhookDeadLetterArchivalPort,
    () => new PrismaWebhookDeadLetterArchivalRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  container.register<DlqArchivalService>(
    TOKENS.DlqArchivalService,
    () =>
      new DlqArchivalService(
        container.resolve<WebhookDeadLetterArchivalPort>(TOKENS.WebhookDeadLetterArchivalPort)
      ),
    true
  );
  container.register<DataRetentionService>(
    TOKENS.DataRetentionService,
    () =>
      new DataRetentionService(
        container.resolve<GdprSettingsRepository>(TOKENS.GdprSettingsRepository),
        container.resolve<AuditLogRetentionPort>(TOKENS.AuditLogRetentionPort),
        container.resolve<DsarRequestRepository>(TOKENS.DsarRequestRepository),
        container.resolve(TOKENS.AuditEmitterPort)
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

  // Role-separated Redis connections, owned by the composition root and
  // injected into every consuming unit. Extracted into a small testable seam
  // (registerRedisConnections) so the wiring smoke drives the REAL registration
  // rather than a reimplementation. BullMQ canon (docs.bullmq.io/guide/
  // connections): worker and subscriber connections require
  // maxRetriesPerRequest:null; producers/counters use finite retries; opposite
  // retry strategies must not share one socket. Each is a singleton; lifecycle
  // (quit) is owned here, sequenced in the apps/api shutdown handler.
  registerRedisConnections(container);

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
      const connection = new Redis(getRedisUrl(), {
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
        container.resolve<ApiMetrics>(TOKENS.ApiMetrics),
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

  // Register StreamConnectionTracker (per-account SSE cap — DoS protection,
  // shared by /analytics/stream and /notifications/stream).
  container.register<StreamConnectionTracker>(
    TOKENS.StreamConnectionTracker,
    () => new StreamConnectionTracker(env.MAX_STREAMS_PER_ACCOUNT),
    true
  );

  // Register BruteForceProtectionPort — single source of brute-force
  // throttling for both customer and admin login. Uses a dedicated Redis
  // connection (commandTimeout: 5s) to fail-open fast if Redis stalls,
  // instead of stalling login. Singleton.
  container.register<BruteForceProtectionPort>(
    TOKENS.BruteForceProtectionPort,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {
        // Errors surface via the adapter's fail-open path (logged + metric).
      });
      return new RedisBruteForceAdapter(
        redis,
        container.resolve<AuditService>(TOKENS.AuditService),
        container.resolve<ApiMetrics>(TOKENS.ApiMetrics)
      );
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

  // Platform encryption-key adapter — implements PlatformEncryptionKeyRepository
  // (rotation log for the platform-wide data-key).
  container.register<PlatformEncryptionKeyRepository>(
    TOKENS.PlatformEncryptionKeyRepository,
    () => new PrismaPlatformEncryptionKeyRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  // AI token-usage reader — implements AiTokenUsageReader for monthly aggregation.
  container.register<AiTokenUsageReader>(
    TOKENS.AiTokenUsageReader,
    () => new PrismaAiTokenUsageRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  // Account billing adapter — implements AccountBillingRepository (raw
  // read/write of billing-specific fields on the Account row).
  container.register<AccountBillingRepository>(
    TOKENS.AccountBillingRepository,
    () => new PrismaAccountBillingRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  // Account-subscription billing adapter.
  container.register<AccountSubscriptionBillingRepository>(
    TOKENS.AccountSubscriptionBillingRepository,
    () => new PrismaAccountSubscriptionBillingRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
  // Register Settings Service
  container.register<SettingsService>(
    TOKENS.SettingsService,
    () =>
      new SettingsService(
        new PlatformCredentialAdapter(
          container.resolve<PlatformCredentialService>(TOKENS.PlatformCredentialService)
        ),
        container.resolve<PlatformEncryptionKeyRepository>(TOKENS.PlatformEncryptionKeyRepository),
        container.resolve<AiTokenUsageReader>(TOKENS.AiTokenUsageReader),
        container.resolve(TOKENS.AuditEmitterPort)
      ),
    true
  );
}
