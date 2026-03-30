/**
 * @file analyticsIngestWorker.ts
 * @description BullMQ worker that processes analytics ingestion jobs.
 *              Each job fetches analytics for a single channel from its
 *              provider adapter and upserts results into AnalyticsDailySummary.
 *              Coordinator pattern: one job per channel, dispatched every 6 hours.
 * @layer infrastructure
 */

import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { Worker } from "bullmq";
import Redis from "ioredis";
import pino from "pino";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
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
import { prisma } from "@infra/prisma";
import type { ProviderAdapter } from "@ports/core";
import type { Provider as PrismaProvider } from "@infra/prisma";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", name: "analytics-ingest-worker" });

const providerAdapters: Record<string, ProviderAdapter> = {
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
};

async function processJob(jobData: {
  channelId: string;
  accountId: string;
  since?: string;
}): Promise<void> {
  const { channelId, since: sinceStr } = jobData;

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, deletedAt: null },
    select: { id: true, provider: true, projectId: true },
  });

  if (!channel) {
    logger.warn({ channelId }, "Channel not found, skipping");
    return;
  }

  const providerName = channel.provider.toLowerCase();
  const adapter = providerAdapters[providerName];

  if (!adapter || !adapter.fetchAnalytics) {
    logger.debug({ channelId, provider: providerName }, "Provider does not support analytics");
    return;
  }

  const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const until = new Date();

  logger.info(
    { channelId, provider: providerName, since: since.toISOString() },
    "Fetching analytics"
  );

  const result = await adapter.fetchAnalytics({ channelId, since, until });

  if (!result.ok) {
    if (result.error === "AUTH") {
      logger.warn({ channelId, provider: providerName }, "Auth error — channel may need reauth");
      return;
    }
    throw new Error(`Provider ${providerName} returned error: ${result.error}`);
  }

  const rawData = result.value as {
    metrics?: Array<{
      date?: string;
      postId?: string;
      views?: number;
      likes?: number;
      comments?: number;
      shares?: number;
    }>;
  };

  const metrics = rawData.metrics ?? [];
  if (metrics.length === 0) {
    logger.info({ channelId }, "No analytics data returned");
    return;
  }

  await prisma.$transaction(
    metrics.map((m) =>
      prisma.analyticsDailySummary.upsert({
        where: {
          postId_channelId_provider_date: {
            postId: m.postId ?? "",
            channelId,
            provider: channel.provider as PrismaProvider,
            date: m.date ? new Date(m.date) : new Date(),
          },
        },
        update: {
          views: m.views ?? 0,
          likes: m.likes ?? 0,
          comments: m.comments ?? 0,
          shares: m.shares ?? 0,
          records: { increment: 1 },
        },
        create: {
          postId: m.postId ?? null,
          channelId,
          provider: channel.provider as PrismaProvider,
          date: m.date ? new Date(m.date) : new Date(),
          views: m.views ?? 0,
          likes: m.likes ?? 0,
          comments: m.comments ?? 0,
          shares: m.shares ?? 0,
          records: 1,
        },
      })
    )
  );

  logger.info(
    { channelId, provider: providerName, ingested: metrics.length },
    "Analytics ingested successfully"
  );
}

async function start() {
  const connection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  const worker = new Worker(
    QUEUE_NAMES.ANALYTICS_AGGREGATION,
    async (job) => {
      await processJob(job.data as { channelId: string; accountId: string; since?: string });
    },
    {
      connection,
      concurrency: 5,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    }
  );

  worker.on("completed", (job) => {
    logger.debug({ jobId: job.id }, "Analytics job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, "Analytics job failed");
  });

  worker.on("error", (error) => {
    logger.error({ err: error }, "Worker error");
  });

  logger.info(
    "Analytics ingest worker started, listening on queue: %s",
    QUEUE_NAMES.ANALYTICS_AGGREGATION
  );
}

start();
