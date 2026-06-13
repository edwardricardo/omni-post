/**
 * @file index.ts
 * @description API server entry point. Initializes OpenTelemetry, configures
 *              Fastify with all plugins and routes, and starts the HTTP server.
 *              Environment loading and validation are owned by `./config/env.ts`,
 *              which executes via the import below.
 * @layer infrastructure
 */
import { env } from "./config/env.js";

import { createLogger } from "./lib/logger.js";
const otelLogger = createLogger("api-telemetry");

if (env.TRACING_ENABLED) {
  try {
    const otel = await import("@observability/opentelemetry");
    const telemetry = otel.createApiTelemetry(env.NODE_ENV);
    await telemetry.start();
    otelLogger.info("OpenTelemetry initialized for API server");
  } catch (error) {
    otelLogger.warn(
      { err: error },
      "Failed to initialize OpenTelemetry -- continuing without tracing. " +
        "This is expected if Jaeger is not running."
    );
  }
} else {
  otelLogger.info("Tracing disabled (TRACING_ENABLED != true)");
}

// Fastify v5.6.1 Import Syntax
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
  jsonSchemaTransform,
} from "fastify-type-provider-zod";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { closeDatabaseConnections, prisma, verifyDatabaseAuth } from "@infra/prisma";
import type { QueuePortRegistry } from "@ports/core";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { RealtimeAnalyticsService } from "./analytics/realtimeAnalytics.js";
import type { AnalyticsStreamBroadcaster } from "./services/AnalyticsStreamBroadcaster.js";
import client from "prom-client";
import { createStorageAdapter } from "./infrastructure/storage/createStorageAdapter.js";
import {
  createHttpRateLimitPreHandler,
  RateLimitConfigs,
  STANDARD_ROUTE_RULES,
  EXPENSIVE_ENDPOINT_RULES,
} from "./security/httpRateLimitPreHandler.js";
import type { RateLimiterPort } from "@ports/core";
import { createErrorHandler } from "./lib/errors/errorHandler.js";
import { createRedisConnection, getRedisUrl } from "./lib/redis.js";
import type Redis from "ioredis";
import { logger } from "./lib/logger.js";
import { ApiMetrics } from "./metrics/apiMetrics.js";
import { createMetricsMiddleware } from "./middleware/metricsMiddleware.js";
import { createCircuitBreakerMonitor } from "@monitoring/circuit-breaker";
import { createDeadLetterQueue } from "@adapters/dead-letter-queue";
import { QUEUE_NAMES, createBullMQConsumerAdapter } from "@adapters/queue-bullmq";
import type { CachePort, AgentOrchestrationPort } from "@ports/core";
import { processRepurposeGenerateJob } from "./ai/consumers/repurposeGenerateHandler.js";
import { processRepurposeDetectJob } from "./ai/consumers/repurposeDetectHandler.js";
import { processTriageInboxJob } from "./ai/consumers/triageInboxHandler.js";
import { processTrendRadarJob } from "./ai/consumers/trendRadarHandler.js";
import type { DetectTrendsUseCase } from "@core/trends/DetectTrendsUseCase.js";
import type { DispatchDetectTrendsUseCase } from "@core/trends/DispatchDetectTrendsUseCase.js";
import {
  TriageDispatchEventHandler,
  TRIAGE_HANDLED_EVENT_TYPES,
} from "./inbox/handlers/TriageDispatchEventHandler.js";
import {
  BulkScheduleDispatchEventHandler,
  BULK_SCHEDULE_HANDLED_EVENT_TYPES,
} from "./bulk-scheduling/BulkScheduleDispatchEventHandler.js";
import type { BulkScheduleReconciliationService } from "./bulk-scheduling/BulkScheduleReconciliationService.js";
import type { TriageInboxMessageUseCase } from "@core/inbox/TriageInboxMessageUseCase.js";
import { PrismaRepurposeVariantAdapter } from "./infrastructure/repositories/PrismaRepurposeVariantAdapter.js";
import type { DetectRepurposeCandidatesUseCase } from "@core/ai/DetectRepurposeCandidatesUseCase.js";
import { startBulkScheduleWorker } from "./bulk-scheduling/bulkScheduleWorker.js";
import type { ProcessBulkScheduleRowUseCase } from "@core/bulk-scheduling/ProcessBulkScheduleRowUseCase.js";
import type { FailBulkScheduleRowUseCase } from "@core/bulk-scheduling/FailBulkScheduleRowUseCase.js";
import { startAnalyticsIngestConsumer } from "./analytics/analyticsIngestConsumer.js";
import { startInboxSyncConsumer } from "./inbox/inboxSyncConsumer.js";
import type { IngestChannelAnalyticsUseCase } from "@core/analytics/IngestChannelAnalyticsUseCase.js";
import type { SyncProviderCommentsUseCase } from "@core/inbox/SyncProviderCommentsUseCase.js";
import type { UpdateChannelAuthStateUseCase } from "@core/channels/UpdateChannelAuthStateUseCase.js";
import type { DispatchDetectRepurposeUseCase } from "@core/ai/DispatchDetectRepurposeUseCase.js";
import type { RedisCacheManager } from "@adapters/cache-redis";
import fastifyCookie from "@fastify/cookie";
import { createTenantHealthMonitor } from "@monitoring/health-checks";
import { authRoutes } from "./auth/authRoutes.js";
import { setRedisInstance } from "./auth/redisSessionHelpers.js";
import { auditRoutes } from "./audit/auditRoutes.js";
import { activityFeedRoutes } from "./audit/activityFeedRoutes.js";
import { auditMiddleware } from "./audit/auditMiddleware.js";
import { mfaRoutes } from "./auth/mfaRoutes.js";
import { rbacRoutes } from "./auth/rbacRoutes.js";
import { accountLifecycleRoutes } from "./admin/accountLifecycleRoutes.js";
import { pricingRoutes } from "./admin/pricingRoutes.js";
import { adminUserRoutes } from "./admin/adminUserRoutes.js";
import { adminAuthRoutes } from "./admin/auth/adminAuthRoutes.js";
import { analyticsRoutes as adminAnalyticsRoutes } from "./admin/analyticsRoutes.js";
import { schedulingRoutes } from "./admin/schedulingRoutes.js";
import { schedulingClientRoutes } from "./scheduling/schedulingClientRoutes.js";
import { queueRoutes } from "./admin/queueRoutes.js";
import { subscriptionRoutes } from "./billing/subscriptionRoutes.js";
import { clientBillingRoutes } from "./billing/clientBillingRoutes.js";
import { adminBillingRoutes } from "./billing/adminBillingRoutes.js";
import { billingWebhookRoutes } from "./billing/billingWebhookRoutes.js";
import { complianceRoutes } from "./compliance/complianceRoutes.js";
import { settingsRoutes } from "./settings/settingsRoutes.js";
import { outboxAdminRoutes } from "./outbox/outboxAdminRoutes.js";
import { registerOAuthRoutes } from "./auth/providerOAuth.js";
import { setupContainer } from "./infrastructure/container/setup.js";
import { TOKENS } from "./infrastructure/container/types.js";
import type { OutboxRelay } from "./infrastructure/outbox/OutboxRelay.js";
import type { OutboxCleaner } from "./infrastructure/outbox/OutboxCleaner.js";
import type { EventDispatcher } from "@core/domain/events/DomainEvent.js";
import type { EventService } from "./events/EventService.js";
import type { CQRSBusImpl } from "./cqrs/CQRSBus.js";
import type { SemanticLockPort } from "@ports/core";
import {
  IntegrationEventDeliveryHandler,
  HANDLED_EVENT_TYPES as INTEGRATION_HANDLED_EVENT_TYPES,
} from "./integrations/IntegrationEventDeliveryHandler.js";
import { crisisRoutes } from "./projects/crisisRoutes.js";
import { linkRoutes } from "./links/linkRoutes.js";
import { teamRoutes } from "./team/teamRoutes.js";
import { notificationRoutes } from "./notifications/notificationRoutes.js";
import { approvalRoutes } from "./approvals/approvalRoutes.js";
import { approvalWorkflowRoutes } from "./approvals/approvalWorkflowRoutes.js";
import { onboardingRoutes } from "./onboarding/onboardingRoutes.js";
import { announcementRoutes } from "./announcements/announcementRoutes.js";
import { commentRoutes } from "./comments/commentRoutes.js";
import { inboxRoutes } from "./inbox/inboxRoutes.js";
import { listeningRoutes } from "./listening/listeningRoutes.js";
import { bulkScheduleRoutes } from "./bulk-scheduling/bulkScheduleRoutes.js";
import { conversationNoteRoutes } from "./inbox/conversationNoteRoutes.js";
import { campaignRoutes } from "./campaigns/campaignRoutes.js";
import { utmRoutes } from "./utm/utmRoutes.js";
import { reportRoutes } from "./reports/reportRoutes.js";
import { firstCommentRoutes } from "./first-comment/firstCommentRoutes.js";
import { externalNotificationRoutes } from "./external-notifications/externalNotificationRoutes.js";
import { aiImageRoutes } from "./ai-image/aiImageRoutes.js";
import { recurringPostRoutes } from "./recurring/recurringPostRoutes.js";
import { repurposeRoutes } from "./repurpose/repurposeRoutes.js";
import { promptTemplateRoutes } from "./ai/promptTemplateRoutes.js";
import { usageRoutes } from "./usage/usageRoutes.js";
import { brandVoiceRoutes } from "./brand-voice/brandVoiceRoutes.js";
import { brandKitRoutes } from "./brand-kit/brandKitRoutes.js";
import { assetRoutes } from "./assets/assetRoutes.js";
import { zapierRoutes } from "./integrations/zapierRoutes.js";
import { makeRoutes } from "./integrations/makeRoutes.js";
import { taskRoutes } from "./tasks/taskRoutes.js";
import { samlRoutes } from "./auth/samlRoutes.js";
import { oidcRoutes } from "./auth/oidcRoutes.js";
import { customReportRoutes } from "./custom-reports/customReportRoutes.js";
import { crmRoutes } from "./crm/crmRoutes.js";
import { customerAuthRoutes } from "./auth/customerAuthRoutes.js";

import { SecurityManager } from "./security/securityHeaders.js";
import { PerformanceMonitor } from "./monitoring/performanceMonitor.js";
import { analyticsRoutes } from "./analytics/analyticsRoutes.js";
import aiRoutes from "./ai/routes.js";

// Cache middleware
import { autoCachePlugin } from "./middleware/autoCacheMiddleware.js";

// Fastify v5.6.1 Application Creation
async function createApp(): Promise<FastifyInstance> {
  // Fastify v5.6.1 constructor syntax
  const app = Fastify({
    logger: true,
    trustProxy: true,
    // Bound the two HTTP defaults Fastify inherits from Node:
    //   keepAliveTimeout = 72000 ms   → 5 s (LB manages connection reuse)
    //   requestTimeout   = 0 (none)   → 30 s (matches typical API SLA)
    // Together they prevent socket hoarding and indefinite request hangs.
    keepAliveTimeout: 5_000,
    requestTimeout: 30_000,
  });

  // Apply ZodTypeProvider for type safety
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Set up Zod validation compiler
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  // Register OpenAPI documentation (before routes so schemas are captured).
  // `transform: jsonSchemaTransform` converts Zod schemas to OpenAPI 3.0
  // JSON Schema before the swagger plugin emits them; without it the spec
  // contains raw `{ def: ... }` from Zod 4 and downstream generators
  // (hey-api, openapi-typescript) emit `{[key:string]: unknown}` instead of
  // the real types.
  const fastifySwagger = await import("@fastify/swagger");
  await typedApp.register(fastifySwagger.default, {
    transform: jsonSchemaTransform,
    openapi: {
      info: {
        title: "OmniPost API",
        description:
          "Multi-tenant social media CMS API — manage posts, scheduling, analytics, " +
          "and publishing across multiple platforms.",
        version: "3.1.0",
      },
      servers: [{ url: "http://localhost:3000", description: "Local development" }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
          apiKey: {
            type: "apiKey",
            in: "header",
            name: "X-API-Key",
          },
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "admin-session",
          },
        },
      },
    },
  });

  const scalarRef = await import("@scalar/fastify-api-reference");
  await typedApp.register(scalarRef.default, {
    routePrefix: "/docs",
    configuration: {
      theme: "kepler",
      url: "/docs/json",
    },
  });

  // Expose raw JSON spec
  typedApp.get("/docs/json", async (_request, reply) => {
    return reply.send(typedApp.swagger?.() ?? {});
  });

  // Initialize Redis for advanced rate limiting
  const redis = createRedisConnection();

  // Initialize unified authentication service with Redis
  setRedisInstance(redis);

  // Build the Prometheus-backed metrics collector BEFORE the container so it
  // can be registered as a singleton and resolved by infra wiring that emits
  // metrics (BF adapter, etc.) rather than receiving `{} as ApiMetrics`.
  const apiMetrics = new ApiMetrics(client.register);

  // Initialize DI container and decorate Fastify instance (needed so scheduler is
  // available to downstream adapters/managers created below).
  const container = setupContainer({ prisma, apiMetrics });
  typedApp.decorate("container", container);
  const bootstrapScheduler = container.resolve<BackgroundTaskScheduler>(
    TOKENS.BackgroundTaskScheduler
  );

  // Decorate Fastify with the application-tier cache port. Single
  // decoration semantically scoped to "caching for routes + middleware".
  // Ops tooling (cacheStatsRoutes) resolves the concrete RedisCacheManager
  // from the DI container directly — never via this decoration.
  const cachePort = container.resolve<CachePort>(TOKENS.CachePort);
  typedApp.decorate("redis", redis);
  typedApp.decorate("cache", cachePort);

  // Concrete RedisCacheManager — kept as a local reference for ops-tier
  // consumers (health checks, tenant monitor, healthRoutes plugin) that
  // need access to features outside the CachePort surface (`getStats`,
  // `healthCheck`, raw `Result`-shaped reads).
  const cacheManager = container.resolve<RedisCacheManager>(TOKENS.RedisCacheManager);

  // Register auto-cache middleware for automatic caching and invalidation
  // (autoCachePlugin handles both caching and cache-plugin functionality)
  await typedApp.register(autoCachePlugin, {
    cache: cachePort,
    enableCaching: true,
    enableInvalidation: true,
    logCacheOps: env.LOG_CACHE_OPS ?? false,
    excludeRoutes: ["/health", "/metrics"],
  });

  // Initialize cookie support. The plugin uses CommonJS-style export
  // (`export = fastifyCookie`) and the default import surfaces as the
  // `FastifyCookie` namespace, which does not satisfy
  // `FastifyPluginCallback` directly under strict type checks.
  type CookiePlugin = Parameters<typeof typedApp.register>[0];
  await typedApp.register(fastifyCookie as unknown as CookiePlugin, {
    secret: env.COOKIE_SECRET,
  });

  // Initialize components
  const repoAdapter = createPrismaRepoAdapter({ prisma, scheduler: bootstrapScheduler });
  // Queue adapter resolved from the registry so this top-level wiring
  // shares the same Redis connection and queue instances as the rest of
  // the container. Targets the PUBLISH queue for callers that expect a
  // single QueuePort; per-queue routing happens through the registry.
  const queueRegistry = container.resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry);
  const queueAdapter = queueRegistry.forQueue(QUEUE_NAMES.PUBLISH);
  const storageAdapter = createStorageAdapter();

  // Initialize dead letter queue
  const _deadLetterQueue = createDeadLetterQueue({
    redisUrl: getRedisUrl(),
    queueName: QUEUE_NAMES.DEAD_LETTER_QUEUE,
    maxRetentionDays: 30,
  });

  // Initialize circuit breaker monitor
  const _circuitBreakerMonitor = createCircuitBreakerMonitor(client.register);

  // Initialize security manager
  const securityManager = new SecurityManager({
    contentSecurityPolicy: {
      enabled: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "https:", "data:"],
        "connect-src": ["'self'", "https:", "wss:"],
        "font-src": ["'self'", "https:", "data:"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": [],
      },
    },
    cors: {
      enabled: true,
      allowedOrigins: [
        "http://localhost:3000", // API
        "http://localhost:3100", // Admin
        "http://localhost:3200", // Client
        "https://localhost:3000",
        "https://localhost:3100",
        "https://localhost:3200",
      ],
      allowedMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      allowCredentials: true,
      maxAge: 86400,
    },
    hsts: {
      enabled: true,
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  });

  // Initialize performance monitor
  const performanceMonitor = new PerformanceMonitor(
    apiMetrics,
    redis,
    container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler)
  );

  // Initialize tenant health monitor
  const tenantHealthMonitor = createTenantHealthMonitor(
    repoAdapter,
    queueAdapter,
    storageAdapter,
    cacheManager
  );

  // Middleware registration (Fastify v5 patterns)

  // Register audit middleware first (for all routes)
  await typedApp.register(async function auditPlugin(fastify) {
    await fastify.addHook("preHandler", auditMiddleware);
  });

  // Register metrics middleware
  const metricsMiddleware = createMetricsMiddleware(apiMetrics);
  await typedApp.register(async function metricsPlugin(fastify) {
    await fastify.addHook("preHandler", metricsMiddleware.preHandler);
    await fastify.addHook("onResponse", metricsMiddleware.onResponse);
    await fastify.addHook("onError", metricsMiddleware.onError);
  });

  // Initialize Sentry error tracking (reads DSN from MONITORING credentials)
  try {
    const { initSentry } = await import("./observability/sentryInit.js");
    const credService = container.resolve<
      import("@core/security/PlatformCredentialService.js").PlatformCredentialService
    >(TOKENS.PlatformCredentialService);
    const monitoringCreds = await credService.getGroup("MONITORING");
    if (monitoringCreds.ok) {
      const creds = monitoringCreds.value;
      initSentry(
        creds.sentryDsn ?? null,
        creds.sentryEnvironment ?? env.NODE_ENV,
        parseFloat(creds.sentryTracesSampleRate ?? "0.1")
      );
    }
  } catch (err) {
    typedApp.log.warn({ err }, "Sentry initialization skipped");
  }

  // 🔒 SECURITY: Centralized error handler (prevents information leakage)
  // Never exposes stack traces, database schema, or internal paths in production
  const errorHandler = createErrorHandler(typedApp.log);
  typedApp.setErrorHandler(errorHandler);
  typedApp.log.info("Centralized error handler enabled - all errors sanitized");

  // Rate limiting setup. The token-bucket limiter is resolved from the
  // composition root (RateLimiterPort, http-scoped instance); per-path
  // capacity/window come from the rule table. Standard rules are applied
  // before the expensive ones — first prefix match wins.
  if (env.ENABLE_RATE_LIMITING) {
    const httpRateLimiter = container.resolve<RateLimiterPort>(TOKENS.HttpRateLimiter);
    const rules = [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES];

    typedApp.log.info(
      `Rate limiting enabled: ${EXPENSIVE_ENDPOINT_RULES.length} expensive endpoints protected`
    );

    typedApp.addHook(
      "preHandler",
      createHttpRateLimitPreHandler(httpRateLimiter, {
        defaultConfig: RateLimitConfigs.STANDARD,
        rules,
      })
    );
  }

  // Register security and performance middleware
  await securityManager.register(typedApp);

  // IP allowlist enforcement (reads SecuritySettings from DB, 60s cache)
  const { createIpAllowlistMiddleware } = await import("./security/ipAllowlistMiddleware.js");
  typedApp.addHook("onRequest", createIpAllowlistMiddleware(prisma));

  // Bind request-scoped audit context to AsyncLocalStorage so every
  // EncryptionService.decrypt() invocation triggered by this request
  // emits an AuditLog row enriched with userId / ipAddress / correlationId.
  // Workers and cron run outside any request scope and emit decrypt audit
  // events without these fields — which honestly reflects "system-initiated".
  const { withRequestAuditContext } = await import("./security/decryptAuditContext.js");
  typedApp.addHook("onRequest", (request, _reply, done) => {
    const ctx = {
      ...(request.id !== undefined && { correlationId: String(request.id) }),
      ...(request.ip !== undefined && { ipAddress: request.ip }),
      ...(request.headers["user-agent"] !== undefined && {
        userAgent: String(request.headers["user-agent"]),
      }),
      // userId is populated post-auth — auth middleware sets request.user
      // before any decrypt happens; we read it lazily inside the audit
      // emitter so the latest value flows through.
    };
    withRequestAuditContext(ctx, () => done());
  });

  // CSRF token validation on state-changing admin requests
  const { createCsrfMiddleware } = await import("./security/csrfMiddleware.js");
  typedApp.addHook("preHandler", createCsrfMiddleware(prisma));

  // Performance monitoring hooks
  typedApp.addHook(
    "preHandler",
    async (request: FastifyRequest & { startTime?: number }, _reply: FastifyReply) => {
      request.startTime = Date.now();
    }
  );

  typedApp.addHook(
    "onResponse",
    async (request: FastifyRequest & { startTime?: number }, reply: FastifyReply) => {
      if (request.startTime) {
        const responseTime = Date.now() - request.startTime;
        await performanceMonitor.recordRequest(request, reply, responseTime);
      }
    }
  );

  // Route registration (Fastify v5 async plugin pattern)

  // Register health routes first (no authentication required)
  const { healthRoutes } = await import("./health/healthRoutes.js");
  await typedApp.register(healthRoutes, { redis, cacheManager });

  // Billing webhooks — no auth, raw body (must be before auth middleware)
  await typedApp.register(billingWebhookRoutes);

  // Register all route modules
  await typedApp.register(authRoutes);
  await typedApp.register(auditRoutes);
  await typedApp.register(activityFeedRoutes);
  await typedApp.register(mfaRoutes);
  await typedApp.register(rbacRoutes);

  // Register API key management routes (create, list, rotate, deactivate)
  const { apiKeyRoutes } = await import("./auth/apiKeyRoutes.js");
  await typedApp.register(apiKeyRoutes);
  await typedApp.register(accountLifecycleRoutes);
  await typedApp.register(pricingRoutes);
  await typedApp.register(adminUserRoutes);
  await typedApp.register(adminAuthRoutes);
  await typedApp.register(adminAnalyticsRoutes);
  await typedApp.register(schedulingRoutes);
  await typedApp.register(queueRoutes);
  await typedApp.register(subscriptionRoutes);
  await typedApp.register(clientBillingRoutes);
  await typedApp.register(adminBillingRoutes);
  await typedApp.register(complianceRoutes);
  await typedApp.register(settingsRoutes);
  await typedApp.register(outboxAdminRoutes);
  await typedApp.register(analyticsRoutes);
  // aiRoutes defines its paths relative ("/generate", "/predict-timing", …) and
  // every client consumer calls them under "/ai/*" — register with the /ai prefix
  // so the routes are actually reachable (without it the whole AI surface 404s).
  await typedApp.register(aiRoutes, { prefix: "/ai" });

  // Register account, project, post, and channel routes
  const { accountRoutes } = await import("./accounts/accountRoutes.js");
  const { projectRoutes } = await import("./projects/projectRoutes.js");
  const { postRoutes } = await import("./posts/postRoutes.js");
  const { channelRoutes } = await import("./channels/channelRoutes.js");
  await typedApp.register(accountRoutes);
  await typedApp.register(projectRoutes);
  await typedApp.register(postRoutes);
  await typedApp.register(channelRoutes);

  // Register crisis mode, link tracking, team management, and notification routes
  await typedApp.register(crisisRoutes);
  await typedApp.register(linkRoutes);
  await typedApp.register(teamRoutes);
  await typedApp.register(notificationRoutes);
  await typedApp.register(approvalRoutes);
  await typedApp.register(onboardingRoutes);
  await typedApp.register(announcementRoutes);
  await typedApp.register(approvalWorkflowRoutes);
  await typedApp.register(commentRoutes);
  await typedApp.register(inboxRoutes);
  await typedApp.register(listeningRoutes);
  await typedApp.register(bulkScheduleRoutes);
  await typedApp.register(conversationNoteRoutes);
  await typedApp.register(campaignRoutes);
  await typedApp.register(utmRoutes);
  await typedApp.register(reportRoutes);
  await typedApp.register(firstCommentRoutes);
  await typedApp.register(externalNotificationRoutes);
  await typedApp.register(aiImageRoutes);
  await typedApp.register(recurringPostRoutes);
  await typedApp.register(repurposeRoutes);
  await typedApp.register(promptTemplateRoutes);
  await typedApp.register(usageRoutes);
  await typedApp.register(brandVoiceRoutes);
  await typedApp.register(brandKitRoutes);
  await typedApp.register(assetRoutes);
  await typedApp.register(zapierRoutes);
  await typedApp.register(makeRoutes);
  await typedApp.register(taskRoutes);
  await typedApp.register(samlRoutes);
  await typedApp.register(oidcRoutes);
  await typedApp.register(customReportRoutes);
  await typedApp.register(schedulingClientRoutes);

  // Register provider routes
  const { providerRoutes } = await import("./providers/providerRoutes.js");
  await typedApp.register(providerRoutes);

  // Register template, content, webhook dashboard, dashboard, and trend routes
  const { templateRoutes } = await import("./templates/templateRoutes.js");
  const { contentRoutes } = await import("./content/contentRoutes.js");
  const { dashboardRoutes } = await import("./admin/dashboardRoutes.js");
  const { secretsRotationRoutes } = await import("./admin/secretsRotationRoutes.js");
  const { channelReauthRoutes } = await import("./admin/channelReauthRoutes.js");
  const { webhookAdminRoutes } = await import("./admin/webhookAdminRoutes.js");
  const { oidcAdminRoutes } = await import("./admin/oidcAdminRoutes.js");
  const { apiKeyAdminRoutes } = await import("./admin/apiKeyAdminRoutes.js");
  const { massReauthRoutes } = await import("./admin/massReauthRoutes.js");
  const { trendRoutes } = await import("./trends/trendRoutes.js");
  const { trendRadarRoutes } = await import("./trends/trendRadarRoutes.js");
  const { aiLocalizedRoutes } = await import("./ai/aiLocalizedRoutes.js");
  const { registerWebhookDashboardRoutes } = await import("./webhooks/webhookDashboardRoutes.js");
  await typedApp.register(templateRoutes);
  await typedApp.register(contentRoutes);
  await typedApp.register(dashboardRoutes);
  await typedApp.register(secretsRotationRoutes);
  await typedApp.register(channelReauthRoutes);
  await typedApp.register(webhookAdminRoutes);
  await typedApp.register(oidcAdminRoutes);
  await typedApp.register(apiKeyAdminRoutes);
  await typedApp.register(massReauthRoutes);
  await typedApp.register(trendRoutes);
  await typedApp.register(trendRadarRoutes);
  await typedApp.register(aiLocalizedRoutes);
  await registerWebhookDashboardRoutes(typedApp);

  // Register cache monitoring routes
  const { cacheStatsRoutes } = await import("./monitoring/cacheStatsRoutes.js");
  await typedApp.register(cacheStatsRoutes);

  // Register OAuth routes
  await registerOAuthRoutes(
    typedApp,
    typedApp.container!.resolve<CachePort>(TOKENS.CachePort),
    typedApp.container!.resolve(TOKENS.ChannelRepository)
  );

  // Register CRM routes
  await typedApp.register(crmRoutes);

  // Register customer authentication routes
  await typedApp.register(customerAuthRoutes);

  // Saga Integration: route registration runs unconditionally so all
  // /sagas/* paths are present in the OpenAPI schema (including SCHEMA_ONLY
  // dumps). Heavy services (EventService, Redis pub/sub, BullMQ) are only
  // started when SCHEMA_ONLY is false — they hold long-lived connections
  // that prevent process.exit(0) in the dump script.
  const { SagaIntegration } = await import("./saga/SagaIntegration.js");

  // Prepare heavy-service dependencies (omitted in SCHEMA_ONLY mode).
  let sagaEventService: EventService | undefined;
  let sagaCQRSBus: CQRSBusImpl | undefined;
  let sagaLockStore: SemanticLockPort | undefined;

  if (!env.SCHEMA_ONLY) {
    const { EventService } = await import("./events/EventService.js");
    const { CQRSBusImpl } = await import("./cqrs/CQRSBus.js");

    sagaEventService = new EventService({
      prisma,
      redis,
      scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
    });
    // EventService.publishEvents() throws "not initialized" until initialize() is
    // called — without this, every saga step that publishes events (Create, Update)
    // fails downstream and the saga either fails or stalls.
    const sagaEventServiceInit = await sagaEventService.initialize();
    if (!sagaEventServiceInit.ok) {
      logger.error({ err: sagaEventServiceInit.error }, "Failed to initialize saga EventService");
    }

    sagaCQRSBus = new CQRSBusImpl({
      eventService: sagaEventService,
      redis,
      enableMetrics: true,
      enableQueryCache: false,
    });

    // Register Post command handlers on the saga's CQRSBus. The saga emits
    // commands like `post.create` / `post.update` / `post.delete` via
    // `cqrsBus.executeCommand(...)`; without this wiring the bus throws
    // "No handler registered for command type: post.create" and every saga
    // step 1 (Create) fails silently into the FAILED terminal state.
    const { createPostCommandHandlers } = await import("./cqrs/handlers/PostCommandHandlers.js");
    createPostCommandHandlers({
      createPostUseCase: container.resolve(TOKENS.CreatePostUseCase),
      updatePostUseCase: container.resolve(TOKENS.UpdatePostUseCase),
      deletePostUseCase: container.resolve(TOKENS.DeletePostUseCase),
      postRepository: container.resolve(TOKENS.PostRepository),
      channelRepository: container.resolve(TOKENS.ChannelRepository),
      redis,
    }).forEach((handler) => sagaCQRSBus!.registerCommandHandler(handler));

    // Semantic lock backend (Azure saga §15-20). Reuses the saga's redis
    // connection — lock ops are short, non-blocking SET NX / Lua release.
    const { RedisSemanticLockStore } =
      await import("./infrastructure/saga/RedisSemanticLockStore.js");
    sagaLockStore = new RedisSemanticLockStore(redis);
  }

  // Construct and initialize SagaIntegration. In schemaOnly mode initialize()
  // registers routes only (no manager init, no pub/sub). In full mode all
  // services start and routes register as before.
  const sagaIntegration = new SagaIntegration({
    fastify: typedApp,
    prisma,
    ...(sagaEventService && { eventService: sagaEventService }),
    ...(sagaCQRSBus && { cqrsBus: sagaCQRSBus }),
    redis,
    queue: queueAdapter,
    scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
    projectRepository: container.resolve(TOKENS.ProjectRepository),
    channelRepository: container.resolve(TOKENS.ChannelRepository),
    postRepository: container.resolve(TOKENS.PostRepository),
    ...(sagaLockStore && { lockStore: sagaLockStore }),
    schemaOnly: env.SCHEMA_ONLY,
  });
  await sagaIntegration.initialize();
  typedApp.decorate("sagaIntegration", sagaIntegration);

  // Metrics endpoint for Prometheus
  typedApp.get("/metrics", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Content-Type", client.register.contentType);
    return reply.send(await client.register.metrics());
  });

  // Tenant health endpoint
  typedApp.get(
    "/health/tenant/:tenantId/project/:projectId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsSchema = z.object({
        tenantId: z.string().uuid(),
        projectId: z.string().uuid(),
      });

      try {
        const { tenantId, projectId } = paramsSchema.parse(request.params);
        const health = await tenantHealthMonitor.getTenantHealth(tenantId, projectId);

        if (!health.ok) {
          return reply.status(500).send({
            ok: false,
            error: health.error,
          });
        }

        return reply.send({
          ok: true,
          tenant: tenantId,
          health: health.value,
        });
      } catch {
        return reply.status(400).send({
          error: "Invalid tenant ID",
        });
      }
    }
  );

  // Root endpoint
  typedApp.get("/", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      name: "OmniPost API",
      version: "3.1.0",
      status: "running",
      timestamp: new Date().toISOString(),
    });
  });

  return typedApp;
}

// Server startup
async function start() {
  try {
    // Fail fast if DATABASE_URL credentials don't authenticate. Catches the
    // common dev pitfall of a stale Postgres volume holding a password that
    // no longer matches .env (silent split-brain that otherwise surfaces as
    // BackgroundTaskScheduler error spam minutes later).
    await verifyDatabaseAuth();

    const app = await createApp();

    // Start outbox relay (polls outbox table and dispatches unpublished events)
    // and outbox cleaner (removes old published events hourly)
    const outboxRelay = app.container!.resolve<OutboxRelay>(TOKENS.OutboxRelay);
    const outboxCleaner = app.container!.resolve<OutboxCleaner>(TOKENS.OutboxCleaner);

    // Bridge: outbox-dispatched domain events → customer integration delivery
    // (Zapier/Make/Slack/Salesforce via IntegrationSubscription.targetUrl).
    // Without this wire the relay claims and silently discards every event.
    const integrationDeliveryHandler = app.container!.resolve<IntegrationEventDeliveryHandler>(
      TOKENS.IntegrationEventDeliveryHandler
    );
    const eventDispatcher = app.container!.resolve<EventDispatcher>(TOKENS.EventDispatcher);
    for (const eventType of INTEGRATION_HANDLED_EVENT_TYPES) {
      eventDispatcher.register(eventType, integrationDeliveryHandler);
    }

    // Bridge: SocialMessageReceived domain event → TRIAGE_INBOX BullMQ job.
    // The handler reads {messageId, accountId} from the outbox-reconstructed
    // payload and enqueues triage classification. Idempotent via dedupeKey.
    const triageDispatchHandler = app.container!.resolve<TriageDispatchEventHandler>(
      TOKENS.TriageDispatchEventHandler
    );
    for (const eventType of TRIAGE_HANDLED_EVENT_TYPES) {
      eventDispatcher.register(eventType, triageDispatchHandler);
    }

    // BulkScheduleRowConfirmed → BULK_SCHEDULE BullMQ job.
    // Idempotent via dedupeKey = bulk-{batchId}-{itemId}.
    const bulkScheduleDispatchHandler = app.container!.resolve<BulkScheduleDispatchEventHandler>(
      TOKENS.BulkScheduleDispatchEventHandler
    );
    for (const eventType of BULK_SCHEDULE_HANDLED_EVENT_TYPES) {
      eventDispatcher.register(eventType, bulkScheduleDispatchHandler);
    }

    outboxRelay.start();
    outboxCleaner.start();

    // Arm the 60-second reconciliation sweep by resolving the singleton.
    app.container!.resolve<BulkScheduleReconciliationService>(
      TOKENS.BulkScheduleReconciliationService
    );

    // Gateway switch processor — BullMQ worker for reminder/suspend jobs
    const { GatewaySwitchProcessor } = await import("./billing/gatewaySwitchProcessor.js");
    const switchProcessorRedis = createRedisConnection({ maxRetriesPerRequest: null });
    switchProcessorRedis.on("error", () => {});
    const _gatewaySwitchProcessor = new GatewaySwitchProcessor(
      switchProcessorRedis,
      app.container!.resolve(TOKENS.PrismaClient),
      app.container!.resolve(TOKENS.EmailPort)
    );
    logger.info("GatewaySwitchProcessor started");

    // RecurrenceScheduler — ticks every 60 s, processes due recurring posts
    // and creates + schedules a new Post for each occurrence.
    const { RecurrenceScheduler: _RecurrenceSchedulerType } =
      await import("./recurring/RecurrenceScheduler.js");
    const recurrenceScheduler = app.container!.resolve<
      InstanceType<typeof _RecurrenceSchedulerType>
    >(TOKENS.RecurrenceScheduler);
    recurrenceScheduler.start();

    // Resolve the background task scheduler once and register daily maintenance jobs.
    const scheduler = app.container!.resolve<BackgroundTaskScheduler>(
      TOKENS.BackgroundTaskScheduler
    );

    // DLQ archival — daily
    const { DlqArchivalService: _DlqArchivalType } =
      await import("@core/webhooks/DlqArchivalService.js");
    const dlqArchival = app.container!.resolve<InstanceType<typeof _DlqArchivalType>>(
      TOKENS.DlqArchivalService
    );
    scheduler.register(
      "dlq-archival",
      async () => {
        await dlqArchival.archiveResolvedEvents(90);
        await dlqArchival.flagStaleEvents(30);
      },
      24 * 60 * 60 * 1000
    );

    // Data retention cleanup — daily
    const { DataRetentionService: _DataRetentionType } =
      await import("@core/compliance/DataRetentionService.js");
    const dataRetention = app.container!.resolve<InstanceType<typeof _DataRetentionType>>(
      TOKENS.DataRetentionService
    );
    scheduler.register(
      "data-retention-cleanup",
      () => dataRetention.runRetentionCleanup(),
      24 * 60 * 60 * 1000
    );

    // Auto-renewal of expired trials — daily. Canonical SoT: the api
    // SubscriptionService (the duplicate apps/workers autoRenewalWorker was
    // removed — FN-004 dual-write/double-charge risk).
    const { SubscriptionService: _SubscriptionServiceType } =
      await import("@core/billing/SubscriptionService.js");
    const subscriptionSvc = app.container!.resolve<InstanceType<typeof _SubscriptionServiceType>>(
      TOKENS.SubscriptionService
    );
    scheduler.register(
      "auto-renewal",
      async () => {
        const result = await subscriptionSvc.processAutoRenewals();
        if (!result.ok) {
          logger.warn({ err: result.error }, "Auto-renewal processing failed");
        }
      },
      24 * 60 * 60 * 1000
    );

    // Inbox sync coordinator — every 30 minutes.
    // Enqueues one inbox-sync job per active channel into BullMQ; the in-process
    // inbox-sync consumer (apps/api, below) consumes QUEUE_NAMES.INBOX_SYNC and
    // ingests comments into SocialMessage via SyncProviderCommentsUseCase.
    // (Audit finding FN-015.)
    const { DispatchInboxSyncUseCase: _DispatchInboxSyncType } =
      await import("@core/inbox/DispatchInboxSyncUseCase.js");
    const dispatchInboxSync = app.container!.resolve<InstanceType<typeof _DispatchInboxSyncType>>(
      TOKENS.DispatchInboxSyncUseCase
    );
    scheduler.register(
      "inbox-sync-dispatch",
      async () => {
        const result = await dispatchInboxSync.execute({});
        if (!result.ok) {
          logger.warn({ err: result.error }, "Inbox sync dispatch failed");
        }
      },
      30 * 60 * 1000
    );

    // Mention search coordinator — frequent recent-window pass every 30 minutes,
    // plus a wide-window reconciliation every 12 hours as a safety net for
    // mentions missed by webhooks or transient search failures. Both enqueue
    // jobs into QUEUE_NAMES.MENTION_INGEST consumed by the workers' bootstrap.
    const { DispatchMentionSearchUseCase: _DispatchMentionSearchType } =
      await import("@core/listening/DispatchMentionSearchUseCase.js");
    const dispatchMentionSearch = app.container!.resolve<
      InstanceType<typeof _DispatchMentionSearchType>
    >(TOKENS.DispatchMentionSearchUseCase);
    scheduler.register(
      "mention-search-dispatch",
      async () => {
        const result = await dispatchMentionSearch.execute({});
        if (!result.ok) {
          logger.warn({ err: result.error }, "Mention search dispatch failed");
        }
      },
      30 * 60 * 1000
    );
    scheduler.register(
      "mention-reconcile-dispatch",
      async () => {
        const result = await dispatchMentionSearch.execute({ lookbackMs: 48 * 60 * 60 * 1000 });
        if (!result.ok) {
          logger.warn({ err: result.error }, "Mention reconcile dispatch failed");
        }
      },
      12 * 60 * 60 * 1000
    );

    // Analytics ingestion coordinator — every 6 hours.
    // Enqueues one analytics-ingest job per active channel into BullMQ; the
    // in-process analytics consumer (apps/api, below) consumes
    // QUEUE_NAMES.ANALYTICS_AGGREGATION and upserts metrics into
    // AnalyticsDailySummary via IngestChannelAnalyticsUseCase. (Audit finding FN-016.)
    const { DispatchAnalyticsIngestionUseCase: _DispatchAnalyticsType } =
      await import("@core/analytics/DispatchAnalyticsIngestionUseCase.js");
    const dispatchAnalyticsIngestion = app.container!.resolve<
      InstanceType<typeof _DispatchAnalyticsType>
    >(TOKENS.DispatchAnalyticsIngestionUseCase);
    scheduler.register(
      "analytics-ingest-dispatch",
      async () => {
        const result = await dispatchAnalyticsIngestion.execute({});
        if (!result.ok) {
          logger.warn({ err: result.error }, "Analytics ingest dispatch failed");
        }
      },
      6 * 60 * 60 * 1000
    );

    // Repurpose detection coordinator — daily. Enqueues one
    // DETECT_REPURPOSE job per account with active channels.
    const dispatchDetectRepurpose = app.container!.resolve<DispatchDetectRepurposeUseCase>(
      TOKENS.DispatchDetectRepurposeUseCase
    );
    scheduler.register(
      "detect-repurpose-dispatch",
      async () => {
        const result = await dispatchDetectRepurpose.execute({});
        if (!result.ok) {
          logger.warn({ err: result.error }, "Detect repurpose dispatch failed");
        }
      },
      24 * 60 * 60 * 1000
    );

    const dispatchDetectTrends = app.container!.resolve<DispatchDetectTrendsUseCase>(
      TOKENS.DispatchDetectTrendsUseCase
    );
    scheduler.register(
      "trend-radar-dispatch",
      async () => {
        const result = await dispatchDetectTrends.execute({});
        if (!result.ok) {
          logger.warn({ err: result.error }, "Trend radar dispatch failed");
        }
      },
      24 * 60 * 60 * 1000
    );

    // GENERATE_REPURPOSE consumer — runs the plan→act→reflect agent graph
    // per target platform and persists each draft as a pending repurpose
    // variant. Hosted here because the agent stack lives in this process.
    const repurposeAgent = app.container!.resolve<AgentOrchestrationPort>(
      TOKENS.AgentOrchestrationPort
    );
    const repurposeVariantPort = new PrismaRepurposeVariantAdapter(
      app.container!.resolve(TOKENS.PrismaClient)
    );
    const repurposeConsumer = createBullMQConsumerAdapter({
      queueName: QUEUE_NAMES.GENERATE_REPURPOSE,
      connection: app.container!.resolve<Redis>(TOKENS.BullMQWorkerConnection),
    });
    await repurposeConsumer.subscribe(async (job) => {
      await processRepurposeGenerateJob(
        { agent: repurposeAgent, variants: repurposeVariantPort, logger },
        job.payload as { proposalId: string }
      );
    });
    logger.info("GENERATE_REPURPOSE consumer started");

    // DETECT_REPURPOSE consumer — scans an account's high performers and
    // proposes repurpose candidates; each proposal enqueues a GENERATE job.
    const detectRepurposeUseCase = app.container!.resolve<DetectRepurposeCandidatesUseCase>(
      TOKENS.DetectRepurposeCandidatesUseCase
    );
    const detectRepurposeConsumer = createBullMQConsumerAdapter({
      queueName: QUEUE_NAMES.DETECT_REPURPOSE,
      connection: app.container!.resolve<Redis>(TOKENS.BullMQWorkerConnection),
    });
    await detectRepurposeConsumer.subscribe(async (job) => {
      await processRepurposeDetectJob(
        { detect: detectRepurposeUseCase, logger },
        job.payload as { accountId: string }
      );
    });
    logger.info("DETECT_REPURPOSE consumer started");

    // TRIAGE_INBOX consumer — classifies an inbound social message via
    // schema-validated structured output (priority + sentiment + 3 replies)
    // and persists the result on the SocialMessage row.
    const triageInboxUseCase = app.container!.resolve<TriageInboxMessageUseCase>(
      TOKENS.TriageInboxMessageUseCase
    );
    const triageInboxConsumer = createBullMQConsumerAdapter({
      queueName: QUEUE_NAMES.TRIAGE_INBOX,
      connection: app.container!.resolve<Redis>(TOKENS.BullMQWorkerConnection),
    });
    await triageInboxConsumer.subscribe(async (job) => {
      await processTriageInboxJob(
        { triage: triageInboxUseCase, logger },
        job.payload as { messageId: string; accountId: string }
      );
    });
    logger.info("TRIAGE_INBOX consumer started");

    // TREND_RADAR consumer — runs the multi-source trend-detection pipeline
    // (Perplexity web + own analytics + inbox mentions) and persists scored
    // results to TrendRadarResult.
    const detectTrendsUseCase = app.container!.resolve<DetectTrendsUseCase>(
      TOKENS.DetectTrendsUseCase
    );
    const trendRadarConsumer = createBullMQConsumerAdapter({
      queueName: QUEUE_NAMES.TREND_RADAR,
      connection: app.container!.resolve<Redis>(TOKENS.BullMQWorkerConnection),
    });
    await trendRadarConsumer.subscribe(async (job) => {
      await processTrendRadarJob(
        { detect: detectTrendsUseCase, logger },
        job.payload as { accountId: string; dayKey: string }
      );
    });
    logger.info("TREND_RADAR consumer started");

    // BULK_SCHEDULE worker — one job per validated CSV row: create + schedule a
    // post (idempotent). Hosted here so it resolves use cases from the app
    // container (no direct Prisma). Rows that exhaust their retries are moved to
    // the DLQ and marked FAILED in the manifest so the batch can complete.
    const bulkScheduleWorker = await startBulkScheduleWorker({
      process: app.container!.resolve<ProcessBulkScheduleRowUseCase>(
        TOKENS.ProcessBulkScheduleRowUseCase
      ),
      fail: app.container!.resolve<FailBulkScheduleRowUseCase>(TOKENS.FailBulkScheduleRowUseCase),
      deadLetter: app
        .container!.resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
        .forQueue(QUEUE_NAMES.BULK_SCHEDULE_DEAD_LETTER),
      logger,
      connection: app.container!.resolve<Redis>(TOKENS.BullMQWorkerConnection),
    });
    logger.info("BULK_SCHEDULE worker started");

    // ANALYTICS_AGGREGATION + INBOX_SYNC consumers — hosted in-process here (like
    // the bulk-schedule / repurpose consumers) so they run the canonical use cases
    // from the app container. The former apps/workers analytics/inbox workers that
    // reimplemented this logic inline against Prisma were removed (DUP-01/02). On an
    // AUTH failure each flags the channel for reauth via UpdateChannelAuthStateUseCase.
    const analyticsIngestConsumer = await startAnalyticsIngestConsumer({
      ingest: app.container!.resolve<IngestChannelAnalyticsUseCase>(
        TOKENS.IngestChannelAnalyticsUseCase
      ),
      markReauth: app.container!.resolve<UpdateChannelAuthStateUseCase>(
        TOKENS.UpdateChannelAuthStateUseCase
      ),
      logger,
      connection: app.container!.resolve<Redis>(TOKENS.BullMQWorkerConnection),
    });
    logger.info("ANALYTICS_AGGREGATION consumer started");

    const inboxSyncConsumer = await startInboxSyncConsumer({
      sync: app.container!.resolve<SyncProviderCommentsUseCase>(TOKENS.SyncProviderCommentsUseCase),
      markReauth: app.container!.resolve<UpdateChannelAuthStateUseCase>(
        TOKENS.UpdateChannelAuthStateUseCase
      ),
      logger,
      connection: app.container!.resolve<Redis>(TOKENS.BullMQWorkerConnection),
    });
    logger.info("INBOX_SYNC consumer started");

    const port = env.PORT;
    const host = env.HOST;

    await app.listen({ port, host });

    logger.info({ host, port }, "Server running");
    logger.info("Outbox relay and cleaner started");

    // Graceful shutdown — inside start() so we have access to app and outbox references
    const shutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, "Shutting down gracefully...");
      outboxRelay.stop();
      outboxCleaner.stop();
      await repurposeConsumer.close();
      await detectRepurposeConsumer.close();
      await triageInboxConsumer.close();
      await trendRadarConsumer.close();
      await bulkScheduleWorker.close();
      await analyticsIngestConsumer.close();
      await inboxSyncConsumer.close();

      // Quit the shared BullMQ worker connection only AFTER every consumer's
      // Worker has drained. The adapters no longer own this socket (the
      // composition root does), so closing the Workers does not close it —
      // an explicit quit here prevents a hanging Redis handle. In-flight jobs
      // would error if the socket died before the Workers drained, hence the
      // ordering: consumers.close() → workerConnection.quit().
      const workerConnection = app.container!.resolve<Redis>(TOKENS.BullMQWorkerConnection);
      await workerConnection.quit();

      // Shutdown saga integration (closes pub/sub subscriber and saga manager)
      const saga = (app as unknown as Record<string, unknown>).sagaIntegration as
        | import("./saga/SagaIntegration.js").SagaIntegration
        | undefined;
      if (saga) {
        await saga.shutdown();
      }

      // Defensive quit of the saga pub/sub subscriber connection. The saga
      // integration owns runtime teardown (saga.shutdown() disconnects it), so
      // this is belt-and-suspenders: peekInstance returns the socket ONLY if it
      // was actually constructed during this process's lifetime (it is not
      // consumed until the saga subscriber wiring lands), so an unresolved lazy
      // singleton is a no-op rather than a force-constructed socket created just
      // to close it. quit() is idempotent if saga.shutdown() already closed it.
      const sagaSubscriber = app.container!.peekInstance<Redis>(TOKENS.SagaSubscriberConnection);
      if (sagaSubscriber) {
        await sagaSubscriber.quit();
      }

      // Tear down the analytics realtime stream: stop the 30s poll and quit the
      // broadcaster's Redis subscriber (the scheduler teardown below won't close
      // the duplicated Redis connection).
      const realtimeAnalytics = app.container!.resolve<RealtimeAnalyticsService>(
        TOKENS.RealtimeAnalyticsService
      );
      realtimeAnalytics.shutdown();
      const analyticsBroadcaster = app.container!.resolve<AnalyticsStreamBroadcaster>(
        TOKENS.AnalyticsStreamBroadcaster
      );
      await analyticsBroadcaster.shutdown();

      // Tear down all BackgroundTaskScheduler-registered recurring tasks.
      const scheduler = app.container!.resolve<BackgroundTaskScheduler>(
        TOKENS.BackgroundTaskScheduler
      );
      const shutdownResult = await scheduler.shutdownAll();
      if (shutdownResult.timedOut) {
        logger.warn({ shutdownResult }, "BackgroundTaskScheduler shutdown timed out");
      }

      // Close all BullMQ queue adapters via the registry — closes every
      // Queue and the shared Redis connection in one shot.
      const registry = app.container!.resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry);
      await registry.close();

      // Defensive quit of the analytics distributed-counter connection. No
      // adapter owns this socket, so the composition root closes it here, after
      // the registry. peekInstance returns it ONLY if it was actually
      // constructed (the ROICalculator consumer that resolves it is not wired
      // until a later slice), so this is a no-op for an unresolved singleton
      // rather than a force-constructed socket created just to close it.
      const analyticsRedis = app.container!.peekInstance<Redis>(TOKENS.AnalyticsRedisConnection);
      if (analyticsRedis) {
        await analyticsRedis.quit();
      }

      await app.close();
      await closeDatabaseConnections();
      process.exit(0);
    };

    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
  } catch (err) {
    logger.error({ err }, "Error starting server");
    process.exit(1);
  }
}

// Start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { createApp };
