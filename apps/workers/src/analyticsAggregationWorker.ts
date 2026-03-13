/**
 * @file analyticsAggregationWorker.ts
 * @description BullMQ worker that handles analytics aggregation jobs:
 *              - aggregate-daily: rolls up raw Analytics into AnalyticsDailySummary
 *              - aggregate-monthly: rolls up daily summaries into AnalyticsMonthlySummary
 *              - purge-raw: deletes raw Analytics older than 90 days in batches
 *
 *              Registers repeatable cron jobs on startup so they run automatically.
 * @layer infrastructure (worker process)
 */

import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { Worker, Queue } from "bullmq";
import type { Job } from "bullmq";
import Redis from "ioredis";
import pino from "pino";
import client from "prom-client";
import http from "http";
import { prisma } from "@infra/prisma";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUEUE_NAME = QUEUE_NAMES.ANALYTICS_AGGREGATION;
const PURGE_BATCH_SIZE = 1000;
const PURGE_RAW_DAYS = 90;

type AggregationJobType = "aggregate-daily" | "aggregate-monthly" | "purge-raw";

interface AggregationJobData {
  type: AggregationJobType;
}

// ---------------------------------------------------------------------------
// Logger & Metrics
// ---------------------------------------------------------------------------

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const jobsProcessed = new client.Counter({
  name: "analytics_aggregation_jobs_processed_total",
  help: "Total number of analytics aggregation jobs processed",
  labelNames: ["type", "status"] as const,
  registers: [registry],
});

const jobDuration = new client.Histogram({
  name: "analytics_aggregation_job_duration_seconds",
  help: "Duration of analytics aggregation jobs in seconds",
  labelNames: ["type"] as const,
  buckets: [0.5, 1, 5, 10, 30, 60, 120],
  registers: [registry],
});

const rowsAffected = new client.Counter({
  name: "analytics_aggregation_rows_affected_total",
  help: "Total rows affected by aggregation operations",
  labelNames: ["type", "operation"] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Aggregation handlers
// ---------------------------------------------------------------------------

/**
 * Aggregates raw Analytics records from yesterday into AnalyticsDailySummary.
 * Groups by postId, channelId, provider and sums all metric columns.
 */
async function aggregateDaily(): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);

  logger.info({ date: yesterday.toISOString().slice(0, 10) }, "Starting daily aggregation");

  // Group raw analytics by postId, channelId, provider for yesterday
  const groups = await prisma.analytics.groupBy({
    by: ["postId", "channelId", "provider"],
    where: {
      capturedAt: { gte: yesterday, lte: endOfYesterday },
    },
    _sum: {
      views: true,
      likes: true,
      comments: true,
      shares: true,
    },
    _count: { id: true },
  });

  let upsertCount = 0;

  for (const group of groups) {
    await prisma.analyticsDailySummary.upsert({
      where: {
        postId_channelId_provider_date: {
          postId: group.postId ?? "",
          channelId: group.channelId,
          provider: group.provider,
          date: yesterday,
        },
      },
      update: {
        views: group._sum.views ?? 0,
        likes: group._sum.likes ?? 0,
        comments: group._sum.comments ?? 0,
        shares: group._sum.shares ?? 0,
        records: group._count.id,
      },
      create: {
        ...(group.postId !== null && { postId: group.postId }),
        channelId: group.channelId,
        provider: group.provider,
        date: yesterday,
        views: group._sum.views ?? 0,
        likes: group._sum.likes ?? 0,
        comments: group._sum.comments ?? 0,
        shares: group._sum.shares ?? 0,
        records: group._count.id,
      },
    });
    upsertCount++;
  }

  rowsAffected.inc({ type: "daily", operation: "upsert" }, upsertCount);
  logger.info(
    { date: yesterday.toISOString().slice(0, 10), groups: groups.length, upserts: upsertCount },
    "Daily aggregation completed"
  );
}

/**
 * Aggregates AnalyticsDailySummary records from the previous month into
 * AnalyticsMonthlySummary. Groups by postId, channelId, provider and sums.
 */
async function aggregateMonthly(): Promise<void> {
  const now = new Date();
  const firstOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfPreviousMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  lastOfPreviousMonth.setHours(23, 59, 59, 999);

  logger.info(
    { month: firstOfPreviousMonth.toISOString().slice(0, 7) },
    "Starting monthly aggregation"
  );

  const groups = await prisma.analyticsDailySummary.groupBy({
    by: ["postId", "channelId", "provider"],
    where: {
      date: { gte: firstOfPreviousMonth, lte: lastOfPreviousMonth },
    },
    _sum: {
      views: true,
      likes: true,
      comments: true,
      shares: true,
      records: true,
    },
  });

  let upsertCount = 0;

  for (const group of groups) {
    await prisma.analyticsMonthlySummary.upsert({
      where: {
        postId_channelId_provider_month: {
          postId: group.postId ?? "",
          channelId: group.channelId,
          provider: group.provider,
          month: firstOfPreviousMonth,
        },
      },
      update: {
        views: group._sum.views ?? 0,
        likes: group._sum.likes ?? 0,
        comments: group._sum.comments ?? 0,
        shares: group._sum.shares ?? 0,
        records: group._sum.records ?? 0,
      },
      create: {
        ...(group.postId !== null && { postId: group.postId }),
        channelId: group.channelId,
        provider: group.provider,
        month: firstOfPreviousMonth,
        views: group._sum.views ?? 0,
        likes: group._sum.likes ?? 0,
        comments: group._sum.comments ?? 0,
        shares: group._sum.shares ?? 0,
        records: group._sum.records ?? 0,
      },
    });
    upsertCount++;
  }

  rowsAffected.inc({ type: "monthly", operation: "upsert" }, upsertCount);
  logger.info(
    {
      month: firstOfPreviousMonth.toISOString().slice(0, 7),
      groups: groups.length,
      upserts: upsertCount,
    },
    "Monthly aggregation completed"
  );
}

/**
 * Purges raw Analytics records older than PURGE_RAW_DAYS in batches
 * of PURGE_BATCH_SIZE to avoid long-running transactions that block.
 */
async function purgeRaw(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PURGE_RAW_DAYS);
  cutoff.setHours(0, 0, 0, 0);

  logger.info({ cutoffDate: cutoff.toISOString().slice(0, 10) }, "Starting raw analytics purge");

  let totalDeleted = 0;
  let batchDeleted: number;

  do {
    // Find IDs to delete in a batch
    const batch = await prisma.analytics.findMany({
      where: { capturedAt: { lt: cutoff } },
      select: { id: true },
      take: PURGE_BATCH_SIZE,
    });

    if (batch.length === 0) {
      break;
    }

    const ids = batch.map((r) => r.id);
    const result = await prisma.analytics.deleteMany({
      where: { id: { in: ids } },
    });

    batchDeleted = result.count;
    totalDeleted += batchDeleted;

    logger.debug({ batchDeleted, totalDeleted }, "Purge batch completed");
  } while (batchDeleted >= PURGE_BATCH_SIZE);

  rowsAffected.inc({ type: "purge", operation: "delete" }, totalDeleted);
  logger.info({ totalDeleted }, "Raw analytics purge completed");
}

/**
 * Purges AnalyticsDailySummary records older than 365 days.
 * Monthly summaries are preserved (only daily summaries are purged).
 */
async function purgeOldDailySummaries(): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  cutoffDate.setHours(0, 0, 0, 0);

  const result = await prisma.analyticsDailySummary.deleteMany({
    where: { date: { lt: cutoffDate } },
  });

  rowsAffected.inc({ type: "retention", operation: "delete" }, result.count);
  logger.info(
    { deletedCount: result.count, cutoffDate: cutoffDate.toISOString().slice(0, 10) },
    `Retention cleanup: deleted ${result.count} daily summaries older than 365 days`
  );
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

/**
 * Main job processor that routes to the appropriate handler based on job name.
 */
async function processJob(job: Job<AggregationJobData>): Promise<void> {
  const jobType = job.name as AggregationJobType;
  const startTime = Date.now();

  logger.info({ jobType, jobId: job.id }, "Processing analytics aggregation job");

  try {
    switch (jobType) {
      case "aggregate-daily":
        await aggregateDaily();
        await purgeOldDailySummaries();
        break;
      case "aggregate-monthly":
        await aggregateMonthly();
        break;
      case "purge-raw":
        await purgeRaw();
        break;
      default: {
        const _exhaustive: never = jobType;
        logger.warn({ jobType: _exhaustive }, "Unknown aggregation job type");
        return;
      }
    }

    const durationSeconds = (Date.now() - startTime) / 1000;
    jobDuration.observe({ type: jobType }, durationSeconds);
    jobsProcessed.inc({ type: jobType, status: "success" });

    logger.info({ jobType, jobId: job.id, durationSeconds }, "Analytics aggregation job completed");
  } catch (error: unknown) {
    jobsProcessed.inc({ type: jobType, status: "failure" });

    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error({ jobType, jobId: job.id, err: message }, "Analytics aggregation job failed");

    // Re-throw so BullMQ marks the job as failed and can retry
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// Worker startup
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  // Connection for the worker
  const workerConnection = new Redis(redisUrl, {
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  });

  // Separate connection for the queue (repeatable job registration)
  const queueConnection = new Redis(redisUrl, {
    enableReadyCheck: false,
    maxRetriesPerRequest: 3,
  });

  const worker = new Worker<AggregationJobData>(QUEUE_NAME, processJob, {
    connection: workerConnection,
    concurrency: 1, // Sequential processing to avoid DB contention
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
  });

  worker.on("error", (error: Error) => {
    logger.error({ err: error.message }, "Worker error");
  });

  // Register repeatable cron jobs
  const queue = new Queue<AggregationJobData>(QUEUE_NAME, {
    connection: queueConnection,
  });

  // Daily aggregation at 2:00 AM UTC
  await queue.upsertJobScheduler(
    "aggregate-daily-scheduler",
    { pattern: "0 2 * * *" },
    {
      name: "aggregate-daily",
      data: { type: "aggregate-daily" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30000 },
      },
    }
  );

  // Monthly aggregation at 3:00 AM UTC on the 1st of each month
  await queue.upsertJobScheduler(
    "aggregate-monthly-scheduler",
    { pattern: "0 3 1 * *" },
    {
      name: "aggregate-monthly",
      data: { type: "aggregate-monthly" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60000 },
      },
    }
  );

  // Raw data purge at 4:00 AM UTC daily
  await queue.upsertJobScheduler(
    "purge-raw-scheduler",
    { pattern: "0 4 * * *" },
    {
      name: "purge-raw",
      data: { type: "purge-raw" },
      opts: {
        attempts: 2,
        backoff: { type: "exponential", delay: 30000 },
      },
    }
  );

  logger.info("Repeatable analytics aggregation jobs registered");

  // Health & metrics endpoint
  const metricsPort = Number(process.env.ANALYTICS_WORKER_METRICS_PORT ?? 9101);
  http
    .createServer(async (req, res) => {
      if (req.url === "/metrics") {
        res.setHeader("Content-Type", registry.contentType);
        res.end(await registry.metrics());
      } else if (req.url === "/health") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            worker: "analytics-aggregation",
            timestamp: new Date().toISOString(),
          })
        );
      } else {
        res.statusCode = 404;
        res.end();
      }
    })
    .listen(metricsPort, () => {
      logger.info({ metricsPort }, "Analytics aggregation metrics server listening");
    });

  logger.info({ queue: QUEUE_NAME }, "Analytics aggregation worker started. Awaiting jobs.");
}

start();
