/**
 * @file publishWorker.ts
 * @description BullMQ worker entry point that consumes publish jobs, dispatches to provider
 *              adapters, records metrics, and exposes a Prometheus HTTP endpoint.
 * @layer infrastructure
 */
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

// Initialize OpenTelemetry BEFORE any other imports
import {
  publishingInstrumentation,
  databaseInstrumentation,
  businessKPITracker,
} from "./telemetry/initialization.js";

import { createXAdapter } from "@providers/x";
import { createInstagramAdapter } from "@providers/instagram";
import { createFacebookAdapter } from "@providers/facebook";
import { createYouTubeAdapter } from "@providers/youtube";
import { createTikTokAdapter } from "@providers/tiktok";
import { createSnapchatAdapter } from "@providers/snapchat";
import { createTelegramAdapter } from "@providers/telegram";
import { createPinterestAdapter } from "@providers/pinterest";
import { createLinkedInAdapter } from "@providers/linkedin";
import { createBlueskyAdapter } from "@providers/bluesky";
import { createThreadsAdapter } from "@providers/threads";
import { createBullMQConsumerAdapter, QUEUE_NAMES } from "@adapters/queue-bullmq";
import { registerGracefulShutdown } from "./lib/gracefulShutdown.js";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { decryptChannelCredentials } from "@shared/types";
import { CredentialResolver } from "./services/CredentialResolver.js";

// PLATFORM_ENCRYPTION_KEY is required for decrypting Channel.credentials.
// Workers fail fast if missing — no plaintext fallback.
const platformEncryptionKey = process.env.PLATFORM_ENCRYPTION_KEY;
if (!platformEncryptionKey) {
  throw new Error("PLATFORM_ENCRYPTION_KEY is required for the publish worker");
}
const decryptCredentialsForWorker = (envelope: {
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsAuthTag: string;
  credentialsKeyVersion: number;
}) => decryptChannelCredentials(envelope, platformEncryptionKey);
import { DefaultBackgroundTaskScheduler } from "@observability/background-scheduler";
import client from "prom-client";
import http from "http";
import pino from "pino";
import Redis from "ioredis";
import { WorkerMetrics } from "./metrics/workerMetrics.js";
import { PublishHandler } from "./publishHandler.js";
import type { PublishProvider } from "./publishHandler.js";

const consumer = createBullMQConsumerAdapter({ queueName: QUEUE_NAMES.PUBLISH });
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const scheduler = new DefaultBackgroundTaskScheduler({
  logger: {
    error: (msg, data) => logger.error({ data }, msg),
    info: (msg, data) => logger.info({ data }, msg),
    debug: (msg, data) => logger.debug({ data }, msg),
  },
});
const repo = createPrismaRepoAdapter({
  scheduler,
  decryptChannelCredentials: decryptCredentialsForWorker,
});

/**
 * Registry of provider adapters indexed by provider name.
 * Used to route publish jobs to the correct social media platform adapter.
 *
 * The worker reads `job.data.provider` to determine which adapter handles
 * the publishing. If a job doesn't specify a provider, it defaults to "x"
 * for backwards compatibility with existing jobs in the queue.
 */
const providerRegistry: Record<string, PublishProvider> = {
  x: createXAdapter({ logger }),
  instagram: createInstagramAdapter({ logger }),
  facebook: createFacebookAdapter({ logger }),
  youtube: createYouTubeAdapter({ logger }),
  tiktok: createTikTokAdapter({ logger }),
  snapchat: createSnapchatAdapter({ logger }),
  telegram: createTelegramAdapter({ logger }),
  pinterest: createPinterestAdapter({ logger }),
  linkedin: createLinkedInAdapter({ logger }),
  bluesky: createBlueskyAdapter({ logger }),
  threads: createThreadsAdapter({ logger }),
};

const credentialResolver = new CredentialResolver(repo);

// Enhanced Metrics
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const workerMetrics = new WorkerMetrics(registry);

// Redis connection for saga pub/sub notifications (best-effort)
const notifyRedis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  // Bound the ioredis "wait forever" defaults: a hung Redis must not stall
  // the worker. 5 s per command + 5 s connect; enough for healthy clusters,
  // fail-fast for a black hole.
  commandTimeout: 5_000,
  connectTimeout: 5_000,
});
notifyRedis.on("error", () => {
  // Suppress unhandled errors -- saga notifications are best-effort
});

// Create the handler with all real dependencies
const handler = new PublishHandler({
  repo,
  providerRegistry,
  credentialResolver,
  workerMetrics,
  logger,
  instrumentation: publishingInstrumentation,
  databaseInstrumentation,
  businessKPITracker,
  notifyRedis,
});

async function start() {
  await consumer.subscribe(async (job) => {
    const payload = job.payload as {
      postId: string;
      channelId: string;
      provider?: string;
      sagaId?: string;
    };
    await handler.handleJob({
      payload,
      dedupeKey: job.dedupeKey,
    });
  });
  logger.info(
    { providers: Object.keys(providerRegistry) },
    "Worker subscribed. Awaiting jobs in 'publish'."
  );

  // Enhanced metrics and health endpoint
  const metricsPort = Number(process.env.METRICS_PORT ?? 9100);
  http
    .createServer(async (req, res) => {
      if (req.url === "/metrics") {
        res.setHeader("Content-Type", registry.contentType);
        res.end(await registry.metrics());
      } else if (req.url === "/health") {
        res.setHeader("Content-Type", "application/json");
        const healthData = {
          ok: true,
          timestamp: new Date().toISOString(),
          activeJobs: workerMetrics.metrics.jobsActive.get(),
          activeThreads: workerMetrics.metrics.threadsInProgress.get(),
          queueDepth: workerMetrics.metrics.queueDepth.get(),
          workerHealth: workerMetrics.metrics.workerHealth.get(),
          correlationTracking: workerMetrics.metrics.correlationTracker.get(),
          availableProviders: Object.keys(providerRegistry),
        };
        res.end(JSON.stringify(healthData));
      } else {
        res.statusCode = 404;
        res.end();
      }
    })
    .listen(metricsPort, () => {
      workerMetrics.setHealthy();
      logger.info({ metricsPort }, "Enhanced metrics server listening");
    });
}

start();

// Graceful shutdown — closes the consumer (waits for active jobs), the
// scheduler (cancels recurring tasks), and the saga notification Redis
// connection. The shared helper covers SIGTERM and SIGINT identically.
registerGracefulShutdown({
  name: "publish",
  target: {
    connections: [notifyRedis],
    afterTeardown: async () => {
      await consumer.close();
      const shutdownResult = await scheduler.shutdownAll();
      if (shutdownResult.timedOut) {
        logger.warn({ shutdownResult }, "BackgroundTaskScheduler shutdown timed out");
      }
    },
  },
  logger,
});
