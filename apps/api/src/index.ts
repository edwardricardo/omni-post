// Load environment-specific .env file FIRST
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFile = process.env.NODE_ENV === "test" ? ".env.test" : ".env";
const envPath = path.resolve(__dirname, "../../..", envFile); // Root of monorepo
dotenv.config({ path: envPath, override: true });

// ---- OpenTelemetry initialization (MUST happen before Fastify import) ----
// Conditional on TRACING_ENABLED=true to avoid overhead in dev/test environments
import pino from "pino";
const otelLogger = pino({ name: "api-telemetry" });

if (process.env.TRACING_ENABLED === "true") {
  try {
    const otel = await import("@observability/opentelemetry");
    const environment = process.env.NODE_ENV || "development";
    const telemetry = otel.createApiTelemetry(environment);
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
import { createBullMQQueueAdapter } from "@adapters/queue-bullmq";
import client from "prom-client";
import { createS3StorageAdapter } from "@adapters/storage-s3";
import { RateLimit, RateLimitConfigs, EXPENSIVE_ENDPOINT_RULES } from "./security/rateLimit.js";
import { createErrorHandler } from "./lib/errors/errorHandler.js";
import { createRedisConnection, getRedisUrl } from "./lib/redis.js";
import { logger } from "./lib/logger.js";
import { getRequiredSecret } from "./lib/envValidation.js";
import { ApiMetrics } from "./metrics/apiMetrics.js";
import { createMetricsMiddleware } from "./middleware/metricsMiddleware.js";
import { createCircuitBreakerMonitor } from "@monitoring/circuit-breaker";
import { createDeadLetterQueue } from "@adapters/dead-letter-queue";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import { createCacheManager } from "@adapters/cache-redis";
import fastifyCookie from "@fastify/cookie";
import { createTenantHealthMonitor } from "@monitoring/health-checks";
import { authRoutes } from "./auth/authRoutes.js";
import { setRedisInstance } from "./auth/redisSessionHelpers.js";
import { auditRoutes } from "./audit/auditRoutes.js";
import { auditMiddleware } from "./audit/auditMiddleware.js";
import { mfaRoutes } from "./auth/mfaRoutes.js";
import { rbacRoutes } from "./auth/rbacRoutes.js";
import { accountLifecycleRoutes } from "./admin/accountLifecycleRoutes.js";
import { adminAuthRoutes } from "./admin/auth/adminAuthRoutes.js";
import { executiveRoutes } from "./admin/executiveRoutes.js";
import { schedulingRoutes } from "./admin/schedulingRoutes.js";
import { queueRoutes } from "./admin/queueRoutes.js";
import { subscriptionRoutes } from "./billing/subscriptionRoutes.js";
import { registerOAuthRoutes } from "./auth/providerOAuth.js";
import { setupContainer } from "./infrastructure/container/setup.js";
import { TOKENS } from "./infrastructure/container/types.js";
import type { OutboxRelay } from "./infrastructure/outbox/OutboxRelay.js";
import type { OutboxCleaner } from "./infrastructure/outbox/OutboxCleaner.js";
import { crisisRoutes } from "./projects/crisisRoutes.js";
import { linkRoutes } from "./links/linkRoutes.js";

// Phase 3 imports
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
  });

  // ✅ Apply ZodTypeProvider for type safety
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // ✅ Set up Zod validation compiler
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  // Initialize Redis for advanced rate limiting
  const redis = createRedisConnection();

  // Initialize unified authentication service with Redis
  setRedisInstance(redis);

  // Initialize cache manager
  const cacheManager = createCacheManager({
    redisUrl: getRedisUrl(),
    keyPrefix: "api:",
    defaultTtl: 300,
    enableMetrics: true,
  });

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
    logCacheOps: process.env.LOG_CACHE_OPS === "true",
    excludeRoutes: ["/health", "/metrics"],
  });

  // Initialize DI container and decorate Fastify instance
  const container = setupContainer({ prisma });
  typedApp.decorate("container", container);

  // Initialize cookie support
  await typedApp.register(fastifyCookie, {
    secret: getRequiredSecret("COOKIE_SECRET", "cookie-secret-dev-only"),
  });

  // Initialize components
  const repoAdapter = createPrismaRepoAdapter();
  const queueAdapter = createBullMQQueueAdapter();
  const storageAdapter = createS3StorageAdapter({
    bucket: process.env.S3_BUCKET || "omni-post-media",
    region: process.env.S3_REGION || "us-east-1",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  });

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
  const performanceMonitor = new PerformanceMonitor(apiMetrics, redis);

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

  // 🔒 SECURITY: Centralized error handler (prevents information leakage)
  // Never exposes stack traces, database schema, or internal paths in production
  const errorHandler = createErrorHandler(typedApp.log);
  typedApp.setErrorHandler(errorHandler);
  typedApp.log.info("Centralized error handler enabled - all errors sanitized");

  // Rate limiting setup
  if (process.env.ENABLE_RATE_LIMITING !== "false") {
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

  // Register Phase 3 security and performance middleware
  await securityManager.register(typedApp);

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

  // Register all route modules
  await typedApp.register(authRoutes);
  await typedApp.register(auditRoutes);
  await typedApp.register(mfaRoutes);
  await typedApp.register(rbacRoutes);

  // Register API key management routes (create, list, rotate, deactivate)
  const { apiKeyRoutes } = await import("./auth/apiKeyRoutes.js");
  await typedApp.register(apiKeyRoutes);
  await typedApp.register(accountLifecycleRoutes);
  await typedApp.register(adminAuthRoutes);
  await typedApp.register(executiveRoutes);
  await typedApp.register(schedulingRoutes);
  await typedApp.register(queueRoutes);
  await typedApp.register(subscriptionRoutes);
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

  // Register crisis mode and link tracking routes
  await typedApp.register(crisisRoutes);
  await typedApp.register(linkRoutes);

  // Register provider routes
  const { providerRoutes } = await import("./providers/providerRoutes.js");
  await typedApp.register(providerRoutes);

  // Register template, content, webhook dashboard, dashboard, and trend routes
  const { templateRoutes } = await import("./templates/templateRoutes.js");
  const { contentRoutes } = await import("./content/contentRoutes.js");
  const { dashboardRoutes } = await import("./admin/dashboardRoutes.js");
  const { trendRoutes } = await import("./trends/trendRoutes.js");
  const { registerWebhookDashboardRoutes } = await import("./webhooks/webhookDashboardRoutes.js");
  await typedApp.register(templateRoutes);
  await typedApp.register(contentRoutes);
  await typedApp.register(dashboardRoutes);
  await typedApp.register(trendRoutes);
  await registerWebhookDashboardRoutes(typedApp);

  // Register cache monitoring routes
  const { cacheStatsRoutes } = await import("./monitoring/cacheStatsRoutes.js");
  await typedApp.register(cacheStatsRoutes);

  // Register OAuth routes
  await registerOAuthRoutes(typedApp);

  // Initialize Saga Integration (orchestrates multi-step publishing workflows
  // with real BullMQ job enqueuing and Redis pub/sub worker notifications)
  const { SagaIntegration } = await import("./saga/SagaIntegration.js");
  const { EventService } = await import("./events/EventService.js");
  const { CQRSBusImpl } = await import("./cqrs/CQRSBus.js");

  const sagaEventService = new EventService({ prisma, redis });
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

    const port = parseInt(process.env.PORT || "3000");
    const host = process.env.HOST || "0.0.0.0";

    await app.listen({ port, host });

    logger.info({ host, port }, "Server running");
    logger.info("Outbox relay and cleaner started");

    // Graceful shutdown — inside start() so we have access to app and outbox references
    process.on("SIGINT", async () => {
      logger.info("Shutting down gracefully...");
      outboxRelay.stop();
      outboxCleaner.stop();

      // Shutdown saga integration (closes pub/sub subscriber and saga manager)
      const saga = (app as any).sagaIntegration as
        | import("./saga/SagaIntegration.js").SagaIntegration
        | undefined;
      if (saga) {
        await saga.shutdown();
      }

      await app.close();
      await closeDatabaseConnections();
      process.exit(0);
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
