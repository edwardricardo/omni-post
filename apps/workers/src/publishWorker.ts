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

import { xAdapter } from "@providers/x";
import { instagramAdapter } from "@providers/instagram";
import { facebookAdapter } from "@providers/facebook";
import { youtubeAdapter } from "@providers/youtube";
import { tiktokAdapter } from "@providers/tiktok";
import { snapchatAdapter } from "@providers/snapchat";
import { telegramAdapter } from "@providers/telegram";
import { pinterestAdapter } from "@providers/pinterest";
import { linkedInAdapter } from "@providers/linkedin";
import { blueskyAdapter } from "@providers/bluesky";
import { threadsAdapter } from "@providers/threads";
import { createBullMQConsumerAdapter } from "@adapters/queue-bullmq";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { DefaultBackgroundTaskScheduler } from "@observability/background-scheduler";
import client from "prom-client";
import http from "http";
import pino from "pino";
import Redis from "ioredis";
import { WorkerMetrics } from "./metrics/workerMetrics.js";
import { PublishHandler } from "./publishHandler.js";
import type { PublishProvider } from "./publishHandler.js";

const consumer = createBullMQConsumerAdapter();
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const scheduler = new DefaultBackgroundTaskScheduler({
  logger: {
    error: (msg, data) => logger.error({ data }, msg),
    info: (msg, data) => logger.info({ data }, msg),
    debug: (msg, data) => logger.debug({ data }, msg),
  },
});
const repo = createPrismaRepoAdapter({ scheduler });

/**
 * Registry of provider adapters indexed by provider name.
 * Used to route publish jobs to the correct social media platform adapter.
 *
 * The worker reads `job.data.provider` to determine which adapter handles
 * the publishing. If a job doesn't specify a provider, it defaults to "x"
 * for backwards compatibility with existing jobs in the queue.
 */
const providerRegistry: Record<string, PublishProvider> = {
  x: xAdapter,
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  youtube: youtubeAdapter,
  tiktok: tiktokAdapter,
  snapchat: snapchatAdapter,
  telegram: telegramAdapter,
  pinterest: pinterestAdapter,
  linkedin: linkedInAdapter,
  bluesky: blueskyAdapter,
  threads: threadsAdapter,
};

// Enhanced Metrics
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const workerMetrics = new WorkerMetrics(registry);

// Redis connection for saga pub/sub notifications (best-effort)
const notifyRedis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
});
notifyRedis.on("error", () => {
  // Suppress unhandled errors -- saga notifications are best-effort
});

// Create the handler with all real dependencies
const handler = new PublishHandler({
  repo,
  providerRegistry,
  workerMetrics,
  logger,
  instrumentation: publishingInstrumentation,
  databaseInstrumentation,
  businessKPITracker,
  notifyRedis,
});

async function start() {
  await consumer.subscribe({}, async (job) => {
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

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Worker shutting down");
  await scheduler.shutdownAll();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
