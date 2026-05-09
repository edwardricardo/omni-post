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
import { prisma, verifyDatabaseAuth } from "@infra/prisma";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { decryptChannelCredentials } from "@shared/types";
import type { ProviderAdapter } from "@ports/core";
import type { Provider as PrismaProvider } from "@infra/prisma";
import { registerGracefulShutdown } from "./lib/gracefulShutdown.js";
import { handleProviderAuthError } from "./lib/handleProviderAuthError.js";
import { ChannelAuthFailureRecorder } from "./services/ChannelAuthFailureRecorder.js";
import { CredentialResolver } from "./services/CredentialResolver.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", name: "analytics-ingest-worker" });

const platformEncryptionKey = process.env.PLATFORM_ENCRYPTION_KEY;
if (!platformEncryptionKey) {
  throw new Error("PLATFORM_ENCRYPTION_KEY is required for the analytics ingest worker");
}
const decryptCredentialsForWorker = (envelope: {
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsAuthTag: string;
  credentialsKeyVersion: number;
}) => decryptChannelCredentials(envelope, platformEncryptionKey);

const repo = createPrismaRepoAdapter({ decryptChannelCredentials: decryptCredentialsForWorker });
const credentialResolver = new CredentialResolver(repo);

const providerAdapters: Record<string, ProviderAdapter> = {
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

  const credentialResult = await credentialResolver.resolve(channelId);
  if (!credentialResult.ok) {
    logger.warn(
      { channelId, provider: providerName },
      "Credential lookup failed — flagging channel as needing reauth"
    );
    await handleProviderAuthError(
      authFailureRecorder,
      channelId,
      providerName,
      "Credential lookup failed during analytics ingestion"
    );
    throw new Error(`Provider ${providerName} returned error: AUTH`);
  }

  const result = await adapter.fetchAnalytics({ channelId, since, until }, credentialResult.value);

  if (!result.ok) {
    if (result.error === "AUTH") {
      logger.warn(
        { channelId, provider: providerName },
        "Auth error — flagging channel as needing reauth"
      );
      await handleProviderAuthError(
        authFailureRecorder,
        channelId,
        providerName,
        "Provider rejected credentials during analytics ingestion"
      );
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

const authFailureRecorder = new ChannelAuthFailureRecorder({ prisma });

async function start() {
  // Fail fast if DATABASE_URL credentials don't authenticate (typically a
  // stale Postgres volume after a password rotation without `down -v`).
  await verifyDatabaseAuth();

  const connection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    // No commandTimeout: BullMQ Worker uses blocking commands (BZPOPMIN,
    // XREAD BLOCK) that legitimately wait indefinitely for jobs. Any
    // commandTimeout interrupts those polls mid-flight and surfaces as
    // spurious "Command timed out" errors (BullMQ issue #2619). Worker
    // liveness is enforced via lockDuration + stalledInterval (BullMQ-side)
    // and TCP keepAlive (transport-side).
    connectTimeout: 10_000,
    keepAlive: 30_000,
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
      // Bound BullMQ defaults that are too lax:
      //   lockDuration default 30000 ms → 60000 ms — analytics ingestion
      //     can legitimately exceed 30s on large tenants; 60s gives room
      //     before stalled-detection re-picks the job.
      //   stalledInterval default 30000 ms → 30000 ms (kept) — half of
      //     lockDuration so a stalled worker is detected on the second tick.
      //   drainDelay default 5 → 5 (kept) — 5 s polling on empty queue is
      //     the canonical baseline.
      lockDuration: 60_000,
      stalledInterval: 30_000,
      drainDelay: 5,
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

  registerGracefulShutdown({
    name: "analytics-ingest",
    target: { workers: [worker], connections: [connection], prisma },
    logger,
  });

  logger.info(
    "Analytics ingest worker started, listening on queue: %s",
    QUEUE_NAMES.ANALYTICS_AGGREGATION
  );
}

start();
