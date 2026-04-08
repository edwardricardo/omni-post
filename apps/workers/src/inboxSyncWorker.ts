/**
 * @file inboxSyncWorker.ts
 * @description BullMQ worker that processes inbox sync jobs.
 *              Each job fetches comments for a single channel from its
 *              provider adapter and ingests them into the social inbox.
 *              Runs every 30 minutes via coordinator pattern.
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

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", name: "inbox-sync-worker" });

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
  projectId: string;
  since?: string;
}): Promise<void> {
  const { channelId, accountId, projectId, since: sinceStr } = jobData;

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, deletedAt: null },
    select: { id: true, provider: true, credentials: true },
  });

  if (!channel) {
    logger.warn({ channelId }, "Channel not found, skipping");
    return;
  }

  const providerName = channel.provider.toLowerCase();
  const adapter = providerAdapters[providerName];

  if (!adapter || !adapter.getComments) {
    logger.debug({ channelId, provider: providerName }, "Provider does not support comments");
    return;
  }

  const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 60 * 60 * 1000);

  logger.info(
    { channelId, provider: providerName, since: since.toISOString() },
    "Syncing inbox comments"
  );

  let cursor: string | undefined;
  let synced = 0;
  let skipped = 0;

  do {
    const commentsResult = await adapter.getComments({
      channelCredentials: channel.credentials,
      since,
      cursor,
      limit: 100,
    });

    if (!commentsResult.ok) {
      if (commentsResult.error === "AUTH") {
        logger.warn({ channelId, provider: providerName }, "Auth error — channel may need reauth");
        return;
      }
      throw new Error(`Provider ${providerName} returned error: ${commentsResult.error}`);
    }

    const { comments, nextCursor } = commentsResult.value;

    for (const comment of comments) {
      const existing = await prisma.socialMessage.findFirst({
        where: {
          providerMessageId: comment.providerMessageId,
          provider: channel.provider,
        },
        select: { id: true },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await prisma.socialMessage.create({
        data: {
          accountId,
          projectId,
          channelId,
          provider: channel.provider,
          providerMessageId: comment.providerMessageId,
          ...(comment.providerParentId !== undefined && {
            providerParentId: comment.providerParentId,
          }),
          messageType: "COMMENT",
          authorName: comment.authorName,
          ...(comment.authorHandle !== undefined && { authorHandle: comment.authorHandle }),
          ...(comment.authorAvatarUrl !== undefined && {
            authorAvatarUrl: comment.authorAvatarUrl,
          }),
          authorProviderId: comment.authorProviderId,
          body: comment.body,
          providerCreatedAt: comment.createdAt,
        },
      });
      synced++;
    }

    cursor = nextCursor;
  } while (cursor);

  logger.info({ channelId, provider: providerName, synced, skipped }, "Inbox sync completed");
}

async function start() {
  const connection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  const worker = new Worker(
    QUEUE_NAMES.INBOX_SYNC,
    async (job) => {
      await processJob(
        job.data as { channelId: string; accountId: string; projectId: string; since?: string }
      );
    },
    {
      connection,
      concurrency: 5,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    }
  );

  worker.on("completed", (job) => {
    logger.debug({ jobId: job.id }, "Inbox sync job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, "Inbox sync job failed");
  });

  worker.on("error", (error) => {
    logger.error({ err: error }, "Worker error");
  });

  logger.info("Inbox sync worker started, listening on queue: %s", QUEUE_NAMES.INBOX_SYNC);
}

start();
