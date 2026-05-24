/**
 * @file inboxSyncWorker.ts
 * @description BullMQ worker that processes inbox sync jobs.
 *              Each job fetches comments for a single channel from its
 *              provider adapter and ingests them into the social inbox.
 *              Runs every 30 minutes via coordinator pattern.
 *
 *              Exports `startInboxSyncWorker()` for composition under
 *              `bootstrap.ts`; also runs standalone when invoked directly
 *              (`node dist/inboxSyncWorker.js`).
 * @layer infrastructure
 */

import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { Worker } from "bullmq";
import Redis from "ioredis";
import pino from "pino";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import { registerGracefulShutdown, type ShutdownTarget } from "./lib/gracefulShutdown.js";
import { handleProviderAuthError } from "./lib/handleProviderAuthError.js";
import { ChannelAuthFailureRecorder } from "./services/ChannelAuthFailureRecorder.js";
import { CredentialResolver } from "./services/CredentialResolver.js";
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
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { decryptChannelCredentials } from "@shared/types";
import type { ProviderAdapter } from "@ports/core";
import type { PrismaClient } from "@infra/prisma";
import { workerPrisma, verifyDatabaseAuth } from "./container/workerContainer.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", name: "inbox-sync-worker" });

const platformEncryptionKey = process.env.PLATFORM_ENCRYPTION_KEY;
if (!platformEncryptionKey) {
  throw new Error("PLATFORM_ENCRYPTION_KEY is required for the inbox sync worker");
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

async function processJob(
  jobData: {
    channelId: string;
    accountId: string;
    projectId: string;
    since?: string;
  },
  prisma: PrismaClient,
  authFailureRecorder: ChannelAuthFailureRecorder
): Promise<void> {
  const { channelId, accountId, projectId, since: sinceStr } = jobData;

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, deletedAt: null },
    select: { id: true, provider: true },
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
      "Credential lookup failed during inbox sync"
    );
    throw new Error(`Provider ${providerName} returned error: AUTH`);
  }

  let cursor: string | undefined;
  let synced = 0;
  let skipped = 0;

  do {
    const commentsResult = await adapter.getComments({
      channelCredentials: credentialResult.value,
      since,
      ...(cursor !== undefined && { cursor }),
      limit: 100,
    });

    if (!commentsResult.ok) {
      if (commentsResult.error === "AUTH") {
        logger.warn(
          { channelId, provider: providerName },
          "Auth error — flagging channel as needing reauth"
        );
        await handleProviderAuthError(
          authFailureRecorder,
          channelId,
          providerName,
          "Provider rejected credentials during inbox sync"
        );
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

export interface StartInboxSyncWorkerOptions {
  /** Injected PrismaClient (from the workers composition root). */
  prisma: PrismaClient;
  /**
   * When false, callers must register their own graceful-shutdown handler
   * (typical for composed bootstrap that drains multiple workers as a unit).
   * Default true: the worker registers its own SIGTERM / SIGINT handler.
   */
  registerShutdown?: boolean;
}

/**
 * @function startInboxSyncWorker
 * @description Boots the inbox-sync BullMQ worker + its Redis connection.
 * @returns ShutdownTarget so a composer (`bootstrap.ts`) can drain it.
 */
export async function startInboxSyncWorker(
  options: StartInboxSyncWorkerOptions
): Promise<ShutdownTarget> {
  // Fail fast if DATABASE_URL credentials don't authenticate (typically a
  // stale Postgres volume after a password rotation without `down -v`).
  await verifyDatabaseAuth();

  const authFailureRecorder = new ChannelAuthFailureRecorder({ prisma: options.prisma });

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
    QUEUE_NAMES.INBOX_SYNC,
    async (job) => {
      await processJob(
        job.data as { channelId: string; accountId: string; projectId: string; since?: string },
        options.prisma,
        authFailureRecorder
      );
    },
    {
      connection,
      concurrency: 5,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
      // BullMQ default lockDuration of 30 s is too tight for inbox sync
      // (provider API calls can stall). 60 s gives room before stalled
      // detection re-picks the job; stalledInterval halved relative to
      // lockDuration so detection lands on the second tick.
      lockDuration: 60_000,
      stalledInterval: 30_000,
      drainDelay: 5,
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

  const target: ShutdownTarget = {
    workers: [worker],
    connections: [connection],
    prisma: options.prisma,
  };

  if (options.registerShutdown !== false) {
    registerGracefulShutdown({ name: "inbox-sync", target, logger });
  }

  logger.info("Inbox sync worker started, listening on queue: %s", QUEUE_NAMES.INBOX_SYNC);
  return target;
}

// Standalone entry point: when invoked directly (e.g., `node dist/inboxSyncWorker.js`)
// rather than imported by `bootstrap.ts`, kick off the worker.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  void startInboxSyncWorker({ prisma: workerPrisma });
}
