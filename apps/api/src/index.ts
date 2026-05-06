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

// ✅ CORRECT Fastify v5.6.1 Import Syntax
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { closeDatabaseConnections, prisma } from "@infra/prisma";
import type { QueuePortRegistry } from "@ports/core";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import client from "prom-client";
import { createStorageAdapter } from "./infrastructure/storage/createStorageAdapter.js";
import { RateLimit, RateLimitConfigs, EXPENSIVE_ENDPOINT_RULES } from "./security/rateLimit.js";
import { createErrorHandler } from "./lib/errors/errorHandler.js";
import { createRedisConnection, getRedisUrl } from "./lib/redis.js";
import { logger } from "./lib/logger.js";
import { ApiMetrics } from "./metrics/apiMetrics.js";
import { createMetricsMiddleware } from "./middleware/metricsMiddleware.js";
import { createCircuitBreakerMonitor } from "@monitoring/circuit-breaker";
import { createDeadLetterQueue } from "@adapters/dead-letter-queue";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
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
import { conversationNoteRoutes } from "./inbox/conversationNoteRoutes.js";
import { campaignRoutes } from "./campaigns/campaignRoutes.js";
import { utmRoutes } from "./utm/utmRoutes.js";
import { reportRoutes } from "./reports/reportRoutes.js";
import { firstCommentRoutes } from "./first-comment/firstCommentRoutes.js";
import { externalNotificationRoutes } from "./external-notifications/externalNotificationRoutes.js";
import { aiImageRoutes } from "./ai-image/aiImageRoutes.js";
import { recurringPostRoutes } from "./recurring/recurringPostRoutes.js";
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

import { DatabaseOptimizer } from "./utils/dbOptimization.js";
import { SecurityManager } from "./security/securityHeaders.js";
import { PerformanceMonitor } from "./monitoring/performanceMonitor.js";
import { analyticsRoutes } from "./analytics/analyticsRoutes.js";
import aiRoutes from "./ai/routes.js";

// Cache middleware
import { autoCachePlugin } from "./middleware/autoCacheMiddleware.js";

// ✅ PROPER Fastify v5.6.1 Application Creation
async function createApp(): Promise<FastifyInstance> {
  // ✅ Correct constructor syntax - Fastify v5.6.1
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

  // ✅ Apply ZodTypeProvider for type safety
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // ✅ Set up Zod validation compiler
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  // Register OpenAPI documentation (before routes so schemas are captured)
  const fastifySwagger = await import("@fastify/swagger");
  await typedApp.register(fastifySwagger.default, {
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
    return reply.send(typedApp.swagger());
  });

  // Initialize Redis for advanced rate limiting
  const redis = createRedisConnection();

  // Initialize unified authentication service with Redis
  setRedisInstance(redis);

  // Initialize DI container and decorate Fastify instance (needed so scheduler is
  // available to downstream adapters/managers created below).
  const container = setupContainer({ prisma });
  typedApp.decorate("container", container);
  const bootstrapScheduler = container.resolve<BackgroundTaskScheduler>(
    TOKENS.BackgroundTaskScheduler
  );

  // Initialize cache manager — resolved from the DI container so the same
  // `RedisCacheManager` singleton is wrapped by `TOKENS.CachePort` and used
  // for the Fastify decoration below. No duplicated L1+L2 pools.
  const cacheManager = container.resolve<RedisCacheManager>(TOKENS.RedisCacheManager);

  // Decorate fastify instance with cache manager (accessible as fastify.cacheManager and fastify.cache)
  typedApp.decorate("redis", redis);
  typedApp.decorate("cacheManager", cacheManager);
  typedApp.decorate("cache", cacheManager);

  // Register auto-cache middleware for automatic caching and invalidation
  // (autoCachePlugin handles both caching and cache-plugin functionality)
  await typedApp.register(autoCachePlugin, {
    cacheManager,
    enableCaching: true,
    enableInvalidation: true,
    logCacheOps: env.LOG_CACHE_OPS ?? false,
    excludeRoutes: ["/health", "/metrics"],
  });

  // Initialize cookie support
  await typedApp.register(fastifyCookie, {
    secret: env.COOKIE_SECRET,
  });

  // Initialize components
  const repoAdapter = createPrismaRepoAdapter({ scheduler: bootstrapScheduler });
  // Queue adapter resolved from the registry so this top-level wiring
  // shares the same Redis connection and queue instances as the rest of the
  // container. Targets the PUBLISH queue for legacy callers that expect a
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

  // Initialize API metrics
  const apiMetrics = new ApiMetrics(client.register);

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

  // Initialize database optimizer
  const _dbOptimizer = new DatabaseOptimizer(apiMetrics);

  // Initialize tenant health monitor
  const tenantHealthMonitor = createTenantHealthMonitor(
    repoAdapter,
    queueAdapter,
    storageAdapter,
    cacheManager
  );

  // ✅ PROPER middleware registration using Fastify v5 patterns

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
      import("./security/PlatformCredentialService.js").PlatformCredentialService
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

  // Rate limiting setup
  if (env.ENABLE_RATE_LIMITING) {
    const rateLimit = new RateLimit(redis, RateLimitConfigs.STANDARD);

    // Configure rate limit rules for standard endpoints
    rateLimit.addRule("/health", RateLimitConfigs.HEALTH);
    rateLimit.addRule("/publish/", RateLimitConfigs.STRICT);
    rateLimit.addRule("/media/", RateLimitConfigs.UPLOAD);
    rateLimit.addRule("/accounts$", RateLimitConfigs.AUTH);

    // 🔒 SECURITY: Add rate limiting for expensive endpoints (DoS prevention)
    // These endpoints perform resource-intensive operations and need strict limits
    for (const rule of EXPENSIVE_ENDPOINT_RULES) {
      rateLimit.addRule(rule.path, rule.config);
    }

    typedApp.log.info(
      `Rate limiting enabled: ${EXPENSIVE_ENDPOINT_RULES.length} expensive endpoints protected`
    );

    typedApp.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await rateLimit.checkRateLimit(request);

        // Always add rate limit headers
        reply.header("X-RateLimit-Remaining", result.remaining.toString());
        reply.header("X-RateLimit-Reset", result.resetTime.toString());

        if (!result.allowed) {
          reply.code(429);
          return reply.send({
            ok: false,
            error: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please try again later.",
            retryAfter: new Date(result.resetTime).toISOString(),
          });
        }
      } catch (error) {
        logger.error({ err: error }, "Rate limiting error");
        // On error, allow request to continue
      }
    });
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

  // ✅ PROPER route registration using Fastify v5 async plugin pattern

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
  await typedApp.register(aiRoutes);

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
  await typedApp.register(conversationNoteRoutes);
  await typedApp.register(campaignRoutes);
  await typedApp.register(utmRoutes);
  await typedApp.register(reportRoutes);
  await typedApp.register(firstCommentRoutes);
  await typedApp.register(externalNotificationRoutes);
  await typedApp.register(aiImageRoutes);
  await typedApp.register(recurringPostRoutes);
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
  const { trendRoutes } = await import("./trends/trendRoutes.js");
  const { registerWebhookDashboardRoutes } = await import("./webhooks/webhookDashboardRoutes.js");
  await typedApp.register(templateRoutes);
  await typedApp.register(contentRoutes);
  await typedApp.register(dashboardRoutes);
  await typedApp.register(secretsRotationRoutes);
  await typedApp.register(channelReauthRoutes);
  await typedApp.register(trendRoutes);
  await registerWebhookDashboardRoutes(typedApp);

  // Register cache monitoring routes
  const { cacheStatsRoutes } = await import("./monitoring/cacheStatsRoutes.js");
  await typedApp.register(cacheStatsRoutes);

  // Register OAuth routes
  await registerOAuthRoutes(
    typedApp,
    typedApp.container!.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler)
  );

  // Register CRM routes
  await typedApp.register(crmRoutes);

  // Register customer authentication routes
  await typedApp.register(customerAuthRoutes);

  // Initialize Saga Integration (orchestrates multi-step publishing workflows
  // with real BullMQ job enqueuing and Redis pub/sub worker notifications)
  const { SagaIntegration } = await import("./saga/SagaIntegration.js");
  const { EventService } = await import("./events/EventService.js");
  const { CQRSBusImpl } = await import("./cqrs/CQRSBus.js");

  const sagaEventService = new EventService({
    prisma,
    redis,
    scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
  });
  const sagaCQRSBus = new CQRSBusImpl({
    eventService: sagaEventService,
    redis,
    enableMetrics: true,
    enableQueryCache: false,
  });
  const sagaIntegration = new SagaIntegration({
    fastify: typedApp,
    prisma,
    eventService: sagaEventService,
    cqrsBus: sagaCQRSBus,
    redis,
    queue: queueAdapter,
    scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
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

  // ✅ Root endpoint
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

// ✅ PROPER server startup
async function start() {
  try {
    const app = await createApp();

    // Start outbox relay (polls outbox table and dispatches unpublished events)
    // and outbox cleaner (removes old published events hourly)
    const outboxRelay = app.container!.resolve<OutboxRelay>(TOKENS.OutboxRelay);
    const outboxCleaner = app.container!.resolve<OutboxCleaner>(TOKENS.OutboxCleaner);
    outboxRelay.start();
    outboxCleaner.start();

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

    // Resolve the background task scheduler once and register daily maintenance jobs.
    const scheduler = app.container!.resolve<BackgroundTaskScheduler>(
      TOKENS.BackgroundTaskScheduler
    );

    // DLQ archival — daily
    const { DlqArchivalService: _DlqArchivalType } =
      await import("./webhooks/DlqArchivalService.js");
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
      await import("./compliance/DataRetentionService.js");
    const dataRetention = app.container!.resolve<InstanceType<typeof _DataRetentionType>>(
      TOKENS.DataRetentionService
    );
    scheduler.register(
      "data-retention-cleanup",
      () => dataRetention.runRetentionCleanup(),
      24 * 60 * 60 * 1000
    );

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

      // Shutdown saga integration (closes pub/sub subscriber and saga manager)
      const saga = (app as unknown as Record<string, unknown>).sagaIntegration as
        | import("./saga/SagaIntegration.js").SagaIntegration
        | undefined;
      if (saga) {
        await saga.shutdown();
      }

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
